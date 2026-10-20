# Tactical workers

[SDK index](../../SDK.md) · [Current validation and support](../../VALIDATION_STATUS.md)

These APIs are experimental. The support matrix above defines current qualification;
section-specific limits and runtime holds still apply. Historical implementation
steps and acceptance records remain in the [checkpoint history](../../checkpoints/TACTICAL_INTERVENTIONS.md).

- [Worker-owned targeting previews](#worker-owned-targeting-previews)
- [Committed worker geometry batches](#committed-worker-geometry-batches)
- [Worker reports for a committed action](#worker-reports-for-a-committed-action)
- [Captured worker motion](#captured-worker-motion)
- [Captured worker paths](#captured-worker-paths)
- [Ready preview geometry](#ready-preview-geometry)
- [Worker action histories](#worker-action-histories)

## Worker-owned targeting previews

The tactical-session sources now expose `createTacticalWorkerHost3D`,
`createTacticalWorkerClient3D` and `tacticalBrowserWorkerTransport3D` under the
`tactical-worker-6` source protocol (extended with private preview queries in Build 24).
Build 20 passed **556 selected edit/inert tests**, including 36 worker cases,
20 query cases and 19 report cases, followed by full types, lint, SDK build and zero-tick public-package
integration. Built host/client operations were checked through a structured-clone
mock channel. No real browser Worker or physical trajectory has been validated by
these results. Peers with different protocol versions reject each other.

The host owns one tactical session and its synchronous preparation callback. The
client accepts portable commands, returns revision-bound preview tickets and
exposes `ready`, `request`, `query`, `changes`, `motion`, `paths`, `commit`, `restore`, `snapshot`, `state` and `close`.
Commit returns data-only `{snapshot, receipt}`; callable change/motion query
closures do not cross the transport. Only an acknowledged, validated commit or
restore replaces the client's last confirmed snapshot. Returned snapshots own
their storage. Treat ready preview data as historical: only the latest owned
ticket at the current revision is eligible for commit.

World geometry and reservoir identities/geometry must match the confirmed
session. A restore cannot redefine those domains, even if its internal energy
accounting is otherwise valid.

There is one normal request in flight, one local waiting command and at most one
cancellation control message. Replacements wait for both the old result and its
cancellation acknowledgement. The default per-message timeout is 10 seconds,
configurable from 1 to 60,000 ms. A failed or timed-out commit/restore sets
`state.uncertain`; retain the last confirmed state and perform explicit recovery.
The client never retries mutations automatically. A timeout does not establish
that native GPU work or an OS hang can be interrupted.

`TacticalTransport3D` provides clone-isolated `send`, `subscribe` and `close`.
The browser adapter takes ownership of an existing Worker and terminates it on
client failure or acknowledged close; it launches nothing itself. Use one client
and one host per owned channel/session. Do not concurrently mutate the session
through another owner. Keep application callbacks in the worker module.

See the [public-SDK bootstrap example](../../../examples/tactical-worker/README.md).
It is not an automatically running demo. Mock transport tests and zero-tick
package integration passed. Native Worker execution, physical
replay and frame timing remain held. Full snapshot serialization and validation
still impose main-thread costs; this API carries no measured latency guarantee.
See the [Build 20 evidence](../../checkpoints/tactical-interventions/build-20-2026-10-17/summary.json)
for exact source/output hashes, containment limits and stage receipts.

## Committed worker geometry batches

`await client.query(requests)` returns `{rulesVersion, base, results}`. Each result
is `{kind, domain, value}` in request order, using the corresponding existing
`GameplayGeometry3D` return type and its committed revision/domain stamp.

```ts
const readings = await client.query([
  {kind: 'fit', request: {
    box: {minQ: [1024, 0, 1024], maxQ: [2048, 1024, 2048]},
  }},
  {kind: 'raycast', request: {
    fromQ: [512, 1536, 1536], toQ: [3584, 1536, 1536],
  }},
]);
// Associate every answer with readings.base before applying game policy.
```

Supported kinds are `fit`, `support`, `raycast`, `sweep` and `exposure`. Pass the
same request fields used by direct geometry queries, with 1,024 coordinate units
per cell. An optional `domain` names an existing reservoir; omitted/null selects
the primary world. `support` finds geometric contact, not structural load-bearing
capacity. Exposure returns material volumes, liquid depth and exact temperature
fractions; injury and movement policy remain in the game.

`TACTICAL_QUERY_BATCH_RULES_3D` is `tactical-query-batches-1`.
`TACTICAL_QUERY_BATCH_LIMITS_3D` allows 1–32 queries, retaining the existing
65,536-cell work limit per query. Requests and the whole reply must also fit the
tactical portable-data budget. Oversized responses reject without a partial
prefix. Request values must be portable data; omit optional fields instead of
sending `undefined`.

A query requires an idle client and occupies its normal request lane. It cannot
overlap another query, preview, commit or restore. A ready preview may remain
available while a read runs, and ordinary read failures do not invalidate it.
Malformed transport data or timeout closes the connection and invalidates ticket
authority, retains the last confirmed snapshot and reports no uncertain mutation
for the read itself. There is no automatic retry or stale-base rebase.

The batch uses one isolated geometry view per requested domain. The host still
copies complete CPU geometry views and a session snapshot for validation; these
bounds and compact replies are not a guarantee of frame latency or GPU readback
avoidance. Preview geometry and global structural change reports are not exposed
by this batch API. Native Worker execution, physical replay and performance
acceptance remain held.

## Worker reports for a committed action

Keep the exact commit object returned by this client, then request its endpoint
report while the client is idle:

```ts
const committed = await client.commit(ticket);
// The action has already committed atomically. This is a separate read:
const changes = await client.changes(committed, {maxRuns: 512});
// Associate navigation/cover updates with changes.from and changes.to.
```

`changes` returns the existing `GameplayChangeReport3D`. It compares the action's
complete endpoints across material, phase, energy, temperature, structure,
constraints and support, including reservoir domains and game/accounting flags.
Support assessment covers the whole affected domain: a local cut can report an
unchanged distant bridge cell. Endpoint differences cannot identify moving matter;
`motion.status` stays `not-observed` and requires a separate execution trace.

The default `maxRuns` is 2,048, with a range of 0–4,096 shared across all channels
and domains. A coarse channel keeps its complete count and bounds, sets
`requiresFullRead`, and returns no truncated run list. Detailed runs are sorted,
disjoint and coalesced. Request/reply validation and portable size bounds apply
before returning isolated data.

Only this client's latest acknowledged commit can be inspected. A new successful
commit or restore expires the old handle; copying/deserializing the commit object
does not recreate it. Queries and ready previews do not replace that handle.
Changing public receipt or snapshot fields cannot alter the private report stamps.
The host retains at most one full committed report closure and releases it on
replacement, restore or close. This is a live connection API, not a saved journal.

Report computation never runs automatically during commit. An observation error
rejects the read while preserving the successful action and any unrelated ready
preview. Transport corruption/timeout makes the connection unusable and preserves
the last confirmed state; a report read does not create an uncertain mutation.
Do not interpret a rejected report as a failed action or resend the action.

Physical input changes may require global support solves on both retained
endpoints. Bounds limit response detail, not solve latency. The current CPU/mock
tests prove transport behavior using inert support observations; the built-package
check covers a game-only report with no support observation. Real structural
solves, worker execution, replay and frame timing remain separately held. This
does not provide incremental graph maintenance. Separate captured motion and path
reads are described below; endpoint reports do not substitute for those traces.

## Captured worker motion

```ts
const ticket = client.request(command, horizon, {motion: {maxEntries: 4096}});
const outcome = await ticket.result;
if (outcome.status === 'ready' && client.state.readyId === ticket.id) {
  const committed = await client.commit(ticket);
  const motion = await client.motion(committed);
  // Use complete reports for per-tick net correspondence and fragment membership.
  // A touched identity can return to its starting cell without a net move.
}
```

`request` accepts the same optional `TacticalPreviewCapture3D` third argument as
the queue. Options validate and detach before accepted work is replaced. Paths
and action-journal capture can support the worker's game policy. `motion` returns
net correspondence and `paths` returns subpass crossings. Omitted options retain the
session's policy defaults; callers cannot turn off policy-required paths.

`client.motion` reads the existing `MotionJournal3D` for the exact latest
acknowledged commit object. It does not infer identities from snapshots or invoke
a support solve. Commit sends no eager motion payload. The host retains only its
latest commit; restore/close and a newer commit revoke the old read permit.
Reports own their data and retain the full starting and committed revision stamps.
They occupy the normal single-flight request lane. Read errors preserve the
acknowledged state and any ready preview; a timeout or malformed reply fails the
connection closed without making the earlier acknowledged commit uncertain.

The client validates each domain/tick record, queue operation ordering, rules and
catalog identity, fragment membership, closed permutations, touched identities
and complete horizon coverage. Validation uses metadata and bounded lists, not
per-tick world copies. Existing limits apply: 256 retained domain-tick records,
65,536 total detail entries, and the requested per-tick budget (default 4,096,
maximum 65,536). An overflow report retains the total observed record count but
no partial detail. `disabled` and `overflow` require reexecution for full detail.

These observations cover complete simulation ticks. Their explicit
`includesInterventions: false` and `includesSubpassPaths: false` flags exclude
direct manipulation and swept paths. Use the existing direct-session path/action
journals for direct interventions and `client.paths` for subpass path inspection. Motion reports
alone cannot resolve mid-tick actor contacts. Build 22 passed 600 selected
edit/inert cases, full types, lint, SDK build and zero-tick public integration
after repairing a narrow default-parameter type. The first SDK quiet gate refused
launch; a fresh gate on the next continuation passed. Both peers now build with
protocol 4. See the [completed evidence](../../checkpoints/tactical-interventions/build-22-2026-10-17/summary.json).
Native worker, physical/replay, GPU and latency acceptance remain held.

## Captured worker paths

Use `client.request(command, horizon, {paths: {maxEntries: 4096}})` to capture
simulation-tick paths. After acknowledgment, `await client.paths(committed)`
returns the existing `PathJournal3D` for the exact latest commit handle. Paths
imply net-motion capture; `motion.maxEntries` can independently configure its
per-tick budget. Both defaults are 4,096 and both maxima are 65,536 entries.

Each frame contains a matching net trace and ordered subpass segments. Validation
checks the absolute-tick schedule, simultaneous disjoint swaps, original identity,
structural descent versus displaced-cell relocation and composition back to the
net trace. A returned-to-origin cell still retains its intervening crossings.
Metadata-only decoding avoids fabricating intermediate snapshots; the public
`readMotionPaths3D` decoder still validates its full before/after snapshots.

The 65,536-entry journal allowance is shared by frame overhead, net-motion detail
and path passes/segments. There are at most 256 retained domain-tick frames. When
retention or per-tick capture overflows, the report preserves the observed record
count but removes all partial history. Check `status` and `requiresReexecution`;
neither `disabled` nor `overflow` proves an empty unobstructed path.

Path reads use the same idle lane, timeout, ownership, revision and cleanup rules
as motion reads. Returned nested data is isolated. Read failure does not undo a
successful action or invalidate a ready preview; malformed transport fails the
connection closed while retaining the last confirmed state. Commit sends no
eager path payload. Restore, close or a newer commit invalidates old handles.

`includesInterventions` remains false. Direct translation and other intervention
history belong to the action/translation journals, whose worker transport is
pending. This portable record supports inspection and visualization; it is not a
live `TickMovement3D` observation accepted by actor-resolution APIs. Resolve actors
inside the worker policy using its original before/after geometry and movement.
Build 23 passed 622 selected edit/inert cases, full types, lint, eleven SDK
builds/declarations and zero-tick public-package integration after fresh quiet
gates. That build used protocol 5; Build 24 below uses protocol 6. The original refused gate and pending
receipt remain preserved. See the
[completed evidence](../../checkpoints/tactical-interventions/build-23-2026-10-17/summary.json).
Native worker, physical replay, GPU and frame acceptance remain held; this API
provides no measured latency guarantee.

## Ready preview geometry

`queue.queries(ticket, {domain})` returns an isolated geometry view of the latest
ready candidate. The worker equivalent is `await client.queryPreview(ticket,
requests)`. Both expose fit, support, raycast, sweep and exposure. This is geometry
and thermal exposure inspection; support does not assess load capacity.

Worker batches use `tactical-preview-query-batches-1` under transport protocol 6.
They include the wire target and the candidate's full base revision, branch ID,
operation, declared horizon and completed ticks. Every result retains its preview
stamp, absolute tick and domain. Ready inspection metadata now includes `branchId`
and `operation`; it remains distinct from a committed snapshot envelope. The
client retains one validated private ready snapshot, separate from caller-mutable
outcomes, and checks returned cells against that candidate. No result is rebased
or relabeled as committed. A read never spends AP or publishes terrain.

The existing limits apply: at most 32 requests per batch, 65,536 visited cells per
query, and bounded portable replies. One geometry view per requested domain is
reused within a batch. Only one ordinary wire request runs at once. Invalid query
inputs may reject a read while leaving its ready candidate committable. Pending,
foreign, copied, superseded, cancelled, committed, restored and closed tickets
cannot acquire current preview answers. Cancellation or close while a read is in
flight rejects that read when replies drain. Already returned views and records
are isolated historical observations, not proof that their preview is still current.

Candidate retention ends on invalidation, commit, restore, close or connection
failure; a pending read keeps its validation reference until settlement. Full
snapshot/geometry copies remain, and this is not copy-on-write or latency evidence.
Build 24 passed **648 selected edit/inert cases**, including 26 preview-query
cases, full no-emit types, lint, eleven SDK bundles/declarations and zero-tick
public-package integration. Current artifacts use protocol 6. An outdated
integration assertion was corrected to check the exact new branch/operation
metadata, then all five gates passed on the corrected source snapshot.

After explicit user authorization, the extra ten-sample launch ceiling was set
to the supervisor's existing 50% CPU ceiling. The unchanged 6% workload CPU cap,
4 GiB memory cap, independent watchdog, deadlines and cleanup checks stayed in
force. The original 20% gate refusals and failed integration receipt are retained
in the [completed evidence](../../checkpoints/tactical-interventions/build-24-2026-10-17/summary.json).

All 96 protected source/configuration hashes match. Physical stepping/support,
replay, native Worker, GPU and frame acceptance remain held; legacy demos stay
quarantined. Passing these CPU/mock gates does not establish physical replay or
frame latency, or complete the broader tactical wishlist.

## Worker action histories

The experimental tactical worker protocol is now `tactical-worker-7`; upgrade
both endpoints together. Opt in when requesting a preview, then read captured
history before deciding whether to commit:

```ts
const ticket = client.request(command, horizonTicks, {journal: {maxRuns: 256}});
const result = await ticket.result;
if (result.status === 'ready') {
  const history = await client.journalPreview(ticket);
  // Apply the game's acceptance policy to history and ready geometry queries.
  const commit = await client.commit(ticket);
  const committedHistory = await client.journal(commit);
}
```

`journalPreview` accepts only this client's latest ready ticket. Its result
contains the complete starting revision, private branch/operation identity and
simulated horizon. Cancellation, supersession, restore, commit or close expires
that ticket's access. `journal` accepts only the latest acknowledged commit
handle. Mutating returned snapshots or histories cannot change private identity.
Each call occupies the existing single read/request slot; cancellation has its
separate bounded lane. Closing drains outstanding reads. Read failures retain
the last confirmed state and do not mark a mutation uncertain.

Histories contain ordered interventions and complete logical tick boundaries,
including domain change reports and captured net motion. They retain reversed
changes that an endpoint diff cannot reveal. No subpass path history is implied.
The decoder checks chronology, domains, receipt conservation, hold lifetimes,
motion correspondence, shared budgets and aggregate external energy against the
private preview or commit ledger. It validates observed data without rerunning
physics. Reading captured history performs no support solve; enabling capture
can perform global support observations during preparation and advancement.

`disabled` means capture was not requested. `coarse` retains complete change
counts/bounds but requires detailed state reads. `overflow` discards the entire
history prefix and requires recapture/reexecution with suitable scope; never
treat it as a complete action. Events, domain ticks and detail entries retain
their existing limits (256, 256 and 65,536 respectively). Results are disposable,
isolated observations, not authoritative replay files or persistent entity IDs.

Build 25 passed 674 selected edit/inert tests (26 new history cases), full types,
lint, eleven SDK bundles/declarations and zero-tick public-package integration.
[The retained checkpoint](../../checkpoints/tactical-interventions/build-25-2026-10-17/summary.json)
records source hashes, bounded execution and cleanup. Real physical trajectories,
native Worker execution and GPU/replay/frame tests remain held. Legacy demos stay
quarantined. This API adds no performance claim.
