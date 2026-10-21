/** Held actual physics acceptance. Never selected by the edit/mock test config. */
import { describe, expect, test } from 'vitest';
import { MAT } from '../3d.js';
import { CpuStructuralWorld3D } from '../structural-world-core.js';
import {
  createTacticalSession3D,
  createTerrainBody3D,
  createTerrainDisplacement3D,
} from '../tactical-session.js';
import type { TacticalSessionPolicy3D } from '../tactical/tactical-session-view.js';
import type { TerrainBodyState3D } from './terrain-body.js';
type Game = { body: TerrainBodyState3D; ap: number };
function seed() {
  const w = new CpuStructuralWorld3D({ width: 4, height: 8, depth: 4, chunkSize: 4 });
  w.setCell(1, 1, 1, MAT.STONE);
  const terrain = w.snapshot(),
    worldId = 'real-displacement',
    gameRulesVersion = 'push-1',
    s = createTacticalSession3D({ worldId, gameRulesVersion, terrain, game: {} });
  return {
    worldId,
    gameRulesVersion,
    terrain,
    game: {
      body: createTerrainBody3D(s.queries(), { minQ: [1280, 2304, 1280], sizeQ: [512, 512, 512] }),
      ap: 2,
    },
  };
}
const policy: TacticalSessionPolicy3D<Game> = {
  requiresPaths: true,
  reduceTick: ({ game, beforeQueries, queries, movement }) => {
    const r = createTerrainDisplacement3D(beforeQueries(), queries(), movement()).resolve(
      game.body,
    );
    if (r.status !== 'resolved') throw Error('Unresolved held displacement fixture');
    return { ...game, body: r.body };
  },
};
describe('held physical terrain-driven actor displacement', () => {
  test('an actual falling fragment pushes the actor by exact remaining travel', async () => {
    const a = createTacticalSession3D(seed(), policy),
      b = createTacticalSession3D(seed(), policy),
      left = a.branch({ horizonTicks: 1 }),
      right = b.branch({ horizonTicks: 1 });
    await left.advance(1);
    await right.advance(1);
    const result = a.commit(left).snapshot;
    expect(result.game.body.minQ).toEqual([1280, 3072, 1280]);
    expect(result).toEqual(b.commit(right).snapshot);
  });
  test('odd-tick saved actor and terrain resume with identical complete state', async () => {
    const a = createTacticalSession3D(seed(), policy),
      first = a.branch({ horizonTicks: 1 });
    await first.advance(1);
    const saved = a.commit(first).snapshot;
    const b = createTacticalSession3D(seed(), policy);
    b.restore(saved);
    const left = a.branch({ horizonTicks: 2 }),
      right = b.branch({ horizonTicks: 2 });
    await left.advance(2);
    await right.advance(2);
    expect(a.commit(left).snapshot).toEqual(b.commit(right).snapshot);
  });
  test('observing displacement leaves authoritative physics and accounting unchanged', async () => {
    const initial = seed(),
      a = createTacticalSession3D(initial),
      b = createTacticalSession3D(initial, {
        requiresPaths: true,
        reduceTick: (context) => {
          createTerrainDisplacement3D(
            context.beforeQueries(),
            context.queries(),
            context.movement(),
          ).resolve(context.game.body);
          return context.game;
        },
      });
    const left = a.branch({ horizonTicks: 2 }),
      right = b.branch({ horizonTicks: 2 });
    await left.advance(2);
    await right.advance(2);
    expect(a.commit(left).snapshot).toEqual(b.commit(right).snapshot);
  });
});
