# Multiphysics: physical contracts and release gates

This document specifies the new opt-in experimental model. It is not a claim
that the complete model is implemented or qualified. Existing reactive worlds
keep their original rules, catalogs, saves, and acceptance evidence. A successful
reference calculation alone does not qualify a world solver, Worker, or builder.

The intended public entry is `state-space-engine/experimental/3d/multiphysics`.
Its first milestone establishes owned parcel data, conservation references, and
strict portable input validation. Rotation/contact/fracture, coupled fluids and reactive
parity, electricity, and the builder are subsequent release gates. Electricity
must not ship ahead of the preceding gates. The independent circuit reference is
an analytical oracle for this work, not electrical simulation in a world.

### Milestone 1 reference boundary

The reference surface covers quaternion/finite-cuboid geometry, mass and inertia,
material-parcel conservation, and a small dense DC solve. It does not advance a
world, simulate contact impulses or fluid flow, discharge a battery, or expose a
builder. A cuboid overlap point is not a persistent contact manifold; a swept
bound is not collision time of impact. World serialization, Worker continuation,
and coupled numerical-error budgets remain part of the subsequent gates. Parcel
release validates stored velocity and intrinsic spin against the supplied rigid
motion (relative tolerance `1e-12`), then preserves both exactly while transferring
ownership. It cannot initialize missing motion or validate an absent body ledger.

The DC oracle admits at most 32 nodes and 256 positive-resistance connections.
Its junction-current residual is bounded by `1e-8 * max(1, sourceCurrent)` and its
power residual by `1e-8 * max(1, sourcePower)`. Ill-conditioned inputs exceeding
those bounds reject. These are reference-solve tolerances, not a new world
energy-conservation guarantee.

## State and ownership

A material parcel has persistent identity, positive mass, reference amount,
material identity, stored energy, and exactly one physical owner. A solid parcel
belongs to a bonded assembly; a fluid/gas parcel belongs to its particle system.
The authoritative state includes position, orientation, linear momentum, and
angular momentum wherever they affect continuation. Render voxels, occupied-grid
indices, pressure fields, and broad-phase bounds are derived views, not another
copy of the matter.

Mass and reference amount survive material changes. They cannot be reconstructed
from the destination material's `density`: existing water has density 100 and
steam 5; wood becomes ash; fire's legacy density is zero. Those values currently
control cellular movement/load and are not a conserved mass coordinate. A new
material profile must provide physical initialization and constitutive parameters
separately, with positive mass for directly created gas/fire parcels. Phase
changes can change occupied volume and reference density without changing mass.

Heat capacity, chemical energy, latent energy, and source energy are extensive.
A parcel's reference amount scales the catalog's thermal quantities. Splitting
one parcel must not initialize several full catalog fuel stores. The initial
release keeps parcel identities and amounts fixed during internal transitions;
physical particle subdivision/coalescence requires a later versioned transfer
rule. A co-located weighted split in the reference kernel is an accounting
decomposition, not a geometric fracture or a fluid-resolution implementation.

Assemblies retain parcel geometry in material coordinates. Reciprocal intact
bonds define connected components; ordinary contact does not weld them. Fracture
removes bonds and repartitions existing parcels. New component IDs are allocated
in canonical order and never reused. Recomputing a component's center of mass
must not move its parcels in world space.

## Momentum and energy contracts

Use documented model units for length, mass, time, and energy. Existing model
temperature thresholds remain model values, not Celsius. The new model must not
inherit a calibrated-time or SI-material claim from the old integer laws.

A finite parcel has its own inertia. For an assembly, add each rotated local
inertia and its parallel-axis contribution about the center of mass. Angular
momentum about a fixed origin includes both orbital and intrinsic contributions:

```text
P = sum(m_i v_i)
L = sum(x_i cross (m_i v_i) + I_i omega_i)
K = sum(1/2 m_i |v_i|^2 + 1/2 omega_i dot I_i omega_i)
```

On fracture or melting, parcel centers receive the original body's velocity
field, `v_i = v_center + omega cross (x_i - x_center)`. Each resulting owner also
retains the parcel's intrinsic rotation. A point particle with only position and
velocity loses the angular momentum and energy of a spinning one-cell solid;
it is not an admissible conversion. Fluid state must retain finite parcel spin
and inertia until a validated transfer resolves them into fluid motion. Storing
that spin without fluid coupling is only a representation foundation.

Freezing creates an unbonded solid with the same parcel mass, momentum, and
energy. Freezing neither anchors nor joins adjacent matter. An explicit weld
must account for the kinetic energy removed when enforcing rigid motion.

The closed-world energy inventory is:

```text
thermal + latent + chemical + battery
+ translational kinetic + rotational kinetic + gravitational potential
```

Store internal energy transfers and their fractional conversion remainders
explicitly. Exact integer transfer bookkeeping is distinct from floating-point
mechanical accuracy. Report the actual numerical residual; do not label a full
multiphysics tick `driftQ: 0` merely because thermal transfers balance. Never
repair conservation by subtracting an unexplained residual from temperature.

- Equal-and-opposite contact impulses transfer linear momentum and torque at
  their application points. Restitution and friction produce nonnegative,
  identified mechanical losses that become heat once, at the contacting parcels.
