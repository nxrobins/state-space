# Run and verify State Space on macOS

For the latest scope, see the [current support matrix](VALIDATION_STATUS.md).
The results below retain dated baseline measurements followed by their updates:
the [128³ fixed-scene follow-up](#128³-performance-follow-up) supersedes the older
frame timings, and the [8³ chamber and 16³ sandbox](checkpoints/REACTIVE_SANDBOX.md) have
their own native acceptance stages. Neither establishes a whole-product release.

The engine lab runs locally on the JavaScript CPU backend and on browser WebGPU.
The first macOS validation used Apple Silicon, macOS 26.6.2, Python 3.10.20 and
an Apple `metal-3` WebGPU adapter. This is a bounded development baseline;
native Python Metal and small 3D CPU/WebGPU comparisons now pass as described
below. Large-world and frame-rate qualification remain separate.

## Install and open the lab

Install Node.js/npm and uv, then run these commands from the repository root:

```sh
uv sync --locked
npm ci
npm run build:sdk
npm run lab
```

Open the URL printed by the launcher, normally
`http://127.0.0.1:8765/examples/lab/`. The lab starts paused on CPU. Use
**Step 1 tick**, **Inspect passes**, **Save in memory** and **Restore saved** to
inspect execution and continuation. Choose **WebGPU** to use a compatible
browser GPU adapter. Localhost provides the required secure context.

If the port is occupied, use `npm run lab -- --port 0` to let macOS select a
free port, or choose one explicitly with `--port 8766`. The server binds only
to `127.0.0.1`. Stop it with Ctrl+C. Rebuild the SDK and reload the page after
engine changes; this static server does not provide hot reloading.

## Bounded CPU checks

```sh
npm run test:smoke
```

This builds the SDK, then runs one supervised CPU process tree with a 30-second
workload deadline. Vitest uses one worker and explicit small fixtures: portable
2D contracts, input validation, pressure controls, tiny 3D material behavior and
tiny 3D structures. The Node tests then check all five lab scenes, exact
save/replay, controller behavior and verification transport. The initial macOS
run passed 39 Vitest tests and 12 Node tests. The current suite adds the
structural probe fixture regression, for 52 tests at that checkpoint; the current suite adds seven lighting-cache tests. This command excludes native GPU
fixtures and the quarantined legacy demo trajectories.

For a focused CPU/mock suite, use a file filter with the shared bounded config
(replacing the old per-feature `vitest.reactive-*.config.ts` and interventions configs):

```sh
uv run python -m scripts.verification_guard --kind cpu --timeout 30 -- \
  node node_modules/vitest/vitest.mjs run --reporter=dot engine/experimental/reactive/reactive-session.test.ts \
  --config engine/vitest.bounded.config.ts
```

This retains one worker, a two-second test limit, and stopping after the first
failure. Native fixtures and `.runtime-cases.ts` remain separate explicit gates.

Run the host-monitor and supervisor regressions separately:

```sh
uv run python -B -m scripts.verification_guard --kind cpu --timeout 30 -- \
  .venv/bin/python -B -m unittest discover -s tests -p 'test_verification*.py' -v
```

The initial macOS run passed 52 Python tests, with four Windows-only containment
tests skipped. The current harness adds six Metal policy/hold/evidence regressions,
for 58 passing tests and the same four skipped cases. The POSIX tests launch only tiny owned print/sleep processes and
check success, timeout, interpreter propagation and cleanup after the process
group leader exits.

The supervisor selects `.venv/bin/python` on macOS and `.venv/Scripts/python.exe`
on Windows, and propagates the selected interpreter to Python test subprocesses.
`STATE_SPACE_PYTHON` remains an explicit override. Every Node-side check that
spawns Python (the Vitest contract, conformance, structure and SDK fixtures and
`scripts/verification_guard.mjs`) shares one resolver,
`engine/test-support/python-interpreter.mjs`: `PYTHON`, then `STATE_SPACE_PYTHON`,
then the checkout's own `.venv/bin/python` (`.venv/Scripts/python.exe` on
Windows), then the first of `python3` or `python` that runs. After
`uv sync --locked`, `npm test` therefore runs without any PATH or environment
change, even where the system `python` lacks numpy. macOS host CPU and available
memory are sampled through the development dependency psutil. Missing telemetry,
invalid measurements, less than 8 GiB available RAM, or a busy host refuse the
run using the existing thresholds.

