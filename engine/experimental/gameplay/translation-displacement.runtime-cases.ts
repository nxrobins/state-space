/** Held physical continuation. Never selected by the edit-only configuration. */
import { describe, expect, test } from 'vitest';
import { MAT } from '../3d.js';
import { CpuStructuralWorld3D } from '../structural/structural-world-core.js';
import {
  createTacticalSession3D,
  createTerrainBody3D,
  createTerrainDisplacement3D,
  createTranslationDisplacement3D,
} from '../tactical-session.js';
import type { TerrainBodyState3D } from '../terrain/terrain-body.js';
import type { TacticalSessionPolicy3D } from '../tactical/tactical-session-view.js';

type Game = { body: TerrainBodyState3D; ap: number };
function initial() {
  const w = new CpuStructuralWorld3D({ width: 8, height: 8, depth: 8, chunkSize: 4 });
  w.setCell(3, 3, 3, MAT.STONE);
  w.setIntegrity(3, 3, 3, 73);
  const terrain = w.snapshot(),
    worldId = 'physical-translation-actor',
    gameRulesVersion = 'actor-fixture-1';
  const binding = createTacticalSession3D({ worldId, gameRulesVersion, terrain, game: {} });
  return {
    worldId,
    gameRulesVersion,
    terrain,
    game: {
      body: createTerrainBody3D(binding.queries(), {
        minQ: [3328, 2560, 3328],
        sizeQ: [512, 512, 512],
      }),
      ap: 2,
    },
  };
}
const policy: TacticalSessionPolicy3D<Game> = {
  requiresPaths: true,
  reduceTranslation: ({ game, beforeQueries, queries, movement }) => {
    const r = createTranslationDisplacement3D(beforeQueries(), queries(), movement()).resolve(
      game.body,
    );
    if (r.status !== 'resolved') throw Error('Unresolved held translation');
    return { body: r.body, ap: game.ap - 1 };
  },
  reduceTick: ({ game, beforeQueries, queries, movement }) => {
    const r = createTerrainDisplacement3D(beforeQueries(), queries(), movement()).resolve(
      game.body,
    );
    if (r.status !== 'resolved') throw Error('Unresolved held physical tick');
    return { ...game, body: r.body };
  },
};
const request = {
  cells: [[3, 3, 3]] as [number, number, number][],
  path: [[1, 0, 0]] as [number, number, number][],
};

describe('held translation-driven actor physical continuation', () => {
  test('a translated rider subsequently follows an actual falling support', async () => {
    const s = createTacticalSession3D(initial(), policy),
      b = s.branch({ horizonTicks: 1 });
    b.translate(request);
    await b.advance(1);
    const r = s.commit(b).snapshot;
    expect(r.game.body.minQ).toEqual([4352, 3584, 3328]);
    expect(r.game.body.grounded).toBe(true);
    expect(r.game.ap).toBe(1);
    expect(r.terrain.tick).toBe(1);
  });
  test('actor and terrain resume identically from an odd-tick save after translation', async () => {
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
  test('coupling actors to translation and ticks leaves authoritative physical state unchanged', async () => {
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
