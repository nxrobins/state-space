"""Bounded evolution of actual ca-v3 kernels, with immutable composed evaluation.

Evaluate local candidates first. Search only makes paid calls when explicitly
invoked with --mutations and --model. Staging re-evaluates exact source and emits
a reviewable patch; search never overwrites production winners.
"""

import argparse
import difflib
import os
import random
from pathlib import Path

from engine.compositor import CompositionEngine
from engine.sources import ShaderBundle
from engine.wgsl_fixer import strip_entry_points_and_bindings
from eval.archive import Archive as Archive, Candidate as Candidate
from eval.benchmark import benchmark_engine
from eval.evaluator import accepted_receipt, evaluate_candidate
from eval.policy import (ALIASES, OBJECTIVES, TARGETS, EvaluationConfig, acceptance_errors, canonical, constraints, digest, target_name)
from eval.provenance import ROOT, capture_context, read_immutable, write_immutable


PHASE_CONFIG = {alias: {"target": target, "objectives": list(OBJECTIVES), "hard_constraints": constraints(target)}
                for alias, target in {**{target: target for target in TARGETS}, **ALIASES}.items()}


def check_hard_constraints(fitness: dict, phase_config: dict) -> bool:
    """Compatibility for callers: current strict metrics, not ca-v1 scores."""
    target = phase_config.get("target")
    return target in TARGETS and not acceptance_errors(fitness, target)


def baseline_source(target: str) -> str:
    target = target_name(target)
    source = ShaderBundle.load().kernel(TARGETS[target])
    return strip_entry_points_and_bindings(source) if target == "codec" else source


def stage_candidate(directory: Path, receipt: str, output: Path, config: EvaluationConfig) -> dict:
    old = read_immutable(directory, receipt)
    source = read_immutable(directory, old["sourceHash"], ".wgsl")
    target = target_name(old["target"])
    # A historical receipt is input provenance only. Re-run against today's engine/device.
    report = evaluate_candidate(source, target, directory, config)
    context = capture_context()
    if accepted_receipt(directory, report["receipt"], source, target, context, config) is None:
        raise ValueError(f"Fresh staging evaluation failed: {report['errors']}")
    filename = TARGETS[target]
    before = (ROOT / "locked" / filename).read_text(encoding="utf-8")
    patch = "".join(difflib.unified_diff(before.splitlines(keepends=True), source.splitlines(keepends=True),
                                        fromfile=f"a/locked/{filename}", tofile=f"b/locked/{filename}"))
    staged = {"target": target, "receipt": report["receipt"], "sourceHash": digest(source), "baseHash": digest(before),
              "patch": patch, "context": context,
              "instructions": "Apply the patch, regenerate assets with python -m engine.generate, then run python -m engine.verify. Staging is not a speedup claim or a release."}
    # Exact source plus base hash is authoritative even if a source lacks a final newline.
    staged["source"] = source
    key = write_immutable(output, staged)
    return {"staged": key, "receipt": report["receipt"], "patchEmpty": not bool(patch)}


def mutate_with_llm(parents: list[Candidate], target: str, model: str, seed: int) -> tuple[str, dict]:
    """An optional proposal source, with no authority to score, admit, or promote."""
    import anthropic
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise RuntimeError("Set ANTHROPIC_API_KEY to explicitly enable the requested paid mutation call")
    sources = ShaderBundle.load()
    prompt = (f"Optimize the {target} kernel of State Space ca-v3. Return only complete WGSL. "
              "Preserve exact packed cells AND energyQ after every composed pass. This is an optimization, not a new physical law. "
              "Storage bindings and the schedule are host owned. Physics entries use @workgroup_size(16,16). "
              "Use io_copy/io_write for both output arrays. Codec candidates contain pack_voxel, unpack_voxel, exchange_thermal helpers only. "
              "No barriers, while/loop, or data-dependent for loops. A for loop may use var i=0u; i<4u; i+=1u with an unchanged induction variable. "
              f"Exploration seed: {seed}. Parent candidates:\n" + "\n\n".join(parent.source for parent in parents) +
              "\n\nHost sources (immutable):\n" + "\n".join(value for _, value in sources.shaders))
    client = anthropic.Anthropic(api_key=key, timeout=60, max_retries=0)
    response = client.messages.create(model=model, max_tokens=8192, messages=[{"role": "user", "content": prompt}])
    raw = "\n".join(block.text for block in response.content if block.type == "text")
    source = raw.strip()
    if source.startswith("```wgsl\n") and source.endswith("```"):
        source = source[len("```wgsl\n"):-3].strip() + "\n"
    return source, {"model": model, "requestId": response.id, "promptHash": digest(prompt), "rawResponse": raw,
                    "seed": seed, "usage": response.usage.model_dump()}


