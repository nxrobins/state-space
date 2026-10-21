import test from 'node:test';
import assert from 'node:assert/strict';
import { createStateSpaceField3D, MAT } from '../../dist/sdk/state-space-3d.js';
import { CrossingGame, CpuTerrain, commandFor, Q, raycast, regionFor } from './game.js';

async function fixture() {
  const f = createStateSpaceField3D(32, 32, 32);
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) f.setCell(x, 24, z, MAT.STONE);
  const game = new CrossingGame(new CpuTerrain(f));
  await game.initialize();
  return game;
}
test('integer actor collides on X/Z, lands on ice, and passes through water', async () => {
  for (const axis of ['x', 'z']) {
    const g = await fixture(),
      p = g.player;
    p.x = 8 * Q;
    p.z = 8 * Q;
    const x = axis === 'x' ? 9 : 8,
      z = axis === 'z' ? 9 : 8;
    for (let y = 21; y < 24; y++) g.field.field.setCell(x, y, z, MAT.ICE, 5);
    g.region = await g.field.queryRegion(regionFor(p));
    assert.equal(g.sweep(axis, 3 * Q), true);
    assert.equal(p[axis], 9 * Q - 77);
    for (let y = 21; y < 24; y++) g.field.field.setCell(x, y, z, MAT.WATER, 25);
    g.region = await g.field.queryRegion(regionFor(p));
    assert.equal(g.sweep(axis, Q), false);
  }
  const g = await fixture();
  g.player.y = 20 * Q;
  g.field.field.setCell(6, 22, 15, MAT.ICE, 5);
  g.region = await g.field.queryRegion(regionFor(g.player));
  assert.equal(g.sweep('y', 5 * Q), true);
  assert.equal(g.player.y, 22 * Q);
});
test('voxel targeting is blocked by the first surface and rejects remote targets', async () => {
  const g = await fixture();
  g.field.field.setCell(8, 22, 15, MAT.STONE);
  g.field.field.setCell(10, 22, 15, MAT.WATER);
  g.region = await g.field.queryRegion(regionFor(g.player));
  assert.deepEqual(raycast(g.region, g.eye(), [256, 0, 0]), {
    cell: [8, 22, 15],
    material: MAT.STONE,
  });
  g.field.field.setCell(8, 22, 15, MAT.AIR);
  g.field.field.setCell(10, 22, 15, MAT.AIR);
  g.field.field.setCell(12, 22, 15, MAT.STONE);
  g.region = await g.field.queryRegion(regionFor(g.player));
  assert.equal(raycast(g.region, g.eye(), [256, 0, 0]), null);
});
test('invalid commands and invalid game saves preserve the complete live state', async () => {
  const g = await fixture(),
    before = await g.snapshot();
  for (const input of [
    { moveX: 256, moveZ: 256 },
    { look: [0, 0, 0] },
    { tool: 'teleport' },
    { tick: 2 },
  ])
    await assert.rejects(g.step(input));
  assert.throws(() => commandFor({ look: [256.5, 0, 0] }, 1));
  for (const saved of [
    { ...before, player: { ...before.player, x: NaN } },
    { ...before, field: { ...before.field, rulesVersion: 'other' } },
    { ...before, player: { ...before.player, y: 25 * Q } },
  ])
    await assert.rejects(g.restore(saved));
  assert.deepEqual(await g.snapshot(), before);
});
test('sparse look vectors and event lists reject before changing player or terrain', async () => {
  const g = await fixture(),
    before = await g.snapshot();
  for (const look of [[256, , 0], [256, 0], new Array(3)]) {
    assert.throws(() => commandFor({ look }, 1));
    await assert.rejects(g.step({ look }));
    await assert.rejects(g.restore({ ...before, look }));
  }
  await assert.rejects(g.restore({ ...before, events: new Array(1) }));
  assert.deepEqual(await g.snapshot(), before);
});
