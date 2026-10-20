/** Held actual physics acceptance; never selected by the edit/mock configuration. */
import { describe, expect, test } from 'vitest';
import { MAT } from './3d.js';
import { CpuStructuralWorld3D } from './structural-world-core.js';
import { createTacticalSession3D } from './tactical-session.js';
import type { TacticalSessionPolicy3D } from './tactical/tactical-session-view.js';

function initial() {
  const w = new CpuStructuralWorld3D({width: 8, height: 8, depth: 8, chunkSize: 4});
  w.setCell(3, 2, 3, MAT.STONE, 150); w.setCell(4, 2, 3, MAT.STONE, 120); w.setIntegrity(3, 2, 3, 73); w.setIntegrity(4, 2, 3, 91);
  w.setCell(3, 4, 3, MAT.WATER, 40);
  return {worldId: 'physical-translation', gameRulesVersion: 'fixture-1', terrain: w.snapshot(), game: {ap: 2}};
}
const policy: TacticalSessionPolicy3D<{ap: number}> = {reduceTranslation: context => {
  if (context.movement().status !== 'complete') throw Error('Incomplete held translation paths');
  context.beforeQueries(); context.queries(); return context.game;
}};

describe('held translation and physical continuation', () => {
  test('observing a translated slab leaves subsequent full physical states and accounting identical', async () => {
    const seed = initial(), a = createTacticalSession3D(seed), b = createTacticalSession3D(seed, policy);
    for (const s of [a, b]) {
      const branch = s.branch({horizonTicks: 2}); branch.translate({cells: [[3, 2, 3], [4, 2, 3]], path: [[0, 0, 1], [0, -1, 0]]});
      await branch.advance(2); s.commit(branch);
    }
    expect(a.snapshot()).toEqual(b.snapshot());
  });
  test('translation followed by an odd-tick snapshot resumes with the exact complete state', async () => {
    const a = createTacticalSession3D(initial(), policy), first = a.branch({horizonTicks: 1});
    first.translateWithMotion({cells: [[3, 2, 3], [4, 2, 3]], path: [[0, 0, 1]]}); await first.advance(1); const saved = a.commit(first).snapshot;
    const b = createTacticalSession3D(initial(), policy); b.restore(saved); const left = a.branch({horizonTicks: 2}), right = b.branch({horizonTicks: 2});
    await left.advance(2); await right.advance(2); expect(a.commit(left).snapshot).toEqual(b.commit(right).snapshot);
  });
  test('translation reduction and later physical candidate failure cannot publish a partial action', async () => {
    const s = createTacticalSession3D(initial(), {reduceTranslation: ({game}) => ({ap: game.ap - 1}), reduceTick: () => {throw Error('Held candidate rejection');}});
    const saved = s.snapshot(), b = s.branch({horizonTicks: 1}); b.translateWithMotion({cells: [[3, 2, 3], [4, 2, 3]], path: [[0, 0, 1]]});
    await expect(b.advance(1)).rejects.toThrow(/Held candidate rejection/); expect(s.snapshot()).toEqual(saved); expect(b.status).toBe('failed');
  });
});
