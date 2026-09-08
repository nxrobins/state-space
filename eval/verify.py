"""Bounded real-GPU adversaries, baseline admission, archive and evidence audit."""

import argparse
import copy
import json
import re
import tempfile
from pathlib import Path

from engine.compositor import CompositionEngine
from eval.archive import Archive, Candidate
from eval.benchmark import benchmark_engine
from eval.evaluator import accepted_receipt, evaluate_candidate
from eval.policy import TARGETS, EvaluationConfig, canonical, digest
from eval.provenance import ROOT, capture_context, context_sources, read_immutable, write_immutable
from evolve_ss import baseline_source, stage_candidate


def noop_source(target):
    source = baseline_source(target)
    overrides = "\n".join(re.findall(r"\boverride\s+[^;]+;", source))
    return overrides + """
@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= GRID_WIDTH || gid.y >= GRID_HEIGHT) { return; }
    let index = gid.y * GRID_WIDTH + gid.x;
    io_copy(index, index);
}
"""


def verify(directory: Path) -> dict:
    config = EvaluationConfig(warmup=1, samples=3)
    context = capture_context()
    evidence = directory / "evidence"
    checks = []
    baselines = {}
    for target in ("thermal", "codec", "structure", "normalize"):
        report = evaluate_candidate(baseline_source(target), target, evidence, config)
        if not report["passed"]:
            raise ValueError(f"Baseline {target} failed: {report['errors']}")
        baselines[target] = report
        checks.append({"name": f"baseline-{target}", "passed": True, "receipt": report["receipt"], "fitness": report["fitness"]})
        print(f"PASS baseline {target}: {report['fitness']['compared_passes']} complete pass comparisons", flush=True)
    mutants = [(f"noop-{target}", target, noop_source(target)) for target in TARGETS if target != "codec"]
    mutants.extend([
        ("created-energy", "thermal", baseline_source("thermal").replace("io_write(index, grid_in[index], energy);", "io_write(index, grid_in[index], energy + 1u);")),
        ("shared-oxidizer", "combustion", baseline_source("combustion").replace("if (chosen_fuel(air) == index)", "if (true)")),
        ("duplicate-chemical-release", "combustion", baseline_source("combustion").replace("energy = state.y - transfer;", "energy = state.y - transfer + property(state.x, 2u);")),
        ("broken-codec-field", "codec", baseline_source("codec").replace("state.material = (packed >> MATERIAL_SHIFT) & MATERIAL_MASK;", "state.material = 0u;")),
    ])
    for name, target, source in mutants:
        if source == baseline_source(target):
            raise ValueError(f"Mutation did not alter code: {name}")
        report = evaluate_candidate(source, target, evidence, config)
        # A syntax error is not a successful behavioral counterexample.
        observed = bool(report.get("firstDifference")) if target != "codec" else report.get("fitness", {}).get("codec_field_errors", 0) > 0
        if report["passed"] or not observed:
            raise ValueError(f"Adversary {name} was not behaviorally rejected: {report['errors']}")
        checks.append({"name": name, "passed": True, "receipt": report["receipt"], "firstDifference": report.get("firstDifference"),
                       "fitness": report["fitness"]})
        print(f"PASS rejected {name} by observed GPU behavior", flush=True)
    source = baseline_source("thermal")
    baseline = baselines["thermal"]
    receipt = baseline["receipt"]
    if accepted_receipt(evidence, receipt, source, "thermal", context, config) is None:
        raise ValueError("Fresh baseline receipt failed admission")
    for name in ("inconsistent-score", "missing-pass-evidence", "missing-timing-row", "missing-structural-reference", "wrong-final-structure-hash"):
        altered = copy.deepcopy(read_immutable(evidence, receipt))
        if name == "inconsistent-score":
            altered["fitness"]["end_to_end_ms"] /= 1000
        elif name == "missing-pass-evidence":
            altered["cases"].pop()
        elif name == "missing-timing-row":
            altered["benchmarks"].pop()
        elif name == "missing-structural-reference":
            inputs = copy.deepcopy(read_immutable(evidence, altered["inputsHash"]))
            del inputs["reference"][0]["passes"][0]["structure"]
            altered["inputsHash"] = write_immutable(evidence, inputs)
        else:
            altered["cases"][0]["finalHash"] = "0" * 64
        altered_key = write_immutable(evidence, altered)
        if accepted_receipt(evidence, altered_key, source, "thermal", context, config) is not None:
            raise ValueError(f"Incomplete or inconsistent fresh report was admitted: {name}")
        checks.append({"name": name, "passed": True, "rejectedReceipt": altered_key})
    for name, other_source, other_target, other_context, other_config in (
        ("code-changed", source + "\n// changed", "thermal", context, config),
        ("target-changed", source, "gravity", context, config),
        ("device-changed", source, "thermal", {**context, "device": {}}, config),
        ("host-changed", source, "thermal", {**context, "runtime": {**context["runtime"], "hostHash": "different-host"}}, config),
        ("policy-changed", source, "thermal", {**context, "policy": "old"}, config),
        ("seed-changed", source, "thermal", context, EvaluationConfig(seed=config.seed + 1, warmup=1, samples=3)),
        ("measurement-changed", source, "thermal", context, EvaluationConfig(warmup=2, samples=3)),
    ):
        if accepted_receipt(evidence, receipt, other_source, other_target, other_context, other_config) is not None:
            raise ValueError(f"Stale evidence was admitted: {name}")
        checks.append({"name": name, "passed": True})
    archive = Archive("thermal", directory=evidence, context=context, config=config, max_size=1)
    valid = Candidate("qualified", phase="thermal", evolvable_code={"_full_shader": source}, receipt=receipt)
    archive.add(valid)
    # Better-looking candidate-owned scores cannot evict a measured qualified parent.
    archive.add(Candidate("forged", phase="thermal", fitness={"end_to_end_ms": .00001, "sync_tick_ms": .00001},
                          evolvable_code={"_full_shader": noop_source("thermal")}))
    if [item.id for item in archive.select_parents()] != [digest(source)]:
        raise ValueError("Unqualified fitness displaced a qualified parent")
    with tempfile.TemporaryDirectory(prefix="state-space-archive-test-") as temp:
        path = Path(temp) / "archive.json"
        archive.save(path)
        reloaded = Archive.load(path, target="thermal", directory=evidence, context=context, config=config, max_size=1)
        if [item.id for item in reloaded.select_parents()] != [digest(source)]:
            raise ValueError("Fresh archive failed restart")
        # Tampered content must be rejected even if every original score was valid.
        tamper_dir = Path(temp) / "tampered"
        tamper_dir.mkdir()
        tampered = copy.deepcopy(read_immutable(evidence, receipt))
        tampered["fitness"]["end_to_end_ms"] /= 1000
        (tamper_dir / (receipt + ".json")).write_bytes(canonical(tampered))
        if accepted_receipt(tamper_dir, receipt, source, "thermal", context, config) is not None:
            raise ValueError("Tampered evidence was admitted")
    historical = {}
    for path in sorted((ROOT / "archive").glob("archive_phase_*.json")):
        old = Archive.load(path, target="thermal", directory=evidence, context=context, config=config)
        historical[path.name] = {"entries": len(old.candidates), "eligible": len(old.select_parents())}
        if old.select_parents():
            raise ValueError("Historical archive bypassed the current gates")
    checks.append({"name": "archive-restart-eviction-tamper-history", "passed": True, "historical": historical})
    # Exercise fresh staging without changing checkout winners. The emitted artifact
    # names the freshly evaluated bytes, their base, and the current context.
    staged = stage_candidate(evidence, receipt, directory / "staged", config)
    if staged["receipt"] == receipt:
        raise ValueError("Staging reused its old evaluation")
    checks.append({"name": "stage-revalidates", "passed": True, **staged})
    if context != capture_context():
        raise ValueError("Verification context changed")
    return {"passed": True, "context": context, "config": config.to_dict(), "checks": checks,
            "note": f"{len(mutants)} behavioral adversaries actually compiled and ran. Rejection was observed in output, not inferred from source."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "docs/checkpoints/latest-evaluation")
    parser.add_argument("--benchmark", action="store_true")
    args = parser.parse_args()
    result = verify(args.output)
    audit_key = write_immutable(args.output / "evidence", result)
    (args.output / "verification.json").write_text(json.dumps({**result, "receipt": audit_key}, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    if args.benchmark:
        config = EvaluationConfig()
        context = capture_context()
        def preserve_row(row):
            key = write_immutable(args.output / "evidence", {"context": context, "config": config.to_dict(), "row": row})
            print(f"BENCH {row['scene']}: {row['endToEndMs']['median']:.3f} ms per four ticks; receipt {key}", flush=True)
        with CompositionEngine() as engine:
            rows = benchmark_engine(engine, config, shapes=((32, 32), (128, 128), (257, 129), (512, 512)), on_row=preserve_row)
        if context != capture_context():
            raise ValueError("Benchmark sources changed")
        sources = context_sources()
        source_key = write_immutable(args.output / "evidence", {"context": context, "sources": sources})
        result["benchmark"] = {"config": config.to_dict(), "context": context, "rows": rows, "sourceBundleHash": source_key,
                               "measurement": "Synchronized host wall time. Compilation and registry construction excluded. End-to-end includes validation, allocation, uploads, structural planning and all three readbacks per tick. Tick time includes planning, upload, dispatch, readback and completed-state validation. PlanningMs isolates the host solve."}
    key = write_immutable(args.output / "evidence", result)
    result["receipt"] = key
    filename = "verification-with-benchmark.json" if args.benchmark else "verification.json"
    (args.output / filename).write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"Evolution audit passed: {len(result['checks'])} checks; receipt {key}")


if __name__ == "__main__":
    main()
