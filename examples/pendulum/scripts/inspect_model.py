"""Print the compiled joints, inertia and actuator-to-joint mapping."""
from pathlib import Path
import mujoco

model = mujoco.MjModel.from_xml_path(str(Path(__file__).resolve().parents[1] / "pendulum.xml"))
print(f"{model.njnt} joints | {model.nu} actuators | {1 / model.opt.timestep:.0f} Hz")
for i in range(1, model.nbody):
    print(f"{model.body(i).name:12} mass={model.body_mass[i]:.3f} kg")
for i in range(model.nu):
    target = model.joint(int(model.actuator_trnid[i, 0])).name
    print(f"{model.actuator(i).name:16} -> {target}")
