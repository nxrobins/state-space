"""Compatibility adapter for codec probes; ca-v1 physics trials are retired.

Use eval.evaluator for candidate admission. This adapter cannot produce an
admission receipt, and it never trusts a candidate-supplied compute harness.
"""

import numpy as np
import wgpu

from engine.contracts import checked_integer, validate_packed
from engine.wgsl_fixer import strip_entry_points_and_bindings
from eval.codec import codec_trial


class GPUTrialRunner:
    def __init__(self):
        self.adapter = wgpu.gpu.request_adapter_sync(power_preference="high-performance")
        if self.adapter is None:
            raise RuntimeError("No GPU adapter found")
        self.device = self.adapter.request_device_sync()

    def close(self):
        self.device.destroy()

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        self.close()

    def run_pack_unpack_trial(self, shader_code, test_data, n_timing_runs=7):
        values = validate_packed(test_data, len(test_data), "codec vectors")
        if not len(values):
            raise ValueError("Codec vectors must be nonempty")
        checked_integer(n_timing_runs, 3, 50, "timing samples")
        # Legacy seed files contain their own main/bindings. Only helpers are
        # transplanted into the independent probe; this result cannot be promoted.
        source = strip_entry_points_and_bindings(shader_code)
        vectors = np.column_stack((values, np.roll(values, 1)))
        try:
            result = codec_trial(self.device, source, vectors, samples=n_timing_runs)
            errors = result["codec_pack_errors"] + result["codec_field_errors"] + result["codec_exchange_errors"]
            return {**result, "roundtrip_errors": result["codec_pack_errors"], "helper_errors": errors,
                    "cycle_time_us": result["timingMs"]["median"] * 1000 / len(values),
                    "total_time_ms": result["timingMs"]["median"], "diverged": False,
                    "passed": errors == 0, "admissible": False}
        except Exception as error:
            return {"passed": False, "admissible": False, "diverged": True, "error": str(error)}

    def run_sync_trial(self, *_args, **_kwargs):
        raise ValueError("The ca-v1 sync trial is inactive. Use eval.evaluator for the composed ca-v2 engine.")

    def run_spatial_trial(self, *_args, **_kwargs):
        raise ValueError("The ca-v1 spatial trial is inactive; candidate counters cannot establish work reduction.")

    def run_physics_trial(self, *_args, **_kwargs):
        raise ValueError("The three-binding ca-v1 physics trial is retired. Use eval.evaluator with both state arrays.")


def generate_test_data(n=1_048_576, seed=42):
    checked_integer(n, 1, 1_048_576, "vector count")
    checked_integer(seed, 0, 2**32 - 1, "seed")
    values = np.random.default_rng(seed).integers(0, 2**32, size=n, dtype=np.uint32)
    boundaries = [0, 0xffffffff, 0x80000000, 0x00780000]
    values[:min(n, len(boundaries))] = boundaries[:min(n, len(boundaries))]
    return values
