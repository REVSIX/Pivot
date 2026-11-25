"""A standalone MuJoCo pendulum with a motor and angle sensor."""

import argparse
import math
import time

import mujoco
import mujoco.viewer

try:
    import ide_telem as ide
except ModuleNotFoundError as error:
    if error.name != "ide_telem":
        raise
    ide = None


MODEL = """
<mujoco model="Driven pendulum">
  <option timestep="0.005"/>
  <worldbody>
    <body name="arm" pos="0 0 1">
      <joint name="hinge" type="hinge" axis="0 1 0" damping="0.1"/>
      <geom type="capsule" fromto="0 0 0 0 0 -.8" size=".04" mass=".25"/>
      <geom type="sphere" pos="0 0 -.8" size=".09" mass=".5"/>
    </body>
  </worldbody>
  <actuator><motor name="drive" joint="hinge"/></actuator>
  <sensor><jointpos name="angle" joint="hinge"/></sensor>
</mujoco>
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=float, default=30)
    args = parser.parse_args()

    model = mujoco.MjModel.from_xml_string(MODEL)
    data = mujoco.MjData(model)
    data.qpos[0] = 0.6
    mujoco.mj_forward(model, data)

    with mujoco.viewer.launch_passive(model, data) as viewer:
        start = time.monotonic()
        next_log = 0.0
        while viewer.is_running() and data.time < args.seconds:
            data.ctrl[0] = 0.5 * math.sin(3 * data.time)
            mujoco.mj_step(model, data)
            viewer.sync()
            if ide is not None and data.time >= next_log:
                ide.log("Time Elapsed", data.time, unit="s", timestamp=data.time)
                next_log = data.time + 0.05
            time.sleep(max(0, start + data.time - time.monotonic()))

    if ide is not None:
        ide.flush()


if __name__ == "__main__":
    main()
