# Changelog

All notable changes to State Space. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries name the
pull request that landed them and describe what changed, not what was
measured. Qualification and performance claims live in
[validation status](docs/VALIDATION_STATUS.md) and the
[checkpoint reports](docs/checkpoints/README.md), not here.

No Git tag marks a release yet. Each section covers the period during which
`pyproject.toml` and `package.json` carried that version string, with the
date of the last change in the section.

## 0.4.0 - unreleased (version string since 2026-10-11, entries to 2026-11-06)

### Added

- Deterministic pressure, quantized velocity and dam/steam failure, with
  schema 4 and rules `ca-v4` (#14); refreshed physics demos (#16).
- Native material shading, lighting, water, haze and heat distortion (#10).
- Spillway, a 2D reference game with exact replay, full input recording and
  a full-frame benchmark (#17).
- Experimental 3D line: M1 volume lab and M2 WebGPU terrain with the
  first-person crossing (#18), M3 chunked worlds and the seeded cavern (#19),
  M4 active worlds with resident GPU gameplay (#20), M5 structural terrain
  and the structural cavern (#22), naturalistic cavern materials and
  atmospherics (#21).
- Tactical and reactive SDK families, lighting caches and guarded
  verification (#24); the reactive chamber with real Worker previews and
  exact replay (#29); three measured 16-cubed reactive sandbox scenarios
  (#34); the opt-in thermal material pack with three reactive scenes (#35).
- macOS qualification stages, portable CI and installed SDK checks (#25);
  bulk evidence archives with verified restoration (#26).
- Experimental `ca-3d-m6` structural worlds: a validated reactive catalog
  (builtins, custom definitions or the thermal pack) binds its cold table into
  the M5 CPU, dense GPU and active GPU backends and adds the six-neighbor
  combustion pass with consumed supports; `ca-3d-m5` is unchanged (#83).
- Catalog-driven terrain rendering and two reactive structural cavern chambers:
  a 256-entry palette from the world's law with gas cutouts and catalog-derived
  flame/melt glow, `inspectMaterials()` on structural worlds, and the
  `burning-bridge` and `thermal-valve` scenes (with a ceramic toggle) behind a
  `catalog` parameter, with pinned tick windows in the pilots and replays;
  supervised macOS qualification stages `m6-gameplay-*` and `m6-replay-*` for
  those chambers at 32³ and 64³, and `m6-tiny-dense` / `m6-tiny-active` for the
  8³/16³ parity probes from the structural probe bundle (#83).
- Private multiphysics gate closure: named tipping, hydrostatic column, viscous
  decay, moving paddle and displaced-liquid cases with a published per-gate
  budget table; a module Worker entry and page probe bundled by
  `npm run build:multiphysics-probe`; and headless `multiphysics-worker-<scene>`
  macOS stages for the five demonstrations and a 26-sample timed cup (#90).
- The multiphysics runtime is public: the world, edit receipts, previews, tick
  jobs, demonstrations and the module Worker are exported from
  `experimental/3d/multiphysics`, with `serveMultiphysicsWorker3D` and
  `startMultiphysicsWorker3D`. The interactive multiphysics builder
  (`npm run build:multiphysics-builder`) has an oriented renderer, edits with
  receipts, compare, cancel, save and load, and visible
  `multiphysics-builder-<scene>-visible` macOS stages (#91).

### Changed

- GPU tick and global-support optimization for the public 256x256 backends
  (#8); browser frame pacing and pooled tick buffers (#13); one validation
  per tick with a dedicated solver marker (#11).
- Structural worklist reuse (#27); 128-cubed cut-scene profiling and
  structural optimizations (#28); bounded M5 solver fallback budgets (#23).
- Ownership, shared validation and SDK tooling refinements (#30, #32);
  SDK guide, evidence archive and experimental module organization (#33).
- README rewritten around engine setup and measured performance (#9).
- Reactive CPU tick: one validation per tick, uncopied hand-offs between
  evolution, reaction and structure stages, copy-on-write passes and an
  explicit structure stepper, with bit-identical results (#62).
- Prettier formats every hand-written engine, example, script and test
  source, with generated, vendored, archived and frozen files excluded, and
  CI checks the whole tree (#63).
- The rock textures ship once as `experimental/3d/rock-textures`, shared by
  the four GPU world bundles instead of copied into each (#64).
- The experimental root is split into `volume/`, `structural/` and
  `gameplay/` folders; SDK entry barrels, the frozen material-law sources
  and the primitives they import stay at the root (#65, #66).
- Audit housekeeping: two documentation links to unpublished evidence are
  corrected, the lab, SDK and shared example folders have READMEs, the README
  and game README use `sh` fences with repository-relative commands, the stale
  Windows developer files are removed, and the recorded evolution phase winners
  move from the root into `archive/` (#67).
- Second reactive CPU pass: per-registry thermal tables for the block check
  and the reaction passes, a batched structure stepper, one movement working
  copy per tick with row skipping, combustion elected from one scan, and an
  owned world that adopts a committed tick's state instead of copying it,
  with bit-identical results for plain data in an unmodified JavaScript
  realm. A realm whose built-ins caller code replaced or hooked carries no
  guarantee. For it, world ticks now fail when their check sees a listed
  array, map, set or typed-array built-in replaced after the SDK loaded,
  a world's snapshots and tick commits and the results and motion reports
  of world tick jobs copy without assigning through prototype setters, and
  a world tick job cannot be advanced or cancelled from inside its own
  `advance()`; the reactive materials guide gives the scope and limits of
  each. A standalone structure job driven one work unit per `advance()`
  call is slower than before (#68).
- Hosted CI runs the complete Python test suite and `python -m engine.lint`
  under the CPU supervisor, and a second job installs, tests and builds the
  `game/` and `tower-defense-rogue/` prototypes. The CPU-only cases of the
  native Vitest fixtures move to `engine/sdk.cpu.test.ts`,
  `engine/structure.cpu.test.ts` and `engine/conformance.cpu.test.ts`, which
  `npm test` selects; the structure negative controls plan their corpus with
  the bulk Python planner (`tests.structure_cpu_cases`) instead of the native
  transport. `tests/test_enthalpy*.py` import `tests.enthalpy_cases`, so
  `python -m unittest tests.test_enthalpy` resolves.

### Fixed

- Multiphysics: a solid counts toward a liquid row's resolved support only while
  touching it, so an approaching plate no longer switches on the zero-divergence
  constraint at a distance; parcel reads, inventories and the active-set factor
  avoid redundant copies and refactoring with bit-identical results (#90).
- `ca-3d-m6` CPU combustion rotates by the same 32-bit tick word as the GPU
  backends, so they no longer diverge from tick 2^32; the tiny probe's dormant
  check can now fail; retained Mac receipts use repo-relative paths (#84).
- The verification guard keeps a complete receipt when the POSIX watchdog fires
  on the supervisor's deadline (#84).
- Python-backed Vitest fixtures and the Node verification guard resolve one
  interpreter (`PYTHON`, `STATE_SPACE_PYTHON`, the checkout's venv, `python3`,
  `python`) instead of a bare `python`, so `npm test` passes on hosts whose
  default interpreter lacks numpy (#83).
- The native structure tests' negative controls match the formatted source
  again, and the CPU suite checks their anchors (#71).
- Default water stays liquid at the reference temperature (#15).
- Historical source-hash collectors retain nested modules (#33).
- Frame-clock wording in the heat performance report (#12).

## 0.3.0 - 2026-09-09 (version string 2026-09-07 to 2026-10-11)

### Added

- The v3 engine SDK with coupled structural physics (cohesion, support,
  breakage, coherent fragments), rules `ca-v3`, and the reference lab (#7).
- The C1 to C7 checkpoint series: authoritative contracts, backend
  conformance, exact energy accounting, embedding and extension, trustworthy
  evolution and performance, richer interacting physics, and the engine
  reference release. See `ENGINE_ROADMAP.md`.
- MIT license and open-source preparation (2026-09-09, no pull request).

## 0.1.0 - 2026-05-18 (version string 2026-05-06 to 2026-09-07)

### Added

- Stabilized engine baseline and the engine invariant harness, following the
  April 2026 evolutionary kernel search recorded in `EVOLUTION_CHRONICLE.md`
  (2026-05-06, no pull request).
- Conservative movement v2 (#2).
- Deterministic invariant fuzz coverage (#5, #6).
- Element Fighter prototype (#1, #4) and its engine snapshot combat bridge (#3).
