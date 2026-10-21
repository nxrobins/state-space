/** Held real physical session agreement; excluded from edit/inert verification. */
import { describe, expect, test } from 'vitest';
import { MAT } from './3d.js';
import { CpuStructuralWorld3D } from './structural/structural-world-core.js';
import { createTacticalSession3D } from './tactical-session.js';

function seed() {
  const w = new CpuStructuralWorld3D({ width: 4, height: 4, depth: 4, chunkSize: 4 });
  w.setCell(1, 1, 1, MAT.STONE, 180);
  w.setIntegrity(1, 1, 1, 70);
  w.setCell(0, 0, 0, MAT.WATER, 120);
  return {
    worldId: 'real-path-session',
    gameRulesVersion: 'path-session-1',
    terrain: w.snapshot(),
    game: { ap: 2 },
  };
}
describe('held tactical path capture acceptance', () => {
  test('captured and uncaptured paths preserve complete authoritative session state', async () => {
    const initial = seed(),
      a = createTacticalSession3D(initial),
      b = createTacticalSession3D(initial);
    const plain = a.branch({ horizonTicks: 4 }),
      captured = b.branch({ horizonTicks: 4, capturePaths: true });
    await plain.advance(4);
    await captured.advance(4);
    expect(captured.paths()).toMatchObject({ status: 'complete', recordsObserved: 4 });
    expect(a.commit(plain).snapshot).toEqual(b.commit(captured).snapshot);
  });
  test('odd-tick restart yields identical retained paths and final full state', async () => {
    const a = createTacticalSession3D(seed()),
      first = a.branch({ horizonTicks: 3, capturePaths: true });
    await first.advance(3);
    const saved = a.commit(first).snapshot;
    const b = createTacticalSession3D(seed());
    b.restore(saved);
    const left = a.branch({ horizonTicks: 2, capturePaths: true }),
      right = b.branch({ horizonTicks: 2, capturePaths: true });
    await left.advance(2);
    await right.advance(2);
    expect(left.paths().frames).toEqual(right.paths().frames);
    expect(a.commit(left).snapshot).toEqual(b.commit(right).snapshot);
  });
  test('path-dependent game policy sees matching physical boundaries after a hold expires', async () => {
    const seen: number[][] = [],
      s = createTacticalSession3D(seed(), {
        requiresPaths: true,
        reduceTick: ({ game, beforeQueries, queries, movement, tick }) => {
          const m = movement();
          expect(m.status).toBe('complete');
          expect(m.from).toEqual(beforeQueries().stamp);
          expect(m.to).toEqual(queries().stamp);
          expect(m.paths!.toTick).toBe(tick);
          seen.push([m.from.tick, m.to.tick]);
          return game;
        },
      });
    const b = s.branch({ horizonTicks: 3 });
    b.hold({ id: 'lift', cells: [[1, 1, 1]], expiresAtTick: 1 });
    await b.advance(3);
    const result = s.commit(b);
    expect(result.snapshot.holds).toEqual([]);
    expect(seen).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(result.paths().status).toBe('complete');
  });
});
