# Mac 128³ frame performance — 2026-10-18

The fixed 128³ cut scene now passes the strict 60 Hz completion gate on the
Apple M3 Ultra host. Three consecutive runs on implementation `e2b4420` complete
all **1,800 measured frames** within 16.667 ms, with zero missed deadlines, zero
lost display slots, and zero energy drift. Complete decoded world/player
checkpoints match the original measurement byte-for-byte.

The workload is unchanged: an owned visible Chrome window at 1920 × 1080,
naturalistic reference lighting, heat distortion, 60 warmup frames, 600 measured
frames, and the bridge cut at tick 180. Completion includes input, exact physics,
actor, mesh, rendering, HUD, validation and GPU completion. Startup, final
checkpoint compression, and OS scanout remain outside this measure.

| 128³ run | p50 | p95 | p99 | Worst | Misses / 600 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original | 13.0 ms | 17.0 ms | 24.5 ms | 34.8 ms | 37 |
| Final 1 | 8.7 ms | 11.4 ms | 14.4 ms | 15.9 ms | 0 |
| Final 2 | 8.6 ms | 10.6 ms | 12.9 ms | 15.1 ms | 0 |
| Final 3 | 8.8 ms | 12.1 ms | 14.4 ms | 16.1 ms | 0 |

Completed physics rates are 59.986–59.992 Hz in the final runs. These are results
for this scene and host, not universal frame-rate guarantees or full 128³ replay
qualification. The earlier [optimization checkpoint](MACOS_OPTIMIZATION.md)
remains the historical baseline.

## Changes and exactness

The presentation path builds an ascending list of nonempty light slots after
every light extraction, including temperature-only updates. It omits only slots
that the original shader skipped, preserving accumulation order and volumetric
ties. Cached lighting retains its regional lists and uses this complete ordered
list for overflow and out-of-region fallbacks.

Surface shading conservatively rejects entire voxel cubes outside the camera's
four side planes. Inflated bounds preserve edge cases. Indexed face draws reuse
the two repeated corners of each pair of triangles: six indices reference four
unique vertices, keeping the original vertex indices, UVs, triangle order and
chunk addressing. Mesh contents and visible shading are unchanged.

The structural solver caches parent and child masks on its fixed support-distance
DAG. Integer remainder ordering remains canonical. Compact worklists exclude
fixed support roots and leaf loads; component initialization only visits the
original member list, which remains a superset after damage. List kernels use
256 threads per group. The two additional full-world scratch planes cost 16 MiB
at 128³.

A separate certificate permits movement to use support reachability directly
when damage and normalization preserve the graph. Bidirectional bonds connect
components; downward intact contacts connect those components; anchors, bottom
boundaries and nonintact obstacles seed support. Finite support distance is
therefore exactly the component-blocking fixed point. Any changed membership,
bond or anchor invokes the complete component/blocking solver. Positive integrity
changes alone do not change this graph. Material normalization does not overwrite
this movement certificate; the existing whole-world reuse certificate still
controls reuse on the next tick.

World creation now completes an empty edit dispatch and receipt map. This prepares
the edit pipeline and buffers before the first interaction without modifying the
committed bank, advancing a tick or changing energy. Initialization is awaited by
the factory and uses the existing bounded GPU completion path.

Physical laws, integer state, attempt budgets, full convergence fallback,
transaction rollback, and completion checks are unchanged.

## Diagnostics and smaller-world regressions

GPU timestamp profiles reduce mean draw time from **6.1756 to 0.7936 ms** across
600 measured ticks, and structural solve time from **4.0919 to 2.6375 ms** across
55 rebuild ticks. These profiles split compute pass boundaries and are diagnostic
only. The final profiled run has one deadline miss and is explicitly excluded
from the three unprofiled acceptance runs above. Its complete checkpoint is also
identical to the baseline.

| Final regression | p95 | Worst | Misses / 600 |
| --- | ---: | ---: | ---: |
| 32³ reference | 5.8 ms | 7.7 ms | 0 |
| 32³ cached | 5.9 ms | 9.2 ms | 0 |
| 64³ reference | 8.5 ms | 11.0 ms | 0 |
| 64³ cached | 8.9 ms | 11.8 ms | 0 |

Several experiments were rejected and reverted after measurement: per-iteration
indirect dispatch, predicted iteration budgets, distance-level load sweeps, and
separate stable indirect worklist arguments. Intermediate revisions sometimes
passed individual timing runs and failed a repeat. Their results remain in the
evidence index; none substitute for the three final-source acceptance runs.

## Verification

