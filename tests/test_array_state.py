"""Bulk host math must preserve the independently implemented scalar law."""

import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from engine.array_state import energy_ledger_array, temperature_q_array
from engine.enthalpy import MAX_ENERGY_Q, ThermalMaterial, Thermodynamics, Transition
from engine.lint import lint_bulk_state
from engine.registry import DEFAULT_REGISTRY
from engine.state import thermal_view
from tests.enthalpy_cases import model as synthetic_model


class ArrayStateProperties(unittest.TestCase):
    def test_seeded_full_range_and_phase_boundaries_match_the_scalar_reference(self):
        rng = np.random.default_rng(293874)
        custom = Thermodynamics([ThermalMaterial(254, up=Transition(255, 1000)),
                                 ThermalMaterial(255, phase_energy_q=3000, down=Transition(254, 900))])
        for model in (DEFAULT_REGISTRY._model, synthetic_model(), custom):
            ids, energies = [], []
            for material in model.materials.values():
                probes = {material.chemical_energy_q, MAX_ENERGY_Q, material.phase_energy_q + material.chemical_energy_q,
                          min(MAX_ENERGY_Q, material.chemical_energy_q + 255 * 256),
                          min(MAX_ENERGY_Q, material.chemical_energy_q + 256 * 256)}
                for transition in (material.up, material.down):
                    if transition is not None:
                        for offset in (material.phase_energy_q, model.materials[transition.target].phase_energy_q):
                            boundary = material.chemical_energy_q + offset + transition.temperature_q
                            probes.update(value for value in (boundary - 1, boundary, boundary + 1)
                                          if material.chemical_energy_q <= value <= MAX_ENERGY_Q)
                probes.update(int(value) for value in rng.integers(material.chemical_energy_q, MAX_ENERGY_Q + 1, size=500))
                for energy in probes:
                    ids.append(material.id)
                    energies.append(energy)
            expected = [model.temperature_q(m, e) for m, e in zip(ids, energies)]
            np.testing.assert_array_equal(temperature_q_array(ids, energies, model), expected)
            self.assertEqual(energy_ledger_array(ids, energies, model), model.ledger(ids, energies))
            self.assertEqual(energy_ledger_array(ids, energies, model).total_q, sum(energies))

    def test_invalid_inputs_are_rejected_before_projection(self):
        model = DEFAULT_REGISTRY._model
        for ids, energies in (([], []), ([0], []), ([0, 0], [1]), ([True], [1]), ([0], [True]),
                              ([18], [1]), ([256], [1]), ([-1], [1]), ([0], [-1]), ([0], [MAX_ENERGY_Q + 1]),
                              ([0], [1.5]), ([[0]], [1]), ([7], [0]),
                              (np.array([2**32], dtype=np.uint64), [1]), ([0], np.array([2**32], dtype=np.uint64))):
            for function in (temperature_q_array, energy_ledger_array):
                with self.subTest(ids=ids, energies=energies, function=function.__name__), self.assertRaises(ValueError):
                    function(ids, energies, model)

    def test_fractional_and_saturated_views_keep_flags_kinetics_and_energy(self):
        model = DEFAULT_REGISTRY._model
        cells = np.array([0xabcdef09, 0xf7812202, 0x1fffff07], dtype=np.uint32)
        energies = np.array([0, 3840 + 100 * 256 + 17, MAX_ENERGY_Q], dtype=np.uint32)
        before_cells, before_energy = cells.copy(), energies.copy()
        expected = [(int(c) & 0xffff00ff) | (model.temperature_byte(int(c) & 255, int(e)) << 8) for c, e in zip(cells, energies)]
        view = thermal_view(cells, energies, model)
        np.testing.assert_array_equal(view, expected)
        np.testing.assert_array_equal(cells, before_cells)
        np.testing.assert_array_equal(energies, before_energy)
        view[:] = 0
        np.testing.assert_array_equal(cells, before_cells)

    def test_bulk_path_does_not_repeat_scalar_per_cell_validation(self):
        model = DEFAULT_REGISTRY._model
        ids = np.array([0, 1, 9] * 2048, dtype=np.uint32)
        energy = np.array([1, MAX_ENERGY_Q, 0] * 2048, dtype=np.uint32)
        expected = model.ledger(ids, energy)
        with patch.object(model, "temperature_q", side_effect=AssertionError("scalar cell loop")), \
             patch.object(model, "_energy", side_effect=AssertionError("scalar cell validation")):
            self.assertEqual(energy_ledger_array(ids, energy, model), expected)
            self.assertEqual(len(temperature_q_array(ids, energy, model)), len(ids))

    def test_unsigned_and_narrow_reduction_mutants_are_detected(self):
        source = (Path(__file__).resolve().parent.parent / "engine/array_state.py").read_text()
        model = DEFAULT_REGISTRY._model
        namespace = {"__name__": "bulk_mutant"}
        exec(compile(source.replace("np.int64", "np.uint32"), "bulk_mutant", "exec"), namespace)
        expected = temperature_q_array([9], [0], model)
        self.assertFalse(np.array_equal(namespace["temperature_q_array"]([9], [0], model), expected))
        narrow = {"__name__": "reduction_mutant"}
        exec(compile(source.replace("np.sum(energy, dtype=np.int64)", "np.sum(energy, dtype=np.uint32)"), "reduction_mutant", "exec"), narrow)
        self.assertNotEqual(narrow["energy_ledger_array"]([1] * 8, [MAX_ENERGY_Q] * 8, model).total_q, 8 * MAX_ENERGY_Q)
        self.assertEqual(lint_bulk_state(source, "array_state.py"), [])
        self.assertTrue(any("SS032" in error for error in lint_bulk_state(source.replace("np.int64", "np.uint32"), "mutant.py")))
        self.assertTrue(any("SS031" in error for error in lint_bulk_state(source.replace("dtype=np.int64", "dtype=np.uint32"), "mutant.py")))


if __name__ == "__main__":
    unittest.main()
