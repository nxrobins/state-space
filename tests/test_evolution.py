"""Properties for strict evidence admission and the reproduced evaluation defects."""

import json
import subprocess
import tempfile
import unittest
from dataclasses import FrozenInstanceError
from pathlib import Path
from unittest.mock import patch

import numpy as np

from engine.lint import lint_evaluation
from engine.runner import GPUTrialRunner, generate_test_data
from engine.sources import ShaderBundle
from engine.verify import main as verify_main
from eval.archive import Archive, Candidate, pareto_rank
from eval.benchmark import distribution, synchronized_sample, state_digest, run_scene
from eval.codec import codec_vectors
from eval.evaluator import compare_passes, evaluate_candidate, reference_outputs, validate_reference_evidence
from eval.policy import TARGETS, EvaluationConfig, acceptance_errors, candidate_lint, canonical, constraints, strip_comments
from eval.provenance import read_immutable, read_json, write_immutable
from eval.scenes import acceptance_cases, prepared, cell
from evolve_ss import PHASE_CONFIG, baseline_source, check_hard_constraints


class EvaluationProperties(unittest.TestCase):
    def test_every_gate_and_objective_is_required_and_exactly_typed(self):
        for target in TARGETS:
            fitness = {key.removesuffix("_min"): value for key, value in constraints(target).items()}
            fitness.update(end_to_end_ms=10.0, sync_tick_ms=2.0)
            self.assertFalse(acceptance_errors(fitness, target))
            for key in tuple(fitness):
                for invalid in (None, True, False, "1", float("nan"), float("inf"), -1):
                    value = {**fitness, key: invalid}
                    self.assertTrue(acceptance_errors(value, target), (target, key, invalid))
                incomplete = {k: v for k, v in fitness.items() if k != key}
                self.assertTrue(acceptance_errors(incomplete, target))
            self.assertTrue(acceptance_errors({**fitness, "compared_passes": 0}, target))
            self.assertTrue(acceptance_errors({**fitness, "positive_variants": 0}, target))
            self.assertTrue(acceptance_errors({**fitness, "end_to_end_ms": 0}, target))

    def test_legacy_scores_and_empty_fitness_cannot_be_viable(self):
        candidate = Candidate("legacy", fitness={})
        self.assertFalse(candidate.is_viable())
        self.assertFalse(check_hard_constraints({"determinism_score": 1, "tick_time_ms": 1}, PHASE_CONFIG["2d"]))
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "historical.json"
            path.write_text(json.dumps([{"id": "old", "fitness": {"cycle_time_us": .001}, "phase": "1a",
                                         "evolvable_code": {"_full_shader": "old"}}]))
            before = path.read_bytes()
            archive = Archive.load(path)
            self.assertEqual(archive.select_parents(), [])
            self.assertEqual(before, path.read_bytes())
            path.write_text('[{"id":"old","phase":"1a","fitness":{"cycle_time_us":Infinity},"evolvable_code":{"_full_shader":"old"}}]')
            historical_bytes = path.read_bytes()
            archive = Archive.load(path)
            self.assertEqual(archive.candidates[0].source, "old")
            self.assertEqual(archive.select_parents(), [])
            self.assertIsNone(archive.candidates[0].fitness)
            self.assertEqual(historical_bytes, path.read_bytes())
            path.write_text('{"archiveVersion":2,"target":"codec","fitness":NaN,"candidates":[]}')
            with self.assertRaises(ValueError):
                Archive.load(path)

    def test_ranking_direction_is_shared_and_invalid_metrics_do_not_rank(self):
        records = [("slow", {"time": 4, "work": 1}), ("fast", {"time": 2, "work": 4}),
                   ("nan", {"time": float("nan"), "work": 10}), ("missing", {"time": 1}),
                   ("boolean", {"time": True, "work": 4})]
        self.assertEqual(pareto_rank(records, ("time", "work"), ("work",)), ["fast", "slow"])
        self.assertEqual(pareto_rank([("a", {"work": 1}), ("b", {"work": 9})], ("work",), ("work",)), ["b", "a"])
        self.assertEqual(pareto_rank([("b", {"time": 1}), ("a", {"time": 1})], ("time",)), ["a", "b"])

    def test_evidence_is_content_addressed_and_strict_json(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            key = write_immutable(directory, {"answer": 42})
            self.assertEqual(write_immutable(directory, {"answer": 42}), key)
            self.assertEqual(read_immutable(directory, key), {"answer": 42})
            (directory / (key + ".json")).write_text('{"answer":43}')
            with self.assertRaises(ValueError):
                read_immutable(directory, key)
            with self.assertRaises(ValueError):
                write_immutable(directory, {"answer": 42})
            for malformed in ('{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}'):
                path = directory / "invalid.json"
                path.write_text(malformed)
                with self.assertRaises(ValueError):
                    read_json(path)
        with self.assertRaises(ValueError):
            canonical({"time": float("nan")})

    def test_measurements_sync_on_both_sides_of_the_clock(self):
        events = []
        class Queue:
            def read_buffer(self, *_args, **_kwargs):
                events.append("sync")
        def clock():
            events.append("clock")
            return len(events) / 1000
        with patch("eval.benchmark.time.perf_counter", side_effect=clock):
            elapsed = synchronized_sample(Queue(), lambda: events.append("dispatch"), object())
        self.assertEqual(events, ["sync", "clock", "dispatch", "sync", "clock"])
        self.assertAlmostEqual(elapsed, 3)
        summary = distribution([5, 1, 3, 2, 4])
        self.assertEqual((summary["median"], summary["p95"], summary["count"]), (3, 5, 5))
        for invalid in ([], [1], [1, 2, float("nan")], [1, 2, 0], [1, 2, True]):
            with self.assertRaises(ValueError):
                distribution(invalid)

    def test_seeds_shapes_and_full_state_are_reproducible(self):
        a, b = acceptance_cases(8173), acceptance_cases(8173)
        self.assertEqual(canonical(a), canonical(b))
        self.assertNotEqual(canonical(a), canonical(acceptance_cases(8174)))
        self.assertTrue(any(scene["width"] > 16 and scene["height"] > 16 for scene in a))
        self.assertTrue(any(any(value % 256 for value in scene["energyQ"]) for scene in a))
        self.assertTrue(any(any(value & 255 == 255 for value in scene["cells"]) for scene in a))
        vectors = codec_vectors(4)
        self.assertTrue(np.any(vectors == 0xffffffff))
        np.testing.assert_array_equal(vectors, codec_vectors(4))
        for value in (True, -1, 1.5, "3"):
            with self.assertRaises(ValueError):
                EvaluationConfig(seed=value)
        with self.assertRaises(ValueError):
            EvaluationConfig(warmup=0)

    def test_bundle_captures_sources_once_and_cannot_be_aliased(self):
        bundle = ShaderBundle.load()
        with self.assertRaises(FrozenInstanceError):
            bundle.kernels = ()
        with self.assertRaises(ValueError):
            ShaderBundle(list(bundle.kernels), bundle.shaders)
        replacement = bundle.replace_kernel("phase_2a_winner.wgsl", "candidate")
        self.assertNotEqual(bundle.kernel("phase_2a_winner.wgsl"), "candidate")
        self.assertEqual(replacement.kernel("phase_2a_winner.wgsl"), "candidate")

    def test_partial_or_misordered_trace_is_rejected(self):
        scene = acceptance_cases(8173)[0]
        with self.assertRaisesRegex(ValueError, "Missing or misordered"):
            compare_passes(scene, {"name": scene["name"], "passes": []},
                           {"pass_snapshots": [], "pass_energy_snapshots": []}, "thermal")

    def test_structure_only_errors_hashes_positive_behavior_and_continuation_are_mandatory(self):
        scene = prepared({"name": "damage-only", "width": 1, "height": 1, "tick": 0, "ticks": 1,
                          "cells": [cell(7)], "structureOverrides": {0: 1}})
        reference = reference_outputs([scene])[0]
        validate_reference_evidence(scene, reference)
        missing = json.loads(json.dumps(reference))
        del missing["passes"][0]["structure"]
        with self.assertRaisesRegex(ValueError, "three-coordinate"):
            validate_reference_evidence(scene, missing)
        result = {}
        for source, trace, final in (("cells", "pass_snapshots", "final_grid"), ("energyQ", "pass_energy_snapshots", "final_energy"),
                                     ("structure", "pass_structure_snapshots", "final_structure")):
            result[trace] = [(entry["tick"], entry["id"], np.array(entry[source], dtype=np.uint32)) for entry in reference["passes"]]
            result[final] = result[trace][-1][2].copy()
        checked = compare_passes(scene, reference, result, "structure")
        self.assertEqual(checked["positive"], {"structure"})
        self.assertEqual(checked["composed_mismatches"], 0)
        result["pass_structure_snapshots"][0][2][0] = 1
        changed = compare_passes(scene, reference, result, "structure")
        self.assertEqual(changed["composed_mismatches"], 1)
        self.assertEqual(changed["firstDifference"]["actual"][2], 1)
        self.assertEqual(changed["firstDifference"]["expected"][2], 0)
        self.assertEqual(changed["positive"], set())
        self.assertNotEqual(state_digest(scene["cells"], scene["energyQ"], [0]), state_digest(scene["cells"], scene["energyQ"], [1]))
        with self.assertRaises(ValueError):
            run_scene(None, scene, grid=scene["cells"], energy=scene["energyQ"])
        incomplete = {key: value for key, value in result.items() if key != "pass_structure_snapshots"}
        with self.assertRaisesRegex(ValueError, "Missing or misordered"):
            compare_passes(scene, reference, incomplete, "structure")
        result["final_structure"][0] = 1
        with self.assertRaisesRegex(ValueError, "Final state"):
            compare_passes(scene, reference, result, "structure")

    def test_candidate_lint_has_executable_negative_controls(self):
        source = baseline_source("combustion")
        self.assertEqual(candidate_lint(source, "combustion"), [])
        self.assertEqual(candidate_lint("/* outer /* loop { } */ inner */\n" + source, "combustion"), [])
        for mutant in (source.replace("order < 4u", "order < GRID_WIDTH"), source.replace("let candidate = neighbor(index, order);", "order = 0u; let candidate = neighbor(index, order);"),
                       source + "\nfn hang(){ loop {} }", source.replace("16, 16", "8, 8"),
                       source + "\n@group(0) @binding(0) var<storage,read> cheat: array<u32>;"):
            self.assertTrue(candidate_lint(mutant, "combustion"))
        with self.assertRaises(ValueError):
            strip_comments("/* nested /* */")
        self.assertTrue(candidate_lint(baseline_source("codec") + "\n@compute fn cheat() {}", "codec"))

    def test_evaluation_lint_prevents_reintroduced_gate_and_clock_failures(self):
        controls = {"SS026": "def is_viable(self): return not self.fitness.get('disqualified', False)",
                    "SS027": "source = fix_wgsl(source)", "SS028": "json.dumps(report)", "SS041": "def accepted_receipt(report): return report",
                    "SS030": "subprocess.run(command)"}
        for code, source in controls.items():
            self.assertTrue(any(code in error for error in lint_evaluation(source, "eval/example.py")))
        source = (Path(__file__).resolve().parent.parent / "eval/benchmark.py").read_text()
        self.assertEqual(lint_evaluation(source, "eval/benchmark.py"), [])
        mutant = source.replace("    queue.read_buffer(sync_buffer, size=4)\n", "", 1)
        self.assertTrue(any("SS029" in error for error in lint_evaluation(mutant, "eval/benchmark.py")))

    def test_worker_timeout_never_creates_an_admission_receipt(self):
        context = {"sourceHashes": {}, "device": {}, "runtime": {}}
        original = subprocess.run
        def timeout(command, **kwargs):
            if "eval.worker" in command:
                raise subprocess.TimeoutExpired(command, kwargs["timeout"])
            return original(command, **kwargs)
        with tempfile.TemporaryDirectory() as temp, patch("eval.evaluator.capture_context", return_value=context), \
             patch("eval.evaluator.context_sources", return_value={}), patch("eval.evaluator.subprocess.run", side_effect=timeout):
            report = evaluate_candidate("invalid", "thermal", Path(temp))
            self.assertIs(report["passed"], False)
            self.assertIn("timed out", report["errors"][0])

    def test_aggregate_timeout_preserves_partial_evidence_and_fails_closed(self):
        def run(command, **kwargs):
            self.assertGreater(kwargs["timeout"], 0)
            if "eval.verify" in command:
                self.assertGreater(kwargs["timeout"], EvaluationConfig().timeout_seconds)
                self.assertIn("--output", command)
                self.assertEqual(Path(command[command.index("--output") + 1]), path.with_name(path.stem + "-evaluation"))
                raise subprocess.TimeoutExpired(command, kwargs["timeout"], output=b"12 adversaries rejected\n", stderr=b"partial diagnostic\n")
            if "scripts/verify_sdk.py" in command:
                self.assertEqual(Path(command[command.index("--report") + 1]), path.with_name(path.stem + "-sdk.json"))
            return subprocess.CompletedProcess(command, 0, stdout="passed", stderr="")
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "report.json"
            with patch("sys.argv", ["verify", "--report", str(path)]), patch("engine.verify.source_hashes", return_value={}), \
                 patch("engine.verify.shutil.which", return_value="npm"), patch("engine.verify.subprocess.run", side_effect=run):
                self.assertEqual(verify_main(), 1)
            report = read_json(path)
            self.assertIs(report["passed"], False)
            timed_out = report["checks"][-1]
            self.assertIn("12 adversaries rejected", timed_out["stdout"])
            self.assertIn("partial diagnostic", timed_out["stderr"])

    def test_legacy_copy_harness_cannot_hide_broken_codec_helpers(self):
        source = baseline_source("codec")
        with GPUTrialRunner() as runner:
            baseline = runner.run_pack_unpack_trial(source, generate_test_data(512), n_timing_runs=3)
            self.assertIs(baseline["passed"], True, baseline)
            mutant = source.replace("state.material = (packed >> MATERIAL_SHIFT) & MATERIAL_MASK;", "state.material = 0u;")
            # A candidate-owned identity entry would have hidden this defect in the old probe.
            mutant += "\n@group(0) @binding(0) var<storage,read> input:array<u32>;\n@group(0) @binding(1) var<storage,read_write> output:array<u32>;\n@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) gid:vec3<u32>) { output[gid.x]=input[gid.x]; }\n"
            failed = runner.run_pack_unpack_trial(mutant, generate_test_data(512), n_timing_runs=3)
            self.assertIs(failed["passed"], False)
            self.assertGreater(failed["codec_field_errors"], 0)
            self.assertIs(failed["admissible"], False)
            with self.assertRaises(ValueError):
                runner.run_pack_unpack_trial(source, np.array([], dtype=np.uint32))
            with self.assertRaises(ValueError):
                runner.run_physics_trial("noop", [], [], 1, 1)


if __name__ == "__main__":
    unittest.main()
