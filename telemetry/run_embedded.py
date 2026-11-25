"""Stream a MuJoCo passive viewer to Pivot."""
import math
import os
import sys
from threading import Condition, RLock, Thread
import time

import mujoco as mj

import ide_telem
from pivot_viewer import PivotViewer, metadata, sample


MAX_CHANNELS = 48


def channels(model):
    def components(prefix, array, start, count, unit=""):
        for i in range(count):
            name = prefix if count == 1 else f"{prefix}[{i}]"
            yield name, array, start + i, unit

    for i in range(model.njnt):
        name = model.joint(i).name or f"joint{i}"
        q = int(model.jnt_qposadr[i])
        v = int(model.jnt_dofadr[i])
        nq = int(model.jnt_qposadr[i + 1]) if i + 1 < model.njnt else model.nq
        nv = int(model.jnt_dofadr[i + 1]) if i + 1 < model.njnt else model.nv
        kind = model.jnt_type[i]
        unit = "rad" if kind == mj.mjtJoint.mjJNT_HINGE else "m" if kind == mj.mjtJoint.mjJNT_SLIDE else ""
        yield from components(f"MuJoCo/joint/{name}/position", "qpos", q, nq - q, unit)
        yield from components(f"MuJoCo/joint/{name}/velocity", "qvel", v, nv - v, f"{unit}/s" if unit else "")
    for i in range(model.nu):
        name = model.actuator(i).name or f"actuator{i}"
        yield f"MuJoCo/actuator/{name}/control", "ctrl", i, ""
        yield f"MuJoCo/actuator/{name}/force", "actuator_force", i, ""
    for i in range(model.nsensor):
        name = model.sensor(i).name or f"sensor{i}"
        yield from components(f"MuJoCo/sensor/{name}", "sensordata",
                              int(model.sensor_adr[i]), int(model.sensor_dim[i]))


class EmbeddedViewer(PivotViewer):
    def __init__(self, model, data, model_path, run, period):
        super().__init__(model, data, model_path)
        self.run = run
        self.period = period
        self.cam, self.opt, self.pert = mj.MjvCamera(), mj.MjvOption(), mj.MjvPerturb()
        mj.mjv_defaultCamera(self.cam)
        mj.mjv_defaultOption(self.opt)
        self._lock = RLock()
        self._ready = Condition()
        self._pending = None
        self._closing = False
        self._sampled_time = float(data.time)
        self._scalar_joints = [
            i for i in range(model.njnt)
            if model.jnt_type[i] in (mj.mjtJoint.mjJNT_HINGE, mj.mjtJoint.mjJNT_SLIDE)
        ]
        self._channels = list(channels(model))[:MAX_CHANNELS]
        if not ide_telem.stats()["enabled"]:
            self._channels = []

        super().__enter__()
        self._worker = Thread(target=self._send, name="pivot-viewer", daemon=True)
        self._worker.start()

    def _frame(self):
        frame = sample(self.model, self.data)
        frame["q"] = [frame["q"][self.model.jnt_qposadr[i]] for i in self._scalar_joints]
        frame["v"] = [frame["v"][self.model.jnt_dofadr[i]] for i in self._scalar_joints]
        return frame

    def capture(self):
        meta = metadata(self.model, os.path.basename(self.model_path), mj)
        meta["joints"] = [meta["joints"][i] for i in self._scalar_joints]
        return {**meta, "frames": [self._frame()]}

    def lock(self):
        return self._lock

    def _publish(self):
        with self._lock:
            frame = self._frame()
            self._sampled_time = float(self.data.time)
            samples = [(name, float(getattr(self.data, array)[i]), unit)
                       for name, array, i, unit in self._channels]
        with self._ready:
            self._pending = (frame, samples)
            self._ready.notify()

    def sync(self, state_only=False):
        now = time.monotonic()
        if self.running and now - self.last >= self.period:
            self.last = now
            self._publish()

    def _send(self):
        try:
            while True:
                with self._ready:
                    self._ready.wait_for(lambda: self._pending is not None or self._closing)
                    packet, self._pending = self._pending, None
                    if packet is None:
                        break
                frame, samples = packet
                control = self.request("sim/external/frame", {"id": self.id, "frame": frame})
                self.paused = control["paused"]
                if control["stop"]:
                    break
                if not self.paused and frame["t"] >= 0:
                    for name, value, unit in samples:
                        if math.isfinite(value) and all(ord(char) >= 32 for char in name[:96]):
                            ide_telem.log(name[:96], value, unit=unit, timestamp=frame["t"])
        except (OSError, ValueError) as exc:
            print(f"Pivot viewer disconnected: {exc}", file=sys.stderr)
        finally:
            super().close()

    def close(self):
        if self._closing:
            return
        if self.running and float(self.data.time) != self._sampled_time:
            self._publish()
        self.running = False
        with self._ready:
            self._closing = True
            self._ready.notify()
        self._worker.join(timeout=4.5)
