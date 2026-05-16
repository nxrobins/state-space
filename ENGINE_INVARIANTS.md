# Engine Invariants

State Space engine changes must preserve these core invariants before they are
allowed to become gameplay features.

## Always Required

- Determinism: identical initial grids must produce identical final grids.
- Total voxel count: every simulation step preserves the number of grid cells.
- Material accounting: non-reactive movement and thermal passes must preserve
  per-material counts exactly.
- Bounded thermal drift: scenarios with clamped 8-bit thermal state must stay
  within their documented drift budget.
- Grid-size correctness: compute shaders must run against the actual grid
  dimensions used by the caller.

## Reaction-Specific Accounting

- Combustion consumes one fuel voxel and one air voxel per burn event.
- Combustion products may pass through ash, fire, and smoke, but the total
  product count must equal consumed fuel plus consumed air.
- Phase transitions must rewrite exactly one material into exactly one target
  material per transitioned voxel.

## Current Movement Contract

Movement is conservative and split into separate phased swap passes:

- Vertical gravity handles falling matter in even and odd row-pair phases.
- Diagonal fall handles blocked falling matter in disjoint 2x2 blocks.
- Horizontal liquid spread handles liquid-like phases after downward and
  diagonal movement are blocked.
- Gas buoyancy handles non-air gas and plasma with thermal buoyancy rank.
- Gas spread handles non-air gas and plasma after upward buoyancy is blocked.
- Solid/frozen matter can fall vertically through lower-density non-structural
  targets, but cannot be displaced as a target unless a later phase explicitly
  rewrites it.
- Gas is not a downward-gravity source; smoke, steam, and fire move through gas
  buoyancy/spread passes.
- Every movement pass must be a conservative pairwise swap with exact
  per-material accounting.
