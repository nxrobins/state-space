"""Causal pressure controls plus independent planner and native GPU evidence."""
import unittest

import numpy as np

from engine import DEFAULT_REGISTRY
from engine.compositor import CompositionEngine
from engine.pressure import pressure_loads, update_pressure
from engine.schema import VoxelState, pack_voxel
from engine.pressure_scenes import pressure_scene
from engine.state import seed_state
from engine.structure import plan_structure, validate_structure
from engine.structure_bulk import plan_structure_bulk
from engine.structure_compiled import plan_structure_compiled, validate_structure_compiled
from gpu_support import requires_gpu




class PressureProperties(unittest.TestCase):
    def test_fixture_identity_survives_json_worker_transport(self):
        import json
        from engine.conformance import conformance_cases
        from eval.policy import canonical
        fixtures = conformance_cases()
        self.assertEqual(canonical(fixtures), canonical(json.loads(canonical(fixtures))))

    def test_hydrostatic_depth_and_global_connection(self):
        rules = DEFAULT_REGISTRY._structure
        state = pressure_scene('dam')
        words = state[2]
        for _ in range(40):
            words = update_pressure(*state[:2], words, 24, 24, rules)
        self.assertEqual(int(words[2 * 24 + 1]) >> 16, 32)
        self.assertEqual(int(words[22 * 24 + 1]) >> 16, 21 * 32)
        # A 513-cell column proves there is no finite-radius planning cutoff.
        grid, energy = seed_state(np.full(513, pack_voxel(VoxelState(2, 35, 0, 0, 2, 0)), dtype=np.uint32), rules.thermal)
        words = np.zeros(513, dtype=np.uint32)
        for _ in range(40):
            words = update_pressure(grid, energy, words, 1, 513, rules)
        self.assertEqual(int(words[-1]) >> 16, 513 * 32)

    def test_opposing_pressures_cancel_and_overflow_is_bounded(self):
        p = np.array([65535 << 16, 0, 65535 << 16], dtype=np.uint32)
        self.assertEqual(pressure_loads(p, 3, 1)[1], 0)
        p[2] = 0
        self.assertEqual(pressure_loads(p, 3, 1)[1], 65535)
        grid, energy, words = pressure_scene('boiler')
        gas = ((grid >> 24) & 15) == 4
        from engine.state import thermal_view
        energy[gas] = 0x3fffffff
        grid = thermal_view(grid, energy, DEFAULT_REGISTRY._model)
        state = grid, energy, words
        a = plan_structure(*state, 24, 24, DEFAULT_REGISTRY._structure)
        b = plan_structure_compiled(*state, 24, 24, DEFAULT_REGISTRY._structure)
        np.testing.assert_array_equal(a.structure, b.structure)
        self.assertLessEqual(int(np.max(a.structure >> 16)), 65535)

    def test_dam_and_vessel_controls_and_independent_planners(self):
        rules = DEFAULT_REGISTRY._structure
        for kind in ('dam', 'boiler'):
            damaged = []
            for control in (False, True):
                state = pressure_scene(kind, control)
                initial_walls = (state[0] & 255) == ((5 if control else 7) if kind == 'dam' else 11)
                for _ in range(12):
                    a = plan_structure(*state, 24, 24, rules)
                    for b in (plan_structure_bulk(*state, 24, 24, rules), plan_structure_compiled(*state, 24, 24, rules)):
                        np.testing.assert_array_equal(a.structure, b.structure)
                        np.testing.assert_array_equal(a.sources, b.sources)
                    # Hold geometry to isolate pressure traction from gravity/motion.
                    sources_inverse = np.argsort(a.sources)
                    state = state[0], state[1], a.structure[sources_inverse]
                damaged.append(np.count_nonzero(initial_walls & ((state[2] & 255) == 0)))
            self.assertGreater(damaged[0], 0, kind)
            self.assertEqual(damaged[1], 0, kind)

    def test_invalid_pending_pressure_and_old_snapshot_fail_closed(self):
        state = pressure_scene('dam')
        solid = int(np.flatnonzero((state[0] & 255) == 1)[0])
        for bit in (1 << 13, 1 << 14, 1 << 15, 1 << 16):
            words = state[2].copy()
            words[solid] |= bit
            for validate in (validate_structure, validate_structure_compiled):
                with self.assertRaises(ValueError):
                    validate(*state[:2], words, 24, 24, DEFAULT_REGISTRY._structure)

    @requires_gpu
    def test_native_breach_flow_replay_and_energy(self):
        with CompositionEngine() as engine:
            for kind in ('dam', 'boiler'):
                state = pressure_scene(kind)
                result = engine.run(state[0], DEFAULT_REGISTRY.cold_table(), 24, 24, 16,
                                    initial_energy=state[1], initial_structure=state[2], trace_passes=True)
                self.assertEqual(sum(map(int, state[1])), sum(map(int, result['final_energy'])))
                self.assertTrue(any(np.any((grid >> 16) & 255) for _, pid, grid in result['pass_snapshots'] if pid == 'impulse'))
                self.assertTrue(any(np.any(words >> 16) for _, _, words in result['pass_structure_snapshots']))
                end = engine.run(result['final_grid'], DEFAULT_REGISTRY.cold_table(), 24, 24, 4,
                                 start_tick=16, initial_energy=result['final_energy'], initial_structure=result['final_structure'])
                whole = engine.run(state[0], DEFAULT_REGISTRY.cold_table(), 24, 24, 20, initial_energy=state[1], initial_structure=state[2])
                for name in ('final_grid', 'final_energy', 'final_structure'):
                    np.testing.assert_array_equal(end[name], whole[name])
                material = 7 if kind == 'dam' else 11
                broken = ((whole['final_grid'] & 255) == material) & ((whole['final_structure'] & 255) == 0)
                self.assertGreater(np.count_nonzero(broken), 0, kind)
                if kind == 'dam':
                    self.assertGreater(np.count_nonzero((whole['final_grid'].reshape(24, 24)[:, 13:] & 255) == 2), 0)
                control = pressure_scene(kind, True)
                held = engine.run(control[0], DEFAULT_REGISTRY.cold_table(), 24, 24, 20,
                                  initial_energy=control[1], initial_structure=control[2])
                control_material = 5 if kind == 'dam' else 11
                self.assertFalse(np.any(((held['final_grid'] & 255) == control_material) & ((held['final_structure'] & 255) == 0)), kind)

    @requires_gpu
    def test_executed_pressure_noop_and_impulse_noop_are_detected(self):
        from unittest.mock import patch
        from engine.sources import ShaderBundle
        state = pressure_scene('boiler')
        rules = DEFAULT_REGISTRY._structure
        # Removing pressure eliminates damage in the otherwise identical cold wall.
        with patch('engine.structure.update_pressure', side_effect=lambda c, e, w, *_args: w.copy()):
            words = state[2]
            for _ in range(12):
                plan = plan_structure(*state[:2], words, 24, 24, rules)
                words = plan.structure[np.argsort(plan.sources)]
            glass = (state[0] & 255) == 11
            self.assertTrue(np.all((words[glass] & 255) == 255))
        # Execute a compiled no-op impulse, not merely a string-level assertion.
        source = '@compute @workgroup_size(16, 16) fn tick(@builtin(global_invocation_id) gid: vec3<u32>) { if (gid.x >= GRID_WIDTH || gid.y >= GRID_HEIGHT) { return; } let i = gid.y * GRID_WIDTH + gid.x; io_copy(i, i); }'
        bundle = ShaderBundle.load().replace_kernel('phase_2f_impulse.wgsl', source)
        with CompositionEngine() as correct, CompositionEngine(sources=bundle) as mutant:
            args = dict(initial_grid=state[0], cold_table=DEFAULT_REGISTRY.cold_table(), grid_width=24, grid_height=24,
                        n_ticks=8, initial_energy=state[1], initial_structure=state[2])
            expected = correct.run(**args)
            wrong = mutant.run(**args)
            self.assertFalse(np.array_equal(expected['final_grid'], wrong['final_grid']))
