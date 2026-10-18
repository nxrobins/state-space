# Tactical SDK, lighting caches and verification checkpoint

This checkpoint packages the accumulated work after PR23. The experimental SDK
now lets a game move existing matter with its history, evaluate interventions on
revision-bound branches, reconcile actors and inspect physical consequences.
It also retains the renderer cache work and the verification containment changes
developed after the workstation incidents.

**Bounded CPU acceptance is complete. Native runtime, GPU replay and full gameplay
benchmarks remain blocked. This is a review checkpoint, not release acceptance.**
Legacy demos remain quarantined. The existing 2D verification was not rerun for
this checkpoint; its protected sources and quarantine gate retain their hashes.

## Review map

| Area | Behavior | Start here |
| --- | --- | --- |
| Material interventions | Preserve energy, damage and internal bonds during translation; explicit cutting/joining, reservoirs, external heat accounting and saved temporary holds | `engine/experimental/interventions.ts`, `material-reservoirs.ts`, `material-transport.ts` |
| Tactical transactions | Revision-bound preview/commit, game-state/resource rollback, journals, bounded queries and change reports, worker cancellation and uncertain-mutation handling | `engine/experimental/tactical-session.ts`, `tactical-worker-host.ts`, `tactical-worker-client.ts` |
| Actors and motion | Deterministic fit/sweep/support/exposure queries, observed material paths, carry/displacement and aggregate peer-contact budgets | `engine/experimental/gameplay-geometry.ts`, `terrain-body.ts`, `actor-movement.ts`, `motion-paths.ts` |
| Reactive worlds | Separate versioned material registry and CPU reaction/thermal/structural evolution; constrained worlds, domains, transport, actor groups and worker observations | `engine/experimental/reactive-materials.ts`, `reactive-world.ts`, `reactive-session.ts`, `reactive-worker-host.ts` |
| SDK reference client | Public-package hot-slab scenario, targeting/preview UI, atomic ability costs and guarded worker/render ownership | [Tactical slab](../../examples/tactical-slab/README.md), [worker bootstrap](../../examples/tactical-worker/README.md) |
| Cavern presentation | Incremental emitter candidates, regional light lists and shared visibility hierarchy; reference mode remains the default with an explicit A/B toggle | [Lighting contract](CAVERN_LIGHTING_CACHE.md), [source review](CAVERN_LIGHTING_CACHE_REVIEW.md) |
| Verification containment | Persistent browser transport, independent watchdog, durable progress journal, bounded Windows Jobs and failure cleanup | [Harness review and receipts](VERIFICATION_HARNESS_REVIEW.md) |
| M5 GPU follow-up | Compact intact-cell structural work lists, bounded direct dispatch and diagnostic coverage, with interrupted replay/frame evidence retained | [M5 checkpoint](3D_M5.md), `engine/experimental/structural-world-gpu.ts`, `structural-shader.ts` |

[SDK documentation](../SDK.md) describes public exports and contracts.
[Tactical implementation history](TACTICAL_INTERVENTIONS.md) retains individual
build criteria and limitations. Later entries supersede earlier acceptance
status; the current CPU result is Build 53 below.

## Current evidence

[Build 53 summary](tactical-interventions/build-53-2026-10-17/summary.json)
records 1,695 passing selected CPU tests in 57 files, executed in 16 sequential
bounded test jobs. Full type checking, lint, SDK compilation and public-package
integration passed, for 20 accepted final stages. Final gates completed on
October 18, 2026 Pacific; the evidence directory retains its original date.
Failed historical attempts and quiet-window refusals remain in the record.

Each workload used a 6% CPU / 4 GiB Windows Job and independent watchdog.
Tests, types, lint and package integration had 30-second deadlines; SDK compilation
had 60 seconds. The fresh quiet-window gate required ten one-second samples at
or below 50% host CPU and at least 8 GiB available RAM. The live stop threshold
remained 85% host CPU sustained for two seconds. These are CPU containment
settings, not a guarantee against a driver or whole-host hang.

Packaging rechecked all 305 accepted source hashes, 96 protected hashes,
146 SDK artifacts, five reference-client artifacts and 136 final-stage evidence
files: no mismatches. SDK and client outputs remain generated under ignored
`dist/`; their retained hashes bind them to the recorded builds. Packaging did
not rerun tests, builds, browsers, replay or benchmarks.

Earlier bounded stages separately passed 17 non-GPU lighting tests, 52 harness
mock/temporary-file tests and four Windows containment cases. Their checkpoint
documents retain the exact revision and scope of those results.

## Qualification boundaries

- The persistent incident hold still has `blockRecovery: true`, without a
  recovery permit. Its SHA256 is
  `3444c8e505e3dd47bfacecfcc4411b8ca1196c818600044d375481f235610f5b`.
- Native Worker/browser execution, GPU cache behavior, M5 physical runtime,
  large-world replay and 32/64/128-cubed frame acceptance remain pending. Forty-eight
  older physical cases remain outside the approved CPU runs. Historical frame
  receipts do not qualify this source revision.
- Tiny CPU fixtures and mock ports exercise exact continuation, conservation,
  transactional rollback and slice independence. They do not establish native
  responsiveness or CPU/GPU equivalence for this accumulated patch.
- Endpoint reports include globally recomputed support effects, but do not
  identify transient fragment paths. Snapshot setup and copying still have
  volume-dependent costs. Incremental structural dependency reuse, external
  actor loads and a general force model remain further work.
- The cached lighting path is opt-in and disposable. Its visual and performance
  benefits remain unmeasured. The GPU structural work-list changes also require
  separately authorized bounded runtime validation before release acceptance.

## Evidence publication

Project source, regression cases, stage receipts, failed attempts and incident
logs are retained without rewriting their original bytes. GitHub marks nested
checkpoint evidence as generated so source changes remain easier to review.
The archived interrupted supervisor `report.tmp` is retained as incident
evidence; Python bytecode is excluded.

Two machine-wide CPU attribution captures remain local because they contain
unrelated application process inventories and command lines:

- `verification-harness/cpu-spikes-20261017T175127Z/`
- `tactical-interventions/build-53-2026-10-17/cpu-attribution-01/`

Existing receipts retain hashes/references to those local diagnostics; those
references are not downloadable project evidence. The captures identified
background contention that prevented CPU launches, but did not establish the
cause of the earlier freezes. All final project stage receipts are included.
No runtime hold was relaxed and no legacy demo was launched for publication.
