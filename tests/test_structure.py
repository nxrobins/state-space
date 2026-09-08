"""C6 planner properties; public/backend migration is a separate acceptance gate."""

import unittest
from dataclasses import FrozenInstanceError
from pathlib import Path
import types
import sys

import numpy as np

from engine.enthalpy import Thermodynamics, ThermalMaterial
from engine.registry import DEFAULT_REGISTRY
from engine.schema import VoxelState, pack_voxel
from engine.state import seed_state, thermal_view
from engine.lint import lint_structure, lint_scenario_identity, lint_wgsl, lint_runtime, lint_checkpoint_outputs
from engine.catalog import load_catalog
from engine.generate import constants
from engine.structure import (ANCHOR, BOND_BITS, FRESH, INTEGRITY_MASK, StructuralMaterial, StructuralRules,
                              normalize_bonds, plan_structure, seed_structure, validate_structure)


def rules(cohesion=255, softening=0):
    rows = []
    for record in DEFAULT_REGISTRY.to_dict()["materials"]:
        properties = record["properties"]
        solid = properties["default_phase"] in (0, 6)
        rows.append(StructuralMaterial(record["id"], properties["density"], cohesion if solid else 0, softening if solid else 0))
    return StructuralRules(rows, DEFAULT_REGISTRY._model)


