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

## 0.4.0 - unreleased (version string since 2026-10-11, entries to 2026-10-22)

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
  guarantee; for it, world ticks now fail when their check sees a listed
  array, map, set or typed-array built-in replaced after the SDK loaded,
  result copies no longer assign through prototype setters, and a tick
  job cannot be advanced or cancelled from inside its own `advance()` (the
  reactive materials guide gives the limits). A standalone structure job driven one work unit per
  `advance()` call is slower than before (#68).

### Fixed

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
