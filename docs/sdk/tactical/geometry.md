# Tactical geometry, actors and transport

[SDK index](../../SDK.md) · [Current validation and support](../../VALIDATION_STATUS.md)

These APIs are experimental. The support matrix above defines current qualification;
section-specific limits and runtime holds still apply. Historical implementation
steps and acceptance records remain in the [checkpoint history](../../checkpoints/TACTICAL_INTERVENTIONS.md).

- [Gameplay geometry views](#gameplay-geometry-views)
- [Kinematic bodies and material exposure](#kinematic-bodies-and-material-exposure)
- [Endpoint change reports](#endpoint-change-reports)
- [Actor movement and air assistance](#actor-movement-and-air-assistance)
- [Saved material transport (experimental)](#saved-material-transport-experimental)
- [Terrain-driven actor peer contacts](#terrain-driven-actor-peer-contacts)
- [Chamber wind and translation continuity](#chamber-wind-and-translation-continuity)

## Gameplay geometry views

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
[bounded scope below](sessions.md#tactical-sdk-verification). Endpoint support reports
and optional CPU motion journals are described below; physical actor integration
remains pending.

## Kinematic bodies and material exposure

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

## Endpoint change reports

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
[motion journal](motion.md) observes executed permutations. The action journal adds
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

## Actor movement and air assistance

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

## Saved material transport (experimental)

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

## Terrain-driven actor peer contacts

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

## Chamber wind and translation continuity

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
