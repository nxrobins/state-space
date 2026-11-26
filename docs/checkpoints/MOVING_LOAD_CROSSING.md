# Moving-load crossing on the v2 CPU world

A light unit reaches the far bank on tick 241. Under a heavy unit the support breaks on tick 95, when its center is at x = −0.41042 and both ends of its footprint are on the deck (x = −1 to 1). With the same heavy unit and a reinforced bond, the crossing holds. All four cases run through tick 250 (0.521 simulated seconds). [Hosted trajectory capture](https://github.com/nxrobins/state-space/actions/runs/45881727478)

| Case | Unit mass | Bond strength | Upward deck reaction with unit fully on deck | Fracture tick | First tick fully on far bank |
| --- | ---: | ---: | ---: | --- | --- |
| Unloaded | 0 | 135 | 9.80 from deck weight alone | Intact | — |
| Light | 1 | 135 | 19.60 | Intact | 241 |
| Heavy | 10 | 135 | 107.80 at fracture | 95 | Missed |
| Reinforced heavy | 10 | 500 | 107.80 | Intact | 241 |

The unit is a free rigid body given an initial horizontal speed of 5 on a frictionless near bank. Gravity, geometric contact and load transfer determine its path from then on. The anchored banks have 0.03 clearance to the deck. The far bank is a thin landing with clearance underneath. A successful crossing requires the unit's whole footprint on the far bank at landing height, continued support, and transfer of its weight off the deck. The failed unit ends at x = 1.20220, y = 0.84756, below the 1.1501 landing surface. Horizontal progress alone would misclassify it. This fixture covers moving physical loads. A walking or pathfinding controller would need its own test.

## Reaction and water motion

While the bond is intact, a diagnostic copy reads the actual linear and angular impulses on the deck side of the solver's cut before the fracture decision. After separation the joint reaction is recorded as null. The raw impulse across all fixed boundaries includes both banks and the floor. It cannot distinguish which surface carries the unit at a seam. The independent vertical momentum check on the unit confirms 98.00 upward force at fracture. The deck contributes another 9.80. As the load moves away from the abutment, the bending moment increases. Force plus the pivot-relative moment divided by bond length rises from 134.4108 on tick 94 to 135.0780 on tick 95, crossing capacity 135.

Water travel is measured per parcel against the same moving heavy unit on the reinforced crossing. The paths agree through the fracture tick. All four parcels exceed 0.001 outward displacement on tick 108 and reach **0.26434–0.30259 outward** by tick 250. The empty crossing's water stays at rest. The moving light and reinforced controls show small longitudinal drift (maximum total travel 0.000141 and 0.000158 respectively). Their lateral drift stays below 0.00000006. Distances and forces are in model units.

## Replay and scope

The supervised Ubuntu x64 workflow uses Node 22.22.3. One execution advances the diagnostic tick job with a work budget of 256. The second uses a separately built ordinary public world, JSON save/restore, and preview/commit with a work budget of 1. Every complete state and report, including work counts, must match. The runner restores at the start and midpoint, immediately before and after heavy fracture, and on both sides of a successful landing. It also checks the committed state. The original stationary crossing continues to use its own frozen histories.

The [baseline](../../engine/test-support/fixtures/moving-load-crossing-v2.json) pins each initial state, full-result trajectory and per-tick observations, including the measured reactions. The [workflow](../../.github/workflows/moving-load-crossing.yml) retains the four compressed full histories, bundle hashes, per-tick observations and supervisor receipt for 14 days. The Windows safety hold remains in place.

## Earlier fixture results

The earlier strength-50 fixtures broke during entry while the unit still shared load with the near bank. With thick banks, speed 8 and a 160-tick horizon, the heavy case rejected on tick 139 during rigid contact. The thinner far landing rejected on tick 29. Adding expansion gaps at the same speed hit the rigid impact event limit on tick 27. A slower thick-bank case hit the rigid work limit on tick 39. These remain recorded limits for those configurations. The qualified span carries the unit through the seam and fails later under bending, using the standard solver, work and energy limits. [Thick banks](https://github.com/nxrobins/state-space/actions/runs/45880977680) · [Thin landing](https://github.com/nxrobins/state-space/actions/runs/45881179098) · [Gapped banks](https://github.com/nxrobins/state-space/actions/runs/45881350196) · [Slower entry](https://github.com/nxrobins/state-space/actions/runs/45881528558)
