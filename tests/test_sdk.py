"""Native SDK and extension boundaries, including reproduced C4 failures."""

import copy
from contextlib import ExitStack
import json
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from engine import DEFAULT_REGISTRY, MaterialRegistry, Snapshot, create_field
from engine.compositor import CompositionEngine
from engine.state import seed_state
from engine.structure_bulk import seed_structure_bulk
from engine.lint import lint_runtime, lint_example_html


def example_registry():
    return DEFAULT_REGISTRY.extend(json.loads(Path("examples/sdk/materials.json").read_text()))


class RegistryProperties(unittest.TestCase):
    def test_registry_is_order_independent_and_isolated_from_callers(self):
        catalog = example_registry().to_dict()
        registry = MaterialRegistry(catalog)
        reordered = copy.deepcopy(catalog)
        reordered["materials"].reverse()
        self.assertEqual(registry.hash, MaterialRegistry(reordered).hash)
        catalog["materials"][-1]["properties"]["density"] = 0
        exported = registry.to_dict()
        exported["materials"][0]["name"] = "changed"
        cold = registry.cold_table()
        cold.fill(0)
        self.assertEqual(registry.hash, MaterialRegistry(registry.to_dict()).hash)
        self.assertNotEqual(int(registry.cold_table()[255 * 24]), 0)
        with self.assertRaises(TypeError):
            registry.material(18)["properties"]["conductivity"] = 0
        with self.assertRaises(AttributeError):
            registry.hash = "wrong"

    def test_schema_two_ids_cannot_be_reused(self):
        for mid in range(18):
            catalog = DEFAULT_REGISTRY.to_dict()
            catalog["materials"][mid]["name"] = "reused_identity"
            with self.subTest(mid=mid), self.assertRaises(ValueError):
                MaterialRegistry(catalog)

    def test_invalid_extension_graphs_are_rejected(self):
        registry = example_registry()
        for mid, name, value in [(18, "melts_into", 254), (18, "latent_heat_melt", 0),
                                 (19, "freezes_into", 5), (19, "freeze_point", 80),
                                 (19, "fuel_energy", 1), (20, "smoke_product", 20),
                                 (255, "conductivity", 0.5), (255, "density", True)]:
            catalog = registry.to_dict()
            next(record for record in catalog["materials"] if record["id"] == mid)["properties"][name] = value
            with self.subTest(mid=mid, name=name), self.assertRaises(ValueError):
                MaterialRegistry(catalog)

    def test_snapshots_cannot_be_made_writable_and_require_the_same_registry(self):
        registry = example_registry()
        grid, energy = seed_state([18], registry._model)
        saved = Snapshot(1, 1, 0, grid, energy, seed_structure_bulk(grid, 1, 1, registry._structure), registry=registry)
        for array in (saved.packed_cells, saved.energy_q, saved.structure):
            with self.assertRaises(ValueError):
                array.flags.writeable = True
        transported = json.loads(json.dumps(saved.to_dict()))
        self.assertEqual(Snapshot.from_dict(transported, registry=registry).to_dict(), transported)
        with self.assertRaises(ValueError):
            Snapshot.from_dict(dict(transported, materialCatalogHash=None), registry=registry)
        with self.assertRaises(ValueError):
            Snapshot.from_dict(transported)
        changed = registry.to_dict()
        changed["materials"][18]["properties"]["conductivity"] -= 1
        with self.assertRaises(ValueError):
            Snapshot.from_dict(transported, registry=MaterialRegistry(changed))

    def test_runtime_prevention_rules_have_negative_controls(self):
        for source, rule in [("from engine.generate import catalog_hash", "SS018"),
                             ("root = Path(__file__).parent.parent", "SS017")]:
            self.assertTrue(any(rule in issue for issue in lint_runtime(source, "engine/field.py")))
        source = Path("engine/compositor.py").read_text()
        self.assertEqual(lint_runtime(source, "engine/compositor.py"), [])
        for mutant in [source.replace("resources.callback(buffer.destroy)", "pass"),
                       source.replace("keep(self.device.create_buffer(size=count * 8, usage=wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_DST))",
                                      "self.device.create_buffer(size=count * 8, usage=wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_DST)")]:
            self.assertNotEqual(mutant, source)
            self.assertTrue(any("SS019" in issue for issue in lint_runtime(mutant, "engine/compositor.py")))
        mutant = source.replace('        pipelines = {}', '        self.pipelines = {}')
        self.assertNotEqual(mutant, source)
        self.assertTrue(any("SS022" in issue for issue in lint_runtime(mutant, "engine/compositor.py")))
        self.assertTrue(lint_example_html('<script type="module" src="./browser.mjs"></script>'))
        self.assertFalse(lint_example_html('<script type="module" src="./browser.js"></script>'))


