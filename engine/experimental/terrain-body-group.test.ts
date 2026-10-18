/** Real edits and inert tick observations only; no physical execution. */
import { afterAll, describe, expect, test, vi } from 'vitest';
import { MAT } from './3d.js';
import * as mechanics from './structural-mechanics.js';
import * as translations from './translation-displacement.js';
import { CpuStructuralWorld3D } from './structural-world-core.js';
import { createTacticalSession3D } from './tactical-session.js';
import { createTacticalSessionCore3D } from './tactical-session-core.js';
import { createTerrainBody3D } from './terrain-body.js';
import { createTerrainBodyGroup3D, createTranslationBodyGroup3D, type NamedTerrainBody3D, type TerrainBodyGroup3D } from './terrain-body-group.js';
import { seed as inertSeed, factory as inertFactory } from './terrain-motion.fixtures.js';
import type { TacticalSessionPolicy3D } from './tactical-session-view.js';
import type { TranslationRequest3D } from './interventions.js';
import type { TickMovement3D } from './path-journal.js';
import type { GameplayGeometry3D } from './gameplay-geometry.js';

const guards = [vi.spyOn(mechanics, 'solveStructure3D'), ...(['step', 'stepWithMotion', 'stepWithMotionPaths'] as const).map(name => vi.spyOn(CpuStructuralWorld3D.prototype, name))];
for (const guard of guards) guard.mockImplementation(() => {throw Error('Physical runtime held.');});
afterAll(() => {for (const guard of guards) {expect(guard).not.toHaveBeenCalled(); guard.mockRestore();}});
const request: TranslationRequest3D = {cells: [[1, 3, 3], [3, 3, 3]], path: [[0, -1, 0]]};
function fixture(ceiling = false) {
  const w = new CpuStructuralWorld3D({width: 8, height: 8, depth: 8, chunkSize: 4}); w.setCell(1, 3, 3, MAT.STONE); w.setCell(3, 3, 3, MAT.STONE);
  if (ceiling) w.setCell(3, 1, 3, MAT.STONE);
  const initial = {worldId: 'group-world', gameRulesVersion: 'group-1', terrain: w.snapshot(), game: {ap: 2}}, s = createTacticalSession3D(initial);
  const units: NamedTerrainBody3D[] = [1, 3].map((x, i) => ({id: i ? 'z' : 'a', body: createTerrainBody3D(s.queries(), {minQ: [x * 1024 + 256, 2560, 3328], sizeQ: [512, 512, 512]})}));
  const branch = s.branch({horizonTicks: 0}), action = branch.translateWithMotion(request);
  const context = createTranslationBodyGroup3D(action.beforeQueries(), action.queries(), action.movement());
  return {s, initial, units, branch, action, context};
}
type Game = {units: NamedTerrainBody3D[]; ap: number};
const policy: TacticalSessionPolicy3D<Game> = {reduceTranslation: ({game, beforeQueries, queries, movement}) => {
  const r = createTranslationBodyGroup3D(beforeQueries(), queries(), movement()).resolve(game.units);
  if (r.status !== 'resolved') throw Error('Group rejected: ' + r.failure!.id);
  return {units: r.bodies, ap: game.ap - 1};
}};

