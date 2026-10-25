import { guardNode, verificationYield } from './verification_guard.mjs';
await guardNode('cpu', 900);
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { cpus, platform } from 'node:os';
import { createStateSpaceWorld3D } from '../dist/sdk/state-space-world.js';
import { createLevel, DEFAULT_SEED, GENERATOR_VERSION } from '../examples/cavern/scene.js';
import { CavernGame, CpuTerrain, routeInput } from '../examples/cavern/game.js';
import { hash, sources, save, fixture } from './volume_m3_evidence.mjs';
const { values } = parseArgs({
    options: { output: { type: 'string', default: 'docs/checkpoints/volume-m3' } },
  }),
  out = values.output;
const sourceHashes = sources(),
  report = {
    version: 1,
    passed: false,
    sourceHashes,
    recordedAt: new Date().toISOString(),
    host: { cpu: cpus()[0]?.model, node: process.version, platform: platform() },
    configuration: {
      dimensions: [64, 64, 64],
      chunkSize: 32,
      seed: DEFAULT_SEED,
      generator: GENERATOR_VERSION,
    },
    fixtures: {},
  };
const persist = () => save(`${out}/node.json`, report),
  keep = (name, value) => (report.fixtures[name] = fixture(out + '/fixtures', name, value));
persist();
process.once('uncaughtExceptionMonitor', (error) =>
  save(`${out}/node.json`, { ...report, error: String(error.stack || error) }),
);
const world = createLevel(),
  initial = world.snapshot(),
  checkpoints = {};
keep('world-initial', initial);
const timings = [];
for (let tick = 1; tick <= 1024; tick++) {
  const start = performance.now();
  world.step();
  timings.push(performance.now() - start);
  await verificationYield();
  if ([3, 31, 32, 509, 1024].includes(tick)) {
    checkpoints[tick] = world.snapshot();
    keep(`world-${tick}`, checkpoints[tick]);
    persist();
  }
  if (tick % 128 === 0) console.log(`Cavern reference ${tick}/1024`);
}
assert.equal(world.energyBalance().driftQ, 0n);
const repeated = createStateSpaceWorld3D({ chunkSize: 16 });
repeated.restore(initial);
for (let n = 0; n < 1024; n++) {
  repeated.step();
  await verificationYield();
  if (n % 64 === 63) console.log(`Repeated partition ${n + 1}/1024`);
}
assert.deepEqual(repeated.grid, world.grid);
assert.deepEqual(repeated.energyQ, world.energyQ);
repeated.restore(checkpoints[509]);
for (let n = 509; n < 1024; n++) {
  repeated.step();
  await verificationYield();
  if (n % 64 === 63) console.log(`Partition restart ${n + 1}/1024`);
}
assert.deepEqual(repeated.grid, world.grid);
assert.deepEqual(repeated.energyQ, world.energyQ);
report.world = {
  ticks: 1024,
  repeatedExact: true,
  repartitionedRestartExact: true,
  restart: 509,
  energyDriftQ: '0',
  cpuTickMs: timings,
};
persist();
console.log('1024 ticks: repeated partition and restart exact.');
const game = new CavernGame(new CpuTerrain());
await game.initialize();
keep('game-initial', await game.snapshot());
const saves = {};
for (let n = 1; n <= 600; n++) {
  await game.step(routeInput(game));
  await verificationYield();
  if ([3, 31, 32, 157, 509].includes(n)) {
    saves[n] = await game.snapshot();
    keep(`game-${n}`, saves[n]);
  }
  if (n % 120 === 0) console.log(`Gameplay reference ${n}/600`);
}
const final = await game.snapshot(),
  commands = structuredClone(game.commands);
keep('game-final', final);
keep('commands', commands);
assert.equal(final.status, 'won');
assert(game.events.some((e) => e.type === 'ice-walk'));
assert.equal(game.field.field.energyBalance().driftQ, 0n);
const repeat = new CavernGame(new CpuTerrain());
await repeat.initialize();
for (const c of commands) {
  await repeat.step(c);
  await verificationYield();
  if (c.tick % 64 === 0) console.log(`Repeated gameplay ${c.tick}/600`);
}
assert.deepEqual(await repeat.snapshot(), final);
for (const tick of [31, 157, 509]) {
  await repeat.restore(saves[tick]);
  for (const c of commands.slice(tick)) {
    await repeat.step(c);
    await verificationYield();
    if (c.tick % 64 === 0) console.log(`Gameplay restart ${tick}: ${c.tick}/600`);
  }
  assert.deepEqual(await repeat.snapshot(), final);
  assert.equal(repeat.field.field.energyBalance().driftQ, 0n);
  console.log(`Gameplay restart ${tick}: exact`);
}
report.game = {
  ticks: 600,
  wonAt: final.events.find((e) => e.type === 'crossed').tick,
  repeatedExact: true,
  restarts: [31, 157, 509],
  energyBalance: Object.fromEntries(
    Object.entries(game.field.field.energyBalance()).map(([k, v]) => [k, String(v)]),
  ),
  initialHash: report.fixtures['game-initial'].sha256,
  finalHash: hash(final),
};
report.sourceUnchanged = hash(sourceHashes) === hash(sources());
assert(report.sourceUnchanged);
report.passed = true;
persist();
console.log(`M3 Node verification passed: ${out}/node.json`);
