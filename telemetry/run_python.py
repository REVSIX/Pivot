"""Run a Python file, embedding passive viewers when the script imports them."""

from importlib.machinery import PathFinder
import math
import os
from pathlib import Path
import runpy
import sys


class ViewerImports:
    def __init__(self, launch):
        self.launch = launch

    def find_spec(self, fullname, path=None, target=None):
        if fullname not in ("mujoco.viewer", "pivot_viewer"):
            return None
        spec = PathFinder.find_spec(fullname, path, target)
        if spec is None or spec.loader is None:
            return None
        if fullname == "pivot_viewer":
            sdk = Path(__file__).resolve().with_name("pivot_viewer.py")
            if not spec.origin or Path(spec.origin).resolve() != sdk:
                return None
        exec_module = spec.loader.exec_module

        def load(module):
            exec_module(module)
            module.launch_passive = self.launch_passive if fullname == "mujoco.viewer" else self.launch

        spec.loader.exec_module = load
        return spec

    def launch_passive(self, model, data, *, key_callback=None, show_left_ui=True, show_right_ui=True):
        if key_callback is not None:
            print("Pivot does not forward embedded viewer key callbacks.", file=sys.stderr)
        return self.launch(model, data)


def main():
    run = os.environ["PIVOT_EMBEDDED_RUN"]
    script = Path(sys.argv[1]).resolve(strict=True)
    try:
        hz = float(os.getenv("PIVOT_SIM_HZ", "20"))
        if not math.isfinite(hz) or not 1 <= hz <= 60:
            raise ValueError
    except ValueError:
        hz = 20

    viewer = None

    def launch(model, data, model_path=None):
        from run_embedded import EmbeddedViewer

        nonlocal viewer
        if viewer is not None and viewer.is_running():
            raise RuntimeError("Pivot embeds one passive viewer at a time.")
        viewer = EmbeddedViewer(model, data, model_path or script.stem, run, 1 / hz)
        return viewer

    finder = ViewerImports(launch)
    sys.meta_path.insert(0, finder)
    sys.argv = [str(script), *sys.argv[2:]]
    sys.path[0] = str(script.parent)
    try:
        runpy.run_path(str(script), run_name="__main__")
    finally:
        sys.meta_path.remove(finder)
        if viewer is not None:
            viewer.close()


if __name__ == "__main__":
    main()
