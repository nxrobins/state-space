# Reactive sandbox: 16³ macOS qualification

Implementation: `b439c36aa7834f9236c73959f9d4bc022681f46d`.
The [evidence manifest](REACTIVE_SANDBOX.json) binds the execution inputs,
reports, screenshots, supervisor receipts and CPU profiles. The
[verification archive](https://github.com/nxrobins/state-space/releases/tag/reactive-sandbox-2026-10-20)
retains passing and failed runs; raw captures remain outside Git.

Three fixed 16³ scenarios passed on the Apple M3 Ultra / macOS 26.6.2 / Chrome 155
reference host, using CPU reactive physics in a real Worker and native Apple
Metal-3 WebGPU presentation. The original 8³ chamber also passed all 13 existing
browser journeys with the same implementation. Browser console errors and exact
energy drift were zero; every owned browser and GPU resource closed successfully.

| Scenario | Two-tick preview p95 | Active cancel p95 | Worst camera render | Worst application frame | Peak process-tree RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 8³ reference | 18.9 ms | 1.6 ms¹ | 1.2 ms | 3.2 ms | 1,836 MiB |
| 16³ burning support | 113.2 ms | 2.3 ms | 1.7 ms | 10.6 ms | 1,955 MiB |
| 16³ melt / flow / freeze | 111.1 ms | 1.3 ms | 1.5 ms | 10.8 ms | 1,964 MiB |
| 16³ distant collapse | 110.3 ms | 0.9 ms | 1.3 ms | 10.2 ms | 1,963 MiB |

Targets remain preview p95 ≤250 ms, cancellation p95 ≤100 ms, and completed
camera/application frames ≤16.667 ms. Each latency percentile uses 12 samples,
including the first cold preview. Rendering uses 120 measured 640×400 camera
frames after ten warm-up frames, plus the actual application canvas and controls.
The 16³ camera RAF worst gaps during previews were 18.1–18.2 ms, below the separate
100 ms stall limit. These render timings include GPU completion, not OS scanout.

¹ The retained 8³ latency loop measures ready-preview discard acknowledgements;
it also tests active cancellation separately. The 16³ loop measures cancellation
while a preview is executing. RSS is the watchdog's sampled peak for the entire
owned browser/process tree, not JavaScript heap or isolated GPU memory.

## Delivered behavior

- Burning support removes a wooden connector, drops the two-cell platform and
  removes the actor's footing; the untouched control stays supported.
- Ice melts on a narrow shelf, flows downward, and freezes after cooling at its
  new position. The profile uses a smaller pulse to separate those phase changes.
- Breaking the connector at `(3,6,7)` releases a bridge through `(12,6,7)` and
  displaces the actor at that far end. The intact bridge is stable.
- Real DOM controls exercise selection, preview, comparison, commit and cooling.
  Each complete preview and commit matches direct public-SDK execution with a
  different structural work budget (64 versus the Worker's 256).
- Active cancellation preserves the complete committed state and resource balance.
  Save/reload replays all recorded hashes, then produces the same next commit.
  A malformed cross-profile save leaves the current sandbox intact.
- Switching between 8³ and 16³ while a frame is pending preserves the displayed
  selection and keeps the renderer alive. Rendering, inspection and picking use
  the displayed scene's dimensions and completed camera.
- The 8³ initial and first heated-commit hashes match main before this build,
  preserving the original scenario and existing save format.

## Measured optimization

The baseline CPU profiles put two-tick session work around 67–78 ms at 16³.
Structure solving was a small share; copying and validation were substantial.
The application policy now validates its game rules on the already validated,
owned SDK callback snapshot, removing one redundant whole-snapshot validation.
External save/presentation inputs still go through full SDK validation. Physical
rules, SDK exports, worker protocol, M5 kernels and structural work budgets are
unchanged.

In the three-sample Node diagnostic, collapse finalization fell from a median
8.60 to 6.30 ms and commit from 9.24 to 7.36 ms. These are diagnostic observations,
not a controlled universal speedup claim. The final native profiles observed a
maximum Worker command handler of 12.0 ms. Public-job phase timings separately
record preparation, evolution, structure, publication, result copying, session
boundaries and presentation preparation. World-only and full-session profiles are
separate executions and must not be summed as one preview.

Transport timing includes message cloning, queueing and delivery. It does not
isolate pure serialization cost. Whole-block operations remain, and their observed
durations do not establish a hard wall-clock slice bound at larger sizes.

## Review and validation

Manual adversarial review covered profile identity, save compatibility, resource
limits, worker acknowledgement/ownership, replacement races, display identity and
the qualification gates. It found and corrected selection inspection against an
old frame during a size switch, kept the flow pulse bounded in the actual policy,
and preserved strict import/replay validation around the optimized callback.
No blocking finding remains in the reviewed scope.

The first flow fixture failed its water assertion: its pulse did not preserve the
intended liquid phase. A finite thermal probe established a 15,360 Q pulse, and
melting/flow/refreeze tests then passed. Two later native attempts recorded 92–94 ms
application frames because synchronous CPU-oracle work overlapped a displayed
frame. The harness now waits for displayed work before running its separate CPU
reference. The original failures are retained; neither frame thresholds nor
physics were relaxed. Final native acceptance passed with all execution-input
hashes matching the implementation commit.

Validation passed 1,855 engine tests, 24 Node controller/tooling tests, 45 engine
smoke tests, 13 smoke/transport tests, 68 supervisor tests with four existing
containment/platform skips, three archive tests, and independently installed
Python/npm package clients including all 13 npm entry points. SDK/browser builds,
TypeScript, lint and formatting passed. The no-mistakes executable was unavailable;
review, checks, publication and CI were handled manually.

## Scope and reproduction

Use the [application instructions](../../examples/reactive-chamber/README.md) or
[macOS commands](../MACOS.md#reactive-sandbox). Each 16³ stage requires a passing,
source-identical 8³ receipt from the preceding 24 hours. Each run retains the
300-second outer deadline, 128-tick recording limit and 8 GiB sampled RSS ceiling.
The 8³ frame cap remains 256; each 16³ stage caps its camera work at 512 frames.
Existing incident holds, exclusive lease and independent watchdog remain in force.

This qualifies these sparse reference scenes, one actor and the recorded Mac host.
It does not qualify arbitrary dense 16³ worlds, continuous 60 Hz reactive
simulation, larger reactive volumes, GPU reactive physics or other platforms.
