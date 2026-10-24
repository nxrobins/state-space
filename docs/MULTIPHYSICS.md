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
  becomes heat. Incompressibility projection, stabilization, contact correction,
  and integration error are numerical residuals, not physical dissipation.
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

Liquids use [DFSPH](https://animation.rwth-aachen.de/media/papers/2015-SCA-DFSPH.pdf)
with both density and divergence constraints. Boundary impulses go back to the
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
before it is marked passed; none are implied by these reference cases. Exact
Q-store and identity bookkeeping, measured mass/momentum residuals, and atomic
failure are mandatory at every gate. Reference mass and mechanical totals are
Float64 values; they do not carry an exact-integer conservation claim.
The original fixed 16³ macOS targets remain qualification targets: two-tick
preview p95 at most 250 ms, cancellation p95 at most 100 ms, completed application
frames at most 16.667 ms. No existing 64³/128³ or GPU qualification transfers to
this model. Raw verification artifacts remain local under the current publication
policy. Each milestone receives adversarial review before dependent work is
admitted.

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
in an atomic world tick. None of these runtime APIs are exported by the public
entry. The model currently admits 256 material parcels, 768 bonds, 128 fluid
samples and 128 nearby solid-volume boundary samples. A preview advances at most
two fixed ticks, with at most 256 yielded work units per call and three million
units per tick. Work units bound deterministic operations, not wall-clock time.

The liquid candidate uses a mass-metric SPH density/divergence projection with
canonical sequential constraint updates and full rigid effective inertia. This
is not yet a qualified implementation of the planned DFSPH release. Density
compression tolerance is `1e-4`; divergence is now measured as a normalized
*density-change rate*, with tolerance `1e-7` per model time unit, rather than
relaxing velocity accuracy as the timestep shrinks. Each solve permits at most
128 iterations. Gas uses a `gamma = 1.4` caloric pressure law with saved volume,
compatible midpoint pressure work, and explicit latent plateaus. Gas pair volume
changes are limited to 10% and total step volume changes to 25%; larger changes
reject rather than invent heat. An isolated gas sample has no resolved free
expansion without neighboring material or a boundary.

Fluid-to-solid exclusion uses a round particle of radius equal to its minimum
half extent. Solid-to-solid contact retains oriented cuboids. Fluid samples do
not collide with one another as rigid cubes. Their saved mass, intrinsic inertia,
spin, and energy stores remain authoritative across this distinction. Pressure
and viscosity carry fluid-fluid interaction. Finite-face electrical transport
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

Qualification remains open. The 27-sample floor-column check passes, but a
closed-tank submerged-body probe exposed contact degeneracy and pressure/contact
splitting error. Roundoff contact handling and the timestep-dependent divergence
criterion were corrected; the full hydrostatic, floating/sinking and refinement
gates still need positive quantitative evidence. In particular, a small tank can
artificially support a body on one coarse fluid layer, and longer coupled runs can
exceed the unchanged numerical energy limit. Do not interpret an atomic rejection
as successful physical qualification. Arbitrary freezing of overlapping fluid
samples also requires an explicit admissible solid geometry policy.

The builder and its fresh macOS qualification remain outstanding. Its required
five demonstrations are a powered wax valve; a rotating conductor; a falling,
breaking battery; fluid moving a conductor; and combined electrical, thermal,
fluid and structural failure. The public runtime must remain gated until the
preceding mechanics, fluid and reactive capability checks pass.

The private checkpoint passed 115 focused multiphysics tests within the full
1,982-test CPU suite, followed serially by 24 Node build/controller tests on
2026-10-24. Type checks, structural lint and formatting passed. The local
supervisor receipt is `e0b07a9f3e2a477697af526dc617b549`. The separate diagnostic
probe `685385a398044e859ebc42efa14b83da` recorded the unresolved closed-tank error;
its process completed successfully because the probe reports candidate rejections,
not because its physical acceptance criteria passed. No native, performance or
full reactive-parity qualification is implied by these unit checks.
