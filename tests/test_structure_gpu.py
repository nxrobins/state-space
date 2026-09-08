"""The C6 transport kernel must carry all three coordinates, including damage."""

import unittest
from unittest.mock import patch

import numpy as np

from engine.resources import shader_source
from engine.structure import plan_structure
from engine.structure_gpu import StructuralGPUProbe
from tests.test_structure import rules, scene


class StructuralGPUProperties(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gpu = StructuralGPUProbe()

    @classmethod
    def tearDownClass(cls):
        cls.gpu.close()

    def test_native_gpu_matches_planned_transport_on_tiny_odd_and_workgroup_edges(self):
        rng = np.random.default_rng(2311)
        for width, height in ((1, 1), (1, 11), (13, 1), (7, 5), (17, 19), (33, 17)):
            for weak in (False, True):
                model = rules(cohesion=1 if weak else 255)
                placements = [(x, y, int(rng.choice([0, 2, 3, 5, 7]))) for y in range(height) for x in range(width)]
                cells, energy, words = scene(width, height, placements, model)
                plan = plan_structure(cells, energy, words, width, height, model)
                expected = plan.apply(cells, energy, words, width=width, height=height)
                actual = self.gpu.apply(plan, cells, energy, words, width, height)
                repeated = self.gpu.apply(plan, cells, energy, words, width, height)
                for reference, result, replay in zip(expected, actual, repeated):
                    np.testing.assert_array_equal(reference, result)
                    np.testing.assert_array_equal(result, replay)

    def test_actual_gpu_mutants_cannot_drop_motion_energy_or_damage(self):
        source = shader_source("structure_apply.wgsl")
        model = rules(cohesion=1)
        width, height = 8, 8
        cells, energy, words = scene(width, height, [(x, 1, 5) for x in range(1, 6)] + [(5, 4, 5)], model, anchors=(width + 1,))
        plan = plan_structure(cells, energy, words, width, height, model)
        expected = plan.apply(cells, energy, words, width=width, height=height)
        mutants = (source.replace("packed_in[source]", "packed_in[index]"),
                   source.replace("energy_in[source]", "energy_in[index]"),
                   source.replace("structural_plan[index].y", "structure_in[source]"))
        for coordinate, mutant in enumerate(mutants):
            actual = self.gpu.apply(plan, cells, energy, words, width, height, source=mutant)
            self.assertFalse(np.array_equal(actual[coordinate], expected[coordinate]))

    def test_stale_plan_rejected_before_gpu_compilation(self):
        model = rules()
        cells, energy, words = scene(3, 5, [(1, 1, 5)], model)
        plan = plan_structure(cells, energy, words, 3, 5, model)
        energy[4] += 1
        with patch.object(self.gpu.device, "create_shader_module", side_effect=AssertionError("compiled invalid input")):
            with self.assertRaisesRegex(ValueError, "input changed"):
                self.gpu.apply(plan, cells, energy, words, 3, 5)

    def test_changed_geometry_rejected_before_gpu_compilation(self):
        model = rules()
        state = scene(5, 3, [(3, 0, 5), (4, 0, 5)], model)
        plan = plan_structure(*state, 5, 3, model)
        with patch.object(self.gpu.device, "create_shader_module", side_effect=AssertionError("compiled invalid geometry")):
            with self.assertRaisesRegex(ValueError, "dimensions changed"):
                self.gpu.apply(plan, *state, 3, 5)


if __name__ == "__main__":
    unittest.main()
