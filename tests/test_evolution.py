"""Properties for strict evidence admission and the reproduced evaluation defects."""

import copy
import json
import statistics
import subprocess
import tempfile
import unittest
from dataclasses import FrozenInstanceError
from pathlib import Path
from unittest.mock import patch

import numpy as np

from engine.lint import lint_evaluation
from engine.runner import GPUTrialRunner, generate_test_data
from engine.schedule import KERNEL_SPECS, movement_schedule_for_tick
from engine.sources import ShaderBundle
from engine.verify import main as verify_main
from eval.archive import Archive, Candidate, pareto_rank
from eval.benchmark import KERNEL_CHUNK, KernelProbeExceeded, benchmark_kernel, distribution, synchronized_sample, state_digest, run_scene
from eval.codec import codec_vectors
from eval.evaluator import accepted_receipt, compare_passes, evaluate_candidate, reference_outputs, validate_reference_evidence
from eval.policy import (KERNEL_SHAPES, OBJECTIVES, POLICY_VERSION, TARGETS, EvaluationConfig, acceptance_errors, candidate_lint,
                         canonical, constraints, digest, kernel_variants, strip_comments, target_variants)
from eval.provenance import context_sources, read_immutable, read_json, write_immutable
from eval.scenes import KINDS, acceptance_cases, prepared, cell
from evolve_ss import PHASE_CONFIG, baseline_source, check_hard_constraints
from tests.gpu_support import requires_gpu


class FakeBuffer:
    def __init__(self, size):
        self.size = size
        self.data = bytearray(size)

    def destroy(self):
        self.data = None


class FakeGroup:
    def __init__(self, buffers):
        self.buffers = buffers


class FakePipeline:
    def __init__(self, kernel):
        self.kernel = kernel


class FakeComputePass:
    def __init__(self, encoder):
        self.encoder, self.pipeline, self.group = encoder, None, None

    def set_pipeline(self, pipeline):
        self.pipeline = pipeline

    def set_bind_group(self, index, group):
        self.group = group

    def dispatch_workgroups(self, x, y=1, z=1):
        self.encoder.dispatches.append((self.pipeline, self.group, (x, y)))

    def end(self):
        pass


class FakeCommandBuffer:
    def __init__(self, dispatches):
        self.dispatches = dispatches


class FakeEncoder:
    def __init__(self):
        self.dispatches = []

    def begin_compute_pass(self):
        return FakeComputePass(self)

    def finish(self):
        return FakeCommandBuffer(list(self.dispatches))


class FakeQueue:
    def __init__(self, events):
        self.events, self.dispatched, self.calls = events, [], 0

    def write_buffer(self, buffer, offset, data):
        raw = np.ascontiguousarray(data).tobytes()
        buffer.data[offset:offset + len(raw)] = raw

    def read_buffer(self, buffer, buffer_offset=0, size=None):
        self.events.append(("read", size))
        end = buffer.size if size is None else buffer_offset + size
        return memoryview(bytes(buffer.data[buffer_offset:end]))

    def submit(self, buffers):
        self.events.append(("submit", sum(len(buffer.dispatches) for buffer in buffers), len(buffers)))
        for buffer in buffers:
            for pipeline, group, workgroups in buffer.dispatches:
                self.calls += 1
                pipeline.kernel(group, self.calls)
                self.dispatched.append((pipeline, group, workgroups))


class FakeDevice:
    def __init__(self, events):
        self.queue = FakeQueue(events)

    def create_buffer(self, *, size, usage, label=""):
        return FakeBuffer(size)

    def create_bind_group(self, *, layout, entries):
        return FakeGroup({entry["binding"]: entry["resource"]["buffer"] for entry in entries})

    def create_command_encoder(self):
        return FakeEncoder()


class FakeEngine:
    """The surface benchmark_kernel uses: a device, compiled pipelines per shape, and a shared layout."""

    def __init__(self, kernels):
        self.events = []
        self.device = FakeDevice(self.events)
        self.kernels, self.compiled, self.pipelines = kernels, [], {}

    def _compile_pipelines(self, width, height):
        self.compiled.append((width, height))
        self.pipelines = {variant: (FakePipeline(kernel), "layout") for variant, kernel in self.kernels.items()}

    def clock(self, step_seconds):
        """A perf_counter stand-in: every call advances by one step and is recorded between queue events."""
        counter = iter(range(10**6))

        def perf_counter():
            self.events.append(("clock",))
            return next(counter) * step_seconds
        return perf_counter


def copy_kernel(group, call):
    """A deterministic pass: every output word is its input word with one bit flipped."""
    for source, destination in ((0, 1), (3, 4), (5, 6)):
        words = np.frombuffer(bytes(group.buffers[source].data), dtype=np.uint32) ^ np.uint32(1 << 31)
        group.buffers[destination].data[:] = words.tobytes()


