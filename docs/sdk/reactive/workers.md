# Reactive workers and observations

[SDK index](../../SDK.md) · [Current validation and support](../../VALIDATION_STATUS.md)

These APIs are experimental. The support matrix above defines current qualification;
section-specific limits and runtime holds still apply. Historical implementation
steps and acceptance records remain in the [checkpoint history](../../checkpoints/TACTICAL_INTERVENTIONS.md).

- [Reactive worker previews](#reactive-worker-previews)
- [Reactive worker observations](#reactive-worker-observations)
- [Reactive worker state observation](#reactive-worker-state-observation)

## Reactive worker previews

The reactive-materials entry now exposes `createReactiveWorkerHost3D` and
`createReactiveWorkerClient3D` under the separate `reactive-worker-2` protocol.
The host creates and owns its session from a registry, initial state and policy.
Keep actor reconciliation, material control, costs and validation in that worker
policy. Callbacks and private movement capabilities never cross the transport.

```ts
// In your worker module: endpoint implements send/subscribe/close.
const host = createReactiveWorkerHost3D(endpoint, registry, initial, policy, {
  channel: 'battle', work: 64,
});

// In your UI, using an already-created worker and the same immutable catalog:
const client = createReactiveWorkerClient3D(
  reactiveBrowserWorkerTransport3D(worker), registry,
  {channel: 'battle', worldId: initial.worldId, gameRulesVersion: initial.gameRulesVersion},
);
await client.ready;
const ticket = client.request([
  {kind: 'transport', domain: null, control: 'wind'},
], {horizonTicks: 4, transport: {}, motion: {}});
const outcome = await ticket.result;
if (outcome.status === 'ready') {
  showPreview(outcome.preview); // hypothetical complete state; no live mutation
  // After the game's confirmation:
  const committed = await client.commit(ticket);
  showCommitted(committed.snapshot);
}
```

Each request advances at most one existing session slice. Host `work` is 1–256,
default 64. The client waits for its reply and yields a task before another slice;
there is at most one outstanding message, one active preview and one waiting
latest intent. New requests supersede older work, wait for its safe boundary,
discard it and start only the latest request. `ticket.cancel()` also revokes a
ready candidate. A new invalid request leaves an existing candidate usable.

`client.state` exposes copied progress and connection status. Intermediate replies
contain progress only; full candidate state is sent when the branch is ready.
`snapshot()` always returns the last acknowledged committed save, including after
failure. Only the latest original ticket can commit, and its acknowledgement must
match the accepted candidate in every state coordinate except revision. A copied
ticket or an edited preview cannot alter authority. Restore requires an idle
worker with its prior preview discarded and validates exact saved continuation.

Per-request timeout defaults to 10 seconds, configurable from 1 ms to 60 seconds.
Each preview also has a `maxSlices` budget (default 65,536, maximum 262,144).
Exhaustion discards that preview; no ticks are skipped. An explicit policy
rejection leaves the connection usable. Lost, malformed or failed commit/restore
responses mark `state.uncertain`; the client retains the prior acknowledged save
and closes the endpoint without retrying the mutation. Reconnect and reconcile
with application-owned authority before deciding what happened.

`close()` waits through an outstanding request, discards a preview and closes the
owned endpoint. The browser adapter terminates the supplied Worker on failure or
close; it does not create one. Custom transports must provide ordered delivery,
structured-clone isolation and endpoint cleanup. An optional `schedule` callback
is an integration/test seam: it must schedule a later task and return a cancellation
function. Inline scheduling is rejected. The default uses a zero-delay timer.

Whole-domain preparation, candidate transfer and validation remain O(volume).
This protocol establishes bounded scheduling, not a frame-time guarantee. Native
Worker/browser/GPU execution and large-world replay/benchmarks remain held; legacy
demos remain quarantined. Do not launch the documentation example under that hold.

## Reactive worker observations

The reactive worker's `reactive-worker-2` protocol adds catalog-aware geometry
queries and resumable change reports. Both endpoints must use this protocol;
the physical rules and save schemas are unchanged. These APIs operate on complete
committed or ready-preview states, including finite reservoir domains.

```ts
const requests = [
  {kind: 'fit', request: {box: bodyBox}},
  {kind: 'support', request: {box: bodyBox, maxDropQ: 1024}},
  {kind: 'exposure', request: {box: bodyBox}},
];
const currentAnswers = await client.query(requests);
// Once ticket.result is ready:
const previewAnswers = await client.queryPreview(ticket, requests);
const predictedChanges = await client.changesPreview(ticket, null, {maxRuns: 256});
const committed = await client.commit(ticket);
const changes = await client.changes(committed, null, {maxRuns: 256});
```

Query batches contain 1–32 `fit`, `support`, `raycast`, `sweep` or `exposure`
requests. Optional `domain` selects a reservoir; omission or `null` selects the
world. Each inspection advancement executes one existing geometry query, retaining
its bounded cell-visit limit and exact integer coordinates. Replies contain owned
answers and exact geometry stamps; they do not transfer another full world.

Reports contain `packed`, `material`, `phase`, `energy`, `temperature`, `structure`,
`constraints` and `support` channels. Support compares global distance, load,
capacity and anchor-reaction diagnostics at both endpoints, including temporary
holds. A local cut can therefore report changes at the remote end of a bridge.
The assessment uses the existing reactive support solver and discards its proposed
damage/motion state. It cannot advance the world or alter accounting. If effective
support inputs are identical, the report skips both support assessments.

Each channel provides an exact changed-cell count, full half-open XYZ bounds and
canonical linear `[start, length]` runs. One shared `maxRuns` budget applies across
all eight channels (default 256, maximum 8,192). An overflowing channel discards
its partial runs and returns `mode: 'bounds', requiresFullRead: true`; consumers
must read the affected bounds before treating coverage as complete. A zero budget
requests counts and bounds only. Reports compare **endpoints**: they do not
identify fragments, track identical matter, or recover transient motion. Use
executed movement capabilities for actor reconciliation.

`client.state.inspection` exposes copied query/report progress. Only one inspection
may run at a complete boundary; commit/restore are blocked until it finishes or
cancels. `cancelInspection()` preserves a ready preview. New preview intent,
parent-ticket cancellation and close cancel inspection at the next reply boundary.
Read errors preserve a valid ready preview; malformed replies close the endpoint
while retaining the last acknowledged save. Only the latest original ticket or
acknowledged commit object can request its report. Copies, older commits and
handles invalidated by restore reject.

For local use, `createReactiveChangeJob3D(registry, beforeView, afterView, options)`
accepts private reactive geometry views from the same world/domain/catalog and
shape. `advance(work)` scans at most `work` cells or advances one existing support
slice (1–256, default 64). `result()` requires completion and returns an isolated
copy. `cancel()` releases pending diagnostic state. Snapshot validation, copying,
support-job preparation and final result validation remain O(volume), outside the
slice budget. Global support is recomputed; this is not dependency-aware reuse.
Native responsiveness and large-world performance remain unmeasured and held.

## Reactive worker state observation

`client.subscribe(listener)` delivers an initial state and coalesced state updates
in microtasks, including timeout, send-failure and shutdown transitions. Each
listener receives an isolated state copy. Unsubscribe with the returned function;
terminal delivery releases the subscription. Observer exceptions cannot interrupt
protocol processing. Subscriptions observe state; physical slices still yield tasks.

After `ticket.cancel()`, await `client.whenIdle()` to wait for the discard
acknowledgement and any queued work. It resolves at an idle complete boundary
(a ready preview is idle) and rejects on failure or shutdown. It does not promise
that a particular superseded ticket is still current; commit still checks ticket
identity. These additive client APIs do not change the `reactive-worker-2` wire format.
