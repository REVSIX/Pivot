"""Read a self-contained articulated MJCF model on stdin and emit a bounded capture."""

import json
import math
import sys
import xml.etree.ElementTree as ET

# The web runner deliberately accepts a small, file-free subset of MJCF.
FIELDS = {
    "mujoco": "model",
    "compiler": "angle eulerseq inertiafromgeom autolimits",
    "option": "timestep gravity integrator iterations",
    "visual": "",
    "global": "offwidth offheight",
    "asset": "",
    "material": "name rgba shininess",
    "worldbody": "",
    "body": "name pos quat euler axisangle",
    "joint": "name type axis pos damping stiffness armature range limited ref frictionloss",
    "geom": "name type pos quat euler size fromto mass density rgba friction contype conaffinity material",
    "light": "pos dir diffuse directional",
    "inertial": "pos mass diaginertia quat",
    "site": "name pos size rgba",
    "keyframe": "",
    "key": "name qpos qvel ctrl",
    "actuator": "",
    "motor": "name joint gear ctrlrange ctrllimited",
    "position": "name joint kp ctrlrange ctrllimited",
    "velocity": "name joint kv ctrlrange ctrllimited",
}


def inspect_xml(raw):
    if len(raw) > 65536 or b"<!DOCTYPE" in raw or b"<!ENTITY" in raw or b"\x00" in raw:
        raise ValueError(
            "Use a UTF-8 model under 64 KiB without DTDs or entities."
        )
    root = ET.fromstring(raw.decode("utf-8"))
    elements = list(root.iter())
    if root.tag != "mujoco" or len(elements) > 120:
        raise ValueError(
            "Expected an MJCF model with at most 120 elements."
        )
    for elem in elements:
        unsupported = set(elem.attrib) - set(FIELDS.get(elem.tag, "").split())
        if elem.tag not in FIELDS:
            raise ValueError(f"Unsupported MJCF element <{elem.tag}>.")
        if unsupported:
            raise ValueError(
                f"Unsupported MJCF attributes on <{elem.tag}>: {', '.join(sorted(unsupported))}."
            )
        if elem.tag == "joint" and elem.get("type", "hinge") not in ("hinge", "slide"):
            raise ValueError("This runner supports hinge and slide joints.")
        if elem.tag == "option":
            dt = float(elem.get("timestep", "0.002"))
            if (
                not 0.0005 <= dt <= 0.02
                or not 1 <= int(elem.get("iterations", "100")) <= 200
            ):
                raise ValueError(
                    "Use a timestep of 0.0005–0.02 s and 1–200 iterations."
                )
    return root.get("model") or "untitled model"


def values(array):
    return [round(float(v), 6) for v in array]


def metadata(model, title, mj):
    nodes = [{"name": model.body(i).name or f"body{i}", "parent": int(model.body_parentid[i]) - 1}
             for i in range(1, model.nbody)]
    nodes.extend({"name": model.site(i).name or f"site{i}", "parent": int(model.site_bodyid[i]) - 1}
                 for i in range(model.nsite))
    hinges = [t == mj.mjtJoint.mjJNT_HINGE for t in model.jnt_type]
    joints = [{"name": model.joint(i).name or f"joint{i}", "unit": "rad" if hinges[i] else "m"}
              for i in range(model.njnt)]
    actuators = []
    for i in range(model.nu):
        joint = model.actuator_trnid[i, 0]
        unit = ""
        if model.actuator_trntype[i] == mj.mjtTrn.mjTRN_JOINT and 0 <= joint < model.njnt:
            if hinges[joint]:
                unit = "N·m"
            elif model.jnt_type[joint] == mj.mjtJoint.mjJNT_SLIDE:
                unit = "N"
        actuators.append({"name": model.actuator(i).name or f"actuator{i}", "unit": unit})
    geoms = [{"type": mj.mjtGeom(int(model.geom_type[i])).name.removeprefix("mjGEOM_").lower(),
              "body": int(model.geom_bodyid[i]) - 1, "pos": values(model.geom_pos[i]),
              "quat": values(model.geom_quat[i]), "size": values(model.geom_size[i])}
             for i in range(model.ngeom) if model.geom_rgba[i, 3] > 0]
    return {"title": title, "engine": mj.__version__, "dt": float(model.opt.timestep),
            "nodes": nodes, "joints": joints, "actuators": actuators, "geoms": geoms,
            "integrator": mj.mjtIntegrator(int(model.opt.integrator)).name.removeprefix("mjINT_")}


def sample(model, data):
    xyz = [values(p) for p in (*data.xpos[1:], *data.site_xpos)]
    return {"t": round(float(data.time), 9), "q": values(data.qpos), "v": values(data.qvel),
            "p": [[x, z] for x, _, z in xyz], "xyz": xyz, "quat": [values(q) for q in data.xquat[1:]],
            "actuatorForce": values(data.actuator_force * model.actuator_gear[:, 0]), "ctrl": values(data.ctrl)}


class Simulation:
    """One compiled model, independent state, and reproducible keyframe reset."""

    def __init__(self, raw):
        title = inspect_xml(raw)
        import mujoco as mj
        self.mj = mj
        model = self.model = mj.MjModel.from_xml_string(raw.decode("utf-8"))
        if model.nq > 12 or model.nbody + model.nsite > 32 or model.nu > 24:
            raise ValueError("Use at most 12 joint coordinates, 32 bodies plus sites and 24 actuators.")
        self.data = mj.MjData(model)
        self.dt = float(model.opt.timestep)
        self.meta = metadata(model, title, mj)
        self.reset()

    def reset(self):
        if self.model.nkey:
            self.mj.mj_resetDataKeyframe(self.model, self.data, 0)
        else:
            self.mj.mj_resetData(self.model, self.data)
        self.mj.mj_forward(self.model, self.data)

    def step(self, count):
        if not 1 <= count <= 4096:
            raise ValueError("Invalid step count.")
        self.mj.mj_step(self.model, self.data, nstep=count)
        self.mj.mj_forward(self.model, self.data)
        if any(w.number for w in self.data.warning):
            raise ValueError("MuJoCo reported an unstable model. Check the timestep and inertial values.")

    def sample(self):
        return sample(self.model, self.data)

def simulate(raw):
    sim = Simulation(raw)
    stride = max(1, round(0.025 / sim.dt))
    frames = [sim.sample()]
    for _ in range(math.floor(8 / (sim.dt * stride))):
        sim.step(stride)
        frames.append(sim.sample())
    return {**sim.meta, "frames": frames}

def write(message):
    print(json.dumps(message, allow_nan=False, separators=(",", ":")), flush=True)

def live():
    first = json.loads(sys.stdin.buffer.readline(256 * 1024))
    sim = Simulation(first["xml"].encode("utf-8"))
    write({**sim.meta, "frames":[sim.sample()]})
    if first.get("preview"):
        return
    for line in sys.stdin:
        cmd = json.loads(line)
        if cmd.get("reset"):
            sim.reset()
            write([sim.sample()])
            continue
        count, stride = cmd["count"], cmd["stride"]
        if not (1 <= count <= 128 and 1 <= stride <= 4096 and count * stride <= 4096):
            raise ValueError("Step batch exceeds its limit.")
        frames = []
        for _ in range(count):
            sim.step(stride)
            frames.append(sim.sample())
        write(frames)

if __name__ == "__main__":
    try:
        if "--live" in sys.argv:
            live()
        else:
            write(simulate(sys.stdin.buffer.read(65537)))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