POSIX containment uses a new process group, live host monitoring, a supervisor
deadline and group cleanup. It does **not** enforce Windows Job CPU/memory caps
or provide the Windows watchdog. A separate POSIX watchdog is now described below. Receipts leave those unenforced
caps null. Keep local checks small; a timeout cannot recover a whole-host or GPU
driver hang. Incident holds and the legacy demo opt-in continue to apply.

## Small browser CPU/WebGPU check

With the server running, open `/examples/sdk/browser.html` on that same origin
and click **Verify CPU / GPU**. The existing public-SDK verifier uses an 8 by 7
cell test with custom materials. It compares 69 inspected pass reports, complete
CPU/GPU state, exact snapshot continuation, atomic invalid-restore rejection and
rejection of concurrent GPU access.

The initial Apple Metal run reported:

```text
Verified 69 CPU/GPU pass deltas, exact restart, and atomic state access. Energy drift: 0 Q.
```

Browser stepping and save/restore were also exercised in the lab, with no browser
console warnings or errors. These checks validate the small 2D browser API;
they do not establish native Python GPU parity, 3D GPU parity or frame-rate claims.
The full `gpu` and `frames` supervisor profiles still require NVIDIA telemetry.
Use the separate fixed Metal probes below for bounded native development checks.

Local command logs, supervisor receipts and the browser result belong under
ignored `dist/verification/`. Build and type-check with `npm run build:sdk` before
`npm run typecheck`, because the example clients use generated package declarations.

## Native Python Metal validation

Run these stages separately, stopping to inspect any failure:

```sh
npm run verify:macos:native -- --stage adapter
npm run verify:macos:native -- --stage sdk
npm run verify:macos:native -- --stage conformance
```

The adapter stage creates a native Metal device and roundtrips a 16-byte buffer.
The SDK stage runs the existing 8 by 7 cell custom-material client and compares
its complete snapshots, 69 pass reports and exact continuation to the JavaScript
CPU client. The conformance stage runs the existing six conformance tests:
35 scenes, 4,416 complete-state pass comparisons and 53 pipeline variants.
The native adapter on the validated machine reports Apple M3 Ultra / Metal.

The new `metal-smoke` supervisor profile accepts only this fixed module and the
three named stages on macOS. Adapter/SDK runs have 30-second deadlines; the
conformance run has a 60-second deadline and a 50-second inner reference timeout.
The corpus is checked before simulation: no more than 40 cases, 24 by 24 cells,
16 ticks per case or 256 ticks total. The current corpus has 35 cases and 192
ticks total. Host health checks, process-group cleanup and incident holds apply.
Reports explicitly record that Apple GPU temperature/utilization telemetry is
unavailable. This profile does not qualify sustained load or thermal behavior.
Failed and timed-out reference processes retain their partial stdout/stderr logs.

## Bounded 3D WebGPU validation

Open `/examples/sdk/3d-smoke.html` on the same local server. Run one button at a
time. A failure disables further probes until it has been inspected and the
page reloaded. Each probe has a 30-second cooperative deadline; this is not
independent browser/driver cancellation.

- **Verify material passes:** the existing tiny M2 pass corpus, exposed separately
  from its long verifier. Five shapes, five absolute ticks (including values above
  32 bits), and 27 passes produce 675 exact packed-cell and energy comparisons.
  Inspection must preserve the committed snapshot. The largest grid is 105 cells.
- **Verify material continuation:** five ticks on a 3 by 5 by 7 world, a positive
  sand-movement control, odd-tick restart, zero drift and atomic invalid restore.
- **Verify structural dense / active:** each mode runs six ticks on an 8-cubed
  world with 4-cubed storage chunks. A four-cell bonded stone plate crosses chunk
  seams and falls five cells onto a floor. Every completed packed/energy/structure
  snapshot must match the CPU, then restart from tick three and invalid-restore
  rollback must match exactly. Both modes require zero energy drift.

