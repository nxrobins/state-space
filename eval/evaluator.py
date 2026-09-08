"""Evaluate exact candidate text in the full ca-v3 pipeline against the CPU law."""

import json
import shutil
import statistics
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from engine.compositor import CompositionEngine, InvalidCompletedState
from engine.schedule import KERNEL_SPECS, movement_schedule_for_tick
from engine.sources import ShaderBundle
from engine.registry import MaterialRegistry
from engine.state import validate_state
from engine.structure import INTERNAL_MASK
from engine.structure_bulk import validate_structure_bulk
from engine.validation import validate_packed
from eval.benchmark import benchmark_engine, distribution, run_scene, state_digest
from eval.codec import codec_trial, codec_vectors
from eval.policy import (POLICY_VERSION, TARGETS, EvaluationConfig, acceptance_errors, candidate_lint,
                         canonical, digest, target_name, target_variants)
from eval.provenance import ROOT, capture_context, context_sources, device_identity, read_immutable, read_json, write_immutable
from eval.scenes import acceptance_cases


def reference_outputs(cases: list[dict]) -> list[dict]:
    result = subprocess.run([shutil.which("node"), str(ROOT / "eval/reference.mjs")], input=canonical(cases).decode(),
                            capture_output=True, text=True, encoding="utf-8", timeout=60, check=True)
    output = json.loads(result.stdout)
    if len(output) != len(cases) or not cases:
        raise ValueError("Incomplete CPU reference evidence")
    return output


def validate_reference_evidence(scene: dict, reference: dict):
    """Validate retained reference contents, not just their file hash or case count."""
    order = [(tick, name) for tick in range(scene["tick"], scene["tick"] + scene["ticks"])
             for name in movement_schedule_for_tick(tick)]
    if (set(reference) != {"name", "passes"} or reference["name"] != scene["name"]
            or not isinstance(reference["passes"], list) or len(reference["passes"]) != len(order)):
        raise ValueError("Incomplete reference evidence")
    registry = MaterialRegistry(scene["catalog"])
    count = scene["width"] * scene["height"]
    final = None
    for frame, (tick, name) in zip(reference["passes"], order):
        if (set(frame) != {"tick", "id", "cells", "energyQ", "structure"} or type(frame["tick"]) is not int
                or (frame["tick"], frame["id"]) != (tick, name)):
            raise ValueError("Incomplete or misordered three-coordinate reference")
        cells, energy = validate_state(frame["cells"], frame["energyQ"], count, registry._model)
        structure = validate_packed(frame["structure"], count, "reference structure")
        if np.any(structure > INTERNAL_MASK) or sum(int(value) for value in energy) != sum(scene["energyQ"]):
            raise ValueError("Invalid reference state or energy budget")
        if name == "normalize":
            validate_structure_bulk(cells, energy, structure, scene["width"], scene["height"], registry._structure)
        final = cells, energy, structure
    if final is None:
        raise ValueError("Empty reference evidence")
    return final


