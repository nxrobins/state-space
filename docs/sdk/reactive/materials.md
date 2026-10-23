# Reactive materials and worlds

[SDK index](../../SDK.md) · [Current validation and support](../../VALIDATION_STATUS.md)

These APIs are experimental. The support matrix above defines current qualification;
section-specific limits and runtime holds still apply. Historical implementation
steps and acceptance records remain in the [checkpoint history](../../checkpoints/TACTICAL_INTERVENTIONS.md).

- [Reactive material definitions and portable blocks](#reactive-material-definitions-and-portable-blocks)
- [Thermal material pack v1](#thermal-material-pack-v1)
- [Exact local reactive cycles](#exact-local-reactive-cycles)
- [Conservative reactive movement](#conservative-reactive-movement)
- [Bounded reactive structural mechanics](#bounded-reactive-structural-mechanics)
- [Owned reactive worlds](#owned-reactive-worlds)
- [Existing-matter control in reactive worlds](#existing-matter-control-in-reactive-worlds)
- [Saved temporary holds in reactive worlds](#saved-temporary-holds-in-reactive-worlds)
- [Conservative reactive reservoirs](#conservative-reactive-reservoirs)

## Reactive material definitions and portable blocks

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

Readers reject holes, accessors, hidden or extra keys, symbols and typed arrays
in plain arrays and records without running caller code, so every result is
reproducible for plain data. A Proxy is read through its traps: they run, and
they decide what is read. When a trap answers an array method, such as `map`,
with a result of its own instead of the one the method would compute (another
object, a typed array, or an array holding values the reader's callback would
reject), the engine works on that result as returned, and later steps may read
it differently than earlier engine versions did, so results for such inputs may
differ between versions. Both guarantees assume an unmodified JavaScript realm.

When a caller replaces or adds members of built-in objects, their prototypes or
their constructors, the engine makes no guarantee: errors, progress at a throw
and outputs may differ between engine versions, and a tick may publish or commit
a state that an unmodified realm would not compute. Hooks, such as an accessor on
`Array.prototype` or `Object.prototype`, see engine arrays and records while the
engine works; they can steer it and can keep what they see, and caller code that
changes a kept engine object can change the world's state. Earlier engine
versions did not guard against this either. This version adds three defenses:

- At creation, at each advance, and in `result()`, `motion()` and commit, a
  world tick checks that these built-ins still read as the ones the SDK loaded
  with, and fails if one does not: the global `Array`, `Map`, `Set`,
  `Int32Array`, `Uint32Array`, `Uint16Array` and `Uint8Array`; `Array.isArray`
  and `Array[Symbol.species]`; the `slice`, `map`, `filter`, `flatMap`, `concat`,
  `push`, `sort`, `some`, `every`, `includes`, `fill`, `constructor` and iterator
  of `Array.prototype`, and the array iterator's `next`; `get`, `set` and `has`
  of `Map.prototype`; `add`, `has` and the iterator of `Set.prototype`; the four
  typed arrays' `constructor` and species; and the typed-array `slice`, `fill`
  and `set`, read through each of the four typed-array prototypes. It reads the
  global constructors by their global names and the well-known symbols as the
  SDK loaded them, as the tick does. The check reads no other getter (such as a
  typed array's `length` or a set's `size`) and no other built-in (such as
  `WeakMap`), and it does not see a replacement that reads as the original (an
  accessor that answers with it), one that caller code makes and undoes while
  a tick call runs, or one made before the SDK loaded.
- A world's `snapshot()` and `commitTick()`, the `result()` and `motion()` of
  world tick jobs, and the `result()` of evolution, reaction and structure jobs
  copy with built-ins captured when the SDK loaded, and define each element and
  field of a copy before storing into it, so no prototype setter sees a copy.
  Other methods, such as those of translations, holds, transfers and domain
  sets, copy as before.
- A world tick job's `advance()` fails, and its `cancel()` returns `false`, if
  caller code calls them while `advance()` runs. The tick jobs of a domain set
  have no such guard.

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

## Thermal material pack v1

`createThermalMaterialRegistry3D()` opts into `reactive-thermal-materials-1`
(`THERMAL_MATERIAL_PACK_3D`). It returns the 17 physical builtins plus five new
entries, using the existing reaction, movement and structure laws. Default
registries, builtin definitions and existing saves are unchanged.

```ts
import {
  createThermalMaterialRegistry3D, THERMAL_MAT_3D,
  createReactiveMaterialRegistry3D,
} from 'state-space-engine/experimental/3d/reactive-materials';

const registry = await createThermalMaterialRegistry3D();
const wax = registry.material(THERMAL_MAT_3D.WAX);
// Save the full catalog with the world; restore it before reading that world.
const restored = await createReactiveMaterialRegistry3D(
  JSON.parse(JSON.stringify(registry.toCatalog())),
);
```

| Material / exported ID | Role | Model thresholds |
| --- | --- | --- |
| `COPPER` / 32 | Conductivity 220, cohesive conductor | Melts at 120; latent interval 20 |
| `MOLTEN_COPPER` / 33 | Moving conductive liquid | Freezes at 100 |
| `CERAMIC` / 34 | Conductivity 1, cohesive thermal barrier | No modeled phase change or combustion |
| `WAX` / 35 | Low-temperature solid plug and fuel | Melts at 40; latent interval 10; ignition above 140 |
| `MOLTEN_WAX` / 36 | Moving fuel, same chemical energy as solid wax | Freezes at 30; ignition above 140 |

Thresholds use model temperature units, not Celsius. A phase transition also
requires its complete latent energy interval; a displayed threshold alone does
not imply completion. Both wax phases carry 100 chemical energy units per cell
and require adjacent oxidizer to burn. Products use the existing ash/fire roles.
Newly solidified material has no automatic bonds or anchors; cooling does not weld
it to nearby terrain. Ceramic slows heat transfer; it is not perfect insulation.

IDs 32–36 belong to this pack; the separate SDK teaching examples keep their own
IDs. The v1 factory is a fixed definition: changing its parameters requires a new
pack version. Catalog hashes bind the complete definitions, not just names or IDs.
Save the catalog rather than assuming a future default can read an old world.
These are reactive CPU materials; this factory does not extend M5/GPU contracts.

The [three material scenes](../../../examples/reactive-chamber/README.md) demonstrate
conduction, insulation and a wax valve in sparse 16³ worlds. They share the pack
catalog while the original four chamber profiles retain their builtin catalog.

## Exact local reactive cycles

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

## Conservative reactive movement

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

## Bounded reactive structural mechanics

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
work. `result()` returns isolated data only after the complete solve. Each
`advance()` call also has a fixed cost, so `advance(1)` is the slowest way to
drive a job; larger budgets finish it in less total time.

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

## Owned reactive worlds

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
untouched, including when a caller swallows a nested rejection. Terrain commit owns world state. Use [reactive sessions](gameplay.md#atomic-reactive-ability-previews) to publish application actors, AP, resources and multi-tick commands with it.

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
catalog and world with application state uses [reactive sessions](gameplay.md); the [reference chamber](../../../examples/reactive-chamber/README.md) demonstrates its worker and presentation boundary. Legacy demos stay quarantined.

## Existing-matter control in reactive worlds

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
Application/actor transactions are described in [reactive gameplay](gameplay.md).
Existing M5 contracts and legacy-demo quarantine are intact.

## Saved temporary holds in reactive worlds

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

## Conservative reactive reservoirs

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