The structural fixture uses the materials supported by the M5 contract; metal
is not a supported M5 material. Its expected fall and exact restart are also
checked by the CPU smoke suite before GPU validation. The initial rejected
metal fixture is retained as failed probe-authoring evidence, not an engine
failure. All four corrected probes passed on the hardware Apple WebGPU adapter.
These are compute/conservation/replay checks; 32/64/128-cubed long replays,
rendering and frame results are reported separately below.

## Larger worlds, installed clients and complete Mac frames

The stabilization pass now includes an independent POSIX watchdog, a fresh
installed-wheel/npm check, and fixed owned-browser stages. A stage owns a fresh
Chrome profile and process tree; it never attaches to the user's existing browser.
Each stage has a 300-second outer deadline, a 260-second inner deadline, host
health checks and an 8 GiB sampled RSS budget. The watchdog also stops the group
if its supervisor stops sending heartbeats. Sampling is not a kernel memory cap;
GPU thermal telemetry and OS/driver-hang recovery remain unavailable.

Run each stage separately and inspect failures before continuing:

```sh
npm run verify:packages
uv run python -m scripts.verify_packages --native
npm run verify:macos -- --stage client
node node_modules/vite/bin/vite.js build --config engine/vite.structural-probe.config.ts
npm run verify:macos -- --stage lighting
npm run verify:macos -- --stage replay-32-cut
npm run verify:macos -- --stage replay-64-cut
npm run verify:macos -- --stage gameplay-visible
npm run verify:macos -- --stage gameplay-cached-visible
npm run verify:macos -- --stage gameplay-64-visible
npm run verify:macos -- --stage gameplay-64-cached-visible
```

The internal probe bundle is required by `lighting` and `structural-exact`; rebuild
it after engine changes. The lighting stage compares actual GPU output against
the original source enumeration and face vertex sequence.

Replay stages also accept `control`, `heat`, `ice-control` and `ice-heat` in place
of `cut`. All five scenarios passed at 32³ for 1,024 ticks and at 64³ for 256 ticks.
For each case, dense and active GPU modes match the CPU's complete committed-state
hash at every tick. Dense storage uses 16-cubed chunks and active storage uses
8-cubed chunks. Odd-tick restart, restart across the support edit, invalid-restore
rollback, stable intact controls and positive cut/thermal/melt failure all pass.
The ten cases provide **13,080 exact complete-state comparisons**, including
restart ranges, with zero energy drift. Canonical hashes deliberately ignore
storage partition while retaining all physical state and version/catalog metadata.

The actual playable application was measured in an owned, visible Chrome window,
at 1920 × 1080, with naturalistic appearance and heat distortion. Each row has 60
warmup and 600 measured frames, including the scripted support cut at tick 180.
Timing includes scripted input/edits, simulation, resident actor/collision,
transfers, mesh invalidation, rendering, the application HUD, validation and GPU
completion. Initial setup, snapshot compression and OS scanout are excluded.

The following is the pre-optimization baseline. See the
[worklist optimization checkpoint](checkpoints/MACOS_OPTIMIZATION.md) for the
subsequent exact scheduling change and new measurements.

| World / lighting | Completion p95 | Completion p99 | Worst | Deadline misses | Strict 60 Hz |
| --- | ---: | ---: | ---: | ---: | --- |
| 32³ reference | 7.4 ms | 9.7 ms | 11.8 ms | 0 / 600 | Pass |
| 32³ cached | 7.9 ms | 9.3 ms | 10.5 ms | 0 / 600 | Pass |
| 64³ reference | 14.5 ms | 15.8 ms | 18.2 ms | 4 / 600 | Fail |
| 64³ cached | 14.7 ms | 15.5 ms | 17.7 ms | 1 / 600 | Fail |

All four runs complete with zero drift, no lost display slots, and approximately
60 Hz average cadence. The 64³ deadline misses still fail the strict gate. Slow
samples coincide with structural plan rebuilds and an additional GPU completion
boundary; this is a profiling lead, not a proven single cause. Keep 32³ as the
measured client baseline. Cached lighting is experimental and is not consistently
faster here. No 128³ run or full fresh release qualification is claimed.