class NativeFieldProperties(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = CompositionEngine()
        cls.registry = example_registry()

    @classmethod
    def tearDownClass(cls):
        cls.engine.close()

    def test_custom_phase_family_and_fractional_replay(self):
        with create_field(1, 1, 18, registry=self.registry, engine=self.engine) as field:
            field.set_energy(0, 0, 120 * 256 + 17)
            report = field.step(3, inspect=True)
            self.assertEqual(field.sample(0, 0)["material"], 19)
            self.assertEqual(field.energy_q[0], 120 * 256 + 17)
            self.assertEqual(len(report), 54)
            self.assertTrue(any(change.before_packed & 255 == 18 and change.after_packed & 255 == 19 for item in report for change in item.changes))
            self.assertTrue(all(item.before.total_q == item.after.total_q for item in report))
            saved = field.snapshot()
            field.step(5)
            final = field.snapshot().to_dict()
            field.restore(saved)
            field.step(5)
            self.assertEqual(field.snapshot().to_dict(), final)
            field.set_energy(0, 0, 55 * 256 + 11)
            field.step(1)
            self.assertEqual(field.sample(0, 0)["material"], 18)
            self.assertEqual(field.energy_balance().drift_q, 0)

    def test_edits_restore_validation_and_borrowed_lifecycle(self):
        field = create_field(3, 5, registry=self.registry, engine=self.engine)
        field.paint_circle(1, 1, 0, 255, 20, 15)
        field.step(4)
        self.assertGreater(int(np.flatnonzero((field.grid & 255) == 255)[0]), 4)
        field.set_cell(0, 0, 20, 150)
        field.step(2)
        self.assertNotIn(20, field.grid & 255)
        before = field.snapshot().to_dict()
        for invalid in [dict(before, energyQ=[]), dict(before, materialCatalogHash=DEFAULT_REGISTRY.hash), dict(before, width=5, height=3)]:
            with self.assertRaises(ValueError):
                field.restore(invalid)
            self.assertEqual(field.snapshot().to_dict(), before)
        with self.assertRaises(ValueError):
            field.set_energy(0, 0, -1)
        with self.assertRaises(ValueError):
            field.set_cell(100, 100, 254)
        with self.assertRaises(ValueError):
            field.sample(1e300, 0)
        field.grid.fill(0)
        field.energy_q.fill(0)
        self.assertEqual(field.snapshot().to_dict(), before)
        self.assertEqual(field.energy_balance().drift_q, 0)
        field.close()
        field.close()
        with self.assertRaises(RuntimeError):
            field.step()
        self.assertEqual(field.snapshot().to_dict(), before)
        # Closing a borrowed field must not destroy its owner's device.
        with create_field(1, 1, engine=self.engine) as next_field:
            next_field.step()

    def test_cold_table_cannot_disagree_with_explicit_registry(self):
        cold = self.registry.cold_table()
        cold[18 * 24 + 1] -= 1
        with self.assertRaises(ValueError):
            self.engine.run([18], cold, 1, 1, 1, registry=self.registry)

    def test_allocated_buffers_are_destroyed_when_dispatch_setup_fails(self):
        resources = []
        destroyed = []
        spies = ExitStack()
        original_empty = self.engine.device.create_buffer
        original_data = self.engine.device.create_buffer_with_data
        def capture_empty(*args, **kwargs):
            buffer = original_empty(*args, **kwargs)
            resources.append(buffer)
            destroyed.append(spies.enter_context(patch.object(buffer, "destroy", wraps=buffer.destroy)))
            return buffer
        def capture_data(*args, **kwargs):
            buffer = original_data(*args, **kwargs)
            if buffer not in resources:
                resources.append(buffer)
                destroyed.append(spies.enter_context(patch.object(buffer, "destroy", wraps=buffer.destroy)))
            return buffer
        with spies, patch.object(self.engine.device, "create_buffer", side_effect=capture_empty), \
             patch.object(self.engine.device, "create_buffer_with_data", side_effect=capture_data), \
             patch.object(self.engine.device, "create_bind_group", side_effect=RuntimeError("injected allocation follow-up failure")):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                self.engine.run([0], DEFAULT_REGISTRY.cold_table(), 1, 1, 1)
        self.assertEqual(len(resources), 8)
        for call in destroyed:
            call.assert_called_once_with()

    def test_failed_recompilation_preserves_the_previous_world(self):
        self.engine._compile_pipelines(1, 1)
        previous = dict(self.engine.pipelines)
        with patch.object(self.engine.device, "create_shader_module", side_effect=RuntimeError("injected compiler failure")):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                self.engine._compile_pipelines(2, 1)
        self.assertEqual(self.engine.pipelines, previous)
        with create_field(1, 1, engine=self.engine) as world:
            world.step()
            self.assertEqual(world.tick, 1)

    def test_incomplete_inspection_is_rejected_without_committing_state(self):
        with create_field(1, 1, engine=self.engine) as world:
            saved = world.snapshot().to_dict()
            result = self.engine.run(world.grid, DEFAULT_REGISTRY.cold_table(), 1, 1, 1, initial_energy=world.energy_q, trace_passes=True)
            result["pass_energy_snapshots"].pop()
            with patch.object(self.engine, "run", return_value=result):
                with self.assertRaisesRegex(RuntimeError, "Incomplete"):
                    world.step(inspect=True)
            self.assertEqual(world.snapshot().to_dict(), saved)

    def test_clear_allocation_failure_preserves_both_arrays_and_accounting(self):
        with create_field(1, 1, 18, registry=self.registry, engine=self.engine) as world:
            before = world.snapshot().to_dict()
            balance = world.energy_balance()
            with patch("engine.field.np.full", side_effect=[np.zeros(1, dtype=np.uint32), MemoryError("injected")]):
                with self.assertRaises(MemoryError):
                    world.clear()
            self.assertEqual(world.snapshot().to_dict(), before)
            self.assertEqual(world.energy_balance(), balance)


if __name__ == "__main__":
    unittest.main()
