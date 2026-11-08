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
    "worldbody": "",
    "body": "name pos quat euler axisangle",
    "joint": "name type axis pos damping stiffness armature range limited ref",
    "geom": "name type pos quat euler size fromto mass density rgba friction contype conaffinity",
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
    if len(raw) > 65536 or b"<!" in raw or b"\x00" in raw:
        raise ValueError(
            "Use a UTF-8 model under 64 KiB without declarations or entities."
        )
    root = ET.fromstring(raw.decode("utf-8"))
    elements = list(root.iter())
    if root.tag != "mujoco" or len(elements) > 120:
        raise ValueError(
            "Expected an articulated MJCF model with at most 120 elements."
        )
    for elem in elements:
        if elem.tag not in FIELDS or set(elem.attrib) - set(FIELDS[elem.tag].split()):
            raise ValueError(
                f"Unsupported element or attribute on <{elem.tag}>. See the MJCF subset in README."
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


def simulate(raw):
    title = inspect_xml(raw)
    import mujoco as mj

    model = mj.MjModel.from_xml_string(raw.decode("utf-8"))
    if not 1 <= model.nq <= 12 or model.nbody + model.nsite > 32:
        raise ValueError("Use 1–12 joint coordinates and up to 32 bodies plus sites.")
    data = mj.MjData(model)
    if model.nkey:
        mj.mj_resetDataKeyframe(model, data, 0)
    mj.mj_forward(model, data)
    nodes = [
        {
            "name": model.body(i).name or f"body{i}",
            "parent": int(model.body_parentid[i]) - 1,
        }
        for i in range(1, model.nbody)
    ]
    nodes += [
        {
            "name": model.site(i).name or f"site{i}",
            "parent": int(model.site_bodyid[i]) - 1,
        }
        for i in range(model.nsite)
    ]
    joints = [
        {
            "name": model.joint(i).name or f"joint{i}",
            "unit": "rad" if model.jnt_type[i] == mj.mjtJoint.mjJNT_HINGE else "m",
        }
        for i in range(model.njnt)
    ]
    frames = []
    dt = float(model.opt.timestep)
    stride = max(1, round(0.025 / dt))
    for index in range(math.floor(8 / (dt * stride)) + 1):
        if index:
            mj.mj_step(model, data, nstep=stride)
            mj.mj_forward(model, data)
        if any(w.number for w in data.warning):
            raise ValueError(
                "MuJoCo reported an unstable model. Check the timestep and inertial values."
            )
        positions = [*data.xpos[1:], *data.site_xpos]
        frames.append(
            {
                "t": round(float(data.time), 6),
                "q": values(data.qpos),
                "v": values(data.qvel),
                "p": [values([p[0], p[2]]) for p in positions],
            }
        )
    return {
        "title": title,
        "engine": mj.__version__,
        "dt": dt,
        "nodes": nodes,
        "joints": joints,
        "integrator": mj.mjtIntegrator(int(model.opt.integrator)).name.removeprefix(
            "mjINT_"
        ),
        "frames": frames,
    }


if __name__ == "__main__":
    try:
        print(
            json.dumps(
                simulate(sys.stdin.buffer.read(65537)),
                allow_nan=False,
                separators=(",", ":"),
            )
        )
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