def scene(width, height, placements, model, *, anchors=()):
    cells = np.array([pack_voxel(VoxelState(0, 20, index % 16 - 8, index // 16 % 16 - 8, 4, index % 16))
                      for index in range(width * height)], dtype=np.uint32)
    for x, y, material in placements:
        phase = DEFAULT_REGISTRY.material(material)["properties"]["default_phase"]
        cells[y * width + x] = pack_voxel(VoxelState(material, 20, x % 16 - 8, y % 16 - 8, phase, (x + y) % 16))
    cells, energy = seed_state(cells, model.thermal)
    energy += np.arange(len(cells), dtype=np.uint32) % 128
    cells = thermal_view(cells, energy, model.thermal)
    return cells, energy, seed_structure(cells, width, height, model, anchors=anchors)


class StructureProperties(unittest.TestCase):
    def test_supported_beam_stays_level_and_reactions_balance(self):
        model = rules()
        placements = [(x, 6, 1) for x in range(9)] + [(x, y, 1) for x in (1, 7) for y in range(3, 6)] + [(x, 2, 5) for x in range(1, 8)]
        cells, energy, words = scene(9, 7, placements, model)
        result = plan_structure(cells, energy, words, 9, 7, model)
        np.testing.assert_array_equal(result.sources, np.arange(63))
        np.testing.assert_array_equal(result.structure, words)
        self.assertEqual(sum(int(v) for v in result.reactions), result.supported_weight)
        self.assertTrue(all(not component.moving for component in result.components))

    def test_floating_plate_translates_coherently_with_exact_permutation(self):
        model = rules()
        cells, energy, words = scene(9, 7, [(x, y, 5) for y in (1, 2) for x in (2, 3, 4)], model)
        result = plan_structure(cells, energy, words, 9, 7, model)
        output, energies, structure = result.apply(cells, energy, words, width=9, height=7)
        metal = set(int(i) for i in np.flatnonzero((cells & 255) == 5))
        self.assertEqual(set(int(i) for i in np.flatnonzero((output & 255) == 5)), {index + 9 for index in metal})
        for index in metal:
            self.assertEqual(int(output[index + 9]), int(cells[index]))
            self.assertEqual(int(energies[index + 9]), int(energy[index]))
            self.assertEqual(int(structure[index + 9]), int(words[index]))
        np.testing.assert_array_equal(np.sort(result.sources), np.arange(len(cells)))
        self.assertEqual(sum(int(e) for e in energies), sum(int(e) for e in energy))
        self.assertEqual(len(result.components), 1)
        self.assertTrue(result.components[0].moving)

    def test_long_support_paths_have_no_local_iteration_horizon(self):
        width = 515
        model = rules()
        cells, energy, words = scene(width, 3, [(x, 1, 5) for x in range(1, width - 1)], model,
                                     anchors=(width + 1, 2 * width - 2))
        result = plan_structure(cells, energy, words, width, 3, model)
        self.assertGreater(int(result.distances.max()), 250)
        self.assertTrue(all(not component.moving for component in result.components))
        self.assertEqual(int(result.reactions.sum()), result.supported_weight)
        self.assertTrue(np.all((result.structure[cells & 255 == 5] & INTEGRITY_MASK) == 255))

    def test_contact_support_does_not_weld_separate_bodies(self):
        model = rules()
        cells, energy, words = scene(3, 5, [(1, 1, 5), (1, 2, 5)], model)
        words[:] = np.where((cells & 255) == 5, 255, 0)
        free = plan_structure(cells, energy, words, 3, 5, model)
        self.assertEqual(len(free.components), 2)
        self.assertTrue(all(component.moving for component in free.components))
        self.assertTrue(np.all((free.structure & sum(BOND_BITS)) == 0))
        words[7] |= ANCHOR
        resting = plan_structure(cells, energy, words, 3, 5, model)
        self.assertEqual(len(resting.components), 2)
        self.assertTrue(all(not component.moving for component in resting.components))
        self.assertEqual(int(resting.loads[7]), 8)
        np.testing.assert_array_equal(resting.sources, np.arange(15))

    def test_overload_accumulates_damage_then_releases_a_fragment(self):
        model = rules(cohesion=1)
        width, height = 8, 8
        cells, energy, words = scene(width, height, [(x, 1, 5) for x in range(1, 6)], model, anchors=(width + 1,))
        first = plan_structure(cells, energy, words, width, height, model)
        self.assertGreater(int(first.structure[width + 1]) & 255, 0)
        self.assertLess(int(first.structure[width + 1]) & 255, 255)
        self.assertEqual(first.sources[width + 1], width + 1)
        broken = False
        for _ in range(12):
            plan = plan_structure(cells, energy, words, width, height, model)
            cells, energy, words = plan.apply(cells, energy, words, width=width, height=height)
            if words[width + 1] & 255 == 0:
                broken = True
                self.assertEqual(int(words[width + 1]) & sum(BOND_BITS), 0)
                self.assertTrue(any(component.moving for component in plan.components))
                break
        self.assertTrue(broken)
        self.assertEqual(int(cells[width + 1]) & 255, 5)
        self.assertTrue(int(words[width + 1]) & ANCHOR)

    def test_heat_weakening_uses_full_temperature_beyond_display_saturation(self):
        thermal = Thermodynamics([ThermalMaterial(0), ThermalMaterial(1)])
        model = StructuralRules([StructuralMaterial(0, 0), StructuralMaterial(1, 255, 200, 250)], thermal)
        cold_cell = np.array([pack_voxel(VoxelState(1, 255, 0, 0, 0, 0))], dtype=np.uint32)
        low = np.array([260 * 256], dtype=np.uint32)
        high = np.array([320 * 256], dtype=np.uint32)
        words = seed_structure(cold_cell, 1, 1, model)
        a = plan_structure(cold_cell, low, words, 1, 1, model)
        b = plan_structure(cold_cell, high, words, 1, 1, model)
        self.assertGreater(int(a.capacities[0]), 0)
        self.assertEqual(int(b.capacities[0]), 0)
        self.assertEqual(int(b.structure[0]) & 255, 0)
        self.assertEqual(b.apply(cold_cell, high, words, width=1, height=1)[1][0], high[0])

    def test_fragmented_columns_displace_each_fluid_cell_once(self):
        model = rules()
        # One connected C-shaped body contains separated runs in its left column.
        placements = [(1, 1, 5), (2, 1, 5), (2, 2, 5), (1, 3, 5), (2, 3, 5), (1, 2, 2), (1, 4, 6)]
        cells, energy, words = scene(5, 7, placements, model)
        plan = plan_structure(cells, energy, words, 5, 7, model)
        output, energies, _ = plan.apply(cells, energy, words, width=5, height=7)
        self.assertEqual(int(plan.sources[6]), 11)
        self.assertEqual(int(plan.sources[16]), 21)
        np.testing.assert_array_equal(np.bincount(output & 255, minlength=256), np.bincount(cells & 255, minlength=256))
        self.assertEqual(sum(int(v) for v in energies), sum(int(v) for v in energy))

    def test_seeded_mixed_worlds_preserve_bonds_counts_energy_and_determinism(self):
        rng = np.random.default_rng(76021)
        model = rules()
        for width, height in ((1, 1), (1, 11), (13, 1), (7, 5), (17, 19)):
            for seed in range(3):
                placements = [(x, y, int(rng.choice([0, 2, 3, 5, 7]))) for y in range(height) for x in range(width)]
                cells, energy, words = scene(width, height, placements, model)
                if seed == 1:
                    # Remove all bonds without changing intact per-cell material.
                    words &= np.uint32(INTEGRITY_MASK | ANCHOR)
                before = (cells.copy(), energy.copy(), words.copy())
                a = plan_structure(cells, energy, words, width, height, model)
                b = plan_structure(cells, energy, words, width, height, model)
                np.testing.assert_array_equal(a.sources, b.sources)
                np.testing.assert_array_equal(a.structure, b.structure)
                result = a.apply(cells, energy, words, width=width, height=height)
                validate_structure(*result, width, height, model)
                np.testing.assert_array_equal(np.sort(a.sources), np.arange(width * height))
                self.assertEqual(sum(int(e) for e in result[1]), sum(int(e) for e in energy))
                self.assertEqual(int(a.reactions.sum()), a.supported_weight)
                for original, current in zip(before, (cells, energy, words)):
                    np.testing.assert_array_equal(original, current)

    def test_malformed_state_and_aliases_are_rejected(self):
        model = rules()
        cells, energy, words = scene(3, 3, [(1, 1, 5), (2, 1, 5)], model)
        for index, value in ((4, int(words[4]) | FRESH), (0, 255), (4, 0xffffffff), (5, 255)):
            bad = words.copy()
            bad[index] = value
            with self.assertRaises(ValueError):
                plan_structure(cells, energy, bad, 3, 3, model)
        plan = plan_structure(cells, energy, words, 3, 3, model)
        with self.assertRaises(ValueError):
            plan.sources.flags.writeable = True
        with self.assertRaises(ValueError):
            plan.structure[0] = 1
        with self.assertRaises(FrozenInstanceError):
            plan.supported_weight = 4

    def test_only_explicit_fresh_requests_weld_neighbors(self):
        model = rules()
        cells, _, words = scene(3, 2, [(0, 0, 5), (1, 0, 5)], model)
        words[:] = np.where((cells & 255) == 5, 255, 0)
        np.testing.assert_array_equal(normalize_bonds(cells, words, 3, 2, model), words)
        words[0] |= FRESH
        welded = normalize_bonds(cells, words, 3, 2, model)
        self.assertTrue(welded[0] & BOND_BITS[1])
        self.assertTrue(welded[1] & BOND_BITS[0])
        self.assertFalse(np.any(welded & FRESH))

    def test_interlocking_dependency_cycle_moves_or_blocks_as_a_whole(self):
        model = rules()
        width, height = 6, 7
        a = {(1, 1), (2, 1), (3, 1), (1, 2), (1, 3), (2, 3)}
        b = {(2, 2), (3, 2), (3, 3), (3, 4)}
        cells, energy, words = scene(width, height, [(x, y, 5) for x, y in a | b], model)
        owners = {y * width + x: int((x, y) in b) for x, y in a | b}
        for index, owner in owners.items():
            for direction, offset in enumerate((-1, 1, -width, width)):
                if index + offset in owners and owners[index + offset] != owner:
                    words[index] &= np.uint32(0xffffffff ^ BOND_BITS[direction])
        free = plan_structure(cells, energy, words, width, height, model)
        self.assertEqual(len(free.components), 2)
        self.assertTrue(all(component.moving for component in free.components))
        for index in owners:
            self.assertEqual(int(free.sources[index + width]), index)
        words[width + 1] |= ANCHOR
        blocked = plan_structure(cells, energy, words, width, height, model)
        self.assertTrue(all(not component.moving for component in blocked.components))
        np.testing.assert_array_equal(blocked.sources, np.arange(width * height))

    def test_plans_reject_changes_to_any_input_coordinate(self):
        model = rules()
        cells, energy, words = scene(3, 5, [(1, 1, 5)], model)
        plan = plan_structure(cells, energy, words, 3, 5, model)
        for coordinate in range(3):
            changed = [cells.copy(), energy.copy(), words.copy()]
            changed[coordinate][4] ^= np.uint32(1)
            with self.assertRaisesRegex(ValueError, "input changed"):
                plan.apply(*changed, width=3, height=5)
        with self.assertRaises(FrozenInstanceError):
            model.materials = {}

    def test_plan_rejects_equal_cell_count_with_different_geometry(self):
        model = rules()
        state = scene(5, 3, [(3, 0, 5), (4, 0, 5)], model)
        plan = plan_structure(*state, 5, 3, model)
        with self.assertRaisesRegex(ValueError, "dimensions changed"):
            plan.apply(*state, width=3, height=5)
        validate_structure(*plan.apply(*state, width=5, height=3), 5, 3, model)

    def test_structural_syntax_guards_reject_the_reproduced_failure_classes(self):
        root = Path(__file__).resolve().parent.parent
        source = (root / "engine/structure.py").read_text()
        gpu = (root / "engine/structure_gpu.py").read_text()
        shader = (root / "engine/shaders/structure_apply.wgsl").read_text()
        values = constants(load_catalog())
        self.assertEqual(lint_structure(source, "structure.py"), [])
        self.assertEqual(lint_structure(gpu, "structure_gpu.py"), [])
        self.assertEqual(lint_wgsl(shader, "structure_apply.wgsl", values), [])
        self.assertTrue(any(issue.startswith("SS034") for issue in lint_structure(source.replace(
            "(width, height) != (self.width, self.height)", "width * height != self.width * self.height"), "structure.py")))
        self.assertTrue(any(issue.startswith("SS034") for issue in lint_structure(gpu.replace(
            ", width=width, height=height", ""), "structure_gpu.py")))
        self.assertTrue(any(issue.startswith("SS033") for issue in lint_structure(source.replace(
            "loads = np.zeros(count, dtype=np.int64)", "loads = np.zeros(count, dtype=np.uint32)"), "structure.py")))
        self.assertTrue(any(issue.startswith("SS012") for issue in lint_structure(source.replace(
            "// (255 * 64 * ENERGY_SCALE)", "/ (255 * 64 * ENERGY_SCALE)"), "structure.py")))
        for before, after in (("packed_in[source]", "packed_in[index]"), ("energy_in[source]", "energy_in[index]"),
                              ("structural_plan[index].y", "structure_in[source]")):
            self.assertTrue(any(issue.startswith("SS035") for issue in lint_wgsl(shader.replace(before, after), "structure_apply.wgsl", values)))
        self.assertEqual(lint_runtime(gpu, "structure_gpu.py"), [])
        self.assertTrue(any(issue.startswith("SS019") for issue in lint_runtime(gpu.replace(
            "resources.callback(buffer.destroy)", "pass"), "structure_gpu.py")))
        bad_fixture = "def fixture(name):\n    for name in ('density', 'phase_energy'):\n        pass\n    return {'name': name}\n"
        self.assertTrue(any(issue.startswith("SS036") for issue in lint_scenario_identity(bad_fixture, "structure_conformance.py")))
        self.assertEqual(lint_checkpoint_outputs((root / "engine/verify.py").read_text(), "verify.py"), [])
        for command in ('[python, "-m", "eval.verify", "--benchmark"]', '[python, "scripts/verify_sdk.py"]'):
            self.assertTrue(any(issue.startswith("SS038") for issue in lint_checkpoint_outputs(command, "verify.py")))

    def test_conformance_corpus_retains_unique_case_identity_and_exercises_load_split(self):
        from engine.structure_conformance import corpus
        fixtures = corpus()
        names = [case["name"] for case, _ in fixtures]
        self.assertEqual(len(names), 25)
        self.assertEqual(len(set(names)), len(names))
        self.assertIn("high-id-hot-softening", names)
        case, model = next((case, model) for case, model in fixtures if case["name"] == "exact-odd-load-split")
        plan = plan_structure(*(np.array(case[key], dtype=np.uint32) for key in ("cells", "energyQ", "structure")), 3, 3, model)
        self.assertEqual(plan.distances[4], 1)
        self.assertEqual((int(plan.reactions[3]), int(plan.reactions[5])), (2, 1))

    def test_executed_noop_welding_and_load_loss_mutants_are_detected(self):
        source = (Path(__file__).resolve().parent.parent / "engine/structure.py").read_text()
        def mutant(before, after):
            self.assertIn(before, source)
            module = types.ModuleType("structure_mutant")
            sys.modules[module.__name__] = module
            try:
                exec(compile(source.replace(before, after), "structure_mutant", "exec"), module.__dict__)
                return module
            finally:
                del sys.modules[module.__name__]
        model = rules()
        cells, energy, words = scene(3, 5, [(1, 1, 5)], model)
        noop = mutant("moving[list(members)] = True", "moving[list(members)] = False")
        no_move = noop.plan_structure(cells, energy, words, 3, 5, model)
        self.assertNotEqual(int(no_move.sources[7]), 4)
        welding = mutant("if reciprocal or (word | other) & FRESH:", "if True:")
        cells, energy, words = scene(3, 3, [(0, 1, 5), (1, 1, 5)], model)
        words &= np.uint32(INTEGRITY_MASK | ANCHOR)
        self.assertFalse(np.array_equal(welding.normalize_bonds(cells, words, 3, 3, model), words))
        load_loss = mutant("quotient + int(rank < remainder)", "quotient")
        thermal = Thermodynamics([ThermalMaterial(0), ThermalMaterial(1)])
        light = StructuralRules([StructuralMaterial(0, 0), StructuralMaterial(1, 1, 255)], thermal)
        cells = np.array([0, 0, 0, 1, 1, 1, 0, 0, 0], dtype=np.uint32)
        cells[0:3] |= np.uint32(4 << 24)
        cells[6:] |= np.uint32(4 << 24)
        energies = np.zeros(9, dtype=np.uint32)
        words = seed_structure(cells, 3, 3, light, anchors=(3, 5))
        self.assertEqual(plan_structure(cells, energies, words, 3, 3, light).supported_weight, 3)
        with self.assertRaisesRegex(RuntimeError, "balance"):
            load_loss.plan_structure(cells, energies, words, 3, 3, light)


if __name__ == "__main__":
    unittest.main()
