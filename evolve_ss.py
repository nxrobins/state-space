"""
AlphaEvolve-style evolutionary search for State Space compute shaders.
Population-based, Pareto-ranked, with LLM-driven mutations.

Adapted from D:/autoresearch/evolve.py for WGSL shader evolution.
Trials run in-process via wgpu-native (~1-10s per trial vs 20+ min).

Usage:
    python evolve_ss.py --phase 1a --max-hours 2
    python evolve_ss.py --phase 1b --max-hours 4
"""

import argparse
import copy
import json
import os
import re
import sys
import time

from engine.wgsl_fixer import fix_wgsl, validate_wgsl_basic, strip_entry_points_and_bindings

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

POPULATION_SIZE = 15
PARENTS_PER_GEN = 3
CONVERGENCE_THRESHOLD = 5
MIN_TRIALS_BEFORE_CONVERGENCE = 15
DIVERSITY_THRESHOLD = 0.8
RANDOM_INJECTION_COUNT = 2

WORK_DIR = Path("D:/state-space")
RESULTS_FILE = WORK_DIR / "evolution_log.jsonl"
GENEALOGY_FILE = WORK_DIR / "genealogy.jsonl"
PROGRESS_FILE = WORK_DIR / "evolution_progress.json"

# Phase configurations
PHASE_CONFIG = {
    "1a": {
        "name": "Phase 1a: Pack/Unpack Optimization",
        "description": "Evolve WGSL bit-packing functions for the 32-bit voxel bitmask. "
                        "Goal: minimize cycle time while maintaining zero roundtrip errors.",
        "evolvable": ["pack_voxel", "unpack_voxel", "exchange_thermal"],
        "objectives": ["cycle_time_us"],  # lower is better
        "higher_is_better": [],
        "seeds_dir": WORK_DIR / "seeds" / "phase_1a",
        "archive_file": WORK_DIR / "archive" / "archive_phase_1a.json",
        "locked_from": [],  # no dependencies
        "hard_constraints": {
            "roundtrip_errors": 0,  # must be exactly zero
        },
        "entry_point": "main",
        "test_size": 1_048_576,  # 1M voxels
    },
    "1b": {
        "name": "Phase 1b: Lock-Free Synchronization",
        "description": "Evolve the compute dispatch strategy for resolving simultaneous "
                        "state transitions on a 1024x1024 grid.",
        "evolvable": ["tick"],  # the main simulation step
        "objectives": ["tick_time_ms"],
        "higher_is_better": [],
        "seeds_dir": WORK_DIR / "seeds" / "phase_1b",
        "archive_file": WORK_DIR / "archive" / "archive_phase_1b.json",
        "locked_from": ["1a"],
        "hard_constraints": {
            "matter_conservation_error": 0,
            "material_count_error": 0,
            "determinism_score": 1.0,
        },
        "entry_point": "tick",
        "grid_width": 1024,
        "grid_height": 1024,
    },
    "1c": {
        "name": "Phase 1c: Spatial Partitioning",
        "description": "Evolve chunk-based active/sleep grid management to cull static "
                        "regions from compute dispatch.",
        "evolvable": ["classify_chunks", "dispatch_active"],
        "objectives": ["workgroup_reduction", "overhead_ms"],
        "higher_is_better": ["workgroup_reduction"],
        "seeds_dir": WORK_DIR / "seeds" / "phase_1c",
        "archive_file": WORK_DIR / "archive" / "archive_phase_1c.json",
        "locked_from": ["1a"],  # Only pack/unpack functions; 1b logic is embedded in seeds
        "hard_constraints": {
            "output_match": 1.0,
        },
    },
    "2a": {
        "name": "Phase 2a: Thermal Diffusion with Cold Table",
        "description": "Evolve thermal diffusion using per-material conductivity from the cold "
                        "property lookup table. Interface conductivity is LOCKED as harmonic mean. "
                        "Energy conservation is the primary hard constraint.",
        "evolvable": ["tick"],
        "objectives": ["energy_conservation_error", "tick_time_ms"],
        "higher_is_better": [],
        "seeds_dir": WORK_DIR / "seeds" / "phase_2a",
        "archive_file": WORK_DIR / "archive" / "archive_phase_2a.json",
        "locked_from": ["1a"],  # pack/unpack functions only
        "hard_constraints": {
            "matter_conservation_error": 0,
            "material_count_error": 0,
            "determinism_score": 1.0,
        },
        "grid_width": 256,
        "grid_height": 256,
    },
    "2b": {
        "name": "Phase 2b: Gravity + Density Sorting",
        "description": "Evolve gravity and density-based position swaps. Denser materials sink, "
                        "lighter materials rise. Lateral spreading for fluids. Uses density from "
                        "cold table. Swap mechanism: both threads read grid_in, agree on swap "
                        "deterministically, each writes own grid_out cell. Diagonal direction "
                        "resolved by parity/hash to prevent duplication.",
        "evolvable": ["tick"],
        "objectives": ["tick_time_ms"],
        "higher_is_better": [],
        "seeds_dir": WORK_DIR / "seeds" / "phase_2b",
        "archive_file": WORK_DIR / "archive" / "archive_phase_2b.json",
        "locked_from": ["1a"],
        "hard_constraints": {
            "matter_conservation_error": 0,
            "material_count_error": 0,
            "determinism_score": 1.0,
        },
        "grid_width": 256,
        "grid_height": 256,
    },
    "2c": {
        "name": "Phase 2c: Phase Transitions",
        "description": "Evolve phase transition logic: ice->water->steam (melt/boil) and "
                        "reverse (freeze/condense). Uses melt/boil/freeze/condense points + "
                        "latent heat from cold table. Hysteresis bands prevent oscillation. "
                        "Material ID bits are rewritten on transition — first kernel to mutate mat ID.",
        "evolvable": ["tick"],
        "objectives": ["tick_time_ms"],
        "higher_is_better": [],
        "seeds_dir": WORK_DIR / "seeds" / "phase_2c",
        "archive_file": WORK_DIR / "archive" / "archive_phase_2c.json",
        "locked_from": ["1a"],
        "hard_constraints": {
            "determinism_score": 1.0,
        },
        "grid_width": 256,
        "grid_height": 256,
    },
    "2d": {
        "name": "Phase 2d: Combustion with Explicit Oxygen",
        "description": "Evolve combustion logic. Three conditions: thermal > flash_point, "
                        "fuel_energy > 0, adjacent air exists. Fuel→product + air→smoke. "
                        "Energy audit: total_thermal_after = total_thermal_before + fuel_energy_consumed. "
                        "Explicit oxygen: sealed rooms run out of air, fire dies.",
        "evolvable": ["tick"],
        "objectives": ["tick_time_ms"],
        "higher_is_better": [],
        "seeds_dir": WORK_DIR / "seeds" / "phase_2d",
        "archive_file": WORK_DIR / "archive" / "archive_phase_2d.json",
        "locked_from": ["1a"],
        "hard_constraints": {
            "determinism_score": 1.0,
        },
        "grid_width": 256,
        "grid_height": 256,
    },
}


