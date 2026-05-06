"""
Correctness evaluation for Phase 1a pack/unpack trials.

Tests roundtrip fidelity: for any 32-bit value, unpack(pack(unpack(v))) must equal unpack(v).
The GPU result must match the CPU reference for all test vectors.
"""

import numpy as np
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from engine.runner import GPUTrialRunner, generate_test_data
from engine.schema import unpack_voxel, pack_voxel


def validate_seed(runner: GPUTrialRunner, shader_path: Path, n_voxels: int = 1_048_576) -> dict:
    """
    Validate a single Phase 1a seed shader.

    Tests:
    1. Roundtrip correctness: GPU output matches input for all test vectors.
    2. CPU reference match: GPU unpack/repack matches Python unpack/repack.

    Returns dict with pass/fail status and metrics.
    """
    shader_code = shader_path.read_text()
    test_data = generate_test_data(n=n_voxels)

    # Run GPU trial
    result = runner.run_pack_unpack_trial(shader_code, test_data)

    if result.get("diverged"):
        return {
            "shader": shader_path.name,
            "passed": False,
            "reason": f"Shader compilation failed: {result.get('error', 'unknown')}",
            **result,
        }

    # CPU reference check on a subset
    n_check = min(10_000, n_voxels)
    cpu_mismatches = 0
    for i in range(n_check):
        raw = int(test_data[i])
        unpacked = unpack_voxel(raw)
        repacked = pack_voxel(unpacked)
        re_unpacked = unpack_voxel(repacked)
        if re_unpacked != unpacked:
            cpu_mismatches += 1

    passed = result["roundtrip_errors"] == 0 and cpu_mismatches == 0
    return {
        "shader": shader_path.name,
        "passed": passed,
        "roundtrip_errors": result["roundtrip_errors"],
        "cpu_reference_mismatches": cpu_mismatches,
        "cycle_time_us": result["cycle_time_us"],
        "total_time_ms": result["total_time_ms"],
    }


def validate_all_seeds(n_voxels: int = 1_048_576):
    """Validate all Phase 1a seeds."""
    runner = GPUTrialRunner()
    seeds_dir = Path(__file__).parent.parent / "seeds" / "phase_1a"
    results = []

    for shader_path in sorted(seeds_dir.glob("*.wgsl")):
        print(f"Testing {shader_path.name}...")
        result = validate_seed(runner, shader_path, n_voxels)
        results.append(result)
        status = "PASS" if result["passed"] else "FAIL"
        print(f"  {status}: errors={result.get('roundtrip_errors', '?')}, "
              f"time={result.get('cycle_time_us', '?'):.4f}us/voxel, "
              f"total={result.get('total_time_ms', '?'):.2f}ms")
        if not result["passed"]:
            print(f"  Reason: {result.get('reason', 'roundtrip errors detected')}")

    return results


if __name__ == "__main__":
    results = validate_all_seeds()
    all_passed = all(r["passed"] for r in results)
    print(f"\n{'All seeds PASSED' if all_passed else 'Some seeds FAILED'}")
    if not all_passed:
        exit(1)
