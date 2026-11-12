"""Synchronized host timings of the actual composed workload, with distributions."""

import math
import statistics
import time
from contextlib import ExitStack

import numpy as np
import wgpu

from engine.registry import MaterialRegistry
from engine.schema import COLD_TABLE_ENTRIES, COLD_TABLE_STRIDE
from engine.structure_compiled import _transport_validated
from eval.policy import KERNEL_SHAPES, digest, kernel_variants, target_name
from eval.scenes import KINDS, workload


# Dispatches per command buffer inside one kernel batch. Every chunk of a batch is
# submitted in one queue call, so one fence still covers all N dispatches while no
# single command buffer carries more than 32 dispatches of a slow candidate.
KERNEL_CHUNK = 32


class KernelProbeExceeded(ValueError):
    """One synchronized dispatch exceeded the probe budget; nothing larger was submitted."""


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


def encode_dispatches(device, pipeline, group, workgroups, count: int) -> list:
    """Encode count dispatches of one pipeline against ONE bind group, KERNEL_CHUNK per command buffer."""
    if type(count) is not int or count < 1:
        raise ValueError("A kernel batch needs a positive dispatch count")
    buffers = []
    for start in range(0, count, KERNEL_CHUNK):
        encoder = device.create_command_encoder()
        for _ in range(min(KERNEL_CHUNK, count - start)):
            compute = encoder.begin_compute_pass()
            compute.set_pipeline(pipeline)
            compute.set_bind_group(0, group)
            compute.dispatch_workgroups(*workgroups)
            compute.end()
        buffers.append(encoder.finish())
    return buffers


def output_digest(queue, buffers) -> str:
    return digest(b"".join(bytes(queue.read_buffer(buffer)) for buffer in buffers))


def benchmark_kernel(engine, target: str, config, shapes=KERNEL_SHAPES, *, on_row=None) -> list[dict]:
    """Device-side timing of the target's pass variants alone, on immutable input.

    Each row uploads one seeded workload once, then times batches of N back-to-back
    dispatches of a single pipeline through a single bind group: every dispatch reads
    the unchanged *_in arrays and overwrites the same *_out arrays. The group is never
    flipped and outputs are never copied back, so dispatch k does the work of dispatch 1
    instead of the early-exit leftovers of an already settled pass. Encoding happens
    before the clock; a sample covers one submit, the dispatches and one completion
    fence. Before any batch, one synchronized dispatch of the variant at the first
    shape must fit the probe budget, or the candidate fails closed.
    """
    target = target_name(target)
    variants = kernel_variants(target)
    device = engine.device
    probe_shape = tuple(shapes[0])
    probed = set()
    rows = []
    for width, height in shapes:
        engine._compile_pipelines(width, height)  # Compilation excluded, source hashes recorded separately.
        cells = width * height
        workgroups = ((width + 15) // 16, (height + 15) // 16)
        at_probe_shape = (width, height) == probe_shape
        with ExitStack() as resources:
            def keep(buffer):
                resources.callback(buffer.destroy)
                return buffer
            usage = wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_SRC | wgpu.BufferUsage.COPY_DST
            inputs = [keep(device.create_buffer(size=cells * 4, usage=usage)) for _ in range(3)]
            outputs = [keep(device.create_buffer(size=cells * 4, usage=usage)) for _ in range(3)]
            cold = keep(device.create_buffer(size=COLD_TABLE_ENTRIES * COLD_TABLE_STRIDE * 4, usage=usage))
            plan = keep(device.create_buffer(size=cells * 8, usage=usage))
            ordered = [inputs[0], outputs[0], cold, inputs[1], outputs[1], inputs[2], outputs[2], plan]
            group = device.create_bind_group(layout=engine.pipelines[variants[0]][1], entries=[
                {"binding": binding, "resource": {"buffer": value}} for binding, value in enumerate(ordered)])
            for kind_index, kind in enumerate(KINDS):
                scene = workload(width, height, kind, config.seed + kind_index, config.ticks)
                registry = MaterialRegistry(scene["catalog"])
                grid, energy, structure = (np.array(scene[key], dtype=np.uint32) for key in ("cells", "energyQ", "structure"))
                sources, planned = _transport_validated(grid, energy, structure, width, height, registry._structure)
                for buffer, values in zip(inputs, (grid, energy, structure)):
                    device.queue.write_buffer(buffer, 0, values)
                device.queue.write_buffer(cold, 0, registry.cold_table())
                device.queue.write_buffer(plan, 0, np.ascontiguousarray(np.column_stack((sources, planned)).astype(np.uint32)))
                initial_hash = state_digest(grid, energy, structure)
                for variant in variants:
                    pipeline = engine.pipelines[variant][0]

                    def timed(dispatches):
                        commands = encode_dispatches(device, pipeline, group, workgroups, dispatches)
                        return synchronized_sample(device.queue, lambda: device.queue.submit(commands), outputs[0])

                    probe = [timed(1)]
                    if at_probe_shape:
                        if probe[0] > config.kernel_probe_budget_ms:
                            probe.append(timed(1))  # One retry of the same size absorbs a first-dispatch stall.
                        if min(probe) > config.kernel_probe_budget_ms:
                            raise KernelProbeExceeded(f"{variant} on {scene['name']}: one dispatch took {min(probe):.3f} ms, "
                                                      f"budget {config.kernel_probe_budget_ms} ms; no batch was submitted")
                        probed.add(variant)
                    elif variant not in probed:
                        raise ValueError(f"{variant} must be probed at {probe_shape[0]}x{probe_shape[1]} before a larger batch")
                    single_hash = output_digest(device.queue, outputs)
                    samples = []
                    for sample in range(config.warmup + config.samples):
                        elapsed = timed(config.kernel_dispatches)
                        if sample >= config.warmup:
                            samples.append(elapsed / config.kernel_dispatches)
                    batch_hash = output_digest(device.queue, outputs)
                    if batch_hash != single_hash:
                        raise ValueError(f"Nondeterministic kernel batch: {variant} on {scene['name']}")
                    rows.append({"scene": scene["name"], "variant": variant, "width": width, "height": height,
                                 "seed": config.seed + kind_index, "startTick": scene["tick"], "initialHash": initial_hash,
                                 "warmup": config.warmup, "dispatches": config.kernel_dispatches, "probed": at_probe_shape,
                                 "probeMs": probe, "probeBudgetMs": config.kernel_probe_budget_ms,
                                 "singleHash": single_hash, "batchHash": batch_hash, "kernelMs": distribution(samples)})
                    if on_row is not None:
                        on_row(rows[-1])
    return rows