Validation fixed a real cached-lighting compilation failure (`meta` was a reserved
WGSL identifier) and missing WebGPU declarations for external npm consumers.
The cache is exercised on the real GPU with state-isolation checks. Every exported
npm entry now also compiles in an independent TypeScript client, rather than
sharing global declarations with other entry points.

The current CPU smoke suite passes 46 Vitest and 13 Node tests. The general CPU
suite passes 1,793 Vitest and 18 controller tests. Supervisor checks pass 63 tests,
with four Windows-specific cases skipped; two archive-restoration tests pass
separately. Current native Metal conformance passes 35 scenes, 4,416 pass
comparisons and 53 pipeline variants under the updated test runner.

See [current validation status](VALIDATION_STATUS.md) and the compact
[qualification index](checkpoints/MACOS_QUALIFICATION.json) for source-bound raw
reports, receipts, retained failures and screenshots. These scoped results do not
clear an incident hold or relax the legacy-demo quarantine.

## Structural optimization follow-up

The active backend now reuses its material worklist until awake membership changes.
This removes redundant scans between the 27 ordered material passes. Optional GPU
timestamps expose the solver, collector, material families and rendering costs;
normal gameplay measurements keep profiling disabled. The
[optimization checkpoint](checkpoints/MACOS_OPTIMIZATION.md) records the first
64³ results, exactness coverage and source-bound 128³ progression commands.

## 128³ performance follow-up

The [128³ performance checkpoint](checkpoints/MACOS_128.md) closes the fixed-scene
60 Hz gap on the M3 Ultra host at 1920 × 1080: three consecutive runs complete
1,800 measured frames with zero missed deadlines or lost display slots. Worst
completion improves from 34.8 to 16.1 ms, and p95 from 17.0 to 10.6–12.1 ms.
Complete world/player checkpoints match the baseline; all 18 rendered-image
comparisons are byte-identical. The final 32³/64³ timing and replay regressions
also pass. The [evidence index](checkpoints/MACOS_128.json) binds the final-source
results, retained experiments and published, verified archive. This is a scoped Mac
measurement; full 128³ replay and cross-platform qualification remain separate.

## Reactive sandbox

Build the SDK and chamber bundles, then run the fixed stages separately:

```sh
npm run build:sdk
npm run build:reactive-chamber
npm run verify:macos -- --stage chamber-visible
npm run verify:macos -- --stage sandbox-collapse-visible
npm run verify:macos -- --stage sandbox-flow-visible
npm run verify:macos -- --stage sandbox-chain-visible
npm run verify:macos -- --stage sandbox-conduction-visible
npm run verify:macos -- --stage sandbox-insulation-visible
npm run verify:macos -- --stage sandbox-wax-visible
```

Each 16³ stage requires the completed, source-identical 8³ receipt from the last
24 hours. It runs one fixed scenario, real Worker previews, active cancellation,
DOM comparison/commit controls, save/replay, cross-size scene replacement and
native color/depth checks. The stage retains the 300-second watchdog deadline,
128-tick recording limit and 8 GiB sampled process-tree RSS budget, with at most
512 completed camera frames. The 8³ stage retains its 256-frame limit.
See [run instructions](../examples/reactive-chamber/README.md) and the
[measurements and scope](checkpoints/REACTIVE_SANDBOX.md).

## ca-3d-m6 reactive structural worlds

Build the SDK and the internal structural probe bundle, then run the fixed
stages separately, keeping the host otherwise idle:

```sh
npm run build:sdk
node node_modules/vite/bin/vite.js build --config engine/vite.structural-probe.config.ts
npm run verify:macos -- --stage m6-tiny-dense
npm run verify:macos -- --stage m6-tiny-active
npm run verify:macos -- --stage m6-gameplay-32-burning-bridge
npm run verify:macos -- --stage m6-replay-32-burning-bridge
npm run verify:macos -- --stage m6-gameplay-32-thermal-valve
npm run verify:macos -- --stage m6-replay-32-thermal-valve
```