def compare_passes(scene, reference, result, target: str) -> dict:
    """Trace length, ordering, all three arrays, budgets, and positive behavior are mandatory."""
    expected_order = [(tick, name) for tick in range(scene["tick"], scene["tick"] + scene["ticks"])
                      for name in movement_schedule_for_tick(tick)]
    packed, energies, words, expected = result["pass_snapshots"], result["pass_energy_snapshots"], result.get("pass_structure_snapshots", []), reference["passes"]
    if (reference["name"] != scene["name"] or len(packed) != len(expected_order) or len(energies) != len(expected_order) or len(words) != len(expected_order)
            or [(p["tick"], p["id"]) for p in expected] != expected_order
            or [(tick, name) for tick, name, _ in packed] != expected_order
            or [(tick, name) for tick, name, _ in energies] != expected_order
            or [(tick, name) for tick, name, _ in words] != expected_order):
        raise ValueError("Missing or misordered composed/reference pass evidence")
    budget = sum(scene["energyQ"])
    positive, first_difference = set(), None
    mismatches = drift = counts = 0
    before_grid = np.array(scene["cells"], dtype=np.uint32)
    before_energy = np.array(scene["energyQ"], dtype=np.uint32)
    before_structure = np.array(scene["structure"], dtype=np.uint32)
    target_ids = target_variants(target)
    for (_, name, grid), (_, _, energy), (_, _, structure), expected_pass in zip(packed, energies, words, expected):
        ref_grid, ref_energy = np.array(expected_pass["cells"], dtype=np.uint32), np.array(expected_pass["energyQ"], dtype=np.uint32)
        ref_structure = np.array(expected_pass["structure"], dtype=np.uint32)
        if any(value.shape != before_grid.shape for value in (grid, energy, structure, ref_grid, ref_energy, ref_structure)):
            raise ValueError("Invalid composed trace dimensions")
        changed = (grid != ref_grid) | (energy != ref_energy) | (structure != ref_structure)
        mismatches += int(np.count_nonzero(changed))
        drift += abs(sum(int(value) for value in energy) - budget)
        if np.any(changed) and first_difference is None:
            index = int(np.flatnonzero(changed)[0])
            first_difference = {"scene": scene["name"], "tick": expected_pass["tick"], "pass": name, "index": index,
                                "expected": [int(ref_grid[index]), int(ref_energy[index]), int(ref_structure[index])], "actual": [int(grid[index]), int(energy[index]), int(structure[index])]}
        if name in target_ids:
            if np.any(grid != before_grid) or np.any(energy != before_energy) or np.any(structure != before_structure):
                positive.add(name)
            if target in ("thermal", "gravity", "diagonal", "liquid", "buoyancy", "spread", "structure", "normalize"):
                counts += int(np.sum(np.abs(np.bincount(grid & 255, minlength=256) - np.bincount(before_grid & 255, minlength=256))))
        before_grid, before_energy, before_structure = grid, energy, structure
    if (not np.array_equal(before_grid, result["final_grid"]) or not np.array_equal(before_energy, result["final_energy"])
            or not np.array_equal(before_structure, result["final_structure"])):
        raise ValueError("Final state disagrees with the last composed pass")
    return {"composed_mismatches": mismatches, "energy_drift_q": drift, "material_count_errors": counts,
            "compared_passes": len(expected_order), "positive": positive, "firstDifference": first_difference}