# ---------------------------------------------------------------------------
# Candidate and Archive (adapted from evolve.py)
# ---------------------------------------------------------------------------

@dataclass
class Candidate:
    """A candidate WGSL shader implementation."""
    id: str
    generation: int
    parent_ids: list
    mutation_description: str
    code_diff: str
    fitness: Optional[dict] = None
    phase: str = "1a"
    created_at: str = ""
    evolvable_code: dict = field(default_factory=dict)

    def is_evaluated(self):
        return self.fitness is not None

    def is_viable(self):
        return self.is_evaluated() and not (self.fitness or {}).get("disqualified", False)

    def dominates(self, other, objectives, higher_is_better=None):
        """Pareto dominance check."""
        if not self.is_evaluated() or not other.is_evaluated():
            return False
        higher_is_better = higher_is_better or []
        dominated = True
        strictly_better = False
        for obj in objectives:
            self_val = self.fitness.get(obj, float("inf"))
            other_val = other.fitness.get(obj, float("inf"))
            if obj in higher_is_better:
                if self_val < other_val:
                    dominated = False
                elif self_val > other_val:
                    strictly_better = True
            else:
                if self_val > other_val:
                    dominated = False
                elif self_val < other_val:
                    strictly_better = True
        return dominated and strictly_better


class Archive:
    """Population archive with Pareto ranking."""

    def __init__(self, max_size=POPULATION_SIZE):
        self.candidates: list[Candidate] = []
        self.max_size = max_size

    def add(self, candidate: Candidate):
        self.candidates.append(candidate)
        if len(self.candidates) > self.max_size:
            self._evict_worst()

    def get_pareto_front(self, objectives, higher_is_better=None):
        evaluated = [c for c in self.candidates if c.is_viable()]
        front = []
        for c in evaluated:
            dominated = any(
                other.dominates(c, objectives, higher_is_better)
                for other in evaluated if other.id != c.id
            )
            if not dominated:
                front.append(c)
        return front

    def select_parents(self, n, objectives, higher_is_better=None):
        ranked = self._pareto_rank(objectives, higher_is_better)
        return ranked[:n]

    def _pareto_rank(self, objectives, higher_is_better=None):
        evaluated = [c for c in self.candidates if c.is_viable()]
        remaining = list(evaluated)
        ranked = []
        primary = objectives[0]
        while remaining:
            front = []
            for c in remaining:
                dominated = any(
                    other.dominates(c, objectives, higher_is_better)
                    for other in remaining if other.id != c.id
                )
                if not dominated:
                    front.append(c)
            # Sort front by primary objective
            reverse = primary in (higher_is_better or [])
            ranked.extend(sorted(front, key=lambda c: c.fitness.get(primary, float("inf")), reverse=reverse))
            remaining = [c for c in remaining if c not in front]
        return ranked

    def _evict_worst(self):
        if not self.candidates:
            return
        evaluated = [c for c in self.candidates if c.is_evaluated()]
        if evaluated:
            worst = max(evaluated, key=lambda c: c.fitness.get("cycle_time_us", float("inf")))
            self.candidates.remove(worst)
        else:
            self.candidates.pop(0)

    def get_diversity_score(self, top_n=10):
        evaluated = sorted(
            [c for c in self.candidates if c.is_evaluated()],
            key=lambda c: c.fitness.get("cycle_time_us", float("inf"))
        )[:top_n]
        if len(evaluated) < 2:
            return 1.0
        unique_codes = set()
        for c in evaluated:
            code_hash = hash(json.dumps(c.evolvable_code, sort_keys=True))
            unique_codes.add(code_hash)
        return len(unique_codes) / len(evaluated)

    def save(self, path):
        data = [asdict(c) for c in self.candidates]
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f, indent=2)

    @classmethod
    def load(cls, path, max_size=POPULATION_SIZE):
        archive = cls(max_size=max_size)
        if Path(path).exists():
            with open(path, "r") as f:
                data = json.load(f)
            for item in data:
                archive.candidates.append(Candidate(**item))
        return archive


