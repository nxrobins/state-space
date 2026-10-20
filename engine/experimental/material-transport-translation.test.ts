import { holdPhysics, STRUCTURAL_CALLS } from '../test-support/hold-physics.js';
/** Actual conservative edits and bound geometry; no material runtime. */
import { describe, expect, test } from 'vitest';
import { MAT } from './3d.js';
import { CpuStructuralWorld3D } from './structural-world-core.js';

import { createTacticalSession3D } from './tactical-session.js';
import { createMaterialTransport3D } from './material-transport.js';
import { captureMaterialTransportMemory3D as capture, restoreMaterialTransportMemory3D as restore,
  followTranslatedMaterialTransport3D as follow } from './material-transport-coupling.js';
import type { TacticalSessionPolicy3D } from './tactical-session-view.js';
holdPhysics('solveStructure3D', ...STRUCTURAL_CALLS);
function fixture(identical = false) {
  const w = new CpuStructuralWorld3D({width: 4, height: 4, depth: 4, chunkSize: 4});
  w.setCell(1, 1, 1, identical ? MAT.STEAM : MAT.SAND, identical ? 110 : 20); w.setCell(2, 1, 1, MAT.STEAM, 110);
  const terrain = w.snapshot(), state = createMaterialTransport3D(terrain, [{id: 'a', cell: [1, 1, 1], velocityQ: [23, 0, 0]}, {id: 'b', cell: [2, 1, 1], velocityQ: [-47, 0, 0]}]);
  state.cycle = 7; state.parcels[0].remainderQ = [333, 0, 0]; const memory = capture(state);
  type Game = {wind: typeof memory}; const actions: Parameters<NonNullable<TacticalSessionPolicy3D<Game>['reduceTranslation']>>[0][] = [];
  const session = createTacticalSession3D({worldId: 'transport-translation', gameRulesVersion: 'test-1', terrain, game: {wind: memory}}, {
    validateGame({game, terrain: s}) {restore(s, game.wind); return true;},
    reduceTranslation(c) {actions.push(c); return {wind: follow(c.beforeQueries(), c.queries(), c.movement(), c.game.wind).memory};},
  });
  const b = session.branch({horizonTicks: 0});
  return {session, b, actions, memory};
}
function step(f: ReturnType<typeof fixture>) {return f.b.translateWithMotion({cells: [[1, 1, 1]], path: [[1, 0, 0]], displacement: 'mobile'});}
describe('parcel controls through terrain translations', () => {
  test('selected matter and displaced steam keep all saved controls and thermal history', () => {
    const f = fixture(), before = f.session.snapshot(); step(f); const after = f.b.inspect();
    expect(after.game.wind.parcels.map(p => [p.id, p.cell, p.velocityQ[0], p.remainderQ[0]])).toEqual([['a', 22, 23, 333], ['b', 21, -47, 0]]);
    expect(after.game.wind.cycle).toBe(7); expect(after.terrain.tick).toBe(0); expect(after.accounting).toEqual(before.accounting);
    for (const key of ['packedCells', 'energyQ', 'structure'] as const) {expect(after.terrain[key][22]).toBe(before.terrain[key][21]); expect(after.terrain[key][21]).toBe(before.terrain[key][22]);}
    expect(f.session.snapshot()).toEqual(before); f.session.commit(f.b);
  });
  test('identical steam values exchange identities without guessing from cell values', () => {
    const f = fixture(true), before = f.session.snapshot(); step(f);
    expect(f.b.inspect().terrain).toEqual(before.terrain); expect(f.b.inspect().game.wind.parcels.map(p => p.cell)).toEqual([22, 21]); f.b.discard();
  });
  test('multi-axis paths retain the last destination of each original parcel', () => {
    const f = fixture(); f.b.translateWithMotion({cells: [[1, 1, 1]], path: [[1, 0, 0], [0, 0, 1], [0, -1, 0]], displacement: 'mobile'});
    expect(f.b.inspect().game.wind.parcels.map(p => p.cell)).toEqual([34, 21]); f.b.discard();
  });
  test('closed paths restore parcel positions including a displaced occupant', () => {
    const f = fixture(), before = f.b.inspect(); f.b.translateWithMotion({cells: [[1, 1, 1]], path: [[1, 0, 0], [-1, 0, 0]], displacement: 'mobile'});
    expect(f.b.inspect().game.wind).toEqual(before.game.wind); expect(f.b.inspect().terrain).toEqual(before.terrain); f.b.discard();
  });
  test('sequential translations can be saved and continued with unchanged velocity', () => {
    const f = fixture(); step(f); f.b.translateWithMotion({cells: [[2, 1, 1]], path: [[0, 0, 1]], displacement: 'mobile'});
    const saved = JSON.parse(JSON.stringify(f.session.commit(f.b).snapshot)); const other = fixture(); other.b.discard(); other.session.restore(saved);
    expect(other.session.snapshot()).toEqual(saved); expect(restore(saved.terrain, saved.game.wind).parcels[0].cell).toBe(38);
  });
  test('cloned reports and foreign or reversed geometry are rejected', () => {
    const f = fixture(); step(f); const c = f.actions[0], m = c.movement(), other = fixture(); step(other); const d = other.actions[0];
    expect(() => follow(c.beforeQueries(), c.queries(), structuredClone(m), f.memory)).toThrow(/live translation/);
    expect(() => follow(c.beforeQueries(), d.queries(), m, f.memory)).toThrow(/boundaries/);
    expect(() => follow(c.queries(), c.beforeQueries(), m, f.memory)).toThrow(/boundaries/); f.b.discard(); other.b.discard();
  });
  test('public path mutations do not rewrite private original provenance', () => {
    const f = fixture(); step(f); const c = f.actions[0], m = c.movement(); m.paths.passes.length = 0; m.status = 'overflow';
    expect(follow(c.beforeQueries(), c.queries(), m, f.memory).memory).toEqual(f.b.inspect().game.wind); f.b.discard();
  });
  test('wrong cell witnesses reject rather than attaching controls to new matter', () => {
    const f = fixture(); step(f); const c = f.actions[0], bad = structuredClone(f.memory); bad.parcels[0].energyQ++;
    expect(() => follow(c.beforeQueries(), c.queries(), c.movement(), bad)).toThrow(/history/); f.b.discard();
  });
  test('incomplete provenance fails the entire translation candidate', () => {
    const f = fixture(), before = f.session.snapshot();
    expect(() => f.b.translateWithMotion({cells: [[1, 1, 1]], path: [[1, 0, 0]], displacement: 'mobile'}, {maxEntries: 0})).toThrow(/complete material/);
    expect(f.b.status).toBe('failed'); expect(() => f.session.commit(f.b)).toThrow(); expect(f.session.snapshot()).toEqual(before);
  });
  test('returned memory and observations are isolated from the branch and source', () => {
    const f = fixture(); step(f); const c = f.actions[0], out = follow(c.beforeQueries(), c.queries(), c.movement(), f.memory);
    out.memory.parcels[0].velocityQ[0] = 999; out.moved.length = 0;
    expect(f.b.inspect().game.wind.parcels[0].velocityQ[0]).toBe(23); expect(f.memory.parcels[0].cell).toBe(21); f.b.discard();
  });
});
