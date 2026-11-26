# Multi-turn crossing

The engineer begins 0.95418 model units from the deck joint, beyond the 0.75 reinforcement reach. The heavy unit starts at rest on the near bank. Both are free rigid bodies on the same weak crossing used for the two-unit checkpoint. Each turn lasts 250 physics ticks. [Two-unit checkpoint](TWO_UNIT_CROSSING.md)

| Heavy unit’s decision | First turn | Second turn |
| --- | --- | --- |
| Wait for reinforcement | The engineer moves into reach on tick 104 and brakes on 105. The heavy unit stays on the near bank. The deck still has strength 135 at the tick-250 save. | On tick 251 the engineer raises joint strength to 500 and the heavy unit launches. It reaches the far bank on 491, brakes on 492 and stays supported through 500. |
| Cross immediately | Both units launch on tick 1. The deck breaks under the heavy unit on tick 95. The engineer reaches the original joint position on 104, after the break. The heavy unit misses the landing. | The missing joint prevents reinforcement from the committed failed state. |

The engineer receives a center impulse along the approach and a counterimpulse after entering reach. The heavy unit receives the same horizontal launch impulse of 50 in each crossing. During the 250 ticks following launch, the early crossing moves all four water parcels 0.26434–0.30259 model units outward. With reinforcement, lateral movement stays below 0.000000055 model units. These are distances over equal post-launch intervals. [Hosted capture](https://github.com/nxrobins/state-space/actions/runs/45903926414)

## Preview, commit and replay

Both first-turn previews run from the same save. Previewing the engineer’s arrival leaves the live engineer outside reach until the setup turn commits. The other candidate then becomes stale. A control from the tick-250 save sends the heavy unit across the still-weak deck to check that waiting alone cannot carry its weight.

The supervised Ubuntu x64 workflow compares every tick’s input, edit receipt, snapshot and report across work budgets of 256 and 1. It replays the winning orders from the original save, serializes the newly committed first turn, restores a fresh session, then previews and commits the second turn. A separate public edit-log replay at budget 64 runs all 500 ticks of the prepared path and 250 ticks of the early path. It restores JSON saves around reach, braking, fracture, the turn boundary, reinforcement and arrival. The workflow retains the full turn packets and per-tick hashes for 14 days. The common initial state, three complete turn histories and three final results are frozen on Node 22.22.3. [Frozen fixture](../../engine/test-support/fixtures/multi-turn-crossing-v2.json) · [Workflow](../../.github/workflows/multi-turn-crossing.yml)
