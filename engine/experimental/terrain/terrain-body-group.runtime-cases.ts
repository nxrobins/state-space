/** Held actual physics group integration; never selected by edit/mock checks. */
import { describe, expect, test } from 'vitest';
import { MAT } from '../3d.js';
import { CpuStructuralWorld3D } from '../structural-world-core.js';
import {
  createTacticalSession3D,
  createTerrainBody3D,
  createTerrainBodyGroup3D,
  createTranslationBodyGroup3D,
  type NamedTerrainBody3D,
} from '../tactical-session.js';
import { createTerrainActorGroup3D } from './terrain-actor-group.js';
import type { TacticalSessionPolicy3D } from '../tactical/tactical-session-view.js';

type Game = { units: NamedTerrainBody3D[]; ap: number };
function initial() {
  const w = new CpuStructuralWorld3D({ width: 8, height: 8, depth: 8, chunkSize: 4 });
  for (const x of [1, 3]) w.setCell(x, 3, 3, MAT.STONE);
  const terrain = w.snapshot(),
    worldId = 'physical-group',
    gameRulesVersion = 'group-1';
  const s = createTacticalSession3D({ worldId, gameRulesVersion, terrain, game: {} });
  const units = [1, 3].map((x, i) => ({
    id: String(i),
    body: createTerrainBody3D(s.queries(), {
      minQ: [x * 1024 + 256, 2560, 3328],
      sizeQ: [512, 512, 512],
    }),
  }));
  return { worldId, gameRulesVersion, terrain, game: { units, ap: 2 } };
}
const policy: TacticalSessionPolicy3D<Game> = {
  requiresPaths: true,
  reduceTranslation: ({ game, beforeQueries, queries, movement }) => {
    const r = createTranslationBodyGroup3D(beforeQueries(), queries(), movement()).resolve(
      game.units,
    );
    if (r.status !== 'resolved') throw Error('Held translation group failed');
    return { units: r.bodies, ap: game.ap - 1 };
  },
  reduceTick: ({ game, beforeQueries, queries, movement }) => {
    const r = createTerrainBodyGroup3D(beforeQueries(), queries(), movement()).resolve(game.units);
    if (r.status !== 'resolved') throw Error('Held tick group failed');
    return { ...game, units: r.bodies };
  },
};
const request = {
  cells: [
    [1, 3, 3],
    [3, 3, 3],
  ] as [number, number, number][],
  path: [[0, -1, 0]] as [number, number, number][],
};

describe('held actor group physical continuation', () => {
  test('peer-aware falling group preserves independent material and restart outcomes', async () => {
    const peers: TacticalSessionPolicy3D<Game> = {
      ...policy,
      reduceTick(c) {
        const r = createTerrainActorGroup3D(c.beforeQueries(), c.queries(), c.movement()).resolve(
          c.game.units,
        );
        if (r.status !== 'resolved') throw Error('Held peer response unresolved');
        return { ...c.game, units: r.bodies };
      },
    };
    const a = createTacticalSession3D(initial(), peers),
      first = a.branch({ horizonTicks: 1 });
    first.translate(request);
    await first.advance(1);
    const saved = a.commit(first).snapshot;
    const b = createTacticalSession3D(initial(), peers);
    b.restore(JSON.parse(JSON.stringify(saved)));
    const x = a.branch({ horizonTicks: 1 }),
      y = b.branch({ horizonTicks: 1 });
    await x.advance(1);
    await y.advance(1);
    expect(a.commit(x).snapshot).toEqual(b.commit(y).snapshot);
    const baseline = createTacticalSession3D(initial(), policy),
      all = baseline.branch({ horizonTicks: 2 });
    all.translate(request);
    await all.advance(2);
    baseline.commit(all);
    expect(a.snapshot().terrain).toEqual(baseline.snapshot().terrain);
    expect(a.snapshot().accounting).toEqual(baseline.snapshot().accounting);
  });
  test('two lifted riders subsequently follow their actual falling supports', async () => {
    const s = createTacticalSession3D(initial(), policy),
      b = s.branch({ horizonTicks: 1 });
    b.translate(request);
    expect(b.inspect().game.units.map((u) => u.body.minQ[1])).toEqual([1536, 1536]);
    await b.advance(1);
    const r = s.commit(b).snapshot;
    expect(r.game.units.map((u) => u.body.minQ[1])).toEqual([2560, 2560]);
    expect(r.game.ap).toBe(1);
    expect(r.terrain.tick).toBe(1);
  });
  test('the whole actor group and terrain resume exactly from an odd-tick save', async () => {
    const a = createTacticalSession3D(initial(), policy),
      first = a.branch({ horizonTicks: 1 });
    first.translate(request);
    await first.advance(1);
    const saved = a.commit(first).snapshot;
    const b = createTacticalSession3D(initial(), policy);
    b.restore(saved);
    const left = a.branch({ horizonTicks: 2 }),
      right = b.branch({ horizonTicks: 2 });
    await left.advance(2);
    await right.advance(2);
    expect(a.commit(left).snapshot).toEqual(b.commit(right).snapshot);
  });
  test('group observation does not alter physical material or thermal accounting', async () => {
    const seed = initial(),
      a = createTacticalSession3D(seed),
      b = createTacticalSession3D(seed, policy);
    for (const s of [a, b]) {
      const branch = s.branch({ horizonTicks: 2 });
      branch.translate(request);
      await branch.advance(2);
      s.commit(branch);
    }
    expect(a.snapshot().terrain).toEqual(b.snapshot().terrain);
    expect(a.snapshot().accounting).toEqual(b.snapshot().accounting);
  });
});
