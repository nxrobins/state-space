# Two-turn crossing mission

The squad gets two 250-tick orders to secure the heavy unit on the far bank. A preview predicts the verdict. A commit publishes the physical state, records the squad order and consumes one turn. The mission evaluates the landing before the deadline on the final turn. [Mission rules and orders](../../examples/crossing-mission/README.md)

| Orders | Mission verdict | Physical outcome |
| --- | --- | --- |
| Move engineer, then reinforce and cross | Win on turn two | Engineer reaches the joint on tick 104. The deck is reinforced on 251. The heavy unit lands on 491 and brakes on 492. |
| Advance together | Loss on turn one | The deck fractures underfoot on tick 95, before the engineer reaches the joint. |
| Move engineer, then cross without reinforcement | Loss on turn two | The same tick-250 save produces an underfoot fracture on tick 345. |
| Move engineer, then hold | Deadline loss on turn two | The deck remains intact and the heavy unit is still on the near bank at tick 500. |

Hosted Ubuntu x64 checks the complete preview and commit for each outcome. Competing previews leave the live save and turn budget intact. Illegal, incomplete, cancelled, failed, stale, foreign and consumed handles cannot publish. Restoring the winning and losing terminal saves reproduces their verdicts. The public SDK example also runs the winning sequence on the hosted runner. [Hosted capture](https://github.com/nxrobins/state-space/actions/runs/45913046681)

The verifier compares every tick's edits, edit receipts, report and snapshot at work budgets 256 and 1. Each order replay uses a fresh session restored from the previous commit's JSON save. An independent public edit replay at budget 64 restores around the physical events and turn boundaries. The original approach, rush and reinforced trajectories must match the pre-mission physics hashes. The mission fixture pins the four order/receipt histories and final saves with their verdicts. The workflow retains five compressed turn packets and per-frame hashes for 14 days. [Pre-mission baseline](../../engine/test-support/fixtures/multi-turn-crossing-v2.json) · [Mission baseline](../../engine/test-support/fixtures/crossing-mission-v2.json)
