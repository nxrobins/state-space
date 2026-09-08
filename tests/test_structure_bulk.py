"""Optimized structural arithmetic must preserve every scalar result."""

from pathlib import Path
import types
import unittest

import numpy as np

from engine.lint import lint_structure
from engine.structure import FRESH, BOND_BITS, normalize_bonds, plan_structure
from engine.structure_bulk import normalize_bonds_bulk, plan_structure_bulk
from engine.structure_conformance import corpus
from tests.test_structure import rules, scene


class BulkStructureProperties(unittest.TestCase):
    def assert_plan_equal(self, a, b):
        for name in ("sources", "structure", "loads", "capacities", "reactions", "distances"):
            np.testing.assert_array_equal(getattr(a, name), getattr(b, name), err_msg=name)
        self.assertEqual(a.components, b.components)
        self.assertEqual(a.supported_weight, b.supported_weight)

    def test_all_corpus_steps_match_scalar_reference(self):
        compared = 0
        for case, model in corpus():
            state = tuple(np.array(case[key], dtype=np.uint32) for key in ("cells", "energyQ", "structure"))
            for _ in range(case["ticks"]):
                reference = plan_structure(*state, case["width"], case["height"], model)
                bulk = plan_structure_bulk(*state, case["width"], case["height"], model)
                self.assert_plan_equal(reference, bulk)
                state = bulk.apply(*state, width=case["width"], height=case["height"])
                compared += 1
        self.assertEqual(compared, 101)

    def test_fresh_normalization_and_boundary_flags_match_on_seeded_shapes(self):
        rng = np.random.default_rng(67721)
        for width, height in ((1, 1), (1, 37), (37, 1), (7, 13), (33, 17)):
            model = rules()
            for _ in range(8):
                placements = [(x, y, int(rng.choice([0, 2, 5, 7, 8]))) for y in range(height) for x in range(width)]
                cells, _, words = scene(width, height, placements, model)
                words |= rng.choice(np.array([0, FRESH, *BOND_BITS], dtype=np.uint32), size=len(words))
                words &= rng.integers(0, 16384, size=len(words), dtype=np.uint32)
                np.testing.assert_array_equal(normalize_bonds_bulk(cells, words, width, height, model),
                                              normalize_bonds(cells, words, width, height, model))

    def test_long_snake_keeps_global_support_and_one_component(self):
        width, height = 41, 45
        placements = [(x, y, 5) for y in range(0, 43, 2) for x in range(width)]
        placements += [(width - 1 if y // 2 % 2 == 0 else 0, y, 5) for y in range(1, 43, 2)]
        model = rules()
        state = scene(width, height, placements, model, anchors=(0,))
        reference = plan_structure(*state, width, height, model)
        bulk = plan_structure_bulk(*state, width, height, model)
        self.assert_plan_equal(reference, bulk)
        self.assertGreater(int(bulk.distances.max()), 900)
        self.assertEqual(len(bulk.components), 1)
        self.assertFalse(bulk.components[0].moving)

    def test_invalid_state_is_rejected_and_full_input_is_unmodified(self):
        model = rules()
        state = scene(5, 3, [(3, 0, 5), (4, 0, 5)], model)
        before = tuple(array.copy() for array in state)
        plan_structure_bulk(*state, 5, 3, model)
        for old, current in zip(before, state):
            np.testing.assert_array_equal(old, current)
        for coordinate, index, value in ((0, 0, 253), (1, 0, 0xffffffff), (2, 3, FRESH), (2, 4, 255), (2, 0, 255)):
            changed = [array.copy() for array in state]
            changed[coordinate][index] = value
            with self.assertRaises(ValueError):
                plan_structure_bulk(*changed, 5, 3, model)

    def test_executed_fancy_index_scatter_loses_shared_load_and_is_rejected(self):
        source = (Path(__file__).resolve().parent.parent / "engine/structure_bulk.py").read_text()
        before = "np.add.at(loads, candidates[valid], contributions[valid])"
        after = "loads[candidates[valid]] += contributions[valid]"
        self.assertIn(before, source)
        mutant = source.replace(before, after)
        module = types.ModuleType("structure_bulk_mutant")
        exec(compile(mutant, "structure_bulk_mutant", "exec"), module.__dict__)
        model = rules()
        state = scene(3, 3, [(x, 1, 5) for x in range(3)], model, anchors=(4,))
        self.assertEqual(plan_structure_bulk(*state, 3, 3, model).reactions[4], 12)
        with self.assertRaisesRegex(RuntimeError, "balance"):
            module.plan_structure_bulk(*state, 3, 3, model)
        self.assertEqual(lint_structure(source, "structure_bulk.py"), [])
        self.assertTrue(any(issue.startswith("SS037") for issue in lint_structure(mutant, "structure_bulk.py")))


if __name__ == "__main__":
    unittest.main()
