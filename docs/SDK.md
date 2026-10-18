# State Space SDK

### Reactive worker observations (Build 53)

CPU acceptance: 1,695 selected tests, type checking, lint, SDK compilation and
public-package integration passed on 2026-10-18. See the
[Build 53 checkpoint](checkpoints/TACTICAL_INTERVENTIONS.md). Native execution
and performance acceptance remain held.

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

### Reactive worker previews (Builds 52–53)

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

### Atomic reactive transport abilities (Build 51)

Queue `{kind: 'transport', domain, control, impulses?}` on a reactive session branch.
`control` is an application-defined name. The required synchronous
`readTransport({game, command, queries})` policy selects its saved memory from the
**current staged game when the command begins**. Chained commands therefore see
the preceding command's updated cycle and fractional motion. The selector owns
copies of game/command input; its mutations do not change the pending command.
The returned memory must match the selected domain's identity, tick and cell
witnesses. Acquisition, allowed materials, range and costs remain game policy.

The existing `reduceCommand` policy is also required. After complete physical
staging it receives `transport()`, returning `{domain, control, receipt, memory,
movement}` for a transport command and `null` for other commands. Return game
state containing the new memory and any accepted actor/cost changes. The engine
publishes that returned game and material state at one boundary. It cannot infer
where your game stores controllers or what a valid cost is; use `validateGame`
for additional application invariants. Do not replace current game state with an
earlier queued copy when incorporating transport output.

```ts
const policy = {
  readTransport({game, command}) {
    return game.controls[command.control];
  },
  reduceCommand(c) {
    const t = c.transport();
    if (!t) return c.game;
    if (c.game.ap < 1) throw new Error('Insufficient action points');
    const response = createReactiveTransportedActorGroup3D(
      c.beforeQueries(t.domain), c.queries(t.domain), t.movement,
    ).resolve(c.game.units);
    if (response.status !== 'resolved') throw new Error('Unsafe transport');
    return {...c.game, ap: c.game.ap - 1, units: response.bodies,
      controls: {...c.game.controls, [t.control]: t.memory}};
  },
};
const branch = session.branch({horizonTicks: 0, transport: {}});
branch.enqueue({kind: 'transport', domain: null, control: 'wind'});
```

Enable `transport: {maxEntries?}` for actor/path observations. The default is
8,192 entries, maximum 65,536. Each executed swap costs four entries: pass header,
controlled origin and two segments. The selected parcel moves linearly; displaced
gas relocates to its vacated cell. Capture includes identical-valued swaps.
`reactive-transport-motion-1` observations are privately bound to the exact before
and after views. Disabled/overflowed capture changes no physics or control state;
it yields incomplete actor reconciliation and cannot prove safe movement.

`createReactiveTransportDisplacement3D` resolves one body under
`reactive-transport-displacement-1`; `createReactiveTransportedActorGroup3D` adds
exact peer checks with the existing aggregate work/detail limits. Only the parcel
moving in that pass can carry an actor. Stationary support, including another
controlled parcel, vetoes carry. The shared solver handles exact pushes, terrain
clipping, crush constraints, lost footing and final exposure. It does not apply
actor loads, actor gravity/voluntary movement, damage or kinetic heat.

For another controller displaced by the command, use
`followReactiveMaterialTransport3D` with `t.movement`; that preserves its cycle
and velocity. The commanded controller must instead use `t.memory`, which includes
the new cycle and impulse. Update affected controls after ordinary translations
and ticks through their existing movement observations. Cross-domain transfers
and arbitrary replacement still need explicit application handling.

`createReactiveMaterialTransportJob3D(registry, state, impulses?)` exposes the
same planner as a cancellable job: one parcel, at most six swaps, per `advance()`,
then a separate complete validation/publication call. Partial `result()` rejects.
`applyReactiveMaterialTransport3D` remains its synchronous convenience wrapper.
Session advancement keeps the old complete command boundary until the job and
reducer succeed. Cancellation, stale branches or any later error discard the
whole ability, including prior commands. `lastTransport()` exposes only the latest
completed transport result and clears at another command/tick; retained copies
and movement capabilities remain historical.

Preparation, cloning, final validation and actor reconciliation still include
bounded volume/solver work. These limits do not establish frame latency. Tiny CPU
transactions and continuation are verified; native/GPU checks, large-world replay
and benchmarks remain held, and legacy demos remain quarantined.

### Reactive material transport planning and continuity (Build 50)

The reactive-materials entry exports `createReactiveMaterialTransport3D(registry,
queries, seeds)` and `applyReactiveMaterialTransport3D(registry, state, impulses?)`.
Seeds identify existing cells, with unique string IDs and optional `velocityQ`.
An impulse is `{id, impulseQ: [x, y, z]}`. These functions return owned candidates;
they do not publish terrain, run physics, resolve actors or charge ability costs.
Use the Build 51 session command above for atomic ability execution. Do not
implement a live ability by restoring the candidate world: restore would bypass
that transaction.

`reactive-transport-1` reuses the existing transport arithmetic: ascending lexical
parcel IDs, X/Z/Y sweeps, Q1024, at most two cell crossings per axis, 256 parcels
and 1,536 swaps per cycle. Fractional displacement accumulates in saved state.
Blocking clears only normal velocity/remainder, with no bounce, pushing, drag or
kinetic-to-thermal conversion. The control cycle is independent of the physical
tick. Candidate receipts report exact ordered swaps, contacts and net cell changes.
Value-identical gas swaps still appear in the movement receipt.

Unbound gas, powder, liquid, molten/viscous material and completely failed cohesive
debris are controllable. Eligibility uses the active custom catalog. Air, intact
or damaged solid structures, anchored/bonded cells, noncohesive solids and held
matter are excluded. Only unbound gas can be displaced. Packed material, conserved
energy and structural coordinates move together; fuel and thermal history are
preserved, and unrelated holds retain their absolute expiry.

`readReactiveMaterialTransport3D` validates the full portable state.
`captureReactiveMaterialTransportMemory3D` saves compact control plus witnesses
for all three selected-cell coordinates; `restoreReactiveMaterialTransportMemory3D`
binds it to a matching geometry view. Memory includes world/game/domain identity,
catalog, dimensions, physical component rules and absolute tick. Keep it with the
application save. It intentionally does not encode a transient local revision;
identical matter or same-tick edits cannot be distinguished from a self-contained
save alone. Memory is not proof of execution or authority to commit a branch.

Within a session reducer, `followReactiveMaterialTransport3D(registry, before,
after, movement, memory)` follows the privately bound executed tick or translation
observation. It follows selected and displaced matter, updates thermal/material
witnesses, and preserves velocity, fractional remainder and control cycle. A parcel
that becomes air or immobile is explicitly retired. Missing/overflowed capture or
foreign boundaries reject instead of guessing correspondence. Throwing from a
reducer keeps the existing whole-branch rollback semantics. Arbitrary placement,
cross-domain transfer and changes to hold schema need explicit application handling;
this adapter follows only the supplied complete tick or translation.

CPU evidence covers tiny trajectories and saved continuation. Native/GPU checks,
large-world replay and benchmarks remain held; legacy demos remain quarantined.

### Reactive actor groups and peer-aware movement (Build 49)

`createReactiveActorGroup3D(beforeQueries(), queries(), movement())` reconciles
up to 64 named bodies with an executed reactive tick. For a controlled command,
use `createReactiveTranslatedActorGroup3D(beforeQueries(domain), queries(domain),
translation())`. Both return a `reactive-actor-group-1` context with
`resolve([{id, body}, ...], {maxWork?, maxEvents?, maxContacts?, maxCarryEntries?})`.
IDs are unique portable strings, sorted lexically. Limits apply to the entire
group, including peer comparisons; tick responses now support carry-detail limits
as well. Default allowances preserve prior individual response behavior.

Groups first compute exact one-way terrain responses, then compare privately
recorded piecewise actor paths. They detect intermediate overlap even when final
positions separate, including out-and-back motion and terrain-clipped carries.
`peerContact` identifies the earliest pass and exact rational time, breaking ties
by actor IDs. Initial overlap is explicit; tangential and end-only touching are
allowed. Terrain failure, peer conflict or exhausted work returns the original
canonical bodies and no accepted response prefix. Peer-budget exhaustion clears
unproven peer details and requires reexecution. The application decides whether
to reject an ability, retry, or apply its own damage/removal rules.

For explicit actor movement, `moveReactiveActors3D(queries, bodies, commands?)`
uses `reactive-actor-movement-1`. Commands are `{id, impulseQ?, accelerationQ?}`;
each component uses the existing fixed-point body limits. All actors must share
one body-step counter. Saved velocity, commands and gravity are added once, then
actors move in ascending ID order, with X/Z/Y sweeps per actor. Earlier actors
occupy their completed positions; later actors still occupy their starting ones.
Terrain wins an exact-distance collision tie, then peer IDs determine peer ties.
This serial rule can make a trailing unit wait for a later unit in a convoy.

Results report actual segments, terrain/peer contacts, final footing, lost/landed
support, water depth and sensible temperature. Actor support does not apply loads
to terrain or automatically carry a standing actor when its supporting peer moves.
Store the complete returned bodies in session game state; command/tick policies
can reject the whole paid action if group reconciliation is unresolved. Material
state and energy are unchanged by these queries and actor movement.

These APIs reuse the existing M5 arithmetic with separate reactive identities;
they do not make actor pushing or simultaneous rigid-body response implicit.
Work allowances bound solver visits, not elapsed frame time. Native scheduling,
reactive force/transport integration and external actor loads remain further work.
GPU/large-world verification and benchmarks remain held; legacy demos stay quarantined.

### Controlled translation and actor transactions (Build 48)

`reduceCommand` is a pure synchronous session policy invoked after each privately
staged command. It receives copied `game`, `command` and physical `receipt`, plus
`beforeQueries(domain?)`, `queries(domain?)` and `translation()`. The query stamps
differ by one completed command at the same physical tick. Game commands supply
their proposed game state; other commands supply the preceding game state.
Branch reads during the callback still expose the previous complete boundary.
Throwing, returning invalid game data, returning a promise, or attempting mutation
reentry rejects the entire branch, including earlier AP and energy commands.
Successful previews still require final validation and a same-revision commit.

Enable `branch({horizonTicks, translation: {maxEntries?}})` to observe controlled
translation. In the command reducer:

```ts
if (command.kind !== 'translate') return game;
const response = createReactiveTranslationDisplacement3D(
  beforeQueries(command.domain), queries(command.domain), translation()!
).resolve(game.body);
if (response.status !== 'resolved') throw Error('Unsafe lift');
return {...game, body: response.body};
```

`reactive-translation-motion-1` captures the actual executed cardinal steps,
selected-cell origins and displaced-occupant relocations. Capture defaults to
disabled. The default enabled budget is 4,096 entries, maximum 65,536; each
controlled origin, pass header and segment costs one entry. Overflow discards
all paths and requires reexecution, without changing material physics. Transfers
and other commands return null rather than an invented swept route.

`reactive-translation-displacement-1` carries a body only when every touching
upper-face support belongs to the controlled selection. A stationary support
vetoes carry. Exact swept contacts may limit realized travel or report a crush;
displaced occupants only check their destinations. Body step, velocity and gravity
remain unchanged. `carries` describes requested support travel; `movedQ` gives
the realized displacement. Capture, solver and carry-detail limits fail explicitly;
incomplete results retain the original body and clear partial contact/carry detail.

`lastTranslation()` returns isolated observations of the latest completed
translation, and null after another command or tick. Partial jobs never publish
new observations. Retained accessors remain historical after discard or later
commits; copied observations cannot forge private query provenance.

Commands stage ordinary whole-domain snapshots, including game-only commands.
This has O(total cells) copy/validation costs, bounded by existing session limits;
it is not yet a responsive native scheduling or performance guarantee. External
loads and reactive air transport need further integration.
Native/GPU checks and benchmarks remain held, and legacy demos remain quarantined.

### Reactive bodies and terrain response (Build 47)

`createReactiveBody3D(queries, {minQ, sizeQ, velocityQ?, gravityQ?})` creates portable
`reactive-body-1` state. Save it inside your session's game state. It is bound to
the world ID, domain, catalog and reactive evolution/structure rules; adding a
temporary hold does not invalidate it. `readReactiveBody3D` validates/copies a save.
`stepReactiveBody3D` applies bounded integer gravity, acceleration and impulse,
then resolves movement in X/Z/Y order. Coordinates use 1,024 units per voxel.
Step results include contacts, footing and sensible-temperature/water exposure.

Within a tick reducer, use all three accessors from that same callback:

```ts
const contact = createReactiveDisplacement3D(
  beforeQueries(), queries(), movement()
).resolve(game.body);
if (contact.status !== 'resolved') throw Error('Ability requires a safe body response');
return {...game, body: stepReactiveBody3D(queries(), contact.body).body};
```

Enable branch `motion` capture first. `reactive-displacement-1` follows actual
pass paths and updates material/energy/structure at each boundary. Falling fragment
members carry a body only when every current upper-face support moves with the
same fragment displacement. Stationary support prevents carry; loose powder can
leave a body unsupported. Normal contacts push without friction. Opposed constraints
report crushing, and new solids report overlap at the exact phase/combustion
boundary. Displaced occupants are checked at relocation destinations, not swept
through intervening terrain. Contacts report current material and energy.

Terrain reconciliation does not increment the body's step, apply gravity, or alter
its saved velocity. The application chooses the actor-step cadence; the example
above uses one body step after every material tick. Failed or incomplete responses
return the original body. Incomplete capture/work/contact/event budgets clear
partial contact and carry detail and require reexecution; game policy decides
whether to reject, retry, injure or remove the actor. Partial motion is never
silently committed. `carries` reports requested support motion; `movedQ` reports
realized displacement. Retained response contexts stay tied to their original
query/trace boundaries. Public copies cannot forge that provenance.

The shared contact and kinematic arithmetic preserves the existing M5 adapter.
Reactive bodies have separate identities and cannot be passed to M5 actor APIs.
This is one-way terrain response: external actor loads,
damage policy and native asynchronous scheduling are further
work. Work budgets bound solver visits, not wall-clock latency; construction,
query validation and copies still have finite whole-domain costs. Native/GPU and
performance verification remain held; legacy demos stay quarantined.

### Executed reactive motion (Build 46)

Request disposable motion observations with `prepareTick({motion: {maxEntries: 8192}})`
on a reactive world/domain owner, or `session.branch({horizonTicks: 1, motion: {}})`.
The standalone tick factories accept the same final options argument. Capture is
disabled by default and never becomes part of a save, ledger or physical result.
After a complete tick, `job.motion()` returns an isolated `reactive-motion-1`
report. Before completion, including after cancellation, it throws.

There are 29 ordered boundaries: 20 movement passes, six heat passes, phase
changes, combustion and structural settlement. Each records changed
packed/energy/structure tuples and executed motion segments. `origin` tracks a
tick-start slot through permutations; it is not persistent matter identity across
transformations or ticks. Movement swaps and falling fragment members are
`linear`; structural displaced occupants are `relocation`, never a swept path
through intermediate cells. Fragment component IDs use the post-damage structural
input. Temporary constraint anchors are stripped from recorded coordinates.

Pass headers, segments and changed tuples each cost one entry. Default budget is
8,192, maximum 65,536; even an unchanged domain needs 29 headers. All reservoirs
share one budget per domain-set tick. Exhaustion clears every retained domain
trace and reports `overflow` with `requiresReexecution: true`, while physics
finishes normally. Disabled capture is also explicit. No partial trace is accepted
as complete. Budgets limit retained observations, not physical work or latency.

Tick reducers receive `movement(domain?)`, privately bound to the same boundaries
as `beforeQueries(domain?)` and `queries(domain?)`. A branch's `lastMovement(domain?)`
exposes only its latest completed tick, or `null` before the first. Observations
include full from/to preview stamps; retained callbacks stay historical after
later ticks or discard. Public records are copies, and cloning a record cannot
forge live provenance. A reducer requiring motion can throw on missing/overflowed
capture to reject the entire ability, including its staged AP/resource changes.

These observations describe simulation ticks only. Translation has separate
per-step receipts; reservoir transfer is a handoff, not travel through space.
Reactive actor carry, debris response and external actor loads remain further
work. Session movement access retains the latest before/after domain snapshots
even when capture is disabled; callers retaining older callbacks retain their
snapshots too. Capture scans each executed pass, and cloning/publication remain
O(cells plus retained entries). No native, GPU or performance acceptance is implied.

### Reactive gameplay queries (Build 45)

`session.queries(domain?)` and `branch.queries(domain?)` provide `fit`, `sweep`,
`raycast`, `support` and `exposure` against an isolated complete physical boundary.
Use `null` or omit the domain for the primary world; a reservoir ID selects stored
matter. Coordinates use 1,024 integer units per voxel. These views reuse the same
fixed-point kernel as existing tactical queries, with the reactive catalog's
active IDs and temperature rules. Default blocking includes solid, frozen and
powder phases. Explicit material filters can target fluids, gases or custom IDs.

Every result carries a `reactive-geometry-1` stamp: domain, world rules, absolute
tick and committed revision or preview base, branch ID, completed commands/ticks
and requested horizon. Views survive later edits, commit, restore and discard as
historical observations. Inactive branches cannot issue new views. Partial swaps
and partial ticks are never visible. A retained preview view does not become a
committed view. Reactive views cannot be passed to the old M5 actor/contact API.

Tick reducers additionally receive lazy `beforeQueries(domain?)` and
`queries(domain?)`, bound to that tick's exact before/after states. For example,
reject an ability by throwing when `queries().fit({box: teammateBox}).fits` is
false; the whole candidate, including earlier AP and thermal edits, is discarded.
Retained query callbacks keep their original boundary even after later ticks.
Returned domain/report objects can be inspected or changed by a reducer without
altering those query views or the physical state.

Support reports contact geometry and exact footprint areas, not load capacity or
future stability. Exposure reports exact overlap volumes, sensible temperatures
(excluding chemical/latent energy), volume-weighted ratios and contiguous liquid
depth at the feet. Cover, health, navigation and fog-of-war remain game policy.

Each query retains the existing 65,536-cell visit budget and integer coordinate
bounds. Capturing/validating a view costs O(domain cells); these are synchronous
CPU observations with no measured latency guarantee. Actor carry/debris response
and responsive native-browser transport remain further integration work. Physics,
save formats and runtime holds are unchanged; legacy demos remain quarantined.

### Atomic reactive ability previews (Build 44)

`createReactiveSession3D(registry, {worldId, gameRulesVersion, domains, game}, policy?)`
owns a reactive domain set plus application state. Use the reactive-materials public
entry. The separate schema 1 / `reactive-session-1` save includes those identities,
revision, all physical domains, bounded portable game data and exact decimal energy
accounting. Game copying reuses the existing bounded tactical data copier: finite
numbers and plain JSON data, no cycles, holes, functions, accessors or hidden fields.
Keep RNG, unit state, action points and resource balances in `game`.

