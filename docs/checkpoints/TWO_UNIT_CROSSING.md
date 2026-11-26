# Two-unit crossing

An engineer and a heavy unit start at rest on the near bank with one intact deck joint at strength 135. The engineer can reinforce it from within 0.75 model units of the seam or wait. In both alternatives the heavy unit receives the same crossing order and a launch impulse of 50 along x.

| Engineer order | Joint during crossing | Heavy unit | Outward water motion at tick 250 |
| --- | --- | --- | --- |
| Reinforce | Strength 500 | Reached the far bank on tick 241, braked on 242 | Less than 0.000000055 in either direction |
| Wait | Strength 135 until fracture | Broke the deck underfoot on tick 95 and missed the far bank | 0.26451 to 0.30233 model units outward |

The engineer stands beside the heavy unit on the abutment, outside its path. Both are free rigid bodies with half-extents of 0.075 × 0.075 × 0.12 and masses of 1 and 10 respectively. Reinforcement is a single turn action. It cuts and re-bonds the same endpoints in the first tick's edit batch before the heavy unit's launch. A separate zero-tick check compares this edit with waiting. Only joint strength changes in the snapshot, and both edit receipts are identical. A missing or out-of-reach engineer, missing joint or already reinforced joint cannot issue the reinforcement. In both branches the launch receipts match exactly, and the parcel states and tick reports match through tick 94. Water travel is the signed lateral motion of each of the four parcel centers away from the lane centerline.

The narrower engineer in the first capture reached the existing contact solver's convergence limit. A bounded comparison reproduced rejection on tick 32 for that footprint and found four stances with the ordinary crossing footprint that completed both 250-tick branches. The table covers the side-by-side stance centered at x = −1.57 and z = 0.26. [First capture](https://github.com/nxrobins/state-space/actions/runs/45887779053) · [Geometry comparison](https://github.com/nxrobins/state-space/actions/runs/45887939032)

## Preview, commit and replay

The hosted CPU check previews both alternatives against one live save and commits one after both are ready. A second session restores the same save, reverses the preview order, and chooses the other result. The live world must retain its initial state until commit and reject the discarded or consumed handle. Each tick's full state, report, public edits and edit receipt must match across preview budgets of 256 and 1. A third pass replays the public edit stream at budget 64 and reconstructs a fresh world from JSON before and after the intervention, fracture, arrival and braking where applicable, and at the midpoint.

The baseline pins the common starting state, both full histories and both final outcomes on hosted Ubuntu x64 using Node 22.22.3. The workflow retains both full compressed histories, the per-tick hashes and the supervisor receipt for 14 days. This fixture qualifies an in-range support action and a heavy crossing using the v2 CPU reference. [Frozen baseline](../../engine/test-support/fixtures/two-unit-crossing-v2.json) · [Hosted capture](https://github.com/nxrobins/state-space/actions/runs/45888198453)
