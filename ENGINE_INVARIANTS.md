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

Gravity is currently conservative vertical movement only:

- Phase 0 handles even row pairs.
- Phase 1 handles odd row pairs.
- Only movable source voxels may swap downward; structural solids such as
  stone, metal, glass, and cold wood remain fixed unless a later phase
  explicitly rewrites them.
- Lateral, diagonal, and gas-spread movement are intentionally deferred until
  they can be expressed as separate conservative passes.
