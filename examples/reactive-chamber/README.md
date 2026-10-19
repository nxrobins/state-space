# Reactive chamber

An 8³ application built entirely on the public reactive-materials SDK. CPU physics
runs in a dedicated browser Worker; WebGPU renders the acknowledged terrain and
actor. It does not convert reactive snapshots into M5 snapshots or change the
M5 rules, optimized kernels, or existing tactical slab example.

## Run

From the repository root:

```sh
npm run build:sdk
npm run build:reactive-chamber
npm run verify:macos -- --stage chamber-visible
```

The fixed macOS acceptance stage owns its Chrome process, uses the existing
exclusive verification lease and independent watchdog, and closes all resources.
Its report, supervisor receipt and `chamber-view.png` are retained under
`dist/verification/macos-chamber-visible-*/`. It has a 300-second outer deadline,
8³ world limit, 128-tick recording limit, and 256-frame acceptance budget. An
existing runtime safety hold is respected; this build creates no permit or hold.

For manual use, serve the repository root on localhost (for example,
`python -m http.server 8000 --bind 127.0.0.1`), open
`http://127.0.0.1:8000/dist/reactive-chamber/` in a WebGPU browser, and click
**Start chamber**. Serving files does not start physics. **Stop** drains the frame,
closes the worker, and destroys owned GPU resources. The application checks the
local runtime hold on startup and fails closed on an unreadable existing hold.

## Application contract

- An anchored stone post joins a wooden connector to a two-cell stone platform.
  The actor stands on the connector. Heating it burns fuel, removes its bonds,
  releases the platform, and eventually removes the actor's footing. Untouched
  and cooled controls remain supported. A separate ice sample exercises phase
  changes.
- One command previews exactly two complete reactive ticks. Heat adds 60,160 Q
  to one selected cell; cooling removes up to that amount, stopping at chemical
  fuel energy. Both debit their **actual absolute external energy** from a finite
  481,280 Q resource. Waiting costs no thermal resource. No resource is spent
  until the preview commits.
- The actor is a ¾-cell cube using the SDK's 1,024 Q/cell geometry scale. Each
  physical tick first resolves terrain-driven displacement, then applies one
  kinematic step with 64 Q gravity. Crushing, phase overlap, missing/overflowed
  motion capture, and unresolved contacts reject the entire candidate.
- There is one active intent and one coalesced latest waiting intent. A new valid
  intent supersedes the prior candidate. Only the original latest ready worker
  ticket may commit. Cancellation waits for acknowledgement; it never mutates
  live state. There is no automatic simulation loop.
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
policy, then replays in a new private worker and checks every boundary and the
final snapshot. Only a fully verified worker replaces the visible chamber. A
failed import leaves the old chamber usable. Exact replay also preserves session
revision without changing the SDK's deliberately revision-advancing `restore`.
The digests detect divergence; they are not authenticity signatures.

## Verification and limits

`engine/experimental/reactive-chamber.test.ts` executes public SDK behavior:
causal controls, phase changes, atomic cancellation, stale branches, crushing,
missing motion capture, rejected edits, finite resources, replay, validation,
scene isolation and picking. CI builds the browser bundles, checks their types,
and includes these tests in the bounded CPU suite.

The macOS stage exercises real DOM controls and Workers, direct/worker complete
state equality, preview comparison, supersession, cancellation, save/load,
continuation, corrupt history rollback, lost acknowledgements, close/start races,
native pixels/depth, and GPU disposal. Targets are two-tick preview p95 ≤250 ms,
cancellation acknowledgement p95 ≤100 ms, and completed camera frames ≤16.667 ms.
These are bounded reference-scene measurements, not whole-product release claims.

This first build is restricted to 8³ and one actor. GPU reactive physics, 16³
qualification, pressure, actor force feedback, damage gameplay, and naturalistic
rendering remain separate work. Existing M5 64³/128³ timing results do not qualify
this CPU reactive runtime at those sizes.