```js
const preview = session.branch({horizonTicks: 4});
preview.enqueue({kind: 'game', game: {...session.snapshot().game, ap: 1}});
preview.enqueue({kind: 'translate', domain: null,
  request: {cells: [[2, 1, 0]], path: [[0, -1, 0]]}});
// At application-controlled scheduling boundaries, until status is ready:
preview.advance(64);
// Inspect the complete candidate before deciding:
const candidate = preview.inspect();
// Once ready, commit exactly that result or preview.discard():
const committed = session.commit(preview);
```

Each branch identifies its starting world/revision/tick, requested horizon and
completed commands/ticks. Up to four live branches can own ordinary snapshots.
Horizons are 0–64 ticks. Queue at most 256 commands and 65,536 data nodes / 1,048,576
characters in total. Commands are `edit`, `translate`, `transfer`, `hold`,
`releaseHold` and `game`; domain IDs follow the domain-set convention. All input is
owned on enqueue. First advance seals the command list. Commands execute in order,
followed by exactly the requested number of synchronized physical ticks.

An advance performs one command boundary, existing translation/transfer/kernel
slice, preparation, or final validation. Transfer and graph work accept budgets
1–256; full validation, copying and publication still take O(total cells).
Inspection returns only complete private boundaries, never partially swapped
matter or a primary tick whose reservoirs are unfinished. `lastBoundary()` retains
only the most recent completed command receipt or tick report, with a monotonic
sequence. Read and retain it at boundaries if the game needs a full action history.
No latency, copy-on-write or browser responsiveness claim follows from these caps.

`reduceTick({game, domains, report})` optionally computes the next game state from
each complete physical tick. `validateGame(snapshot)` must return exactly `true`
for accepted initial/restored state and final candidates, including commit.
Callbacks are captured at construction and receive isolated data. They must be
pure and synchronous; store randomness in the saved game data. Promise results,
exceptions, nonportable output and swallowed SDK reentry fail the transaction.
The engine can roll back its own state, not effects a callback causes elsewhere.

Only ready candidates from this session and its unchanged revision can commit.
Commit publishes the already-computed domains, game and accounting together; it
does not repeat physics or the tick reducer. A successful commit stales siblings.
Failed commands/policies and explicit discard release their branch capacity and
leave committed terrain, holds, reservoirs, game resources and revision unchanged.
This supports multi-command ability rollback. Actor/terrain contacts still need
their own integration; storing unit coordinates in game data does not solve them.

`createReactiveSessionSnapshot3D` and `readReactiveSessionSnapshot3D` manage the
portable save envelope. `restore` requires matching world/game-rules identities,
catalog and domain topology, restores saved accounting history, increments the live
revision and stales existing candidates. This session restore preserves accounting;
standalone world/domain restore still establishes a fresh baseline as documented.
Revision is an instance-local concurrency stamp, not a globally unique physical
coordinate. Preview wrappers are distinct from saves. Public observations are
isolated copies. `energyBalance()` exposes combined initial/external/current energy
and drift. Native/GPU, large-world replay and benchmarks remain held.

### Conservative reactive reservoirs (Build 43)

The reactive-materials entry exports `createReactiveDomainSet3D(registry, world,
reservoirs?)`. Supply reactive world snapshots; each reservoir is `{id, world}`.
`null` identifies the primary world, while strings identify reservoirs. The set
owns one revision and one absolute tick across at most eight domains and 65,536
cells total. Each world retains its existing 32,768-cell bound and v1/v2 format.
Reservoirs use the same catalog and physics as the primary world. Closed boundaries
separate their matter and heat except during explicit transfers or energy edits.

`createReactiveDomainsSnapshot3D` and `readReactiveDomainsSnapshot3D` create/validate
the separate schema 1 / `reactive-domains-1` format. Save its exact catalog too.
The reader checks combined geometry before copying material arrays, owns all data
and canonicalizes reservoir IDs. Domain-set restore requires the original IDs and
dimensions, restores every domain together, establishes a new combined energy
baseline and invalidates previous jobs. Individual world saves do not silently
become domain-set saves.

```js
const candidate = domains.prepareTransfer({
  from: null, to: 'flask', cells: [[2, 1, 0], [3, 1, 0]], offset: [-2, 0, 0],
});
// At application-controlled scheduling boundaries:
candidate.advance(64); // At most 64 pairs; max 256. Publication is a separate call.
// Once candidate.progress().status === 'complete':
const receipt = domains.commitTransfer(candidate);
```

`createReactiveTransferJob3D` provides the same `reactive-transfer-1` operation
directly from a saved domain set. Source coordinates plus one integer offset map
selected existing matter into the destination. Each pair swaps all three state
coordinates: material/thermal state, conserved energy and structure. Displaced air
returns to the source with its own heat. No destination occupant is deleted.
Selection is limited to 32,768 unique non-air cells. Internal bonds, damage and heat
survive; external bonds and permanent anchors require explicit `externalBonds: 'cut'`
and `anchors: 'release'`. Default displacement admits only air; `'mobile'` also
admits unbound material using the same catalog-aware law as reactive translation.
Selected or displaced held matter requires explicit hold release first. No new
bonds are created on contact.

Transfer receipts identify both domains, paired source/destination indices,
explicit cuts/releases, each domain's actual net changed cells, equal/opposite
internal energy deltas and zero external energy. Correspondence remains present
for exchanges with identical endpoint values. Transfer describes a domain handoff,
not a swept path through intervening terrain. Within a domain, use
`prepareTranslation(domainId, request)` / `commitTranslation(job)` instead.

`prepareTick()` makes a synchronized tick job. Each advance prepares one domain,
advances one existing world-kernel slice, or performs final publication. All domains
run the same next absolute tick; results remain private until every domain completes.
`commitTick(job)` publishes the set once. Stored fuel still burns and holds still
expire. Cancellation or a late transfer failure discards private work without
changing any live domain. Successful transfers, translations, ticks, edits, holds
and restores invalidate older jobs; commits reject foreign, stale or consumed jobs.

`edit(domainId, edits)`, `hold(domainId, request)` and `releaseHold(domainId, id)`
stage one domain before publication. Their receipts identify the changed domain;
`energyBalance()` accounts external edits over the whole set. `snapshot()` and
`domain(id)` return isolated copies. Validation, copying, reports and publication
remain O(total cells); swap/graph budgets do not guarantee wall-clock latency.
Applications must pace work and limit outstanding requests. Game resources, actors,
preview scheduling and rendering are not yet part of this domain-set transaction.
Native/GPU and performance checks remain held; legacy demos remain quarantined.

### Saved temporary holds in reactive worlds (Build 42)

`world.hold({id, expiresAtTick, cells: [[x,y,z], ...]})` holds existing cohesive
solid/frozen matter in place. `world.holds()` returns isolated records;
`world.releaseHold(id)` explicitly releases one. Each successful operation changes
the live revision without advancing time, repairing material or adding energy.
Unknown releases and invalid requests leave the world and prepared jobs unchanged.
Game ability costs remain application policy.

Holds are disjoint, with at most 64 records, 32,768 total held cells and 1,024 ticks
of future lifetime. IDs use 1–128 ASCII letters/digits or `._:/-`, beginning with
a letter/digit. An expiry of E constrains ticks with input tick less than E: the
E−1 → E tick still holds the material, the completed E save contains no expired
hold, and the next tick can move it. Saved expiry is absolute, so restore never
grants a new lifetime. Integrity can reach zero while the matter stays held.

Adding a hold explicitly creates schema 2 / `reactive-world-2`, carrying
`holdRulesVersion: 'reactive-holds-1'` and canonical hold records. Existing default
construction and schema 1 / `reactive-world-1` reads remain unchanged.
`createConstrainedReactiveWorldSnapshot3D(registry, block, tick?, holds?)` explicitly
creates the new format; its hold members are linear indices. The common snapshot
reader accepts either exact format and rejects mixed identities or invalid holds.
Removing the last hold retains v2. Restoring a v1 save explicitly restores its
unconstrained state. Save the catalog alongside either format.

Temporary anchor bits exist only in private movement/support inputs. Canonical
snapshots retain their original permanent-anchor semantics. Heat, phase changes,
combustion and damage continue. A transformed member loses its hold before that
tick's structural solve, allowing even distant dependent structures to fall.
Placement retires the replaced held identity even if it writes identical values;
energy, integrity, bond and permanent-anchor edits preserve the hold. Translation
rejects selected or displaced held matter until explicitly released; the separate
`anchors: 'release'` policy cannot release temporary holds.

V2 tick reports add `holds` with before/after records, expired IDs, transformed
members and the effective held cells for movement and structure. Nested component
reports describe their private effective anchor inputs; top-level `changedCells`
describes canonical block changes. An expiry or explicit hold change can leave
that block diff empty, so consumers must also observe holds and revision changes.
All returned reports and saves are isolated from the committed state.

These are finite positional constraints, not a force or velocity model. Existing
bounded graph slices remain; full-block validation, copies and publication still
take O(cells). Application/actor transactions need further reactive-world
integration. Native/GPU verification and performance remain held.

### Existing-matter control in reactive worlds (Build 41)

`world.prepareTranslation(request)` creates an isolated `reactive-translation-1`
job. Advance it once per application-controlled boundary, then call
`world.commitTranslation(job)` when complete. `createReactiveTranslationJob3D`
provides the same operation directly from a reactive snapshot. A request specifies
existing `cells: [[x,y,z], ...]` and a `path` of cardinal unit vectors. Empty, air or
duplicate selections and malformed paths reject. Limits are 32,768 selected cells,
384 steps and 262,144 selection × (path + 1) entries; input/world validation is
bounded by the reactive block limit.

Each advance processes one complete path step, followed by a separate final
validation/publication call. The selected matter retains its packed state, exact
energy, integrity and internal bonds. Contiguous selected runs rotate with their
terminal occupants, including overlapping destinations, conserving all matter.
Control does not repair, cool, create terrain, advance physical time or auto-weld.
The next ordinary world tick applies the same movement, heat, reactions and support
rules to the translated matter. Unconstrained lifted fragments can fall again.

The default `externalBonds: 'reject'` requires explicit cuts; `'cut'` removes only
links crossing the selection. `anchors: 'reject'` requires explicit releases;
`'release'` removes only selected permanent anchors. `displacement: 'air'` admits
only air. `'mobile'` also admits gases, powders, fluids and fully failed unanchored
cohesive debris according to the active catalog. Intact or anchored structures and
fixed noncohesive solids/frozen matter obstruct the path. Explicitly selecting
existing matter for control is separate from allowing it as a displaced occupant.
Joining surfaces still requires explicit bond edits.

Every intermediate destination is checked, so a clear endpoint cannot tunnel
through an obstacle. Cancellation or a late obstruction discards all earlier
private moves, cuts and releases. Input requests, snapshots and outputs are owned.
World commit requires the same instance and unchanged starting revision and consumes
the job once. Tick/translation commits, edits and restore invalidate earlier jobs;
reentrant preparations reject without changing terrain or accounting. Thermal
external energy remains unchanged; range, force/ability cost and action resources
belong to the game.

Receipts include selected original/final positions, explicit cuts/releases, exact
net changes, zero external energy and complete energy totals. Each step records
selected spatial sources/destinations in original-selection order and terminal
occupant moves with original identities. The combined correspondence covers all
matter, with touched spatial cells/origins retained even for round trips that end
unchanged. Terminal occupants rotate directly to run heads: this record does not
claim they physically swept through the selected slab. Future structural effects
come from subsequent tick reports; actor paths/contacts require their own coupling.
An unmoved neighbor affected only by an explicit bond cut appears in `changedCells`
and `cutBonds`, not in the movement touch lists.

This is bounded full-step CPU work, not measured latency or GPU parity.
Application/actor transactions still need integration with the reactive world.
Existing M5 contracts and legacy-demo quarantine are intact.

### Owned reactive worlds (Build 40)

The reactive-materials entry now exports `createReactiveWorld3D(registry, block,
tick?)`. It owns a complete CPU world, with `snapshot()`, `tick`, instance-local
`revision`, `edit(edits)`, `prepareTick()`, `commitTick(job)`, `restore(snapshot)`,
`energyLedger()` and `energyBalance()`. Dimensions remain fixed. Public reads and
inputs are isolated. Every successful edit (including a no-op), tick commit and
restore increments the live revision. Revision is not a saved physical coordinate
or a globally unique world identity; compare it only within the owning instance.

`reactive-world-1` freezes a tick as the existing 28 `reactive-evolution-1` passes,
then one complete `reactive-structure-1` solve. Thus a burned or melted support can
release its bridge during the same tick. Existing component schedules are not
modified or implicitly upgraded. A prepared job never changes the committed world:

```js
const candidate = world.prepareTick();
while (candidate.progress().status === 'running') {
  candidate.advance(64);
  await new Promise(resolve => setTimeout(resolve, 0));
}
const receipt = world.commitTick(candidate);
```

Commit requires a complete, uncancelled job issued by that same world at its
current revision. A successful commit consumes its capability. Edits, restores
and sibling commits invalidate earlier jobs; recompute them from the current
snapshot. Invalid or reentrant mutations leave state, revision and accounting
untouched, including when a caller swallows a nested rejection. Terrain commit
does not yet include application actors, AP, resources or multi-tick commands.

Jobs expose `progress()`, `advance(structuralWork = 64)`, `cancel()` and isolated
`result()`. Each call performs one evolution pass, structural preparation, a
1–256-unit graph slice, or final publication. Full-block evolution, validation,
allocation, result copying and report composition remain O(cells), capped at
32,768 cells. The graph work cap is not a universal per-call latency guarantee.
Cancel before final publication to discard staged work; partial jobs are not saves.

`createReactiveWorldSnapshot3D`, `readReactiveWorldSnapshot3D` and
`createReactiveWorldTickJob3D` also support pure snapshot-in/result-out execution.
Snapshots contain the separate schema/rules identity, absolute tick and complete
catalog-bound block. Save the exact catalog alongside them. Restore validates all
coordinates, resets the energy baseline, and invalidates previous jobs even when
restoring identical cells. Existing block, evolution and M5 snapshots are not
silently imported. Edits charge complete external energy, including chemical fuel;
simulation ticks require zero drift.

Tick reports include from/to ticks, original-to-final matter moves, touched original
matter, touched spatial cells, net changes and exact energy totals. Executed motion
that returns to its origin remains touched. Matter correspondence is composed across
movement and settlement, including displaced fluid. The nested evolution report
uses tick-start identities; its reactions index the post-movement block. Structural
arrays index the complete post-evolution input. The owning commit adds from/to live
revisions. Distant component effects are retained, but these are whole-block reports,
not compact world deltas, swept actor paths or persistent fragment identities.

Acceptance currently covers tiny CPU worlds and exact eight-tick restart trajectories.
Large-world/M5 replay, native/GPU checks and benchmarks remain held. Integrating this
catalog and world with tactical actors, temporary constraints, branch transactions
and the renderer remains further work; legacy demos stay quarantined.

### Bounded reactive structural mechanics (Build 39)

`state-space-engine/experimental/3d/reactive-materials` exports
`createReactiveStructureJob3D(registry, block)` under `reactive-structure-1`.
It consumes an isolated, validated complete reactive block and produces a new
block plus a whole-block support/motion report. It does not advance an evolution
tick, change M5, or implicitly run when calling the existing evolution API.

Call `advance(maxWork)` with an integer from 1 to 256 (default 64), yielding to
the application between calls. Each work unit visits one cell with at most six
neighbors, or one blocking dependency edge; the complete solve uses at most
`20 * cells + 16` units. Constructor validation/allocation and `result()` copying
are O(cells), bounded by the 32,768-cell block limit, and outside this work-unit
claim. This is an operation bound, not a measured wall-clock latency guarantee.
`progress()` exposes stage, status and completed work; `cancel()` discards staged
work. `result()` returns isolated data only after the complete solve.

The frozen schedule is support roots and complete BFS, weight initialization,
reverse-BFS load distribution, one damage application, reciprocal bond pruning,
complete bonded components, blocking dependency propagation, and one-cell
downward settlement. Roots are anchors, the closed floor, or contact with an
inactive obstacle. Unbonded vertical contact carries weight; horizontal or
suspended support requires explicit bonds. Density determines weight and fluid
displacement. Noncohesive solid/frozen cells and explicit anchors obstruct motion
even with zero integrity. Surviving bonds and damage travel with each fragment;
the operation never auto-welds or repairs.

Weight is `max(1, ceil(density / 64))`; cohesion capacity is `cohesion * 16`,
scaled first by integrity with integer flooring, then by thermal strength with
another floor. Nonzero softening fades strength linearly over 64 thermal units.
Excess load removes `max(1, floor(excess * 255 / nominalCapacity))` integrity,
clamped to the remaining integrity; zero capacity removes it all. Loads split
equally among shortest-path supports, with integer remainders assigned in global
index order. Root reactions must sum to supported weight. Damage applies once,
not repeatedly to convergence. Failed cells lose bonds, retain explicit anchors,
and are left for later loose-material movement. No force/velocity or actor loads
are introduced.

Reports carry rules and catalog identity, pre-damage support distances, loads,
capacities and reactions, post-damage component IDs in input coordinates, broken
and moving source cells, canonical source-to-destination moves including displaced
matter, net changed cells, and exact energy totals. A component ID is its minimum
input index. The solver visits the whole block, including distant bridge members;
this report is not a revision-stamped world delta or a swept actor path. Results
must be identical across work budgets. Save/restart uses the returned complete
block and the exact material catalog; partial jobs are disposable and not saves.

Initial acceptance uses tiny CPU fixtures, including burning/melting supports.
Full structural-world integration, native execution, GPU parity, large-world
replay and latency measurements remain pending. Legacy demos remain quarantined.

### Conservative reactive movement (Build 38)

The reactive-materials entry also provides `reactive-evolution-1`, which composes
twenty `reactive-movement-1` passes with the eight reaction passes below. It is a
local CPU material component with a complete tick boundary. It does not run global
structural support, pressure or actor contact, and does not change existing M5
world rules. Those integrations still need their own acceptance evidence.

```ts
import {
  createReactiveEvolutionState3D, createReactiveEvolutionJob3D,
  readReactiveEvolutionState3D, advanceReactiveEvolution3D,
} from 'state-space-engine/experimental/3d/reactive-materials';

const committed = createReactiveEvolutionState3D(registry, block, 0);
const candidate = createReactiveEvolutionJob3D(registry, committed);
while (candidate.progress().status === 'running') {
  candidate.advance(); // Exactly one pass; the host may yield/cancel here.
}
const {state: next, report} = candidate.result();
const restored = readReactiveEvolutionState3D(registry, JSON.parse(JSON.stringify(next)));
const following = advanceReactiveEvolution3D(registry, restored); // One complete tick.
```

