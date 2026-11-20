"""Run this controller in the Pivot terminal with 'python controller.py'."""
import time
import tomllib
from pathlib import Path

import mujoco
import ide_telem as ide

with Path(__file__).with_name("config").joinpath("control.toml").open("rb") as settings:
    gains = tomllib.load(settings)["controller"]
KP = float(gains["proportional"])
KD = float(gains["derivative"])

def torque(q, dq, target=0.0):
    return max(-6.0, min(6.0, KP * (target - q) - KD * dq))

def main():
    model = mujoco.MjModel.from_xml_path(str(Path(__file__).with_name("pendulum.xml")))
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, 0)
    wall = time.monotonic()
    print("Running the PD controller for 8 simulated seconds.", flush=True)
    for i in range(round(8 / model.opt.timestep)):
        for j in range(model.nu):
            data.ctrl[j] = torque(data.qpos[j], data.qvel[j], gains["target_rad"])
        mujoco.mj_step(model, data)
        if i % 12 == 0:
            # Sampling at ~42 Hz keeps the logging transport outside the 500 Hz control path.
            ide.log("torque", data.ctrl[0], unit="N·m", timestamp=data.time)
            ide.log("position_error", -data.qpos[0], unit="rad", timestamp=data.time)
            ide.log("elbow_velocity", data.qvel[1], unit="rad/s", timestamp=data.time)
            time.sleep(max(0, wall + data.time - time.monotonic()))
    ide.flush()
    print("Telemetry:", ide.stats())

if __name__ == "__main__":
    main()
