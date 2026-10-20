# Repository architecture

The engine is the product. Examples consume its public APIs; research tools and
historical evidence support development. This map describes ownership rather than
a new package structure.

| Location | Responsibility |
| --- | --- |
| `engine/` | Public Python and TypeScript 2D engine, catalogs, state, physics, renderers and build configuration |
| `engine/experimental/` | Separately versioned 3D, structural, tactical and reactive APIs; public entry modules stay at this boundary |
| `engine/experimental/reactive/` | Reactive catalogs, evolution, sessions, transport and worker internals, with their tests |
| `engine/experimental/tactical/` | Tactical session internals, previews, rendering and worker protocol, with their tests and held runtime cases |
| `engine/experimental/terrain/` | Terrain body/group motion and displacement, with their tests and held runtime cases |
| `engine/generated/`, `engine/kernels/`, `engine/_generated_schema.py` | Generated catalog/runtime definitions and kernels; follow `engine/generate.py` rather than editing generated copies |
| `engine/test-support/` | Test-only physics guards and transport fixtures |
| `examples/` | Public-SDK clients, including the lab, cavern series, tactical slab and reactive chamber; `shared/` owns shared client utilities |
| `scripts/` | Build/serve commands, bounded verification supervisors, package checks, benchmarks and historical audit/recovery tools |
| `tests/` | Python and Node integration/tooling regressions; engine TypeScript tests are colocated with their subjects |
| `web/` | Earlier browser showcase and its rendering/controller tests |
| `game/`, `tower-defense-rogue/` | Independent game prototypes and their SDK integration boundaries |
| `eval/`, `seeds/`, `locked/`, `archive/` | Mutation/evolution evaluation, seeds, frozen references and research history |
| Root `evolve_ss.py`, `ss_program.md`, `winner_phase_*.json`, evolution logs | Original research workflow and recorded results; not the SDK entry point |
| `docs/` | Current guides, contracts, support status and checkpoint summaries |
| `dist/` | Local generated output; the tracked `dist/packages/evidence/` files are historical package evidence |

The experimental root retains public entry modules, shared geometry/transport
kernels, and the 3D/M5 backends. The three largest cohesive families have their own
folders; this is an incremental split, not a new dependency or packaging layer.
The byte-bound `structural-material.ts` and motion baseline stay in place. Historical
checkpoint paths refer to their recorded source commits; they are not renamed.

## Runtime boundaries

`package.json` owns the JavaScript public export map. `engine/__init__.py` owns the
Python public entry. Experimental 3D families have distinct save/rule contracts;
reactive worlds do not convert into M5 worlds.

The CPU implementations provide bounded reference behavior. GPU backends own their
buffers, submissions and completion boundaries. Tactical sessions combine terrain
and game state into speculative branches and atomic publication. Reactive sessions
compose catalog-aware evolution, structure, geometry and game state. Worker
host/client modules add transport and lifecycle management around those APIs.

Examples depend on public SDK entries. The reactive chamber's worker owns CPU
physics; its main thread presents acknowledged scenes through WebGPU. Presentation
and camera changes do not advance simulation. Tests that need internal identities
use explicit source aliases; installed-package checks validate the consumer boundary.

## Tool and document ownership

- `scripts/build_sdk.mjs` derives bundles and declaration roots from package exports.
- `scripts/verify_checks.mjs` selects smoke, CPU, native or quarantined demo checks;
  `scripts/verification_guard.py` owns process containment and evidence receipts.
- `scripts/verify_macos_qualification.py` owns fixed native browser stages.
- `scripts/verify_packages.py` validates fresh installed Python/JavaScript clients.
- [SDK guides](SDK.md) own usage; [validation status](VALIDATION_STATUS.md) owns the
  current evidence summary; [checkpoints](checkpoints/README.md) preserve history.
- [The C1–C7 roadmap](../ENGINE_ROADMAP.md) records the original reference-release
  execution contract. Its baseline notes are historical, not a current defect list.

Keep internal reorganizations separate from behavioral changes. Preserve public
entries, exact shader/reference bytes, test selections and explicit native gates;
verify consumers and examples after moving an implementation module.
