# Run and verify State Space on macOS

The engine lab runs locally on the JavaScript CPU backend and on browser WebGPU.
The first macOS validation used Apple Silicon, macOS 26.6.2, Python 3.10.20 and
an Apple `metal-3` WebGPU adapter. This is a bounded development baseline;
large 3D worlds, native Python GPU conformance and release benchmarks need
separate qualification.

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
run passed 39 Vitest tests and 12 Node tests. This command excludes native GPU
fixtures and the quarantined legacy demo trajectories.

Run the host-monitor and supervisor regressions separately:

```sh
uv run python -B -m scripts.verification_guard --kind cpu --timeout 30 -- \
  .venv/bin/python -B -m unittest discover -s tests -p 'test_verification*.py' -v
```

The initial macOS run passed 52 Python tests, with four Windows-only containment
tests skipped. The POSIX tests launch only tiny owned print/sleep processes and
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
The existing `gpu` and `frames` supervisor profiles still require NVIDIA telemetry;
this change does not turn those full release profiles into Apple GPU benchmarks.

Local command logs, supervisor receipts and the browser result belong under
ignored `dist/verification/`. Build and type-check with `npm run build:sdk` before
`npm run typecheck`, because the example clients use generated package declarations.
