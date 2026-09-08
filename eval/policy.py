"""Fail-closed acceptance for optimizations of the current composed engine."""

import hashlib
import json
import math
import re
from dataclasses import asdict, dataclass

from engine.contracts import checked_integer
from engine.schedule import KERNEL_SPECS


POLICY_VERSION = "ca-v3-evaluation-1"
TARGETS = {
    "codec": "phase_1a_winner.wgsl", "thermal": "phase_2a_winner.wgsl",
    "gravity": "phase_2b_winner.wgsl", "diagonal": "phase_2b_diagonal_winner.wgsl",
    "liquid": "phase_2b_liquid_winner.wgsl", "buoyancy": "phase_2b_gas_buoyancy_winner.wgsl",
    "spread": "phase_2b_gas_spread_winner.wgsl", "phase": "phase_2c_winner.wgsl",
    "combustion": "phase_2d_winner.wgsl",
    "structure": "phase_2e_structure.wgsl", "normalize": "phase_2e_normalize.wgsl",
}
ALIASES = {"1a": "codec", "2a": "thermal", "2b": "gravity", "2c": "phase", "2d": "combustion"}
OBJECTIVES = ("end_to_end_ms", "sync_tick_ms")


def target_name(value: str) -> str:
    value = ALIASES.get(value, value)
    if value not in TARGETS:
        raise ValueError("Unknown production target. Legacy phases 1b/1c are inactive ca-v1 experiments; they cannot be promoted.")
    return value


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("utf-8")


def digest(value: bytes | str) -> str:
    return hashlib.sha256(value.encode("utf-8") if isinstance(value, str) else value).hexdigest()


@dataclass(frozen=True)
class EvaluationConfig:
    seed: int = 8173
    warmup: int = 2
    samples: int = 7
    ticks: int = 4
    timeout_seconds: int = 180

    def __post_init__(self):
        for name, low, high in (("seed", 0, 2**32 - 1), ("warmup", 1, 20), ("samples", 3, 50),
                                ("ticks", 4, 64), ("timeout_seconds", 30, 600)):
            checked_integer(getattr(self, name), low, high, name)

    def to_dict(self):
        return asdict(self)


def target_variants(target: str) -> set[str]:
    target = target_name(target)
    return {spec.id for spec in KERNEL_SPECS if target == "codec" or spec.source_file == TARGETS[target]}


def constraints(target: str) -> dict[str, int]:
    target = target_name(target)
    gates = {name: 0 for name in ("composed_mismatches", "energy_drift_q", "determinism_mismatches", "restart_mismatches")}
    gates["positive_variants_min"] = len(target_variants(target))
    gates["compared_passes_min"] = 1
    if target in ("thermal", "gravity", "diagonal", "liquid", "buoyancy", "spread", "structure", "normalize"):
        gates["material_count_errors"] = 0
    if target == "codec":
        gates.update(codec_field_errors=0, codec_pack_errors=0, codec_exchange_errors=0)
    return gates


def acceptance_errors(fitness: dict, target: str) -> list[str]:
    """Only exact numeric evidence satisfies a gate; missing/NaN/bools fail."""
    gates = constraints(target)
    if not isinstance(fitness, dict):
        return ["Missing fitness"]
    errors = []
    if fitness.get("diverged", False) is not False or fitness.get("disqualified", False) is not False:
        errors.append("Candidate diverged or was disqualified")
    for key, required in gates.items():
        name = key.removesuffix("_min")
        actual = fitness.get(name)
        if type(actual) is not int or actual < 0:
            errors.append(f"{name}: missing or invalid integer evidence")
        elif (actual < required if key.endswith("_min") else actual != required):
            errors.append(f"{name}: {actual}, required {'at least ' if key.endswith('_min') else ''}{required}")
    for name in OBJECTIVES:
        actual = fitness.get(name)
        if type(actual) not in (int, float) or not math.isfinite(actual) or actual <= 0:
            errors.append(f"{name}: requires a finite positive synchronized measurement")
    return errors


