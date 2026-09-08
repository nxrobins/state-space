"""Synchronized host timings of the actual composed workload, with distributions."""

import math
import statistics
import time

import numpy as np

from engine.registry import MaterialRegistry
from eval.policy import digest
from eval.scenes import KINDS, workload


def distribution(samples: list[float]) -> dict:
    if len(samples) < 3 or any(type(value) not in (int, float) or not math.isfinite(value) or value <= 0 for value in samples):
        raise ValueError("Timings require at least three finite positive observations")
    values = sorted(samples)
    return {"samples": list(samples), "count": len(values), "min": values[0], "max": values[-1],
            "median": statistics.median(values), "mean": statistics.mean(values),
            "p95": values[math.ceil(.95 * len(values)) - 1], "stdev": statistics.pstdev(values)}


def synchronized_sample(queue, dispatch, sync_buffer) -> float:
    # Drain earlier work BEFORE the clock, then include completion in this sample.
    queue.read_buffer(sync_buffer, size=4)
    start = time.perf_counter()
    dispatch()
    queue.read_buffer(sync_buffer, size=4)
    return (time.perf_counter() - start) * 1000


def state_digest(grid, energy, structure) -> str:
    return digest(b"".join(np.asarray(values, dtype="<u4").tobytes() for values in (grid, energy, structure)))


def run_scene(engine, scene: dict, *, trace: bool = False, ticks=None, start_tick=None, grid=None, energy=None, structure=None) -> dict:
    if len({value is None for value in (grid, energy, structure)}) != 1:
        raise ValueError("Continuation requires all three state coordinates")
    registry = MaterialRegistry(scene["catalog"])
    return engine.run(np.array(scene["cells"] if grid is None else grid, dtype=np.uint32), registry.cold_table(),
                      scene["width"], scene["height"], n_ticks=scene["ticks"] if ticks is None else ticks,
                      start_tick=scene["tick"] if start_tick is None else start_tick, trace_passes=trace,
                      initial_energy=np.array(scene["energyQ"] if energy is None else energy, dtype=np.uint32), registry=registry,
                      initial_structure=np.array(scene["structure"] if structure is None else structure, dtype=np.uint32))


def benchmark_engine(engine, config, shapes=((32, 32), (65, 33)), *, on_row=None) -> list[dict]:
    rows = []
    for width, height in shapes:
        engine._compile_pipelines(width, height)  # Compilation excluded, source hashes recorded separately.
        for kind_index, kind in enumerate(KINDS):
            scene = workload(width, height, kind, config.seed + kind_index, config.ticks)
            initial_hash = state_digest(scene["cells"], scene["energyQ"], scene["structure"])
            registry = MaterialRegistry(scene["catalog"])
            cold = registry.cold_table()
            grid = np.array(scene["cells"], dtype=np.uint32)
            energy = np.array(scene["energyQ"], dtype=np.uint32)
            structure = np.array(scene["structure"], dtype=np.uint32)
            expected_hash = None
            end_to_end, per_tick, planning = [], [], []
            initial_energy = sum(scene["energyQ"])
            for sample in range(config.warmup + config.samples):
                start = time.perf_counter()
                result = engine.run(grid, cold, width, height, n_ticks=config.ticks, start_tick=scene["tick"],
                                    initial_energy=energy, initial_structure=structure, registry=registry)
                # run includes planning, synchronized ticks and all three readbacks.
                elapsed = (time.perf_counter() - start) * 1000
                output_hash = state_digest(result["final_grid"], result["final_energy"], result["final_structure"])
                if expected_hash is not None and expected_hash != output_hash:
                    raise ValueError(f"Nondeterministic benchmark: {scene['name']}")
                if sum(int(value) for value in result["final_energy"]) != initial_energy:
                    raise ValueError(f"Benchmark energy drift: {scene['name']}")
                expected_hash = output_hash
                if sample >= config.warmup:
                    end_to_end.append(elapsed)
                    per_tick.append(statistics.mean(result["tick_times_ms"]))
                    planning.append(statistics.mean(result["planning_times_ms"]))
            rows.append({"scene": scene["name"], "width": width, "height": height, "ticks": config.ticks,
                         "seed": config.seed + kind_index, "startTick": scene["tick"], "warmup": config.warmup,
                         "initialHash": initial_hash, "finalHash": expected_hash, "energyQ": initial_energy,
                         "endToEndMs": distribution(end_to_end), "syncTickMs": distribution(per_tick), "planningMs": distribution(planning)})
            if on_row is not None:
                on_row(rows[-1])
    return rows
