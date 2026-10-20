# Tactical sessions and previews

[SDK index](../../SDK.md) · [Current validation and support](../../VALIDATION_STATUS.md)

These APIs are experimental. The support matrix above defines current qualification;
section-specific limits and runtime holds still apply. Historical implementation
steps and acceptance records remain in the [checkpoint history](../../checkpoints/TACTICAL_INTERVENTIONS.md).

- [Experimental material interventions](#experimental-material-interventions)
- [Experimental tactical sessions](#experimental-tactical-sessions)
- [Temporary holds and accounted heat](#temporary-holds-and-accounted-heat)
- [Conservative finite reservoirs](#conservative-finite-reservoirs)
- [Tactical SDK verification](#tactical-sdk-verification)
- [Supersedable targeting previews](#supersedable-targeting-previews)
- [Tactical application reference](#tactical-application-reference)
- [Private branch storage](#private-branch-storage)

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

See [the wishlist acceptance checkpoint](../../checkpoints/TACTICAL_INTERVENTIONS.md)
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
[acceptance checkpoint](../../checkpoints/TACTICAL_INTERVENTIONS.md). No saved renderer
or lighting cache becomes authoritative session state.

## Temporary holds and accounted heat

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

## Conservative finite reservoirs

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

## Tactical SDK verification

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
remain pending. See the [source hashes, output hashes, limits and cleanup receipts](../../checkpoints/tactical-interventions/build-16-2026-10-17/sdk-validation.json).

## Supersedable targeting previews

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
net-motion, path, action-journal and precommit reads through the
[worker observation APIs](workers.md). Broader physical execution and native-worker
qualification remain held; see [current status](../../VALIDATION_STATUS.md).

Build 21 passed 578 selected edit/inert cases, full no-emit types, lint, all eleven
SDK builds/declarations and zero-tick package integration. The first SDK quiet
gate refused launch; a fresh gate on the next continuation passed. The original
refusal and pending receipt remain recorded. See the
[completed evidence](../../checkpoints/tactical-interventions/build-21-2026-10-17/summary.json).

Build 17 passed **481 selected edit/inert tests**, including 23 queue cases,
followed by full types, lint, SDK build and zero-tick public-package integration.
Three new actual-physics cases are authored and held, bringing the held physical
selection to 38. GPU, replay, performance and worker/render responsiveness remain
separate gates. [Build 17 evidence](../../checkpoints/tactical-interventions/build-17-2026-10-17/summary.json)
retains exact source/output hashes and containment cleanup.

## Tactical application reference

[`examples/tactical-slab/`](../../../examples/tactical-slab/README.md) integrates the
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
continuous actor collision and external loads remain outside this reference.
Discrete peer contacts are described in the [geometry guide](geometry.md).

The tactical chamber application now uses `hot-slab-game-2`: its worker-owned
air command selects a unit/direction, costs one AP and requires 1–8 preview ticks.
It stages one private intent, applies the impulse after first-tick terrain
displacement, then continues from saved velocity. Pending intents cannot commit;
complete saves contain `pendingAir: null`. Version 1 chamber saves are explicitly
incompatible with the changed actor rules. The UI exposes unit/direction controls,
positions and velocities through its existing preview/A/B/commit flow. Native
execution and the two authored coupled-material air cases remain held.

## Private branch storage

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
