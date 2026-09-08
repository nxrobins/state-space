"""Repeatable C6 scalar/bulk host-planner comparison; excludes GPU and full ticks."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import statistics
import sys
import time

import numpy as np

from engine.structure import plan_structure
from engine.structure_bulk import plan_structure_bulk
from engine.structure_conformance import fixture, source_hashes


def _hash_plan(plan, state):
    digest = hashlib.sha256()
    for name in ("sources", "structure", "loads", "capacities", "reactions", "distances"):
        digest.update(np.asarray(getattr(plan, name), dtype="<i8").tobytes())
    for array in plan.apply(*state, width=plan.width, height=plan.height):
        digest.update(np.asarray(array, dtype="<u4").tobytes())
    digest.update(json.dumps({"width": plan.width, "height": plan.height, "supportedWeight": plan.supported_weight,
                             "components": [(row.id, row.cells, row.moving, row.anchored) for row in plan.components]},
                            separators=(",", ":"), allow_nan=False).encode())
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    before = source_hashes()
    benchmark_source = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    report = {"scope": "C6 standalone host planners only; not production tick or browser throughput",
              "startedAt": datetime.now(timezone.utc).isoformat(), "warmups": 2, "samples": 5,
              "sourceHashes": before, "benchmarkSourceHash": benchmark_source,
              "runtime": {"python": sys.version, "numpy": np.__version__, "platform": platform.platform(),
                          "processor": platform.processor(), "logicalCpus": os.cpu_count()}, "rows": []}
    for width in (32, 128, 256):
        for kind in ("sparse", "dense"):
            placements = [(x, y, 5) for y in range(width) for x in range(width) if kind == "dense" or (8 <= x < 16 and 4 <= y < 6)]
            case, rules = fixture(kind, width, width, placements)
            state = tuple(np.array(case[key], dtype=np.uint32) for key in ("cells", "energyQ", "structure"))
            expected_hash = _hash_plan(plan_structure(*state, width, width, rules), state)
            input_hash = hashlib.sha256(json.dumps(case, separators=(",", ":"), sort_keys=True, allow_nan=False).encode()).hexdigest()
            results = {"scalar": [], "bulk": []}
            planners = [("scalar", plan_structure), ("bulk", plan_structure_bulk)]
            for repeat in range(report["warmups"] + report["samples"]):
                # Alternate order to reduce systematic ordering bias.
                for label, planner in planners if repeat % 2 == 0 else list(reversed(planners)):
                    start = time.perf_counter()
                    plan = planner(*state, width, width, rules)
                    elapsed = (time.perf_counter() - start) * 1000
                    if _hash_plan(plan, state) != expected_hash:
                        raise RuntimeError("A planner result changed during repeated measurement")
                    if repeat >= report["warmups"]:
                        results[label].append(elapsed)
            row = {"width": width, "height": width, "kind": kind, "inputHash": input_hash, "fullResultHash": expected_hash,
                   "samplesMs": results, "medianMs": {label: statistics.median(samples) for label, samples in results.items()}}
            row["ratio"] = row["medianMs"]["scalar"] / row["medianMs"]["bulk"]
            report["rows"].append(row)
            print(json.dumps(row, allow_nan=False), flush=True)
    report["sourceUnchanged"] = source_hashes() == before and hashlib.sha256(Path(__file__).read_bytes()).hexdigest() == benchmark_source
    report["finishedAt"] = datetime.now(timezone.utc).isoformat()
    report["passed"] = report["sourceUnchanged"] and len(report["rows"]) == 6
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return int(not report["passed"])


if __name__ == "__main__":
    raise SystemExit(main())
