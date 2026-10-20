# Reactive sessions and gameplay

[SDK index](../../SDK.md) · [Current validation and support](../../VALIDATION_STATUS.md)

These APIs are experimental. The support matrix above defines current qualification;
section-specific limits and runtime holds still apply. Historical implementation
steps and acceptance records remain in the [checkpoint history](../../checkpoints/TACTICAL_INTERVENTIONS.md).

- [Atomic reactive ability previews](#atomic-reactive-ability-previews)
- [Reactive gameplay queries](#reactive-gameplay-queries)
- [Executed reactive motion](#executed-reactive-motion)
- [Reactive bodies and terrain response](#reactive-bodies-and-terrain-response)
- [Controlled translation and actor transactions](#controlled-translation-and-actor-transactions)
- [Reactive actor groups and peer-aware movement](#reactive-actor-groups-and-peer-aware-movement)
- [Reactive material transport planning and continuity](#reactive-material-transport-planning-and-continuity)
- [Atomic reactive transport abilities](#atomic-reactive-transport-abilities)

## Atomic reactive ability previews

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
This supports multi-command ability rollback. Use the reactive body, displacement and actor-group APIs in this guide for actor/terrain contacts; storing coordinates in game data alone does not solve them.

`createReactiveSessionSnapshot3D` and `readReactiveSessionSnapshot3D` manage the
portable save envelope. `restore` requires matching world/game-rules identities,
catalog and domain topology, restores saved accounting history, increments the live
revision and stales existing candidates. This session restore preserves accounting;
standalone world/domain restore still establishes a fresh baseline as documented.
Revision is an instance-local concurrency stamp, not a globally unique physical
coordinate. Preview wrappers are distinct from saves. Public observations are
isolated copies. `energyBalance()` exposes combined initial/external/current energy
and drift. Native/GPU, large-world replay and benchmarks remain held.

## Reactive gameplay queries

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
CPU observations with no measured latency guarantee. Actor carry/debris response is covered by the body and displacement APIs below; [workers](workers.md) provide the transport boundary. Physics,
save formats and runtime holds are unchanged; legacy demos remain quarantined.

## Executed reactive motion

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

## Reactive bodies and terrain response

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

## Controlled translation and actor transactions

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
it is not yet a responsive native scheduling or performance guarantee. External loads remain outside this model. Saved material transport and its coupling are described later in this guide.
Native/GPU checks and benchmarks remain held, and legacy demos remain quarantined.

## Reactive actor groups and peer-aware movement

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
Work allowances bound solver visits, not elapsed frame time. Use the [worker API](workers.md) for scheduling and the material-transport APIs below for controlled parcels. External actor loads remain outside this model.
GPU/large-world verification and benchmarks remain held; legacy demos stay quarantined.

## Reactive material transport planning and continuity

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

## Atomic reactive transport abilities

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