def execute_candidate(source: str, target: str, config: EvaluationConfig, context: dict) -> tuple[dict, dict]:
    """Worker implementation. Public callers use the time-bounded parent wrapper."""
    target = target_name(target)
    report = {"policy": POLICY_VERSION, "target": target, "sourceHash": digest(source), "context": context,
              "config": config.to_dict(), "startedAt": datetime.now(timezone.utc).isoformat(), "passed": False,
              "fitness": {}, "errors": [], "cases": [], "compiledHashes": {}}
    evidence = {}
    try:
        errors = candidate_lint(source, target)
        if errors:
            raise ValueError("; ".join(errors))
        if context != capture_context():
            raise ValueError("Evaluation context changed before the worker started")
        sources = ShaderBundle.load().replace_kernel(TARGETS[target], source)
        cases = acceptance_cases(config.seed)
        refs = reference_outputs(cases)
        evidence = {"inputsHash": {"cases": cases, "reference": refs},
                    "shaderBundleHash": {"kernels": sources.kernels, "shaders": sources.shaders}}
        report.update({name: digest(canonical(value)) for name, value in evidence.items()})
        positive = set()
        fitness = {name: 0 for name in ("composed_mismatches", "energy_drift_q", "material_count_errors", "compared_passes",
                                        "determinism_mismatches", "restart_mismatches")}
        report["fitness"] = fitness
        with CompositionEngine(sources=sources) as engine:
            if device_identity(engine.adapter) != context["device"]:
                raise ValueError("Worker selected a different GPU device")
            if target == "codec":
                codec = codec_trial(engine.device, source, codec_vectors(config.seed), warmup=config.warmup, samples=config.samples)
                report["codec"] = codec
                fitness.update({name: codec[name] for name in ("codec_field_errors", "codec_pack_errors", "codec_exchange_errors")})
                if any(fitness[name] for name in ("codec_field_errors", "codec_pack_errors", "codec_exchange_errors")):
                    raise ValueError("Codec helper output disagrees with the independent host reference")
            for scene, reference in zip(cases, refs):
                try:
                    result = run_scene(engine, scene, trace=True)
                except InvalidCompletedState as error:
                    # A completed GPU readback can fail validation before a normal
                    # result exists. Retain its actual coordinates and first mismatch;
                    # a compiler error never creates this behavioral evidence.
                    expected = next(value for value in reference["passes"] if value["tick"] == error.tick and value["id"] == "normalize")
                    wanted = [np.asarray(expected[key], dtype=np.uint32) for key in ("cells", "energyQ", "structure")]
                    changed = np.logical_or.reduce([a != b for a, b in zip(error.state, wanted)])
                    if not np.any(changed):
                        raise ValueError("Reference also produced invalid completed state") from error
                    index = int(np.flatnonzero(changed)[0])
                    fitness["composed_mismatches"] += int(np.count_nonzero(changed))
                    report["firstDifference"] = {"scene": scene["name"], "tick": error.tick, "pass": "normalize", "index": index,
                                                 "expected": [int(values[index]) for values in wanted], "actual": [int(values[index]) for values in error.state]}
                    report["invalidOutput"] = {"reason": str(error), "scene": scene["name"], "tick": error.tick,
                                               **{key: values.tolist() for key, values in zip(("cells", "energyQ", "structure"), error.state)}}
                    report["compiledHashes"].update({name: digest(text) for name, text in engine.kernel_sources.items()})
                    raise
                for name, full_source in engine.kernel_sources.items():
                    report["compiledHashes"][name] = digest(full_source)
                checked = compare_passes(scene, reference, result, target)
                positive.update(checked.pop("positive"))
                first_difference = checked.pop("firstDifference")
                for key, value in checked.items():
                    fitness[key] += value
                report["cases"].append({"name": scene["name"], "initialHash": state_digest(scene["cells"], scene["energyQ"], scene["structure"]),
                                        "finalHash": state_digest(result["final_grid"], result["final_energy"], result["final_structure"]), **checked})
                if first_difference is not None or checked["energy_drift_q"] or checked["material_count_errors"]:
                    report["firstDifference"] = first_difference
                    raise ValueError("Candidate failed composed CPU equivalence or a phase-specific budget")
                repeated = run_scene(engine, scene)
                fitness["determinism_mismatches"] += int(np.count_nonzero(repeated["final_grid"] != result["final_grid"]))
                fitness["determinism_mismatches"] += int(np.count_nonzero(repeated["final_energy"] != result["final_energy"]))
                fitness["determinism_mismatches"] += int(np.count_nonzero(repeated["final_structure"] != result["final_structure"]))
                split = scene["ticks"] // 2
                first = run_scene(engine, scene, ticks=split)
                resumed = run_scene(engine, scene, ticks=scene["ticks"] - split, start_tick=scene["tick"] + split,
                                    grid=first["final_grid"], energy=first["final_energy"], structure=first["final_structure"])
                fitness["restart_mismatches"] += int(np.count_nonzero(resumed["final_grid"] != result["final_grid"]))
                fitness["restart_mismatches"] += int(np.count_nonzero(resumed["final_energy"] != result["final_energy"]))
                fitness["restart_mismatches"] += int(np.count_nonzero(resumed["final_structure"] != result["final_structure"]))
            fitness["positive_variants"] = len(positive)
            report["positiveVariants"] = sorted(positive)
            if positive != target_variants(target):
                raise ValueError("Each target variant must perform observable physics in the acceptance corpus")
            if set(report["compiledHashes"]) != {spec.id for spec in KERNEL_SPECS}:
                raise ValueError("Incomplete production pipeline compilation")
            report["benchmarks"] = benchmark_engine(engine, config)
            fitness["end_to_end_ms"] = statistics.mean(row["endToEndMs"]["median"] for row in report["benchmarks"])
            fitness["sync_tick_ms"] = statistics.mean(row["syncTickMs"]["median"] for row in report["benchmarks"])
            report["errors"] = acceptance_errors(fitness, target)
            report["passed"] = not report["errors"]
    except Exception as error:
        report["passed"] = False
        report["errors"].append(f"{type(error).__name__}: {error}")
    if context != capture_context():
        report["passed"] = False
        report["errors"].append("Evaluation sources, runtime, or device changed during the trial")
    report["finishedAt"] = datetime.now(timezone.utc).isoformat()
    return report, evidence


