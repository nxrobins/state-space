# State Space: Evolution Chronicle

Lineage tracking for every phase of the State Space engine, built via
AlphaEvolve-style evolutionary search using Claude as the mutation engine.

**Target GPU:** NVIDIA RTX 4090 24GB (Ada Lovelace)
**Runtime:** wgpu-native (Python) — headless GPU compute
**Started:** 2026-04-03

---

## Phase 0: Bitmask Schema (Manual)

**Status:** LOCKED
**Date:** 2026-04-03

32-bit voxel encoding:
```
Bits  0-7:  Material ID   (256 materials)
Bits  8-15: Thermal energy (0-255)
Bits 16-19: Kinetic X      (-8 to +7, signed 4-bit)
Bits 20-23: Kinetic Y      (-8 to +7, signed 4-bit)
Bits 24-27: Phase state    (16 substates)
Bits 28-31: Flags          (burning, conducting, pressurized, player-owned)
```

12 core materials defined: air, stone, water, sand, fire, metal, oil, wood, ice, steam, lava, glass.

**Validation:** CPU roundtrip test (pack/unpack) passed for all edge cases + 100K random values.

---

## Phase 1a: Pack/Unpack Optimization

**Status:** LOCKED
**Date:** 2026-04-03
**Trials:** 30 (Run 1: Sonnet, Run 2: Sonnet with improved prompts)
**Elapsed:** ~10 min total
**Mutation model:** Claude Sonnet 4

### Seeds
| Seed | cycle_time_us | roundtrip_errors | Status |
|------|-------------|------------------|--------|
| seed_basic | 0.000913 | 0 | PASS |
| **seed_branchless** | **0.000893** | **0** | **WINNER** |
| seed_vectorized | 0.001220 | 0 | PASS |

### Winner: `seed_seed_branchless`

- **Fitness:** 0.000893 us/voxel (0.937ms for 1M voxels), 0 roundtrip errors
- **Lineage:** Seed (no LLM parents)
- **Key technique:** Branchless sign extension using `(val ^ 0x8u) - 0x8u` XOR trick
- **Single-expression pack** — compiler fuses all OR operations

### Notes

LLM mutation success rate was very low (~7%) due to WGSL strict type system.
All mutations failed with i32/u32 type mismatches. The seeds were already
near-optimal for this operation — sub-microsecond for 1M voxels leaves very
little room for improvement.

**Locked to:** `locked/phase_1a_winner.wgsl`

---

## Phase 1b: Lock-Free Synchronization

**Status:** LOCKED
**Date:** 2026-04-03
**Trials:** 30 (with Opus + WGSL auto-fixer + working example)
**Elapsed:** 17 min
**Mutation model:** Claude Opus 4

### Seeds
| Seed | tick_time_ms | matter_conservation | determinism | Status |
|------|-------------|-------------------|-------------|--------|
| seed_checkerboard | 7.372 | 0 | 1.0 | PASS (slow) |
| seed_double_buffer | — | 0 | 0.0 | DISQUALIFIED (non-deterministic) |
| seed_thermal_only | 0.128 | 0 | 1.0 | PASS |

### Evolution Pareto Front (top 5 by tick_time_ms)

| Candidate | tick_time_ms | Parents | Strategy |
|-----------|-------------|---------|----------|
| **gen21_2978** | **0.103** | gen8, gen7, gen9 | **Bit-packed neighbor states, vec4 SIMD accumulation** |
| gen23_3052 | 0.121 | gen8, gen9, gen10 | Spatial hashing with alternating update patterns |
| gen15_2746 | 0.126 | gen8, gen7, gen9 | Wave-front pattern variant |
| gen18_2858 | 0.136 | gen8, gen7, gen9 | Priority weighting with wave phase alternation |
| gen27_3220 | 0.137 | gen21, gen14, gen23 | Alternating sweep directions, packed neighbors |

### Winner: `gen21_2978` — "Bit-packed neighbor states"

- **Fitness:** 0.103ms/tick on 1024x1024, matter_conservation=0, determinism=1.0
- **Lineage:** gen21 <- [gen8, gen7, gen9] <- seeds
- **Improvement over best seed:** 19.5% faster than seed_thermal_only (0.128ms)
- **Key innovations:**
  1. **Block-phase pattern:** 2x2 blocks process diagonals in different phases
  2. **Bit-packed validity mask:** Single u32 tracks which of 8 neighbors are valid
  3. **Vectorized accumulation:** `vec4<u32>` + `dot()` for parallel thermal summation
  4. **Weighted averaging:** Cardinals 2x, diagonals 1x, self 16x
  5. **Early air skip:** Air voxels bypass all processing

