# Mac structural worklist optimization — 2026-10-18

The active structural backend now retains its compact tile list between material
passes until awake membership changes. Every zero-to-one wake sets an atomic
change flag; the next collector rebuilds before dispatch. Awake membership grows
within a tick, and the mask, count and flag are cleared together at the next tick.
An empty tick still writes a zero dispatch count. This changes scheduling cost,
with no change to the 27 material passes, physical rules, structural convergence,
integer state, rendering quality or transaction checks.

Optional structural GPU timestamps exposed the repeated serial collection of up
to 512 chunks as the dominant material cost. On the M3 Ultra the collector's mean
fell from 4.8228 ms to 0.8296 ms across 600 measured frames (about 83%). Timestamp
mode splits material pass boundaries and is diagnostic only. Its complete final
world and player state match the pre-optimization run byte-for-byte after decoding.

Normal full-client measurements disable profiling. All use an owned visible Chrome
window at 1920 × 1080, naturalistic appearance, heat distortion, 60 warmup frames
and 600 measured frames, including the bridge cut at tick 180. Completion includes
input, exact physics, resident actor, mesh, rendering, HUD and GPU completion;
startup, checkpoint compression and OS scanout are excluded.

| 64³ / lighting | Completion p95 | Worst | Misses / 600 | Strict 60 Hz |
| --- | ---: | ---: | ---: | --- |
| Before / reference | 14.5 ms | 18.2 ms | 4 | Fail |
| After / reference | 10.8 ms | 15.4 ms | 0 | Pass |
| Before / cached | 14.7 ms | 17.7 ms | 1 | Fail |
| After / cached | 11.0 ms | 13.6 ms | 0 | Pass |

Final-runtime repeats also pass: reference p95 **10.1 ms**, p99 **11.0 ms**, worst
**13.5 ms**; cached p95 **9.9 ms**, p99 **10.5 ms**, worst **12.9 ms**. Across all
four accepted 64³ runs, all **2,400 measured frames** meet the deadline, with zero
lost display slots and zero energy drift. Complete final world/player checkpoints
match the pre-optimization baseline. The renewed 32³ reference/cached runs also
pass: p95 **6.9 / 7.2 ms**, worst **9.3 / 9.7 ms**, zero misses.
These are measurements of the fixed cut scene on this host, not universal frame
rate guarantees or a complete cross-platform release qualification.

The bounded Mac runner also exposes `structural-exact`: dense/active tiny CPU
parity, empty/full lists, phase-created ice, edits, root predicates, restart and
rollback; distant X/Y/Z support; forced general-solver fallback; and reversed
invocation/worklist order. Build its internal bundle first:

```sh
node node_modules/vite/bin/vite.js build --config engine/vite.structural-probe.config.ts
npm run verify:macos -- --stage structural-exact
npm run verify:macos -- --stage gameplay-64-profile-visible
```

128³ progression is explicit and source-bound. `replay-64-cut-long` runs 1,024
ticks against the CPU in dense and active modes. `scale-128-visible` requires that
passing replay and supervisor receipt, unchanged source hashes and an age below
24 hours. It runs the existing eight-frame responsiveness/energy probe.
`gameplay-128-visible` requires the corresponding source-identical pilot. Each
stage retains the existing 300-second outer / 260-second inner deadline,
independent watchdog and 8 GiB sampled RSS bound. General 128³ replay commands
remain unavailable; the fixed pilot and full-frame measurement have separate caps.

```sh
npm run verify:macos -- --stage replay-64-cut-long
npm run verify:macos -- --stage scale-128-visible
npm run verify:macos -- --stage gameplay-128-visible
```

Existing incident holds and legacy-demo quarantine are unchanged. The watchdog is a
userspace control, not recovery from an OS or GPU-driver hang.

## First current-source Mac 128³ measurement

The source-bound eight-frame pilot passed at 10.8–19.5 ms per frame with zero
energy drift. The subsequent 600-frame reference-lighting measurement completed:
completion p50 **13.0 ms**, p95 **17.0 ms**, p99 **24.5 ms**, worst **34.8 ms**;
**37 deadline misses**, two lost display slots and 59.777 average completed ticks/s.
Energy drift is zero. This is a completed measurement and a **failed 60 Hz gate**;
it is not full 128³ replay qualification or a before/after Mac speedup claim.

Of the 37 misses, 25 occur among the 55 structural rebuild frames after the cut;
12 occur among 545 frames reusing the support plan. The rebuild frames have two
completion boundaries, with the first GPU wait averaging about 5.1 ms. The next
performance investigation should separate global solve cost from synchronization
and rendering during falling debris, while preserving exact convergence. The
remaining steady-state misses also need attention. These correlations do not
establish a single cause, and the current change does not merge submissions or
reduce the solve budget.

## Verification and evidence

All five scenarios (stone control, cut, heat, ice control and ice heat) match the
CPU at every committed state in dense and active GPU execution: 32³ for 1,024
ticks per case; 64³ for 256 ticks per case, with the cut case extended to 1,024.
Including odd-tick and edit-boundary restart ranges, that is **14,616 exact
complete-state comparisons** on the final runtime, all with zero drift. The
small exactness/fallback/order probes and profiled presentation/step/edit tick
labels also pass.

[Hosted verification](https://github.com/nxrobins/state-space/actions/runs/39164454211)
passes on implementation commit `07060c8`: 1,794 Vitest and 18 controller tests,
59 CPU smoke checks, 64 supervisor tests with four Windows-specific skips, two
archive regressions, build/types/lint and independent installed-package checks.

A 32³ reference timing attempt completed with zero frame misses but its owned
browser exceeded the shutdown deadline. Its outer receipt correctly fails.
The supervisor left no processes in the owned group; the failed attempt is
retained, and the measurement was rerun under unchanged bounds.

The [compact index](MACOS_OPTIMIZATION.json) records every measured outcome and
source match, including exploratory profiles and intermediate runtime revisions.
Its SHA-256-bound [evidence archive](https://github.com/nxrobins/state-space/releases/tag/macos-optimization-2026-10-18)
contains full reports, supervisor receipts, screenshots, source files, built
bundles and a per-file manifest. The original qualification index remains the
immutable pre-optimization baseline.
