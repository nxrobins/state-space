# C6 structural model and integration contract

Status: schema/rules v3 is integrated into native, CPU and WebGPU public fields.
Current checkpoint status and acceptance evidence are in `checkpoints/C6.md`.

## Physical model

Structures use persistent reciprocal cardinal bonds. Initial placement and
solidification can create bonds; later contact does not weld separate fragments.
An additional u32 cell coordinate stores integrity (bits 0-7), left/right/up/down
bond flags (bits 8-11), and anchoring (bit 12). Bit 13 is an internal solidification
request consumed by bond normalization; completed snapshots cannot contain it.
The remaining bits are zero. Existing packed flags and kinetics keep their meaning.

Material cohesion and softening temperature occupy the last two cold-table
properties under schema/rules version 3. Zero cohesion disables bonding. A cell
participates only when its packed phase is solid/frozen, cohesion is nonzero, and
its integrity is positive. Breaking preserves material identity and conserved
thermal/latent/chemical energy. Fractured cells move as grains. Melting/burning
remove structural state; solidification seeds fresh integrity and explicit bonds.

The reference planner derives components from reciprocal bonds. Support is a
directed graph: bonded cells can transfer load in all cardinal directions, while
unbonded vertical contact transfers support upward and load downward. Floor cells,
anchored cells, and bottom contacts which cannot displace their noncohesive
neighbor supply reactions. Breadth-first support distances define deterministic
load paths. Each cell's integer weight is ceil(density/64), at least one; integer
loads split exactly among predecessor supports, with index order resolving the
remainder. Reactions must sum to the supported cells' total weight.

Nominal capacity is cohesion * 16, scaled by integrity/255. Above a nonzero
softening temperature, capacity declines linearly to zero over 64 temperature
units using full energy-derived temperature, including values beyond the display
byte. An overloaded cell loses at least one integrity unit, proportionally to
excess load relative to nominal capacity. Zero capacity causes complete failure.
Broken bonds are removed reciprocally before components and motion are recomputed.

Unsupported components translate down by one cell while preserving their shape.
Component dependencies propagate blocking from anchors, boundaries, and dense
noncohesive obstacles. Otherwise stacked/interlocking moving components translate
together, retaining distinct bond identities. The translation is a permutation:
each contiguous run of moving cells in a column shifts down, and its displaced
bottom cell fills the vacated top. Every material, packed tag, energy coordinate,
and structural coordinate has exactly one destination.

This is a quasistatic cellular strength model. It has no rotation, elastic strain
field, angular momentum, calibrated SI stress, or gravitational energy ledger.
The existing energy ledger remains thermal/latent/chemical. Cohesion, support,
fatigue, damage, and fragments are real state/rules, with these approximations
explicitly named. C7 must expose them in the capability matrix.

## Production integration and verification

The global support/component solver needs complete connectivity, including long
beams, loops, and contact chains. The initial implementation uses native/Python
and independent TypeScript planners, with a GPU permutation/structural-state pass.
This is an explicit hybrid backend; its host transfers and planning costs must be
benchmarked. It must not be described as a GPU-only structural solver.

The implementation includes a scalar Python reference, a separate array-based
Python planner, and the TypeScript planner. Python reference components use DFS;
the array implementation uses monotone root hooking and pointer compression;
TypeScript uses union/find. All propagate support and blocking to completion,
with no fixed local iteration horizon. The common corpus compares complete
plans, component reports, all three transported coordinates, and native GPU
results. Public fields use schema 3 and ca-v3 rules.

A plan is bound to its input geometry and all three input arrays. Application
requires the original width and height even if a different rectangle has the
same cell count. The native GPU probe rejects stale state/geometry before
allocation or compilation. Reports expose support distance, load, capacity and
reactions in source coordinates before damage; component membership/motion are
after damage and before translation. Component IDs are minimum current source
indices, not stable particle identifiers across steps.

The scalar planner profile found roughly 2.1 seconds for one dense 256x256 solve.
The separate array implementation avoids per-cell Python graph operations. A
repeatable two-warmup/five-sample comparison records identical complete outputs
and a 14.48x median improvement for that dense case (1773.62 to 122.51 ms).
These are standalone host-planner measurements, excluding GPU work and complete
production ticks. The result still leaves substantial work for large real-time
worlds; C6 integration must retain a measured scale limit and C7 must state it.

The tick order is structural planning/application, existing granular/fluid/gas
movement, heat, phase transitions, combustion, then reciprocal bond normalization.
All movement transports all three state coordinates. Cohesive cells are excluded
from independent granular gravity. Heat/reaction changes affect the following
tick's support solve, while normalization closes each tick with valid bonds.

The GPU ABI uses eight storage bindings: packed in/out, cold table, energy
in/out, structure in/out, and a read-only vec2<u32> structural plan containing the
source index and resulting structural word for each destination. Inspection includes changes to structural state and planner diagnostics, including components,
support, load, capacity, damage, and motion.

Schema/rules migration covers authoritative catalog validation/generation,
all Python/CPU/WebGPU fields, direct compositor use, snapshots and exact restart,
editing/anchoring/repair semantics, per-pass inspection, packaged examples,
evolution eligibility and evidence, the standalone browser sandbox, and integration
clients. Old snapshots must fail explicitly; no silent structural reconstruction
is allowed for continuation.

Acceptance includes native/CPU/actual WebGPU full-state equality, reciprocal bond
and permutation properties, component-preserving free fall, supported spans,
separate contacting bodies, collision dependencies, fractures and fragments,
thermal weakening, consumed supports, melting/solidification, high custom IDs,
odd/tiny grids, exact budgets, long scenarios, and snapshot/restart. Executed
negative controls must show that these checks catch the corresponding failures.

`docs/checkpoints/c6-baseline.json` preserves native ca-v2 evidence: a supported
beam sags between its pillars and a floating plate separates under alternating
cell gravity. C6 changes the physical contract rather than weakening the ca-v2
evaluator to permit altered physics as an optimization.

Built-in cohesion/softening coefficients are stone 200/180, metal 255/185, wood
24/120, ice 12/12, glass 48/190 and player 32/0. Other materials have zero in both
fields. These are cellular model coefficients, not calibrated engineering units.
A broken pin retains its anchoring bit even at zero integrity. A reaction which
consumes it clears its structural coordinate; unsupported fragments then move
on the following structural pass. Production tests isolate that cause from
thermal weakening with a consumed-pin scene.