# ---------------------------------------------------------------------------
# WGSL code extraction (from seed files)
# ---------------------------------------------------------------------------

def extract_wgsl_functions(shader_source: str, func_names: list[str]) -> dict:
    """Extract named WGSL function bodies from shader source."""
    functions = {}
    for name in func_names:
        # Match: fn name(...) -> ... { ... } including nested braces
        pattern = rf'(fn {name}\([^)]*\)[^{{]*\{{)'
        match = re.search(pattern, shader_source)
        if match:
            start = match.start()
            # Count braces to find the matching close
            depth = 0
            pos = match.end() - 1  # position of opening brace
            for i in range(pos, len(shader_source)):
                if shader_source[i] == '{':
                    depth += 1
                elif shader_source[i] == '}':
                    depth -= 1
                    if depth == 0:
                        functions[name] = shader_source[start:i+1]
                        break
    return functions


def load_seed_shaders(seeds_dir: Path) -> list[dict]:
    """Load all seed WGSL files from a directory."""
    seeds = []
    for wgsl_file in sorted(seeds_dir.glob("*.wgsl")):
        source = wgsl_file.read_text()
        seeds.append({
            "name": wgsl_file.stem,
            "source": source,
            "path": str(wgsl_file),
        })
    return seeds


def assemble_shader(evolvable_code: dict, phase_config: dict) -> str:
    """
    Assemble a complete WGSL shader from evolvable functions + locked winners.

    For Phase 1a: just the evolvable functions + entry point.
    For Phase 1b+: prepend locked winners from prior phases.
    """
    parts = []

    # Add locked phase winners
    for locked_phase in phase_config.get("locked_from", []):
        locked_path = WORK_DIR / "locked" / f"phase_{locked_phase}_winner.wgsl"
        if locked_path.exists():
            parts.append(f"// [LOCKED] Phase {locked_phase} winner\n" + locked_path.read_text())

    # Add the evolvable functions
    for func_name, func_code in evolvable_code.items():
        parts.append(func_code)

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Anthropic API mutation
# ---------------------------------------------------------------------------