There are exactly **28 passes**. Movement executes gravity Y even/odd, four
downward diagonals (each Y even/odd), blocked liquid spreading X/Z even/odd,
buoyancy Y even/odd, then blocked gas spreading X/Z even/odd. The four diagonal
directions start as +X, −X, +Z, −Z and rotate by `tick % 4`. Horizontal axes run
X then Z at even ticks and Z then X at odd ticks. Gravity points toward +Y.
All exchanges use disjoint pairs and immutable input per pass, including diagonal
passes. Closed boundaries support odd rectangles and singleton dimensions.

Powders, liquids and fully failed unanchored cohesive solids can descend into
lower-density movable material. A directly available descent suppresses diagonal
movement; any downward route suppresses liquid spreading. Intact or damaged solids
and anchored remnants stay owned by the mechanical layer. Noncohesive solid/frozen
phases remain fixed obstacles even though their structure word is zero. Movement
cannot repair damage, cut bonds, or weld neighboring cells.

Gas rank is `2*floor(temperatureQ/256) - density`. Non-air gas rises into gas only
when its rank exceeds the destination by more than 16. Blocked gas may spread
laterally into air or sufficiently lower-ranked gas. Pair orientation uses the
following u32 integer hash and the low 32 bits of the absolute tick:

```ts
let h = (Math.imul(index, 374761393) + Math.imul(axis, 668265263)
  + Math.imul(tick >>> 0, 1442695041)) >>> 0;
h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
const firstEndpointIsSource = ((h ^ (h >>> 16)) & 1) === 0;
```

Here `index` is the first endpoint of the disjoint pair. `reactive-movement-1`
freezes this choice. `reactiveMovementSchedule3D(tick)` returns
the immutable schedule. `runReactiveMovementPass3D(registry, block, tick, index)`
is an isolated diagnostic pass with exact swaps; it is not a complete tick.

Every swap transports material/thermal/phase, conserved energy and structural state
together. Reactions then run at the same absolute tick under their unchanged rules.
The staged job owns inputs, cancels at any incomplete boundary, and exposes no
partial state. Terminal jobs cannot advance. As with reaction jobs, the 32,768-cell
limit bounds each pass; wall-clock latency has not been measured.

The complete report identifies rules/catalog and from/to tick, with canonical
`changedCells` and `touchedCells`. `movement` includes `swapCount`, final
`moves: [{from,to}]` sorted by original cell, and `touchedOrigins`. These come from
executed exchanges, not endpoint differences: a parcel that returns to its start
still appears in touched origins. Both displaced occupants are tracked. Reactions
preserve the arriving cell's origin for this report while changing its material;
the nested `reactions` report describes those transformations and energy totals.

This report is observational. It is not a swept path for actor collision, a world
revision/commit permit, or proof of distant structural support reach. Applications
must retain its originating state/transaction context. Evolution saves include a
tick and catalog-bound block and reject reaction-only or M5 saves explicitly.

### Exact local reactive cycles (Build 37)

The reactive-materials entry now also exports the `reactive-reactions-1` CPU
kernel. It evolves heat, phases and combustion in a bounded material block.
Movement, pressure and structural support belong to the surrounding world solver;
this kernel does not advance an M5 tick or change any existing world contract.

```ts
import {
  createReactiveReactionState3D, createReactiveReactionJob3D,
  readReactiveReactionState3D, advanceReactiveReactions3D,
} from 'state-space-engine/experimental/3d/reactive-materials';

const committed = createReactiveReactionState3D(registry, block, 0);
const job = createReactiveReactionJob3D(registry, committed);
while (job.progress().status === 'running') {
  job.advance(); // One bounded pass. A host may yield/cancel between these calls.
}
const {state: next, report} = job.result();
// Or execute one complete local cycle synchronously:
const same = advanceReactiveReactions3D(registry, committed);
const restored = readReactiveReactionState3D(registry, JSON.parse(JSON.stringify(next)));
```

Jobs own their inputs. `advance()` executes one of exactly eight passes;
`result()` throws until the complete cycle validates. `cancel()` discards an
incomplete candidate and returns true once; it returns false for terminal jobs.
Advancing a cancelled or complete job throws. Results and progress objects are
isolated copies. Each pass is bounded by the block's 32,768-cell limit, but no
wall-clock latency guarantee is implied. A host should schedule passes on its
worker and yield at these boundaries; creating a job does not start a worker.

The frozen schedule is X-even, X-odd, Y-even, Y-odd, Z-even, Z-odd heat exchange,
then one phase pass, then simultaneous combustion/fire extinction. All passes
read immutable input and use existing exact integer thermodynamics. Boundaries
are closed. Phase changes preserve chemical energy and total energy. The cycle
counter is a nonnegative safe integer; advancing past its maximum rejects.

Fuel ignites only above its catalog flash temperature and next to a catalog
oxidizer. Direction IDs are −X, +X, −Y, +Y, −Z, +Z. At cell `(x,y,z)`, priority
starts at `(x + 2*y + 3*z + cycle%6)%6` and wraps through all six directions.
Each hot fuel proposes to its first oxidizer; each oxidizer chooses its first
proposing neighbor. Only these mutual pairs react, so neither cell reacts twice.
The fuel becomes `burns_into`; the oxidizer becomes `smoke_product`. Transfer to
the oxidizer is `min(floor(fuel_energy*256/2), MAX_ENERGY_Q - oxidizer.energyQ)`.
Remaining chemical energy becomes sensible/latent energy through the product
identity, with no external energy creation or loss. Saturation reduces transfer,
not total conserved energy.

Existing builtin fire becomes builtin smoke when it has no adjacent fuel, touches
builtin water, or is below 80 temperature units. These decisions use the input to
the combustion pass, so newly produced fire lasts until at least the next cycle.
Fire transfers its stored heat; it is not an unlimited heat source. Custom fuel
and oxidizer properties use the same pairing rules; the fire/water/smoke roles
are the explicitly named builtin identities.

Unchanged solids retain damage, anchors and bonds. Solid-to-solid phase changes
also retain that history. Melting or burning removes invalid reciprocal links,
including surviving neighbors' bits. Newly solidified or chemically produced
solids have integrity 255, no anchors and no automatic joins. Joining a newly
frozen surface is an explicit surrounding-world policy; this kernel cannot
silently weld controlled material into adjacent terrain or solve its support.

Reports carry catalog/rules identity, from/to cycle, sorted changed cells,
phase-change and extinction cells, and reacting pairs in ascending fuel-index
order. Pair entries include exact transferred energy. Energy totals and chemical
totals are decimal strings; external energy and drift are both zero. Reports
include bond changes at neighboring cells. Saves retain the absolute cycle and
catalog-bound block; portable catalog definitions are saved separately as below.
This is local reaction continuation, not proof of integrated world replay.

### Reactive material definitions and portable blocks (Build 36)

`state-space-engine/experimental/3d/reactive-materials` supplies the separate
`reactive-materials-1` catalog and `reactive-material-block-1` data contracts.
They establish wood, fuel, fire, smoke and validated custom material data.
The block construction/edit functions do not advance time; use the local reactive
cycle API above for thermal reactions. M5 worlds
continue to accept their original materials and saves.

```ts
import {
  createReactiveMaterialRegistry3D, createReactiveMaterialBlock3D,
  editReactiveMaterialBlock3D, readReactiveMaterialBlock3D,
  reactiveMaterialEnergyLedger3D, MAT,
} from 'state-space-engine/experimental/3d/reactive-materials';

const builtin = await createReactiveMaterialRegistry3D();
const registry = await builtin.extend([{
  ...structuredClone(builtin.material(MAT.WOOD)), id: 200, name: 'resin',
}]);
const air = createReactiveMaterialBlock3D(registry, {width: 3, height: 1, depth: 1});
const {block, receipt} = editReactiveMaterialBlock3D(registry, air, [
  {kind: 'place', x: 0, y: 0, z: 0, material: 200, thermal: 210},
  {kind: 'integrity', x: 0, y: 0, z: 0, integrity: 73},
]);
// Construction supplies thermal + phase + chemical energy; debit the game here.
const externalEnergyQ = BigInt(receipt.externalEnergyQ);
const ledger = reactiveMaterialEnergyLedger3D(registry, block);
const saved = JSON.stringify({catalog: registry.toCatalog(), block});
const decoded = JSON.parse(saved);
const restoredRegistry = await createReactiveMaterialRegistry3D(decoded.catalog);
const restoredBlock = readReactiveMaterialBlock3D(restoredRegistry, decoded.block);
```

Registry reads are isolated, records immutable, and catalog inputs are owned
before asynchronous SHA-256 hashing. The hash includes the profile's schema/rules,
the entire property catalog and sorted active IDs; `sourceCatalogHash` identifies
the underlying property catalog. Transition and combustion destinations must be
active. Defaults include 17 physical builtins and exclude the player marker.
Custom additions retain the existing property ranges, phase-energy and fuel
validation. The full property catalog still includes builtin definitions, even
when a smaller active profile uses only some of them.

Blocks have positive integer dimensions at most 128 on each axis and 32,768 cells
in total, indexed `x + width * (y + height * z)`. The three plain arrays hold
packed material/thermal/phase, conserved `energyQ`, and structural state. Velocity,
flags and reserved structural bits must be zero. Structural eligibility uses the
profile's cohesion; bonds must be reciprocal, in bounds and between intact solid
or frozen cells. Malformed reads fail without normalization or repair.

Edit lists contain at most 4,096 commands: `place`, `energy`, `integrity`, `anchor`
or `bond`. `energy` sets absolute conserved energy; it cannot reduce energy below
the material's chemical fuel floor. It updates the thermal view, preserving
material, damage and bonds; phase changes wait for a reactive cycle. `place`
creates fresh matter and clears old connections, including reciprocal neighbor
bits. New intact solids have integrity 255 and no anchors or bonds. `bond` uses
directions −X, +X, −Y, +Y, −Z, +Z (0–5); joining is explicit. Zero integrity cuts
connections but retains explicit anchor state. `INTEGRITY_3D`, `ANCHOR_3D` and
`BONDS_3D` expose the packed structural masks.

Edits return a new block and a receipt with exact signed decimal `externalEnergyQ`
and sorted unique `changedCells`, including changed neighbors. Failed edits
publish nothing; input arrays remain unchanged. Ledgers return BigInt
`sensibleQ`, `latentQ`, `chemicalQ` and `totalQ`. Receipts describe this operation;
applications own cumulative accounting and action costs. Construction is not a
state-preserving transfer operation.

This entry has no worker, GPU, rendering, global support or M5-world API. The local
evolution API above supplies conservative movement and reactions as a separate
component.
A block is not a simulation save and does not carry an absolute tick. Full reactive
world physics, integration and replay require a surrounding versioned solver and
their own acceptance evidence. Existing M5 and tactical-session readers reject
these blocks; there is no implicit migration.

### Terrain-driven actor peer contacts (Build 35)

`createTerrainActorGroup3D(before, after, tickMovement)` and
`createTranslatedActorGroup3D(before, after, translationMovement)` expose the
`terrain-actor-group-1` contract through the tactical-session entry. They use the
unchanged individual terrain responses, then check simultaneous body trajectories
through the observed passes. The earlier `terrain-body-group-1` API remains
available with its original independent-body semantics.

Call `resolve(namedBodies, options)` with the existing group budgets. Terrain
response and peer detection share `maxWork`; `peerWork` identifies the added work.
Positive interior overlap yields `status: 'unresolved'`, `reason: 'peer-contact'`
and an exact `peerContact` containing actor IDs, pass, reduced rational time and
normal. Initial overlap has a null pass and zero normal. Equal times choose the
ASCII-ordered actor pair. Tangential contact and touching only at a pass endpoint
are allowed. Budget exhaustion yields `incomplete` / `peer-budget`, without a
partial contact. Both outcomes return all original bodies and no response prefix.
An individual terrain failure retains `failure` and uses `terrain-response`.

Detection uses private piecewise trajectories, including delayed pushes, clipping
and direction changes; endpoint separation alone is insufficient. No actor
momentum exchange, pushing, health or knockdown is implied. Applications must
either reject the complete command or supply an explicit higher-level response.
The chamber adopts rejection under `hot-slab-game-4`; earlier chamber saves
reject. Physical coupling, native interaction and performance remain held gates.

### Chamber wind and translation continuity (Build 34)

`followTranslatedMaterialTransport3D(before, after, movement, memory)` follows
saved parcel identities through a live, bound translation observation. Use it in
the session's `reduceTranslation` policy alongside actor responses. It includes
terminal gas displaced behind a moving region, even when source and destination
cells have identical values. Complete private provenance is required; cloned,
foreign, incomplete or mismatched observations reject. Returned memory owns its
data and preserves transport cycle, velocity and fractional displacement.
`followMaterialTransport3D` remains the complete-material-tick counterpart.

Build 34 introduced `hot-slab-game-3` saves with three initially controlled
steam/water/sand parcels; the current chamber requires v4 as described above.
`wind` adds one 512-Q impulse to a selected
parcel; `drift` adds none. Both cost one AP and advance all remaining controls one
explicit transport cycle, then the requested environmental horizon. That horizon
follows ordinary material provenance without repeating the intervention. All
controlled parcels must be within six Manhattan cells of the scout. Labels track
original identities, so condensed steam remains the same parcel; solidification
retires control and does not create replacement matter. Prior chamber save rules
reject explicitly. AP, turn, controls, terrain and actors commit atomically.

This is a bounded intervention model, not continuous wind or a fluid momentum
solver. Native interaction, actual material trajectories and performance remain
held acceptance gates. The UI runtime guard and legacy quarantine remain active.

Version 0.4 exposes the ca-v4 material engine in Python, browser WebGPU, and
browser/Node CPU. These backends use the same catalog identity, complete snapshot
format, and pass schedule. The GPU backends require a usable GPU adapter.

## Install and run an external client

The current bounded external-package check is `npm run verify:packages` after
`npm run build:sdk`. On macOS, `uv run python -m scripts.verify_packages --native`
also compares the installed Metal and JavaScript clients. The verifier uses a
fresh Python environment, imports all 13 npm export paths and checks their public
declarations. WebGPU types are included as a package dependency. See the
[current support matrix](VALIDATION_STATUS.md) for experimental boundaries.


From the development checkout:

```powershell
uv build --wheel --out-dir dist/packages
npm pack --pack-destination dist/packages
```

Install the resulting wheel in a Python environment, or the npm tarball in a
JavaScript project. The npm package is private to prevent accidental publication;
local packing and installation are supported. Python runtime requirements are
NumPy and wgpu 0.31.x. Evolution tools and the GLFW viewer are optional extras.
Generation and package building use the development checkout; runtime clients
do not need Node.js for Python, source WGSL paths, or the generator.

`examples/sdk/native.py` and `examples/sdk/node.mjs`, together with `materials.json`,
are complete external clients. `python scripts/verify_sdk.py` builds and installs
both packages into temporary directories outside the checkout, executes the
clients, compares every reported change and final state, and compiles external
TypeScript clients with both installed compiler versions.

## Python field

```python
from engine import create_field

with create_field(64, 48) as world:
    world.set_cell(20, 10, 2, thermal=25)  # water
    world.set_cell(21, 10, 4, thermal=255)  # finite fire
    reports = world.step(16, inspect=True)
    print(world.sample(20, 10), world.energy_balance().drift_q)
    saved = world.snapshot().to_dict()
    world.restore(saved)
```

`create_field` accepts `fill_material` and a validated `registry`. `set_cell`,
`paint_circle`, and `set_energy` record the actual replacement energy as external
input/output. Energy can exceed the display byte's range. `clear` and `restore`
establish a fresh accounting baseline. Mutations are validated before commitment.
`snapshot()` returns immutable storage; `grid`, `energy_q`, and `structure` return independent
copies. Use a context manager or `close()` to release an owned GPU device. An
explicitly supplied `CompositionEngine` is borrowed and remains its owner's
responsibility. Read-only inspection of the last state remains available after
close; further mutations fail.

## Browser and Node fields

```typescript
import { createStateSpaceField, createGpuField, MAT } from 'state-space-engine';

const cpu = createStateSpaceField(64, 48, MAT.AIR);
const gpu = await createGpuField(64, 48);
gpu.setCell(20, 10, MAT.WATER, 25);
await gpu.step(16);
cpu.restore(gpu.packedSnapshot());
console.log(cpu.sample(20, 10), cpu.energyBalance().driftQ);
gpu.close();
cpu.close();
```

The CPU field's `step` is synchronous. WebGPU `step` is asynchronous: await it
before editing, sampling, saving, closing, or stepping the same field again.
Concurrent access is rejected. A failed GPU step retains the last committed
host state; each retry uploads that complete state. WebGPU errors propagate to
the caller. There is no automatic switch of backend.

WebGPU snapshots and samples reflect the last completed step. This SDK currently
reads all three GPU coordinates after every tick for the host structural planner.
Inspection adds readbacks after every pass. This is a hybrid host/GPU backend;
complete tick timing includes planning and transfers. C6 records its supported
scale, and C5 measurements describe the earlier ca-v2 contract.

The standalone ESM build is `dist/sdk/state-space.js`. An HTML import map can map
`state-space-engine` to that file without a bundler. Serve
`examples/sdk/browser.html` over localhost to try the public API and compare the
CPU and GPU implementations. WebGPU and custom-registry hashing need browser
secure-context APIs; Node's CPU backend uses its built-in Web Crypto.

## Extend materials without forking physics

Python `MaterialRegistry(catalog)` and asynchronous JavaScript
`createMaterialRegistry(catalog)` validate complete catalogs. Start from
`DEFAULT_REGISTRY.to_dict()` / `toCatalog()`, or call `extend(records)` to add
complete material records. The sample extension adds copper, molten copper,
resin fuel, and material ID 255 as copper grit.

IDs 0-17 retain their version-2 names. IDs 18-255 can hold extensions. Existing
properties may be changed in a new registry, but any change to properties,
defaults, names, or colors changes the catalog hash. Material ordering and JSON
object-key ordering do not. Registries copy input before validation/hashing and
do not expose writable authoritative arrays. A world keeps its registry for its
entire lifetime. Create another world to use another registry.

A snapshot carries the registry hash, not its full definition. Supply the exact
registry when restoring it. Reconstruct a registry from its exported catalog on
the receiving side; the hash will agree across Python and JavaScript. The default
registry cannot restore custom-registry snapshots, even if the scene happens to
contain only built-in IDs. A property change also makes snapshots incompatible.
No implicit reinterpretation or migration is performed.

