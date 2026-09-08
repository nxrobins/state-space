"""A host-owned harness calls codec helpers and observes their individual fields."""

from contextlib import ExitStack

import numpy as np
import wgpu

from engine.resources import shader_source
from eval.benchmark import distribution, synchronized_sample
from eval.policy import candidate_lint, digest


HARNESS = """
@group(0) @binding(0) var<storage,read> probe_input: array<vec2<u32>>;
@group(0) @binding(1) var<storage,read_write> probe_output: array<u32>;
@compute @workgroup_size(64)
fn probe(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= arrayLength(&probe_input)) { return; }
    let a = probe_input[i].x;
    let b = probe_input[i].y;
    let v = unpack_voxel(a);
    let out = i * 9u;
    // Inputs to pack are independently decoded, not taken from the candidate's unpack.
    probe_output[out] = pack_voxel(a & 255u, (a >> 8u) & 255u,
        i32((a >> 16u) & 15u) - select(0, 16, ((a >> 16u) & 15u) >= 8u),
        i32((a >> 20u) & 15u) - select(0, 16, ((a >> 20u) & 15u) >= 8u),
        (a >> 24u) & 15u, (a >> 28u) & 15u);
    probe_output[out+1u] = v.material;
    probe_output[out+2u] = v.thermal;
    probe_output[out+3u] = bitcast<u32>(v.kinetic_x);
    probe_output[out+4u] = bitcast<u32>(v.kinetic_y);
    probe_output[out+5u] = v.phase;
    probe_output[out+6u] = v.flags;
    let exchange = exchange_thermal(a, b);
    probe_output[out+7u] = exchange.x;
    probe_output[out+8u] = exchange.y;
}
"""


def codec_vectors(seed: int, count: int = 16384) -> np.ndarray:
    rng = np.random.default_rng(seed)
    basis = np.array([0, 0xffffffff, *(1 << bit for bit in range(32)), *(0xffffffff ^ (1 << bit) for bit in range(32))], dtype=np.uint32)
    random = rng.integers(0, 2**32, size=(count, 2), dtype=np.uint32)
    return np.concatenate((np.column_stack((basis, basis[::-1])), random))


def codec_expected(vectors: np.ndarray) -> np.ndarray:
    a, b = vectors[:, 0].astype(np.int64), vectors[:, 1].astype(np.int64)
    ta, tb = (a >> 8) & 255, (b >> 8) & 255
    transfer = (ta - tb) >> 2  # Legacy helper's specified arithmetic shift, not the ca-v2 heat law.
    sx = ((a >> 16) & 15)
    sy = ((a >> 20) & 15)
    output = np.column_stack((a, a & 255, ta, sx - (sx >= 8) * 16, sy - (sy >= 8) * 16,
                              (a >> 24) & 15, (a >> 28) & 15,
                              (a & 0xffff00ff) | (np.clip(ta - transfer, 0, 255) << 8),
                              (b & 0xffff00ff) | (np.clip(tb + transfer, 0, 255) << 8)))
    return (output & 0xffffffff).astype(np.uint32)


def codec_trial(device, source: str, vectors: np.ndarray, *, warmup: int = 2, samples: int = 7) -> dict:
    errors = candidate_lint(source, "codec")
    if errors:
        raise ValueError("; ".join(errors))
    if vectors.dtype != np.uint32 or vectors.ndim != 2 or vectors.shape[1] != 2 or len(vectors) == 0:
        raise ValueError("Codec probes require a nonempty Nx2 uint32 array")
    if type(warmup) is not int or warmup < 1 or type(samples) is not int or samples < 3:
        raise ValueError("Codec timing requires warmup and at least three samples")
    full_source = shader_source("bitmask_defs.wgsl") + "\n" + source + "\n" + HARNESS
    module = device.create_shader_module(code=full_source)
    pipeline = device.create_compute_pipeline(layout="auto", compute={"module": module, "entry_point": "probe"})
    with ExitStack() as resources:
        def keep(buffer):
            resources.callback(buffer.destroy)
            return buffer
        inputs = keep(device.create_buffer_with_data(data=vectors, usage=wgpu.BufferUsage.STORAGE))
        outputs = keep(device.create_buffer(size=len(vectors) * 9 * 4, usage=wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_SRC))
        group = device.create_bind_group(layout=pipeline.get_bind_group_layout(0), entries=[
            {"binding": 0, "resource": {"buffer": inputs}}, {"binding": 1, "resource": {"buffer": outputs}}])

        def dispatch():
            encoder = device.create_command_encoder()
            compute = encoder.begin_compute_pass()
            compute.set_pipeline(pipeline)
            compute.set_bind_group(0, group)
            compute.dispatch_workgroups((len(vectors) + 63) // 64)
            compute.end()
            device.queue.submit([encoder.finish()])

        for _ in range(warmup):
            synchronized_sample(device.queue, dispatch, outputs)
        actual = np.frombuffer(device.queue.read_buffer(outputs), dtype=np.uint32).reshape(-1, 9).copy()
        expected = codec_expected(vectors)
        timings = [synchronized_sample(device.queue, dispatch, outputs) for _ in range(samples)]
        return {"codec_pack_errors": int(np.count_nonzero(actual[:, 0] != expected[:, 0])),
                "codec_field_errors": int(np.count_nonzero(actual[:, 1:7] != expected[:, 1:7])),
                "codec_exchange_errors": int(np.count_nonzero(actual[:, 7:9] != expected[:, 7:9])),
                "timingMs": distribution(timings), "vectorsHash": digest(vectors.astype("<u4").tobytes()),
                "compiledHash": digest(full_source), "vectors": len(vectors)}
