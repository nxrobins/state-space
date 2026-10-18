# Incremental cavern lighting and visibility

Status: **17 non-GPU lighting tests, SDK build, type checks and lint passed;
GPU/replay/frame validation remains blocked**. Each authorized stage passed on
its first attempt on 2026-10-17. No browser, GPU probe, replay or benchmark was
run for this change. Static syntax/source checks are recorded separately below.
The SDK artifacts and declarations are rebuilt. The incident hold remains
hard-blocked without a recovery permit; legacy demos remain quarantined.

## Public behavior

Chunked terrain renderers now expose optional
`setLightingMode('reference' | 'cached')`. `reference` remains the default.
The structural cavern adds a separate **Lighting A / Lighting B** button beside
the existing naturalistic/diagnostic appearance control. The built client can
select B with `?lighting=cached` once browser execution is authorized. Switching lighting pauses and presents the
same tick through the existing exclusive-operation path. It does not step, edit
or restore the simulation. The mode persists through client reset/import and is
recorded in new benchmark reports. It is not part of the physical snapshot.
An older SDK without the optional setter can still use reference mode; the
client disables B and explains that an SDK update is required.

This first slice retains one selected emitter per storage chunk, the existing
temperature threshold, intensity calculation and canonical selection tie-break.
It does not add bounced lighting or multiple emitters per chunk. Those would be
separate visual changes after this foundation is verified.

## GPU work and invalidation

1. **Emitter candidates.** After the mesh consumes its existing dirty flags, the
   lighting cache reads the retained `rebuild` buffer. Changed chunks rebuild a
   list of exposed lava/molten-glass cells, including cold candidates. The existing
   material invalidation already includes neighbors across face seams. The cache
   never clears or writes simulation invalidation flags.
2. **Temperature refresh.** Mesh dirty flags do not cover temperature-only edits
   or heat exchange. Every cached presentation reduces the current temperatures
   of the exposed candidates. It does not rescan every voxel or repeat exposure
   searches for unchanged geometry. Candidate insertion order may vary on the
   GPU; integer count/max reductions and an index tie-break preserve selection.
3. **Regional source lists.** Eight-cell regions contain ascending source IDs
   whose influence spheres intersect the region AABB. Near lists use the existing
   22-cell radius. Fog lists use 70 cells, conservatively covering the entire
   48-cell viewing ray plus the 22-cell source influence. Lists rebuild when a
   source moves, appears or disappears; intensity-only changes use the updated
   shared light table. Each list stores up to 64 IDs. Overflow and receivers
   outside the world use the complete source table, never a truncated list.
4. **Visibility hierarchy.** Four-cell leaves summarize two material masks:
   opaque shadow blockers, and all non-air/non-steam optical interfaces. Dirty
   leaves rebuild from current material state, then parents reduce to the root.
   Leaf invalidation covers every overlapping storage chunk, including one- and
   two-cell chunks. Partial nodes of rectangular worlds cannot skip the closed
   world boundary. Water, ice and glass are never mistaken for empty optical
   space. Steam density integration retains its existing sampling.
5. **Shared consumers.** Rock shadows, water/ice traversal and volumetric shadows
   use the hierarchy. Rock/reflection shading and fog selection use the regional
   lists. The cached shadow traversal is a bounded grid-boundary walk; it differs
   from the reference surface shader's evenly spaced visibility samples. Optical
   traversal retains the 40-cell distance/four-interface bounds while skipping
   empty blocks, so its 64-iteration limit can reach farther than the reference
   cell-by-cell walk. Pixel equality between A and B is not promised.

There is no cached shadow answer or temporal color history. Every shadow query
uses the current hierarchy, so an occluder change can affect distant receivers
in the same render without an incomplete lighting influence invalidation scheme.
Switching from reference or diagnostic back to cached lighting forces a full
cache rebuild. Snapshot restores already invalidate the whole terrain; skipped
renders retain the physics-owned material dirty flags until the next render.
Camera movement alone does not invalidate world-space cache contents.

