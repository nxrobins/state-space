/** Held actual physical acceptance; never included in selected edit/mock checks. */
import { describe, expect, test } from 'vitest';
import { MAT } from './3d.js';
import { CpuStructuralWorld3D } from './structural-world-core.js';
import { createTacticalSession3D, createTerrainBody3D, createTerrainMotion3D } from './tactical-session.js';
import type { TacticalSessionPolicy3D } from './tactical-session-view.js';
import type { TerrainBodyState3D } from './terrain-body.js';

type Game = {actor: TerrainBodyState3D; ap: number};
function seed() {
  const w = new CpuStructuralWorld3D({width: 4, height: 4, depth: 4, chunkSize: 4}); w.setCell(1, 2, 1, MAT.STONE);
  const terrain = w.snapshot(), worldId = 'real-carry', gameRulesVersion = 'carry-1';
  const initial = createTacticalSession3D({worldId, gameRulesVersion, terrain, game: {}});
  return {worldId, gameRulesVersion, terrain, game: {actor: createTerrainBody3D(initial.queries(), {minQ: [1024, 1024, 1024], sizeQ: [1024, 1024, 1024]}), ap: 2}};
}
const policy: TacticalSessionPolicy3D<Game> = {requiresPaths: true, reduceTick: ({game, beforeQueries, queries, movement}) => {
  const r = createTerrainMotion3D(beforeQueries(), queries(), movement()).reconcile(game.actor);
  if (r.status !== 'resolved') throw Error('Unresolved actor in held carry fixture'); return {...game, actor: r.body};
}};
describe('held physical actor and moving terrain acceptance', () => {
  test('actual falling support carries the actor and identical runs preserve complete state', async () => {
    const a = createTacticalSession3D(seed(), policy), b = createTacticalSession3D(seed(), policy);
    const left = a.branch({horizonTicks: 1}), right = b.branch({horizonTicks: 1}); await left.advance(1); await right.advance(1);
    const result = a.commit(left).snapshot; expect(result.game.actor.minQ).toEqual([1024, 2048, 1024]); expect(result).toEqual(b.commit(right).snapshot);
  });
  test('saved actor and terrain resume identically from an odd physical tick', async () => {
    const a = createTacticalSession3D(seed(), policy), first = a.branch({horizonTicks: 3}); await first.advance(3); const saved = a.commit(first).snapshot;
    const b = createTacticalSession3D(seed(), policy); b.restore(saved);
    const left = a.branch({horizonTicks: 2}), right = b.branch({horizonTicks: 2}); await left.advance(2); await right.advance(2);
    expect(a.commit(left).snapshot).toEqual(b.commit(right).snapshot);
  });
  test('body contact queries leave all authoritative state identical to unobserved physics', async () => {
    const initial = seed(), a = createTacticalSession3D(initial), b = createTacticalSession3D(initial, {requiresPaths: true, reduceTick: context => {
      createTerrainMotion3D(context.beforeQueries(), context.queries(), context.movement()).reconcile(context.game.actor); return context.game;
    }});
    const left = a.branch({horizonTicks: 2}), right = b.branch({horizonTicks: 2}); await left.advance(2); await right.advance(2);
    expect(a.commit(left).snapshot).toEqual(b.commit(right).snapshot);
  });
});
