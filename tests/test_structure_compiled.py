"""The compiled global solver must preserve complete independent planner results."""
import unittest

import numpy as np

from engine.structure import plan_structure
from engine.structure_compiled import plan_structure_compiled, validate_structure_compiled, _ledger_validated, _solver
from engine.structure_bulk import validate_structure_bulk, seed_structure_bulk
from engine.registry import DEFAULT_REGISTRY
from engine.state import thermal_view
from engine.enthalpy import MAX_ENERGY_Q
from engine.array_state import energy_ledger_array
from engine.structure_conformance import corpus
from tests.test_structure import rules, scene


class CompiledStructureProperties(unittest.TestCase):
    def compare(self, state, width, height, model):
        reference = plan_structure(*state, width, height, model)
        checked = validate_structure_compiled(*state, width, height, model)
        for a, b in zip(checked, validate_structure_bulk(*state, width, height, model)):
            np.testing.assert_array_equal(a, b)
        self.assertEqual(_ledger_validated(*checked, width, height, model), energy_ledger_array(state[0] & 255, state[1], model.thermal))
        actual = plan_structure_compiled(*state, width, height, model)
        for name in ("sources", "structure", "loads", "capacities", "reactions", "distances"):
            np.testing.assert_array_equal(getattr(actual, name), getattr(reference, name), err_msg=name)
        self.assertEqual(actual.components, reference.components)
        self.assertEqual(actual.supported_weight, reference.supported_weight)
        for a, b in zip(actual.apply(*state, width=width, height=height), reference.apply(*state, width=width, height=height)):
            np.testing.assert_array_equal(a, b)
        return actual

    def test_all_101_corpus_steps_match_complete_scalar_diagnostics(self):
        for case, model in corpus():
            state = tuple(np.array(case[key], dtype=np.uint32) for key in ("cells", "energyQ", "structure"))
            for _ in range(case["ticks"]):
                plan = self.compare(state, case["width"], case["height"], model)
                state = plan.apply(*state, width=case["width"], height=case["height"])

    def test_long_snake_and_dense_support_have_no_local_horizon(self):
        width, height = 41, 45
        placements = [(x, y, 5) for y in range(0, 43, 2) for x in range(width)]
        placements += [(width - 1 if y // 2 % 2 == 0 else 0, y, 5) for y in range(1, 43, 2)]
        model = rules()
        state = scene(width, height, placements, model, anchors=(0,))
        actual = self.compare(state, width, height, model)
        self.assertGreater(int(actual.distances.max()), 900)
        state = scene(33, 35, [(x, y, 5) for y in range(35) for x in range(33)], model)
        self.compare(state, 33, 35, model)

    def test_seeded_damage_contact_anchors_and_tiny_shapes(self):
        rng = np.random.default_rng(20261010)
        for width, height in ((1, 1), (1, 37), (37, 1), (7, 13), (33, 17)):
            for repeat in range(6):
                model = rules(cohesion=1 if repeat % 2 else 255, softening=12 if repeat % 3 else 0)
                placements = [(x, y, int(rng.choice([0, 1, 2, 3, 5, 7, 8]))) for y in range(height) for x in range(width)]
                state = scene(width, height, placements, model)
                self.compare(state, width, height, model)

    def test_rejects_invalid_state_and_does_not_alias_previous_plans(self):
        model = rules()
        state = scene(5, 3, [(3, 0, 5), (4, 0, 5)], model)
        plan = self.compare(state, 5, 3, model)
        saved = plan.sources.copy()
        self.compare(scene(41, 45, [(0, 0, 5)], model), 41, 45, model)
        np.testing.assert_array_equal(plan.sources, saved)
        for coordinate, index, value in ((0, 0, 253), (1, 0, 0xffffffff), (2, 3, 8192), (2, 4, 255)):
            changed = [a.copy() for a in state]
            changed[coordinate][index] = value
            with self.assertRaises(ValueError):
                plan_structure_compiled(*changed, 5, 3, model)

    def test_compiled_validation_and_accounting_cover_full_energy_range(self):
        rng = np.random.default_rng(293874)
        model = DEFAULT_REGISTRY._model
        ids, energies = [], []
        for material in model.materials.values():
            probes = {material.chemical_energy_q, MAX_ENERGY_Q, material.phase_energy_q + material.chemical_energy_q}
            for transition in (material.up, material.down):
                if transition is not None:
                    boundary = material.chemical_energy_q + material.phase_energy_q + transition.temperature_q
                    probes.update(value for value in (boundary - 1, boundary, boundary + 1) if material.chemical_energy_q <= value <= MAX_ENERGY_Q)
            probes.update(int(value) for value in rng.integers(material.chemical_energy_q, MAX_ENERGY_Q + 1, size=100))
            for energy in probes:
                ids.append(material.id)
                energies.append(energy)
        energy = np.array(energies, dtype=np.uint32)
        cells = thermal_view(np.array(ids, dtype=np.uint32), energy, model)
        rules = DEFAULT_REGISTRY._structure
        words = seed_structure_bulk(cells, len(cells), 1, rules)
        state = validate_structure_compiled(cells, energy, words, len(cells), 1, rules)
        self.assertEqual(_ledger_validated(*state, len(cells), 1, rules), model.ledger(ids, energies))
        self.assertGreater(sum(energies), 2**32)
        for coordinate, value in ((0, 253), (0, int(cells[0]) ^ 256), (1, MAX_ENERGY_Q + 1), (2, 8192), (2, 256)):
            corrupt = [a.copy() for a in state]
            corrupt[coordinate][0] = value
            with self.assertRaises(ValueError):
                validate_structure_compiled(*corrupt, len(cells), 1, rules)
        # Probe reserved bits, one-sided bonds, damage, phase changes and views.
        for _ in range(100):
            corrupt = [a.copy() for a in state]
            coordinate = int(rng.integers(3))
            index = int(rng.integers(len(cells)))
            corrupt[coordinate][index] ^= np.uint32(1 << int(rng.integers(32)))
            outcomes = []
            for validator in (validate_structure_compiled, validate_structure_bulk):
                try:
                    validator(*corrupt, len(cells), 1, rules)
                    outcomes.append(True)
                except ValueError:
                    outcomes.append(False)
            self.assertEqual(outcomes[0], outcomes[1])

    def test_private_tables_do_not_reuse_a_physical_column(self):
        rules = DEFAULT_REGISTRY._structure
        cells = thermal_view(np.array([5, 1, 0], dtype=np.uint32), np.full(3, 20 * 256, dtype=np.uint32), DEFAULT_REGISTRY._model)
        words = seed_structure_bulk(cells, 3, 1, rules)
        validate_structure_compiled(cells, np.full(3, 20 * 256, dtype=np.uint32), words, 3, 1, rules)
        tables = _solver().tables
        cold = tables[:256 * 24].reshape(256, 24)
        expected = DEFAULT_REGISTRY.cold_table().reshape(256, 24)
        # Only density, cohesion and softening are copied; no column is a marker.
        self.assertTrue(np.array_equal(cold[:, [0, 22, 23]], expected[:, [0, 22, 23]]))
        self.assertFalse(np.any(np.delete(cold, [0, 22, 23], axis=1)))
        marker = tables[256 * 24:].reshape(256, 12)[:, 0]
        self.assertEqual(set(np.flatnonzero(marker).tolist()), set(DEFAULT_REGISTRY.material_ids))


if __name__ == "__main__":
    unittest.main()
