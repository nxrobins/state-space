"""Production ca-v3 API, complete-state transport and executed regression controls."""

import copy
import unittest
from unittest.mock import patch

import numpy as np

from engine import DEFAULT_REGISTRY, create_field
from engine.compositor import CompositionEngine, InvalidCompletedState
from engine.sources import ShaderBundle
from engine.structure import ANCHOR, BOND_BITS, FRESH
from engine.lint import lint_wgsl
from engine.catalog import load_catalog
from engine.generate import constants


class StructuralIntegrationProperties(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = CompositionEngine()

    @classmethod
    def tearDownClass(cls):
        cls.engine.close()

    def field(self, width, height, material=0):
        world = create_field(width, height, material, engine=self.engine)
        self.addCleanup(world.close)
        return world

    def test_break_repair_weld_pin_and_cooling_preserve_explicit_history(self):
        world = self.field(3, 1, 5)
        world.set_anchor(1, 0)
        world.set_integrity(1, 0, 0)
        self.assertEqual(world.structure.tolist(), [255, ANCHOR, 255])
        energy = world.energy_q.copy()
        world.set_energy(1, 0, 0)
        world.step(4)
        self.assertEqual(world.sample(1, 0)["integrity"], 0)
        world.set_integrity(1, 0, 255)
        self.assertEqual(world.structure.tolist(), [255, ANCHOR | 255, 255])
        world.step(4)
        self.assertEqual(world.sample(1, 0)["bonds"], 0)
        world.set_integrity(1, 0, 255, weld=True)
        self.assertEqual(world.structure.tolist(), [255 | BOND_BITS[1], ANCHOR | 255 | BOND_BITS[0] | BOND_BITS[1], 255 | BOND_BITS[0]])
        world.set_anchor(1, 0, False)
        self.assertFalse(world.sample(1, 0)["anchored"])
        self.assertEqual(world.energy_balance().drift_q, 0)
        self.assertEqual(world.energy_ledger().total_q, int(energy.sum()) - int(energy[1]))

    def test_melting_discards_pins_and_solidification_creates_fresh_reciprocal_bonds(self):
        world = self.field(3, 1, 5)
        world.set_anchor(1, 0)
        for x in range(3):
            world.set_energy(x, 0, 800 * 256)
        world.step()
        self.assertEqual((world.grid & 255).tolist(), [16, 16, 16])
        self.assertEqual(world.structure.tolist(), [0, 0, 0])
        for x in range(3):
            world.set_energy(x, 0, 35 * 256)
        reports = world.step(inspect=True)
        self.assertEqual((world.grid & 255).tolist(), [5, 5, 5])
        self.assertEqual(world.structure.tolist(), [767, 1023, 511])
        self.assertFalse(np.any(world.structure & (FRESH | ANCHOR)))
        self.assertEqual(reports[-1].pass_id, "normalize")
        self.assertTrue(reports[-1].changes)
        self.assertEqual(world.energy_balance().drift_q, 0)

    def test_structure_only_damage_is_inspected_and_restored_exactly(self):
        world = self.field(1, 1, 7)
        world.set_anchor(0, 0)
        world.set_integrity(0, 0, 1)
        before = world.snapshot().to_dict()
        reports = world.step(inspect=True)
        change = reports[0].changes[0]
        self.assertEqual(change.before_packed, change.after_packed)
        self.assertEqual(change.before_energy_q, change.after_energy_q)
        self.assertEqual((change.before_structure, change.after_structure), (ANCHOR | 1, ANCHOR))
        self.assertEqual(reports[0].structure.loads.tolist(), [2])
        self.assertEqual(reports[0].structure.capacities.tolist(), [1])
        after = world.snapshot().to_dict()
        world.restore(before)
        world.step()
        self.assertEqual(world.snapshot().to_dict(), after)
        world.structure.fill(0)
        self.assertEqual(world.snapshot().to_dict(), after)

    def test_incomplete_invalid_and_legacy_structural_snapshots_reject_atomically(self):
        world = self.field(2, 1, 5)
        before = world.snapshot().to_dict()
        invalid = []
        missing = copy.deepcopy(before)
        del missing["structure"]
        invalid.append(missing)
        invalid.append({**before, "schemaVersion": 2, "rulesVersion": "ca-v2"})
        for words in ([], [255, 511], [FRESH | 767, 511], [-1, 511], [0xffffffff, 511], [767.0, 511]):
            invalid.append({**before, "structure": words})
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                world.restore(value)
            self.assertEqual(world.snapshot().to_dict(), before)
        for edit in (lambda: world.set_integrity(0, 0, True), lambda: world.set_integrity(0, 0, 300),
                     lambda: world.set_integrity(0, 0, 10, weld=1), lambda: world.set_anchor(0, 0, 1)):
            with self.assertRaises(ValueError):
                edit()
            self.assertEqual(world.snapshot().to_dict(), before)
        with patch.object(self.engine, "_compile_pipelines", side_effect=AssertionError("compiled invalid continuation")):
            with self.assertRaises(ValueError):
                self.engine.run(world.grid, DEFAULT_REGISTRY.cold_table(), 2, 1, 1, start_tick=1, initial_energy=world.energy_q)

    def test_failed_gpu_step_does_not_commit_part_of_the_structural_state(self):
        world = self.field(3, 3, 5)
        before = world.snapshot().to_dict()
        with patch.object(self.engine.device.queue, "read_buffer", side_effect=RuntimeError("readback failed")):
            with self.assertRaisesRegex(RuntimeError, "readback failed"):
                world.step()
        self.assertEqual(world.snapshot().to_dict(), before)
        world.step()
        self.assertEqual(world.tick, 1)

    def test_compiled_mutant_moves_a_broken_pin_when_destination_guard_is_missing(self):
        world = self.field(1, 4)
        world.set_cell(0, 1, 5)
        world.set_cell(0, 2, 7)
        world.set_cell(0, 3, 1)
        world.set_integrity(0, 1, 0)
        world.set_integrity(0, 2, 0)
        world.set_anchor(0, 2)
        before = world.snapshot().to_dict()
        world.step()
        self.assertEqual(world.grid.tolist(), before["packedCells"])
        bundle = ShaderBundle.load()
        source = bundle.shader("state_io.wgsl")
        mutant = source.replace(" && !io_bound(destination)", "")
        self.assertNotEqual(source, mutant)
        bad = ShaderBundle(bundle.kernels, tuple((key, mutant if key == "state_io.wgsl" else value) for key, value in bundle.shaders))
        with CompositionEngine(sources=bad) as engine, create_field(1, 4, engine=engine) as field:
            field.restore(before)
            field.step()
            self.assertNotEqual(field.grid.tolist(), before["packedCells"])
            self.assertTrue(field.sample(0, 1)["anchored"])
        self.assertTrue(any("SS040" in issue for issue in lint_wgsl(mutant, "state_io.wgsl", constants(load_catalog()))))

    def test_compiled_mutant_drops_damage_without_changing_material_or_energy(self):
        world = self.field(1, 1, 7)
        world.set_integrity(0, 0, 1)
        before = world.snapshot().to_dict()
        world.step()
        self.assertEqual(world.structure.tolist(), [0])
        bundle = ShaderBundle.load()
        source = bundle.shader("state_io.wgsl")
        mutant = source.replace("structure_out[index] = structural_plan[index].y;", "structure_out[index] = structure_in[source];")
        self.assertNotEqual(source, mutant)
        bad = ShaderBundle(bundle.kernels, tuple((key, mutant if key == "state_io.wgsl" else value) for key, value in bundle.shaders))
        with CompositionEngine(sources=bad) as engine, create_field(1, 1, engine=engine) as field:
            field.restore(before)
            field.step()
            self.assertEqual(field.grid.tolist(), world.grid.tolist())
            self.assertEqual(field.energy_q.tolist(), world.energy_q.tolist())
            self.assertEqual(field.structure.tolist(), [1])
        self.assertTrue(any("SS035" in issue for issue in lint_wgsl(mutant, "state_io.wgsl", constants(load_catalog()))))

    def test_invalid_completed_gpu_output_retains_evidence_without_committing(self):
        bundle = ShaderBundle.load()
        source = bundle.kernel("phase_2e_normalize.wgsl")
        mutant = source.replace("io_normalize_structure(gid.y * GRID_WIDTH + gid.x);", "let index = gid.y * GRID_WIDTH + gid.x; io_copy(index, index);")
        self.assertNotEqual(source, mutant)
        with CompositionEngine(sources=bundle.replace_kernel("phase_2e_normalize.wgsl", mutant)) as engine, create_field(1, 1, 2, engine=engine) as field:
            field.set_energy(0, 0, 0)
            before = field.snapshot().to_dict()
            with self.assertRaises(InvalidCompletedState) as captured:
                field.step()
            failure = captured.exception
            self.assertEqual(failure.tick, 0)
            self.assertEqual(int(failure.state[0][0]) & 255, 8)
            self.assertTrue(failure.state[2][0] & FRESH)
            with self.assertRaises(ValueError):
                failure.state[2][0] = 0
            self.assertEqual(field.snapshot().to_dict(), before)


if __name__ == "__main__":
    unittest.main()
