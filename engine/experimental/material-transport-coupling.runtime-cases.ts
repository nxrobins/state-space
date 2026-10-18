/** Held M5 integration. Never selected by CPU edit/inert verification. */
import { describe, expect, test } from 'vitest';
import { MAT, createStateSpaceStructuralWorld3D } from './structural-world.js';
import { createTacticalSession3D, createMaterialTransport3D, captureMaterialTransportMemory3D,
  restoreMaterialTransportMemory3D, prepareMaterialTransport3D, followMaterialTransport3D,
  type MaterialTransportMemory3D, type TacticalSessionPolicy3D, type TacticalBranch3D } from './tactical-session.js';
type Game = {ap: number; wind: MaterialTransportMemory3D};
function initial() {
  const w = createStateSpaceStructuralWorld3D({width: 4, height: 4, depth: 4, chunkSize: 4}); w.setCell(1, 0, 1, MAT.SAND);
  const terrain = w.snapshot(); return {worldId: 'physical-wind', gameRulesVersion: 'physical-wind-1', terrain,
    game: {ap: 3, wind: captureMaterialTransportMemory3D(createMaterialTransport3D(terrain, [{id: 'sand', cell: [1, 0, 1]}]))}};
}
const policy: TacticalSessionPolicy3D<Game> = {requiresPaths: true,
  validateGame({game, terrain}) {restoreMaterialTransportMemory3D(terrain, game.wind); return true;},
  reduceTick({game, beforeQueries, queries, movement}) {return {...game, wind: followMaterialTransport3D(beforeQueries(), queries(), movement(), game.wind).memory};},
};
function stage(b: TacticalBranch3D<Game>, impulse: number) {
  prepareMaterialTransport3D(b, b.inspect().game.wind, [{id: 'sand', impulseQ: [impulse, 0, 0]}], ({game, memory}) => ({ap: game.ap - 1, wind: memory}));
}
describe('held exact material transport coupling', () => {
  test('following physical parcel motion does not change M5 terrain or energy accounting', async () => {
    const seed = initial(), a = createTacticalSession3D(seed, policy), b = createTacticalSession3D(seed);
    for (const s of [a, b]) {const branch = s.branch({horizonTicks: 3}); stage(branch, 1024); await branch.advance(3); s.commit(branch);}
    expect(a.snapshot().terrain).toEqual(b.snapshot().terrain); expect(a.snapshot().accounting).toEqual(b.snapshot().accounting);
    restoreMaterialTransportMemory3D(a.snapshot().terrain, a.snapshot().game.wind);
  });
  test('odd-tick save continuation preserves the next transport and physical horizon exactly', async () => {
    const a = createTacticalSession3D(initial(), policy), first = a.branch({horizonTicks: 1}); stage(first, 333); await first.advance(1); const saved = a.commit(first).snapshot;
    const b = createTacticalSession3D(initial(), policy); b.restore(JSON.parse(JSON.stringify(saved)));
    const left = a.branch({horizonTicks: 2}), right = b.branch({horizonTicks: 2}); stage(left, 0); stage(right, 0); await left.advance(2); await right.advance(2);
    expect(a.commit(left).snapshot).toEqual(b.commit(right).snapshot);
  });
});
