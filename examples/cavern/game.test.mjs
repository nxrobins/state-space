import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevel, DEFAULT_SEED, terrainHash } from './scene.js';
import { CavernGame, CpuTerrain, commandFor, Q, regionFor } from './game.js';
test('seeded terrain is reproducible and the challenge crosses chunk seams', () => {
  const a = createLevel(),
    b = createLevel(),
    c = createLevel(DEFAULT_SEED + 1);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.notDeepEqual(a.grid, c.grid);
  assert.equal(a.snapshot().chunks.length, 8);
  assert.equal(a.sample(31, 32, 25).material, 2);
  assert.equal(a.sample(32, 32, 25).material, 2);
  assert.equal(terrainHash(10, 20, 30, DEFAULT_SEED), terrainHash(10, 20, 30, DEFAULT_SEED));
});
test('the actor and collision neighborhood cross the global X seam', async () => {
  const g = new CavernGame(new CpuTerrain());
  await g.initialize();
  g.player.x = 31 * Q;
  g.player.z = 40 * Q;
  g.region = await g.field.queryRegion(regionFor(g.player));
  assert.equal(g.sweep('x', 2 * Q), false);
  assert.equal(g.player.x, 33 * Q);
});
test('malformed world/game saves and sparse commands preserve complete state', async () => {
  const g = new CavernGame(new CpuTerrain());
  await g.initialize();
  const before = await g.snapshot();
  for (const v of [
    { ...before, seed: -1 },
    { ...before, look: [256, , 0] },
    { ...before, events: new Array(1) },
    { ...before, field: { ...before.field, chunks: new Array(8) } },
  ])
    await assert.rejects(g.restore(v));
  assert.throws(() => commandFor({ look: [256, , 0] }, 1));
  assert.deepEqual(await g.snapshot(), before);
});