Reference mode uses independent shaders without cache storage bindings. Cache
pipelines and allocations are created lazily when B is selected, and published
only after setup succeeds. A failed B setup leaves A usable. Cached and reference
draw/fog bind groups are distinct, and closing during setup disposes a late cache.
The force-rebuild uniforms are immutable and selected per encoded pass, so
multiple recorded command buffers cannot overwrite an earlier force decision.
Synchronous encoding failures retain full invalidation for retry.

All cache compute stages are encoded before drawing, inside the caller's existing
command encoder and completion boundary. There is no per-frame cache readback,
extra submission or asynchronous update backlog. Cache buffers are disposable
renderer resources. The grid and mesh rebuild buffer are bound read-only. The
cache neither binds nor writes conserved energy, structure, controller state,
physical work lists or replay metadata. Physical algorithms, rules identities,
snapshot schemas and integer arithmetic are unchanged by this feature.

At 128 cubed the candidate allocation is 8 MiB, region lists about 2.03 MiB and
hierarchy about 0.14 MiB, plus small counters/uniforms. Every update has a finite
dispatch size; regional overflow has a bounded full-list fallback. Cached shadow
walks cap at 512 crossings and fail opaque on exhaustion. These bounds are not
latency or GPU-safety evidence. A frequently changing world can spend more time
maintaining caches than it saves; performance remains unmeasured.

## Verification status and required evidence

`lighting-cache.test.ts` adds CPU/mocked-device cases for rectangular/tiny layouts,
allocation bounds, conservative region/ray coverage, invalidation, resource
ownership, queued force decisions and failure cleanup. `cavern-appearance.test.ts`
adds mocked A/B setup, separate bindings, failure/retry and close-during-setup
cases. `structural-client.test.ts` adds A/B no-step, restore, rejected-toggle and
older-SDK cases. **All 17 selected tests passed under the safe harness.**

The initial review used source parsing and source-boundary inspection only;
its [static receipt](cavern-lighting-cache/static-review.json) retains that status.
The subsequent explicitly authorized non-GPU stage has separate
[test evidence](cavern-lighting-cache/non-gpu-tests-2026-10-17/summary.json).
The subsequent SDK build, type checks and expanded structural lint also passed
sequentially under the safe harness; see
[CPU check receipts](cavern-lighting-cache/cpu-checks-2026-10-17/summary.json).
No previously retained M5 receipt is promoted to evidence for this revision.
See [review findings and non-GPU readiness](CAVERN_LIGHTING_CACHE_REVIEW.md).

Before runtime acceptance, separately review and authorize these stages:

1. Small non-GPU tests, SDK build, full type checks and structural lint: passed.
   No aggregate/legacy run is authorized.
2. A bounded tiny GPU cache fixture: compare selected lights exactly against full
   extraction after temperature-only changes, material/phase changes, both sides
   of seams, source movement/removal, repeated paused presentation and restore.
   Compare every hierarchy node against an independent CPU reduction. Exercise
   partial leaves, all supported chunk sizes, and region overflow without drops.
3. Bounded ray fixtures: single-voxel walls, diagonal/corner rays, opaque boundary,
   water/ice/glass interfaces, outside-world cameras and fog sources near the
   48+22-cell limit. Inspect A/B shadows, reflections and fog for leaks, misses and
   source selection changes. Shader compilation/uniformity and bind layouts still
   require real WebGPU validation; TypeScript parsing cannot establish them.
4. Complete state comparisons for identical commands across A/B, camera movement,
   paused toggles and snapshot continuation. Match material, energy, structure,
   actor state and tick, with zero accounted energy drift.
5. Source-bound A/B full-frame measurements at 32/64/128 cubed, same scenes, camera,
   viewport and command tape. Include cache maintenance, rendering and GPU
   completion. Record cold rebuilds, temperature changes, collapse and steady
   state separately as well as the full distribution. Preserve the previous
   frame/replay acceptance gates and report regressions honestly.

This feature does not resolve the independent structural-solver deadline issue.
Runtime authorization, GPU safety and outstanding M5 acceptance remain separate.
