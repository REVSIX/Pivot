"""Stream the caller's own MuJoCo model and data to Pivot instead of opening GLFW."""
import json
import os
import sys
import time
import urllib.request
import urllib.parse

sys.path.insert(0, os.environ["PIVOT_SIMULATOR_DIR"])
from run import metadata, sample
import mujoco


class PivotViewer:
    def __init__(self, model, data, model_path):
        self.model, self.data = model, data
        self.base = os.environ["PIVOT_TELEMETRY_URL"].rstrip("/")
        self.token = os.environ["PIVOT_TELEMETRY_TOKEN"]
        self.folder = os.environ.get("PIVOT_TELEMETRY_FOLDER", ".")
        self.model_path = model_path
        self.id = None
        self.running = True
        self.paused = False
        self.reset_requested = False
        self.last = 0.0

    def request(self, route, payload):
        addr = urllib.parse.urlsplit(self.base)
        if addr.scheme != "http" or addr.hostname != "127.0.0.1" or addr.username or addr.password or addr.path:
            raise ValueError("Run the MuJoCo viewer in a Pivot project terminal.")
        req = urllib.request.Request(self.base + "/api/" + route,
            data=json.dumps(payload, allow_nan=False).encode(), method="POST",
            headers={"Content-Type": "application/json", "X-Pivot-Token": self.token})
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=2) as res:
            return json.load(res)

    def capture(self):
        return {**metadata(self.model, os.path.basename(self.model_path), mujoco),
                "frames": [sample(self.model, self.data)]}

    def __enter__(self):
        if self.id is not None:
            return self
        script = sys.argv[0]
        payload = {"folder": self.folder,
            "model": os.path.basename(self.model_path),
            "script": os.path.basename(script) if os.path.isfile(script) else None,
            "capture": self.capture()}
        if getattr(self, "run", None):
            payload["run"] = self.run
        self.id = self.request("sim/external", payload)["id"]
        return self

    def sync(self):
        now = time.monotonic()
        if now - self.last < .025:
            return
        self.last = now
        control = self.request("sim/external/frame", {"id": self.id,
            "frame": sample(self.model, self.data)})
        self.paused = control["paused"]
        self.reset_requested |= control["reset"]
        self.running = not control["stop"]

    def is_running(self):
        return self.running

    def __exit__(self, *_):
        self.close()

    def close(self):
        self.running = False
        if self.id is None:
            return
        try:
            self.request("sim/external/close", {"id": self.id})
        except OSError:
            pass
        finally:
            self.id = None


def launch_passive(model, data, model_path):
    return PivotViewer(model, data, model_path)
