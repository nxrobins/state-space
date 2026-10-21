/** Held real physics/support gate; excluded from edit/inert verification. */
import { describe, expect, test } from 'vitest';
import { MAT } from './3d.js';
import { CpuStructuralWorld3D } from './structural-world-core.js';
import { createTacticalSession3D } from './tactical-session.js';

function initial() {
  const w = new CpuStructuralWorld3D({ width: 4, height: 4, depth: 4, chunkSize: 4 });
  w.setCell(1, 1, 1, MAT.STONE, 100);
  w.setIntegrity(1, 1, 1, 73);
  w.setCell(0, 0, 0, MAT.WATER);
  return {
    worldId: 'real-action-journal',
    gameRulesVersion: 'journal-fixture-1',
    terrain: w.snapshot(),
    game: { ap: 2 },
  };
}
describe('held physical action-journal acceptance', () => {
  test('capturing mixed interventions and ticks preserves complete committed state and accounting', async () => {
    const seed = initial(),
      plain = createTacticalSession3D(seed),
      captured = createTacticalSession3D(seed);
    for (const [s, captureJournal] of [
      [plain, false],
      [captured, true],
    ] as const) {
      const b = s.branch({ horizonTicks: 3, captureJournal });
      b.translate({ cells: [[1, 1, 1]], path: [[1, 0, 0]] });
      b.addEnergy([{ x: 2, y: 1, z: 1, deltaQ: 9 }]);
      b.hold({ id: 'lift', cells: [[2, 1, 1]], expiresAtTick: 1 });
      b.setGame({ ap: 1 });
      await b.advance(3);
      s.commit(b);
    }
    expect(captured.snapshot()).toEqual(plain.snapshot());
  });
  test('release/restoration records distant bridge support even with identical final geometry', () => {
    const w = new CpuStructuralWorld3D({ width: 8, height: 4, depth: 4, chunkSize: 4 });
    for (let x = 0; x < 8; x++) w.setCell(x, 1, 1, MAT.STONE);
    w.setAnchor(0, 1, 1, true);
    const s = createTacticalSession3D({ ...initial(), terrain: w.snapshot() }),
      b = s.branch({ horizonTicks: 0, captureJournal: true });
    b.edit([{ kind: 'anchor', x: 0, y: 1, z: 1, anchored: false }]);
    b.edit([{ kind: 'anchor', x: 0, y: 1, z: 1, anchored: true }]);
    for (const event of b.journal().events)
      expect(event.changes.domains[0].channels.support.runs).toEqual([[40, 8]]);
    expect(b.changes().domains[0].channels.support.count).toBe(0);
  });
  test('odd-tick restart reproduces event details and full authoritative continuation', async () => {
    const a = createTacticalSession3D(initial()),
      first = a.branch({ horizonTicks: 3 });
    await first.advance(3);
    const saved = a.commit(first).snapshot;
    const b = createTacticalSession3D(initial());
    b.restore(saved);
    const left = a.branch({ horizonTicks: 2, captureJournal: true }),
      right = b.branch({ horizonTicks: 2, captureJournal: true });
    await left.advance(2);
    await right.advance(2);
    expect(left.journal().events).toEqual(right.journal().events);
    expect(a.commit(left).snapshot).toEqual(b.commit(right).snapshot);
  });
});
