# Lighting-cache GPU smoke: proposal and safety review

Reviewed 2026-10-17. **Proposed, not implemented or run.** This is a reviewable
scope for a future authorization, not a recovery permit. GPU execution, replay
and benchmarks remain blocked; legacy demos remain quarantined.

The 17 non-GPU lighting tests, SDK build, full type check and structural lint
[passed in their separately authorized stages](CAVERN_LIGHTING_CACHE_REVIEW.md).
Those results do not validate WGSL, native pipelines or GPU execution.

## Smallest useful probe

Use one synthetic **8 x 4 x 4 grid (128 cells), two 4-cubed storage chunks**,
two visibility leaves, one parent and one light region. Three submissions are
enough to exercise cold setup, a temperature-only update and dirty invalidation.
This deliberately does not cover the full GPU fixture matrix in
[the cache checkpoint](CAVERN_LIGHTING_CACHE.md).

Call the production `makeLightingCache` with the production `cavernShaders`
common declarations. Compare its lights with the production full-scan `extract`
shader, writing to a separate light table. Do not duplicate cache orchestration
inside the test. Construct only these compute pipelines and a diagnostic copy
pipeline. Do not instantiate a world, physics, renderer, canvas, textures or an
animation loop. Importing shader generators must not instantiate the appearance
factory or decode its embedded rock textures; inspect the dedicated test bundle
before permitting it to load.

Use renderer storage order, not the public linear snapshot index. Start with
air, then set these material/thermal fields (other packed bits zero):

| Coordinate | Material | Thermal byte |
|---|---|---:|
| (1, 1, 1) | lava (10) | 200 |
| (2, 1, 1) | molten glass (17) | 170 |
| (4, 1, 1) | lava (10) | 210 |
| (5, 2, 1) | stone (1) | 80 |
| (6, 1, 1) | water (2) | 80 |

These are packed presentation fixtures, not physical snapshots or energy edits.
All three potential emitters have an air neighbor.

| Submission | Change / retained rebuild flags | Required result |
|---|---|---|
| 1: cold | New cache; flags `[0, 0]` | Initial forced rebuild selects lava at (1,1,1) and (4,1,1). Hierarchy `[3,3,3]`. Near and wide lists both `[0,1]`. |
| 2: thermal | Raise molten glass to 230; flags stay `[0, 0]` | Left source moves to (2,1,1), with two hot contributors. Right source unchanged. Hierarchy and region membership unchanged. |
| 3: dirty | Replace right lava and stone with air; flags `[0, 1]` | Right source becomes inactive; left light stays unchanged. Hierarchy `[3,2,3]` retains water's optical occupancy. Both lists become `[0]`. |

At each boundary require:

- All 64 bytes of the two cached lights equal the independent full-scan GPU
  table. Check expected positions/active bits against the fixture as well.
  Do not use JavaScript double-precision color calculations as an exact float
  oracle or silently loosen comparisons after a failure.
- All three hierarchy words equal the hand-derived masks above. Compare both
  region counts and every ID in their active prefixes, in canonical order.
  Unused region slots may retain old IDs and are not part of the active list.
- All 128 input grid words and both retained rebuild flags equal the uploaded
  values. These production cache bindings must remain read-only.
- No compilation, validation, uncaptured-device, device-loss, browser or transport
  errors. Any mismatch or missing evidence ends the attempt before the next case.

## Fixed workload and evidence budget

The production hierarchy and region buffers lack `COPY_SRC`. Use a tiny
diagnostic compute pass to copy their words, both light tables, grid and flags
into one probe-owned output buffer, then copy that into one reusable mapped
staging buffer. This avoids changing production buffer usage or bypassing the
production cache factory.

For the current layout, each readback is **295 words / 1,180 bytes**. The planned
buffer payload total is **4,100 bytes**: cache 1,092, input/two light tables 648,
diagnostic output plus staging 2,360. Enforce an 8 KiB cumulative allocation cap
for explicit probe buffers. This does **not** cap browser, compiler, driver or
GPU-internal allocations.

Seven compute pipelines: five cache, one reference and one diagnostic. Per
submission: seven cache workgroups, two reference workgroups and five diagnostic
workgroups, each with 64 invocations. Maximum **three command buffers/submissions,
42 workgroups total**, no rendering or physics ticks. Initialization/uploads are
also GPU queue work: allow only the forced-uniform upload plus grid/flags for
each case (seven `writeBuffer` calls, 1,576 payload bytes total). No timestamps,
screenshots, warmup, retries or automatic increase in size/case count.

Use one device and at most one outstanding submission/readback. Finish mapping,
comparison, unmapping and durable acknowledgement before uploading the next case.
The host controls case advancement; a page must not automatically run all cases.
Retain raw readbacks and expected/actual summaries, not just a success boolean.

