# Changelog

All notable changes to State Space. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries name the
pull request that landed them. Qualification claims live in
[validation status](docs/VALIDATION_STATUS.md) and the
[checkpoint reports](docs/checkpoints/README.md), not here.

## Unreleased

Nothing yet.

## 0.4.0 - 2026-10-20

Schema 4 / rules `ca-v4`. The version in `package.json` and `pyproject.toml`
is 0.4.0; no Git tag marks it yet.

### Added

- Deterministic pressure, quantized velocity and dam/steam failure (#14),
  with refreshed physics demos (#16).
- Native material shading, lighting, water, haze and heat distortion (#10).
- Spillway, a 2D reference game with exact replay and full-frame benchmarks (#17).
- Experimental 3D line: M1 volume lab, M2 WebGPU terrain and first-person
  crossing (#18), M3 chunked worlds and the seeded cavern (#19), M4 active
  worlds with resident GPU gameplay (#20), M5 structural terrain and the
  structural cavern (#22), naturalistic cavern materials and atmospherics (#21).
- Tactical and reactive SDK families, lighting caches and guarded
  verification (#24); the reactive chamber with real Worker previews and
  exact replay (#29); qualified 16-cubed reactive sandbox scenarios (#34);
  the opt-in thermal material pack with three reactive scenes (#35).
- macOS qualification stages, portable CI and installed SDK checks (#25);
  bulk evidence archives with verified restoration (#26).

### Changed

- Exact 256x256 GPU ticks within the 60 Hz budget (#8); browser frame pacing
  and pooled tick buffers (#13); one validation per tick with a dedicated
  solver marker (#11).
- Structural worklist reuse and Mac frame headroom (#27); 60 Hz in the Mac
  128-cubed cut scene (#28); bounded M5 solver fallback budgets (#23).
- Ownership, shared validation and SDK tooling refinements (#30, #31);
  simplified test scaffolding and SDK artifact checks (#32); SDK guide,
  evidence archive and experimental module organization (#33).
- README rewritten around engine setup and measured performance (#9).

### Fixed

- Default water stays liquid at the reference temperature (#15).
- Frame-clock wording in the heat performance report (#12).

## 0.3.0 - 2026-09-08

Rules `ca-v3`. Reference release C7.

### Added

- The v3 engine SDK with coupled structural physics (cohesion, support,
  breakage, coherent fragments) and the reference lab (#7).
- The C1 to C7 checkpoint series: authoritative contracts, backend
  conformance, exact energy accounting, embedding and extension, trustworthy
  evolution and performance, richer interacting physics, and the engine
  reference release. See `ENGINE_ROADMAP.md`.
- MIT license and open-source preparation.

## 0.2.0 - 2026-05-18

### Added

- Conservative movement v2 (#2).
- Deterministic invariant fuzz coverage (#5, #6).
- Element Fighter prototype (#1, #4) and its engine snapshot combat bridge (#3).

## 0.1.0 - 2026-05-06

### Added

- Stabilized engine baseline and the engine invariant harness, following the
  April 2026 evolutionary kernel search recorded in `EVOLUTION_CHRONICLE.md`.