Phase families require monotone phase energy, matching latent heat, preserved
fuel/oxidizer identity, correct reverse targets, and separated reverse thresholds.
Combustion requires valid inert products. Undefined targets, malformed numeric
values, missing properties, duplicate identities, and layout changes are rejected.
Materials customize existing physical rules; this is not arbitrary shader-plugin
loading. Existing special handling of air, fire, water, and smoke retains its
built-in identity. Reserved phase/flag values do not create new physical laws.

## Inspect behavior and accounting

Pass reports contain the absolute tick being processed, pass ID, changed cell
indices, before/after packed cells, energy and structure, and before/after component ledgers.
Changes include cells whose energy changes while their display byte stays the
same, and changes confined to bonds or integrity. Replaying the changes reconstructs the full state. Reports are immutable
and cannot alter the simulation. Their aggregate energy delta must be zero for
closed-system physics; external edits are tracked by the field's energy balance.

Collect reports with `step(..., inspect=True)` in Python or
`step(..., {inspect: true})` in JavaScript. Collection is opt-in: storing cell
deltas and synchronizing GPU pass readbacks adds significant time and memory.
The tick identifies the input tick; a complete tick advances the public counter
only after all scheduled passes finish.

Cell edits use integer coordinates and ignore valid placements outside the grid.
Invalid material/energy/coordinate values still fail validation. Sampling floors
finite coordinates in the safe numeric range and clamps them to the grid. Circle painting accepts finite
geometry in the safe numeric range and a nonnegative radius. These conventions
are shared by the native and browser APIs.

Physical units and approximations are specified in `ENGINE_CONTRACT.md`.

## Cohesion, breakage and bulk creation

`set_anchor(x,y,anchored=True)` / `setAnchor(x,y,anchored=true)` pins a cohesive
solid or frozen cell. Broken pins remain fixed and can support other fragments.
Melting, burning into noncohesive products, or explicit replacement removes pins.

`set_integrity(x,y,value,weld=False)` / `setIntegrity(x,y,value,{weld:false})`
sets integer integrity from 0 to 255. Zero breaks reciprocal bonds; cooling and
ordinary repair never recreate broken bonds. Explicit welding, fresh placement,
and solidification can create bonds to adjacent intact cohesive cells.
`inspect_structure()` / `inspectStructure()` predicts the next solve without
changing state. Structural pass reports carry that plan. Diagnostic coordinates
and model limits are described in `STRUCTURES.md`.

For an initial bulk layout, the JavaScript export
`createPhysicsState(packedCells,width,height,registry)` validates packed placement
doses and returns independent `grid`, `energyQ`, and `structure` arrays. Use these
with the current field's snapshot metadata and tick zero for initial restore.
This deliberately creates fresh energy and bonds; use complete snapshots for
continuation. It is never an implicit migration for schema 1/2 saves.

`FieldSample.bonds` contains the original structural bit masks, not a compact
four-bit direction index. Use the public `STRUCTURE_BOND_LEFT_MASK`,
`STRUCTURE_BOND_RIGHT_MASK`, `STRUCTURE_BOND_UP_MASK` and
`STRUCTURE_BOND_DOWN_MASK` exports to decode it. Python samples expose the same
bit positions. Avoid copying numeric masks into a client.

The live reference client is `examples/lab/`. Its controller serializes steps,
edits, backend changes and imports; its renderer consumes committed public-field
samples. [CAPABILITIES.md](CAPABILITIES.md) explains the scenarios, known physical
and scale limits, material versus rule extensions, and the full verification command.

Browser/Node fields also support `field.copyStateInto({ grid, energyQ, structure })`
for renderers that reuse storage. Supply three non-overlapping `Uint32Array`s of
`width * height` elements. The method copies every committed coordinate and returns
its absolute tick, without allocating new coordinate arrays or exposing field storage.
Invalid storage is rejected before any destination is written; calls during a GPU
step fail until that step is awaited. Ordinary getters and snapshots still return
independent copies. Both CPU and WebGPU fields support this optional copy path.

Pressure and velocity sampling, version compatibility and model limits are in [PRESSURE.md](PRESSURE.md). Schema 3 snapshots must not be resumed as schema 4.

## Experimental finite 3D worlds

`state-space-engine/experimental/3d/world` exports the synchronous
`createStateSpaceWorld3D(options?)`; `/experimental/3d/world/gpu` exports
`createGpuWorld3D(options?)`. Both default to a closed 64³ world with eight 32³
chunks, one absolute tick and the existing integer `ca-3d-m1` schedule.
World snapshots have a separate versioned chunk envelope. The bounded M1/M2
volume entries retain their 32,768-cell limit and snapshot compatibility.

The [Cavern guide](../examples/cavern/README.md) covers global-coordinate edits,
bounded collision reads, GPU-resident cached terrain, saves/replay, and limitations.
The [M3 checkpoint](checkpoints/3D_M3.md) records verification and frame evidence.


## Experimental active 3D worlds

`state-space-engine/experimental/3d/active-world` exports
`createStateSpaceActiveWorld3D(options?)`, the dense CPU reference. Its `/gpu`
entry exports `createGpuActiveWorld3D(options?)`, defaulting to exact sparse
execution; `execution: 'dense'` provides a GPU reference. The finite default is
128³ with 32³ storage chunks and 8³ activity tiles. Sleeping/waking changes
work scheduling while preserving the global `ca-3d-m1` law and both physical
coordinates exactly. Activity is derived metadata, absent from portable saves.
The optional GPU `activityReadbackInterval` (0–3,600, default 0) batches diagnostic
readback at matching absolute request-end ticks. `inspectActivity()` returns
isolated cached data until a write, restore or terrain render invalidates it;
physics and snapshots are unchanged. The cavern uses an interval of 60.
Sparse activity also reports `plannerBuilds` and `plannerReuses` for the last
step request. Canonical compaction runs at most once per tick; unique wakes
append to the next pass while the current dispatch keeps an immutable prefix.
`plannerBuilds` counts canonical rebuilds and `plannerReuses` counts passes using
the existing or appended list. These describe work scheduling, not skipped
simulation ticks. List ordering never participates in physical decisions.

The separate snapshot envelope is `finite-active-1`. Existing M1/M2 volume and
M3 world entries keep their bounds and envelopes.
[SDK details and limitations](../examples/active-cavern/README.md) ·
[verification and frame evidence](checkpoints/3D_M4.md).


## Experimental 3D latency diagnostics

GPU factories accept `profiling: true` (default false): as an option on
`createGpuWorld3D` / `createGpuActiveWorld3D`, or the fifth argument to
`createGpuField3D(width, height, depth, fillMaterial, {profiling: true})`.
CPU timings are collected by default. Add `gpuTiming: true` alongside
`profiling: true` to request optional `timestamp-query` support when available.
Unsupported adapters retain CPU timings and explicitly report GPU timestamps
unavailable; disabled GPU timing is distinguished from unsupported hardware.

`inspectLatency(afterId = 0)` synchronously returns isolated records from a
32-record history. IDs increase across restores; each record identifies a
`step`, `render` or resident `gameplay` and its absolute tick. CPU stamps use `performance.now()`:
start, prepared, encoded, submitted, queue completion, field readback readiness,
and operation completion. GPU durations are milliseconds for edits, the complete
physics/planning/certification pass, collision query, mesh and draw. Resident
records additionally separate tools, collision-cache gathering and controller. CPU waits
and GPU durations overlap; do not add them. An individual physics family is not
separately timed because that would require changing compute pass boundaries.

Three reusable timestamp slots bound pending maps. Busy slots report `busy`;
disabled, unsupported, pending and failed diagnostics are explicit. No extra GPU submission
or awaited telemetry readback is added to gameplay. `settleLatency()` waits for
pending telemetry after a measurement loop, for receipt finalization. Diagnostics
never enter snapshots, command tapes, material rules or movement scheduling.

The three first-person examples enable CPU profiling and expose `latency()` through
their existing browser APIs (`crossing`, `cavern`, `activeCavern`). Append
`?gpuTiming=1` for opt-in GPU pass timing; the benchmark retains the chosen mode.
GPU timestamps can perturb timing, so compare that diagnostic mode separately.
Browser input
records separate event timestamps, handler observation and command sampling;
invalid/foreign-clock event timestamps are null. Automated routes are marked
`scripted` and never claim physical input-to-screen latency. Frame receipts retain
all 600 step/render traces and include HUD/telemetry collection in completion time;
final telemetry settlement and report serialization happen after measurement.

GPU timestamps may be quantized. A zero duration means below the measured resolution,
not proof that a pass did no work.


## Optional naturalistic terrain appearance

Chunked GPU terrain renderers expose
`await renderer.setAppearance('naturalistic' | 'diagnostic')`. The SDK default
remains diagnostic. The active cavern example selects naturalistic on startup.
The unchunked M1/M2 renderer does not expose this optional method.

Naturalistic presentation reads committed material/thermal cells to shade rock,
wet contacts, ice and lava, extract one exposed hot light per storage chunk,
sample bounded shadows and apply HDR tone mapping/bloom. It uses the same face
cache and collision surfaces as diagnostic rendering. No physics coordinate,
energy ledger, controller command or snapshot schema changes. Camera and
appearance settings are not stored in physical snapshots.

The first naturalistic selection loads the optional module, compiles its pipelines
and uploads bundled CC0 rock maps with mip chains; later A/B changes reuse them.
Diagnostic startup does not load that payload. Call it while the field is idle.
Invalid modes and calls during another
field operation reject without changing the selected appearance. Closing the
renderer frees both appearances, their light buffer, HDR and volume targets. Normal
resident gameplay still has one queue submission and one completion boundary;
lighting and post-processing add no state readback. Optional GPU timestamp
records include `lighting`, `draw`, `volumetrics` and `toneAndBloom`.

The material pass preserves voxel silhouettes. Diagnostic steam retains its
markers; naturalistic steam is a participating volume. Naturalistic
water and ice trace reflected and refracted rays through committed GPU cells,
including offscreen terrain. Depth absorption, water ripples and ice inclusions
are presentation only. Each ray has a 64-cell/40-voxel budget and at most four
subsequent dielectric interfaces. Secondary hits use simplified direct lighting;
there are no recursive mirror bounces or caustics. Water ripple phase derives
from the completed absolute tick (repeating after 36,000 ticks), including in
resident gameplay; pause and snapshot continuation reproduce it. Optics add no
completion boundary, state readback or optical history buffer.
Wetness is derived from adjacent water, not a new physical material.
A quarter-resolution pass integrates physical steam density and artistic cavern
fog over 32 steps, clipped to the opaque surface depth and 48 voxel units. Two
nearby sources from the existing chunk light list illuminate each ray; bounded
voxel shadows block their light. Depth-aware upsampling composites transmittance
and scattering before tone mapping. Visual drift uses the same completed tick
as water. Steam casts no surface-depth marker in naturalistic mode. There is no
additional physical smoke/fog state, fluid law, simulation pass or GPU readback.
Secondary reflected/refracted rays retain approximate distance fog; volume
multiple scattering, steam self-shadowing and exact radiative transfer are not
implemented.

Naturalistic heat distortion is enabled by default on chunked renderers. Use
`await renderer.setHeatDistortion(boolean)` while idle to compare it independently;
non-booleans, closed renderers and overlapping field operations reject. This is
presentation state and is not serialized into physical snapshots. Diagnostic
appearance ignores it. Switching appearance, restoring snapshots and resizing
preserve the setting.

The existing volume pass integrates bounded visual plumes above exposed hot
lava/molten-glass emitters. World-space turbulence follows the completed tick;
the HDR background is displaced by at most six pixels at 1080p, proportional to
vertical resolution. Terrain shadows, original/donor depth checks and canvas-edge
rejection keep occluded heat from pulling foreground surfaces into the plume.
The 48-voxel/32-sample volume budget and single completion boundary are unchanged.
One extra quarter-resolution rgba16float target holds displacement and plume
metadata (about 0.99 MiB at 1080p). There is no new simulation state or readback.
This is emitter-driven screen-space refraction, not a solved air-temperature or
refractive-index field; reflections and haze are not recursively distorted.
See [heat evidence](checkpoints/CAVERN_HEAT.md),
[haze](checkpoints/CAVERN_HAZE.md), and [water/ice](checkpoints/CAVERN_OPTICS.md).

## Optional resident 3D gameplay

Chunked WebGPU worlds expose `await field.createGameplay(state, rules)`. This is
an experimental fixed-point first-person controller matching the crossing/cavern
examples. It is opt-in; existing `step`, collision queries, rendering and portable
world snapshots retain their contracts. Dimensions must be at least 16 on each axis.
One controller and one terrain renderer may belong to a field at a time.

`state` contains `player` (`x/y/z/vy` in 1/256-voxel units, `grounded`, `wet`,
`jumpHeld`, `cooldown`, `blocked`), `look` (three integer components, length about
256), `status` (`playing`, `won`, `lost`), and prior `carved`/`iceWalk` event flags.
`rules` supplies fixed-point goal bounds `{minX,maxY,minZ,maxZ}`, `fallY`, and an
exclusive voxel `toolCeiling`. Full command records contain absolute `tick`,
`moveX`, `moveZ`, `jump`, `tool` (`none`, `carve`, `freeze`) and `look`.
Commands are limited to the existing examples' 7,200-tick session contract.

```js
const controller = await field.createGameplay(state, rules);
const committed = await controller.step(command, {
  renderer,
  camera: { forward, right, up }, // orthonormal; eye/target come from the GPU
});
// Committed player, look, status, new events, target and absolute tick are owned copies.
// Use committed state for HUD and save/replay after the promise resolves.
```

A presented tick uploads the command, applies reach-limited tool edits using the
previous collision cache, executes the unchanged 27 physical passes, refreshes a
GPU-resident 16³ collision neighborhood, moves the actor, updates the same-tick
camera and target, meshes dirty terrain and draws. These commands share one queue
submission and one awaited completion boundary. Validation and a 512-byte
actor/event/energy-ledger readback complete together. The optional scheduled
activity readback shares this boundary; GPU timestamp diagnostics add their own
asynchronous diagnostic mapping. There is no ordinary collision-neighborhood
transfer to the CPU. Initialization, saves, restore and explicit inspections are
outside this per-frame contract.

`controller.step(command)` without a presentation advances exact gameplay without
rendering. `controller.present({renderer,camera})` updates the paused view and target
without changing the tick, actor, ledger or terrain. Camera movement cannot select
physical work. Terrain culling expands its prior-eye bounds by four voxels, covering
the controller's maximum depenetration and movement; the draw uses the new GPU eye.

Save the committed actor/event history alongside `await field.snapshot()`, using the
example's existing game envelope. After `field.restore(snapshot)`, call
`await controller.restore(state)` to refresh the collision cache. External terrain
steps or edits invalidate the controller until this explicit refresh. Concurrent
operations, stale commands, invalid records and foreign renderers are rejected.
A GPU failure faults the field; recreate it from an application checkpoint.
`controller.close()` releases its buffers; `field.close()` also closes the controller.

The 128³ example selects this path with `?gameplay=gpu` or its backend selector.
Changing the backend resets the level. CPU gameplay remains the default reference.
The existing game snapshot/replay envelope is shared by both paths.

## Experimental M5 structural worlds

`state-space-engine/experimental/3d/structural-world` and its `/gpu` entry
introduce six-direction bonds, integrity, anchors, load transfer, thermal
weakening and coherent downward collapse. These entries have their own schema
and rules identity; the earlier 2D and 3D APIs retain their behavior. Older
snapshots are rejected by M5 rather than silently acquiring structural state.

See [the Structural Cavern integration guide](../examples/structural-cavern/README.md)
for CPU/GPU setup, transactional edits and resident gameplay, and
[the M5 rules and evidence](checkpoints/3D_M5.md) for acceptance status and limits.
The existing 3D resident-controller description above applies to M1–M4. M5 uses
structural edit batches and may need additional completion boundaries when its
global support solve cannot be reused. Combustion, pressure, stored velocity,
rotation, elasticity and reciprocal player forces are outside M5.

## Experimental material interventions

`state-space-engine/experimental/3d/interventions` exposes
`translateStructuralRegion3D(snapshot, request)`. It transforms an isolated M5
snapshot without stepping physics, reseeding thermal energy, healing integrity
or welding contact surfaces. This CPU operation uses the separate
`material-interventions-1` intervention contract; M5 evolution stays unchanged.

```js
import { translateStructuralRegion3D } from 'state-space-engine/experimental/3d/interventions';

const candidate = translateStructuralRegion3D(committedSnapshot, {
  cells: [[2, 2, 2], [3, 2, 2]],
  path: [[0, -1, 0], [1, 0, 0]],
  externalBonds: 'cut',
  anchors: 'release',
  displacement: 'air',
});
// candidate.snapshot and candidate.receipt are owned by the caller.
// Commit terrain together with actor/resources/turn state in the application.
```

Coordinates and path steps are integer triples. Each path step is exactly one
cell along one axis, and every intermediate destination is checked. Selected
cells must contain existing non-air matter. A step rotates each contiguous
selected run with its terminal occupant, preserving the packed and energy
coordinates of displaced air too. Internal bonds and damage travel with the
selection. The default policies reject external bonds and selected anchors;
explicit cut/release policies report the original affected endpoints. New contact
never bonds. Mobile displacement additionally permits unbound gases, liquids,
powders and broken cohesive material; intact or pinned occupants still block.

The bounds are 65,536 selected cells, 384 path steps and 262,144 cell-steps,
counting selection once plus each path step. Violations and late path collisions
leave the original snapshot unchanged. The receipt contains paired canonical
source/destination indices, copied path, cut bonds, released anchors, exact
edited indices, unchanged tick and zero external thermal energy. `externalEnergyQ`
is a bigint; encode it explicitly when serializing a receipt as JSON.

This is an instantaneous intervention, not a simulated movement duration or
physics preview. Combine it with temporary constraints, reservoir storage and
revision-checked whole-game commitment through the tactical session below.
Restoring a candidate with M5 `restore` resets that field's accounting baseline;
the session retains the application accounting context. Actor collision and later
support/collapse consequences require additional simulation integration and are
not described by the edit-only receipt.

See [the wishlist acceptance checkpoint](checkpoints/TACTICAL_INTERVENTIONS.md)
for stage evidence and remaining work. Runtime GPU/replay/benchmark verification
remains held; CPU edit checks do not establish those properties.

## Experimental tactical sessions

`state-space-engine/experimental/3d/tactical-session` exports
`createTacticalSession3D(initial, policy?)`. The session owns snapshot-based terrain,
portable application state, thermal accounting and a monotonic revision. Include
all actors, resources, AP, turn state and RNG state inside `game`; state kept
outside that value is outside the transaction. Existing external world instances
are not attached or mutated when the session commits.

