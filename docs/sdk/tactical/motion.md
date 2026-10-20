# Tactical motion and action history

[SDK index](../../SDK.md) · [Current validation and support](../../VALIDATION_STATUS.md)

These APIs are experimental. The support matrix above defines current qualification;
section-specific limits and runtime holds still apply. Historical implementation
steps and acceptance records remain in the [checkpoint history](../../checkpoints/TACTICAL_INTERVENTIONS.md).

- [Observed CPU motion](#observed-cpu-motion)
- [Observed movement within a physical tick](#observed-movement-within-a-physical-tick)
- [Tactical path journals and per-tick game input](#tactical-path-journals-and-per-tick-game-input)
- [Moving supports and debris contacts](#moving-supports-and-debris-contacts)
- [Terrain-driven actor displacement](#terrain-driven-actor-displacement)
- [Ordered action-boundary journals](#ordered-action-boundary-journals)
- [Conservative translation observations (runtime validation pending)](#conservative-translation-observations-runtime-validation-pending)
- [Actors during translations (runtime validation pending)](#actors-during-translations-runtime-validation-pending)
- [Bounded actor groups (runtime validation pending)](#bounded-actor-groups-runtime-validation-pending)

## Observed CPU motion

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

## Observed movement within a physical tick

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
context below. Opt-in kinematic pushing/crush diagnostics and translation
observations are also described in this guide. Existing journals retain their scopes.

## Tactical path journals and per-tick game input

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

## Moving supports and debris contacts

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

## Terrain-driven actor displacement

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

## Ordered action-boundary journals

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
and incremental support reuse remain outside this reference. Actor-group integration
is described later in this guide.

The 27 edit/inert-driver regressions pass; three separately held real-physics
cases remain unexecuted. Type checking and lint pass. All 201 selected edit/mock
cases passed with zero skipped under the reviewed bounded harness; see the
[validation receipt](../../checkpoints/tactical-interventions/validation-08-2026-10-17/summary.json).
That evidence does not prove actual physics evolution, exact replay or GPU/performance
acceptance. The SDK has since been rebuilt and passed the bounded zero-tick
package checks below. The runtime hold and legacy quarantine remain active.

## Conservative translation observations (runtime validation pending)

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
also held. See the [bounded SDK evidence](../../checkpoints/tactical-interventions/build-16-2026-10-17/sdk-validation.json)
for source hashes and the distinction between executed checks and runtime gates.

## Actors during translations (runtime validation pending)

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
[bounded SDK evidence](../../checkpoints/tactical-interventions/build-16-2026-10-17/sdk-validation.json).

## Bounded actor groups (runtime validation pending)

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
