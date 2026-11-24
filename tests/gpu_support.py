"""Exclude native GPU tests from CPU jobs before attempting adapter discovery.

The CPU supervisor excludes these tests even on GPU hosts. Without an adapter they used to
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
    """1 requires an adapter; 0 or unset allows the skip; any other value fails closed."""
    value = os.environ.get(REQUIRE_GPU_VARIABLE, "").strip()
    if value in ("", "0"):
        return False
    if value == "1":
        return True
    raise RuntimeError(f"{REQUIRE_GPU_VARIABLE} must be 1, 0 or unset, not {value!r}")


def requires_gpu(target):
    """Skip a test class or method without an adapter; fail instead when a GPU is required."""
    required = gpu_required()
    if os.environ.get('STATE_SPACE_VERIFICATION_KIND') == 'cpu':
        if required:
            raise RuntimeError('GPU-required tests cannot run inside a CPU verification job')
        return unittest.skip('Native GPU test excluded from CPU verification')(target)
    error = adapter_error()
    if error is None:
        return target
    if required:
        raise RuntimeError(f"{REQUIRE_GPU_VARIABLE}=1 but no WebGPU adapter is usable: {error}")
    return unittest.skip(f"No WebGPU adapter ({error}); set {REQUIRE_GPU_VARIABLE}=1 to fail instead")(target)

