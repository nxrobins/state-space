import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Exact edit geometry and synthetic tick observations; no material execution. */
import { describe, expect, test } from 'vitest';
import { MAT } from '../3d.js';

import { CpuStructuralWorld3D } from '../structural-world-core.js';
import { createTacticalSession3D } from '../tactical-session.js';
import { createTerrainBody3D } from './terrain-body.js';
import { createTranslationBodyGroup3D, type NamedTerrainBody3D } from './terrain-body-group.js';
import { createTerrainActorGroup3D, createTranslatedActorGroup3D, TERRAIN_ACTOR_GROUP_RULES_3D } from './terrain-actor-group.js';
import { createTacticalSessionCore3D } from '../tactical/tactical-session-core.js';
import { seed, factory, index } from './terrain-motion.fixtures.js';
import { createSlabInitial, createSlabPolicy, createSlabSession, prepareSlabCommand } from '../../../examples/tactical-slab/scenario.js';
import { createSlabController } from '../../../examples/tactical-slab/controller.js';
import { createTacticalWorkerHost3D } from '../tactical/tactical-worker-host.js';
import { createTacticalWorkerClient3D } from '../tactical/tactical-worker-client.js';
import type { TacticalTransport3D } from '../tactical/tactical-worker-wire.js';
import type { TranslationRequest3D } from '../interventions.js';
import type { TerrainActorGroup3D } from './terrain-actor-group.js';
holdPhysics('solveStructure3D', ...STRUCTURAL_CALLS);
type V = [number, number, number];
const Q = 1024;
const platform: TranslationRequest3D = {cells: [[2, 4, 3]], path: [[1, 0, 0]]};
function fixture(request = platform, extra: V[] = [], maxEntries?: number) {
  const w = new CpuStructuralWorld3D({width: 8, height: 8, depth: 8, chunkSize: 4});
  for (const p of [...request.cells, ...extra]) w.setCell(...p, MAT.STONE);
  const s = createTacticalSession3D({worldId: 'peer-room', gameRulesVersion: 'peer-test-1', terrain: w.snapshot(), game: null}), b = s.branch({horizonTicks: 0});
  const action = b.translateWithMotion(request, {maxEntries}), before = action.beforeQueries(), after = action.queries(), m = action.movement();
  return {s, b, action, group: createTranslatedActorGroup3D(before, after, m), legacy: createTranslationBodyGroup3D(before, after, m),
    body(id: string, min: V, size: V = [0.5, 0.5, 0.5]): NamedTerrainBody3D {return {id, body: createTerrainBody3D(before, {minQ: min.map(v => v * Q), sizeQ: size.map(v => v * Q), gravityQ: 0})};}};
}
function crossing(path: V[] = [[1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0]]) {
  const f = fixture({...platform, path}); return {...f, units: [f.body('a', [2.25, 3.5, 3.25]), f.body('b', [4.25, 3.25, 3.25])]};
}
function peerChamber() {
  const initial = createSlabInitial(), s = createSlabSession();
  initial.game.units[1].body = createTerrainBody3D(s.queries(), {minQ: [2304, 3072, 2304], sizeQ: [512, 768, 512], gravityQ: 64});
  return createTacticalSessionCore3D(initial, () => {throw Error('Zero tick only.');}, createSlabPolicy(), async () => {});
}
describe('exact terrain-driven peer contacts', () => {
  test('new contract rejects transient crossing even when final boxes are clear', () => {
    const f = crossing(), old = f.legacy.resolve(f.units), r = f.group.resolve(f.units);
    expect(TERRAIN_ACTOR_GROUP_RULES_3D).toBe('terrain-actor-group-1'); expect(old.rulesVersion).toBe('terrain-body-group-1'); expect(old.status).toBe('resolved');
    expect(old.bodies.map(u => u.body.minQ[0])).toEqual([6.25 * Q, 4.25 * Q]);
    expect(r).toMatchObject({status: 'unresolved', reason: 'peer-contact', bodies: f.units, responses: [], failure: null, requiresReexecution: false,
      peerContact: {first: 'a', second: 'b', kind: 'swept-overlap', pass: 1, time: {numerator: 1, denominator: 2}, normal: [-1, 0, 0]}});
    expect(f.group.resolve([...f.units].reverse())).toEqual(r);
  });
  test('returning a platform to its starting cell does not erase intermediate peer contact', () => {
    const f = crossing([[1, 0, 0], [1, 0, 0], [-1, 0, 0], [-1, 0, 0]]), old = f.legacy.resolve(f.units);
    expect(old.bodies.map(u => u.body.minQ)).toEqual(f.units.map(u => u.body.minQ)); expect(f.group.resolve(f.units).peerContact?.pass).toBe(1);
  });
  test('delayed terrain pushes use the true contact time on all three axes', () => {
    for (const axis of [0, 1, 2]) {
      const cell: V = [3, 3, 3], path: V = [0, 0, 0], peer: V = [3.25, 3.25, 3.25]; cell[axis] = 2; path[axis] = 1; peer[axis] = 4.25;
      const f = fixture({cells: [cell], path: [path]}), units = [f.body('a', [3.25, 3.25, 3.25]), f.body('b', peer)], r = f.group.resolve(units), normal = [0, 0, 0]; normal[axis] = -1;
      expect(r.peerContact).toMatchObject({pass: 0, time: {numerator: 3, denominator: 4}, normal}); expect(r.bodies).toEqual(units);
    }
  });
  test('negative-axis pushes retain exact signs and time', () => {
    for (const axis of [0, 1, 2]) {
      const cell: V = [3, 3, 3], path: V = [0, 0, 0], peer: V = [3.25, 3.25, 3.25]; cell[axis] = 4; path[axis] = -1; peer[axis] = 2.25;
      const f = fixture({cells: [cell], path: [path]}), r = f.group.resolve([f.body('a', [3.25, 3.25, 3.25]), f.body('b', peer)]), normal = [0, 0, 0]; normal[axis] = 1;
      expect(r.peerContact).toMatchObject({pass: 0, time: {numerator: 3, denominator: 4}, normal});
    }
  });
  test('piecewise clipping checks realized motion rather than requested carry', () => {
    const f = fixture(platform, [[3, 3, 3]]), units = [f.body('a', [2.25, 2.5, 3.25], [0.5, 1.5, 0.5]), f.body('b', [3.25, 2.25, 3.25])];
    const r = f.group.resolve(units); expect(r.status).toBe('resolved'); expect(r.bodies[0].body.minQ[0]).toBe(2.5 * Q); expect(r.peerContact).toBeNull();
  });
  test('parallel supported actors moving together remain separated', () => {
    const f = fixture({cells: [[2, 4, 3], [4, 4, 3]], path: [[1, 0, 0]]}), units = [f.body('a', [2.25, 3.5, 3.25]), f.body('b', [4.25, 3.5, 3.25])];
    const r = f.group.resolve(units); expect(r.status).toBe('resolved'); expect(r.bodies.map(u => u.body.minQ[0])).toEqual([3.25 * Q, 5.25 * Q]);
  });
  test('touching only at the final time is not positive overlap', () => {
    const f = fixture(), units = [f.body('a', [2.25, 3.5, 3.25]), f.body('b', [3.75, 3.25, 3.25])]; expect(f.group.resolve(units).status).toBe('resolved');
  });
  test('lateral grazing along a shared face is permitted throughout a crossing', () => {
    const f = crossing(), units = [f.units[0], f.body('b', [4.25, 3.25, 3.75])]; expect(f.group.resolve(units).status).toBe('resolved');
  });
  test('initial overlap returns original bodies with a separate diagnostic', () => {
    const f = fixture(), first = f.body('a', [2.25, 3.5, 3.25]), units = [first, {...first, id: 'b'}], r = f.group.resolve(units);
    expect(r).toMatchObject({status: 'unresolved', bodies: units, peerContact: {kind: 'initial-overlap', pass: null, time: {numerator: 0, denominator: 1}, normal: [0, 0, 0]}}); expect(f.legacy.resolve(units).status).toBe('resolved');
  });
  test('chronological contact beats lexical pair ordering', () => {
    const f = crossing(), units = [f.units[0], f.body('b', [5.25, 3.25, 3.25]), f.body('z', [3.25, 3.25, 3.25])], r = f.group.resolve(units);
    expect(r.peerContact).toMatchObject({first: 'a', second: 'z', pass: 0, time: {numerator: 1, denominator: 2}});
  });
  test('simultaneous contacts use portable pair IDs', () => {
    const f = crossing(), units = [f.units[0], f.body('z', [4.25, 3.25, 3]), f.body('B', [4.25, 3.25, 3.5])];
    const r = f.group.resolve(units); expect(r.peerContact).toMatchObject({first: 'B', second: 'a', pass: 1, normal: [1, 0, 0]}); expect(f.group.resolve([...units].reverse())).toEqual(r);
  });
  test('fractional contact at one Q is retained without epsilon tolerances', () => {
    const f = fixture(), units = [f.body('a', [2.25, 3.5, 3.25]), f.body('b', [2.75 + 1 / Q, 3.25, 3.25])];
    expect(f.group.resolve(units).peerContact?.time).toEqual({numerator: 1, denominator: Q});
  });
  test('zero and one actor retain individual behavior without peer work', () => {
    const f = fixture(); expect(f.group.resolve([])).toMatchObject({status: 'resolved', peerWork: 0, work: 0, evaluatedBodies: 0});
    const input = [f.body('a', [2.25, 3.5, 3.25])], r = f.group.resolve(input), old = f.legacy.resolve(input); expect(r.bodies).toEqual(old.bodies); expect(r.responses).toEqual(old.responses); expect(r.peerWork).toBe(0);
  });
  test('peer work consumes the same remaining group budget', () => {
    const f = crossing(), old = f.legacy.resolve(f.units), r = f.group.resolve(f.units, {maxWork: old.work});
    expect(r).toMatchObject({status: 'incomplete', reason: 'peer-budget', work: old.work, peerWork: 0, peerContact: null, bodies: f.units, responses: [], requiresReexecution: true});
    const full = f.group.resolve(f.units); expect(f.group.resolve(f.units, {maxWork: full.work})).toEqual(full);
  });
  test('budget exhaustion after one pair hides unproven contact prefixes', () => {
    const f = crossing(), units = [...f.units, f.body('c', [6, 1, 1])], old = f.legacy.resolve(units), r = f.group.resolve(units, {maxWork: old.work + 3});
    expect(r.status).toBe('incomplete'); expect(r.peerContact).toBeNull(); expect(r.responses).toEqual([]); expect(r.bodies).toEqual(units);
  });
  test('a terrain failure retains its original diagnostic and does not claim peer resolution', () => {
    const f = fixture({...platform, path: [[0, -1, 0]]}, [[2, 2, 3]]), units = [f.body('a', [2.25, 3.5, 3.25])], r = f.group.resolve(units);
    expect(r.status).toBe('unresolved'); expect(r.reason).toBe('terrain-response'); expect(r.failure?.response.status).toBe('crushed'); expect(r.peerWork).toBe(0);
  });
  test('incomplete observed paths remain incomplete before any peer result', () => {
    const f = fixture(platform, [], 0), r = f.group.resolve([f.body('a', [2.25, 3.5, 3.25])]);
    expect(r.status).toBe('incomplete'); expect(r.reason).toBe('terrain-response'); expect(r.peerContact).toBeNull();
  });
  test('invalid identities body arrays and budgets reject as in the legacy group', () => {
    const f = crossing(); for (const units of [[f.units[0], f.units[0]], new Array(2), [{...f.units[0], body: {...f.units[0].body, worldId: 'foreign'}}]]) expect(() => f.group.resolve(units)).toThrow();
    for (const options of [{maxWork: -1}, {maxContacts: 0.5}, {extra: 1}]) expect(() => f.group.resolve(f.units, options as never)).toThrow();
  });
  test('returned contact and body mutations cannot affect future resolution', () => {
    const f = crossing(), before = structuredClone(f.units), expected = f.group.resolve(f.units), result = f.group.resolve(f.units);
    result.peerContact!.time.numerator = 99; result.bodies[0].body.minQ[0] = 0; expect(f.group.resolve(f.units)).toEqual(expected); expect(f.units).toEqual(before);
  });
  test('foreign geometry and cloned observations cannot bind an actor group', () => {
    const f = fixture(), g = fixture(); expect(() => createTranslatedActorGroup3D(f.action.beforeQueries(), g.action.queries(), f.action.movement())).toThrow();
    expect(() => createTranslatedActorGroup3D(f.action.beforeQueries(), f.action.queries(), structuredClone(f.action.movement()))).toThrow();
  });
  test('synthetic falling terrain reports the exact peer collision within its tick pass', async () => {
    let group!: TerrainActorGroup3D, units!: NamedTerrainBody3D[];
    const s = createTacticalSessionCore3D({worldId: 'inert-peer', gameRulesVersion: 'test-1', terrain: seed([[1, 1, 1, MAT.STONE]]), game: null}, factory({falls: [[index(1, 1, 1)]]}), {
      requiresPaths: true, reduceTick(c) {const before = c.beforeQueries(); group = createTerrainActorGroup3D(before, c.queries(), c.movement()); units = [2.25, 3.25].map((y, i) => ({id: i ? 'b' : 'a', body: createTerrainBody3D(before, {minQ: [1.25 * Q, y * Q, 1.25 * Q], sizeQ: [Q / 2, Q / 2, Q / 2]})})); return c.game;},
    }, async () => {});
    const b = s.branch({horizonTicks: 1}); await b.advance(1); const r = group.resolve(units); expect(r.scope).toBe('logical-tick-domain'); expect(r.peerContact).toMatchObject({pass: 0, time: {numerator: 3, denominator: 4}, normal: [0, -1, 0]}); b.discard();
  });
  test('chamber peer conflict atomically rejects terrain actors AP and saved wind', async () => {
    const s = peerChamber(), before = s.snapshot(), c = createSlabController(s), result = await c.request({kind: 'lift'}, 0).result;
    expect(result).toMatchObject({status: 'failed', error: expect.stringMatching(/actor contact between rider and scout/)}); expect(s.snapshot()).toEqual(before); await c.close();
  });
  test('mock worker reports chamber contact failure without publishing a revision', async () => {
    const s = peerChamber(), before = s.snapshot(); let receiveHost = (_: unknown) => {}, receiveClient = (_: unknown) => {};
    const transport = (host: boolean): TacticalTransport3D => ({send(v) {queueMicrotask(() => (host ? receiveClient : receiveHost)(structuredClone(v)));}, subscribe(fn) {if (host) receiveHost = fn; else receiveClient = fn; return () => {};}, close() {}});
    const host = createTacticalWorkerHost3D(transport(true), s, prepareSlabCommand, 'peers'), client = createTacticalWorkerClient3D(transport(false), {channel: 'peers', worldId: before.worldId, gameRulesVersion: before.gameRulesVersion});
    await client.ready; const r = await client.request({kind: 'lift'}, 0).result; expect(r).toMatchObject({status: 'failed', error: expect.stringMatching(/actor contact/)}); expect(client.snapshot()).toEqual(before); expect(s.snapshot()).toEqual(before); await client.close(); await host.close();
  });
  test('chamber v4 rejects the earlier save contract without mutating current state', () => {
    const s = createSlabSession(), before = s.snapshot(), bad = structuredClone(before); bad.gameRulesVersion = 'hot-slab-game-3'; expect(() => s.restore(bad)).toThrow(); expect(s.snapshot()).toEqual(before);
  });
});
