# Cellular pressure and velocity (ca-v4)

This is a deterministic 2D cellular approximation in model units. Pressure loads
walls; loss of integrity releases fragments; pressure gradients drive quantized
flow. It does not solve Navier–Stokes, track compressible mass fractions, or claim
SI calibration or mechanical energy conservation. The existing thermal, latent
and chemical energy ledger remains exactly conserved in closed evolution.

## State and compatibility

Schema 4 / rules `ca-v4` retains three u32 words per cell. The mechanical word
(the public `structure` coordinate) contains integrity/bonds/anchor in bits 0–12
and unsigned pressure in bits 16–31. Pressure is valid only for gas, plasma,
liquid, viscous and molten phases. Bit 13 is the internal fresh-bond request;
bit 14 is an internal transport marker; bit 15 remains reserved. Completed states
reject either pending marker. Old snapshots and catalogs fail version validation.

The packed signed kinetic nibbles become velocity. The impulse pass clamps each
component to −4…4; arbitrary representable input velocities are accepted and
clamped on the next tick. One unit schedules movement on one of four ticks.
Snapshots preserve both pressure and velocity exactly. Visual effects never write
these coordinates. Editing a material creates a fresh, unpressurized cell.

## Pressure law

Four-neighbor connected gas components use the average of per-cell absolute
pressure `min(66559, floor((floor(temperatureQ/256)+64)*1024/84))`.
Subtract 1024 and clamp below at zero to obtain gauge pressure. Thus model
temperature 20 is the reference. The cap applies before averaging. Component
sums are bounded below 2^47 and are exact in JavaScript and native integer code.
The world is closed: a vent joins the vessel to the surrounding finite gas
volume, diluting its average pressure; the boundary is not an infinite reservoir.

Liquid components use `surfaceGasPressure + depth * ceil(density/64) * 16`,
with minimum weight 1, depth measured from the highest cell of the component
(surface depth 1), and the maximum adjacent gas pressure as surface loading.
Mixed-density liquids share a surface height; this is an approximation. There is
no local flood-fill horizon. Target pressure is capped at 65535. Each tick moves
one quarter of the distance from previous pressure toward target, rounding away
from zero. Gas updates precede liquid updates. Pressure travels with a cell.

## Loading and motion

Wall demand is gravity load plus `abs(pLeft-pRight)+abs(pUp-pDown)`.
Equal opposing pressures cancel. The existing integrity/capacity law determines
damage. Pressure traction is distinct from the gravity support/reaction ledger;
that ledger continues to balance supported weight exactly.

Pressure impulses and disjoint, conservative velocity swaps follow structural
planning. All movement transports all three coordinates without creating matter
or thermal energy. Pair markers limit velocity transport to one cell per axis
per tick. Existing density settling and buoyancy remain additional cellular rules.
Velocity damping dissipates mechanical motion; it does not inject heat. This is
a bounded game flow model, not a momentum-conserving fluid solver.

Each impulse uses `clamp(v - sign(v) + clamp(trunc(force/64), -4, 4), -4, 4)`.
Force is left minus right and up minus down pressure. Nonfluid neighbors and
closed boundaries supply the cell's own pressure. Liquid vertical neighbors
receive a hydrostatic head correction (+head above, −head below) so a settled
homogeneous column has zero impulse. Bound cells get zero velocity. Four pair
passes (X even/odd, Y even/odd) exchange a cell moving toward an unbound fluid
neighbor when its speed exceeds `tick % 4`. Both endpoints receive the pending
marker after the first parity; the second parity skips marked pairs and clears
all markers, including unmatched boundary cells.

## Evidence and use

`sample()` exposes `pressureQ`, `velocityX`, `velocityY`; native `sample()` uses
`pressure_q`, `velocity_x`, `velocity_y`. Pressure is a gauge value in model units;
velocity units control four-tick transport cadence, not meters per second.
The complete snapshot remains the editing/replay boundary for these coordinates.

The pressure gallery (`web/?scene=pressure&paused`) pairs wooden/metal dams and
sealed/vented glass vessels above water and finite lava sources. It uses the same
physics and renderer as every other scene. Tests exercise depth, balanced
traction, strong/weak walls, venting, overflow, transport bounds, invalid state,
cross-backend passes and exact restart. The all-effects frame benchmark includes
the gallery alongside the existing bridge, lighting, water, haze and heat scenes.
