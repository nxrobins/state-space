# Crossing mission

Get the heavy unit safely onto the far bank within two committed turns. Both units start on the near bank, with the engineer outside reinforcement range. A turn is 250 physics ticks. A heavy unit supported on the far bank with speed below 0.0001 model units per second wins at the end of a turn. At that boundary, a heavy unit short of the objective loses if the deck has fractured. An intact deck and a missed objective at the end of turn two give a deadline loss.

| Squad order | Engineer | Heavy unit |
| --- | --- | --- |
| `move-engineer` | Move into reach of the joint and brake | Wait |
| `advance-together` | Move into reach and brake | Cross |
| `reinforce-and-cross` | Reinforce the intact joint from within reach | Cross |
| `cross` | Wait | Cross |
| `hold` | Wait | Wait |

### Play on hosted CPU

The **Crossing mission** GitHub Actions workflow accepts a first and second order through **Run workflow** once the workflow is on the default branch. The default sequence is `move-engineer`, then `reinforce-and-cross`. The public SDK runner previews and commits each chosen order, stops if the mission ends, and reports the result in the job summary. An out-of-range reinforcement is an illegal order and spends no turn. All simulation runs under the CPU supervisor on hosted Ubuntu. [Workflow](../../.github/workflows/crossing-mission.yml)

### Preview and choose

A Node client can inspect two alternatives before committing either. The injected `api` is the public `state-space-engine/experimental/3d/multiphysics` module, and `profiles` comes from `await api.createMultiphysicsProfiles3D()`. Run workloads on an eligible supervised host.

```js
import { createCrossingMission } from './mission.mjs';

const mission = createCrossingMission(api, profiles);
const approach = mission.prepare('move-engineer');
const rush = mission.prepare('advance-together');
for (const plan of [approach, rush]) {
  while (plan.status() === 'running') plan.advance(64);
}
const alternatives = [approach.result().mission, rush.result().mission];
const receipt = mission.commit(approach);
const resumed = createCrossingMission(api, profiles, JSON.parse(JSON.stringify(mission.save())));
```

A preview returns its predicted mission verdict and underlying turn events. Only a successful commit appends the order and spends a turn. Unselected previews become stale on commit. The versioned boundary save carries the full v2 world and committed order list. On restore, the controller checks that the order count agrees with the world tick and derives the objective from the restored physical state. Terminal saves retain their verdict and reject further orders. A first-turn collapse leaves one unused turn on the clock.

[Hosted acceptance and replay](../../docs/checkpoints/CROSSING_MISSION.md)
