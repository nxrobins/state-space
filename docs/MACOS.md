# Run and verify State Space on macOS

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
structural probe fixture regression, for 52 tests total. This command excludes native GPU
fixtures and the quarantined legacy demo trajectories.

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
`STATE_SPACE_PYTHON` remains an explicit override. macOS host CPU and available
memory are sampled through the development dependency psutil. Missing telemetry,
invalid measurements, less than 8 GiB available RAM, or a busy host refuse the
run using the existing thresholds.

POSIX containment uses a new process group, live host monitoring, a supervisor
deadline and group cleanup. It does **not** enforce Windows Job CPU/memory caps
or provide the independent Windows watchdog. Receipts leave those unenforced
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
rendering, gameplay responsiveness and 60 Hz frame acceptance remain pending.
