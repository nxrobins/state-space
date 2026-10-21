import { guardNode, verificationYield } from './verification_guard.mjs';
await guardNode('cpu', 900);
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { cpus, platform } from 'node:os';
import { createScene, SCENES } from '../examples/volume-lab/scenes.js';
import { CrossingGame, CpuTerrain, routeInput } from '../examples/first-person/game.js';
import { hash, save, sources } from './volume_m2_evidence.mjs';
const { values } = parseArgs({
  options: { report: { type: 'string', default: 'docs/checkpoints/volume-m2/node.json' } },
});
const sourceHashes = sources(),
  report = {
    version: 1,
    passed: false,
    sourceHashes,
    recordedAt: new Date().toISOString(),
    host: { cpu: cpus()[0]?.model, node: process.version, platform: platform() },
    scenes: [],
  };
const checkpointTicks = [1, 3, 4, 509, 510, 1024];
save(values.report, report);
process.once('uncaughtExceptionMonitor', (e) =>
  save(values.report, { ...report, error: String(e.stack || e) }),
);
for (const scene of SCENES) {
  const cpu = createScene(scene.id),
    initial = cpu.snapshot(),
    checkpoints = {};
  for (let t = 1; t <= 1024; t++) {
    cpu.step();
    if (t % 64 === 0) {
      await verificationYield();
      console.log(`${scene.id}: ${t}/1024`);
    }
    if (checkpointTicks.includes(t)) checkpoints[t] = cpu.snapshot();
  }
  assert.equal(cpu.energyBalance().driftQ, 0n);
  const row = {
    scene: scene.id,
    initial,
    checkpoints,
    finalHash: hash(cpu.snapshot()),
    energyDriftQ: '0',
  };
  report.scenes.push(row);
  save(values.report, report);
  console.log(`${scene.id}: fresh CPU reference through 1024 ticks`);
}
const g = new CrossingGame(new CpuTerrain());
await g.initialize();
const initial = await g.snapshot(),
  checkpoints = {};
for (let t = 1; t <= 600; t++) {
  await g.step(routeInput(g));
  if (t % 64 === 0) {
    await verificationYield();
    console.log(`Crossing ${t}/600`);
  }
  if ([3, 119, 157, 509].includes(t)) checkpoints[t] = await g.snapshot();
}
const final = await g.snapshot();
assert.equal(final.status, 'won');
assert(g.events.some((e) => e.type === 'ice-walk'));
assert.equal(g.field.field.energyBalance().driftQ, 0n);
const commands = structuredClone(g.commands),
  repeat = new CrossingGame(new CpuTerrain());
await repeat.initialize();
for (const c of commands) {
  await repeat.step(c);
  if (c.tick % 64 === 0) {
    await verificationYield();
    console.log(`Repeat crossing ${c.tick}/600`);
  }
}
assert.deepEqual(await repeat.snapshot(), final);
console.log('Gameplay: route wins; repeated input tape exact.');
for (const tick of [3, 119, 157, 509]) {
  const restarted = new CrossingGame(new CpuTerrain());
  await restarted.restore(checkpoints[tick]);
  for (const c of commands.slice(tick)) {
    await restarted.step(c);
    if (c.tick % 64 === 0) {
      await verificationYield();
      console.log(`Crossing restart ${tick}: ${c.tick}/600`);
    }
  }
  assert.deepEqual(await restarted.snapshot(), final);
  assert.equal(restarted.field.field.energyBalance().driftQ, 0n);
  console.log(`Gameplay: exact continuation from tick ${tick}`);
}
report.game = {
  initial,
  checkpoints,
  commands,
  final,
  finalHash: hash(final),
  energyBalance: Object.fromEntries(
    Object.entries(g.field.field.energyBalance()).map(([k, v]) => [k, String(v)]),
  ),
  repeatedExact: true,
  restartExact: true,
};
report.sourceUnchanged = hash(sourceHashes) === hash(sources());
assert(report.sourceUnchanged);
report.passed = true;
console.log(save(values.report, report));