The two `m6-tiny-*` stages run the `ca-3d-m6` parity probes from the probe
bundle: every reactive fixture at 8³ and 16³, at most 64 ticks, no frames, the
GPU snapshot equal to the CPU oracle after every tick with zero accounted energy
drift, and a hardware adapter required. The chamber stages open the structural
cavern's reactive scenes with the thermal catalog: `m6-gameplay-32-<scene>` is
the 32-frame active pilot with the action at tick 16, and `m6-replay-32-<scene>`
builds the CPU oracle in the page, asserts the scene's pinned tick windows on
it, and replays dense and active GPU worlds over 1,024 ticks plus the restarts
3..11 and 15..21. `thermal-valve-ceramic` is accepted in place of either scene
name. The 64³ variants (`m6-gameplay-64-*`, `m6-replay-64-*`, 256-tick replays)
each require the same chamber's passing 32³ receipt from identical sources
within the last 24 hours; nothing above 64³ exists for `ca-3d-m6`.

All of these run under the `macos-qualification` supervisor profile: a 300-second
outer deadline, the 40-second stall deadline, host CPU and memory preflight and
monitoring, the independent POSIX watchdog, process-group cleanup and an 8 GiB
sampled RSS budget. The profile records that GPU telemetry is unavailable and
does not use `nvidia-smi`. The stall deadline is why the tiny-probe page mirrors
each fixture's progress into its journaled report, and the host monitor is why
the host must stay idle: a concurrent process that pushes whole-host CPU above
85 percent for two seconds stops the stage, which happened once here before the
retained rerun. Hashed sources (`engine/`, `examples/sdk/`,
`examples/structural-cavern/`, `scripts/verification*`, the SDK and probe
bundles) must not change while a stage runs. Receipts and the source-bound index
are retained under [volume-m6/mac](checkpoints/volume-m6/mac/) and summarized in
the [M6 checkpoint](checkpoints/3D_M6.md). These scoped results do not clear an
incident hold or relax the legacy-demo quarantine.

## Multiphysics native Worker

The private multiphysics runtime has one headless stage per timed scene. Build the
probe bundle, then run the stages one at a time with the host otherwise idle:

```sh
npm run build:multiphysics-probe
npm run verify:macos -- --stage multiphysics-worker-wax-valve
npm run verify:macos -- --stage multiphysics-worker-rotating-contact
npm run verify:macos -- --stage multiphysics-worker-fluid-switch
npm run verify:macos -- --stage multiphysics-worker-falling-battery
npm run verify:macos -- --stage multiphysics-worker-combined-failure
npm run verify:macos -- --stage multiphysics-worker-timed-cup
```

Each stage starts the module Worker from `dist/multiphysics/` and computes a
direct reference in the page. It requires exact equality across work budgets 1
and 256 and across 24 committed two-tick previews, each after cancelling a
part-run preview and retrying. It also requires an exact restart of a fresh
Worker from the saved snapshot. Latency is measured from the page: two-tick
preview p95 at most 250 ms and cancellation p95 at most 100 ms. Failing either
target fails the stage and keeps the measured distributions in the report.
There is no UI, so the 16.667 ms frame target belongs to the later Builder
stages. The stages have no prerequisite. The bundle is hashed with the other
sources and must not change during a run.

The visible builder stages follow, each after its scene's Worker stage:

```sh
npm run build:multiphysics-builder
npm run verify:macos -- --stage multiphysics-builder-wax-valve-visible
```

Replace `wax-valve` with any of the six scene names above. Each stage opens
`dist/multiphysics-builder/` in visible Chrome and drives the real controls. It
runs 24 rounds of preview, cancel, preview and commit while the camera orbits
every display frame. Then it applies a heat edit and checks its receipt, the
seven-row compare ledger, an atomic rejection, and save, restart and continue in
a fresh Worker. It also checks that an invalid save is rejected and leaves the
world in place. Gates: preview p95 at most 250 ms, cancellation p95 at most
100 ms, every completed frame at most 16.667 ms over at least 180 frames, and no
display-frame gap of 100 ms or more. A stage refuses to start without a passing
Worker receipt for the same scene from identical sources within 24 hours.

To use the builder interactively, serve the repository root and open
`dist/multiphysics-builder/?scene=wax-valve`:

```sh
npm run build:sdk
npm run build:multiphysics-builder
uv run python -m http.server 8000 --bind 127.0.0.1
```
