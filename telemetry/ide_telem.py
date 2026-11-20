"""Opt-in numerical telemetry client for Pivot. No dependencies beyond Python."""
import atexit
import json
import math
import os
import queue
import sys
import threading
import time
import urllib.parse
import urllib.request

_url = os.getenv("PIVOT_TELEMETRY_URL", "")
_token = os.getenv("PIVOT_TELEMETRY_TOKEN", "")
_folder = os.getenv("PIVOT_TELEMETRY_FOLDER", ".")
_enabled = bool(_url and _token) and os.getenv("PIVOT_TELEMETRY_OFF") != "1"
_origin = time.monotonic()
_pending = queue.Queue(4096)
_lock = threading.Lock()
_thread = None
_dropped = 0
_sent = 0

def request(method, suffix="", payload=None):
    addr = urllib.parse.urlsplit(_url)
    if addr.scheme != "http" or addr.hostname != "127.0.0.1" or addr.username or addr.password or addr.path not in ("","/"):
        raise ValueError("Run telem in a Pivot project terminal.")
    req = urllib.request.Request(_url.rstrip("/") + "/api/telemetry" + suffix, method=method,
            headers={"Content-Type":"application/json","X-Pivot-Token":_token},
            data=None if payload is None else json.dumps(payload, allow_nan=False).encode())
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=2) as response:
        return json.load(response)

def _sender():
    global _dropped, _sent
    while True:
        items = [_pending.get()]
        end = time.monotonic()+0.035
        while len(items)<128:
            try: items.append(_pending.get(timeout=max(0,end-time.monotonic())))
            except queue.Empty: break
        try:
            request("POST", payload={"folder":_folder,"samples":items})
            _sent += len(items)
        except (OSError, ValueError):
            _dropped += len(items)
        finally:
            for _ in items: _pending.task_done()

def log(name_or_value, value=None, *, name=None, unit="", timestamp=None):
    """Queue a sample. Prefer log('name', value) for timing-sensitive or ambiguous code."""
    global _thread, _dropped
    if not _enabled: return False
    if value is None:
        value = name_or_value
        if name is None:
            candidates = [k for k,v in sys._getframe(1).f_locals.items() if v is value and not k.startswith("_")]
            name = candidates[0] if len(candidates)==1 else "value"
    else:
        name = name_or_value
    val = float(value)
    t = time.monotonic() - _origin if timestamp is None else float(timestamp)
    if not isinstance(name,str) or not 0 < len(name) <= 96 or not isinstance(unit,str) or len(unit)>24 or t<0 or not math.isfinite(t) or not math.isfinite(val):
        raise ValueError("Expected a named finite sample with nonnegative time.")
    if _thread is None:
        with _lock:
            if _thread is None:
                _thread=threading.Thread(target=_sender,name="pivot-telemetry",daemon=True)
                _thread.start()
    try: _pending.put_nowait({"name":name,"value":val,"t":t,"unit":unit})
    except queue.Full:
        _dropped += 1
        return False
    return True

def flush(timeout=2.5):
    """Wait for queued samples outside the control loop. Returns False on timeout."""
    until = time.monotonic() + timeout
    while _pending.unfinished_tasks:
        if time.monotonic()>=until: return False
        time.sleep(.005)
    return True

def stats():
    return {"enabled":_enabled,"sent":_sent,"dropped":_dropped,"pending":_pending.unfinished_tasks}

atexit.register(flush)
