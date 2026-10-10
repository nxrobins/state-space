"""Actual GPU behavior at the API boundary; no mocked dispatches."""

import unittest
from unittest.mock import patch

import numpy as np

from engine.compositor import CompositionEngine
from engine.state import seed_state
from engine.schema import (DEFAULT_PHASES, DEFAULT_THERMALS, MAT_AIR, MAT_SAND, MAT_WATER,
                           VoxelState, build_cold_table_buffer, pack_voxel)


class GpuContractProperties(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = CompositionEngine()
        cls.cold = build_cold_table_buffer()

    def test_zero_steps_is_identity_with_finite_timing(self):
        grid, energy = seed_state(np.array([0xffff_ff0e], dtype=np.uint32))
        result = self.engine.run(grid, self.cold, 1, 1, n_ticks=0, initial_energy=energy)
        np.testing.assert_array_equal(result["final_grid"], grid)
        self.assertEqual(result["mean_tick_ms"], 0.0)
        self.assertEqual(result["end_tick"], 0)

    def test_chunked_runs_preserve_absolute_tick_schedule(self):
        # Seed 4 is a reproduced counterexample: resetting tick changes four cells.
        rng = np.random.default_rng(4)
        mats = rng.choice([MAT_AIR, MAT_WATER, MAT_SAND], size=7 * 5)
        grid = np.array([pack_voxel(VoxelState(int(mat), DEFAULT_THERMALS[mat], 0, 0, DEFAULT_PHASES[mat], 0)) for mat in mats], dtype=np.uint32)
        whole = self.engine.run(grid, self.cold, 7, 5, n_ticks=7)
        first = self.engine.run(grid, self.cold, 7, 5, n_ticks=3)
        tail = self.engine.run(first["final_grid"], self.cold, 7, 5, n_ticks=4, start_tick=first["end_tick"], snapshot_interval=1, initial_energy=first["final_energy"], initial_structure=first["final_structure"])
        reset = self.engine.run(first["final_grid"], self.cold, 7, 5, n_ticks=4)
        self.assertFalse(np.array_equal(reset["final_grid"], whole["final_grid"]))
        np.testing.assert_array_equal(tail["final_grid"], whole["final_grid"])
        np.testing.assert_array_equal(tail["final_energy"], whole["final_energy"])
        np.testing.assert_array_equal(tail["final_structure"], whole["final_structure"])
        self.assertEqual([tick for tick, _ in tail["snapshots"]], [4, 5, 6, 7])

    def test_batched_readback_matches_every_tick_of_inspected_reference(self):
        rng = np.random.default_rng(20261010)
        mats = rng.choice([0, 1, 2, 3, 5, 7, 8, 9], size=17 * 19)
        grid = np.array([pack_voxel(VoxelState(int(m), DEFAULT_THERMALS[m], 0, 0, DEFAULT_PHASES[m], 0)) for m in mats], dtype=np.uint32)
        with patch.object(self.engine.device, "create_bind_group", wraps=self.engine.device.create_bind_group) as groups:
            normal = self.engine.run(grid, self.cold, 17, 19, n_ticks=4, snapshot_interval=1)
        self.assertEqual(groups.call_count, 2)
        inspected = self.engine.run(grid, self.cold, 17, 19, n_ticks=4, snapshot_interval=1, trace_passes=True)
        self.assertEqual(normal["readback_count"], 4)
        self.assertEqual(inspected["readback_count"], 4 * 18)
        for key in ("snapshots", "energy_snapshots", "structure_snapshots"):
            for (tick, a), (other, b) in zip(normal[key], inspected[key]):
                self.assertEqual(tick, other)
                np.testing.assert_array_equal(a, b)


if __name__ == "__main__":
    unittest.main()