def _get_anthropic_key():
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if key:
        return key
    # Try .env files
    for env_path in [
        Path.home() / ".anthropic" / ".env",
        Path.home() / ".openclaw" / ".env",
        Path.home() / ".env",
        WORK_DIR / ".env",
    ]:
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("ANTHROPIC_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"')
    # Try OpenClaw auth-profiles (same as autoresearch)
    auth_paths = [
        Path.home() / ".openclaw" / "agents" / "main" / "agent" / "auth-profiles.json",
        Path.home() / ".openclaw" / "auth-profiles.json",
    ]
    for auth_path in auth_paths:
        if auth_path.exists():
            try:
                with open(auth_path) as f:
                    data = json.load(f)
                profiles = data.get("profiles", {})
                for profile_name, profile in profiles.items():
                    if profile.get("provider") == "anthropic":
                        pkey = profile.get("key", "")
                        if pkey:
                            return pkey
            except (json.JSONDecodeError, IOError):
                pass
    raise RuntimeError(
        "ANTHROPIC_API_KEY not found. Set it as an environment variable, "
        "in ~/.openclaw/.env, or in OpenClaw auth-profiles."
    )


def _load_program_directive():
    program_path = WORK_DIR / "ss_program.md"
    if program_path.exists():
        return program_path.read_text(encoding="utf-8")
    return ""


def _get_working_example(phase_config: dict) -> str:
    """Load the best seed shader as a full working example for the LLM."""
    seeds_dir = phase_config.get("seeds_dir")
    if not seeds_dir:
        return "// No working example available"

    # Pick the first seed file as the example
    seed_files = sorted(Path(seeds_dir).glob("*.wgsl"))
    if not seed_files:
        return "// No seed files found"

    # For phases with locked dependencies, prepend them
    example = ""
    for locked_phase in phase_config.get("locked_from", []):
        locked_path = WORK_DIR / "locked" / f"phase_{locked_phase}_winner.wgsl"
        if locked_path.exists():
            example += f"// [LOCKED from Phase {locked_phase} — already prepended, do NOT include]\n"
            example += "// " + locked_path.read_text().replace("\n", "\n// ")[:500] + "\n...\n\n"

    example += seed_files[0].read_text()
    return example


def mutate_with_llm(parents, phase_config, archive_summary, failed_attempts):
    """
    Use Claude to mutate parent WGSL code into a new candidate.
    """
    import anthropic

    api_key = _get_anthropic_key()
    client = anthropic.Anthropic(api_key=api_key)

    evolvable_funcs = phase_config["evolvable"]
    phase_name = phase_config["name"]

    parent_code_blocks = []
    for i, parent in enumerate(parents):
        code_str = "\n\n".join(
            parent.evolvable_code.get(func, f"// {func} not found")
            for func in evolvable_funcs
        )
        fitness_str = ", ".join(f"{k}={v}" for k, v in (parent.fitness or {}).items()
                                if k not in ("diverged", "disqualified", "error"))
        parent_code_blocks.append(
            f"--- Parent {i+1} ({fitness_str}) ---\n```wgsl\n{code_str}\n```"
        )

    failed_str = ""
    if failed_attempts:
        failed_str = "\n\n## Previous FAILED attempts (LEARN from these — do NOT repeat these errors):\n"
        for attempt in failed_attempts[-8:]:
            desc = attempt.get('description', 'unknown')[:80]
            reason = attempt.get('reason', 'unknown')
            error = attempt.get('error_detail', '')
            failed_str += f"- **{attempt.get('id', '?')}**: {desc}\n  Failure: {reason}\n"
            if error:
                failed_str += f"  WGSL error: {error[:200]}\n"

    prompt = f"""You are evolving WGSL compute shaders for a cellular automata physics engine.

## Current Phase: {phase_name}
{phase_config['description']}

## Bitmask Schema (32-bit voxel state):
Bits 0-7: Material ID (256 materials), Bits 8-15: Thermal energy (0-255),
Bits 16-19: Kinetic X (-8 to +7, 4-bit two's complement),
Bits 20-23: Kinetic Y (-8 to +7, 4-bit two's complement),
Bits 24-27: Phase state (16 substates), Bits 28-31: Flags (4 bits)

## Functions to evolve: {', '.join(evolvable_funcs)}

## Available types and definitions (prepended automatically to your code):
The following struct and constants are already defined — do NOT redefine them:
```wgsl
struct VoxelState {{ material: u32, thermal: u32, kinetic_x: i32, kinetic_y: i32, phase: u32, flags: u32 }}
const MATERIAL_SHIFT: u32 = 0u; const MATERIAL_MASK: u32 = 0xFFu;
const THERMAL_SHIFT: u32 = 8u; const THERMAL_MASK: u32 = 0xFFu;
const KINETIC_X_SHIFT: u32 = 16u; const KINETIC_X_MASK: u32 = 0xFu;
const KINETIC_Y_SHIFT: u32 = 20u; const KINETIC_Y_MASK: u32 = 0xFu;
const PHASE_SHIFT: u32 = 24u; const PHASE_MASK: u32 = 0xFu;
const FLAGS_SHIFT: u32 = 28u; const FLAGS_MASK: u32 = 0xFu;
```

## COMPLETE WORKING EXAMPLE (this compiles and runs correctly — use as reference):
```wgsl
{_get_working_example(phase_config)}
```

## Parent shaders (best performers so far):
{chr(10).join(parent_code_blocks)}

## Archive summary:
{archive_summary}
{failed_str}

## Your task:
Create a NEW WGSL variant that improves on the parents.

## CRITICAL WGSL type rules (violations cause compilation failure):
- WGSL has STRICT type checking: u32 and i32 are NOT interchangeable
- Bitwise ops (&, |, ^, <<, >>) require BOTH operands to be the SAME type (both u32 or both i32)
- Comparison of i32 with u32 literal is ILLEGAL: use i32(literal) or u32(variable)
- VoxelState.kinetic_x and kinetic_y are i32. When packing, cast to u32: u32(kx) & KINETIC_X_MASK
- All mask constants (MATERIAL_MASK etc) are u32. Never compare i32 fields directly with them
- The XOR sign extension trick: i32((raw ^ 0x8u) - 0x8u) — all u32 arithmetic, cast to i32 at the end
- clamp() in WGSL requires all args same type. Use max(min(...)) pattern with explicit casts
- shift amounts must be u32: x >> 2u not x >> 2
- Boolean comparisons: use == for equality, result is bool not u32
- select(false_val, true_val, condition) replaces ternary operator

## Rules:
- Output COMPLETE WGSL code inside a ```wgsl code block
- The shader will be prepended with bitmask_defs.wgsl (VoxelState struct, all masks/shifts/material constants, GRID_WIDTH=1024, GRID_HEIGHT=1024)
- {f"Phase 1a winner (pack_voxel, unpack_voxel, exchange_thermal) is LOCKED and prepended automatically" if phase_config.get("locked_from") else "Include ALL function definitions"}
- All code must be valid WGSL (NOT GLSL, NOT HLSL)
- Bindings: @group(0) @binding(0) var<storage, read> grid_in: array<u32>;
            @group(0) @binding(1) var<storage, read_write> grid_out: array<u32>;
- Entry point: @compute @workgroup_size(16, 16) fn tick(...)

## Hard constraints:
- Matter conservation: total material count must be EXACTLY preserved
- Determinism: same input must always produce same output
- No data races between workgroups

Also provide a one-line description of what makes this variant different."""

    system_directive = _load_program_directive()

    response = None
    for attempt in range(5):
        try:
            response = client.messages.create(
                model="claude-opus-4-20250514",
                max_tokens=4096,
                system=system_directive if system_directive else anthropic.NOT_GIVEN,
                messages=[{"role": "user", "content": prompt}],
                timeout=120.0,
            )
            break
        except Exception as api_err:
            wait = 10 * (2 ** attempt)
            print(f"    API attempt {attempt+1}/5 failed: {api_err}")
            print(f"    Retrying in {wait}s...")
            sys.stdout.flush()
            time.sleep(wait)
    if response is None:
        raise ConnectionError("Anthropic API unreachable after 5 attempts")

    response_text = response.content[0].text

    # Extract WGSL code from response (between ```wgsl and ```)
    wgsl_match = re.search(r'```wgsl\s*\n(.*?)```', response_text, re.DOTALL)
    if wgsl_match:
        shader_code = wgsl_match.group(1).strip()
    else:
        # Try without language tag
        wgsl_match = re.search(r'```\s*\n(.*?)```', response_text, re.DOTALL)
        if wgsl_match:
            shader_code = wgsl_match.group(1).strip()
        else:
            shader_code = response_text  # Use raw text as fallback

    new_functions = extract_wgsl_functions(shader_code, evolvable_funcs)

    # Extract description
    description = "LLM-generated WGSL variant"
    desc_match = re.search(r'(?:description|different|variant|improvement).*?[:\-]\s*(.+)',
                           response_text, re.IGNORECASE)
    if desc_match:
        description = desc_match.group(1).strip()[:120]

    return new_functions, description, shader_code


# ---------------------------------------------------------------------------
# Hard constraint checking
# ---------------------------------------------------------------------------

def check_hard_constraints(fitness: dict, phase_config: dict) -> tuple[bool, str]:
    """Check if a candidate passes hard constraints. Returns (passed, reason)."""
    constraints = phase_config.get("hard_constraints", {})

    if fitness.get("diverged"):
        return False, "Shader compilation or pipeline creation failed"

    for key, required_value in constraints.items():
        actual = fitness.get(key)
        if actual is None:
            return False, f"Missing metric: {key}"

        if key.endswith("_min"):
            # Minimum threshold
            metric_key = key[:-4]
            if fitness.get(metric_key, 0) < required_value:
                return False, f"{metric_key} ({fitness.get(metric_key)}) below minimum ({required_value})"
        elif isinstance(required_value, float) and required_value == 1.0:
            # Must be exactly 1.0
            if actual != 1.0:
                return False, f"{key} ({actual}) must be exactly 1.0"
        elif isinstance(required_value, int) and required_value == 0:
            # Must be exactly 0
            if actual != 0:
                return False, f"{key} ({actual}) must be exactly 0"
        else:
            if actual > required_value:
                return False, f"{key} ({actual}) exceeds limit ({required_value})"

    return True, "passed"


# ---------------------------------------------------------------------------
# Main evolution loop
# ---------------------------------------------------------------------------

def run_evolution(phase: str, max_hours: float = 2.0):
    """Main evolution loop for a given phase."""
    from engine.runner import GPUTrialRunner, generate_test_data, generate_test_grid, generate_sparse_grid

    phase_config = PHASE_CONFIG[phase]
    archive_file = phase_config["archive_file"]
    objectives = phase_config["objectives"]
    higher_is_better = phase_config.get("higher_is_better", [])

    print(f"=== State Space Evolution: {phase_config['name']} ===")
    print(f"Max hours: {max_hours}")
    print(f"Objectives: {objectives}")
    print(f"Archive: {archive_file}")
    sys.stdout.flush()

    # Initialize GPU runner
    runner = GPUTrialRunner()
    print("GPU trial runner initialized")

    # Load or create archive
    archive = Archive.load(archive_file)
    print(f"Archive loaded: {len(archive.candidates)} candidates")

    # Generate test data
    if phase == "1a":
        test_data = generate_test_data(n=phase_config.get("test_size", 1_048_576))
        print(f"Test data: {len(test_data)} voxels")

    # Create seed population if archive is empty
    if not archive.candidates:
        print("\nCreating seed population...")
        seeds = load_seed_shaders(phase_config["seeds_dir"])
        for i, seed in enumerate(seeds):
            candidate = Candidate(
                id=f"seed_{seed['name']}",
                generation=0,
                parent_ids=[],
                mutation_description=f"Seed: {seed['name']}",
                code_diff="initial seed",
                phase=phase,
                created_at=datetime.now().isoformat(),
                evolvable_code={"_full_shader": seed["source"]},
            )
            archive.add(candidate)
            print(f"  Added seed: {seed['name']}")
        archive.save(archive_file)

    # Evolution loop
    start_time = time.time()
    trial_count = 0
    failed_attempts = []
    no_improvement_checks = 0
    best_primary = float("inf")

    print(f"\nStarting evolution loop...")
    sys.stdout.flush()

    while True:
        elapsed_hours = (time.time() - start_time) / 3600
        if elapsed_hours >= max_hours:
            print(f"\nTime budget exhausted ({elapsed_hours:.1f}h)")
            break

        # --- Evaluate unevaluated candidates ---
        unevaluated = [c for c in archive.candidates if not c.is_evaluated()]
        if unevaluated:
            candidate = unevaluated[0]
            print(f"\n[Trial {trial_count+1}] Evaluating: {candidate.id}")
            sys.stdout.flush()

            # Get shader code
            shader_code = candidate.evolvable_code.get("_full_shader", "")
            if not shader_code:
                shader_code = assemble_shader(candidate.evolvable_code, phase_config)

            # Prepend locked winners for phases that depend on prior phases
            # Strip entry points/bindings from locked code since the new shader has its own
            if phase_config.get("locked_from"):
                locked_code = ""
                for locked_phase in phase_config["locked_from"]:
                    locked_path = WORK_DIR / "locked" / f"phase_{locked_phase}_winner.wgsl"
                    if locked_path.exists():
                        stripped = strip_entry_points_and_bindings(locked_path.read_text())
                        locked_code += f"// [LOCKED] Phase {locked_phase} functions\n" + stripped + "\n\n"
                shader_code = locked_code + shader_code

            # Apply WGSL auto-fixer before compilation
            shader_code = fix_wgsl(shader_code)
            warnings = validate_wgsl_basic(shader_code)
            if warnings:
                print(f"  WGSL warnings: {'; '.join(warnings)}")

            # Run trial
            if phase == "1a":
                fitness = runner.run_pack_unpack_trial(shader_code, test_data)
            elif phase == "1b":
                grid = generate_test_grid(
                    phase_config["grid_width"], phase_config["grid_height"]
                )
                fitness = runner.run_sync_trial(
                    shader_code, grid,
                    phase_config["grid_width"], phase_config["grid_height"]
                )
            elif phase == "1c":
                sparse_grid = generate_sparse_grid(1024, 1024)
                locked_1a_path = WORK_DIR / "locked" / "phase_1a_winner.wgsl"
                ref_shader_path = WORK_DIR / "locked" / "phase_1b_winner.wgsl"
                ref_1a_funcs = strip_entry_points_and_bindings(locked_1a_path.read_text())
                ref_shader = ref_1a_funcs + "\n\n" + ref_shader_path.read_text()
                fitness = runner.run_spatial_trial(
                    shader_code, sparse_grid, ref_shader, 1024, 1024
                )
            elif phase.startswith("2"):
                from engine.schema import build_cold_table_buffer
                cold_table_data = build_cold_table_buffer()
                gw = phase_config.get("grid_width", 256)
                gh = phase_config.get("grid_height", 256)
                grid = generate_test_grid(gw, gh, fill_ratio=0.4)
                fitness = runner.run_physics_trial(
                    shader_code, grid, cold_table_data, gw, gh, n_ticks=20
                )
            else:
                fitness = {"diverged": True, "error": f"Phase {phase} runner not implemented"}

            # Check hard constraints
            passed, reason = check_hard_constraints(fitness, phase_config)
            if not passed:
                fitness["disqualified"] = True
                fitness["disqualification_reason"] = reason
                print(f"  DISQUALIFIED: {reason}")
                error_detail = fitness.get("error", "")
                if error_detail:
                    # Truncate long errors but keep the useful part
                    error_detail = error_detail[:300]
                failed_attempts.append({
                    "id": candidate.id,
                    "description": candidate.mutation_description,
                    "reason": reason,
                    "error_detail": error_detail,
                })
            else:
                primary_val = fitness.get(objectives[0], float("inf"))
                fitness_str = ", ".join(f"{k}={v}" for k, v in fitness.items()
                                        if k not in ("diverged", "disqualified", "error",
                                                      "disqualification_reason"))
                print(f"  FITNESS: {fitness_str}")

            candidate.fitness = fitness
            trial_count += 1

            # Log
            log_entry = {
                "timestamp": datetime.now().isoformat(),
                "trial": trial_count,
                "candidate_id": candidate.id,
                "fitness": fitness,
                "elapsed_hours": elapsed_hours,
            }
            with open(RESULTS_FILE, "a") as f:
                f.write(json.dumps(log_entry) + "\n")

            archive.save(archive_file)

            # Update progress
            front = archive.get_pareto_front(objectives, higher_is_better)
            best_in_front = min(
                (c.fitness.get(objectives[0], float("inf")) for c in front),
                default=float("inf")
            )
            progress = {
                "phase": phase,
                "trial_count": trial_count,
                "archive_size": len(archive.candidates),
                "front_size": len(front),
                "best_primary": best_in_front,
                "diversity": archive.get_diversity_score(),
                "elapsed_hours": elapsed_hours,
                "timestamp": datetime.now().isoformat(),
            }
            with open(PROGRESS_FILE, "w") as f:
                json.dump(progress, f, indent=2)

            continue  # Evaluate next unevaluated before mutating

        # --- Check convergence ---
        if trial_count >= MIN_TRIALS_BEFORE_CONVERGENCE and trial_count % 3 == 0:
            front = archive.get_pareto_front(objectives, higher_is_better)
            current_best = min(
                (c.fitness.get(objectives[0], float("inf")) for c in front),
                default=float("inf")
            )
            improvement = best_primary - current_best
            if improvement < 0.0001:
                no_improvement_checks += 1
                print(f"  Convergence check: no improvement ({no_improvement_checks}/{CONVERGENCE_THRESHOLD})")
            else:
                no_improvement_checks = 0
                best_primary = current_best
                print(f"  New best: {current_best}")

            if no_improvement_checks >= CONVERGENCE_THRESHOLD:
                print(f"\nConverged after {trial_count} trials")
                break

        # --- Diversity injection ---
        diversity = archive.get_diversity_score()
        if diversity < DIVERSITY_THRESHOLD and trial_count > 5:
            print(f"  Low diversity ({diversity:.2f}), injecting random seeds...")
            seeds = load_seed_shaders(phase_config["seeds_dir"])
            import random
            for seed in random.sample(seeds, min(RANDOM_INJECTION_COUNT, len(seeds))):
                candidate = Candidate(
                    id=f"inject_{trial_count}_{seed['name']}",
                    generation=trial_count,
                    parent_ids=[],
                    mutation_description=f"Diversity injection: {seed['name']}",
                    code_diff="diversity injection",
                    phase=phase,
                    created_at=datetime.now().isoformat(),
                    evolvable_code={"_full_shader": seed["source"]},
                )
                archive.add(candidate)

        # --- Mutate ---
        evaluated = [c for c in archive.candidates if c.is_viable()]
        if len(evaluated) < 2:
            print("  Not enough evaluated candidates for mutation, waiting...")
            time.sleep(1)
            continue

        queued = len([c for c in archive.candidates if not c.is_evaluated()])
        if queued >= 2:
            # Don't queue too many unevaluated
            continue

        parents = archive.select_parents(PARENTS_PER_GEN, objectives, higher_is_better)
        print(f"\n  Mutating from {len(parents)} parents...")
        sys.stdout.flush()

        try:
            archive_summary = (
                f"Archive: {len(archive.candidates)} candidates, "
                f"{len(evaluated)} evaluated, "
                f"front size: {len(archive.get_pareto_front(objectives, higher_is_better))}, "
                f"diversity: {diversity:.2f}"
            )
            new_functions, description, full_shader = mutate_with_llm(
                parents, phase_config, archive_summary, failed_attempts
            )

            gen_id = f"gen{trial_count}_{int(time.time()) % 10000}"
            candidate = Candidate(
                id=gen_id,
                generation=trial_count,
                parent_ids=[p.id for p in parents],
                mutation_description=description,
                code_diff=description,
                phase=phase,
                created_at=datetime.now().isoformat(),
                evolvable_code={**new_functions, "_full_shader": full_shader},
            )
            archive.add(candidate)

            # Log genealogy
            genealogy_entry = {
                "id": gen_id,
                "parents": [p.id for p in parents],
                "description": description,
                "timestamp": datetime.now().isoformat(),
            }
            with open(GENEALOGY_FILE, "a") as f:
                f.write(json.dumps(genealogy_entry) + "\n")

            print(f"  Created: {gen_id} -- {description}")

        except Exception as e:
            print(f"  Mutation failed: {e}")
            failed_attempts.append({
                "id": f"mutation_error_{trial_count}",
                "description": "LLM mutation",
                "reason": str(e),
            })

    # --- Save final results ---
    print(f"\n=== Evolution complete ===")
    print(f"Trials: {trial_count}")
    print(f"Elapsed: {(time.time() - start_time) / 3600:.2f}h")

    front = archive.get_pareto_front(objectives, higher_is_better)
    if front:
        best = min(front, key=lambda c: c.fitness.get(objectives[0], float("inf")))
        print(f"Best candidate: {best.id}")
        print(f"  Fitness: {best.fitness}")
        print(f"  Description: {best.mutation_description}")

        # Save winner
        winner_file = WORK_DIR / "locked" / f"phase_{phase}_winner.wgsl"
        winner_file.parent.mkdir(parents=True, exist_ok=True)
        winner_shader = best.evolvable_code.get("_full_shader", "")
        if winner_shader:
            winner_file.write_text(winner_shader)
            print(f"  Winner locked to: {winner_file}")

        # Save winner metadata
        winner_meta = WORK_DIR / f"winner_phase_{phase}.json"
        with open(winner_meta, "w") as f:
            json.dump(asdict(best), f, indent=2)

    archive.save(archive_file)
    return front


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="State Space evolutionary WGSL search")
    parser.add_argument("--phase", choices=list(PHASE_CONFIG.keys()), required=True,
                        help="Evolution phase to run")
    parser.add_argument("--max-hours", type=float, default=2.0,
                        help="Maximum evolution time in hours")
    args = parser.parse_args()

    run_evolution(args.phase, args.max_hours)


if __name__ == "__main__":
    main()