### Lineage Tree
```
seed_thermal_only ──┐
seed_checkerboard ──┤
                    ├─> gen4 (0.131ms) ─┐
                    ├─> gen5 (0.143ms) ─┤
                    │                   ├─> gen7 (0.098ms) ──┐
                    │                   ├─> gen8 (0.098ms) ──┤
                    │                   ├─> gen9 (0.099ms) ──┤
                    │                   │                    ├─> gen21 (0.103ms) ★ WINNER
                    │                   │                    ├─> gen23 (0.121ms)
                    │                   │                    └─> gen27 (0.137ms)
                    │                   └─> gen10 (0.102ms) ─┘
```

### Mutation Quality (Opus vs Sonnet)

| Metric | Run 1 (Sonnet) | Run 2 (Opus + fixes) |
|--------|---------------|---------------------|
| Compilation success | 7% (2/27) | 78% (21/27) |
| Valid + constraints | 3.7% (1/27) | 67% (18/27) |
| Best evolved tick_ms | 0.129 (seed only) | 0.098 (24% faster) |

Three stacked improvements:
1. **Opus model** — understands WGSL type system far better
2. **WGSL auto-fixer** — removes redefinitions, fixes literal suffixes
3. **Working example** — full compilable reference in mutation prompt

**Locked to:** `locked/phase_1b_winner.wgsl`

---

## Phase 1c: Spatial Partitioning

**Status:** LOCKED
**Date:** 2026-04-03
**Trials:** 29 (Opus + WGSL auto-fixer + working example)
**Elapsed:** ~25 min
**Mutation model:** Claude Opus 4

### Seeds
| Seed | workgroup_reduction | overhead_ms | output_match | Status |
|------|-------------------|-------------|--------------|--------|
| **seed_border_aware** | **96.5%** | **1.05ms** | **1.0** | **WINNER** |
| seed_subgroup_vote | 96.5% | 1.06ms | 1.0 | PASS |
| seed_workgroup_scan | 96.5% | 1.28ms | 1.0 | PASS |

### Winner: `seed_border_aware` — "Border-aware activity scan"

