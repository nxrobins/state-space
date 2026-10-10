"""Measure complete native public calls, and save exact-state performance evidence.

Example: python -m scripts.benchmark_gpu --output receipt.json
Optional --baseline-compositor points to a preserved previous compositor.py.
Compilation, seeding, snapshots and hashing are outside the timed public calls.
Every measured call includes support, validation, uploads, dispatch and readback.
"""
import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from engine.compositor import CompositionEngine
from engine.contracts import Snapshot
from engine.field import Field
from engine.registry import MaterialRegistry, DEFAULT_REGISTRY
from engine.schema import VoxelState, pack_voxel
from engine.state import seed_state
from engine.structure import ANCHOR
from engine.structure_bulk import seed_structure_bulk
from engine.verify import source_hashes
from eval.benchmark import benchmark_engine, distribution, state_digest
from eval.scenes import KINDS, workload


def scenes(seed, ticks):
    result = [workload(256, 256, kind, seed + i, ticks) for i, kind in enumerate(KINDS)]
    for kind in ("supported-metal", "falling-plate", "long-support-path"):
        width = height = 256
        grid = np.full(width * height, pack_voxel(VoxelState(0, 20, 0, 0, 4, 0)), dtype=np.uint32)
        metal = pack_voxel(VoxelState(5, 20, 0, 0, 0, 0))
        view = grid.reshape(height, width)
        if kind == "supported-metal":
            view[:] = metal
        elif kind == "falling-plate":
            view[16:144, 16:240] = metal
        else:
            view[0:253:2, :] = metal
            for y in range(1, 252, 2):
                view[y, width - 1 if y // 2 % 2 == 0 else 0] = metal
        grid, energy = seed_state(grid, DEFAULT_REGISTRY._model)
        words = seed_structure_bulk(grid, width, height, DEFAULT_REGISTRY._structure)
        if kind == "long-support-path":
            words[0] |= ANCHOR
        result.append({"name": kind, "width": width, "height": height, "ticks": ticks, "tick": 17,
                       "catalog": DEFAULT_REGISTRY.to_dict(), "cells": grid.tolist(), "energyQ": energy.tolist(), "structure": words.tolist()})
    return result


def public_steps(engine, scene, ticks, warmup):
    registry = MaterialRegistry(scene["catalog"])
    with Field(scene["width"], scene["height"], registry=registry, engine=engine) as field:
        field.restore(Snapshot(scene["width"], scene["height"], scene["tick"], scene["cells"], scene["energyQ"], scene["structure"], registry=registry))
        values = []
        first_tick_ms = first_tick_hash = None
        for tick in range(warmup + ticks):
            started = time.perf_counter()
            field.step(1)
            elapsed = (time.perf_counter() - started) * 1000
            if tick == 0:
                first_tick_ms = elapsed
                first_tick_hash = state_digest(field.grid, field.energy_q, field.structure)
            if tick >= warmup:
                values.append(elapsed)
        final = field.snapshot()
        if sum(int(e) for e in final.energy_q) != sum(scene["energyQ"]):
            raise ValueError("Public-step benchmark energy drift")
        return {"scene": scene["name"], "width": scene["width"], "height": scene["height"], "startTick": scene["tick"],
                "ticks": ticks, "warmup": warmup, "publicStepMs": distribution(values),
                "firstTickMs": first_tick_ms, "firstTickHash": first_tick_hash,
                "finalHash": state_digest(final.packed_cells, final.energy_q, final.structure), "endTick": field.tick}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--baseline-compositor", type=Path)
    parser.add_argument("--browser-scenes", type=Path)
    parser.add_argument("--seed", type=int, default=20261010)
    args = parser.parse_args()
    before = source_hashes()
    config = SimpleNamespace(seed=args.seed, ticks=4, warmup=2, samples=7)
    report = {"reportVersion": 1, "startedAt": datetime.now(timezone.utc).isoformat(), "config": vars(config),
              "sourceHashes": before, "runtime": {"python": sys.version, "platform": platform.platform(),
                  **{name: importlib.metadata.version(name) for name in ("numpy", "wgpu", "wasmtime")}}}
    all_scenes = scenes(args.seed, config.ticks)
    if args.browser_scenes:
        args.browser_scenes.parent.mkdir(parents=True, exist_ok=True)
        args.browser_scenes.write_text(json.dumps(all_scenes, allow_nan=False), encoding="utf-8")
    with CompositionEngine(256, 256) as engine:
        report["adapter"] = dict(engine.adapter.info)
        report["optimized"] = benchmark_engine(engine, config, shapes=((256, 256),),
            on_row=lambda r: print(r["scene"], "completed tick", round(r["syncTickMs"]["median"], 3), flush=True))
        report["publicSteps"] = []
        for scene in all_scenes:
            row = public_steps(engine, scene, 60, 4)
            report["publicSteps"].append(row)
            print(row["scene"], "public step median/p95", round(row["publicStepMs"]["median"], 3), round(row["publicStepMs"]["p95"], 3), flush=True)
    if args.baseline_compositor:
        path = args.baseline_compositor.resolve()
        spec = importlib.util.spec_from_file_location("baseline_compositor", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        report["baselineCompositorHash"] = hashlib.sha256(path.read_bytes()).hexdigest()
        with module.CompositionEngine(256, 256) as engine:
            report["baseline"] = benchmark_engine(engine, config, shapes=((256, 256),))
        for a, b in zip(report["baseline"], report["optimized"]):
            if any(a[key] != b[key] for key in ("scene", "seed", "initialHash", "finalHash", "energyQ", "startTick", "ticks")):
                raise ValueError("Baseline and optimized complete states differ")
        report["baselineParity"] = True
    report["sourceUnchangedDuringBenchmark"] = before == source_hashes()
    if not report["sourceUnchangedDuringBenchmark"]:
        raise ValueError("Sources changed during performance measurement")
    report["finishedAt"] = datetime.now(timezone.utc).isoformat()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