def drifting_kernel(group, call):
    """A pass whose output depends on how many dispatches ran before it."""
    copy_kernel(group, call)
    group.buffers[1].data[0:4] = np.uint32(call).tobytes()


class EvaluationProperties(unittest.TestCase):
    def test_every_gate_and_objective_is_required_and_exactly_typed(self):
        for target in TARGETS:
            fitness = {key.removesuffix("_min"): value for key, value in constraints(target).items()}
            fitness.update(end_to_end_ms=10.0, sync_tick_ms=2.0, kernel_ms=0.05)
            self.assertFalse(acceptance_errors(fitness, target))
            self.assertEqual(set(OBJECTIVES), {"end_to_end_ms", "sync_tick_ms", "kernel_ms"})
            for key in tuple(fitness):
                for invalid in (None, True, False, "1", float("nan"), float("inf"), -1):
                    value = {**fitness, key: invalid}
                    self.assertTrue(acceptance_errors(value, target), (target, key, invalid))
                incomplete = {k: v for k, v in fitness.items() if k != key}
                self.assertTrue(acceptance_errors(incomplete, target))
            self.assertTrue(acceptance_errors({**fitness, "compared_passes": 0}, target))
            self.assertTrue(acceptance_errors({**fitness, "positive_variants": 0}, target))
            self.assertTrue(acceptance_errors({**fitness, "end_to_end_ms": 0}, target))
            self.assertTrue(acceptance_errors({**fitness, "kernel_ms": 0}, target))

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
        # The default objectives include the isolated kernel time; a record without it cannot rank.
        complete = {"end_to_end_ms": 1.0, "sync_tick_ms": 1.0}
        self.assertEqual(pareto_rank([("partial", complete)]), [])
        self.assertEqual(pareto_rank([("slow", {**complete, "kernel_ms": 2.0}), ("fast", {**complete, "kernel_ms": 1.0})]), ["fast", "slow"])

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
        for invalid in ({"kernel_dispatches": 31}, {"kernel_dispatches": 1025}, {"kernel_probe_budget_ms": 0}, {"kernel_probe_budget_ms": True}):
            with self.assertRaises(ValueError):
                EvaluationConfig(**invalid)
        self.assertEqual(EvaluationConfig().to_dict()["kernel_dispatches"], 256)
        self.assertEqual(kernel_variants("thermal"), sorted(target_variants("thermal")))
        self.assertEqual(kernel_variants("structure"), ["structure"])
        codec = kernel_variants("codec")
        self.assertEqual(len(codec), len({spec.source_file for spec in KERNEL_SPECS}))
        self.assertTrue(set(codec) <= target_variants("codec"))

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

    def test_kernel_batches_reuse_one_bind_group_discard_warmups_and_hash_once(self):
        fake = FakeEngine({variant: copy_kernel for variant in kernel_variants("thermal")})
        config = EvaluationConfig(warmup=1, samples=3, kernel_dispatches=64, kernel_probe_budget_ms=6)
        step_ms = 1000 * 2 ** -10  # exactly representable, so every interval and quotient below is exact
        with patch("eval.benchmark.time.perf_counter", side_effect=fake.clock(2 ** -10)):
            rows = benchmark_kernel(fake, "thermal", config, shapes=((8, 8), (16, 16)))
        self.assertEqual(fake.compiled, [(8, 8), (16, 16)])
        expected = [(width, height, f"{kind}-{width}x{height}", variant)
                    for width, height in ((8, 8), (16, 16)) for kind in KINDS for variant in kernel_variants("thermal")]
        self.assertEqual([(row["width"], row["height"], row["scene"], row["variant"]) for row in rows], expected)
        for row in rows:
            self.assertEqual((row["dispatches"], row["warmup"], row["kernelMs"]["count"]), (64, 1, 3))
            # Every clock interval is one step, so a batch of 64 dispatches reads as one step / 64 each.
            self.assertEqual(row["kernelMs"]["samples"], [step_ms / 64] * 3)
            self.assertEqual(row["probeMs"], [step_ms])
            self.assertIs(row["probed"], (row["width"], row["height"]) == (8, 8))
            self.assertEqual(row["singleHash"], row["batchHash"])
            self.assertNotEqual(row["singleHash"], row["initialHash"])
        # Per row: one single dispatch, then warmup + samples batches of 64 dispatches in two 32-dispatch command buffers.
        submits = [event for event in fake.events if event[0] == "submit"]
        self.assertEqual(submits, [("submit", 1, 1), *[("submit", 64, 2)] * 4] * len(rows))
        self.assertEqual(KERNEL_CHUNK, 32)
        # The order of a timed batch: drain, clock, submit, completion read, clock. Hashes read all three outputs.
        batch = fake.events[fake.events.index(("submit", 64, 2)) - 2:][:5]
        self.assertEqual(batch, [("read", 4), ("clock",), ("submit", 64, 2), ("read", 4), ("clock",)])
        self.assertEqual(fake.events.count(("read", None)), 6 * len(rows))
        # Dispatches never flip the bind group: one group per shape binds *_in at 0/3/5 and *_out at 1/4/6.
        groups = {id(group) for _, group, _ in fake.device.queue.dispatched}
        self.assertEqual(len(groups), 2)
        for _, group, workgroups in fake.device.queue.dispatched:
            self.assertEqual(set(group.buffers), set(range(8)))
            self.assertEqual(workgroups, (1, 1))
        self.assertEqual(statistics.mean(row["kernelMs"]["median"] for row in rows), step_ms / 64)

    def test_kernel_probe_fails_closed_before_any_batch_and_nondeterminism_is_rejected(self):
        fake = FakeEngine({variant: copy_kernel for variant in kernel_variants("phase")})
        config = EvaluationConfig(warmup=1, samples=3, kernel_dispatches=32, kernel_probe_budget_ms=1)
        with patch("eval.benchmark.time.perf_counter", side_effect=fake.clock(2 ** -9)), \
                self.assertRaisesRegex(KernelProbeExceeded, "budget 1 ms; no batch was submitted"):
            benchmark_kernel(fake, "phase", config, shapes=((8, 8), (16, 16)))
        submits = [event for event in fake.events if event[0] == "submit"]
        # The probe and its one same-size retry ran; nothing larger reached the queue.
        self.assertEqual(submits, [("submit", 1, 1), ("submit", 1, 1)])
        self.assertTrue(issubclass(KernelProbeExceeded, ValueError))
        drifting = FakeEngine({"phase": drifting_kernel})
        config = EvaluationConfig(warmup=1, samples=3, kernel_dispatches=32)
        rows = []
        with patch("eval.benchmark.time.perf_counter", side_effect=drifting.clock(2 ** -10)), \
                self.assertRaisesRegex(ValueError, "Nondeterministic kernel batch"):
            benchmark_kernel(drifting, "phase", config, shapes=((8, 8), (16, 16)), on_row=rows.append)
        self.assertEqual(rows, [])

    def test_receipt_admission_recomputes_kernel_rows_and_rejects_altered_evidence(self):
        config = EvaluationConfig(warmup=1, samples=3, kernel_dispatches=32)
        source = baseline_source("thermal")
        scene = prepared({"name": "receipt-probe", "width": 3, "height": 2, "tick": 1, "ticks": 4,
                          "cells": [cell(5, 200), cell(5, 20), cell(0), cell(1), cell(1), cell(1)]})
        timing = distribution
        with tempfile.TemporaryDirectory() as temp, patch("eval.evaluator.acceptance_cases", return_value=[scene]):
            directory = Path(temp)
            sources = context_sources()
            context = {"policy": POLICY_VERSION, "sourceHashes": {name: digest(value) for name, value in sources.items()},
                       "device": {"info": {}}, "runtime": {}}
            reference = reference_outputs([scene])
            final = validate_reference_evidence(scene, reference[0])
            bundle = ShaderBundle.load().replace_kernel(TARGETS["thermal"], source)
            compared = scene["ticks"] * len(movement_schedule_for_tick(scene["tick"]))
            rows = [{"scene": f"{kind}-{width}x{height}", "width": width, "height": height, "ticks": config.ticks,
                     "seed": config.seed + index, "startTick": 3, "warmup": config.warmup, "initialHash": "0" * 64, "finalHash": "0" * 64,
                     "energyQ": 1, "endToEndMs": timing([3.0, 1.0, 2.0]), "syncTickMs": timing([1.0, 1.5, 2.0]), "planningMs": timing([.1, .2, .3])}
                    for width, height in ((32, 32), (65, 33)) for index, kind in enumerate(KINDS)]
            kernel_rows = [{"scene": f"{kind}-{width}x{height}", "variant": variant, "width": width, "height": height,
                            "seed": config.seed + index, "startTick": 3, "initialHash": "0" * 64, "warmup": config.warmup,
                            "dispatches": config.kernel_dispatches, "probed": (width, height) == KERNEL_SHAPES[0],
                            "probeMs": [1.5] if (width, height) == KERNEL_SHAPES[0] else [7.0, 5.0],
                            "probeBudgetMs": config.kernel_probe_budget_ms, "singleHash": "a" * 64, "batchHash": "a" * 64,
                            "kernelMs": timing([.05, .04, .06])}
                           for width, height in KERNEL_SHAPES for index, kind in enumerate(KINDS) for variant in kernel_variants("thermal")]
            fitness = {"composed_mismatches": 0, "energy_drift_q": 0, "material_count_errors": 0, "compared_passes": compared,
                       "determinism_mismatches": 0, "restart_mismatches": 0, "positive_variants": 4,
                       "end_to_end_ms": statistics.mean(row["endToEndMs"]["median"] for row in rows),
                       "sync_tick_ms": statistics.mean(row["syncTickMs"]["median"] for row in rows),
                       "kernel_ms": statistics.mean(row["kernelMs"]["median"] for row in kernel_rows)}
            self.assertEqual(acceptance_errors(fitness, "thermal"), [])
            report = {"policy": POLICY_VERSION, "target": "thermal", "sourceHash": digest(source), "context": context,
                      "config": config.to_dict(), "passed": True, "fitness": fitness, "errors": [],
                      "cases": [{"name": scene["name"], "initialHash": state_digest(scene["cells"], scene["energyQ"], scene["structure"]),
                                 "finalHash": state_digest(*final), "compared_passes": compared,
                                 "composed_mismatches": 0, "energy_drift_q": 0, "material_count_errors": 0}],
                      "compiledHashes": {spec.id: "0" * 64 for spec in KERNEL_SPECS}, "positiveVariants": sorted(target_variants("thermal")),
                      "inputsHash": write_immutable(directory, {"cases": [scene], "reference": reference}),
                      "shaderBundleHash": write_immutable(directory, {"kernels": bundle.kernels, "shaders": bundle.shaders}),
                      "sourceBundleHash": write_immutable(directory, {"context": context, "sources": sources}),
                      "benchmarks": rows, "kernelBenchmarks": kernel_rows}
            write_immutable(directory, source, ".wgsl")
            key = write_immutable(directory, report)
            self.assertIsNotNone(accepted_receipt(directory, key, source, "thermal", context, config))
            self.assertIsNone(accepted_receipt(directory, key, source, "thermal", context, EvaluationConfig(warmup=1, samples=3, kernel_dispatches=64)))
            self.assertIsNone(accepted_receipt(directory, key, source, "thermal", context, EvaluationConfig(warmup=1, samples=3, kernel_dispatches=32, kernel_probe_budget_ms=7)))

            def rejected(name, mutate):
                altered = copy.deepcopy(report)
                mutate(altered)
                with self.subTest(name=name):
                    self.assertIsNone(accepted_receipt(directory, write_immutable(directory, altered), source, "thermal", context, config))

            def kernel_row(altered, index, **changes):
                altered["kernelBenchmarks"][index] = {**altered["kernelBenchmarks"][index], **changes}

            rejected("missing-row", lambda r: r["kernelBenchmarks"].pop())
            rejected("rows-reordered", lambda r: r["kernelBenchmarks"].reverse())
            rejected("other-variant", lambda r: kernel_row(r, 0, variant="phase"))
            rejected("fewer-dispatches", lambda r: kernel_row(r, 0, dispatches=31))
            rejected("other-warmup", lambda r: kernel_row(r, 0, warmup=2))
            rejected("hash-mismatch", lambda r: kernel_row(r, 0, batchHash="b" * 64))
            rejected("probe-over-budget", lambda r: kernel_row(r, 0, probeMs=[6.5]))
            rejected("probe-missing", lambda r: kernel_row(r, 0, probeMs=[]))
            rejected("probe-not-a-number", lambda r: kernel_row(r, 0, probeMs=[True]))
            rejected("probe-flag-flipped", lambda r: kernel_row(r, 0, probed=False))
            rejected("probe-flag-claimed-at-large-shape", lambda r: kernel_row(r, -1, probed=True))
            rejected("other-budget", lambda r: kernel_row(r, 0, probeBudgetMs=7))
            rejected("sample-count", lambda r: kernel_row(r, 0, kernelMs=timing([.05, .04, .06, .05])))
            rejected("stale-distribution", lambda r: kernel_row(r, 0, kernelMs={**r["kernelBenchmarks"][0]["kernelMs"], "median": .001}))
            rejected("inconsistent-objective", lambda r: r["fitness"].__setitem__("kernel_ms", r["fitness"]["kernel_ms"] / 2))
            rejected("objective-removed", lambda r: r["fitness"].pop("kernel_ms"))
            rejected("kernel-rows-removed", lambda r: r.pop("kernelBenchmarks"))

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
                 patch("engine.verify.shutil.which", return_value="npm"), patch("engine.verify.subprocess.run", side_effect=run), \
                 patch("scripts.verification_guard.guarded_entry"), patch.dict("os.environ"):
                self.assertEqual(verify_main(), 1)
            report = read_json(path)
            self.assertIs(report["passed"], False)
            timed_out = report["checks"][-1]
            self.assertIn("12 adversaries rejected", timed_out["stdout"])
            self.assertIn("partial diagnostic", timed_out["stderr"])

    @requires_gpu
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
