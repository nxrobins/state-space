import { holdPhysics } from '../test-support/hold-physics.js';
/** Real conservative edits only. Physical stepping and support solves stay trapped. */
import { describe, expect, test, vi } from 'vitest';
import { MAT } from './3d.js';

import { CpuStructuralWorld3D } from './structural-world-core.js';
import { createTacticalSession3D } from './tactical-session.js';
import { createTerrainBody3D, type TerrainBodyState3D } from './terrain/terrain-body.js';
import { createTranslationDisplacement3D } from './translation-displacement.js';
import { GEOMETRY_SCALE_3D as Q } from './gameplay-geometry.js';
import type { TranslationRequest3D, CellCoordinate3D } from './interventions.js';
import type { TacticalSessionPolicy3D } from './tactical/tactical-session-view.js';

holdPhysics('solveStructure3D', 'step', 'stepWithMotion', 'stepWithMotionPaths');
type V = [number, number, number];
type Cell = [number, number, number, number];
const index = ([x, y, z]: CellCoordinate3D) => x + 8 * (y + 8 * z);
function seed(cells: Cell[] = [[3, 3, 3, MAT.STONE]]) {
  const w = new CpuStructuralWorld3D({width: 8, height: 8, depth: 8, chunkSize: 4}); for (const [x, y, z, material] of cells) w.setCell(x, y, z, material); return w.snapshot();
}
const req: TranslationRequest3D = {cells: [[3, 3, 3]], path: [[1, 0, 0]], externalBonds: 'cut'};
function fixture(terrain = seed(), request = req, maxEntries?: number) {
  const initial = {worldId: 'translation-actors', gameRulesVersion: 'actors-1', terrain, game: {ap: 2}}, s = createTacticalSession3D(initial);
  const b = s.branch({horizonTicks: 0}), action = b.translateWithMotion(request, {maxEntries}), movement = action.movement();
  const context = createTranslationDisplacement3D(action.beforeQueries(), action.queries(), movement);
  return {initial, s, b, action, movement, context, body: (minQ: V, sizeQ: V = [Q / 2, Q / 2, Q / 2]) => createTerrainBody3D(action.beforeQueries(), {minQ, sizeQ})};
}
const rider = (f: ReturnType<typeof fixture>) => f.body([Q * 3.25, Q * 2.5, Q * 3.25]);
type Game = {body: TerrainBodyState3D; ap: number};
const policy: TacticalSessionPolicy3D<Game> = {reduceTranslation: ({game, beforeQueries, queries, movement}) => {
  const result = createTranslationDisplacement3D(beforeQueries(), queries(), movement()).resolve(game.body);
  if (result.status !== 'resolved') throw Error('Actor translation rejected: ' + result.status);
  return {body: result.body, ap: game.ap - 1};
}};
function gameSession(terrain = seed()) {
  const binding = createTacticalSession3D({worldId: 'translation-actors', gameRulesVersion: 'actors-1', terrain, game: {}});
  const initial = {worldId: 'translation-actors', gameRulesVersion: 'actors-1', terrain,
    game: {body: createTerrainBody3D(binding.queries(), {minQ: [Q * 3.25, Q * 2.5, Q * 3.25], sizeQ: [Q / 2, Q / 2, Q / 2]}), ap: 2}};
  return {initial, s: createTacticalSession3D(initial, policy)};
}

