"""Static XML translation checks; no MuJoCo or simulation imports."""
import importlib.util
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location("collision_mujoco", Path(__file__).resolve().parents[1] / "scripts/collision-reference/mujoco_runner.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class CollisionModelTests(unittest.TestCase):
    def test_matching_geometry_inertia_and_explicit_flags(self):
        scene = {"id": "fixture", "gravity": [0, -9.8, 0], "friction": 0.2, "bodies": [
            {"id": "moving", "center": [1, 2, 3], "orientation": [0, 0, 0, 1],
             "halfExtents": [1, 2, 3], "mass": 6, "fixed": False},
            {"id": "wall", "center": [0, 0, 0], "orientation": [0, 0, 0, 1],
             "halfExtents": [0.001, 5, 5], "mass": 1, "fixed": True},
        ]}
        protocol = {"mujoco": {"integrator": "Euler", "solver": "Newton", "iterations": 100,
                                "tolerance": 1e-10, "solref": [0.002, 1], "solimp": [0.99, 0.99, 0.001]}}
        for enabled in (False, True):
            root = ET.fromstring(runner.model_xml(scene, 0.016, protocol, enabled))
            flag = root.find("option/flag")
            self.assertEqual(flag.get("speculative"), "enable" if enabled else "disable")
            self.assertEqual(flag.get("sleep"), "disable")
            self.assertEqual(flag.get("autoreset"), "disable")
            moving, wall = root.findall("worldbody/body")
            self.assertEqual(moving.find("inertial").get("diaginertia"), "26 20 10")
            self.assertEqual(moving.get("quat"), "1 0 0 0")
            self.assertIsNotNone(moving.find("freejoint"))
            self.assertIsNone(wall.find("freejoint"))
            self.assertEqual(root.find("default/geom").get("margin"), "0")


if __name__ == "__main__":
    unittest.main()
