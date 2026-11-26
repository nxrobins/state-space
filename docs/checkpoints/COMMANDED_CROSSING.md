# Commanded crossing from rest

The light and heavy units begin motionless on the near bank. Both receive the same `cross-to-far-bank` order. The light unit reaches the far bank on tick 241 and brakes on tick 242. The heavy unit breaks the support on tick 95 with its full footprint on the deck. With a reinforced support it reaches the far bank and brakes. Both masses stay on the near bank when ordered to wait. [Hosted trajectory capture](https://github.com/nxrobins/state-space/actions/runs/45884447693)

| Unit and order | Launch impulse along x | External launch work | Fracture | Arrival | Brake |
| --- | ---: | ---: | --- | --- | --- |
| Light, cross | 5 | 12.5 | Intact | 241 | 242 |
| Heavy, cross | 50 | 125 | 95 | Missed | — |
| Reinforced heavy, cross | 50 | 125 | Intact | 241 | 242 |
| Light or heavy, wait | 0 | 0 | Intact | Stayed on near bank | — |

The fixture uses the [moving crossing](MOVING_LOAD_CROSSING.md) with initial velocity zero. One external horizontal impulse launches the unit at speed 5. At each tick boundary the client checks the oriented unit's bounds against the far bank and its landing height. On the tick after arrival it applies the impulse needed to cancel horizontal momentum. The receipt records −12.49194 units of brake work for the light unit and −124.99093 for the reinforced heavy unit. The light unit ends at x = 1.11005 with horizontal speed below 0.000001. The heavy unit receives no brake, misses the landing and displaces the four water centers 0.26434–0.30259 units outward by tick 250. The order models a launch and brake on a frictionless crossing, with time, load transfer and collision resolved by the v2 solver.

## Preview, choice and replay

The [reference turn client](../../scripts/commanded_crossing_turn.mjs) advances a private world using the ordinary bounded public preview and commit for each tick. The live session retains its original snapshot throughout prediction. Committing a ready turn adopts that candidate in one operation. A session can hold two alternative previews. The hosted check predicts heavy collapse, previews waiting from the same starting state, selects waiting, and verifies that the stale crossing cannot publish. It also checks incomplete, cancelled, failed, foreign and twice-used handles, and mutation of a returned preview snapshot.

The [hosted workflow](../../.github/workflows/commanded-crossing.yml) runs five 250-tick trajectories on supervised Ubuntu x64 with Node 22.22.3. It repeats the serialized order from the saved starting state with advance budget 1 versus 256. Every tick's input edits, edit receipt, full snapshot and tick report must match. A third execution replays the recorded public edit stream at budget 64. It reconstructs a fresh world from JSON at the start, midpoint and on both sides of launch, fracture, arrival and braking as applicable. The ordered hashes and final outcomes are [frozen](../../engine/test-support/fixtures/commanded-crossing-v2.json). Full V8 packets, per-tick digests, command receipts and the supervisor record are retained as CI artifacts for 14 days.

The new v2 edit applies a center impulse to a free, unbonded solid. Existing edits continue through the same accounting and preview paths. V1 keeps its original unknown-edit rejection. The moving and stationary crossing fixtures retain their own frozen baselines. Windows execution remains held.