describe('exact actors during conservative translations', () => {
  test('grounded actors ride controlled support on all six cardinal axes', () => {
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
      const delta: V = [0, 0, 0]; delta[axis] = sign; const f = fixture(seed(), {...req, path: [delta]}), input = rider(f), r = f.context.resolve(input);
      expect(r.status).toBe('resolved'); expect(r.movedQ).toEqual(delta.map(v => v * Q)); expect(r.body.grounded).toBe(true);
      expect(r.carries).toEqual([{pass: 0, requestedQ: delta.map(v => v * Q), origins: [index([3, 3, 3])]}]);
      expect(r.body.velocityQ).toEqual(input.velocityQ); expect(r.body.gravityQ).toBe(input.gravityQ); expect(r.body.step).toBe(input.step);
    }
  });
  test('fractional actors are pushed by exact remaining travel in all six directions', () => {
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
      const delta: V = [0, 0, 0], minQ: V = [3.25 * Q, 3.25 * Q, 3.25 * Q]; delta[axis] = sign; minQ[axis] += sign * Q;
      const f = fixture(seed(), {...req, path: [delta]}), r = f.context.resolve(f.body(minQ));
      expect(r.status).toBe('resolved'); expect(r.movedQ[axis]).toBe(sign * Q * 0.75); expect(r.contacts[0].time).toEqual({numerator: 1, denominator: 4}); expect(r.contacts[0].normal[axis]).toBe(sign);
    }
  });
  test('non-power-of-two contact offsets retain an exact reduced rational', () => {
    const f = fixture(), r = f.context.resolve(f.body([4 * Q + 13, 3 * Q + 11, 3 * Q + 7], [17, 31, 47]));
    expect(r.status).toBe('resolved'); expect(r.contacts[0].time).toEqual({numerator: 13, denominator: Q}); expect(r.body.minQ).toEqual([5 * Q, 3 * Q + 11, 3 * Q + 7]);
  });
  test('multi-axis paths carry from intermediate support while retaining original identity', () => {
    const f = fixture(seed(), {...req, path: [[1, 0, 0], [0, -1, 0], [0, 0, 1]]}), r = f.context.resolve(rider(f));
    expect(r.status).toBe('resolved'); expect(r.movedQ).toEqual([Q, -Q, Q]); expect(r.throughPass).toBe(2);
    expect(r.carries.map(c => c.origins)).toEqual(Array(3).fill([index([3, 3, 3])])); expect(r.carries.map(c => c.requestedQ)).toEqual([[Q, 0, 0], [0, -Q, 0], [0, 0, Q]]);
  });
  test('an out-and-back platform retains carry history despite equal final positions', () => {
    const f = fixture(seed(), {...req, path: [[1, 0, 0], [-1, 0, 0]]}), input = rider(f), r = f.context.resolve(input);
    expect(r.status).toBe('resolved'); expect(r.movedQ).toEqual([0, 0, 0]); expect(r.body).toEqual(input); expect(r.carries).toHaveLength(2); expect(f.action.receipt.editedCells).toHaveLength(0);
  });
  test('a transient terrain push survives a return to the original material state', () => {
    const f = fixture(seed(), {...req, path: [[1, 0, 0], [-1, 0, 0]]}), r = f.context.resolve(f.body([4.25 * Q, 3.25 * Q, 3.25 * Q]));
    expect(r.status).toBe('resolved'); expect(r.movedQ).toEqual([0.75 * Q, 0, 0]); expect(f.action.receipt.editedCells).toHaveLength(0); expect(r.contacts[0].pass).toBe(0);
  });
  test('all touching controlled supports can jointly authorize a carry', () => {
    const f = fixture(seed([[3, 3, 3, MAT.STONE], [4, 3, 3, MAT.STONE]]), {cells: [[4, 3, 3], [3, 3, 3]], path: [[0, 0, 1]]});
    const r = f.context.resolve(f.body([3.5 * Q, 2.5 * Q, 3.25 * Q], [Q, Q / 2, Q / 2]));
    expect(r.status).toBe('resolved'); expect(r.movedQ).toEqual([0, 0, Q]); expect(r.carries[0].origins).toEqual([index([3, 3, 3]), index([4, 3, 3])]);
  });
  test('mixed fixed and controlled support does not authorize horizontal carry', () => {
    const f = fixture(seed([[3, 3, 3, MAT.STONE], [4, 3, 3, MAT.STONE]]), {...req, path: [[-1, 0, 0]]});
    const r = f.context.resolve(f.body([3.5 * Q, 2.5 * Q, 3.25 * Q], [Q, Q / 2, Q / 2]));
    expect(r.status).toBe('resolved'); expect(r.movedQ).toEqual([0, 0, 0]); expect(r.carries).toEqual([]); expect(r.body.grounded).toBe(true);
  });
  test('a grounded actor on the closed world floor is not carried by unrelated matter', () => {
    const f = fixture(), input = f.body([3.25 * Q, 7.5 * Q, 3.25 * Q]), r = f.context.resolve(input);
    expect(input.grounded).toBe(true); expect(r.status).toBe('resolved'); expect(r.body).toEqual(input); expect(r.carries).toEqual([]);
  });
  test('an explicitly airborne actor does not acquire first-pass horizontal carry', () => {
    const f = fixture(), body = {...rider(f), grounded: false}, r = f.context.resolve(body);
    expect(r.status).toBe('resolved'); expect(r.movedQ).toEqual([0, 0, 0]); expect(r.carries).toEqual([]); expect(r.body.grounded).toBe(false);
  });
  test('a platform arriving under an actor can carry it on the next completed pass', () => {
    const f = fixture(seed(), {...req, path: [[1, 0, 0], [1, 0, 0]]}), body = f.body([4.25 * Q, 2.5 * Q, 3.25 * Q]), r = f.context.resolve(body);
    expect(body.grounded).toBe(false); expect(r.status).toBe('resolved'); expect(r.movedQ).toEqual([Q, 0, 0]); expect(r.carries.map(c => c.pass)).toEqual([1]); expect(r.landed).toBe(true);
  });
  test('contact with a fixed side wall constrains carry and can leave the actor unsupported', () => {
    const f = fixture(seed([[3, 3, 3, MAT.STONE], [4, 2, 3, MAT.STONE]])), r = f.context.resolve(rider(f));
    expect(r.status).toBe('resolved'); expect(r.movedQ).toEqual([Q / 4, 0, 0]); expect(r.carries[0].requestedQ).toEqual([Q, 0, 0]);
    expect(r.contacts[0].origin).toBe(index([4, 2, 3])); expect(r.body.grounded).toBe(false); expect(r.lostFooting).toBe(true);
  });
  test('a lifting platform and fixed ceiling produce an explicit opposing-constraint crush', () => {
    const f = fixture(seed([[3, 3, 3, MAT.STONE], [3, 1, 3, MAT.STONE]]), {...req, path: [[0, -1, 0]]}), input = rider(f), r = f.context.resolve(input);
    expect(r.status).toBe('crushed'); expect(r.crush).toEqual({axis: 1, lowerVelocityQ: 0, upperVelocityQ: -Q}); expect(r.body).toEqual(input); expect(r.movedQ).toEqual([0, 0, 0]);
    expect(r.contacts.some(c => c.origin === index([3, 1, 3]))).toBe(true); expect(r.contacts.some(c => c.origin === index([3, 3, 3]))).toBe(true);
  });
  test('closed boundaries participate in push crush without moving the saved actor', () => {
    const f = fixture(seed([[6, 3, 3, MAT.STONE]]), {cells: [[6, 3, 3]], path: [[1, 0, 0]]}), input = f.body([7.25 * Q, 3.25 * Q, 3.25 * Q]), r = f.context.resolve(input);
    expect(r.status).toBe('crushed'); expect(r.contacts.some(c => c.boundary === 1)).toBe(true); expect(r.body).toEqual(input); expect(r.movedQ).toEqual([0, 0, 0]);
  });
  test('relocated powder overlapping an actor is endpoint-only unresolved contact', () => {
    const f = fixture(seed([[3, 3, 3, MAT.WATER], [4, 3, 3, MAT.SAND]]), {...req, displacement: 'mobile'}), input = f.body([3.25 * Q, 3.25 * Q, 3.25 * Q]), r = f.context.resolve(input);
    expect(r.status).toBe('embedded'); expect(r.reason).toBe('relocation-overlap'); expect(r.body).toEqual(input);
    expect(r.contacts).toHaveLength(1); expect(r.contacts[0]).toMatchObject({origin: index([4, 3, 3]), from: index([4, 3, 3]), to: index([3, 3, 3]), time: {numerator: 1, denominator: 1}});
  });
  test('liquid and gas movement does not become a blocking force or support', () => {
    for (const material of [MAT.WATER, MAT.STEAM]) {
      const f = fixture(seed([[3, 3, 3, material]])), input = f.body([4.25 * Q, 3.25 * Q, 3.25 * Q]), r = f.context.resolve(input);
      expect(r.status).toBe('resolved'); expect(r.movedQ).toEqual([0, 0, 0]); expect(r.contacts).toEqual([]); expect(r.carries).toEqual([]);
    }
  });
  test('solid frozen and powder supports use the same geometric carry contract', () => {
    for (const material of [MAT.STONE, MAT.ICE, MAT.SAND]) {
      const f = fixture(seed([[3, 3, 3, material]])), r = f.context.resolve(rider(f)); expect(r.status).toBe('resolved'); expect(r.movedQ).toEqual([Q, 0, 0]);
    }
  });
  test('final exposure follows the resolved actor rather than its original coordinates', () => {
    const f = fixture(seed([[3, 3, 3, MAT.STONE], [4, 2, 3, MAT.WATER]])), r = f.context.resolve(rider(f));
    expect(r.status).toBe('resolved'); expect(r.exposure.materials.some(m => m.material === MAT.WATER && BigInt(m.volumeQ3) > 0n)).toBe(true);
  });
  test('initial overlap and outside state fail without altering supplied actor fields', () => {
    const f = fixture(), body = rider(f), embedded = {...body, minQ: [3 * Q, 3 * Q, 3 * Q] as V}, outside = {...body, minQ: [-1, 0, 0] as V};
    expect(f.context.resolve(embedded)).toMatchObject({status: 'embedded', reason: 'initial-overlap', body: embedded}); expect(f.context.resolve(outside)).toMatchObject({status: 'outside', reason: 'initial-outside', body: outside});
  });
  test('incomplete path capture cannot be mistaken for an empty safe translation', () => {
    const f = fixture(seed(), req, 0), input = rider(f), r = f.context.resolve(input);
    expect(r.status).toBe('incomplete'); expect(r.reason).toBe('missing-paths'); expect(r.requiresReexecution).toBe(true); expect(r.carries).toEqual([]); expect(r.body).toEqual(input);
  });
  test('one support identity plus one header consumes exactly two carry entries', () => {
    const f = fixture(), input = rider(f); expect(f.context.resolve(input, {maxCarryEntries: 2}).status).toBe('resolved');
    expect(f.context.resolve(input, {maxCarryEntries: 1})).toMatchObject({status: 'incomplete', reason: 'budget', body: input, movedQ: [0, 0, 0], carries: []});
  });
  test('late carry-detail overflow clears the entire partial result and preserves input', () => {
    const f = fixture(seed(), {...req, path: [[1, 0, 0], [0, 0, 1]]}), input = rider(f), r = f.context.resolve(input, {maxCarryEntries: 3});
    expect(r).toMatchObject({status: 'incomplete', reason: 'budget', body: input, carries: [], contacts: [], crush: null, movedQ: [0, 0, 0]});
  });
  test('contact event and work budgets reject their first unavailable unit', () => {
    const f = fixture(), input = f.body([4.25 * Q, 3.25 * Q, 3.25 * Q]);
    for (const options of [{maxContacts: 0}, {maxEvents: 0}, {maxWork: 0}]) expect(f.context.resolve(input, options)).toMatchObject({status: 'incomplete', body: input, contacts: [], carries: []});
  });
  test('invalid options reject accessors without running getters', () => {
    const f = fixture(), input = rider(f), getter = vi.fn(() => 3);
    for (const options of [null, [], {extra: 1}, {maxCarryEntries: -1}, {maxCarryEntries: 65537}, {maxCarryEntries: 0.5}, {maxCarryEntries: NaN}, {maxEvents: -1}, Object.create({maxCarryEntries: 2}), Object.defineProperty({}, 'maxCarryEntries', {enumerable: true, get: getter})]) expect(() => f.context.resolve(input, options as never)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  test('same-looking foreign geometry and copied observations cannot acquire provenance', () => {
    const a = fixture(), b = fixture(); expect(a.action.beforeQueries().stamp).toEqual(b.action.beforeQueries().stamp);
    expect(() => createTranslationDisplacement3D(a.action.beforeQueries(), b.action.queries(), a.movement)).toThrow(/boundaries/);
    expect(() => createTranslationDisplacement3D(a.action.beforeQueries(), a.action.queries(), structuredClone(a.movement))).toThrow(/live translation/);
    expect(() => createTranslationDisplacement3D({...a.action.beforeQueries()}, a.action.queries(), a.movement)).toThrow(/isolated/);
  });
  test('public report edits and actor iteration order cannot change private responses', () => {
    const f = fixture(), input = rider(f), expected = f.context.resolve(input); f.movement.paths.passes.length = 0; f.movement.paths.controlledSources.length = 0; f.movement.status = 'overflow';
    f.context.resolve(f.body([0, 0, 0])); expect(f.context.resolve(input)).toEqual(expected); expect(createTranslationDisplacement3D(f.action.beforeQueries(), f.action.queries(), f.movement).resolve(input)).toEqual(expected);
  });
  test('results and retained contexts remain isolated after commit edits and restore', () => {
    const f = fixture(), input = rider(f), expected = f.context.resolve(input), result = f.context.resolve(input); f.s.commit(f.b); const saved = f.s.snapshot();
    const b = f.s.branch({horizonTicks: 0}); b.edit([{kind: 'material', x: 4, y: 3, z: 3, material: MAT.AIR}]); f.s.commit(b); f.s.restore(saved);
    result.body.minQ[0] = 0; result.carries[0].origins[0] = 0; result.carries[0].requestedQ[0] = 0; result.exposure.materials.length = 0;
    expect(f.context.resolve(input)).toEqual(expected); expect(Object.isFrozen(f.context)).toBe(true);
  });
  test('queries preserve terrain history energy ledger and the supplied saved actor', () => {
    const f = fixture(), input = rider(f), copy = structuredClone(input), live = f.s.snapshot(), candidate = f.b.inspect(); f.context.resolve(input);
    expect(input).toEqual(copy); expect(f.s.snapshot()).toEqual(live); expect(f.b.inspect()).toEqual(candidate);
  });
  test('translation policy commits actor terrain and AP as one zero-tick action', () => {
    const {s} = gameSession(), before = s.snapshot(), b = s.branch({horizonTicks: 0}); b.translate(req); expect(s.snapshot()).toEqual(before);
    const r = s.commit(b).snapshot; expect(r.game.body.minQ).toEqual([4.25 * Q, 2.5 * Q, 3.25 * Q]); expect(r.game.ap).toBe(1); expect(r.terrain.tick).toBe(0); expect(r.accounting).toEqual(before.accounting);
  });
  test('crush rejection preserves complete live actor terrain AP holds accounting and revision', () => {
    const {s} = gameSession(seed([[3, 3, 3, MAT.STONE], [3, 1, 3, MAT.STONE]])), before = s.snapshot(), b = s.branch({horizonTicks: 0});
    expect(() => b.translate({...req, path: [[0, -1, 0]]})).toThrow(/crushed/); expect(s.snapshot()).toEqual(before); expect(b.status).toBe('failed');
  });
  test('saved edit-only actor state continues identically without a physical replay claim', () => {
    const {s: a, initial} = gameSession(), first = a.branch({horizonTicks: 0}); first.translate(req); const saved = a.commit(first).snapshot;
    const b = createTacticalSession3D(initial, policy); b.restore(saved);
    for (const s of [a, b]) {const branch = s.branch({horizonTicks: 0}); branch.translate({cells: [[4, 3, 3]], path: [[0, 0, 1]]}); s.commit(branch);}
    expect(a.snapshot()).toEqual(b.snapshot());
  });
  test('translation response preserves nonzero saved velocity gravity and actor step', () => {
    const f = fixture(), input = {...rider(f), velocityQ: [17, -31, 47] as V, gravityQ: 11, step: 13}, r = f.context.resolve(input);
    expect(r.status).toBe('resolved'); expect(r.body.velocityQ).toEqual(input.velocityQ); expect(r.body.gravityQ).toBe(11); expect(r.body.step).toBe(13);
  });
  test('contact overflow after proposed carry removes all partial diagnostic detail', () => {
    const f = fixture(seed([[3, 3, 3, MAT.STONE], [4, 2, 3, MAT.STONE]])), input = rider(f), r = f.context.resolve(input, {maxContacts: 0});
    expect(r).toMatchObject({status: 'incomplete', requiresReexecution: true, body: input, movedQ: [0, 0, 0], carries: [], contacts: [], crush: null});
  });
});