describe('bounded atomic terrain body groups', () => {
  test('all bodies move together in canonical identity order', () => {
    const f = fixture(), r = f.context.resolve([...f.units].reverse()); expect(r.status).toBe('resolved'); expect(r.bodies.map(b => b.id)).toEqual(['a', 'z']);
    expect(r.bodies.map(b => b.body.minQ[1])).toEqual([1536, 1536]); expect(r.evaluatedBodies).toBe(2); expect(r.failure).toBeNull(); expect(r.responses).toHaveLength(2);
    expect(r).toEqual(f.context.resolve(f.units));
  });
  test('late crush returns every original body and removes successful response prefixes', () => {
    const f = fixture(true), r = f.context.resolve(f.units); expect(r.status).toBe('unresolved'); expect(r.failure!.id).toBe('z'); expect(r.failure!.response.status).toBe('crushed');
    expect(r.bodies).toEqual(f.units); expect(r.responses).toEqual([]); expect(r.evaluatedBodies).toBe(2); expect(r.work).toBeGreaterThan(0); expect(r.requiresReexecution).toBe(false);
    expect(f.context.resolve([...f.units].reverse())).toEqual(r);
  });
  test('failure selection is identifier-ordered and stops before later units', () => {
    const f = fixture(true), units = [{...f.units[1], id: 'A'}, {...f.units[0], id: 'z'}], r = f.context.resolve(units);
    expect(r.failure!.id).toBe('A'); expect(r.evaluatedBodies).toBe(1); expect(r.bodies.map(b => b.id)).toEqual(['A', 'z']);
  });
  test('whole-group carry allowance is not refreshed for each actor', () => {
    const f = fixture(), r = f.context.resolve(f.units, {maxCarryEntries: 2}); expect(r.status).toBe('incomplete'); expect(r.failure!.id).toBe('z'); expect(r.bodies).toEqual(f.units); expect(r.responses).toEqual([]);
    expect(f.context.resolve(f.units, {maxCarryEntries: 4}).status).toBe('resolved');
  });
  test('whole-group candidate work is consumed by preceding actors', () => {
    const f = fixture(), first = f.context.resolve([f.units[0]]), r = f.context.resolve(f.units, {maxWork: first.work});
    expect(first.status).toBe('resolved'); expect(r.status).toBe('incomplete'); expect(r.failure!.id).toBe('z'); expect(r.work).toBe(first.work); expect(r.bodies).toEqual(f.units);
  });
  test('actual contact and event allowances are shared rather than multiplied', () => {
    const f = fixture(), a = f.action, before = a.beforeQueries(), input = [1, 3].map((x, i) => ({id: String(i), body: createTerrainBody3D(before, {minQ: [x * 1024 + 256, 2304, 3328], sizeQ: [512, 512, 512]})}));
    const one = f.context.resolve([input[0]]); expect(one.status).toBe('resolved'); expect(one.events).toBeGreaterThan(0);
    for (const budget of [{maxEvents: one.events}, {maxContacts: one.responses[0].response.contacts.length}]) {
      const r = f.context.resolve(input, budget); expect(r.status).toBe('incomplete'); expect(r.failure!.id).toBe('1'); expect(r.bodies).toEqual(input); expect(r.responses).toEqual([]);
    }
  });
  test('zero bodies return an empty group without evaluating a solver', () => {
    const f = fixture(), r = f.context.resolve([], {maxWork: 0, maxContacts: 0, maxEvents: 0, maxCarryEntries: 0});
    expect(r).toMatchObject({status: 'resolved', bodies: [], responses: [], failure: null, evaluatedBodies: 0, work: 0, events: 0});
  });
  test('duplicate unsafe or oversized identities are rejected before any result', () => {
    const f = fixture();
    for (const units of [[f.units[0], f.units[0]], [{...f.units[0], id: ''}], [{...f.units[0], id: 'with spaces'}], [{...f.units[0], id: 'x'.repeat(65)}], Array.from({length: 65}, (_, i) => ({...f.units[0], id: String(i)}))]) expect(() => f.context.resolve(units)).toThrow();
  });
  test('malformed arrays rows and getters are rejected without evaluating accessors', () => {
    const f = fixture(), getter = vi.fn(() => f.units[0]), array = [f.units[0]]; Object.defineProperty(array, '0', {enumerable: true, get: getter});
    for (const units of [null, {}, new Array(1), array, [{id: 'x'}], [{...f.units[0], extra: 1}], [Object.defineProperty({id: 'x'}, 'body', {enumerable: true, get: getter})]]) expect(() => f.context.resolve(units as never)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  test('all saved bodies validate before the first actor response', () => {
    const f = fixture(), created = translations.createTranslationDisplacement3D(f.action.beforeQueries(), f.action.queries(), f.action.movement());
    const resolve = vi.fn(created.resolve), spy = vi.spyOn(translations, 'createTranslationDisplacement3D').mockReturnValue({...created, resolve});
    try {
      const group = createTranslationBodyGroup3D(f.action.beforeQueries(), f.action.queries(), f.action.movement());
      expect(() => group.resolve([f.units[0], {...f.units[1], body: {...f.units[1].body, worldId: 'wrong-world'}}])).toThrow(/Incompatible/);
      expect(resolve).not.toHaveBeenCalled();
    } finally {spy.mockRestore();}
  });
  test('invalid budgets reject hidden fields and getters before work', () => {
    const f = fixture(), getter = vi.fn(() => 1);
    for (const options of [null, [], {extra: 1}, {maxWork: -1}, {maxWork: 1048577}, {maxEvents: 513}, {maxContacts: 4097}, {maxCarryEntries: 65537}, {maxEvents: 0.5}, Object.defineProperty({}, 'maxWork', {enumerable: true, get: getter})]) expect(() => f.context.resolve(f.units, options as never)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  test('response storage cannot mutate input or another group resolution', () => {
    const f = fixture(), original = structuredClone(f.units), expected = f.context.resolve(f.units), r = f.context.resolve(f.units);
    r.bodies[0].body.minQ[0] = 0; r.responses[0].response.body.minQ[1] = 0; r.responses.length = 0;
    expect(f.units).toEqual(original); expect(f.context.resolve(f.units)).toEqual(expected);
  });
  test('failed group output owns original bodies and its failure diagnostics', () => {
    const f = fixture(true), expected = f.context.resolve(f.units), r = f.context.resolve(f.units); r.bodies[0].body.minQ[0] = 0; r.failure!.response.contacts.length = 0;
    expect(f.context.resolve(f.units)).toEqual(expected); expect(f.units[0].body.minQ[0]).toBe(1280);
  });
  test('captured geometry stays fixed after commit edits and restore', () => {
    const f = fixture(), expected = f.context.resolve(f.units); f.s.commit(f.branch); const saved = f.s.snapshot(), b = f.s.branch({horizonTicks: 0});
    b.edit([{kind: 'material', x: 1, y: 2, z: 3, material: MAT.AIR}]); f.s.commit(b); f.s.restore(saved); expect(f.context.resolve(f.units)).toEqual(expected); expect(Object.isFrozen(f.context)).toBe(true);
  });
  test('foreign views and copied movement cannot bind a group', () => {
    const a = fixture(), b = fixture(); expect(() => createTranslationBodyGroup3D(a.action.beforeQueries(), b.action.queries(), a.action.movement())).toThrow(/boundaries/);
    expect(() => createTranslationBodyGroup3D(a.action.beforeQueries(), a.action.queries(), structuredClone(a.action.movement()))).toThrow(/live translation/);
  });
  test('incomplete material path coverage returns all original units', () => {
    const f = fixture(), b = f.s.branch({horizonTicks: 0}), a = b.translateWithMotion(request, {maxEntries: 0}), g = createTranslationBodyGroup3D(a.beforeQueries(), a.queries(), a.movement()), r = g.resolve(f.units);
    expect(r).toMatchObject({status: 'incomplete', requiresReexecution: true, bodies: f.units, responses: [], evaluatedBodies: 1});
  });
  test('querying a group does not publish actor or terrain state', () => {
    const f = fixture(), live = f.s.snapshot(), candidate = f.branch.inspect(); f.context.resolve(f.units); expect(f.s.snapshot()).toEqual(live); expect(f.branch.inspect()).toEqual(candidate);
  });
  test('all updated actors and AP commit together with terrain', () => {
    const f = fixture(), s = createTacticalSession3D({...f.initial, game: {units: f.units, ap: 2}}, policy), saved = s.snapshot(), b = s.branch({horizonTicks: 0});
    b.translate(request); expect(s.snapshot()).toEqual(saved); const r = s.commit(b).snapshot; expect(r.game.ap).toBe(1); expect(r.game.units.map(u => u.body.minQ[1])).toEqual([1536, 1536]); expect(r.accounting).toEqual(saved.accounting);
  });
  test('late unit rejection preserves the full live transaction', () => {
    const f = fixture(true), s = createTacticalSession3D({...f.initial, game: {units: f.units, ap: 2}}, policy), saved = s.snapshot(), b = s.branch({horizonTicks: 0});
    expect(() => b.translate(request)).toThrow(/Group rejected: z/); expect(s.snapshot()).toEqual(saved); expect(b.status).toBe('failed');
  });
  test('tick groups share the same scope and rules without executing real physics', async () => {
    let context!: TerrainBodyGroup3D, before!: GameplayGeometry3D, movement!: TickMovement3D;
    const s = createTacticalSessionCore3D({worldId: 'inert-group', gameRulesVersion: 'group-1', terrain: inertSeed(), game: {}}, inertFactory({}), {
      requiresPaths: true, reduceTick: c => {before = c.beforeQueries(); movement = c.movement(); context = createTerrainBodyGroup3D(before, c.queries(), movement); return c.game;},
    }, async () => {});
    const b = s.branch({horizonTicks: 1}); await b.advance(1);
    const input = [{id: 'one', body: createTerrainBody3D(before, {minQ: [1280, 1280, 1280], sizeQ: [512, 512, 512]})}], r = context.resolve(input, {maxWork: 0, maxContacts: 0, maxEvents: 0, maxCarryEntries: 0});
    expect(r.status).toBe('resolved'); expect(r.scope).toBe('logical-tick-domain'); expect(r.bodies).toEqual(input); expect(r.from).toEqual(movement.from); expect(r.to).toEqual(movement.to);
  });
  test('grouping does not silently introduce actor-actor collision rules', () => {
    const f = fixture(), bodies = [{...f.units[0], id: 'a'}, {...f.units[0], id: 'b'}], r = f.context.resolve(bodies);
    expect(r.status).toBe('resolved'); expect(r.bodies[0].body).toEqual(r.bodies[1].body);
  });
  test('an adapter exceeding the remaining work allowance fails before any group result', () => {
    const f = fixture(), source = translations.createTranslationDisplacement3D(f.action.beforeQueries(), f.action.queries(), f.action.movement());
    const spy = vi.spyOn(translations, 'createTranslationDisplacement3D').mockReturnValue({...source, resolve: (body, limits) => ({...source.resolve(body, limits), work: 1048577})});
    try {const g = createTranslationBodyGroup3D(f.action.beforeQueries(), f.action.queries(), f.action.movement()); expect(() => g.resolve(f.units)).toThrow(/allowance/);} finally {spy.mockRestore();}
  });
});