def evaluate_candidate(source: str, target: str, directory: Path, config: EvaluationConfig = EvaluationConfig()) -> dict:
    """Freeze exact text and context, bound the worker, and preserve immutable evidence."""
    target = target_name(target)
    context = capture_context()
    sources = context_sources()
    if {name: digest(value) for name, value in sources.items()} != context["sourceHashes"]:
        raise ValueError("Sources changed while capturing evaluation context")
    write_immutable(directory, source, ".wgsl")
    source_bundle_hash = write_immutable(directory, {"context": context, "sources": sources})
    with tempfile.TemporaryDirectory(prefix="state-space-evaluation-") as temp:
        request, output = Path(temp) / "request.json", Path(temp) / "output.json"
        request.write_bytes(canonical({"source": source, "target": target, "config": config.to_dict(), "context": context}))
        try:
            process = subprocess.run([sys.executable, "-m", "eval.worker", str(request), str(output)], cwd=ROOT,
                                     capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=config.timeout_seconds, check=False)
            if process.returncode != 0 or not output.exists():
                raise RuntimeError(f"Candidate worker failed ({process.returncode}): {process.stderr[-3000:]}")
            payload = read_json(output)
            report = payload["report"]
            for name, value in payload["evidence"].items():
                key = write_immutable(directory, value)
                if report.get(name) != key:
                    raise ValueError("Worker evidence identity mismatch")
            report["workerLogHash"] = write_immutable(directory, {"stdout": process.stdout, "stderr": process.stderr})
        except (subprocess.TimeoutExpired, RuntimeError, ValueError, KeyError, OSError) as error:
            report = {"policy": POLICY_VERSION, "target": target, "sourceHash": digest(source), "context": context,
                      "config": config.to_dict(), "passed": False, "fitness": {}, "errors": [str(error)]}
    report["sourceBundleHash"] = source_bundle_hash
    if context != capture_context():
        report["passed"] = False
        report["errors"].append("Parent context changed during evaluation")
    key = write_immutable(directory, report)
    return {**report, "receipt": key}


def accepted_receipt(directory: Path, key: str, source: str, target: str, context: dict, config: EvaluationConfig) -> dict | None:
    """Historical, altered, incomplete, or differently measured scores are ineligible."""
    try:
        report = read_immutable(directory, key)
        if (report.get("passed") is not True or report.get("policy") != POLICY_VERSION or report.get("context") != context
                or report.get("config") != config.to_dict() or report.get("sourceHash") != digest(source)
                or report.get("target") != target_name(target) or acceptance_errors(report.get("fitness"), target)):
            return None
        if read_immutable(directory, report["sourceHash"], ".wgsl") != source:
            return None
        bundle = read_immutable(directory, report["sourceBundleHash"])
        if (bundle["context"] != context or {name: digest(value) for name, value in bundle["sources"].items()} != context["sourceHashes"]):
            return None
        inputs = read_immutable(directory, report["inputsHash"])
        if len(report["cases"]) != len(inputs["cases"]) or not report["cases"]:
            return None
        if canonical(inputs["cases"]) != canonical(acceptance_cases(config.seed)):
            return None
        if len(inputs["reference"]) != len(inputs["cases"]):
            return None
        for scene, reference, recorded in zip(inputs["cases"], inputs["reference"], report["cases"]):
            final = validate_reference_evidence(scene, reference)
            if (recorded["name"] != scene["name"]
                    or recorded["initialHash"] != state_digest(scene["cells"], scene["energyQ"], scene["structure"])
                    or recorded["finalHash"] != state_digest(*final)
                    or recorded["compared_passes"] != len(reference["passes"])
                    or any(type(recorded[key]) is not int or recorded[key] != 0 for key in ("composed_mismatches", "energy_drift_q", "material_count_errors"))):
                return None
        compared = sum(scene["ticks"] * len(movement_schedule_for_tick(scene["tick"])) for scene in inputs["cases"])
        if report["fitness"]["compared_passes"] != compared or sum(case["compared_passes"] for case in report["cases"]) != compared:
            return None
        if set(report["compiledHashes"]) != {spec.id for spec in KERNEL_SPECS}:
            return None
        if set(report["positiveVariants"]) != target_variants(target):
            return None
        shader_bundle = read_immutable(directory, report["shaderBundleHash"])
        expected_bundle = ShaderBundle.load().replace_kernel(TARGETS[target_name(target)], source)
        if canonical(shader_bundle) != canonical({"kernels": expected_bundle.kernels, "shaders": expected_bundle.shaders}):
            return None
        rows = report["benchmarks"]
        expected_shapes = [(width, height) for width, height in ((32, 32), (65, 33)) for _ in range(4)]
        if [(row["width"], row["height"]) for row in rows] != expected_shapes:
            return None
        for row in rows:
            if row["warmup"] != config.warmup or row["ticks"] != config.ticks:
                return None
            for metric in ("endToEndMs", "syncTickMs", "planningMs"):
                if row[metric]["count"] != config.samples or distribution(row[metric]["samples"]) != row[metric]:
                    return None
        if (report["fitness"]["end_to_end_ms"] != statistics.mean(row["endToEndMs"]["median"] for row in rows)
                or report["fitness"]["sync_tick_ms"] != statistics.mean(row["syncTickMs"]["median"] for row in rows)):
            return None
        return report
    except (ValueError, TypeError, KeyError, OSError):
        return None