def strip_comments(source: str) -> str:
    """WGSL block comments nest. Preserve length so offsets refer to exact input."""
    out, index, depth = [], 0, 0
    while index < len(source):
        pair = source[index:index + 2]
        if pair == "/*":
            depth += 1
            out.append("  ")
            index += 2
        elif depth and pair == "*/":
            depth -= 1
            out.append("  ")
            index += 2
        elif not depth and pair == "//":
            end = source.find("\n", index)
            end = len(source) if end < 0 else end
            out.append(" " * (end - index))
            index = end
        else:
            out.append(source[index] if not depth or source[index] == "\n" else " ")
            index += 1
    if depth:
        raise ValueError("Unterminated WGSL block comment")
    return "".join(out)


def candidate_lint(source: str, target: str) -> list[str]:
    """A bounded local optimization language, not a sandbox for hostile GPU code."""
    target = target_name(target)
    if type(source) is not str or not 1 <= len(source.encode("utf-8")) <= 65536:
        return ["SS024 candidate must contain 1..65536 UTF-8 bytes"]
    try:
        code = strip_comments(source)
    except ValueError as error:
        return [f"SS024 {error}"]
    errors = []
    if re.search(r"\b(?:while|loop|continuing|workgroupBarrier|storageBarrier|textureBarrier)\b", code):
        errors.append("SS024 unbounded loops and barriers are outside the candidate contract")
    for match in re.finditer(r"\bfor\s*\(([^)]*)\)\s*\{", code):
        bounded = re.fullmatch(r"\s*var\s+(\w+)\s*=\s*0u;\s*\1\s*<\s*(\d+)u;\s*\1\s*\+=\s*1u\s*", match.group(1))
        if bounded is None or not 1 <= int(bounded.group(2)) <= 64:
            errors.append("SS024 for loops require a literal bound from 1 through 64")
            continue
        depth, end = 1, match.end()
        while end < len(code) and depth:
            depth += (code[end] == "{") - (code[end] == "}")
            end += 1
        body = code[match.end():end - 1]
        name = re.escape(bounded.group(1))
        if re.search(rf"\b{name}\s*(?:[+*/%&|^<>-]*=(?!=)|\+\+|--)|&\s*{name}\b|\bvar\s+{name}\b", body):
            errors.append("SS024 loop induction variable must not be changed or aliased in its body")
    if len(re.findall(r"\bfor\b", code)) != len(list(re.finditer(r"\bfor\s*\([^)]*\)\s*\{", code))):
        errors.append("SS024 unsupported for-loop syntax")
    if re.search(r"@(?:group|binding)\b|\bvar\s*<\s*(?:storage|workgroup)\b", code):
        errors.append("SS025 candidate cannot replace host-owned storage or workgroup state")
    if target == "codec":
        if "@" in code or re.search(r"\b(?:grid_in|grid_out|energy_in|energy_out|structure_in|structure_out|structural_plan|cold_table)\b", code):
            errors.append("SS025 codec candidates contain helpers only, without entry points or storage access")
        names = re.findall(r"\bfn\s+(\w+)\s*\(", code)
        if any(names.count(name) != 1 for name in ("pack_voxel", "unpack_voxel", "exchange_thermal")):
            errors.append("SS025 codec must define each required helper exactly once")
    else:
        if (len(re.findall(r"@compute\b", code)) != 1 or len(re.findall(r"\bfn\s+tick\s*\(", code)) != 1
                or not re.search(r"@workgroup_size\(\s*16\s*,\s*16\s*\)", code)):
            errors.append("SS025 production candidates require one tick entry with workgroup_size(16,16)")
        if re.search(r"\b(?:grid_out|energy_out|structure_out)\s*\[[^]]*\]\s*=", code):
            errors.append("SS025 candidate writes must use the complete-state storage adapter")
    return errors
