from pathlib import Path
import json
import unittest
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "simulator"))
from run import inspect_xml, simulate


class SimulationTest(unittest.TestCase):
    def test_reference_capture(self):
        result = simulate((ROOT / "examples/pendulum/pendulum.xml").read_bytes())
        recorded = json.loads(
            (ROOT / "client/public/pendulum.capture.json").read_text()
        )
        self.assertEqual(result["engine"], recorded["engine"])
        self.assertEqual(result["nodes"], recorded["nodes"])
        self.assertEqual(len(result["frames"]), len(recorded["frames"]))
        for frame, reference in zip(result["frames"], recorded["frames"]):
            self.assertEqual(frame["t"], reference["t"])
            for actual, expected in zip(
                frame["q"] + frame["v"], reference["q"] + reference["v"]
            ):
                self.assertAlmostEqual(actual, expected, places=4)
        self.assertNotEqual(result["frames"][0]["q"], result["frames"][10]["q"])

    def test_unsupported_inputs(self):
        for part in [
            '<include file="outside.xml"/>',
            "<extension/>",
            '<replicate count="99999"/>',
            "<asset/>",
            '<size memory="10G"/>',
            '<compiler assetdir="/"/>',
            '<option timestep="1e-12"/>',
            '<option iterations="99999999"/>',
            '<joint type="free"/>',
            "<!DOCTYPE x>",
            '<geom file="mesh.stl"/>',
        ]:
            with self.subTest(part=part), self.assertRaises(ValueError):
                inspect_xml(f"<mujoco>{part}</mujoco>".encode())
