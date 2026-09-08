"""Validate legacy codec seed helpers through the independent host-owned probe.

Successful seed probes are not evolution admission; use the composed evaluator.
"""

from pathlib import Path

from engine.runner import GPUTrialRunner, generate_test_data


def validate_seed(runner: GPUTrialRunner, shader_path: Path, n_voxels: int = 1_048_576) -> dict:
    result = runner.run_pack_unpack_trial(shader_path.read_text(encoding="utf-8"), generate_test_data(n_voxels))
    return {"shader": shader_path.name, **result}


def validate_all_seeds(n_voxels: int = 1_048_576):
    seeds = sorted((Path(__file__).resolve().parent.parent / "seeds/phase_1a").glob("*.wgsl"))
    if not seeds:
        raise ValueError("Codec seed validation requires at least one seed")
    with GPUTrialRunner() as runner:
        return [validate_seed(runner, path, n_voxels) for path in seeds]


if __name__ == "__main__":
    results = validate_all_seeds()
    for result in results:
        print(result)
    raise SystemExit(int(not results or any(result.get("passed") is not True for result in results)))
