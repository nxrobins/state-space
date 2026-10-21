"""Cached GPU allocations must never cache a caller's physical state."""
import unittest
import weakref
from unittest.mock import patch

import numpy as np

from engine import create_field, MaterialRenderer
from engine.compositor import CompositionEngine
from tests.gpu_support import requires_gpu


@requires_gpu
class GpuWorkspaceReuse(unittest.TestCase):
    def test_close_retires_owned_devices_without_invalidating_another_field(self):
        with create_field(3, 3) as active:
            active.set_cell(1, 0, 3)
            closed = create_field(3, 3)
            renderer = MaterialRenderer(3, 3, output_size=(12, 12))
            renderer.render(closed)
            physics_device = weakref.ref(closed._engine.device)
            render_device = weakref.ref(renderer.device)
            closed.close()
            renderer.close()
            self.assertIsNone(physics_device())
            self.assertIsNone(render_device())
            closed.close()
            renderer.close()
            with self.assertRaises(RuntimeError):
                renderer.render(active)
            active.step(3)
            self.assertEqual(active.energy_balance().drift_q, 0)

    def test_shared_engine_edits_inspection_and_shape_changes(self):
        with CompositionEngine() as engine, create_field(9, 7, engine=engine) as a, create_field(9, 7, engine=engine) as b:
            a.set_cell(4, 0, 3)
            a.set_cell(4, 5, 2)
            b.set_cell(3, 0, 5)
            initial = a.snapshot().to_dict()
            a.step(4)
            expected = a.snapshot().to_dict()
            cached = engine._workspace_cache
            a.restore(initial)
            a.step(1)
            b.step(3)
            a.step(3, inspect=True)
            self.assertEqual(a.snapshot().to_dict(), expected)
            self.assertIs(engine._workspace_cache, cached)
            # A different shape with the same count needs its own pipeline layout.
            with create_field(7, 9, engine=engine) as other:
                other.set_cell(3, 0, 3)
                other.step(2)
            self.assertIsNot(engine._workspace_cache, cached)
            a.restore(initial)
            a.step(4)
            self.assertEqual(a.snapshot().to_dict(), expected)
            self.assertEqual(a.energy_balance().drift_q, 0)

    def test_failed_cached_readback_is_atomic_and_retry_overwrites_scratch(self):
        with create_field(9, 7) as world:
            world.set_cell(4, 0, 3)
            world.step(1)
            committed = world.snapshot().to_dict()
            world.step(3)
            expected = world.snapshot().to_dict()
            world.restore(committed)
            staging = world._engine._workspace_cache['staging']
            original = type(staging).read_mapped
            calls = 0

            def corrupt(buffer, *args, **kwargs):
                nonlocal calls
                data = original(buffer, *args, **kwargs)
                if buffer is staging:
                    calls += 1
                    if calls == 2:
                        bad = np.frombuffer(data, dtype=np.uint32).copy()
                        bad[2 * 63] |= 8192
                        return bad.tobytes()
                return data

            with patch.object(type(staging), 'read_mapped', corrupt):
                with self.assertRaises(ValueError):
                    world.step(3)
            self.assertEqual(calls, 2)
            self.assertEqual(world.snapshot().to_dict(), committed)
            world.step(3)
            self.assertEqual(world.snapshot().to_dict(), expected)

            world.restore(committed)
            cached = world._engine._workspace_cache
            original_map = type(cached['staging']).map_sync
            def fail_after_mapping(buffer, *args, **kwargs):
                original_map(buffer, *args, **kwargs)
                raise RuntimeError('injected mapped-buffer failure')
            with patch.object(type(cached['staging']), 'map_sync', fail_after_mapping):
                with self.assertRaises(RuntimeError):
                    world.step(3)
            self.assertIsNone(world._engine._workspace_cache)
            self.assertEqual(world.snapshot().to_dict(), committed)
            world.step(3)
            self.assertEqual(world.snapshot().to_dict(), expected)
