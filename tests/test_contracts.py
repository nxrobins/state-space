"""Properties for the public format, generated definitions, and invalid inputs."""

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from engine.catalog import load_catalog, unique_object, validate_catalog
from engine.state import seed_state
from engine.contracts import SCHEMA_VERSION, Snapshot, validate_dimensions, validate_packed
from engine.generate import ROOT, check_generated, constants, generated_outputs
from engine.lint import lint, lint_consumer, lint_python, lint_wgsl
from engine.schema import COLD_TABLE, COLD_TABLE_STRIDE, VoxelState, build_cold_table_buffer, pack_voxel, pack_voxel_array, unpack_voxel_array


class CatalogProperties(unittest.TestCase):
    def setUp(self):
        self.catalog = load_catalog()

    def test_rejects_duplicate_material_ids_and_names(self):
        for field in ("id", "name"):
            catalog = copy.deepcopy(self.catalog)
            catalog["materials"][1][field] = catalog["materials"][0][field]
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_catalog(catalog)

    def test_rejects_duplicate_json_keys(self):
        with self.assertRaises(ValueError):
            json.loads('{"density": 1, "density": 2}', object_pairs_hook=unique_object)

    def test_rejects_invalid_numeric_properties(self):
        for value in (-1, 256, 0.5, True, "2", None):
            catalog = copy.deepcopy(self.catalog)
            catalog["materials"][2]["properties"]["density"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_catalog(catalog)

    def test_rejects_dangling_targets_and_incomplete_reactions(self):
        for field, value in (("melts_into", 99), ("flash_point", 0), ("smoke_product", 0)):
            catalog = copy.deepcopy(self.catalog)
            catalog["materials"][7]["properties"][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_catalog(catalog)

    def test_rejects_abi_changes_without_version_change(self):
        for field in ("shift", "bits", "signed"):
            catalog = copy.deepcopy(self.catalog)
            catalog["bit_fields"]["thermal"][field] = 1
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_catalog(catalog)

    def test_rejects_renamed_materials_swapped_phases_and_flags(self):
        for kind in ("material", "phase", "flag"):
            catalog = copy.deepcopy(self.catalog)
            if kind == "material":
                catalog["materials"][2]["name"] = "something_else"
            elif kind == "phase":
                catalog["phases"]["GAS"], catalog["phases"]["SOLID"] = 0, 4
            else:
                catalog["flags"]["BURNING"], catalog["flags"]["CONDUCTING"] = 2, 1
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                validate_catalog(catalog)

    def test_nested_malformed_structures_are_rejected(self):
        for key in ("materials", "bit_fields", "phases", "flags"):
            catalog = copy.deepcopy(self.catalog)
            catalog[key] = None
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_catalog(catalog)

    def test_packed_cold_table_matches_every_property_and_reserved_slot(self):
        table = build_cold_table_buffer().reshape(256, COLD_TABLE_STRIDE)
        for record in self.catalog["materials"]:
            expected = [record["properties"][name] for name in self.catalog["cold_fields"]]
            np.testing.assert_array_equal(table[record["id"]], expected + [0] * (24 - len(expected)))
            self.assertEqual(COLD_TABLE[record["id"]].name, record["name"])


class SnapshotProperties(unittest.TestCase):
    def test_seeded_all_bit_roundtrips(self):
        rng = np.random.default_rng(8173)
        cells = np.concatenate([np.array([0, 0xffffffff, 0x80000000], dtype=np.uint32),
                                rng.integers(0, 2**32, size=100_000, dtype=np.uint32)])
        np.testing.assert_array_equal(pack_voxel_array(unpack_voxel_array(cells)), cells)

    def test_snapshot_copies_and_roundtrips_every_field(self):
        cells, energy = seed_state(np.array([0xffff_ff0e, 0], dtype=np.uint32))
        original_cell = int(cells[0])
        snapshot = Snapshot(2, 1, 7, cells, energy, [0, 0])
        cells[0] = 1
        self.assertEqual(int(snapshot.packed_cells[0]), original_cell)
        with self.assertRaises(ValueError):
            snapshot.packed_cells[0] = 4
        restored = Snapshot.from_dict(json.loads(json.dumps(snapshot.to_dict())))
        self.assertEqual(restored.to_dict(), snapshot.to_dict())

    def test_rejects_incompatible_or_missing_metadata(self):
        original = Snapshot(1, 1, 0, [0], [0], [0]).to_dict()
        for field, value in (("schemaVersion", SCHEMA_VERSION + 1), ("schemaVersion", True), ("rulesVersion", "other"),
                             ("materialCatalogHash", "other"), ("tick", -1), ("tick", 2**53)):
            changed = {**original, field: value}
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                Snapshot.from_dict(changed)
        for field in original:
            changed = dict(original)
            del changed[field]
            with self.subTest(missing=field), self.assertRaises(ValueError):
                Snapshot.from_dict(changed)

    def test_rejects_invalid_dimensions(self):
        for pair in ((0, 1), (-1, 1), (True, 1), (1.5, 1), (1, float("nan")), (65536, 65536)):
            with self.subTest(pair=pair), self.assertRaises(ValueError):
                validate_dimensions(*pair)
        self.assertEqual(validate_dimensions(7, 3), (7, 3))

    def test_rejects_cells_before_coercion(self):
        for cells in ([0.5], [-1], [2**32], [True], ["3"], [float("nan")], [[0]], []):
            with self.subTest(cells=cells), self.assertRaises(ValueError):
                validate_packed(cells, 1)
        with self.assertRaises(ValueError):
            validate_packed([True, 1], 2)

    def test_packers_reject_overflow_instead_of_wrapping(self):
        for index, value in ((0, 256), (1, 260), (2, 8), (3, -9), (4, 16), (5, 16)):
            state = [0, 20, 0, 0, 0, 0]
            state[index] = value
            with self.subTest(index=index), self.assertRaises(ValueError):
                pack_voxel(VoxelState(*state))
            with self.subTest(array_index=index), self.assertRaises(ValueError):
                pack_voxel_array(np.array([state]))

    def test_gpu_run_rejects_bad_state_before_compilation(self):
        from engine.compositor import CompositionEngine
        engine = object.__new__(CompositionEngine)
        engine._closed = False
        with patch.object(engine, "_compile_pipelines") as compile_pipelines:
            for kwargs in ({"initial_grid": [0.5]}, {"n_ticks": -1}, {"start_tick": -1},
                           {"snapshot_interval": 1.5}, {"cold_table": [0]}):
                args = dict(initial_grid=[0], cold_table=build_cold_table_buffer(), grid_width=1, grid_height=1, n_ticks=0)
                args.update(kwargs)
                with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                    engine.run(**args)
            compile_pipelines.assert_not_called()

    def test_validation_survives_optimized_python(self):
        result = subprocess.run([sys.executable, "-O", "-c",
                                 "from engine.schema import _encode_signed_4bit; _encode_signed_4bit(8)"],
                                cwd=ROOT, capture_output=True, text=True, timeout=20)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ValueError", result.stderr)


class PreventionRules(unittest.TestCase):
    def test_repository_passes_engine_lint(self):
        self.assertEqual(lint(), [])

    def test_generated_drift_is_detected_on_disk(self):
        outputs = generated_outputs()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for source in [ROOT / "engine/materials.json", ROOT / "web/render.wgsl", ROOT / "engine/thermal.ts", ROOT / "engine/structure.ts", ROOT / "engine/validation.ts", ROOT / "engine/contracts.ts", ROOT / "engine/registry.ts",
                           ROOT / "engine/shaders/state_io.wgsl", ROOT / "engine/shaders/enthalpy_law.wgsl", *(ROOT / "locked").glob("*.wgsl")]:
                target = root / source.relative_to(ROOT)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
            for source, text in outputs.items():
                target = root / source.relative_to(ROOT)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(text, encoding="utf-8")
            self.assertEqual(check_generated(root), [])
            path = root / "web/shaders/combustion.wgsl"
            path.write_text(path.read_text(encoding="utf-8") + "\n// altered\n", encoding="utf-8")
            self.assertIn("web\\shaders\\combustion.wgsl" if sys.platform == "win32" else "web/shaders/combustion.wgsl", check_generated(root))

    def test_mutated_consumers_cannot_redeclare_material_tables(self):
        self.assertTrue(lint_consumer("const MAT = {WATER: 9};", "probe.ts"))
        self.assertFalse(lint_consumer("import { MAT } from './generated/materials';", "probe.ts"))

    def test_mutated_shader_cannot_change_stride_or_dimensions(self):
        values = constants(load_catalog())
        self.assertTrue(lint_wgsl("const COLD_STRIDE: u32 = 8u;", "probe.wgsl", values))
        self.assertTrue(lint_wgsl("const GRID_WIDTH: u32 = 256u;", "probe.wgsl", values))

    def test_unsigned_index_guard_is_required_before_access(self):
        values = constants(load_catalog())
        for source in ("let cost = costs[winner - 2u] * 0u;", "let cost = select(0u, costs[winner - 2u], winner >= 2u);",
                       "if (winner >= 2u || true) { let cost = costs[winner - 2u]; }"):
            self.assertTrue(any("SS011" in issue for issue in lint_wgsl(source, "probe.wgsl", values)))
        self.assertEqual(lint_wgsl("if (winner >= 2u) { let cost = costs[winner - 2u]; }", "probe.wgsl", values), [])

    def test_mutated_python_cannot_use_silent_override_or_removable_guard(self):
        for source, code in (("x = {'a': 1, 'a': 2}", "SS005"),
                             ("x = Path('D:/other-checkout')", "SS004"),
                             ("def validate_input(x):\n    assert x > 0", "SS006")):
            self.assertTrue(any(code in issue for issue in lint_python(source, "probe.py")))


if __name__ == "__main__":
    unittest.main()