All five replay scenarios (intact control, cut, heat, ice control and ice heat)
pass in both dense and active execution at 32³ and 64³, including restart ranges:
**14,616 exact complete-state comparisons** with zero energy drift. The 32³
scenarios and 64³ cut run 1,024 ticks; the other 64³ scenarios run 256 ticks.
The final 32³/64³ gameplay world/player checkpoints also exactly match the prior
optimization checkpoint.

The hardware GPU probes cover empty/full worklists, phase-created structure,
root predicates, overload, edits and rollback, odd-tick restart, distant X/Y/Z
support, forced general fallback, and reversed invocation/list order. All 126
parent-sharing cases (two weights × 63 nonempty neighbor subsets) match the CPU's
64,512 integer loads. A separate probe disables the reachability shortcut and
checks the full component/blocking solver against the same tiny CPU corpus.
Initial world state, tick zero and energy are also checked after initialization.

All 18 rendered-image comparisons have zero changed channels: hot/cooled/moved
emitters, three camera views, and reference/cached lighting. The baseline restores
the original complete source enumeration, disables voxel culling, and supplies
six distinct original face indices. Captures read the real GPU render target
and reject blank images. A separate 512-slot worklist probe checks empty, sparse,
full, full-to-empty and source-order behavior.

[Hosted verification on `e2b4420`](https://github.com/nxrobins/state-space/actions/runs/39185561138)
passes: 1,804 Vitest and 18 controller tests, 46 Vitest and 13 Node smoke checks,
64 supervisor tests with four Windows-specific skips, two archive regressions,
build/types/lint, and fresh installed-wheel/npm clients including 13 independent
npm export consumers.

## Pre-merge adversarial review

The review of `3a381503..4ce13e84` found no blocking issues. It checked the
reachability certificate against the complete component/blocking rules, damage
and normalization invalidation, worklist capacity after edits and phase changes,
canonical parent remainder order, fallback/rollback, initialization, and both
rendering paths. The 512-chunk limit also bounds the light list and keeps every
shared face index within `uint16`.

Fresh `structural-exact` and `lighting` runs passed on the same runtime sources:
eight structural probes and all 18 byte-identical rendered-image comparisons.
The raw acceptance samples independently confirm ticks 61–660 in each of the
three runs, the ten-edit cut at tick 180, and a GPU completion boundary on every
frame. Both display-timestamp-to-completion and callback-to-completion durations
stay within 16.667 ms. Report hashes, supervisor receipts, source hashes and
complete checkpoint bytes were checked again. Existing CI on `4ce13e84` passed;
the follow-up change only records this review and publishes the evidence link.

These checks retain the fixed-scene and host limits stated above; they do not
establish full 128³ replay or cross-platform qualification.

## Evidence

The [compact index](MACOS_128.json) binds 91 measurement reports to their hashes,
source identities and supervisor receipts. It distinguishes final-source results
from earlier attempts, including failed and reverted experiments. The
[evidence release](https://github.com/nxrobins/state-space/releases/tag/macos-128-2026-10-18)
contains the raw reports, receipts, final source snapshot and built bundles,
implementation diff/history, and hosted verification artifacts/logs.

The archive has 1,629 files and 165,163,558 bytes. Its SHA-256 is
`04f68559c5fe94feb3673df6cc0a94f549d8e077456f048515706e3d215395c2`.
`validation/verify-archive.py` checks the archive and manifest hashes, unique safe
member paths, every member's size/hash, and each indexed report. Run it with the
index and archive paths as its two arguments. The published archive was downloaded and verified
with that checker. Intermediate attempts retain measurements; they do not all
include separately reconstructable builds.

## Reproduce the bounded measurement

```sh
npm run build:sdk
node node_modules/vite/bin/vite.js build --config engine/vite.structural-probe.config.ts
npm run verify:macos -- --stage structural-exact
npm run verify:macos -- --stage lighting
npm run verify:macos -- --stage replay-64-cut-long
npm run verify:macos -- --stage scale-128-visible
npm run verify:macos -- --stage gameplay-128-visible
```

Run the final command three times, inspecting each result. The 128³ outer receipt
records successful measurement; inspect `result.performancePassed` separately
for the strict frame gate. The optional `gameplay-128-profile-visible` stage is
for diagnostics only. Replay, pilot and timing prerequisites must have identical
source hashes and be less than 24 hours old.

The existing 300-second outer / 260-second inner bounds, independent watchdog,
8 GiB sampled RSS limit, incident holds and legacy-demo quarantine are unchanged.
Apple GPU temperature/utilization telemetry and OS/driver-hang recovery remain
unavailable. Full 128³ CPU/GPU replay and cross-platform qualification remain
separate work.