```js
import { createTacticalSession3D } from 'state-space-engine/experimental/3d/tactical-session';

const session = createTacticalSession3D({
  worldId: 'canal-crossing',
  gameRulesVersion: 'canal-rules-1',
  terrain: committedSnapshot,
  game: { actors: [], ap: 2, resources: 10, turn: 0, rng: 7 },
  accounting: { initialQ: balance.initialQ.toString(), externalQ: balance.externalQ.toString() },
}, {
  validateGame: ({ game }) => game.ap >= 0 && game.resources >= 0,
});
const candidate = session.branch({ horizonTicks: 0 }); // edit-only example
candidate.translate({ cells: [[2, 2, 2]], path: [[0, -1, 0]], externalBonds: 'cut' });
const game = candidate.inspect().game;
game.ap -= 1;
candidate.setGame(game);
const committed = session.commit(candidate);
```

`branch.edit` accepts M5 material/energy/integrity/anchor/bond edits; placement
retains its fresh-material semantics. `branch.translate` preserves existing
matter. `setGame` replaces an isolated portable value. A failed edit or malformed
state makes the branch terminal, preventing commitment of earlier successful
operations. Game validation runs on the final combined state before publication.

`branch({horizonTicks})` declares its full horizon in advance. `advance(n,
{signal?})` resolves at most 32 ticks per request through the actual M5 CPU rules;
commit requires the entire declared horizon to finish. A synchronous, pure
`reduceTick({game, terrain, holds, reservoirs, tick, queries, beforeQueries, movement})` policy can update the game's state after each
complete tick. Inputs are isolated copies; keep randomness in `game` and version
the policy with `gameRulesVersion`. Asynchronous policies are rejected. The
session yields between ticks, but a CPU tick itself is not preemptible; this is
not yet a latency guarantee or a GPU-resident branch implementation.

`inspect()` returns a distinct preview envelope with `preview.base`,
`preview.horizonTicks` and `preview.completedTicks`. It is not a committed save:
`session.restore` rejects that envelope. Commit uses the originating branch handle
and its base revision, never a caller-edited preview copy. Foreign, failed,
discarded, stale, unfinished or already committed handles reject. A sibling
commit or restore invalidates old branches even when the physical tick is unchanged.
The successful commit installs terrain/holds/reservoirs/game/accounting together and returns an
isolated snapshot and a receipt including duration and external energy delta.

`session.snapshot()` is a JSON-portable `tactical-session-3` save (schema 3). Accounting uses
canonical decimal strings and is checked against combined world and reservoir energy before acceptance.
Missing initial accounting establishes a new baseline; supply the old field's
baseline and external total when preserving prior accounting. Restoring a session
save restores its accounting but advances the current revision, preventing reuse
of old preview tokens. Save/restore policy functions belong to the application
and must match the saved game-rules version.

The session retains at most four branches and runs one advancement at a time.
There is no pending-work queue. Discard superseded branches; cancellation becomes
terminal at the next safe boundary and waits for already executing work to finish
and clean up. The horizon limit is 1,024 ticks, with at most 256 operations per
branch. Game data is bounded to 65,536 nodes, depth 32 and 1,048,576 UTF-16
characters including keys; it must be acyclic JSON data without sparse arrays,
accessors, hidden fields or nonfinite numbers. Negative zero normalizes to zero.

CPU/mock validation covers publication and cancellation boundaries; nonzero
physical-horizon agreement, replay, GPU branches and rendering responsiveness
remain pending under the runtime hold. See the
[acceptance checkpoint](checkpoints/TACTICAL_INTERVENTIONS.md). No saved renderer
or lighting cache becomes authoritative session state.

### Temporary holds and accounted heat

The tactical session owns `holds` separately from canonical M5 terrain. Save the
whole session envelope to retain them. A bare terrain snapshot contains permanent
anchors only and is insufficient to continue a constrained simulation. Session
schema 3 / `tactical-session-3` explicitly rejects older session envelopes; M5,
2D and the translation contract retain their previous versions.

```js
const candidate = session.branch({ horizonTicks: 0 });
candidate.hold({
  id: 'earth-suspension', cells: [[2, 2, 2]],
  expiresAtTick: candidate.base.tick + 4,
});
const cost = candidate.addEnergy([{ x: 2, y: 2, z: 2, deltaQ: -256 }]);
// cost.suppliedQ, cost.removedQ and cost.externalQ are exact decimal strings.
// Apply the game's resource/AP policy through setGame before commit.
session.commit(candidate);
```

A hold pins existing cohesive solid/frozen cells at their current coordinates.
It neither repairs damage nor creates bonds. Existing permanent anchors survive
release and expiry. `releaseHold(id)` explicitly removes a hold. Held source
matter must be released before translation, including a translation requesting
permanent-anchor release. Material placement drops affected held targets even
when the material ID stays the same. Damage, bond edits and heating retain the
hold; a physical material/phase transformation removes that target at the next
complete boundary. Empty holds disappear. Holds do not suppress heat or melting.

Expiry is an absolute completed tick. At tick 7, a hold expiring at 9 affects
transitions 7→8 and 8→9, then is absent at tick 9. The CPU driver overlays pins
before stepping; the session removes temporary bits before exposing state and
refreshes driver state at the following boundary. Policies receive isolated
canonical terrain and the remaining `holds`. Mechanical work is not thermal Q.

`addEnergy` accepts signed integer Q deltas, at most 65,536 unique cells per batch.
It rejects duplicate targets, invalid coordinates and any result outside the
existing energy bounds without clamping or partial publication. Heating and
cooling are reported separately even when their net external cost is zero.
Material, phase and structural history remain unchanged by this operation;
ordinary physics later resolves transitions. Game costs are not imposed by the
engine. Each receipt owns its sorted cell changes.

At most 64 holds and 65,536 total held cells may exist, with no overlap and at
most 1,024 ticks of remaining lifetime. These are world-space pins, not moving
rigid-body constraints, a wind model, actor constraints or an efficient GPU path.
CPU edit-only and mock boundary tests cover the protocol. Actual constrained
trajectories and replay remain unverified while runtime verification is held.

### Conservative finite reservoirs

The session may own `reservoirs: [{id, terrain}]` at creation. Each `terrain` is a
complete M5 snapshot at the main world's absolute tick. All domains use the same
physics/catalog contract; their geometry may differ. IDs and geometry remain
fixed through branches and restores. The limit is eight reservoirs and 65,536
additional cells total. Initial reservoir contents enter the combined accounting
baseline. Supplied historical accounting must cover every domain.

```js
const chamber = createStateSpaceStructuralWorld3D({
  width: 4, height: 4, depth: 4, chunkSize: 4,
});
const storage = chamber.snapshot();
storage.tick = committedSnapshot.tick; // domain genesis at this session boundary
const session = createTacticalSession3D({
  worldId: 'canal-crossing', gameRulesVersion: 'canal-rules-1',
  terrain: committedSnapshot, reservoirs: [{id: 'water-pouch', terrain: storage}],
  game: {actors: [], ap: 2, resources: 10, turn: 0, rng: 7},
}); // establishes a new combined accounting baseline
const candidate = session.branch({horizonTicks: 0});
const receipt = candidate.transfer({
  from: null, to: 'water-pouch', // null identifies the main world
  cells: [[8, 3, 8]], offset: [-7, -2, -7], // maps to [1, 1, 1] in storage
});
// Apply AP/resources and any inventory access policy before committing.
session.commit(candidate);
```

`transfer` swaps each selected source cell with its destination occupant. Even
the displaced air and its energy return to the source; there is no fresh air seed
or deleted water. Packed material/phase/thermal state and conserved Q travel with
the matter. Cohesive selections retain damage and internal bonds. External bonds
and permanent anchors reject unless `externalBonds: 'cut'` and/or
`anchors: 'release'` explicitly permit changing them. Temporary holds require
explicit release. Arriving next to another solid does not create bonds.

Destination coordinates are source coordinates plus `offset`. Only distinct
domains are allowed. This is an inventory-domain handoff; it does not imply a
collision-free route through the world. Use `translate` for checked-path world
movement. Ability range, accessible ports, access rights and costs belong to the
game. The default destination must be air; `displacement: 'mobile'` also allows
the same unbound gases, powders, liquids and broken matter as translation. Intact
or pinned destinations reject. Stored-to-stored transfers use their string IDs.

The receipt has canonical paired cell indices, explicit cuts/releases, exact
changed-cell lists and opposite signed `sourceEnergyDeltaQ` /
`destinationEnergyDeltaQ` strings. Its `externalEnergyQ` is always `'0'`.
Thermal accounting includes all domains, so a transfer cannot hide an energy loss
by removing matter from the primary world.

Stored material continues to evolve: each logical session tick advances the main
world and every reservoir once under M5, sequentially. Domains have closed matter
and energy boundaries between transfers. Stored water can flow, exchange heat
with its container and change phase. Reservoirs are not frozen inventory records.
`reduceTick` and final validation receive isolated `reservoirs` only at complete
combined boundaries. A failed or cancelled advancement publishes none of its
partial domain progress and attempts cleanup of every created driver.

Schema 3 / `tactical-session-3` includes `storageRulesVersion: 'material-reservoirs-1'`
and all reservoir snapshots. Version 1 and 2 saves reject rather than dropping or
inventing inventory. No runtime addition/removal of domains is provided. Reservoir
simulation and transfers are CPU implementations. Their 23 edit/inert-driver
cases pass in the current 201-case selected suite, along with no-emit type checking
and lint. Actual stored-material evolution and physical replay remain held; SDK
build/public-entry checks remain deferred.

### Gameplay geometry views

`session.queries()` creates an isolated view of committed geometry;
`branch.queries()` uses that branch's ready candidate. Pass `{domain: 'water-pouch'}`
to inspect a reservoir. Retained views continue to describe their original state
after later edits or commits. They never advance physics. Creating a view currently
validates and copies the complete CPU domain; GPU views and incremental reuse are
not implemented or performance-validated.

```js
import {GEOMETRY_SCALE_3D as Q} from 'state-space-engine/experimental/3d/tactical-session';
const query = candidate.queries();
const box = {minQ: [Q, Q, Q], maxQ: [2 * Q, 3 * Q, 2 * Q]};
const fit = query.fit({box});
const motion = query.sweep({box, deltaQ: [2 * Q, 0, 0]});
const ground = query.support({box, maxDropQ: Q});
const pickedWater = query.raycast({
  fromQ: [0, Q, Q], toQ: [8 * Q, Q, Q], materials: [MAT.WATER],
});
```

Coordinates are safe integers in units of 1/1,024 voxel, including one-quantum
geometry. Inputs are limited to ±524,288 units per coordinate/delta. A box must
have positive volume. The default blocker set is solid/frozen/powder material;
an explicit unique built-in `materials` list replaces that filter. An empty list
selects no material. Bodies still collide with closed world boundaries.

Every result carries an immutable `stamp` with `gameplay-geometry-1`, domain and
completed tick. Committed stamps include the full session revision identity.
Preview stamps include the base revision, session-local branch ID, operation
number and horizon/completed counts. Preview IDs are disposable view metadata,
not saved physical state or portable authorization tokens. Check the stamp before
using a result against newer game state; a retained view does not silently update.

`fit` reports positive-volume overlap, a first blocking cell, or an outside body.
Face contact alone is allowed. `sweep` reports the earliest contact as reduced
`{numerator, denominator}` time within the requested displacement, a signed unit
axis normal, the cell or closed-boundary marker, and `startedOverlapping`.
Endpoint contact is included; moving away from a touching surface is clear.
Grazing with no positive overlap is clear. Equal-time boundary hits precede cell
hits; axis ties choose X, Y, Z and cell ties use ascending x-major index.

`raycast` accepts outside camera origins and clips the segment to the domain.
Voxel crossings compare exact integer fractions and advance all tied axes at
once, avoiding edge-only cells. Grid-plane starts choose the travel side and report an entry normal instead of
initial penetration. Simultaneous internal-plane/world-entry ties choose X, Y, Z.
A parallel grid-plane ray uses the positive-side half-open cell. Point rays are
allowed; initial occupancy without an entering face has a zero normal and
`startedOverlapping: true`. Segment endpoint contact is included. World boundaries
clip picking rays rather than becoming terrain hits.
Contact times and zero have canonical exact representations; no epsilon decides
which voxel is selected.

`support` searches downward (+Y) from a fitting body's bottom face. It returns
the nearest distance in integer Q units and all co-nearest cell faces with exact
footprint overlap in square Q units. A closed floor is explicitly marked as a
boundary surface. `bodyFits: false` rejects a footing interpretation for an
already intersecting body. A contact says where geometry meets the body; it does
not prove structural stability, load capacity, walkability or tactical cover.