Before browser launch, durably save exact sources/bundle/fixture hashes, browser
binary identity, launch arguments, limits and a unique run ID in a fresh output
directory. Record adapter identity after acquisition. Fsync a case-start record
before its uploads/submission and record completion and comparison before the
next case. Treat an unacknowledged tail as unknown. The existing journal's generic
`status`/`stage-end` sequence alone is insufficient: a probe-specific validator
must require exactly cases 1, 2, 3 and reconcile all three raw results. Do not
label these events as simulation ticks or replay proof.

## Safety review and prerequisites

**Verdict: suitable scope to implement and review; not yet cleared to run.**

1. **Execution host remains unresolved.** The saved incident analysis still
   recommends a separate physical GPU test host. A tiny compute workload reduces
   exposure, but adapter creation and shader compilation can themselves encounter
   a driver fault. The independent watchdog needs a responsive OS and cannot
   guarantee recovery from a driver/kernel/whole-host hang. Passing this probe
   would not explain or resolve the previous workstation freezes.
2. **Real browser cancellation is unproven.** Existing containment receipts cover
   print/sleep descendants, not Chromium. First prepare and separately authorize
   browser-only startup/close, stuck-CDP cancellation and supervisor-loss cases,
   one at a time, with a blank GPU-disabled browser and no WebGPU adapter request.
   Verify all owned descendants and the named Job are gone after each case. A
   failure stops the sequence. Passing those cases does not prove GPU cancellation.
3. **Launch configuration needs a narrow safe mode.** The current browser helper
   unconditionally adds `--enable-unsafe-webgpu` and uses a 1920 x 1080 viewport.
   For this smoke, omit that flag, retain native validation/watchdogs, use a tiny
   blank viewport, and stop if normal adapter acquisition is unavailable. Do not
   introduce a fallback adapter, relaxed driver settings or GPU-timeout changes.
   Use an owned fresh browser/profile and one probe page, never an existing user
   browser. Serve only the probe assets from a dedicated loopback server; do not
   navigate to a cavern app or the legacy demo server.
4. **Authorization must reach every boundary without reopening recovery.** The
   supervisor and both browser helpers currently reject `blockRecovery: true`.
   The earlier process-local CPU authorization alone cannot launch this probe.
   Before execution, design and review a single-use capability restricted to this
   exact probe, source hashes, browser arguments, deadline and owned Job. Consume
   it under the real lease; require it at every relevant leaf entry point. Mock
   tests must reject altered commands, stale/reused capabilities, arbitrary eval
   or navigation, and attempts to invoke replay/frames. A Job ID alone is not
   authorization. Never clear `blockRecovery`, grant generic browser execution,
   or bypass leaf checks to make the test start.
5. **Use bounded cancellation with explicit limits.** Proposed attempt bounds:
   30-second independent watchdog; browser ready within 15 seconds; adapter and
   pipeline setup within 8 seconds; each submission/map within 2 seconds; cleanup
   within 3 seconds. These are overlapping limits under the hard deadline, not
   additive entitlements. Exceeding one stops the attempt; do not raise it on a
   retry. Enforce phase deadlines in the host as well as page code, and permit at
   most 5 seconds without acknowledged progress after browser readiness. The
   existing CDP timeout is 10 seconds, so the tighter phase bounds need explicit
   plumbing and non-GPU tests. Preserve the existing GPU Job's 12% CPU / 8 GiB
   limits, exclusive lease, suspended-start containment, live health checks and
   independent watchdog. CPU limits do not bound GPU execution time.
6. **Keep resource gates and cleanup fail-closed.** Existing launch gates require
   host CPU at most 50%, at least 8 GiB free system memory, GPU use at most 15%,
   temperature below 65 C and at least 1 GiB free GPU memory. Preserve runtime
   health/staleness checks; missing telemetry is a stop. Bound journal/output
   queues, close the device/cache, and terminate only the owned Job on failure.
   Cleanup errors, remaining descendants, a stalled journal, device loss or any
   display/host instability make the receipt fail. Do not retry automatically or
   escalate into replay/benchmarks after a pass.

The new probe, scoped authorization, launch mode and tighter deadlines require
source review and separately authorized non-GPU checks before browser containment
or GPU execution. This document changes none of those mechanisms.

## Meaning of a future pass

A pass would establish native cache pipeline setup and the three small update
cases, including read-only input behavior. It would **not** establish surface/fog
shader correctness, visibility traversal, regional overflow, multi-region culling,
seam-neighbor dirty propagation, all chunk sizes, A/B images, restore, exact
physics/replay or performance. Those gates remain separately pending and blocked.

At this review, the hard hold remains `blockRecovery: true`, without a recovery
permit. Protected SHA-256 values:

- `dist/verification/safety-hold.json`:
  `3444c8e505e3dd47bfacecfcc4411b8ca1196c818600044d375481f235610f5b`
- `scripts/verify_checks.mjs` (legacy quarantine):
  `b3ef0acf0af83786865b70664f144adf2f2f65452a7764cadd97a966333bcfaf`

No build, browser, GPU query, GPU smoke, replay or benchmark was launched for
this proposal. Only source/evidence reads and documentation edits were performed.
