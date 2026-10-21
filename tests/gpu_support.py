"""Skip native GPU tests on hosts without a WebGPU adapter, unless a GPU is required.

Hosted CI runs no GPU workload. Without an adapter the native engine tests used to
error in ``setUpClass``; they now skip with an explicit reason. A GPU host that must
not skip sets ``STATE_SPACE_REQUIRE_GPU=1``: the probe failure then raises instead,
so a missing or broken adapter fails closed on the machine that claims the result.
"""

import functools
import os
import unittest

REQUIRE_GPU_VARIABLE = "STATE_SPACE_REQUIRE_GPU"


@functools.lru_cache(maxsize=1)
def adapter_error() -> str | None:
    """Return the adapter request failure, or None when a high-performance adapter exists."""
    try:
        import wgpu

        adapter = wgpu.gpu.request_adapter_sync(power_preference="high-performance")
    except Exception as error:  # wgpu raises RuntimeError without a usable backend.
        return f"{type(error).__name__}: {error}".splitlines()[0]
    return None if adapter is not None else "No GPU adapter found"


def gpu_required() -> bool:
    return os.environ.get(REQUIRE_GPU_VARIABLE, "").strip() == "1"


def requires_gpu(target):
    """Skip a test class or method without an adapter; fail instead when a GPU is required."""
    error = adapter_error()
    if error is None:
        return target
    if gpu_required():
        raise RuntimeError(f"{REQUIRE_GPU_VARIABLE}=1 but no WebGPU adapter is usable: {error}")
    return unittest.skip(f"No WebGPU adapter ({error}); set {REQUIRE_GPU_VARIABLE}=1 to fail instead")(target)


def requires_verification_job(target):
    """Tests that re-enter the supervisor must already run inside a verification job."""
    if os.environ.get("STATE_SPACE_VERIFICATION_JOB"):
        return target
    if gpu_required():
        raise RuntimeError(f"{REQUIRE_GPU_VARIABLE}=1 but STATE_SPACE_VERIFICATION_JOB is unset; run through scripts.verification_guard")
    return unittest.skip("Re-enters the verification supervisor; run through scripts.verification_guard")(target)
