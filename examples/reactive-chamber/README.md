# Reactive sandbox

Three fixed 16³ scenarios and the original 8³ reference chamber, built entirely on the public reactive-materials SDK. CPU physics
runs in a dedicated browser Worker; WebGPU renders the acknowledged terrain and
actor. It does not convert reactive snapshots into M5 snapshots or change the
M5 rules, optimized kernels, or existing tactical slab example.

## Run

From the repository root:

```sh
npm run build:sdk
npm run build:reactive-chamber
npm run verify:macos -- --stage chamber-visible
npm run verify:macos -- --stage sandbox-collapse-visible
npm run verify:macos -- --stage sandbox-flow-visible
npm run verify:macos -- --stage sandbox-chain-visible
```

Each fixed macOS acceptance stage owns its Chrome process, uses the existing
exclusive verification lease and independent watchdog, and closes all resources.
Its report, supervisor receipt and `chamber-view.png` are retained under
`dist/verification/macos-{stage}-*/`. All stages have a 300-second outer deadline
and a 128-tick recording limit. The 8³ regression permits 256 frames; each 16³
stage permits 512, including camera frames during preview/cancellation samples.
Every 16³ stage requires a passing 8³ receipt from identical sources within 24 hours. An
existing runtime safety hold is respected; this build creates no permit or hold.

For manual use, serve the repository root on localhost (for example,
`python -m http.server 8000 --bind 127.0.0.1`), open
`http://127.0.0.1:8000/dist/reactive-chamber/` in a WebGPU browser, and click
**Start chamber**. The selector starts a fresh scenario; save first to retain your
current history. Serving files does not start physics. **Stop** drains the frame,
closes the worker, and destroys owned GPU resources. The application checks the
local runtime hold on startup and fails closed on an unreadable existing hold.

## Application contract

- **Burning support (16³):** an anchored stone post joins a wooden connector to a
  two-cell platform. Heating it burns fuel, retires bonds, drops the platform and
  removes the actor's footing. Untouched and cooled controls remain supported.
- **Melt, flow, freeze (16³):** heat the ice on a narrow shelf, commit, then wait.
  Liquid flows off the lip and falls. Choose **Flowing water**, cool, and commit
  to freeze it at its new position.
- **Distant collapse (16³):** burn the connector at `(3,6,7)`. The bonded bridge
  loses support through to `(12,6,7)`, carrying the actor at the far end downward.
  The intact bridge remains stable. Support is solved globally.
- **Reference chamber (8³):** the original scene, rules, pulse, initial-state and
  first-commit digests are preserved for regression and old-save compatibility.
- One command previews exactly two complete reactive ticks. The flow profile uses
  a 15,360 Q pulse; the other profiles use 60,160 Q. Cooling removes up to the same
  amount, stopping at chemical fuel energy. Both debit their **actual absolute
  external energy** from a finite 481,280 Q resource. Waiting costs no thermal
  resource. No resource is spent until the preview commits.
- The actor is a ¾-cell cube using the SDK's 1,024 Q/cell geometry scale. Each
  physical tick first resolves terrain-driven displacement, then applies one
  kinematic step with 64 Q gravity. Crushing, phase overlap, missing/overflowed
  motion capture, and unresolved contacts reject the entire candidate.
- There is one active intent and one coalesced latest waiting intent. A new valid
  intent supersedes the prior candidate. Only the original latest ready worker
  ticket may commit. Cancellation waits for acknowledgement; it never mutates
  live state. A lost discard reply or concurrent shutdown rejects cancellation
  and publishes the terminal state; no waiter is left pending. Returned previews
  are caller-owned copies and cannot alter the candidate or its saved digest.
  There is no automatic simulation loop.
- Rendering and inspection use the same complete, registry-bound scene identity.
  Material colors come from the saved catalog. Rendering has no physics authority,
  permits one outstanding frame, and drains GPU work before disposing resources.
- A lost mutation acknowledgement closes the endpoint with an **uncertain**
  outcome. No automatic retry is sent. Export retains the last acknowledged
  complete save; the operator can recover that save in a fresh worker.

## Save and replay

`reactive-chamber-save-1` includes the full catalog, initial session, current
session, and committed commands with SHA-256 digests of each complete boundary.
Snapshots retain physical rules, absolute tick, actor cadence, resources and
exact energy accounting. Object-key ordering is ignored; every state value,
including session revision, is covered by a canonical digest.

Import is limited to 1 MiB and 64 commands. It validates the catalog and application
policy and fixed world identity, then replays in a new private worker and checks every boundary and the
final snapshot. The saved world identity selects the correct profile, including legacy 8³ saves.
Only a fully verified worker replaces the visible chamber. A
failed import leaves the old chamber usable. Exact replay also preserves session
revision without changing the SDK's deliberately revision-advancing `restore`.
The digests detect divergence; they are not authenticity signatures.

## Verification and limits

`engine/experimental/reactive/reactive-chamber.test.ts` executes public SDK behavior:
causal controls, phase changes, atomic cancellation, stale branches, crushing,
missing motion capture, rejected edits, finite resources, replay, validation,
scene isolation and picking. CI builds the browser bundles, checks their types,
and includes these tests in the bounded CPU suite. The companion
`reactive-chamber-client.test.ts` executes the real worker host through a cloned
asynchronous port to cover discard timeouts, shutdown waiters and preview ownership.

The macOS stages exercise real DOM controls and Workers, direct/worker complete
state equality, preview comparison, supersession, cancellation, save/load,
continuation, corrupt history rollback, lost acknowledgements, close/start races,
native pixels/depth, and GPU disposal. Targets are two-tick preview p95 ≤250 ms,
cancellation acknowledgement p95 ≤100 ms, and completed camera frames ≤16.667 ms.
These are bounded reference-scene measurements, not whole-product release claims.

Qualification is limited to these fixed 8³/16³ scenarios and one actor on the
reference Mac host; see the [16³ checkpoint](../../docs/checkpoints/REACTIVE_SANDBOX.md).
GPU reactive physics, larger/dense arbitrary reactive worlds, pressure, actor
force feedback, damage gameplay, and naturalistic rendering remain separate work. Existing M5 64³/128³ timing results do not qualify
this CPU reactive runtime at those sizes.

## Code ownership

`lifecycle.ts` owns startup, shutdown and client replacement without DOM or GPU
APIs. Import and reset share the same private-candidate swap. Shutdown drains
pending creation before another host can use the canvas. `view.ts` owns the
canvas, GPU resources and completed frame/camera; picking uses that completed
camera. The browser entry binds controls and inspection to these owners. The
chamber and tactical slab share the bounded frame pump in `examples/shared`;
each retains its own runtime-hold policy. Lifecycle failure races are also
exercised with deferred resource factories in CPU tests.

## Profiling

`node scripts/benchmark_reactive_chamber.mjs` runs three fixed two-tick CPU samples
per profile under a 60-second supervisor. It separates world evolution, structure,
job preparation/publication, session boundaries and presentation preparation.
World and session timings are separate executions; do not add them as one preview.
Reports include execution-input hashes, peak Node RSS and the supervisor receipt.

Native stages enable the application's `?profile=1` instrumentation. It measures
worker command handlers, main-thread reply handling and transport round-trip time
without altering the SDK wire protocol or physics. Round-trip minus worker time
includes cloning, queueing and delivery; it is not a pure serialization benchmark.
Browser process-tree peak RSS is retained in the supervisor's
`posix-watchdog.json`; GPU memory is not separately measured. Maximum observed call
and handler durations are observations, not wall-clock slice guarantees. The
application still uses whole-block evolution, copying and validation in places.