def run_search(target: str, candidates: list[Path], directory: Path, config: EvaluationConfig,
               mutations: int = 0, model: str | None = None) -> dict:
    target = target_name(target)
    if type(mutations) is not int or not 0 <= mutations <= 100 or (mutations and not model):
        raise ValueError("Search requires a bounded mutation count and an explicit model for paid proposals")
    if len(candidates) > 100:
        raise ValueError("At most 100 local proposals may be evaluated per search")
    context = capture_context()
    evidence = directory / "evidence"
    archive_path = directory / f"{target}-archive.json"
    archive = Archive.load(archive_path, target=target, directory=evidence, context=context, config=config)
    proposals = [(baseline_source(target), "current production baseline")]
    proposals.extend((path.read_text(encoding="utf-8"), str(path)) for path in candidates)
    evaluated = []
    rng = random.Random(config.seed)
    for generation in range(len(proposals) + mutations):
        if capture_context() != context:
            raise ValueError("Engine/device context changed during search; start a new run")
        parents = []
        if generation < len(proposals):
            source, description = proposals[generation]
        else:
            parents = archive.select_parents(3)
            if not parents:
                raise ValueError("No currently qualified parents; search stopped without requesting mutations")
            rng.shuffle(parents)
            source, proposal = mutate_with_llm(parents, target, model, rng.randrange(2**32))
            description = write_immutable(evidence, proposal)
        report = evaluate_candidate(source, target, evidence, config)
        candidate = Candidate(id=digest(source), generation=generation, phase=target,
                              parent_ids=[parent.id for parent in parents], mutation_description=description,
                              evolvable_code={"_full_shader": source}, receipt=report["receipt"])
        archive.add(candidate)
        archive.save(archive_path)
        evaluated.append({"sourceHash": candidate.id, "passed": report["passed"], "receipt": report["receipt"], "errors": report["errors"]})
        print(f"Trial {generation + 1}/{len(proposals) + mutations}: {'PASS' if report['passed'] else 'REJECT'} {candidate.id[:12]}", flush=True)
    summary = {"target": target, "seed": config.seed, "evaluated": evaluated,
               "parents": [candidate.id for candidate in archive.select_parents(3)],
               "note": "Ranks compare measured objectives within this context; timing noise requires confirmation before claiming a speedup."}
    summary["receipt"] = write_immutable(evidence, summary)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("evaluate", "search", "stage", "benchmark"))
    parser.add_argument("--target", "--phase", choices=tuple(TARGETS) + tuple(ALIASES))
    parser.add_argument("--candidate", type=Path, action="append", default=[])
    parser.add_argument("--output", type=Path, default=ROOT / "evolution-v2")
    parser.add_argument("--receipt")
    parser.add_argument("--mutations", type=int, default=0)
    parser.add_argument("--model")
    parser.add_argument("--seed", type=int, default=8173)
    parser.add_argument("--warmup", type=int, default=2)
    parser.add_argument("--samples", type=int, default=7)
    args = parser.parse_args()
    config = EvaluationConfig(seed=args.seed, warmup=args.warmup, samples=args.samples)
    if args.command in ("evaluate", "search") and args.target is None:
        parser.error("--target is required")
    if args.command == "evaluate":
        if len(args.candidate) > 1:
            parser.error("evaluate accepts one candidate; use search for a bounded set")
        source = args.candidate[0].read_text(encoding="utf-8") if args.candidate else baseline_source(args.target)
        report = evaluate_candidate(source, args.target, args.output / "evidence", config)
        print(canonical({key: report[key] for key in ("passed", "receipt", "fitness", "errors")}).decode())
        return int(not report["passed"])
    if args.command == "search":
        result = run_search(args.target, args.candidate, args.output, config, args.mutations, args.model)
    elif args.command == "stage":
        if not args.receipt:
            parser.error("stage requires --receipt")
        result = stage_candidate(args.output / "evidence", args.receipt, args.output / "staged", config)
    else:
        context = capture_context()
        with CompositionEngine() as engine:
            rows = benchmark_engine(engine, config, shapes=((32, 32), (128, 128), (257, 129), (512, 512)))
        if context != capture_context():
            raise ValueError("Benchmark context changed during measurement")
        result = {"context": context, "config": config.to_dict(), "rows": rows,
                  "measurement": "Host wall time including GPU completion; end-to-end includes allocation, uploads, and full-state readback. Not GPU timestamp timing."}
        result["receipt"] = write_immutable(args.output / "evidence", result)
    print(canonical(result).decode())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
