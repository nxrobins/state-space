import test from 'node:test';
import assert from 'node:assert/strict';
import { ActiveCavernGame } from './game.js';

test('128-cubed initial energy stays exact at the maximum supported total', async () => {
  const maximum = 0x3fffffff,
    cellsPerChunk = 32 ** 3;
  const energyQ = Array(cellsPerChunk).fill(maximum);
  const chunks = Array.from({ length: 64 }, () => ({ energyQ }));
  const field = { queryRegion: async () => ({}), snapshot: async () => ({ chunks }) };
  const game = new ActiveCavernGame(field);
  await game.initialize();
  assert.equal(game.initialQ, BigInt(maximum) * BigInt(cellsPerChunk) * 64n);
  energyQ.fill(0);
  energyQ[0] = 1;
  await game.initialize();
  assert.equal(game.initialQ, 64n);
  assert.equal(game.externalQ, 0n);
});