Queries reserve at most 65,536 candidate-cell visits, including fit work inside
sweep/support. An excessive search throws instead of reporting a false clear
path. Queries and results own their data; they cannot change simulation state.
The Build 8 validation passed all 36 geometry regressions, type checking and
lint for its recorded hashes. SDK/public-entry checks now pass within the
[bounded scope below](#tactical-sdk-verification). Endpoint support reports
and optional CPU motion journals are described below; physical actor integration
remains pending.

### Kinematic bodies and material exposure

The tactical-session entry exports `createTerrainBody3D(view, initial)`,
`readTerrainBody3D(view, saved)` and `stepTerrainBody3D(view, body, command?)`.
They use an isolated session/branch geometry view. The separately versioned
`terrain-body-1` state saves world/domain and physics/catalog identity, position,
size, velocity, gravity, step count and grounded state. Save it inside `game` so
terrain, actor state and application resources commit atomically.

```js
import {createTerrainBody3D, stepTerrainBody3D, GEOMETRY_SCALE_3D as Q}
  from 'state-space-engine/experimental/3d/tactical-session';
const actor = createTerrainBody3D(session.queries(), {
  minQ: [Q, Q, Q], sizeQ: [Q, 2 * Q, Q], gravityQ: 64,
});
// The application chooses how actor steps relate to material ticks.
const resolution = stepTerrainBody3D(candidate.queries(), actor, {
  impulseQ: [0, -128, 0], accelerationQ: [16, 0, 0],
});
if (resolution.status === 'resolved') {
  candidate.setGame({...candidate.inspect().game, actor: resolution.body});
}
```

One body step adds impulse, acceleration and saved gravity to velocity, then
sweeps **X, Z, Y** in that fixed order. Positive Y is down. Axis travel is exact
integer Q; collision stops that velocity component at contact. This is a bounded
kinematic path, not a simultaneous diagonal sweep or a force/rigid-body solver.
Default blockers remain solid/frozen/powder; world boundaries are closed. Results
include contacts, displacement, before/after support, footing loss, landing and
final exposure. Removing a floor takes effect from the current view. Initial
overlap or outside placement returns `embedded`/`outside` with unchanged saved
body state; the game must choose a response before committing an action.

`TERRAIN_BODY_LIMITS_3D` bounds each size component to eight voxels, each saved or
combined velocity/command component to ±32 voxels per actor step, and gravity to
0–1 voxel per step squared (default 64 Q). Invalid/overflowing input rejects
without mutating inputs or terrain. Each resolution makes a fixed number of
bounded queries; no actor loop runs implicitly. No friction, buoyancy, damage,
actor-actor response or structural load is inferred. The separate moving-terrain
context below adds observed support carry and debris contacts; this single-view
actor step itself has no terrain history.

`reduceTick` receives `queries(options?)`, with the same optional reservoir domain
selector as session queries. It lazily creates an isolated view of **that complete
logical tick**, after all domains and hold expiry, and caches one view per domain
within the callback. Retained views or query closures keep their original tick,
branch operation and terrain. A policy can return
`{...game, actor: stepTerrainBody3D(queries(), game.actor).body}` to resolve actors
within the candidate's atomic advancement; it must handle unresolved results as
appropriate. No view is built when unused. Creating a requested view still copies
and validates its complete CPU domain; this has no large-world latency claim.

`view.exposure({box})` returns `terrain-exposure-1` and the immutable geometry
stamp. It reports exact overlap volume, cell count, minimum/maximum integer
temperature Q and a volume-weighted temperature ratio per material, including
air. Volumes and ratio numerator/denominator are decimal integers; the ratio is
not rounded or reduced. `outsideVolumeQ3` explicitly identifies unknown space.
Each material's `maxImmersionDepthQ` is the greatest contiguous run of that liquid
material touching the feet in any footprint column, clipped to the box. Water
separated from the feet by air does not count as immersion; feet outside the
world report no known immersion. This is exposure at one endpoint, not accumulated
thermal dose or exposure along a movement path. Health, swimming and tactical
rules remain application decisions.

Build 9's corrected 239-case edit/static/inert suite, no-emit type check and lint
passed under separate bounded runs. Actual material/body trajectories, GPU parity and SDK delivery
remain held or deferred; these helpers do not establish full actor/terrain coupling.

### Endpoint change reports

`branch.changes(options?)` compares a ready candidate with its current base;
`session.commit(branch).changes(options?)` retains a comparison between the exact
states published by that commit. Calling the method explicitly performs the
comparison. Commit itself does not invoke additional structural solves. Reports
are ordinary serializable data; saves and replay state do not include them.

```js
const candidate = session.branch({horizonTicks: 0});
candidate.addEnergy([{x: 2, y: 1, z: 1, deltaQ: 256}]);
const previewReport = candidate.changes({maxRuns: 1024});
const committed = session.commit(candidate);
const publishedReport = committed.changes({maxRuns: 1024});
// Channel values agree; the target identity distinguishes preview from commit.
```

The `gameplay-changes-1` report has `scope: 'endpoints'`, an immutable `from`
revision and `to` committed revision or preview identity. Every domain identifies
its geometry and absolute start/end ticks. The report scans the complete primary
world and all reservoirs, independently comparing material IDs, phases, conserved
energy, exact temperature, mechanical words, temporary constraints and support.
It also reports game-state and accounting changes. Latent heat can change the
energy channel while leaving temperature unchanged; a one-quantum temperature
change is detected even when the packed thermal byte is unchanged.

Support means the existing global M5 assessment at each endpoint: distance to a
root, load, capacity and reaction. Temporary holds contribute their anchor bits
only to the isolated inspection input. A changed local anchor or bond can report
remote bridge cells whose material and mechanical words are unchanged. All cells
are compared; the originating edit box does not limit coverage. The observer's
proposed damage and movement are discarded. This inspection neither advances a
tick nor guarantees that a structure will survive later resolution.

Each channel carries an exact changed-cell `count`, a minimum-inclusive /
maximum-exclusive cell-coordinate `bounds`, and sorted `[startIndex, cellCount]`
runs in global x-major order. `mode: 'unchanged'` has zero count; `mode: 'runs'`
is a complete sparse list. All channels and domains share `maxRuns` (default
2,048; permitted 0 through 4,096). When a channel exceeds the remaining budget,
its mode becomes `bounds`, `requiresFullRead` becomes true and its run list is
emptied. Its complete count and bounds still include every difference. Invalidate
or reinspect that entire region on the stamped endpoint; an empty overflow list
does not mean no change. Allocation order is primary then sorted reservoirs,
ascending cells and material/phase/energy/temperature/structure/constraints;
support runs follow the state scan for each domain. Discarded runs do not replenish
the shared budget, keeping cumulative run allocation bounded.

Endpoint comparisons cannot identify which identical-looking cell moved, describe
motion that returned to its origin, or recover intermediate events. Accordingly,
`motion.status` is always `not-observed` and `requiresExecutionTrace` is true. This
must not be interpreted as an empty motion trajectory. The separate optional
motion journal below observes executed permutations. The action journal adds
complete-tick support/thermal history; sub-pass events remain required work.

Retained commit inspection keeps both original endpoint states alive until the
commit handle is released. Store the serializable report instead when retaining
compact history. Caller mutations and later commits/restores cannot rewrite the
captured endpoints. Query failures do not change live state or invalidate an
otherwise ready branch. Inspection rejects mutation/publication reentrancy.

This is a synchronous CPU reference path. A changed domain can require two global
M5 plans, plus full scans; `maxRuns` bounds report detail, not solver work or
latency. Identical effective physical inputs skip the support plans. GPU reporting,
incremental reuse and bounded asynchronous observation are pending. The 23
edit/inert-observer cases pass in the selected suite; the four separately excluded
real-support fixtures remain unexecuted. Type checking, lint and the bounded SDK
checks pass; runtime holds and legacy-demo quarantine remain in force.

### Observed CPU motion

Motion capture is optional. `world.stepWithMotion({maxEntries?})` advances exactly
one M5 CPU tick and returns a `MaterialMotionTrace3D`. The ordinary `world.step()`
path allocates no provenance buffers. Motion types and the constants
`MOTION_TRACE_RULES_3D`, `MOTION_JOURNAL_RULES_3D` and `MOTION_TRACE_LIMITS_3D` are
exported from `state-space-engine/experimental/3d/tactical-session`.

The `material-motion-1` trace identifies the physics rules, catalog, dimensions
and absolute `fromTick`/`toTick`. Indices use global x-major order. Capture follows
the structural solver's actual source permutation and each executed local swap,
including displaced occupants. It does not infer identity from differing values:
two identical-looking cells can exchange places without any endpoint difference.

- `moves` contains sorted `[originalSource, finalDestination, cellCount]` runs.
  Consecutive sources with consecutive destinations coalesce. Omitted origins
  end where they started; they may still have moved within the tick.
- `touched` contains sorted `[originalSource, cellCount]` runs for every original
  cell moved in any pass, including cells that return to their starting position.
- `fragments` lists moving components from that tick's post-damage structural
  solve. Each has a canonical `id` (minimum original member index), exact `cells`
  count and `sourceRuns`. These components descend one cell along +Y. IDs are
  local to the tick; a later phase change may dissolve their bonds.

Heat and phase changes keep correspondence with the transported matter. Net
correspondence does not describe a continuous path or sub-pass timing, and is
insufficient by itself for swept debris/actor collision. Loose broken material
is included in cell motion but not in the cohesive-fragment list.

A trace shares one detail budget across fragment headers/membership runs, move
runs and touched runs, allocated in that order. `maxEntries` defaults to 4,096
and accepts integers from zero through 65,536. Exact moved/touched/fragment counts
are always retained. If detail does not fit, `status` is `overflow`,
`requiresReexecution` is true, and **all** detail arrays are empty. A consumer
requiring complete correspondence must reject that result and re-execute from
the original state with an adequate budget. Reading a final snapshot cannot
recover omitted identities. This budget bounds retained detail, not full-volume
CPU work or provenance buffers; there is no latency claim.

Branches can retain a motion journal across their simulated horizon:

```js
const candidate = session.branch({
  horizonTicks: 4, captureMotion: true, motionMaxEntries: 4096,
});
await candidate.advance(4); // Actual physics: run only after runtime approval.
const previewMotion = candidate.motion();
if (previewMotion.status !== 'complete') {
  candidate.discard();
  throw new Error('The action requires complete motion coverage.');
}
const committed = session.commit(candidate);
const publishedMotion = committed.motion();
```

`captureMotion` defaults to false. Specifying `motionMaxEntries` requires capture.
The `motion-journal-1` result identifies the base revision and its preview or
committed target. Frames record domain (`null` for primary world), operation
number and each complete tick trace; order is tick, then primary and sorted
reservoir domains. Failed/cancelled advancement, invalid driver output or failed
cleanup publishes neither its staged frames nor candidate terrain/game changes.
Ready preview inspection rejects stale branches. Retained commit journals own
their data and remain bound to the original revision after later commits/restores.

The whole branch retains at most 256 domain/tick records and 65,536 detail
entries. Any trace or journal overflow marks the journal `overflow`, empties all
frames and sets `requiresReexecution`; `recordsObserved` still counts complete
domain/tick records observed. An uncaptured journal is explicitly `disabled`,
also requiring re-execution. Neither means no motion. Actions requiring more than
256 domain/tick records cannot currently obtain a complete journal; increasing
the per-trace limit cannot raise that cap. They must reject if complete coverage
is required. Supporting longer atomic actions needs a streaming/drain API, which
is pending. A complete zero-tick journal is legitimately empty within its scope.

Journal scope is `simulation-ticks`, with `includesInterventions: false` and
`includesSubpassPaths: false`. Translation, transfer and direct-edit receipts
remain separate; consumers must not treat this journal as all action changes.
Capture settings, traces and journals are disposable derived data, absent from
authoritative saves. The optional action journal below adds intervention and
complete-tick support/thermal reports. Actor carry/contact uses the separate
moving-terrain context below; GPU capture
and bounded asynchronous observation remain pending.

The 26 pure/inert-driver regressions pass; six separately held physical
equivalence/restart cases remain unexecuted. Source comparison retains
the pre-instrumentation kernels and confirms that removing the observation code
recovers their physical source, ignoring whitespace. This is not proof of exact
runtime behavior. Type checking and lint passed through Build 9; Build 10's
additional path observation has its own gates below. SDK checks are
user-deferred, and the runtime hold and legacy quarantine remain intact.

### Observed movement within a physical tick

The experimental `structural-world` source entry provides
`world.stepWithMotionPaths({maxEntries?, maxPathEntries?})`. It advances exactly
one M5 tick and returns `{motion, paths}`: the existing endpoint motion trace and
a separately versioned `material-motion-paths-1` record. This CPU capture is
opt-in and disposable; it adds no snapshot coordinate or material rule. The
ordinary `step` and `stepWithMotion` APIs retain their previous result shapes.

`paths` records geometry, physics/catalog identity, absolute `fromTick`/`toTick`,
`passesObserved` (28), `cellTransfers` and sparse ordered `passes`. Pass index 0
is structural movement; indices 1–27 follow the frozen material schedule for
that absolute tick. An omitted index means no movement. Each present pass has
canonical source-sorted `segments` with `{origin, from, to, mode}`. Indices use
the world cell layout. `origin` is the cell identity at the start of the tick;
`from` is its position immediately before this pass. All transfers within a pass
are simultaneous. Round trips retain their intermediate visits even when the
final displacement is zero.

`mode: 'linear'` describes the kinematic segment between the two cell positions
for falling fragment members or a local swap. It does not imply a stored
velocity, force or continuous rigid-body simulation. Structural terminal
occupants rotate instantaneously to the exposed top of a moving column; those
segments use `mode: 'relocation'` and must **not** be swept through the intervening
solid. Empty heat/phase passes remain covered by the full pass count; thermal and
material transformations are not movement records. This is a within-tick ordering
contract, not elapsed wall-clock timing or accumulated exposure.

The shared path-detail budget counts each retained pass header and each segment:
default 4,096, maximum 65,536. Zero is allowed for explicit overflow observation.
Overflow sets `status: 'overflow'`, empties **all** path detail, keeps observed
transfer/pass counts and sets `requiresReexecution: true`. An overflowing net
motion trace also prevents a complete path claim. Raising `maxPathEntries` does
not raise `maxEntries`. A complete identity tick can have zero detail entries.

`readMotionPaths3D(paths, motion, beforeSnapshot, afterSnapshot)` validates and
copies portable data. It checks snapshot identities, complete schedule coverage,
closed bounds, scheduled pair direction/parity, simultaneous permutations,
original-identity composition, fragment membership and agreement with the net
motion/touched sets. It validates internal consistency; it cannot authenticate
an arbitrary caller's claim that a history was actually executed. The public
decoder validates both complete CPU snapshots and has no large-world latency
claim. Only records from an accepted simulation boundary should drive gameplay.

The production hook observes actual structural mappings and executed swaps.
40 synthetic capture/decoder cases and the complete 279-case Build 10 edit/mock
suite pass, including rejection of forged local excursions by intact fragments.
Build 10's no-emit type check and lint passed under separate bounded runs.
Four actual physical equivalence/overflow/restart cases are authored
but held, along with SDK/GPU/replay/benchmark checks. Tactical path capture is
described below. Observed support carry and debris contacts have a separate
context below. Opt-in kinematic pushing/crush diagnostics are described after it;
intervention trajectories remain subsequent work. Existing journals retain their scopes.

### Tactical path journals and per-tick game input

`session.branch({horizonTicks, capturePaths: true, pathMaxEntries?})` requests
observed paths for every physical tick in every domain. It implies net-motion
capture; `captureMotion: false` is a contradiction and rejects. Per-tick limits
remain independent: `motionMaxEntries` bounds the net trace and `pathMaxEntries`
bounds path headers/segments (default 4,096, maximum 65,536). Detail options require
their capture feature. The production CPU driver calls `stepWithMotionPaths`;
the default driver path remains unchanged when capture is disabled.

Read `branch.paths()` or retain `commitResult.paths()`. The `tactical-paths-1`
journal binds the base and target revisions, has scope `simulation-ticks`, and
contains ordered `{domain, operation, motion, paths}` frames. A complete empty
zero-tick journal is valid. A disabled journal explicitly reports
`requiresReexecution: true`; it does not assert that nothing moved. These journals
contain sub-pass paths but exclude direct interventions. Existing net-motion and
action-boundary journals keep their previous scopes and formats.

The entire path journal has a separate cap of 256 domain/tick frames and 65,536
entries. One frame header, its net detail and its path detail all count against
that budget. A per-tick overflow or whole-journal limit clears every retained
frame and reports `overflow` / `requiresReexecution: true`. `recordsObserved`
continues counting completed domain/ticks. Raising a per-tick limit does not raise
the journal cap; consumers needing complete history must check its status.

Reducers receive two additional lazy accessors:

- `beforeQueries({domain?})` gives an isolated geometry view of the tick's input.
  `queries({domain?})` still gives its completed output. Each caches one view per
  domain for that callback. Retained accessors keep their original state and stamps.
- `movement({domain?})` returns an owned `logical-tick-domain` record with immutable
  `from`/`to` geometry stamps, status, net trace and paths. Disabled capture returns
  null trace/path values. Overflow retains the underlying records' explicit
  overflow statuses and counters. Every read is isolated from caller mutations.

The coordinator completes and validates **all** domains before invoking the game
reducer. Its current-tick movement is separate from long-horizon journal retention:
even after `.paths()` overflows, `movement()` may still be complete for the current
domain/tick. This allows actor policy to process each tick without retaining an
unbounded history. These are two different coverage scopes; do not substitute
one status for the other.

A deterministic game rule that depends on paths should declare
`{requiresPaths: true, reduceTick}` in the session policy. This freezes the
requirement for that session, enables path capture by default and rejects branches
that attempt to disable it. The reducer must still handle or reject overflow.
The application's `gameRulesVersion` identifies this behavior; all actor/RNG/AP
state belongs in `game`. The engine does not infer actor motion or health effects
from the presence of a path record.

Paths stage privately with each complete advancement. Missing or invalid driver
data, requested-budget violations, cancellation, stale revisions, reducer failures
or driver cleanup errors leave live terrain/game/accounting and journals unchanged.
Committed journal readers remain bound to their original commit after later edits
or restore. Capture flags and retained observations are absent from portable saves.

Build 11's 21 pure/inert integration cases and full 300-case edit/mock suite pass;
the no-emit type check and lint also passed in separate bounded runs. Three
actual physical session/restart cases are authored but held. Session path capture
provides the inputs for the moving-terrain context below. GPU capture and large-
world latency for CPU snapshot validation/copies remain unverified.

### Moving supports and debris contacts

`createTerrainMotion3D(beforeQueries(), queries(), movement())` builds a reusable
`terrain-body-motion-1` context inside `reduceTick`. Use the three accessors from
the same callback and domain. The context binds their private owned boundaries;
matching revision text from another session is insufficient. It accepts a live
movement observation, not a JSON clone. Public fields are isolated reports:
mutating them cannot alter the coordinator's validated paths used by this context.
After restart, recreate the context by observing the next tick; do not save it.

```js
import {createTacticalSession3D, createTerrainMotion3D, stepTerrainBody3D}
  from 'state-space-engine/experimental/3d/tactical-session';
const session = createTacticalSession3D(initialWithSavedActors, {
  requiresPaths: true,
  reduceTick({game, beforeQueries, queries, movement}) {
    const terrain = queries();
    const motion = createTerrainMotion3D(beforeQueries(), terrain, movement());
    const actors = game.actors.map(actor => {
      const carried = motion.reconcile(actor);
      if (carried.status !== 'resolved') throw new Error('Unresolved terrain contact');
      const moved = stepTerrainBody3D(terrain, carried.body);
      if (moved.status !== 'resolved') throw new Error('Unresolved actor movement');
      return moved.body;
    });
    return {...game, actors};
  },
});
```

The application identifies this ordering in `gameRulesVersion`. This example
rejects an unresolved action atomically; a game may instead apply its own contact
policy. Actor-actor collisions are not resolved by this loop.

`context.reconcile(body, {maxContacts?})` processes one material tick. A grounded
body follows the structural pass's one-cell downward displacement only when
**every** contacting support surface belongs to moving fragments. Any stationary
support prevents automatic carry. Airborne actors and loose powder are not
attached to fragments. Successful reconciliation updates position and footing,
leaving velocity, gravity and the actor movement-step counter unchanged. The
separate actor step applies commands/gravity once afterward if the game chooses.

Linear cell trajectories are swept against the actor's simultaneous intended
trajectory using exact rational contact times. Contacts preserve pass, original
cell identity, source material/energy, fragment identity and normal. Times run
from 0 to 1 **within a pass**, not within a physical second. Passes order contacts;
equal times use original identity, then source/destination indices. Normal-axis
ties use X/Y/Z. Round-trip motion remains detectable even with zero net movement.
Relocations are tested only for overlap at their destination; they have no swept
path. Water/gas are nonblocking and remain visible through endpoint exposure.

An obstruction before a pass endpoint returns `blocked`, with unchanged input
body and coverage through the first blocking pass. Contacts describe the proposed
path; they do not claim a solved post-impact trajectory. Exact endpoint touching
may return `resolved` with contacts. Phase-created endpoint overlap returns
`embedded`; initial overlap/outside placement also stays unresolved. `fitsAfter`,
`supportAfter` and `exposure` describe the returned body against completed terrain.
Reconciliation itself does not push an obstructed actor. The optional displacement
context below provides a separate kinematic response. Damage, momentum exchange,
actor loads and general depenetration still require further engine/game integration.

Default contact capacity is 256, maximum 4,096. The carry neighborhood has a
prospective 65,536-cell limit; path input retains its existing global limits.
Disabled/overflow capture or exhausted contact capacity returns `incomplete`,
`requiresReexecution: true`, no contacts and no partial carry. Check status before
using the body. The context can serve several actors without revalidating/copying
whole-world snapshots for each actor; each actor still scans bounded path detail.
There is no current large-world latency claim. Returned body/contact/exposure
records are owned; retained contexts keep their original boundaries after commit.

Build 12's 32 pure/edit/inert cases and the complete 332-case selected suite pass,
as do no-emit type checking and lint under separate bounded gates. Three
actual physical carry/restart/observation cases are authored but remain held.
SDK build and zero-tick public-entry checks now pass; physical replay, GPU checks
and benchmarks remain blocked.

### Terrain-driven actor displacement

Use `createTerrainDisplacement3D(beforeQueries(), queries(), movement())` when
terrain should push an actor. This is a separate `terrain-displacement-1` rule,
selected by application policy; it preserves the previous reconciliation API.
Use its `resolve(body, options?)` in place of `motion.reconcile(body)` for that
material tick. Both use the same live-observation and owned-boundary checks.

```js
const motion = createTerrainDisplacement3D(beforeQueries(), queries(), movement());
const displaced = motion.resolve(game.actor);
if (displaced.status !== 'resolved') {
  // This example rejects the entire staged action. A game can instead handle
  // a crush by changing its own unit/health state before publication.
  throw new Error(`Unresolved terrain response: ${displaced.reason}`);
}
return {...game, actor: displaced.body};
```

Within each observed linear pass, an actor starts stationary or follows eligible
falling support. At the first swept contact it matches the terrain's **normal**
velocity for the rest of the pass; tangential velocity stays unchanged. Further
contacts can constrain that motion. All simultaneous normal constraints are
processed together, including already touching stationary terrain and closed
boundaries. Contacts at the pass endpoint are reported without inventing movement
after that endpoint. Motion resets at the next material pass; this does not add
momentum to the actor's saved velocity.

The response uses integer intercepts and velocities with rational event times.
Matching a moving cell face keeps the intercept integral, so completed positions
remain exact Q coordinates without epsilon nudges or rounding. Pass-local normal
velocities are bounded by one voxel per pass. Contact times are fractions of that
pass, not seconds. Diagonal corner ties choose X/Y/Z. Reports sort by pass/time,
then boundary faces before original cell identity and normal axis. Original
identity persists through earlier passes; newly occupied and vacated positions
participate at their current locations.

Opposing normal constraints return `crushed` with
`{axis, lowerVelocityQ, upperVelocityQ}` and their contact witnesses. This means
the constraints conflict under this versioned kinematic rule; it is not a global
proof that every possible rigid-body escape is impossible. Health and knockdown
remain game rules. The response is one-way: terrain never receives actor mass,
load or impulse. Actor-actor collision, friction, swimming and force coupling are
not supplied by this context.

Every unsuccessful result returns the unchanged input body and zero `movedQ`.
Initial overlap/outside placement, a relocated solid arriving on the actor, and
phase-created endpoint overlap remain explicit unresolved states. Relocations
have no swept push path. `incomplete` additionally clears all contacts/crush detail
and sets `requiresReexecution`; callers must not accept it as a safe response.
Successful results update only position and footing. Saved velocity, gravity and
actor step count stay unchanged; apply a separate actor step afterward when that
ordering matches the application's `gameRulesVersion`.

Limits apply to the complete per-body tick response:

| Option | Default | Maximum |
|---|---:|---:|
| `maxContacts` | 256 | 4,096 |
| `maxEvents` | 128 | 512 |
| `maxWork` | 262,144 | 1,048,576 |

Work counts candidate visits and contact/constraint tests, with bounded work per
item. Context creation and the existing full-domain geometry validation/copies
are separate costs. Zero budgets accept an empty history and reject the first
corresponding required item. Budgets are inclusive; exhaustion never publishes a
partial push. Reuse one context for multiple actors, each with independent work
and response state. Returned contacts/body/exposure are isolated; exposure is
evaluated at the returned body against completed terrain, not integrated along
the path. Bounded work is not a measured frame-latency guarantee.

Build 13's **367 selected edit/mock tests**, including 35 displacement cases,
passed under the CPU harness. These displacement cases also pass in the later
458-case selection. Current type checking, lint, SDK build and zero-tick package
checks pass. Three actual physical push/restart/equivalence cases remain held,
along with GPU/replay/benchmark checks. No actual trajectory or performance
acceptance is claimed.

### Ordered action-boundary journals

`session.branch({horizonTicks, captureJournal: true})` opts into a combined journal
for interventions and complete simulation ticks. Inspect it with
`branch.journal()` or retain it through `commitResult.journal()`. Capture implies
`captureMotion: true`; explicitly disabling motion while requesting a journal
rejects. `journalMaxRuns` controls sparse report detail per boundary (default
2,048, allowed zero through 4,096). `motionMaxEntries` controls each tick/domain
trace as described above. Supplying either limit requires its capture feature.

```js
const candidate = session.branch({
  horizonTicks: 2, captureJournal: true, journalMaxRuns: 1024,
});
candidate.translate({cells: [[1, 1, 1]], path: [[1, 0, 0]]});
candidate.addEnergy([{x: 2, y: 1, z: 1, deltaQ: 256}]);
candidate.setGame({...candidate.inspect().game, ap: 1});
await candidate.advance(2); // Actual physics; the runtime hold still applies.
const journal = candidate.journal();
// Check journal.status before relying on detailed coverage, then commit/discard.
```

The `action-boundaries-1` result has `scope: 'action-boundaries'`, the immutable
base revision, and the preview or committed target identity. It records every
successful edit, translation, transfer, hold/release, thermal intervention and
game-state replacement, plus each complete logical simulation tick. Each event
has an `operation`, `from`/`to` boundary (`sequence`, absolute `tick`,
`completedTicks`), `action`, `changes` and tick `motion`. Multiple ticks in one
advance share an operation number but have distinct sequential boundaries.
`advance(0)` does not invent a physical event. No-op edits remain explicit action
boundaries with empty change channels.

Each event's change report compares its own adjacent boundaries across the whole
primary world and every reservoir. Material, phase, energy, exact temperature,
structure, constraints and global support are independent channels with the same
counts, bounds and runs contract as endpoint reports. Support is assessed with
temporary anchors applied. Every cell is considered, including distant support
changes; the initial edit box never limits coverage. Game/accounting flags cover
that boundary too. Tick events include all domains, hold expiry and the resulting
game policy update. Heating then cooling, removing then restoring an anchor, or
moving matter out and back remains visible even if final endpoints match.

Translation, transfer and energy actions retain portable copies of their receipts.
Translation typed arrays become ordinary arrays and its external-energy bigint
becomes a decimal string. Hold/release actions retain the affected hold's ID,
expiry and cells. Edit/game actions record external thermal delta and the actual
changed channels; they do not retain raw commands or game-state payloads.
Tick events include a validated observed motion trace for each domain in order.
These records are serializable derived observations, not commands for replay or
an alternative authoritative save.

Coverage is explicitly bounded:

- `complete`: every action/tick boundary and all retained sparse/receipt/motion
  detail fit. This covers the declared boundaries, not continuous trajectories.
- `coarse`: every boundary is retained, but one or more change channels exceeded
  `journalMaxRuns`. Exact counts and complete spatial bounds remain; those channels
  have empty runs and `requiresFullRead: true`. Use the bounds for conservative
  invalidation. Exact cell inspection needs the stamped intermediate state; if
  it was not retained separately, recompute from the action's original revision.
- `overflow`: a hard journal limit or an incomplete motion trace prevented full
  coverage. All events are dropped, `requiresReexecution` is true, and no prefix
  is presented as complete. Boundary and domain/tick counts remain available.
- `disabled`: capture was not requested. An empty event list carries no evidence
  that the action had no changes; complete history requires re-execution.

The hard limits are 256 events, 256 domain/tick observations and 65,536 variable
detail entries across the branch. An entry is a sparse change run, a motion run
or fragment header/member run, a receipt source/destination/edited-cell index,
cut edge, path step, released anchor, thermal change or held-cell index. Fixed
metadata is bounded by event/domain counts. The budget is checked before copying
receipts and event detail. Once the journal overflows, further boundaries update
its counters without adding support observations. Whole-journal limits cannot be
raised with a per-trace or per-report option. Actions that require complete history
must reject unsupported coverage; splitting a live transaction would change its
atomicity. The standalone `.motion()` journal retains its own independent budget.

Synchronous interventions and each entire `advance()` stage their journal changes
privately. Failed report generation, invalid motion, cancellation, game-policy
failure or driver cleanup failure invalidates the candidate without publishing
partial terrain/game/history. Guarded support observers cannot reenter mutation
or publication. Inspection returns copies. Committed journals remain bound to
their original revision after later commits/restores; saves omit all capture
settings and journal data.

Capture adds synchronous whole-domain scans and potentially two global support
assessments per changed domain per boundary. Default branches add no such work.
This CPU reference has no latency or responsiveness guarantee. Net tick motion
and selected intervention routes do not describe sub-pass paths, displaced
occupant trajectories or actor collisions. Support assessments describe complete
boundaries, not intermediate structural-pass events. GPU production, streaming,
incremental support reuse and actor integration remain required later work.

The 27 edit/inert-driver regressions pass; three separately held real-physics
cases remain unexecuted. Type checking and lint pass. All 201 selected edit/mock
cases passed with zero skipped under the reviewed bounded harness; see the
[validation receipt](checkpoints/tactical-interventions/validation-08-2026-10-17/summary.json).
That evidence does not prove actual physics evolution, exact replay or GPU/performance
acceptance. The SDK has since been rebuilt and passed the bounded zero-tick
package checks below. The runtime hold and legacy quarantine remain active.

### Conservative translation observations (Build 14, runtime validation pending)

The tactical-session entry now exports `translateStructuralRegionWithPaths3D`,
`TRANSLATION_PATH_RULES_3D` (`translation-paths-1`) and
`TRANSLATION_PATH_LIMITS_3D`. The wrapper executes the unchanged v1 material
translation once, then expands its canonical receipt. Each pass records controlled
cells as cardinal `linear` segments and each terminal occupant as a `relocation`
to its run head. `origin` identifies the original cell, including across turns
and round trips. A relocated occupant has no implied transit through the slab.
`derivation: 'canonical-receipt-expansion'` distinguishes this record from observed
physics. Reconstruction must match every resulting packed, energy and structure
coordinate after explicit bond cuts and anchor releases; mismatches throw.

`maxEntries` defaults to 4,096 and permits 0 through 65,536. Retained original
controlled identities, pass headers and movement segments each consume an entry.
Overflow drops all identities/passes, sets `requiresReexecution: true` and retains
`controlledCells`, `stepsObserved` and `cellTransfers`. The conservative operation
still finishes. An empty overflow record never establishes that nothing moved.
The existing cell/path/work limits still apply. Retention bounds do not establish
latency: this CPU wrapper adds a complete-state scan and receipt reconstruction.

`branch.translateWithMotion(request, {maxEntries})` returns an action with an owned
receipt, lazy `beforeQueries()` and `queries()`, and `movement()`. Its geometry and
movement stamps identify the before/after operation at the same absolute tick.
Views remain tied to those preview boundaries after later edits, discard or
commit. Public reports are isolated; serialized copies do not carry live geometry
provenance. Keeping an action/view retains its underlying boundary state until
the application releases it. Neither these observations nor capture options are
added to authoritative saves. Existing action journals retain the original
translation receipt; tick motion/path journals remain tick-only.

An optional synchronous `reduceTranslation` policy stages application state
alongside the translated terrain:

```ts
const session = createTacticalSession3D(initial, {
  reduceTranslation({game, movement}) {
    if (movement().requiresReexecution) throw Error('Translation history incomplete');
    if (game.ap < 1) throw Error('Insufficient action points');
    return {...game, ap: game.ap - 1};
  },
});
const branch = session.branch({horizonTicks: 0});
const action = branch.translateWithMotion({
  cells: [[3, 3, 3]], path: [[0, -1, 0]],
  externalBonds: 'cut', anchors: 'release',
});
const candidateGeometry = action.queries();
// Apply game-specific acceptance policy before committing the candidate.
session.commit(branch);
```

The reducer also receives an owned `receipt`, the unchanged `tick`, and those lazy
before/after queries. Normal `translate()` automatically captures paths when this
policy is installed; without it, normal translation keeps its existing route.
Policy function references are fixed at session creation. Version changes to game
policy through the application's `gameRulesVersion`. Throwing, reentry, async or
nonportable returns invalidate the candidate; later commit validation can still
reject it. Game state, thermal accounting, holds, reservoirs and terrain publish
only through the existing atomic commit. Callback side effects outside the session
are not rollbackable, so policies must remain pure.

This boundary alone does not carry or push actors during a translation. The
terrain-motion/displacement helpers accept logical-tick observations; the
Build 15 adapter below consumes translation observations. Neither adds forces,
support-capacity solving or an intermediate structural tick to a translation.

All 36 edit/inert regressions pass within the 458-case selection. Current type
checking, lint, SDK build and zero-tick package checks pass. Three separate
physical continuation cases remain held; GPU/replay/benchmark verification is
also held. See the [bounded SDK evidence](checkpoints/tactical-interventions/build-16-2026-10-17/sdk-validation.json)
for source hashes and the distinction between executed checks and runtime gates.

### Actors during translations (Build 15, runtime validation pending)

`createTranslationDisplacement3D(beforeQueries(), queries(), movement())` accepts
the three accessors from one translation action or `reduceTranslation` callback.
It binds to the private boundary states and canonical receipt expansion. Cloned
reports and same-looking views from another action cannot supply that provenance.
The context is reusable across actors, with independent per-body work budgets.

`resolve(body, options)` applies `translation-displacement-1`: exact rational
normal pushes, closed boundaries, stationary obstacles and conservative pass
occupancy. It shares its contact solver with tick displacement. Linear controlled
movement is swept; displaced terminal occupants have endpoint-only relocation
contacts. Liquids/gases do not supply blocking forces or supporting faces.

A grounded actor may ride the first translation pass only when every exact
contacting support is controlled solid, frozen or powder material. Mixed fixed
support or the closed world floor does not authorize carry. Each later pass
rechecks support at the previous completed pass boundary, allowing a platform
that has just arrived under an actor to carry it. Carry requests follow the
cardinal translation direction. Contacts may constrain that movement: a side wall
can stop the actor while its platform continues, leaving the actor unsupported.
This geometric carry rule does not calculate friction, weight capacity or forces.

Successful results change body position and footing. Saved velocity, gravity and
actor step remain unchanged because a translation does not advance physical time.
`movedQ` is realized displacement. `carries` contains `{pass, requestedQ, origins}`:
eligible requested support motion and original material identities, which may
differ from realized travel. Contacts retain exact pass/time, original cell,
material/energy and boundary identity. Translation contacts have no fragment ID.

`crushed` means opposing constraints under this kinematic rule; it is not a general
rigid-body impossibility proof. `embedded` includes displaced material landing
inside a body. `outside` and `incomplete` are explicit. All unsuccessful responses
return the original body and zero committed `movedQ`. Incomplete responses also
clear contacts, crush witnesses and carry detail, with `requiresReexecution: true`.
The application decides whether to reject the entire action or apply game rules.

Options share the tick-displacement bounds for `maxContacts` (default 256, maximum
4,096), `maxEvents` (128/512) and `maxWork` (262,144/1,048,576). `maxCarryEntries`
defaults to 4,096 with maximum 65,536; each carry header and original support cell
costs an entry. Support scans consume candidate work. These are whole-translation
per-body bounds; they are not a measured frame budget or a limit on the number of
actors the game asks to resolve.

```ts
const session = createTacticalSession3D(initial, {
  reduceTranslation({game, beforeQueries, queries, movement}) {
    if (game.ap < 1) throw Error('Insufficient action points');
    const response = createTranslationDisplacement3D(
      beforeQueries(), queries(), movement(),
    ).resolve(game.body);
    if (response.status !== 'resolved') throw Error('Actor motion unresolved');
    return {...game, body: response.body, ap: game.ap - 1};
  },
});
```

The session commits this actor update together with terrain and AP. An exception
invalidates the candidate, preserving the complete live state. Policies must
remain pure and versioned through `gameRulesVersion`. Actor-actor collisions,
actor loads, force feedback and time-based gravity are still separate work. No
authoritative material, bond, damage, energy or thermal-accounting coordinate is
changed by the response itself.

All 33 new edit-only cases and the existing tick-displacement cases pass within
the 458-case selection. Current type checking, lint, SDK build and zero-tick
package checks pass. The three physical continuation cases, GPU/replay and
benchmarks remain held, and legacy demos stay quarantined. See the
[bounded SDK evidence](checkpoints/tactical-interventions/build-16-2026-10-17/sdk-validation.json).

### Bounded actor groups (Build 16, runtime validation pending)

Use `createTerrainBodyGroup3D(before, after, movement)` for a live logical-tick
observation and `createTranslationBodyGroup3D(before, after, movement)` for a live
translation observation. Both reuse the existing displacement rules and expose
`resolve([{id, body}, ...], options)`. They share one immutable terrain context
across at most 64 actors. IDs are unique ASCII identifiers of at most 64 characters
using letters, digits, `.`, `_`, `:` and `-`, starting with a letter or digit.
Resolution uses code-point identifier order, independent of input order or locale.

All row shapes, IDs and saved body formats/bindings validate before any actor is
resolved. Geometrically embedded/outside bodies remain explicit response failures.
`maxWork`, `maxEvents`, `maxContacts` and `maxCarryEntries` now apply across the
entire group; each later actor receives only the remaining allowance. Defaults
and maxima are those of translation displacement above. Tick groups retain zero
carry entries because tick fragment support is represented by their existing
result contract. An empty group resolves without evaluating any body, including
when all budgets are zero; it makes no claim about material-path completeness.

The `terrain-body-group-1` result has a scope and original boundary stamps:

- `resolved`: `bodies` and `responses` contain every actor in canonical ID order.
- `unresolved`: the first actor in that order is crushed, embedded or outside.
- `incomplete`: an actor cannot resolve within the available path/detail/work
  coverage; `requiresReexecution` is true.

Both failure statuses return every **original** body, an empty `responses` array
and one `failure: {id, response}`. Successfully evaluated prefixes are never
returned as a partial group update. `evaluatedBodies`, `work` and `events` describe
actual attempted resolution, including the failing body. Returned body arrays and
diagnostics are isolated from inputs and future calls. These are query results;
session publication still happens through the application reducer and commit.

```ts
reduceTranslation({game, beforeQueries, queries, movement}) {
  if (game.ap < 1) throw Error('Insufficient action points');
  const group = createTranslationBodyGroup3D(
    beforeQueries(), queries(), movement(),
  ).resolve(game.units, {maxWork: 262144, maxEvents: 128});
  if (group.status !== 'resolved') throw Error('Unit group motion unresolved');
  return {...game, units: group.bodies, ap: game.ap - 1};
}
```

An exception preserves all live units, terrain, AP and accounting through the
existing transaction guard. Store the resulting portable bodies in game state;
the group context remains disposable and tied to its original observation.
Actors still resolve independently against terrain and may overlap one another.
This API does not introduce actor-actor collision, load feedback or damage policy.
The hard actor count bounds repeated geometry setup outside candidate-work
counters, but aggregate counters do not prove wall-clock responsiveness.

All 22 edit/inert group cases pass within the 458-case selection. Current type
checking, lint, SDK build and zero-tick public-package checks pass. The three
actual-physics group cases remain held, as do runtime/GPU/replay/benchmarks.
Legacy demos remain quarantined.

### Tactical SDK verification

On 2026-10-17, all 458 selected edit/inert cases passed without skips. A subsequent
type check found a widened geometry-stamp literal; the repair adds only a type
import and annotation. Full no-emit type checking and lint then passed. All eleven
SDK entry bundles and their declarations rebuilt successfully, followed by the
public interventions and tactical-session checks in separate bounded stages.

Those package checks use 4-cubed worlds and zero-horizon transactions. They cover
state-preserving translation, transfer, saved holds, accounted heat, transaction
publication and geometry; later motion APIs receive export-presence checks only.
They do not advance physics, invoke support solves, compile WGSL or acquire a GPU.
They use package self-imports in this checkout, not installation into an external
consumer. The 35 separate physical cases, replay, GPU and frame measurements
remain pending. See the [source hashes, output hashes, limits and cleanup receipts](checkpoints/tactical-interventions/build-16-2026-10-17/sdk-validation.json).

### Supersedable targeting previews

`createTacticalPreviewQueue3D(session, prepare)` adds optional latest-request
scheduling to the tactical-session entry. It keeps at most one executing preview
and one waiting command. Submitting a newer valid command supersedes both the old
waiting request and any active preview; the successor starts only after the
active branch has reached a cancellation boundary and finished driver cleanup.
No obsolete preview publishes terrain, units or AP automatically.

```ts
const previews = createTacticalPreviewQueue3D(session,
  (editor, command: {x: number; y: number; z: number; cost: number}) => {
    const game = editor.inspect().game;
    if (game.ap < command.cost) throw Error('Insufficient AP');
    editor.translate({cells: [[command.x, command.y, command.z]], path: [[0, -1, 0]]});
    editor.setGame({...game, ap: game.ap - command.cost});
  });
const ticket = previews.request({x: 3, y: 4, z: 2, cost: 1}, 8);
const outcome = await ticket.result;
if (outcome.status === 'ready' && previews.state.readyId === ticket.id) {
  // Present outcome.preview. On explicit player confirmation:
  const committed = previews.commit(ticket);
}
await previews.close();
```

The command is a copied, bounded `TacticalValue`; the horizon is an integer from
0 through 1,024. Both validate before accepted work is superseded. Each request
retains its submission revision and horizon. A changed world makes it stale;
the queue never rebases it silently. The synchronous preparation callback gets
a frozen, temporary editor for branch inspection, queries, edits, translation,
transfer, holds, energy and game state. It has no advancement, commit or discard
method, and retained editor methods reject after the callback returns. Async
preparation and queue reentrancy during preparation reject. As with other game
policies, callbacks must not mutate external application state or the session
through unrelated captured references.

Tickets resolve explicitly as `ready`, `superseded`, `cancelled`, `stale`,
`closed` or `failed`. A ready outcome includes an isolated preview; changing it
cannot change the private commit candidate. It is a historical result, not a
permanent commit permit: only the latest owned ready ticket can commit while
its base revision is unchanged. `ticket.cancel()` invalidates that ticket;
`close()` invalidates all outstanding work and waits for cleanup. The first
cancellation reason is retained. A cleanup failure takes precedence, fails the
queue closed and prevents waiting work from starting; `state.error` reports it.

`tactical-previews-1` is a scheduling contract, not a new physical rule. Horizons
are advanced in batches of at most 32 using the existing session yields and
complete-boundary cancellation. No ticks are skipped. Outstanding requests are
bounded, but a synchronous physical tick, snapshot copy or preparation callback
is not preemptible. The queue does not move simulation to a worker or guarantee
frame latency. Use one queue per session; unrelated external advancement remains
subject to the session's existing single-flight guard.

Queued previews can opt into the existing execution observations:

```ts
const ticket = previews.request(command, 8, {
  motion: {maxEntries: 4096},
  paths: {maxEntries: 4096},
  journal: {maxRuns: 256},
});
const outcome = await ticket.result;
if (outcome.status === 'ready' && previews.state.readyId === ticket.id) {
  const motion = previews.motion(ticket);  // net correspondence per domain/tick
  const paths = previews.paths(ticket);    // executed subpass crossings
  const actions = previews.journal(ticket); // interventions and tick boundaries
  // Inspect status/overflow flags before using these observations.
}
```

The optional third argument is `TacticalPreviewCapture3D`. An empty nested object
enables that capture at its existing default budget; omitting it retains session
policy defaults. Paths and journals imply motion capture. The queue has no
capture-disable option, so it cannot disable a reducer's required paths. Invalid
fields, accessors and budgets reject before replacing accepted work. Input
options are detached synchronously. Motion/path budgets are 0–65,536 entries per
domain tick; journal change runs are 0–4,096. Existing cumulative journal limits
still apply. Journal capture can invoke global support observations during
intervention staging, even for a zero-tick action.

These three lazy reads return isolated, revision-stamped records from the latest
owned ready ticket, without advancing simulation. Cancel, supersede, commit,
restore or close invalidates its read permit. Historical returned copies remain
usable as historical data. A commit's existing `motion()`, `paths()` and
`journal()` retain the same captured detail under a committed target. Motion and
paths cover simulation ticks only; action journals also cover interventions.
`disabled`, `coarse` and `overflow` never mean an empty complete observation.
Paths can describe a crossing even when the final cell equals the starting cell.

The worker client also accepts these capture options. It exposes committed
net-motion and path reads below; action-journal transport and precommit worker reads
remain pending. Physical execution and native-worker verification remain held.

Build 21 passed 578 selected edit/inert cases, full no-emit types, lint, all eleven
SDK builds/declarations and zero-tick package integration. The first SDK quiet
gate refused launch; a fresh gate on the next continuation passed. The original
refusal and pending receipt remain recorded. See the
[completed evidence](checkpoints/tactical-interventions/build-21-2026-10-17/summary.json).

Build 17 passed **481 selected edit/inert tests**, including 23 queue cases,
followed by full types, lint, SDK build and zero-tick public-package integration.
Three new actual-physics cases are authored and held, bringing the held physical
selection to 38. GPU, replay, performance and worker/render responsiveness remain
separate gates. [Build 17 evidence](checkpoints/tactical-interventions/build-17-2026-10-17/summary.json)
retains exact source/output hashes and containment cleanup.

### Worker-owned targeting previews

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

See the [public-SDK bootstrap example](../examples/tactical-worker/README.md).
It is not an automatically running demo. Mock transport tests and zero-tick
package integration passed. Native Worker execution, physical
replay and frame timing remain held. Full snapshot serialization and validation
still impose main-thread costs; this API carries no measured latency guarantee.
See the [Build 20 evidence](checkpoints/tactical-interventions/build-20-2026-10-17/summary.json)
for exact source/output hashes, containment limits and stage receipts.

### Committed worker geometry batches

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

### Worker reports for a committed action

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
does not yet provide incremental graph maintenance or swept-contact path transport.

### Captured worker motion

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
protocol 4. See the [completed evidence](checkpoints/tactical-interventions/build-22-2026-10-17/summary.json).
Native worker, physical/replay, GPU and latency acceptance remain held.

### Captured worker paths

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
[completed evidence](checkpoints/tactical-interventions/build-23-2026-10-17/summary.json).
Native worker, physical replay, GPU and frame acceptance remain held; this API
provides no measured latency guarantee.


### Ready preview geometry (Build 24)

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
in the [completed evidence](checkpoints/tactical-interventions/build-24-2026-10-17/summary.json).

All 96 protected source/configuration hashes match. Physical stepping/support,
replay, native Worker, GPU and frame acceptance remain held; legacy demos stay
quarantined. Passing these CPU/mock gates does not establish physical replay or
frame latency, or complete the broader tactical wishlist.
### Worker action histories (Build 25)

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
[The retained checkpoint](checkpoints/tactical-interventions/build-25-2026-10-17/summary.json)
records source hashes, bounded execution and cleanup. Real physical trajectories,
native Worker execution and GPU/replay/frame tests remain held. Legacy demos stay
quarantined. This API adds no performance claim.

### Tactical application reference (Build 26)

[`examples/tactical-slab/`](../examples/tactical-slab/README.md) integrates the
public SDK in a deterministic hot-slab scene. An application-owned policy lifts
existing damaged matter into a firing line, carries its rider, spends AP, accounts
for heat, saves temporary control and atomically accepts or rejects the entire
action. Local and worker ownership share the same preparation and policy, with
an eight-tick application horizon limit enforced in both paths.

The reference is a headless application model for a future tactical UI. Importing
it starts no simulation, Worker or renderer. The normal preview defaults to two
real M5 ticks; explicit zero-tick mode inspects only edits. The controller exposes
separate committed and private-candidate observations and saves complete terrain,
unit, resource, turn/RNG and hold state. Terrain response, then fixed-point body
gravity, runs at each complete tick when physical advancement is enabled.

All 699 selected edit/inert cases, types, lint, SDK packaging and built-public-entry
integration passed under the bounded CPU harness. The reference package check
exercised lift/preview/commit/save/restore/heat at zero physical ticks. Four authored
physical scene cases remain held; no physical support outcome, native Worker,
visual result, replay or frame latency is claimed by these gates. General swept
actor-actor collision and external loads remain later work.

The tactical chamber application now uses `hot-slab-game-2`: its worker-owned
air command selects a unit/direction, costs one AP and requires 1–8 preview ticks.
It stages one private intent, applies the impulse after first-tick terrain
displacement, then continues from saved velocity. Pending intents cannot commit;
complete saves contain `pendingAir: null`. Version 1 chamber saves are explicitly
incompatible with the changed actor rules. The UI exposes unit/direction controls,
positions and velocities through its existing preview/A/B/commit flow. Native
execution and the two authored coupled-material air cases remain held.

### Actor movement and air assistance

`moveTerrainActors3D(view, bodies, commands?)` resolves up to 64 named bodies
against the current terrain and one another. It is exported from the tactical
session entry with `ACTOR_MOVEMENT_RULES_3D = 'actor-movement-1'`. An optional
command `{id, impulseQ?, accelerationQ?}` adds to saved velocity and gravity;
all vectors use the existing integer scale of 1,024 per voxel. Speeds retain the
body limit of 32 voxels per step. All bodies must share a body-step counter and
the view's world/domain/physics identity. This actor step does not advance the
material tick; the application chooses its place in the turn/tick sequence.

```ts
const candidate = session.branch({horizonTicks: 0});
const game = candidate.inspect().game;
const motion = moveTerrainActors3D(candidate.queries(), game.units, [
  {id: 'air-specialist', impulseQ: [1024, -512, 0]},
]);
if (motion.status !== 'resolved') throw Error('Actor movement is unresolved');
candidate.setGame({...game, units: motion.bodies, ap: game.ap - 1});
session.commit(candidate); // The game owns AP, range, targeting and ability policy.
```

Ordering is a versioned part of the contract: ascending ASCII actor ID, then
X/Z/Y axis sweeps. A body sees earlier actors at their completed poses and later
actors at their starts. This conservative serial priority can make a trailing
actor wait even when its leader will move later. Render `responses` and their
`segments` in that order when representing the exact path. They do not describe
simultaneous trajectories. Peer contact clips motion without pushing, momentum
exchange, implicit carrying or damage; the terrain movement APIs handle observed
terrain-driven carry separately. Terrain wins equal-distance contact ties; peer
ties use actor ID. Face contact permits separation and tangential sliding.

Results retain the complete geometry stamp, ordered contact witnesses, final
exposure and footing before/after the whole group move, including peer IDs and
exact contact areas. Peer footing is positional contact, not an external terrain
load or a bond. A peer leaving later in the sequence removes final footing; the
actor can fall on its next movement step. Commands do not add thermal energy or
simulate wind in material cells. Applications account ability costs themselves.

Invalid input throws before movement. Any initial embedded/outside/overlapping
body returns `status: 'unresolved'`, the original whole group, no response prefix
and a failure witness. Successful outputs own their body arrays. Saving the body
states retains velocity/gravity for exact continuation; no movement cache is
authoritative. The function has no timers or submissions. Per-query terrain
budgets and the 64-body limit bound its work; no frame-time guarantee is claimed.
Use it within the same branch transaction as terrain, resources and RNG changes.

### Private branch storage

Tactical branches share private validated snapshots until an edit or completed
tick replaces the affected state. Branch creation and advancement setup avoid
the former eager copies of all primary-world and reservoir cell coordinates.
Public snapshots, policy arguments and driver inputs still receive isolated
copies; input validation, publication validation and transaction semantics stay
the same. There is no public storage-mode switch or snapshot-format change.

This removes two coordinator copies per branch/advance pair. It does not remove
edited-domain copies, driver buffers, query validation, worker transfers or public
snapshot copies. Verification compares the shared strategy with eager copying
using frozen private nodes and zero/inert ticks. Physical replay and wall-clock
latency remain separate acceptance gates; this is not chunk-level copy-on-write
or incremental structural solving.

# Experimental tactical rendering boundary

`state-space-engine/experimental/3d/tactical-renderer` provides disposable
presentation caches for committed tactical snapshots and completed previews.
It is separate from existing terrain renderers. Its CPU/mock contract has a
dedicated verification gate; native WGSL, pixel correctness and latency require
future bounded hardware acceptance. It does not add physical rules.

```ts
import {prepareTacticalScene3D, createTacticalRenderer3D}
  from 'state-space-engine/experimental/3d/tactical-renderer';

// Prepare once per published boundary. Decorations require the complete stamp
// from the corresponding committed or ready-preview geometry view.
const scene = prepareTacticalScene3D(snapshot, {
  stamp: geometry.stamp, actors: actorBoxes, overlays: targetingBoxes,
});
const renderer = await createTacticalRenderer3D(device, {
  colorFormat: 'bgra8unorm', depthFormat: 'depth24plus',
});
await renderer.render(scene, camera, {color: colorTexture, depth: depthTexture});
await renderer.close();
```

The host owns the WebGPU device and both textures. Targets must be matching
single-sample, single-mip, two-dimensional render attachments (one layer), no
larger than 8,192 pixels per dimension. Color is `rgba8unorm`, `bgra8unorm` or
`rgba16float`; depth is `depth24plus` or `depth32float`. Every frame clears both.
Device ownership and destroyed-resource validity are checked by WebGPU itself;
those errors fault the renderer. It never destroys the device or host textures.

One voxel is one world unit, +Y is downward, and geometry boxes use integer
coordinates at scale 1,024. Cameras use world-unit eye positions, orthonormal
right/up/forward axes, vertical FOV in radians and explicit near/far distances.
Depth is zero to one. `projectTacticalPoint3D` maps fixed-point points to target
pixels for labels; this visual floating-point calculation is not simulation.

`TACTICAL_CAMERA_WGSL_3D` defines the 96-byte uniform at group 0 binding 0 and
`projectWorld`. Hosts can create compatible vertex pipelines with
`renderer.cameraLayout`. The optional synchronous `render` callback receives
the borrowed pass, camera binding, full scene stamp and target dimensions after
terrain/actors and before overlays. Bind the supplied camera at group 0. Do not
end/retain that pass, submit work, return a value/promise, or reenter rendering.
Use the same depth format and attachment for custom actors/effects. Terrain and
opaque actor boxes write depth; outlined targeting boxes test it without writing.
The host is responsible for its custom pipeline and effects. There is no shared
canvas configuration, transparency ordering or naturalistic postprocessing yet.

The renderer supports finite volumes up to 128 per axis (subject to device
limits), 64 actor boxes and 256 overlays. Faces are generated on the GPU. A new
prepared object triggers uploads and face generation even if it has the same
stamp; the exact same prepared object reuses caches on camera-only frames.
Preparation validates/copies the full snapshot and has no claimed latency bound.
Prepared objects are opaque, local disposable handles, not saves or worker wire
data. Transfer snapshots to the rendering owner and prepare there. Nothing in a
render cache is authoritative, and preparation never steps/support-solves.

At most one frame is outstanding, with one submission/completion boundary and
no internal loop, retry or backlog. Invalid input rejects before writes and
leaves the renderer usable. Encoding/device errors stop it until recreation;
`state()` retains the last successfully completed identity, not a guarantee that
the host target pixels survived a GPU failure. `close()` drains pending work
before freeing caches. A hung GPU cannot be preempted by this API; external
watchdog containment remains required for native acceptance.

### Saved material transport (experimental)

The tactical-session entry exports `createMaterialTransport3D`,
`readMaterialTransport3D` and `applyMaterialTransport3D`. The separate
`material-transport-1` envelope saves a complete M5 terrain snapshot, an independent
cycle count and up to 256 named parcels with integer velocity and fractional travel.
This is an explicit conservative intervention, not an M5 tick or a pressure solver.
Creating, reading and applying it returns isolated storage. Store the whole envelope;
do not reuse its parcel coordinates after separately stepping or editing its terrain.

```ts
import {
  createMaterialTransport3D, readMaterialTransport3D, applyMaterialTransport3D,
} from 'state-space-engine/experimental/3d/tactical-session';

// The selected cell must already contain mobile, unbound, non-air matter.
let flow = createMaterialTransport3D(terrainSnapshot, [
  {id: 'spray', cell: [1, 1, 1]},
]);
flow = applyMaterialTransport3D(flow, [
  {id: 'spray', impulseQ: [512, 0, 0]},
]).state; // Half a cell of saved travel; no lattice swap yet.
flow = readMaterialTransport3D(JSON.parse(JSON.stringify(flow)));
const next = applyMaterialTransport3D(flow); // Momentum persists without another impulse.
// Commit next.state with game costs through an application transaction.
```

One cell is 1,024 units. Velocity is bounded to ±2,048 per axis per cycle;
fractional travel is signed and strictly less than one cell. Impulses add to saved
velocity once, and an out-of-range sum rejects the entire operation. The fixed
order is ASCII parcel ID, then X/Z/Y sweeps, with every crossed cell checked.
Reordering seed or impulse arrays cannot change results. Saved parcel rows must be
canonical by ID, and IDs/cells must be unique. M5 complete-chunk geometry and its
snapshot identities remain required; odd/single-cell M5 volumes reject.

Parcels may contain gas, liquid, powder, molten/viscous matter or completely failed
unbound solid debris. Intact, bonded, anchored and damaged-but-cohesive matter is
excluded. Each unit move swaps all three M5 coordinates with untracked gas,
including that gas's thermal history. Other parcels, non-gas occupants and world
boundaries block. Contact clears only the blocked velocity/fraction; tangential
motion continues. There is no pushing, momentum exchange, drag, mass-scaled force
or kinetic heating law. Thermal energy and material counts are conserved exactly;
`externalEnergyQ` is `'0'`, and the M5 absolute tick does not advance.

The receipt contains the ordered unit swaps (including value-identical swaps),
contacts, original/final parcel indices, exact edited indices and cycle bounds.
These are intervention changes, not structural-support consequences. Ability
range, costs and cycle scheduling belong to the game. The coupling helpers below
stage transport through existing transactions and follow observed material motion.
Interactive wind acceptance, combustion and actor-load work remain pending. Native
execution and performance remain held independently of CPU edit verification.

`captureMaterialTransportMemory3D(state)` produces compact
`material-transport-memory-1` data for the application's `game` object: control
records, cycle, terrain metadata/tick and selected-cell coordinate witnesses.
It duplicates no terrain arrays. `restoreMaterialTransportMemory3D(terrain, memory)`
validates those identities and witnesses before rebuilding an owned transport
envelope. Memory belongs in the same authoritative session save as terrain and
game costs. It is not an independent world/revision identity; normal branch and
save validation remain necessary, especially for equal-valued replaced matter.

Use `prepareMaterialTransport3D(editor, memory, impulses, reduceGame)` inside the
ordinary synchronous preview/worker preparation callback, or with a local branch.
It plans first, then stages one `translateWithMotion` per moving parcel and one
game write. Existing actor translation policies, hold restrictions and journals
still apply. Remaining branch operations must cover the entire cycle, including
the game write. A callback sees game state after actor translation policies, plus
the new memory and transport receipt; return updated game state with costs and
memory together. The callback executes through `updateGame(reducer)` under the
session mutation guard; attempts to commit, restore or mutate another branch
inside it reject. Callback inputs and outputs own their data. Validate saved memory
against terrain in the application policy.

```ts
prepareMaterialTransport3D(editor, editor.inspect().game.wind, impulses,
  ({game, memory}) => ({...game, ap: game.ap - cost, wind: memory}));
```

Any failure discards the entire candidate, including a late callback failure that
the application catches. The preview editor now exposes `discard()` for this
explicit abort; its authority expires when preparation returns. Successful staging
does not publish or commit. Stale bases, incomplete horizons and cancellation
continue to use the existing session/queue rules. Journals retain the ordinary
translation paths followed by the game boundary; no wire-version change is needed.

In a policy with `requiresPaths: true`, use the before/after geometry and movement
accessors from the same `reduceTick` call:

```ts
const followed = followMaterialTransport3D(
  beforeQueries(), queries(), movement(), game.wind);
return {...game, wind: followed.memory};
```

Continuation uses the coordinator's bound observation and original parcel
identities, including identical-material swaps. Cloned/foreign observations and
disabled/overflow provenance reject. It preserves saved velocity/fractions and
the transport cycle count; only the material tick/witnesses advance. Immobile or
air results retire control with an explicit report, while the matter remains in
terrain. Condensed liquid remains controlled. There is no automatic extra impulse
or transport cycle. Actual M5 coupling/replay and native worker responsiveness
remain held acceptance gates; CPU tests use synthetic, complete provenance.