- **Fitness:** 96.5% workgroup reduction, 1.05ms overhead, exact output match
- **Lineage:** Seed (LLM mutations couldn't beat seeds due to WGSL `atomic<u32>` complexity)
- **Active workgroups:** 725 / 20,480 total (on 5-cluster sparse grid)
- **Key techniques:**
  1. **Per-workgroup activity scan:** Each 16x16 tile scans all 256 voxels for non-air
  2. **Border halo checking:** Edge threads also check 1-pixel border around tile
  3. **Early exit:** If tile + border are all air, just copy and return
  4. **Atomic counter:** Tracks how many workgroups actually process (binding(2))
  5. **Exact Phase 1b logic:** Active tiles run the full block-based thermal diffusion

### Evolution Notes

LLM mutations had ~20% compilation success rate on Phase 1c (down from 78% on 1b).
The main blocker was WGSL's `atomic<u32>` semantics — `atomicAdd` requires
`ptr<storage, atomic<u32>, read_write>` and the LLM consistently used `ptr<storage, u32>`.
Several mutations produced `workgroup_reduction=1.0` (100% reduction) meaning they
skipped ALL workgroups — a bug, not an optimization. The seeds were already
near-optimal for this phase's test scenario.

**ENGINE GATE PASSED:** Phases 1a+1b+1c compose correctly. Core compute engine validated.

**Locked to:** `locked/phase_1c_winner.wgsl`

---

## Architecture Decision: Path B — Cold Property Table

**Status:** LOCKED
**Date:** 2026-04-03
**Decision:** 32-bit hot state + cold property lookup table

### Problem

Phase 2 interactions require material properties not in the 32-bit bitmask:
conductivity, porosity, boiling point, flash point, reactivity, optical properties.
Two paths: (A) upgrade to 64-bit per voxel, or (B) lookup table indexed by Material ID.

### Decision: Path B

- **Hot state (per-voxel, 32-bit):** material, thermal, kinetic_x/y, phase, flags
  — changes every frame, must be fast per-voxel bandwidth
- **Cold table (per-material, 8KB):** density, conductivity, melt_point, boil_point,
  flash_point, reactivity, porosity, optical
  — constant across frames, one indirection per neighbor read

### Table Layout

256 entries x 8 u32s/entry = 8KB total. Fits in GPU L1 cache.
```
Offset 0: density       (0-255, gravity weight)
Offset 1: conductivity  (0-255, thermal transfer rate)
Offset 2: melt_point    (thermal threshold solid->liquid)
Offset 3: boil_point    (thermal threshold liquid->gas)
Offset 4: flash_point   (thermal threshold for ignition, 0=non-flammable)
Offset 5: reactivity    (0-255, reaction rate)
Offset 6: porosity      (0-255, fluid permeability)
Offset 7: optical       (packed: absorption|emission|color_r|color_g)
```

### Binding Convention for Phase 2+ Shaders

```
@group(0) @binding(0): grid_in (read-only storage)
@group(0) @binding(1): grid_out (read-write storage)
@group(0) @binding(2): active_counter (atomic, for spatial culling)
@group(0) @binding(3): cold_table (read-only storage, 8KB)
```

### Why Path B

- Preserves all Phase 1 locks (hot state stays 32-bit)
- No re-benchmarking Phase 1a/1b/1c
- 8KB table fits in L1 cache — indirection is effectively free
- Material properties are constant — no per-frame write bandwidth
- Clean separation: hot state = what changes, cold table = what the material IS

### Validation

GPU cold table lookup verified: reads match Python reference for all 13 materials.

---

## Phase 2: Material Interactions

**Status:** IN PROGRESS
**Goal:** Evolve 4 interaction classes in dependency order

### Sub-phases (each validates independently before composition):

| Sub-phase | Interaction | Key cold table fields | Hard constraints |
|-----------|-----------|---------------------|-----------------|
| **2a** | Thermal diffusion | conductivity | Energy conservation < 0.1% |
| **2b** | Gravity + density sorting | density | Matter conservation == 0 |
| **2c** | Phase transitions | melt_point, boil_point | Matter conservation == 0 |
| **2d** | Combustion / reactions | flash_point, reactivity | Energy + matter conservation |

### NOT in Phase 2 (deferred to Phase 2.5):
- Structural cohesion / bond strength
- Rigid body clusters
- Enemy entities as voxel assemblies

These are a layer above pairwise material interactions.

### Phase 2a: Thermal Diffusion — LOCKED

**Date:** 2026-04-03
**Trials:** 30 (Opus + WGSL auto-fixer + working example)
**Elapsed:** 13 min

**Interface conductivity formula:** LOCKED as harmonic mean `H(a,b) = 2ab/(a+b)`

#### Seeds
| Seed | energy_err | tick_time_ms | Status |
|------|-----------|-------------|--------|
| cardinal_diffusion | 0.078% | 7.62ms | PASS (slow) |
| conservative_exchange | 0.041% | 0.144ms | PASS |
| moore_weighted | 0.121% | 0.183ms | PASS |

#### Winner: `gen18_1314` — Optimized thermal diffusion with precomputed neighbor data

- **Fitness:** energy_err=0.077%, matter=0, determinism=1.0, tick=0.129ms
- **Lineage:** gen18 <- parents from archive (seeds + earlier mutations)
- **Improvement:** 10% faster than best seed (0.129 vs 0.144ms)
- **Key innovations:**
  1. Fused `get_mat_thermal()` — vec2 extraction of material+thermal
  2. Precomputed `self_cond_2x` — bit-shifted conductivity avoids repeated multiply in harmonic mean
  3. `compute_exchange()` helper — factored per-neighbor logic for cleaner code gen
- **Compilation success rate:** ~50% (13/27 mutations compiled)

**Locked to:** `locked/phase_2a_winner.wgsl`

### Phase 2b: Gravity + Density Sorting — LOCKED

**Date:** 2026-04-03
**Trials:** 36 (Opus + WGSL auto-fixer + working example)
**Elapsed:** 20 min
**Compilation success rate:** 97% (32/33 mutations compiled)

**Swap mechanism validated:** `matter_conservation_error=0.0` across ALL 36 trials.
Double-buffer swap works: both threads read `grid_in`, agree deterministically on swap,
each writes only `grid_out[own_cell]`. No race conditions detected.

#### Seeds
| Seed | tick_time_ms | matter_err | determinism | Status |
|------|-------------|-----------|-------------|--------|
| vertical_only | 0.130 | 0 | 1.0 | PASS |
| stochastic_lateral | COMPILE FAIL | — | — | (auto-fixer stripped needed code) |
| lateral_spread | 8.831 | 0 | 1.0 | PASS (slow) |

#### Winner: `gen22_9605` — Optimized gravity with density caching

- **Fitness:** tick=0.096ms, matter=0, determinism=1.0
- **Improvement:** 26% faster than best seed (0.096 vs 0.130ms)
- **Key innovations:**
  1. `check_displace()` returns the displaced voxel directly (or 0 = no swap) via `select()`
  2. Density precomputed once, passed through swap resolution
  3. Parity-based diagonal direction for deterministic lateral spreading
  4. Buoyancy via same mechanism (lighter rises)

#### Dispatch composition note (Phase 2e decision, NOT baked into seeds):
Gravity and thermal are independent kernels. Each reads from the same `grid_in` and
writes `grid_out`. Dispatch order (gravity-first-then-thermal vs interleaved) will be
decided when all 4 interaction classes compose. Two full double-buffer passes per tick
keeps kernels completely independent.

**Locked to:** `locked/phase_2b_winner.wgsl`

### Phase 2c: Phase Transitions — LOCKED

**Date:** 2026-04-04
**Trials:** 30 (Opus + WGSL auto-fixer + working example)
**Elapsed:** 17 min
**Compilation success rate:** 80% (24/30)

**Architecture decisions locked before seeds:**
- Hysteresis bands: freeze_point < melt_point, condense_point < boil_point
- Latent heat: consumed on upward transitions (melt/boil), subtracted with saturating clamp
- Zero = no transition: both threshold AND target must be nonzero
- Cold table expanded: stride 8→16, added freeze/condense points + latent heat + transition targets

**Transition graph:**
```
ice --melt@30(lh=15)--> water --boil@100(lh=40)--> steam
ice <--freeze@25--      water <--condense@90--      steam
stone --melt@220(lh=30)--> lava <--freeze@210-- stone
sand --melt@200(lh=25)--> glass (one-way)
```

#### Winner: `gen26_5906` — Direct array indexing with priority-encoded bitfield

- **Fitness:** tick=0.144ms, energy=0.0, matter=0, determinism=1.0
- **Improvement:** 8.5% faster than best seed (0.144 vs 0.158ms)
- **Key constraint validations:**
  - energy_conservation_error=0.0 across ALL 22 viable trials
  - matter_conservation_error=0.0 across ALL trials
  - No thermal oscillation detected (hysteresis bands holding)
  - Saturating subtract on latent heat: no u8 wrap-around thermal bombs
  - Zero-as-no-transition guard: glass doesn't spontaneously become air

**Locked to:** `locked/phase_2c_winner.wgsl`

### Phase 2d: Combustion with Explicit Oxygen — LOCKED

**Date:** 2026-04-04
**Trials:** 30 (Opus + WGSL auto-fixer + working example)
**Elapsed:** 17 min
**Compilation success rate:** 60% (18/30)

**Architecture decisions locked before seeds:**
- Explicit oxygen model: combustion requires adjacent air voxel
- Air consumed → smoke (material mutation, same pattern as 2c)
- Fuel energy budget: wood=80, oil=150 thermal units released
- Energy audit: total_thermal_after = total_thermal_before + fuel_energy_consumed
- Three conditions: thermal > flash_point AND fuel_energy > 0 AND adjacent_air > 0
- New materials: ash (MAT_ASH=13), smoke (MAT_SMOKE=14)
- Cold table stride: 16→24, added fuel_energy, burns_into, smoke_product fields

**Emergent behaviors enabled (zero scripting):**
- Oxygen starvation: sealed rooms run out of air, fire dies
- Backdraft: breaching a sealed burning room → rush of fresh air → reignition
- Smoke filling: smoke rises (density=3, less than air=1... wait, smoke is denser than air)
- Cascading ignition: burning wood heats adjacent wood via 2a thermal diffusion

#### Winner: `gen24_8262` — Vectorized combustion with fused conditions

- **Fitness:** tick=0.171ms, energy=0.0, matter=0, determinism=1.0
- **Energy conservation:** 0.0 error across ALL viable trials (fuel_energy perfectly audited)
- **Key technique:** Fused combustion condition checking with minimal branching

**Locked to:** `locked/phase_2d_winner.wgsl`

---

## PHYSICS GATE: PASSED

All 4 interaction classes locked and independently validated:
| Class | Winner | tick_time | Conservation |
|-------|--------|----------|-------------|
| Thermal diffusion | gen18_1314 | 0.129ms | energy < 0.08% |
| Gravity + density | gen22_9605 | 0.096ms | matter = 0 |
| Phase transitions | gen26_5906 | 0.144ms | energy = 0, matter = 0 |
| Combustion | gen24_8262 | 0.171ms | energy = 0, matter = 0 |

**Combined tick budget:** ~0.54ms for all 4 kernels (sequential dispatch)
= 1850 fps on 256x256, ~460 fps extrapolated to 1024x1024.
Well within 16ms (60fps) target even at full grid.

**Next:** Phase 2e (composition) validated. Phase 3 (player + rendering).

---

## Phase 2e: Composition Validation — PASSED

**Date:** 2026-04-04

### Dispatch Order (LOCKED)
```
Gravity → Thermal → Phase Transitions → Combustion
```
Four full double-buffer passes per tick. Each kernel reads previous kernel's output.

### Bug Found and Fixed
Locked kernels had stale `COLD_STRIDE` constants (8, 8, 16, 24) due to cold table
expansion across phases. All normalized to stride=24. This caused complete data
corruption in the first run (1091 voxels vanishing, zero ash production).

### Cascade Test: 200 Ticks
Scenario: 5×5 wood block (thermal=150, edge at 200) + stone wall.
```
[1] WOOD ACCOUNTING:     wood_burned (1) == ash_produced (1)     PASS
[2] AIR/SMOKE:           air_consumed (0) == smoke_produced (0)  PASS
[3] TOTAL VOXELS:        16384 → 16384                          PASS
[4] ENERGY BUDGET:       drift = -62 (0.02%)                    PASS
[5] DETERMINISM:         two runs identical                     PASS
```

### Emergent Behaviors Observed
- **Oxygen starvation:** Interior wood surrounded by other wood couldn't burn
  (no adjacent air). Only edge wood with air access ignited. Zero scripting.
- **Thermal cascade:** Heat from stone propagated through wood via conductivity.
- **Energy audit:** Fuel energy (80 per wood) correctly added to thermal budget.

### Performance
- Mean tick: 17.4ms at 128×128 (4 kernel passes)
- Extrapolated 1024×1024: ~140ms/tick (needs optimization for 60fps)
- Bottleneck: first tick compilation overhead (303ms), steady-state ~2.5ms

---

## Phase 3+: Player, Rendering, Scenarios

## Phase 3a+3b: WebGPU Renderer + Input Bridge — WORKING

**Date:** 2026-04-04
**Grid:** 256x256 at 40 FPS (RTX 4090, Chrome without extensions)

### Launch Command
```
# Start server
cd D:\state-space\web && python -m http.server 8095

# Open Chrome WITHOUT extensions (MetaMask SES blocks WebGPU rAF)
chrome --disable-extensions http://localhost:8095
```

### What's Working
- 4-kernel compute pipeline running per frame (gravity->thermal->phase->combustion)
- Fragment shader renders material colors + thermal glow overlay
- Material palette: 12 paintable materials (stone, water, sand, fire, wood, oil, ice, metal, lava, steam, glass, smoke)
- Brush tool with adjustable size
- Keyboard shortcuts: Space=pause, C=clear, 1-9=material select

### Known Issues
- Chrome extensions with SES lockdown (MetaMask) block `requestAnimationFrame` and drastically slow shader compilation. **Must launch with `--disable-extensions`**
- GRID_WIDTH/HEIGHT hardcoded in bitmask_defs.wgsl — must match app.js (currently 256)
- Thermal ceiling clamp at 255 causes ~0.02% energy drift (documented design constraint)
- Shader bundle must be regenerated after any locked kernel change

### Bug Fixed
`bitmask_defs.wgsl` had `GRID_WIDTH=1024` while app used 256×256.
All neighbor lookups (gravity, thermal, phase, combustion) computed `y * 1024 + x`
instead of `y * 256 + x` — reading wrong cells. Fixed by matching constants.

---

## Phase 3c: Player Entity

**Status:** PENDING — deferred until sandbox playtesting reveals tuning needs
**Goal:** Player as voxel cluster, viewport tracking, thermal damage, time-scale slider

---

## Engine Stabilization Pass

**Date:** 2026-05-06
**Status:** CORE CASCADE PASSING

### Changes
- Converted `GRID_WIDTH` and `GRID_HEIGHT` in `engine/shaders/bitmask_defs.wgsl` to WGSL override constants.
- `CompositionEngine` now compiles kernels for the requested grid dimensions and uses the documented order: `Gravity -> Thermal -> Phase Transitions -> Combustion`.
- Replaced the locked gravity kernel with a conservative vertical density-swap pass. It preserves per-material counts exactly and defers diagonal/lateral flow until it can be reintroduced as a separate conservative pass.
- Updated combustion to use mutual fuel-air pairing, preventing one hot fuel voxel from consuming multiple oxygen voxels in one tick.
- Tightened future evolution metrics with `material_count_error` so thermal/gravity candidates cannot pass by preserving only total voxel count.
- Updated the cascade audit for the current flame lifecycle: each wood burn consumes one air voxel and produces two product voxels across ash/fire/smoke states.
- Synced the browser shader bundle to the stabilized locked gravity/combustion shaders.

### Validation
`python test_cascade.py` passes:
- Fuel/oxygen pairing: `wood_burned == air_consumed`
- Combustion products: `ash + fire + smoke == wood_burned + air_consumed`
- Total voxel count preserved
- Thermal drift under 1%
- Deterministic replay

---

## Phase 1: Engine Invariant Harness

**Date:** 2026-05-06
**Status:** ACTIVE BASELINE

### Changes
- Added `ENGINE_INVARIANTS.md` as the core contract for determinism, voxel count,
  material accounting, phase-transition accounting, combustion accounting, and
  grid-size correctness.
- Added `test_invariants.py`, a composed-engine scenario suite covering
  structural solids, sand/water movement, nonreactive conservation, oxygen-gated
  combustion, and one-to-one phase transitions.
- Tightened gravity so only movable source voxels may swap downward. Stone,
  metal, glass, and cold wood now behave as fixed structural supports unless a
  later phase explicitly rewrites them.
- Synced the browser gravity shader and generated shader bundle to the locked
  engine gravity kernel.

### Validation
`python test_invariants.py` passes 10 invariant scenarios:
- Structural solids remain fixed.
- Sand and water settle while preserving material counts.
- Smoke and mixed nonreactive materials preserve exact counts.
- Sealed hot wood cannot burn without adjacent air.
- Exposed hot wood consumes exactly one fuel voxel and one air voxel.
- Ice, water, and sand phase transitions rewrite exactly one voxel into the
  expected material.

---

## Phase 2: Conservative Movement V2

**Date:** 2026-05-06
**Status:** ACTIVE BASELINE

### Changes
- Split movement into explicit conservative swap passes: vertical gravity,
  diagonal fall, horizontal liquid spread, gas buoyancy, and gas spread.
- Added a salted movement schedule so each tick dispatches 13 passes while
  horizontal decisions vary deterministically across ticks.
- Tightened structural eligibility: solid/frozen voxels can fall vertically as
  loose matter, but cannot be displaced as targets by falling matter.
- Removed gas from downward gravity; non-air gas/plasma now use thermal
  buoyancy rank and spread sideways only when upward motion is blocked.
- Strengthened liquid spread so a pair with only one valid liquid source always
  moves that source; the salted hash is used only to break true two-way ties.
- Synced the browser runtime to the same movement schedule and shader set.

### Validation
`python test_invariants.py` passes 18 invariant scenarios:
- Structural targets resist displacement by falling sand.
- Sand falls diagonally around blockers.
- Water and viscous oil spread horizontally while preserving exact counts.
- Water pillars collapse into shallow floor spread instead of stacking.
- Cool smoke does not sink and spreads sideways.
- Hot smoke and steam rise through thermal buoyancy.
- Existing combustion and phase-transition accounting remains covered.
