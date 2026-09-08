# Engine invariants: schema 3 / ca-v3

These invariants govern engine changes and every embedding client. Games are
integration probes. The authoritative physical and snapshot contract is in
`ENGINE_CONTRACT.md`; current capabilities and approximations are in
`docs/CAPABILITIES.md`.

## Complete state and determinism

- Identical registry, dimensions, absolute tick and all three initial arrays
  must produce identical packed cells, energy and structural state.
- Split/resume and serialized snapshot replay must retain all three coordinates.
  The clipped display byte is never a substitute for energy, and material-only
  import is never exact continuation.
- Completed snapshots contain valid reciprocal bonds, no internal fresh-bond
  request bits, valid material/phase/energy combinations and the matching schema,
  rules and registry identity. Invalid restores and failed steps do not commit.
- Dimensions include odd, non-square and tiny grids. Closed boundaries contribute
  no material, energy or oxidizer. Seeded fuzz cases remain reproducible.

## Exact accounting

- Every closed-system tick conserves the integer sum of energyQ exactly:
  sensibleQ + latentQ + chemicalQ = totalQ. There is no thermal-drift allowance.
- The packed temperature is a clipped projection. Its sum is not an energy budget.
- Explicit edits account their actual energy change as external input/output.
  Clear and restore establish a new baseline, without replaying an edit history.
- Cell count is fixed. Movement and heat preserve per-material counts exactly.
  Reactions retain their declared material-family/product accounting.
- Combustion assigns one fuel and one oxidizer cell to one mutually owned pair.
  Its two products preserve the existing energy, including chemical release.
- A phase change replaces one material with one declared target after its latent
  interval completes. Water/ice/steam identity stays within that family.

## Movement and structures

- Local granular/liquid/gas movement uses disjoint conservative exchanges.
  Structural transport uses a complete-state permutation: every source has
  exactly one destination and all three coordinates move together.
- Intact or pinned cohesive cells cannot be either endpoint of independent grain
  motion. A broken pin remains fixed until explicit replacement or reaction.
- Persistent bonds are reciprocal. Contact and cooling do not weld fragments;
  only explicit placement/welding and solidification create new bonds.
- Support and collision dependencies propagate to completion. Integer load
  splitting preserves supported weight exactly in the sum of reactions.
- Damage removes bonds without deleting material or thermal/latent/chemical
  energy. Unsupported intact fragments translate coherently downward.
- Heat, phase changes and combustion compose with structure. Melting and consumed
  supports remove structural state, and the next support solve observes it.

## Verification and evolution

- Compare CPU, native GPU and actual browser WebGPU at every scheduled pass using
  complete state, including energy-only and structure-only changes.
- Require positive behavior as well as conservation: no-op physics must fail.
- Retain exact source, registry, seeds, device, driver, configuration and complete
  reference evidence. Timing includes synchronization and the host/GPU boundary.
- Every reproduced defect needs a regression property or structural lint rule,
  with an executed negative control that demonstrates detection.
- Run `python -m engine.verify` for the full release gate. See `docs/CAPABILITIES.md`
  for browser setup and the measured, bounded scope of the evidence.
