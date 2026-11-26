import { appendFileSync } from 'node:fs';
import { guardNode } from '../../scripts/verification_guard.mjs';
import { briefing, createCrossingMission } from './mission.mjs';

const selected = process.argv.slice(2);
if (
  !selected.length ||
  selected.length > briefing.turnLimit ||
  selected.some((o) => !briefing.orders.includes(o))
) {
  throw Error('Choose one or two mission orders: ' + briefing.orders.join(', '));
}
await guardNode('cpu', 300);
const api = await import('state-space-engine/experimental/3d/multiphysics');
const mission = createCrossingMission(api, await api.createMultiphysicsProfiles3D());
const report = [briefing.objective];
console.log(briefing.objective);
for (const order of selected) {
  if (mission.state().status !== 'active') break;
  const plan = mission.prepare(order);
  while (plan.status() === 'running') plan.advance(256);
  const predicted = plan.result();
  console.log('Preview', order, predicted.mission.status, predicted.mission.reason ?? '');
  const { mission: state, turn } = mission.commit(plan);
  console.log(
    'Committed turn',
    state.turnsUsed,
    'of',
    briefing.turnLimit,
    'at tick',
    turn.snapshot.tick,
  );
  report.push(
    'Turn ' +
      state.turnsUsed +
      ' · ' +
      order +
      ' · ' +
      state.status +
      ' at tick ' +
      turn.snapshot.tick,
  );
  if (turn.fracture !== null) console.log('Deck fractured on tick', turn.fracture);
  if (turn.arrival !== null) console.log('Heavy unit reached the far bank on tick', turn.arrival);
}
const result = mission.state();
console.log(
  'Mission',
  result.status,
  result.reason ?? '(' + result.turnsRemaining + ' turn remaining)',
);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '## Crossing mission',
      ...report,
      'Outcome: ' + result.status + ' (' + (result.reason ?? 'in progress') + ')',
    ].join('\n\n') + '\n',
  );
if (process.env.GITHUB_OUTPUT)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    'status=' + result.status + '\nreason=' + (result.reason ?? '') + '\n',
  );
