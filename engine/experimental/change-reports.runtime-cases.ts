/** Real global support fixtures. Deliberately excluded from the edit/mock suite. */
import { describe, expect, test } from 'vitest';
import { MAT } from './3d.js';
import { CpuStructuralWorld3D } from './structural-world-core.js';
import { createTacticalSession3D } from './tactical-session.js';

function bridge(anchored = true) {
  const world = new CpuStructuralWorld3D({ width: 8, height: 4, depth: 4, chunkSize: 4 });
  for (let x = 0; x < 8; x++) world.setCell(x, 1, 1, MAT.STONE);
  world.setAnchor(0, 1, 1, anchored);
  // An unrelated floor root must not be included in the changed support set.
  world.setCell(2, 3, 3, MAT.STONE);
  return world;
}
function session(
  world = bridge(),
  holds: { id: string; cells: number[]; expiresAtTick: number }[] = [],
) {
  return createTacticalSession3D({
    worldId: 'real-support-reports',
    gameRulesVersion: 'support-fixture-1',
    terrain: world.snapshot(),
    holds,
    game: { ap: 2 },
  });
}

describe('held real-support report verification: no tick advancement', () => {
  test('releasing one bridge anchor reports all eight supported cells including the far end', () => {
    const s = session(),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 0 });
    b.edit([{ kind: 'anchor', x: 0, y: 1, z: 1, anchored: false }]);
    const c = b.changes().domains[0].channels;
    expect(c.structure.runs).toEqual([[40, 1]]);
    expect(c.support.runs).toEqual([[40, 8]]);
    expect(c.support.bounds).toEqual({ min: [0, 1, 1], max: [8, 2, 2] });
    expect(s.snapshot()).toEqual(before);
    expect(b.inspect().terrain.tick).toBe(0);
  });

  test('a local bond cut changes the anchored reaction and distant unsupported members', () => {
    const s = session(),
      b = s.branch({ horizonTicks: 0 });
    b.edit([{ kind: 'bond', x: 0, y: 1, z: 1, direction: 1, bonded: false }]);
    const c = b.changes().domains[0].channels;
    expect(c.structure.runs).toEqual([[40, 2]]);
    expect(c.support.runs).toEqual([[40, 8]]);
    expect(c.material.count).toBe(0);
    expect(c.energy.count).toBe(0);
  });

  test('releasing a temporary hold changes remote support with no canonical terrain edits', () => {
    const s = session(bridge(false), [{ id: 'lift', cells: [40], expiresAtTick: 2 }]),
      b = s.branch({ horizonTicks: 0 });
    b.releaseHold('lift');
    const c = b.changes().domains[0].channels;
    expect(c.constraints.runs).toEqual([[40, 1]]);
    expect(c.structure.count).toBe(0);
    expect(c.support.runs).toEqual([[40, 8]]);
  });

  test('thermal weakening reports capacity changes before material or bonds change', () => {
    const w = bridge();
    w.setEnergy(0, 1, 1, 180 * 256);
    const s = session(w),
      b = s.branch({ horizonTicks: 0 });
    b.addEnergy([{ x: 0, y: 1, z: 1, deltaQ: 256 }]);
    const c = b.changes().domains[0].channels;
    expect(c.support.runs).toEqual([[40, 1]]);
    expect(c.temperature.runs).toEqual([[40, 1]]);
    expect(c.material.count).toBe(0);
    expect(c.structure.count).toBe(0);
  });
});