- Pressure work exchanges gas internal and mechanical energy. Physical viscosity
  becomes heat. Liquid constraints are inelastic: the net kinetic energy that
  they, and the solid support of liquid samples, remove in a tick from motion
  that was already closing becomes heat
  ([rule and limits](#inelastic-liquid-loss-paid-as-heat-2026-11-17)). Resting
  support, stabilization that adds energy, contact correction and integration
  error remain numerical residuals, not physical dissipation.
- Stationary anchors/walls receive a reported momentum reaction. Their zero
  velocity implies zero boundary work. Moving or creating anchors is an edit
  with explicit external momentum and energy accounting.
- Gravity is a conservative field with a fixed saved potential reference.
  Construction/removal/teleportation receipts include its potential-energy change
  as well as matter, internal energy, and kinetic energy.
- No internal transfer may make a store negative or overflow it. An inadmissible
  candidate fails atomically rather than clamping energy or discarding matter.

## Coupled laws

### Solids, liquids, and gases

The in-house solid solver must support arbitrary assembly orientation, manifold
contact, friction, restitution, swept collision, anchors, and heat-dependent bond
failure. Existing integer support loads do not become physical stress by adding
angular velocity. Bond demands need their own force/torque and failure contract.
See [Catto's constraint and continuous-collision references](https://box2d.org/publications/).

Liquids use the release's own mass-metric SPH density/divergence projection,
described under the private runtime checkpoint below. It borrows the two
constraints of [DFSPH](https://animation.rwth-aachen.de/media/papers/2015-SCA-DFSPH.pdf)
but is not that solver, and the release names it as its own approximation
(decision recorded 2026-11-01). Boundary impulses go back to the
solid assembly at the sampled contact positions; fluids cannot push fixed
obstacles and then ignore their forces when those obstacles become movable.
Buoyancy, displaced liquid, drag, torque, and pressure-driven failure require
measured two-way coupling. The separately retained parcel spin must participate
in angular-momentum-conserving viscous coupling before this gate passes.

Gases require a compressible pressure/internal-energy law, separate from the
liquid incompressibility solver. Pressure uses thermal energy, excluding latent,
chemical, and battery stores. Heating expands gas by doing work, and compression
raises its internal energy. The model must declare its equation of state and
fixed numerical tolerances before a gas implementation is admitted. A
buoyancy-only position shuffle cannot pass the pressure-work gate.

### Thermal and reactive capability parity

The existing catalogs supply identities, transition graphs, and model thresholds.
They do not supply heat capacity, contact mechanics, gas equations of state,
liquid viscosity, electrical resistance, or source parameters. Bind new profiles
and their units to the new rules/catalog identity; do not silently extend the old
24-column property schema.

| Material family | Required positive behavior in the new model |
| --- | --- |
| Water, ice, steam | Freezing/melting, boiling/condensation, finite latent intervals, mass-conserving volume changes |
| Stone/lava, metal/molten metal, glass/molten glass | Melting and solidification, changed mechanical ownership, no automatic welding |
| Sand and ash | Unbonded grains, settling and collisions; sand-to-glass vitrification remains irreversible |
| Oil and oil vapor | Boiling/condensation, both phases burn with finite fuel and oxidizer |
| Wood, air, fire, smoke | Consumed support, competition for oxidizer, finite chemical store, inert products and extinction |
| Copper and molten copper | Conductive thermal path survives melting where contact remains; no implied electrical law yet |
| Wax and molten wax | Low-temperature valve release, solidification and fuel behavior in both phases |
| Ceramic | Thermal barrier, bonded structural support, no invented phase transition |

Combustion remains abstract parcel chemistry rather than a molecular model. Fuel
and oxidizer pairs are uniquely owned for a reaction, and the two product parcels
retain their respective mass and momentum. Their chemical debit becomes internal
heat without resetting thermal capacity or generating free product mass. Material
changes update structure, collision boundaries, heat exchange, and later
conductive contact together. Fire/smoke labels do not create massless particles.

### Electricity and battery failure

Only after mechanics/fluid/thermal gates pass, add a quasi-static DC network with
separate electrical resistance. Structural bonds and electrical contact are
different relationships: unbonded touching copper can conduct, bonded ceramic
can insulate, and molten copper can conduct until its path separates. Conductive
liquids require the same explicit contact policy as solids.

Use positive internal battery resistance, finite stored energy, and one movable
battery per world for the first release. Two terminals belong to the assembly;
terminal contact follows geometry. Open circuits carry no sustained current.
Floating disconnected conductive components have no assigned source-relative
potential (`null` in the reference result) and no sustained current. A later
solver may choose an internal canonical gauge without inventing a source or
ground connection. Series, parallel, and short paths
must satisfy Kirchhoff residual bounds against an independent small dense solve.

Joule heating is paid from the source, including internal resistance. When a
source depletes during a fixed step, split that step deterministically at depletion
so total deposited heat cannot exceed its remaining energy. Contact changes
invalidate affected network state; solver warm starts must not connect old edges.

Structural damage disables electrical output and starts a bounded thermal
discharge. Remaining battery energy belongs to identified core parcels, never to
an assembly ID that may disappear on fracture. A core split partitions that
existing store in canonical parcel order; failed-core fragments continue the
specified discharge and cannot create fresh batteries by reattachment. Creation,
removal, and replacement are accounted external edits. AC, induction, magnetism,
semiconductors, and electrochemistry are outside this release.

## Determinism, rejection, and release evidence

Committed snapshots bind rules, profiles, units, tick/substep state, all matter,
energy remainders, source state, persistent contacts, and any solver history that
changes continuation. IDs and interactions have canonical ordering; wall time
and rendering never choose physical outcomes. A bounded job owns its candidate,
yields within declared work limits, and publishes only after all phases validate.
Cancellation, numerical non-convergence, invalid stores, and work exhaustion leave
the input unchanged. A partial candidate is never rendered as a committed world.

Use these independent acceptance cases, in addition to existing regression tests:

| Gate | Minimum independent evidence |
| --- | --- |
| Representation | Unequal-mass asymmetric assembly has analytical center of mass/inertia; fracture and spinning melt preserve world geometry, mass, momentum, and energy; malformed/duplicated ownership rejects |
| Solids | Free fall, off-center impact, tipping, sliding, resting stacks, swept fast impacts, heated fracture; refinement reduces integration error |
| Liquids | Hydrostatic column, floating body, sinking body, moving paddle, displaced liquid, viscous decay; equal-and-opposite impulses and resulting torque measured |
| Gas/reactive | Closed-gas compression/expansion work; heated plume; every family above; spinning melt/freeze and combustion during fracture |
| Dissipation | Known inelastic collision/sliding loss becomes heat once; a resting scene creates no heat; numerical corrections remain separately visible |
| Electrical | Open/series/parallel/floating/short networks, depletion, moving terminals, molten conductive paths, battery-core fragmentation without duplicated energy |
| Integration | Exact committed state across direct/Worker execution, different work budgets, cancel/retry and save/restart on each qualified runtime |
| Builder | All five planned coupled demonstrations, finite edits with receipts, inspect/preview/compare/commit/save/reload |

Every solver gate must publish fixed numerical error budgets and measured residuals
before it is marked passed; none are implied by these reference cases. The
[published budgets](#published-gate-budgets) list them case by case. Exact
Q-store and identity bookkeeping, measured mass/momentum residuals, and atomic
failure are mandatory at every gate. Reference mass and mechanical totals are
Float64 values; they do not carry an exact-integer conservation claim.
The original fixed 16³ macOS targets remain qualification targets: two-tick
preview p95 at most 250 ms, cancellation p95 at most 100 ms, completed application
frames at most 16.667 ms. The 16³ load is a world of extent 16 inside the model
caps (256 parcels, 768 bonds, 128 fluid samples, 128 solid boundary samples),
timed on six named scenes: the five demonstrations and the timed cup (26 liquid
samples and a wax body in a closed 3-wide cup). Timing transfers to no scene
heavier than the heaviest one measured. The 99-sample resolved tank is the
offline refinement gate, not an interactive load. No existing 64³/128³ or GPU qualification transfers to
this model. Raw verification artifacts remain local under the current publication
policy. Each milestone receives adversarial review before dependent work is
admitted.

### Published gate budgets

Budgets are fixed before a case is marked passed and are never widened to admit
a failure. "Digits *d*" means an absolute error below `0.5e-d`. Unit cases run
in `npm test`; runtime cases run explicitly under the supervisor with
`engine/vitest.multiphysics-fluid-runtime.config.ts` (tank) and
`engine/vitest.multiphysics-extended-runtime.config.ts` (extended, with
`--reporter=verbose` so each case reports within the supervisor's 40-second
stall deadline).

| Gate | Case (file) | Fixed budget | Measured (2026-11-01) |
| --- | --- | --- | --- |
| Solids | Free fall (`rigid.test.ts`) | Position and velocity digits 12; heat exactly 0 | Pass |
| Solids | Off-center impact (`rigid.test.ts`) | Impulse, spin and heat digits 6 at both timesteps | Pass |
| Solids | Tipping (`rigid.test.ts`) | Return/fall direction by critical angle; spin within 3% of `m g d t / I_pivot`; pivot slip below `1e-3` | Pass at 8° and 25° |
| Solids | Sliding (`rigid.test.ts`) | Friction heat `0.88`, digits 6 | Pass |
| Solids | Resting stack (`rigid.test.ts`) | Height and speed digits 7 at `dt` 0.02 and 0.01; heat exactly 0 | Pass |
| Solids | Swept fast impact (`rigid.test.ts`) | Stops at the face, digits 6; impact heat digits 5 | Pass |
| Solids | Heated fracture (`world-tick.test.ts`) | Bond breaks with products, mass and spin preserved | Pass |
| Solids | Refinement (`rigid.test.ts`, symmetric top) | Halving `dt` cuts orientation error below 0.4× and energy error below 0.6× | Pass |
| Liquids | Hydrostatic column (`world-tick.test.ts`) | Anchor reaction minus empty-cup control equals column weight × `dt` within `1e-6` relative; lateral below `1e-8` | Pass, 6 ticks |
| Liquids | Sustained rest (extended) | Speed and movement below `1e-6`, heat below `1e-9`, absolute energy below `1e-6`, two timesteps over 0.5 s | Pass |
| Liquids | Floating and sinking (tank) | Per-tick momentum residual below `1e-8` linear, `1e-6` angular; divergence `1e-7`; coarse energy below `0.006`, decreasing under refinement. Since 2026-11-17 the energy is the unexplained residual plus the constraint loss paid as heat, the same total as before | Pass, 26.7 s; totals unchanged on 2026-11-17 (`1.35e-5` wax, `1.07e-4` copper, halving with the timestep) |
| Liquids | Displaced liquid (tank) | Mean acceleration from rest is positive and at most the Archimedes value `g (rho_l - rho_s) / rho_s` | Pass: about 0.48 (wax) and 0.36 (copper) of that bound |
| Liquids | Moving paddle (extended) | Plate and liquid momentum change cancel within `1e-12`; off-center spin below `-1e-3`; total angular momentum within `1e-5`; unpaid correction below 5% of plate kinetic energy, decreasing under refinement | Pass at plate speed 0.5: correction 2.49% then 2.46%; clockwise spin `-0.19`. Since 2026-11-17 the loss is paid as heat and the unexplained energy is 0.028% then 0.014% |
| Liquids | Viscous decay (`world-tick.test.ts`) | Shear decreases every tick; heat equals kinetic loss within `1e-12`; halving `dt` changes the loss by under 1% | Pass |
| Liquids | Equal and opposite impulses (`fluids.test.ts`, `world-tick.test.ts`) | Moving boundary, gas wall and liquid-to-conductor transfers match analytic impulse and torque, digits 11–12 | Pass |
| Gas/reactive | Pressure work (`fluids.test.ts`) | Midpoint/adiabatic oracle and reflected-wall equivalence | Pass |
| Gas/reactive | Hot/cold column (extended) | Hot gas rises faster at both timesteps; energy error below `1e-4` | Pass |
| Dissipation | Rest and impact heat (`rigid.test.ts`, `fluids.test.ts`) | Resting heat exactly 0; impact heat paid once at the lever arm | Pass |
| Electrical | Networks and batteries (`circuit*.test.ts`, `battery.test.ts`, `world-tick.test.ts`) | Dense-oracle agreement digits 12; finite store bounds all Joule heat | Pass |
| Integration | Direct, mock Worker, budgets, cancel, save (`demonstrations.test.ts`) | Exact snapshot equality over the first two ticks of each demonstration | Pass |
| Builder | Visible builder, six Mac stages (`examples/multiphysics-builder/`) | Preview p95 at most 250 ms and cancellation p95 at most 100 ms through the controls; every completed frame at most 16.667 ms over at least 180 frames; receipt, compare, atomic rejection and save/restart journeys | Pass on all six timed scenes |
| Integration | Native module Worker, six Mac stages (`worker-probe.ts`) | Exact equality at work budgets 1 and 256, over 24 committed two-tick previews after cancel/retry, and after save/restart | Pass on all six timed scenes |

Liquid findings recorded on 2026-11-01, both changed on 2026-11-17 by
[paying inelastic liquid loss as heat](#inelastic-liquid-loss-paid-as-heat-2026-11-17):

- At plate speed 1 the moving paddle was rejected at impact. The plate paid
  `0.20` and `0.23` of physical impact heat on two ticks, and on the second a
  wetted row became divergence-supported and the post-drift projection removed
  `-0.041` unpaid, against the `0.01` limit. Whether an incompressible impact's
  projection loss is paid as heat was an open energy-policy decision. It is now
  paid, and the case completes at speeds 1 and 2. It is frozen as a completing
  case, not yet a gate with its own budget.
- The paddle's unpaid correction at 0.5 barely changed under refinement (2.49%
  to 2.46%). With the loss paid, the unexplained energy is 0.028% of the plate's
  kinetic energy and halves with the timestep.

### Frozen liquid and contact behaviour (2026-11-17)

Before further solver work, the behaviour of commit `06c737f` was recorded
exactly: 36 cases in
[`engine/test-support/multiphysics-frozen-cases.ts`](../engine/test-support/multiphysics-frozen-cases.ts),
with their results in
[`liquid-contact-freeze.json`](../engine/experimental/multiphysics/liquid-contact-freeze.json).
Each case stores a digest and the work units of every committed tick, and for a
rejection its message, stage and completed work. The file also lists every
rejection message in the seven liquid, contact and world-tick sources. A
recorded rejection is evidence of that behaviour, not a passing result.

| Group | Cases | Recorded outcome |
| --- | --- | --- |
| Published open failures | Paddle at speed 1 (two timesteps); the builder's combined-failure journey; the same fixture with a full-width, wedged plate | All four rejected: `-0.0407`, `-0.0406` and `-0.472` unpaid energy; the wedged plate with `Rigid contact solve did not converge.` |
| Rejection boundaries | Fluid and boundary travel, starting penetration, boundary and fluid sample limits, solid overlap, compressed liquid, gas closing speed | All eight rejected before any tick commits |
| Stress scenes outside the gates | 13 liquid and contact scenes | Two complete (liquid sliding off a tilted plate; a plate spinning in liquid). Eleven are rejected, listed below |
| Passing controls | The five demonstrations, the trajectory to the break, both timed cups, the resolved tank, the resting cup, the paddle at speed 0.5 | All eleven complete |

The eleven rejected stress scenes, with the tick that fails:

| Scene | Rejected at tick | Rejection |
| --- | --- | --- |
| 27 samples fall one unit onto a floor | 47, before touching | `-0.0111` unpaid |
| Column with one wall missing | 21 | `-0.0103` unpaid |
| Wax or copper body dropped into an 18-sample pool | 56, before touching | `-0.0116`, `-0.0117` unpaid |
| Paddle at speed 2 | 44 | `-0.0178` unpaid |
| Free plate lands on a nine-sample layer | 34 | `-1.39` unpaid |
| Two samples fall into a V between fixed plates | 84 | `-11.4` unpaid |
| Nine samples riding a plate that lands | 61 | `Rigid contact solve did not converge.` |
| Cube strikes a floor and a wall together | 15 | `Rigid contact solve did not converge.` |
| Cube in a slot exactly its width | 77 | `Impact interval refinement did not converge.` |
| Six loose cubes pile up | 35 | `Rigid impact event limit exceeded.` |

Every rejection left its input bit-identical, and a second attempt and an
attempt from the JSON save rejected at the same stage, work and message.

`liquid-contact-freeze.test.ts` runs 13 light cases and the rejection-message
check in `npm test`. Digests are compared on the recording V8 and the outcome
elsewhere. All 36 cases run under the supervisor:

```sh
node scripts/freeze_liquid_contact.mjs check
node scripts/freeze_liquid_contact.mjs compare --commit 06c737f
```

`check` compares the working tree with the freeze file. `compare` bundles the
named commit from its own blobs and runs both engines side by side. A change
meant to keep behaviour exact must pass `check` unchanged. A change to the
physical model re-records the file in the same commit
(`node scripts/freeze_liquid_contact.mjs record`), so its diff states which
cases changed. The tables above describe `06c737f`; the freeze file describes
the current sources.

### Contact solves past the former sweep limit (2026-11-17)

Three limits of the rigid contact solve were rejections of the solver's
effort, not of the scene. Each change below acts only where a solve used to be
rejected, so a solve that converged before takes the same sweeps and gives the
same bits. Against `06c737f`, 32 of the 36 frozen cases are bit-identical and
the four former contact rejections change.

- **Own sweep limit.** A contact solve shared a 96-sweep limit with the
  geometric projection and the impact-interval refinement. It now has its own
  limit of 1,024 (`contactIterations`). Past sweep 96 it continues only while
  its unmet normal speed falls by at least a tenth every 32 sweeps; a slower
  solve could not reach the unchanged `1e-8` tolerance within the limit and is
  rejected there. The work limit still bounds the whole step.
- **Rebounds inside the contact skin.** At sweep 96 a rebound too slow to
  leave the `1e-8` contact skin within the tick is dropped. Such a rebound
  cannot be observed, and on a wedged body opposing ones have no joint
  solution: no rigid motion separates from both faces. Larger rebounds keep
  their targets, so an observable rebound with no joint solution is still
  rejected.
- **Persistent contact in the sweep.** A body held between two faces could
  report a re-contact just inside every interval tried, because its normal
  speed is at solver noise and the fitted arc returns to the face in
  proportion to the interval. After 96 refinements the last trial is swept
  again without pairs whose separation along the contact normal stays within
  the projection allowance (`1.25e-9`) for the whole interval. Any other event
  still rejects.

| Scene | At `06c737f` | Now |
| --- | --- | --- |
| Cube strikes a floor and a wall together | Rejected at tick 15 | Completes 60 ticks. The solve takes 491 sweeps; the cube leaves both faces at the analytic `0.4` and pays `15.84` of heat (`rigid.test.ts`, digits 7 and 6) |
| Nine samples riding a plate that lands | Contact solve rejected at tick 61 | Contact solve converges in 101 sweeps. The same tick is then rejected for `-30.2` unpaid energy as the liquid meets the stopped plate |
| Cube in a slot exactly its width | Interval refinement rejected at tick 77 | Sweep completes. The same tick is then rejected for `-0.353` unpaid energy |
| Combined failure with a wedged plate | Rejected at tick 30 | Three more ticks commit. Tick 33 is rejected: the plate slides on both faces with friction, and the unmet speed falls by under 3% in 32 sweeps |

Left open by this change: sliding friction on a wedged body, where the normal
load is statically indeterminate; the six-cube pile, where a face landing
almost flat alternates between two corners every `3.7e-5` model seconds and
passes the 64-event limit with the interval shrinking by under 1% per event;
and the unpaid-energy rejections, which the next section addresses for liquid.

### Inelastic liquid loss paid as heat (2026-11-17)

This changes the physical model's energy accounting. No tolerance, limit or
solved velocity changes.

The liquid solver removes kinetic energy whenever it projects velocities onto
motion that does not compress: that is a perfectly inelastic constraint. The
loss was booked as numerical error, and the `0.01` limit then rejected any tick
in which liquid actually struck something. In the seven rejected liquid scenes
that were probed, the unpaid energy was this loss: in the post-drift projection
in six, and in the solid contacts that carry liquid samples in the seventh (the
plate landing on a layer).

**Rule.** Each tick adds three unexplained kinetic changes: the first fluid
pass, the rigid stage's non-impact contacts between a liquid sample and a
solid, and the post-drift projection. For resting liquid they cancel: the
first pass absorbs the predicted gravity, and the contacts and the projection
give the same amount back. What is left is kinetic energy removed from closing
motion. It is deposited as heat when both hold:

- it is a loss larger than `1e-4` of the numerical limit, and
- the closing motion is identified. Either a liquid row did work against
  motion that was already closing in a reference motion (each sample and body
  with only the gravity that resting support did not cancel, plus the rigid
  stage's physical impacts), or a body that a physical impact struck was
  carrying liquid samples.

The amount is the tick's own net, so heat never exceeds the energy lost. It is
shared in proportion to the work of those rows and contacts: a liquid row heats
its own sample, and a contact shares with the solid. The tick report adds it to
`mechanicalHeat`; no report field is added, so a tick without such a loss
reports exactly what it did. A net gain is never paid, heat is never taken
back, and the projection itself is untouched: motion changes only where the
added heat later changes a temperature-dependent outcome.

**Evidence.** Against the previous commit, 19 of the 36 frozen cases are
bit-identical: all eight rejection boundaries, including the compressed liquid
(still rejected for a gain of `3198.6`); the three solid-only stress scenes;
and the wax valve, rotating contact, fluid switch, falling battery, both timed
cups, the resolved tank's two ticks and the resting cup. The rest:

| Scene | Before | Now |
| --- | --- | --- |
| Paddle at speed 1, both timesteps | Rejected at ticks 91 and 182 | Complete, 110 and 220 ticks |
| Builder journey: 48 ticks, heat edit, next preview | Preview rejected, `-0.472` | Preview completes |
| 27 samples fall onto a floor | Rejected at tick 47 | Completes 90 ticks |
| Column with one wall missing | Rejected at tick 21 | Completes 90 ticks |
| Wax or copper body dropped into a pool | Rejected at tick 56 | Complete, 110 ticks |
| Paddle at speed 2 | Rejected at tick 44 | Completes 60 ticks |
| Free plate lands on a liquid layer | Rejected at tick 34, `-1.39` | Completes 60 ticks |
| Two samples in a V between fixed plates | Rejected at tick 84, `-11.4` | Completes 120 ticks |
| Nine samples riding a plate that lands | Rejected at tick 61, `-30.2` | Fourteen more ticks commit; tick 75 is rejected with `Rigid work limit exceeded.` |
| Paddle at 0.5; combined failure and its trajectory to the break; tilted plate; spinning plate; wedged plate | Complete (the wedged plate rejected at tick 33) | Same outcome, with heat now paid. The first tick that differs is 176, 29, 29, 63, 56 and 29 |

The published gates were rerun on these sources: all five extended cases pass,
and both tank cases pass with their energy measured across both ledgers. In
`world-tick.test.ts` the top layer of a full cup driven down at `0.5` loses
`1.125` of kinetic energy, of which `1.12496` becomes heat with `8.5e-14`
unexplained, and the same cup at rest pays exactly zero for six ticks.

**Limits.**

- The amount is exact for the tick; which parcels receive it is a weighting,
  exact only for one sample meeting a wall.
- A tick whose constraints add energy is still rejected above the limit. Liquid
  compressed beyond rest density is pushed apart by the density target, and
  that push is not paid for.
- A loss below the dead band stays unexplained. In the wax tank at the finest
  timestep no tick reaches it.
- The numerical limit is an absolute `0.01` per tick. It does not scale with
  the number of samples; a world sets its own limit up to `1`.
- Solid-only cases are not covered. The cube in a slot is still rejected for
  `-0.353` that its resting wall contacts remove while it strikes the floor.
- The Mac builder stage recorded the journey's rejection as its reachable edge.
  That stage has not been rerun on these sources.
- `scripts/compare_fluid_optimizations.mjs` compares against an older frozen
  bundle whose results lack `impactLoss` and `projectionVelocityChange`; it
  needs a new baseline before it is used again.

After both changes, 10 of the 13 stress scenes complete (2 before), and 3 of
the 4 published open failures complete. Still rejected: the riding plate, the
cube in a slot, the six-cube pile and the wedged plate.

### Measured CPU cost (2026-11-22)

`node scripts/profile_liquid_contact.mjs` measures the frozen cases inside one
supervised CPU job. Each engine runs alone, in a fresh child process started
with `--single-threaded`, and the figure is that process's CPU time: the engine
and the runtime's own compilation and collection together, on one thread. A
case is warmed until its hot functions are compiled, then timed in samples of
about a second and a half; the clock on Windows ticks in steps of about 16 ms.
With `--commit` the two engines take turns by process, and a ratio is that of
their medians over ten samples each. These figures are from an i9-11900K with
Node 22.22.3. They are not the Mac qualification targets and do not replace
them.

**The figures published here on 2026-11-17 are superseded.** They were taken by
timing the whole process with the runtime's background threads running, and by
alternating two engines inside one process. Both misled:

- The background compiler and collector threads added between 7 and 85% to the
  engine thread's time for the same work.
- Two engines in one process disturb each other. While one runs, every function
  the other created for its last tick is unreferenced, so a collection drops
  their optimized code and that engine starts its next sample cold.

The same deterministic tank tick cost between 312 and 844 ms from one sample to
the next, and one change measured 0.69 in one run and 1.19 in another. The
ratios of 0.83 to 0.90 reported for the first exact-behaviour change (`0c01263`,
one normalization per liquid sample) came from that method and have not been
re-measured.

**How the ticks are driven changes the cost.** V8 attaches a function's
optimized machine code to the function objects that run it, and remembers it
for later ones only weakly. A tick's jobs create their inner functions afresh,
so between two ticks nothing holds that code. V8 completes a major collection
in a task that runs when the process returns to its event loop. A collection
that completes between two ticks discards the code, and the next tick runs
those functions unoptimized until they are compiled again. A loop that never
returns to the event loop hides this; a host with a tick rate pays it. The
profile therefore drives ticks two ways:

- `--host loop`, the default, runs a case back to back.
- `--host paced` drives a case's tick sequence as a host does: slices of 256
  work units, one per turn of the event loop, and 8 ms between ticks.

This is my reading of V8's behaviour from its optimization trace and its code
log on Node 22.22.3. It has not been checked in a browser Worker.

CPU per tick on `main` before this work (`c65ca3e`) and after it (`3996abb`):

| Scene | Parcels (liquid samples) | Loop, before | Loop, after | Ratio | Paced, before | Paced, after | Ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Resolved tank | 105 (99) | 395 ms | 271 ms | 0.69 | 475 ms | 327 ms | 0.69 |
| 4-wide cup | 69 (63) | 239 ms | 147 ms | 0.62 | 293 ms | 166 ms | 0.57 |
| Timed cup | 32 (26) | 112 ms | 74.9 ms | 0.67 | 137 ms | 89.4 ms | 0.65 |
| Resting cup | 32 (27) | 90.3 ms | 54.7 ms | 0.61 | 109 ms | 66.1 ms | 0.61 |
| Paddle at 0.5 | 28 (27) | 35.2 ms | 17.7 ms | 0.50 | 39.4 ms | 22.4 ms | 0.57 |
| Combined failure | 10 (1) | 12.8 ms | 6.60 ms | 0.52 | 18.3 ms | 9.86 ms | 0.54 |
| Combined failure to the break | 10 (1) | 12.2 ms | 6.25 ms | 0.51 | Not measured | | |
| Wax valve | 8 (0) | 11.6 ms | 5.49 ms | 0.47 | Not measured | | |
| Fluid switch | 5 (1) | 7.70 ms | 4.54 ms | 0.59 | Not measured | | |
| Rotating contact | 4 (0) | 3.51 ms | 1.80 ms | 0.51 | Not measured | | |
| Falling battery | 4 (0) | 3.20 ms | 1.43 ms | 0.45 | Not measured | | |

A second run of the same comparison moved the tank's median on `main` by 3%.
In a loop, the ten samples of the tank and of each cup spread by 20 to 30% on
`main` and by 9 to 14% after this work. The trajectory to the break advances one
tick at a time, so the paced driver cannot be given its ticks. The four smallest
scenes were not run paced.

Every tick still commits the same bits: each change below left all 36 frozen
cases bit-identical, with the freeze not re-recorded. Each was measured in a
loop against the commit before it unless stated.

1. **Parcels the tick already owns are read where they are** (`c4c91ab`). Every
   parcel read made a deep portable copy first. For a flat record with exactly
   the parcel fields the copy cannot reject anything and changes only negative
   zeros, so that much is done without it and the same checks then run. Any
   other record still takes the copying reader and its messages. The fluid job
   read each particle's parcel with a second copy and validated its results
   with a third; both read in place by the same rule.
2. **Each touching pair of cuboids is tested once in the contact scan**
   (`3c25e24`). The scan ran the full contact test on a touching pair and the
   patch area ran it again; both also prepared each cuboid again. Changes 1 and
   2 together: 0.68 to 0.88 across the eleven scenes.
3. **The functions a tick creates stay alive until the next tick has its own**
   (`c492e89`), which keeps their optimized code. Paced: 0.77 to 0.84 for the
   tank and the cups, 0.79 for the combined failure, 0.99 for the paddle. In a
   loop: 0.93 to 0.96 for the tank and the cups, 1.01 to 1.03 for the other
   scenes. Nothing is computed differently; a few finished jobs' working arrays
   per site stay in memory until later jobs replace them.
4. **The tick's own data moves between its stages without re-inspection**
   (`2b6d502`). The portable copy inspects every property descriptor and key
   list, which is what admits a caller's data. The tick's hand-offs to the
   rigid step, the fluid job, the assembly check, its closing snapshot check
   and its result now use a copy that makes the same checks and the same
   result without that inspection, and hands anything irregular to the portable
   copy. 0.67 to 0.76 for the six scenes with at most one liquid sample, 0.82
   for the paddle, 0.92 to 0.97 for the tank and the cups.
5. **An orientation is normalized once where several vectors are rotated by
   it** (`3996abb`): a cuboid's three axes, its eight corners, the two points of
   a particle-against-box test, a solid's boundary samples. 0.97 to 1.00 over
   seven scenes, which is at the edge of what the measurement resolves.

Where a tick's time goes after this work, in a loop:

| Scene | Largest stages | Largest functions, by self time |
| --- | --- | --- |
| Resolved tank | First fluid pass 49%, post-drift projection 25%, contact scan 9%, rigid contact 6% | Solver loop 14%, `compiledApplyConstraint` 13%, `buildGram` 5%, portable copy 4% |
| 4-wide cup | First fluid pass 48%, post-drift projection 20%, contact scan 11%, rigid contact 8% | `compiledApplyConstraint` 10%, solver loop 6%, `crossVec3` 4%, coupling setup 4% |
| Timed cup | First fluid pass 45%, post-drift projection 18%, rigid contact 14%, contact scan 10% | `compiledApplyConstraint` 14%, solver loop 8%, `compiledRate` 6%, rigid solve 6% |
| Paddle at 0.5 | First fluid pass 50%, rigid contact 9%, contact scan 8%, rigid sweep 7% | `crossVec3` 7%, `particleInverse` 6%, `rotateByUnit` 5%, record-shape checks 4% |
| Combined failure | Contact scan 21%, first fluid pass 16%, rigid contact 14%, admission 11% | Portable copy 8%, record-shape checks 7%, `plainCopy` 4%, normalization 4% |
| Falling battery | Admission 26%, rigid contact 15%, validation 14%, contact scan 13% | Portable copy 27%, record-shape checks 8%, normalization 3% |

On the liquid scenes the constraint arithmetic is now the largest cost, and
the portable copy has fallen from 14 to 34% of profile samples to 2 to 4%. On
the scenes with at most one liquid sample, reading and checking the snapshot,
at admission and again at the end of the tick, is 11 to 34% of a tick with its
callees. The copy at admission admits data the engine did not build and has to
stay.

Exact-behaviour targets not yet taken, by measured share:

1. **Callback functions recompiled under a paced host.** About 75 small
   callbacks (arguments to `map`, `some`, `every`, `reduce`, `sort` and
   `findIndex` in the contact, coupling and admission code) are created on
   every call, so nothing can hold them and their code is discarded at each
   collection between ticks. A traced paced run of the tank after change 3
   spent about 36 ms per tick compiling, and the tank still costs 327 ms paced
   against 271 ms in a loop; slicing and the collections themselves are part of
   that gap too. Replacing those callbacks with loops in the hot paths would
   remove the recompilation and the allocation of the callbacks.
2. **The contact scan's unused point.** The scan needs a touching pair's normal
   only, but the contact test also computes its representative point: 2 to 5%
   of a tick. Skipping it is exact only with a bound on the geometry, since the
   test rejects a non-finite point.
3. **The inventory on small scenes.** `multiphysicsInventory3D` is 6 to 11% of a
   tick, with its callees, on the scenes with at most one liquid sample. A tick
   calls it several times, and each call copies and re-checks the battery.
4. **Record-shape checks**: 1 to 2% of the tank and the cups, 4% of the paddle
   and 6 to 10% of the small scenes.

### GPU feasibility and the limits on scale (2026-11-17)

No GPU or browser workload was run for this. It rests on the solver source and
on two CPU measurements under the supervisor. The question was whether the
liquid and contact solver could move to a GPU, and what limits a much larger
scene would meet first.

**Measured: the sweeps do not reach the contract; a dense solve does.** The
divergence residual after the coordinate sweeps, against its `1e-7` tolerance:

| Scene | Constraint rows | After 1 sweep | After 8 | After 16 | After 32 | Dense iterations | Rows in the dense solve |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Timed cup, 26 samples | 77 | `1.8e-2` | `1.3e-3` | `2.5e-4` | `6.5e-5` | 5 to 13 | 73 to 74 |
| 4-wide cup, 63 samples | 148 to 149 | `1.8e-2` | `2.8e-3` | `7.6e-4` to `1.1e-3` | `9.4e-5` to `5.1e-4` | 4 to 5 | 147 to 148 |
| Resolved tank, 99 samples | 209 to 210 | `2.0e-2` | `3.0e-3` | `7.2e-4` | `5.3e-5` to `5.4e-4` | 13 to 14 | 208 to 209 |

After the 32 sweeps the residual is about 500 to 5,000 times the tolerance, and
in the tank it falls only from `7.2e-4` to `5.4e-4` over the last 16. Every
solve on every tick then factorizes nearly all of its rows as one dense system,
several times over. There are 2.1 to 3.0 rows per liquid sample.

**Limits.** Each of these holds for the solver as it is specified today.

1. *Float64 is the contract.* Committed state, the ledgers and the exactness
   gates (direct, Worker and save/restart equal bit for bit) are Float64. WGSL
   has no 64-bit float, so a GPU result cannot be that committed state. The
   engine's existing GPU paths match their CPU reference because they are
   integer arithmetic; that does not carry over.
2. *The tolerances are below single precision.* Contact speed `1e-8`,
   divergence `1e-7`, impulse-work identity `1e-9` relative, contact skin
   `1e-8` and penetration limit `1e-5` in position. A 32-bit float resolves
   `6e-8` near 1, `1.9e-6` at the model extent of 16 and `1.2e-4` at 1,024.
   The contact skin cannot be represented in world coordinates at any of them.
3. *Order is part of the result.* The liquid rows and the rigid contacts are
   updated one at a time in canonical order, and rigid motion is split at
   impact events found in sequence. A GPU needs simultaneous (Jacobi) or
   coloured updates, which is a different iteration with different results even
   in Float64, and no faster to converge than the sweeps measured above.
4. *The dense solve is cubic.* It is what meets the tolerance, on any hardware.
   At 10,000 samples it would be at least 21,000 rows (2.1 per sample, the
   lowest measured): a 3.5 GB Float64 matrix and about `3e12` operations per
   factorization, several per tick.
5. *The model is capped and visits all pairs.* 256 parcels, 128 fluid samples,
   128 boundary samples, extent 16. Neighbour search, viscosity, gas pressure
   and the contact scan each visit every pair.
6. *The heat ledger is exact integer arithmetic beyond 32 bits.* WGSL integers
   are 32-bit, so the ledger stays on the CPU and every tick needs a readback
   before it can commit.
7. *Bounded work and atomic rejection are per row.* The tick is one cooperative
   pipeline that yields after each bounded unit and rejects by abandoning the
   candidate. A GPU pass can stop only between dispatches.

WGSL also states floating-point accuracy as bounds rather than exact results
for several operations, so two GPUs need not agree bit for bit with each other.
That is my reading of the specification and should be confirmed against its
current text before it is relied on.

**What this means for a much larger scene.** Exact-behaviour work on the
present solver removes constant factors: the changes measured above took 31 to
55% off a tick's CPU time that way. It does not remove the cubic term or the
caps. A liquid at thousands of samples needs a different solver contract,
qualified separately and not interchangeable with this one: a matrix-free
iterative pressure solve over a spatial grid, single precision, tolerances
stated where iteration actually lands (the table suggests `1e-4` to `1e-3`,
not `1e-7`), and a numerical-energy limit that scales with the number of
samples. The inelastic-loss rule above is what would let such a solver account
for its energy without the fixed `0.01` limit. Whether the larger scene must
keep bit-exact committed state decides between the two: if it must, it stays
on the CPU and small.

## Implementation evidence

The first foundation checkpoint passed 19 analytical reference tests, the full
1,886-test CPU suite and 24 Node controller/build checks on the development Mac.
SDK builds, project type checks, lint, existing formatting checks, and an external
installed-package client with all 14 entry declarations passed. The installed
client executes the divider and conservative parcel partition through the new
public entry. These checks are supervised CPU work; they are not native runtime
or multiphysics-world qualification.

An independent source review found an assembly-release bug that could replace
stored velocity and silently erase kinetic energy. Release now requires stored
velocity and spin to agree with rigid motion, preserves both, and has a direct
regression. Sparse vector validation also rejects missing components. The final
reference review reported no remaining actionable finding. Later runtime files
remain behind their own gates and are not exported by this checkpoint.

### Private runtime checkpoint (not a release)

The private modules in `engine/experimental/multiphysics/` now connect rigid
motion, profile-aware heat/phase/combustion, finite DC sources, and fluid operators
in an atomic world tick. They were private at this checkpoint; the
[builder checkpoint](#builder-and-public-runtime-2026-11-02) exports them. The model currently admits 256 material parcels, 768 bonds, 128 fluid
samples and 128 nearby solid-volume boundary samples. A preview advances at most
two fixed ticks, with at most 256 yielded work units per call and three million
units per tick. Work units bound deterministic operations, not wall-clock time.

The liquid candidate uses a mass-metric SPH density/divergence projection with
canonical sequential constraint updates and full rigid effective inertia. It
is the release's liquid solver, qualified only within the budgets and envelope
below, and not a DFSPH implementation. Density
compression tolerance is `1e-4`; divergence is now measured as a normalized
*density-change rate*, with tolerance `1e-7` per model time unit, rather than
relaxing velocity accuracy as the timestep shrinks. Each solve permits at most
512 iterations. Gas uses a `gamma = 1.4` caloric pressure law with saved volume,
compatible midpoint pressure work, and explicit latent plateaus. Gas pair volume
changes are limited to 10% and total step volume changes to 25%; larger changes
reject rather than invent heat. An isolated gas sample has no resolved free
expansion without neighboring material or a boundary.

Fluid-to-solid exclusion uses a round particle of radius equal to its minimum
half extent. Solid-to-solid contact retains oriented cuboids. Fluid samples do
not collide with one another as rigid cubes. Their saved mass, intrinsic inertia,
spin, and energy stores remain authoritative across this distinction. Pressure
and viscosity carry fluid-fluid interaction. Physical fluid impacts are resolved
once before the gravity predictor. Contact constraints then iterate with pressure
without converting stabilization work into heat. The rigid stage preserves that
ownership for initial fluid contacts; newly encountered contacts remain impacts.
A final divergence/contact projection publishes full-step velocities.

Gravity kicks bracket each accepted mechanical drift interval. Collision search
bounds the gravity arc as well as rotation; it cannot infer a clear trajectory
from clear endpoints alone. Rejected trial intervals restore their physical
receipts and retain their computational cost. A co-rotating separating-plane
bound permits freshly fractured rotating pieces to separate without exhausting
the event budget. Analytical cases cover early/late elastic and inelastic
impacts, an intervening ceiling strike, return to the same floor, and resting
stacks. The falling tilted battery case now breaks its bonds, preserves mass,
and pays bounded failure heat from its cores through continued motion.

Fluid and rigid operators now report internal impulse demands about one fixed
world origin. Their contributions add before a single graph-cut fracture test,
including the final fluid correction. Anchors balance loads on free members;
loads applied directly to a fixed parcel are supported locally. Liquid impact
and gas-pressure cases break weak bonds while strong and unloaded controls hold.
Tests also cover translation invariance, fixed supports, conservation, release of
existing motion, JSON continuation, and exact mock-Worker preview/commit results
at work budgets 1 and 256. This is a graph strength model, not continuum stress.

Finite-face electrical transport
uses geometric contact area, so edge/vertex touching cannot create a conducting
shortcut. Resting-contact tolerance does not enlarge that electrical area.

The world owns snapshots, edit batches, and revision-bound previews. Placement,
removal, heating, transforms, anchors, bonds and battery replacement carry external
mass, energy and momentum receipts. Invalid batches, failed convergence and
cancelled previews cannot publish partial state. A removed battery terminal fails
the source while preserving remaining core energy. Snapshot validation checks
mass, energy, linear momentum and angular momentum ledgers, including saved
sub-quantum conversion remainders. The default per-tick numerical energy limit is
`0.01` model energy units; numerical corrections are never deposited as heat.

The private Worker host owns one live world and one candidate. It advances only
bounded chunks on a macrotask scheduler. The client permits one operation plus a
cancellation request, with no unbounded queue, and closes on timeout or malformed
replies. Commit requires the exact outstanding preview identity. Mock-transport
checks cover direct/Worker equality, work-budget independence, JSON continuation,
late cancellation, stale handles, lost replies and transport/scheduler failure.
They do not qualify a native Worker or rendering performance.

Qualification remains open. The 27-sample floor-column check and a resolved
99-water-sample tank now pass. In the latter, wax rises and copper sinks over
0.05 model seconds at timesteps `1/120`, `1/240`, and `1/480`. The acceptance
requires unchanged mass, no external stored-energy injection, numerical linear
momentum below `1e-8` per tick, angular residual below `1e-6`, and decreasing
accumulated energy error from a coarse-step ceiling of `0.006`. Body heights must
agree within `2e-5` and vertical speeds within `0.0005` across refinement.
Run this explicit serial case with `engine/vitest.multiphysics-fluid-runtime.config.ts`
under the verification supervisor; it is outside the ordinary CPU suite.

This is short-duration, resolution-specific evidence, not general hydrostatic or
long-running fluid qualification. A smaller tank can artificially support a body
on one coarse fluid layer. Longer support/no-heat runs, heated plumes, sustained coupled
reactive behavior, and admissible solid geometry
for overlapping freezing samples remain open. An atomic rejection is not a
successful physical result. The numerical energy limit remains unchanged.

The builder and its fresh macOS qualification remain outstanding. Its required
five demonstrations are a powered wax valve; a rotating conductor; a falling,
breaking battery; fluid moving a conductor; and combined electrical, thermal,
fluid and structural failure. The public runtime must remain gated until the
preceding mechanics, fluid and reactive capability checks pass.

The private contact/integration checkpoint passed 128 focused multiphysics tests
within the full 1,995-test CPU suite, followed serially by 24 Node build/controller
tests on 2026-10-24. Its local supervisor receipt is
`63f18ae9a44c4c589399225236a0126e`. The separate tank acceptance receipt is
`b28bddef092245958ef9f70c618c65ac` (32.01 seconds for both refinement cases).
SDK build, type checks, structural lint and formatting passed separately. Earlier diagnostic probes that reported rejected
candidates are not positive acceptance evidence. No native, performance or full
reactive-parity qualification is implied by these checks.

The subsequent coupled-load checkpoint passed 131 focused multiphysics tests
within 1,998 CPU tests and 24 Node tests; its serial supervisor receipt is
`5a12ac1197784b1d8000e7f7c1910c4d`. Both tank refinement cases also passed after
the load integration: `f0928fc7fe43406a8e3ee9752f91aa9d` (31.23 seconds).
Type checks, structural lint and formatting passed.

### Bounded electrical mechanism cases

The private `demonstrations.ts` fixtures now exercise a source-paid copper heater
that melts and releases a wax valve, a rotating copper contact that opens and can
be reclosed by a recorded orientation edit, and a liquid impact that moves
a conductor and opens its circuit. The wax starts near the end of its latent
plateau; an otherwise identical control with its battery removed stays solid and
bonded. These cases preserve mass and compare saved continuation. The falling
and breaking battery is covered by the separate world-tick case above.

The fluid switch now uses speed `2` and timestep `0.001` in model units.
The former `-0.174` projection error came from imposing zero divergence on a
particle with deficient neighbor support. The candidate now applies that extra
constraint only above `0.8` of rest density, while retaining the predicted-density
guard and mechanical contact constraints for every sample. At unit spacing and
smoothing radius `1.5`, bulk support is approximately `0.95`, a flat surface
`0.87`, and a lone particle `0.46`. Reports distinguish constrained rows from
underfilled rows and expose the latter's compression rate. This criterion is
specific to this candidate, not a universal SPH parameter. The
[SPlisHSPlasH DFSPH implementation](https://github.com/InteractiveComputerGraphics/SPlisHSPlasH/blob/master/SPlisHSPlasH/DFSPH/TimeStepDFSPH.cpp)
also suppresses divergence solving for deficient particles, using neighbor
counts; our density criterion and sequential solver are not that implementation.

The switch passes speeds `0.2`, `2`, and `8` at timesteps `0.001`, `0.0005`, and
`0.00025` over `0.004` model seconds. Accumulated energy error decreases under
refinement, with unchanged `0.01` world tolerance, the tank's momentum budgets,
and an explicit density bound. Work-budget, mock-Worker preview/commit and JSON
restart agree exactly at the default speed. This is bounded sparse-flow evidence,
not high-speed qualification for arbitrary liquid scenes.

Whole-world checks now cover all 17 phase edges, five fuel reactions, extinction,
and independent sand/ash settling. A settling regression exposed a mismatch
between accepted overlap and swept clearance, plus repeated artificial micro-
impacts caused by advancing a translating gravity arc into an overlap allowance.
Constant-orientation sweeps now clip the exact quadratic arc; rotating sweeps
retain their conservative bounds. Geometric correction leaves clearance below
the smallest swept allowance. Existing ceiling strikes, same-floor returns,
fast impacts and resting-stack oracles pass unchanged. Freezing overlapping
samples, longer fluid support and heated-plume qualification remain open.

Collision advancement takes the longer interval certified by either a fixed or
rotating separating plane, resolving a hidden-corner stall at small fixed
terminals without skipping their contacts. Sustained combined-failure behavior,
broader fluid gates, builder, and native macOS acceptance remain outstanding.

The mechanism checkpoint passed 134 focused multiphysics tests inside 2,001 CPU
tests, then 24 Node tests, with serial receipt
`ffa5e00a23e2467b95c046e1b78b71e9`. Both tank refinement cases passed separately
on the final collision bound: `31575f1007d04ecaaecb9d2f17a9c048` (30.97 seconds).
Type checks, structural lint and formatting also passed. All raw evidence remains
local. These are CPU mechanism checks, not native builder or performance results.

The fast-flow and settling checkpoint passed 160 focused checks within 2,027 CPU
tests, then 24 Node tests (`61e1a62e5226479b8fb074821c87493f`). The unchanged two
resolved-tank refinement cases passed in 31.44 seconds after both fixes
(`fc3d8c7d0d7345b3a893fba673a79644`). Type checks, structural lint, formatting and
manual adversarial source review passed. The `no-mistakes` executable is absent
on this host, so no automated reviewer or CI result is claimed. Raw receipts stay
local; the public runtime remains gated.


### Electrical inspection and extended acceptance

Tick reports now include source-relative node potentials, signed branch currents,
branch resistance/power, and solver residuals. `sampledTick` identifies the start
of the tick, before heat and motion; `activeSeconds` identifies the paid interval.
These values must not be presented as a network solve of the ending geometry.
A failed or already depleted source has no solved network. A floating node has
`null` potential. The values are derived reports, not persisted solver history.

Whole-world checks cover analytical divider potentials/current directions,
depletion partway through a moving tick, an electrically live path after copper
melts, and two failed cores that retain separate finite stores. Removing one core
debits its energy through the edit receipt without refilling the surviving core.
All five named mechanism fixtures are now authored; the falling-battery test
reuses its fixture. Exact mock-Worker preview, commit, save/restart and work-budget
checks cover the initial two ticks of every fixture. This does not qualify their
full trajectories or a native Worker.

Review and longer probes found two further numerical defects. Near the gas
kernel's compact-support edge, a valid tiny pressure impulse formerly spent all
96 iterations bisecting an enormous volume-admissibility bracket. The bracket now
also uses decreasing discrete pressure to bound the root. The work limit and
energy tolerance remain fixed. Nearly parallel edge/face contact classification
now measures the cross-product angle and prefers a face within the existing
contact skin; geometric projection still uses the true minimum translation axis.
Settling, resting stacks, fast impacts and released-edge regressions pass together.

The extended scenarios in
`engine/experimental/multiphysics/fluid-qualification.runtime-cases.ts` now cover
sustained resting liquid, a hot/cold gas column, continued coupled mechanism
failure, and geometry-admissible freezing. The original immediate-freezing
expectation is replaced by the explicitly selected admission policy below:
blocked liquid retains its state, and separating liquid freezes once space
opens. Pressure-driven crystal growth is still unimplemented.

Run these gates explicitly and serially under the supervisor with
`engine/vitest.multiphysics-extended-runtime.config.ts`. They are separate from
the floating/sinking tank configuration and ordinary unit suite. Earlier
failure receipts `71aa6059290643628b72c25dc5a9ab19` and
`59291d9b3e804d668ad0dfd34f509708` remain local evidence of the defects. A tightly
wedged support also exposed conflicting simultaneous restitution constraints;
the authored combined scene supplies lateral clearance and does not qualify
arbitrary wedged contacts. Builder and native macOS timing acceptance remain
outstanding, and the runtime remains unexported.

The earlier checkpoint passed 169 focused checks inside 2,036 CPU tests, followed by
24 Node tests (`75fc3bc1fbf3418b9f42026dad873c0f`). The established floating/sinking
tank refinement cases passed in 31.06 seconds
(`6397a262038442d4945ff050301ed4bb`). Type checks, structural lint, formatting and
SDK builds passed. At that earlier checkpoint, manual adversarial review retained the four
then-open extended failures as release blockers; they were not converted to passing tests or looser
budgets. The automated review executable remains unavailable. These are local CPU
checkpoints, not CI, native Worker, builder, or performance qualification.

### Coupled resting-liquid correction (2026-10-25)

One-way pressure/contact clipping could retain an obsolete impulse after another
constraint changed the velocity. The numerical correction now solves the
mass-metric closest feasible velocity with accumulated nonnegative impulses.
It starts with bounded coordinate sweeps and, if needed, solves the active
constraints directly. Shared rigid-body linear and angular reactions are summed
before applying inertia. The original 512-iteration cap and residual tolerances
remain; the declared work bound includes matrix assembly and factorization.
Physical impact heat remains a separate operation.

The unchanged 27-sample, 0.5-second resting gate now passes at both timesteps:
maximum speed below `4.71e-8`, movement below `1.24e-8`, heat below `4.19e-18`,
and absolute cumulative numerical energy below `1.87e-7`.
Receipt `afba83d9e508408c9925e7e720b7c2b2` also retains the still-failing combined
mechanism. Its loss is isolated to post-drift fluid projection when a sparse
molten-wax parcel crosses the density-only divergence-support cutoff.

Adversarial checks use independent closest-point answers, reversed constraint
ordering, duplicate constraints and a narrow feasible wedge. The wedge exposed
an overly broad diagonal regularizer; only near-zero factor pivots now receive
a floor, with acceptance checked against the original constraint equations.
This does not clear the remaining gas, mechanism or freezing gates.

Validation: 2,040 CPU and 24 Node checks passed
(`a811625212fe43849b486f6b96bc049b`); the final duplicate/reversed/wedge checks
passed (`2cb205ad926f4402b0addbc213af468e`). The floating/sinking refinement
cases passed in 31.59 seconds (`627c44d7ce9048beb936a9ac857afffc`), with coarse
cumulative absolute energy errors `1.35e-5` and `1.07e-4`, decreasing at each
refinement. Type checks, structural lint and diff hygiene passed. Review was
manual; the automated review executable remains unavailable.

### Sparse support and continued failure mechanism (2026-10-25)

A density-only support cutoff classified two approaching droplets as resolved
liquid before their predicted density reached the incompressibility limit. In
the combined mechanism this activated the extra divergence constraint abruptly
and removed `0.81625` energy at tick 31. Divergence support now also requires a
resolved volume of neighboring liquid/solid samples, normalized by the cube of
the support radius. Gas neighbors do not supply incompressible support. Every
liquid parcel still receives the predicted-density guard.

The separate close-droplet reproduction failed before this fix
(`decc668172f547fe8677ae1d53ebb115`). It now preserves unconstrained approach
motion while rejecting compression beyond rest density. Independent scaled
3x3x3 lattices retain the seven resolved interior/face-center rows at all three
scales. The 177 private multiphysics checks passed
(`a92be41f3b9d42e29ee0d9296a21eee4`), as did the unchanged powered mechanism,
unpowered control and save/restart continuation (`081476c079c44675bc4368bca433ad1b`).
Both tank refinement cases passed (`b23ebb3375cc4e128255f589be64d776`). The
existing energy/momentum tolerances and work limits were retained. This bounded
support criterion does not establish arbitrary spray or adaptive-resolution
qualification. Manual adversarial review covered sparse/bulk separation, scale
consistency, gas exclusion and the retained density guard.

The sustained resting control also passed unchanged
(`fdb463a412be455aa17328d93b041877`). Type checks, lint and formatting passed.

### Reflected gas-wall pressure work (2026-10-25)

The fixed-solid pressure contribution used the fluid/wall relative velocity,
while the [reflected-neighbor boundary model](https://gmd.copernicus.org/articles/11/2691/2018/gmd-11-2691-2018.html)
requires twice that relative normal velocity. The same corrected continuity
derivative now supplies both pressure impulse and the adiabatic enthalpy work.
The wall receives the opposite linear/angular impulse; no numerical loss is
converted into heat. This is the candidate's radial boundary quadrature, not a
claim of a general resolved-wall discretization.

A symmetric reflected gas pair gives an independent boundary equivalence check
for compression, rest and expansion. All three failed before the fix
(`4b8a0dd838d540679a19ad64051b2c58`) and passed afterward, alongside the existing
analytic pair midpoint/adiabatic oracle, moving-body torque and energy checks.
The 180 private checks passed (`a95f1c203f7e47f3928ec3e8da74b445`); types, lint and
formatting passed. Manual review checked that the reflection factor is used in
both impulse and volume work, leaves gas/gas and liquid operators unchanged,
and retains finite-volume and thermal-store rejection bounds.

The unchanged hot/cold 0.03-second gate passed, and now also covers half the
timestep (`f9b0581253804f2cb2c3cc65128bd1f5`). At `dt=0.0005`, tracked cold/hot
heights are `1.01018`/`1.26193`; at `dt=0.00025`, `1.00993`/`1.25978`. Hot gas
expands and rises faster at both steps. Maximum cumulative absolute numerical
energy is `1.03e-8`, below the original `1e-4` limit. This qualifies that bounded
floor-column comparison, not a long-running atmospheric plume or arbitrary gas
boundary scenes. Freezing geometry and native product gates remain open.

Before solidification admission was added, three extended gates passed together
and the original overlap/freezing expectation still failed
(`46058d14e2cb43d78d86298a1ed17807`). The full suite at that point passed 2,047 CPU
and 24 Node checks (`48d0327b8adc402399f77921e22f91dd`), and all SDK bundles and
declarations built. That remaining geometry conflict led to the selected policy
below.

### Geometry-admissible solidification (2026-10-25)

The selected policy preserves physical state while a proposed solid shape cannot
fit. The world checks the batch of proposed shapes before changing mechanical
ownership, both after ordinary heat transfer and after pressure work. Overlap
postpones the material transition and is reported with the blocking parcel IDs.
The current enthalpy—including heat transferred earlier in the tick—remains
owned by the liquid. Mass, inertia, spin, velocity, geometry and chemical stores
are retained; no bond or anchor is created. Existing motion can open space, at
which point the phase change completes normally. Admission does not relax the
rigid solver's penetration limits.

This is a bounded geometric admissibility approximation, not a calibrated
pressure/nucleation law. [Confined freezing research](https://www.nature.com/articles/s42005-020-0303-9)
shows why pressure and phase equilibrium matter; quantitative growth would need
phase-dependent volume/compressibility, latent heat and mechanical work coupled
explicitly. Those capabilities remain open. The original assertion that two
overlapping, motionless parcels immediately become non-overlapping rigid cubes
was incompatible with retaining their geometry. Its replacement checks both
conservative waiting and successful later freezing driven by actual separating
motion; it does not count indefinite waiting alone as successful solidification.

The new waiting/resumption scenario passes (`b4696339d3114a928354399b61535b66`).
Manual adversarial review added immediate freezing at admissible contact,
rotated-wall obstruction, cancellation during admission, exact work-budget
replay, retained heat conduction, and rejection of pre-existing illegal solid
overlap. All 21 world-tick checks pass (`77284af173414152a48963f3a3a73645`).

Final verification passes 2,051 CPU and 24 Node tests
(`75ff439b9bfc47aca542d7f5c5b6e1a6`). All four extended scenarios pass together
under the selected admission policy (`43eea3f67a4c41ea8fcf4ce0cbf8d1b6`, 29.72
seconds). The first three retain their original limits; the freezing scenario
explicitly verifies waiting plus later admissible conversion. Type checks,
structural lint, formatting, diff hygiene and SDK builds pass. No automated
review, CI, native Worker, builder, pressure-driven freezing or full runtime
release qualification is claimed.

### Integration with current main (2026-10-25)

After integrating main at `eb2f4cb`, verification passes 2,099 CPU and 26 Node
tests (`7e5040518260404bba2f44a043ee23aa`), all four extended scenarios
(`61570f1176564b13b789be729f363bd6`) and both tank refinement cases
(`532721a3e22b479288ae96f5f87bcd90`). The installed-package client exercises the
new reference API and all 15 package declaration entry points
(`packages-cfec5f9e2771`, supervised by `d884f1bcbb6f471a9ca9c97ff47ff020`).
SDK and chamber builds, type checks, structural lint, Python lint and formatting
also pass. These are local CPU checks; the runtime release boundaries above
remain unchanged.

### Native Worker and gate closure (2026-11-01)

The missing Solids and Liquids cases now have named tests, and the
[published budgets](#published-gate-budgets) table lists every gate case. The
SPH density/divergence candidate is accepted as the release liquid solver under
its own name.

A solid's boundary samples now count toward a liquid row's resolved support
volume only while that particle touches the solid. They still add density.
Before, an approaching plate switched on the facing rows' zero-divergence
constraint at a distance of 0.37 and removed `-0.021` in one tick. Now the
approach costs below `1.2e-5` per tick, and the paddle case uses a plate whose
wetted face is genuinely below its centre. The earlier clockwise spin came from
that at-distance clamp on rows below a centred plate.

Two exact speedups leave every snapshot and report bit-identical (key-order-
independent digests, negative zero distinguished, over 30 ticks of each
demonstration and 6 of the tank): thermal parcel reads validate their owned
copy without a second copy, inventories of validated state skip per-parcel
copies, a tick result is copied rather than re-validated, and the active-set
Cholesky factor reuses its unchanged leading rows in typed arrays while keeping
the per-row work accounting. Direct ticks: 99-sample tank 377 to 314 ms,
demonstrations 20–30% faster. Raising the 32-sweep coordinate cap does not help:
every tank still needs about 13 dense iterations after any cap of 32, 48 or 64,
and 128 sweeps are slower. The cap is unchanged.

On final sources the tank refinement cases pass (20.2 seconds,
`e708e60fed224e31bbb1c5b889cb641c`), all five extended cases pass (38.8 seconds,
`6872951785a043bcae3ec08f911c4cce`), and `npm test` passes 2,148 CPU checks
(`32a8b3d00e8b4fbcb54abe1da7de187a`).

`worker-entry.ts` is a real module Worker. It receives one bootstrap snapshot,
then speaks only the existing host protocol, yielding through a `MessageChannel`
queue so no nested timer clamp applies. `worker-probe.ts` drives it from a page;
`npm run build:multiphysics-probe` bundles both into `dist/multiphysics/`. The
`multiphysics-worker-<scene>` Mac stages (see [macOS](MACOS.md)) produced these
page-observed latencies over 24 samples on the M3 Ultra, on final sources:

| Scene | Parcels | Direct preview p95 | Worker preview p50 / p95 | Cancellation p95 | Stage |
| --- | --- | --- | --- | --- | --- |
| `wax-valve` | 8 | 18.8 ms | 14.0 / 17.1 ms | 3.0 ms | Pass (`c07f12ad7c11436cb0e6e074e3d1aa04`) |
| `rotating-contact` | 4 | 7.1 ms | 5.3 / 6.7 ms | 3.6 ms | Pass (`c854227476b24ab4860983a3eb1ddaa7`) |
| `fluid-switch` | 5 | 12.7 ms | 9.7 / 12.0 ms | 2.1 ms | Pass (`97e7493050a549879045c16ccccda3d0`) |
| `falling-battery` | 4 | 7.0 ms | 5.7 / 6.6 ms | 4.3 ms | Pass (`f15daf7585df414695f43ff99f8b7da2`) |
| `combined-failure` | 10 | 22.7 ms | 18.0 / 23.3 ms | 2.7 ms | Pass (`d42e4d4c65184a56a6b5ba77e65ab732`) |
| `timed-cup` | 32 (26 liquid) | 135.3 ms | 121.1 / 142.3 ms | 1.4 ms | Pass (`b6414d2d3c0e4f78864b9c2ba20f35ed`) |

Every stage was exact across work budgets 1 and 256, cancel/retry and
save/restart. Two heavier loads were measured on the Mac and miss the preview
target, so they are not interactive scenes:

- 4-wide cup, 63 liquid samples and a wax body (exact speedups in place):
  preview p95 279.2 ms, about 12% over (`aeef72f6ab774845939a9e68d2b8185f`).
- 99-sample resolved tank (before the speedups): preview p95 727.6 ms
  (`9efa114e5165474d84c1a9ccd1b2ec84`).

The Worker adds about 4% to direct cost; the misses are solver work. The targets
are unchanged.

### Builder and public runtime (2026-11-02)

`state-space-engine/experimental/3d/multiphysics` now exports the runtime: profiles,
snapshots and inventories, the world with edit batches, receipts and two-tick
previews, tick jobs, the demonstrations and the timed cup, and the module Worker.
`serveMultiphysicsWorker3D` runs inside a module Worker and
`startMultiphysicsWorker3D` starts one from the page. The installed-package
client previews and commits a world through the packed entry
(`packages-4dc715ed9b05`, supervised by `fe87ce0c597e4eb489d6507b5771e48b`).

[`examples/multiphysics-builder/`](../examples/multiphysics-builder/) compiles
only against that public entry (`npm run build:multiphysics-builder`). It draws
oriented cuboids from each parcel's quaternion, and liquid and gas samples as
discs at their exclusion radius. Overlays show bonds, battery terminals, and the
tick report's branch currents and node potentials. The camera orbits on display
frames and never advances a tick. The controls cover all eight edit kinds, with
receipts: place, remove, heat, transform, anchor, bond, cut and battery
replacement. They also cover inspect, two-tick preview, compare, commit, cancel,
and JSON save and load. Compare shows a seven-row ledger: thermal, latent and
chemical stores, battery, conversion remainders, mechanical energy and the
numerical residual. A rejected candidate appears as a notice and leaves the
committed world unchanged.

Every `multiphysics-builder-<scene>-visible` stage passed on final sources, each
after its scene's Worker stage from the same source hashes:

| Scene | Worker preview / cancel p95 | Builder preview / cancel p95 | Worst frame (count) | Worker / builder receipts |
| --- | --- | --- | --- | --- |
| `wax-valve` | 16.1 / 2.8 ms | 19.2 / 4.8 ms | 7.4 ms (180) | `de8d247a7ab64ba3a20e93e01e20171f` / `c3d3ed3e01954c11b47317d3cd49fed7` |
| `rotating-contact` | 7.2 / 4.0 ms | 7.3 / 4.9 ms | 3.5 ms (181) | `88ed290bc98b487d941d1460e940aa93` / `eeafc98b2cbc46e9a39194cb73c7b718` |
| `fluid-switch` | 11.4 / 2.5 ms | 12.5 / 2.8 ms | 8.1 ms (180) | `89ce39e30a2b406c9bc401a671d170ec` / `327bf79cca1d4f62b4038a102c9fd88b` |
| `falling-battery` | 6.5 / 4.4 ms | 8.0 / 6.1 ms | 8.4 ms (181) | `db58c956bf93473c9f29fc8b77a9cb60` / `bbcbcc4d7225452596e4accfb227db21` |
| `combined-failure` | 23.7 / 2.9 ms | 23.2 / 3.8 ms | 5.5 ms (181) | `1e77b8cf2bc449d694716c9af756e626` / `f521cc9f5eb1411492edf13359869749` |
| `timed-cup` | 140.2 / 0.9 ms | 147.3 / 3.9 ms | 5.1 ms (262) | `578cc36d44634e30a6b02bcc59696292` / `f6b0e391e39c4cf8b55228dd462db7d1` |

Frames are completed application frames, from encode through GPU completion,
measured while the controls ran. The worst display-frame gap was 17.8 ms in
every stage.

In `combined-failure`, after the stage's 2,048 Q heat edit and 48 committed
ticks, the next preview is rejected with an unpaid correction of `-0.472`
against the `0.01` limit. The builder shows this as a normal rejection, and a
restarted Worker reproduces the same rejection exactly. That world cannot
advance further without an edit, so it marks a reachable edge of the qualified
mechanism, not a passing trajectory.

These results cover six fixed scenes on the tested Mac host, in visible Chrome.
They do not qualify arbitrary user-built worlds, heavier liquid loads, other
hosts or other browsers.
