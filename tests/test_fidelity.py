"""Production ca-v2 checks: complete state, coupled behavior, and strict replay."""

import unittest
from pathlib import Path

import numpy as np

from engine.catalog import load_catalog
from engine.compositor import CompositionEngine
from engine.contracts import Snapshot
from engine.enthalpy import ENERGY_SCALE as Q, MAX_ENERGY_Q
from engine.generate import constants
from engine.lint import lint_wgsl
from engine.schema import (DEFAULT_PHASES, MAT_AIR, MAT_FIRE, MAT_ICE, MAT_LAVA, MAT_METAL, MAT_MOLTEN_METAL,
                           MAT_OIL, MAT_OIL_VAPOR, MAT_SAND, MAT_SMOKE, MAT_STEAM, MAT_STONE, MAT_WATER,
                           VoxelState, build_cold_table_buffer, pack_voxel)
from engine.state import seed_state, thermal_view, thermodynamics_from_cold


def packed(material, thermal, flags=0):
    return pack_voxel(VoxelState(material, thermal, -3, 7, DEFAULT_PHASES[material], flags))


class ProductionFidelity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = CompositionEngine()
        cls.cold = build_cold_table_buffer()
        cls.model = thermodynamics_from_cold(cls.cold)

    def check_budget(self, result):
        budget = sum(int(e) for e in result["initial_energy"])
        self.assertEqual(sum(int(e) for e in result["final_energy"]), budget)
        self.assertEqual(result["energy_ledger"].total_q, budget)
        for _, _, energy in result["pass_energy_snapshots"]:
            self.assertEqual(sum(int(e) for e in energy), budget)
        for _, energy in result["energy_snapshots"]:
            self.assertEqual(sum(int(e) for e in energy), budget)

    def test_native_baseline_counterexamples_now_have_exact_budgets(self):
        for width, height, cells in (
            (2, 1, [packed(MAT_LAVA, 250), packed(MAT_AIR, 20)]),
            (3, 3, [packed(MAT_METAL, 0 if i == 4 else 255) for i in range(9)]),
            (1, 1, [packed(MAT_ICE, 35)]),
            (1, 1, [packed(MAT_OIL, 90)]),
        ):
            result = self.engine.run(cells, self.cold, width, height, 32, trace_passes=True)
            self.check_budget(result)
        self.assertEqual(int(result["final_grid"][0]) & 255, MAT_OIL)
        self.assertEqual(result["energy_ledger"].chemical_q, 150 * Q)

    def test_full_temperature_drives_gas_buoyancy_above_display_limit(self):
        grid = np.array([packed(MAT_SMOKE, 255, 8), packed(MAT_SMOKE, 255, 15)], dtype=np.uint32)
        energy = np.array([300 * Q + 11, 600 * Q + 13], dtype=np.uint32)
        result = self.engine.run(grid, self.cold, 1, 2, 1, initial_energy=energy, trace_passes=True)
        trace = {name: state for _, name, state in result["pass_snapshots"]}
        energies = {name: values for _, name, values in result["pass_energy_snapshots"]}
        np.testing.assert_array_equal(trace["gas_buoyancy0"], grid[::-1])
        np.testing.assert_array_equal(energies["gas_buoyancy0"], energy[::-1])
        self.check_budget(result)

    def test_phase_families_and_latent_energy_survive_native_roundtrips(self):
        for original, target, hot_energy, cold_energy in ((MAT_ICE, MAT_WATER, 45 * Q, 25 * Q),
                (MAT_WATER, MAT_STEAM, 155 * Q, 105 * Q),
                (MAT_OIL, MAT_OIL_VAPOR, 260 * Q, 220 * Q),
                (MAT_METAL, MAT_MOLTEN_METAL, 265 * Q, 220 * Q)):
            grid = thermal_view([packed(original, 20, 15)], [hot_energy], self.model)
            hot = self.engine.run(grid, self.cold, 1, 1, 8, initial_energy=[hot_energy])
            self.assertEqual(int(hot["final_grid"][0]) & 255, target)
            self.check_budget(hot)
            cooled = thermal_view(hot["final_grid"], [cold_energy], self.model)
            cold = self.engine.run(cooled, self.cold, 1, 1, 8, initial_energy=[cold_energy], initial_structure=hot["final_structure"], start_tick=8)
            self.assertEqual(int(cold["final_grid"][0]) & 255, original)
            self.assertEqual(int(cold["final_grid"][0]) & 0xf0ff0000, int(grid[0]) & 0xf0ff0000)
            self.check_budget(cold)

    def test_fire_contact_heats_existing_water_without_creating_more_water(self):
        result = self.engine.run([packed(MAT_FIRE, 255), packed(MAT_WATER, 25)], self.cold, 1, 2, 512, snapshot_interval=32)
        materials = [int(v) & 255 for v in result["final_grid"]]
        self.assertEqual(sum(m in (MAT_ICE, MAT_WATER, MAT_STEAM) for m in materials), 1)
        self.assertIn(MAT_SMOKE, materials)
        self.assertIn(MAT_STEAM, materials)
        self.check_budget(result)

    def test_long_flow_keeps_every_cell_and_energy_with_fractional_restart(self):
        width, height = 17, 19
        cells = np.full(width * height, packed(MAT_AIR, 60), dtype=np.uint32)
        cells[-width:] = packed(MAT_STONE, 60)
        for y in range(2, 7):
            for x in range(6, 11):
                cells[y * width + x] = packed(MAT_WATER if (x + y) % 2 else MAT_SAND, 60, x % 16)
        grid, energy = seed_state(cells, self.model)
        energy += np.arange(energy.size, dtype=np.uint32) % 17
        grid = thermal_view(grid, energy, self.model)
        whole = self.engine.run(grid, self.cold, width, height, 1024, initial_energy=energy, snapshot_interval=128)
        first = self.engine.run(grid, self.cold, width, height, 317, initial_energy=energy)
        snapshot = Snapshot(width, height, 317, first["final_grid"], first["final_energy"], first["final_structure"])
        resumed = Snapshot.from_dict(snapshot.to_dict())
        tail = self.engine.run(resumed.packed_cells, self.cold, width, height, 707, start_tick=resumed.tick, initial_energy=resumed.energy_q, initial_structure=resumed.structure)
        np.testing.assert_array_equal(whole["final_grid"], tail["final_grid"])
        np.testing.assert_array_equal(whole["final_energy"], tail["final_energy"])
        np.testing.assert_array_equal(whole["final_structure"], tail["final_structure"])
        np.testing.assert_array_equal(np.bincount(cells & 255, minlength=256), np.bincount(whole["final_grid"] & 255, minlength=256))
        source_rows = np.flatnonzero((cells & 255) == MAT_SAND) // width
        final_rows = np.flatnonzero((whole["final_grid"] & 255) == MAT_SAND) // width
        self.assertGreater(float(final_rows.mean()), float(source_rows.mean()) + 5)
        self.check_budget(whole)

    def test_incomplete_or_inconsistent_state_cannot_resume(self):
        grid, energy = seed_state([packed(MAT_OIL, 50)])
        for bad in ([], [0], [MAX_ENERGY_Q + 1], [float(energy[0])], [int(energy[0]) + Q]):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                Snapshot(1, 1, 5, grid, bad, [0])
        with self.assertRaises(ValueError):
            self.engine.run(grid, self.cold, 1, 1, 1, start_tick=5)
        with self.assertRaises(ValueError):
            Snapshot.from_dict({"schemaVersion": 1})

    def test_transport_lint_rejects_half_state_and_wrong_source_writes(self):
        values = constants(load_catalog())
        self.assertTrue(any("SS014" in e for e in lint_wgsl("grid_out[i] = grid_in[j];", "locked/phase_2b_winner.wgsl", values)))
        source = Path("engine/shaders/state_io.wgsl").read_text()
        self.assertEqual(lint_wgsl(source, "state_io.wgsl", values), [])
        mutant = source.replace("energy_out[destination] = energy_in[source]", "energy_out[destination] = energy_in[destination]")
        self.assertTrue(any("SS015" in e for e in lint_wgsl(mutant, "state_io.wgsl", values)))
        mutant = source.replace("structure_out[destination] = structure_in[source];", "")
        self.assertTrue(any("SS015" in e for e in lint_wgsl(mutant, "state_io.wgsl", values)))


if __name__ == "__main__":
    unittest.main()
