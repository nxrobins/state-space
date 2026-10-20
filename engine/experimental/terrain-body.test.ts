import { holdPhysics } from '../test-support/hold-physics.js';
import { describe, expect, test, vi } from 'vitest';
import { MAT } from './3d.js';

import { CpuStructuralWorld3D } from './structural-world-core.js';
import { createTacticalSession3D } from './tactical-session.js';
import { createTacticalSessionCore3D, type TacticalSimulationFactory3D } from './tactical-session-core.js';
import { createTerrainBody3D, readTerrainBody3D, stepTerrainBody3D, TERRAIN_BODY_LIMITS_3D } from './terrain-body.js';
import { GEOMETRY_SCALE_3D as Q, type GameplayGeometry3D } from './gameplay-geometry.js';

// Pure body/geometry calculations on edited/static snapshots, never M5 ticks/solves.
holdPhysics('solveStructure3D', 'step', 'stepWithMotion');
const world = (size = 4) => new CpuStructuralWorld3D({width: size, height: size, depth: size, chunkSize: 4});
function session(w = world(), worldId = 'body-world') {
  return createTacticalSession3D({worldId, gameRulesVersion: 'body-game-1', terrain: w.snapshot(), game: {ap: 2}});
}
function floor() {const w = world(); for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) w.setCell(x, 3, z, MAT.STONE); return w;}
const axisCases: [number, number][] = [[0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]];

describe('fixed-point bodies on static terrain boundaries', () => {
  test.each(axisCases)('unobstructed motion along axis %s sign %s preserves exact velocity', (axis, sign) => {
    const view = session(world(8)).queries(), velocity = [0, 0, 0]; velocity[axis] = sign * Q;
    const body = createTerrainBody3D(view, {minQ: [3 * Q, 3 * Q, 3 * Q], sizeQ: [Q, Q, Q], velocityQ: velocity, gravityQ: 0});
    const before = structuredClone(body), result = stepTerrainBody3D(view, body);
    expect(result.status).toBe('resolved'); expect(result.movedQ).toEqual(velocity); expect(result.body.velocityQ).toEqual(velocity);
    expect(result.body.step).toBe(1); expect(body).toEqual(before); expect(result.contacts).toEqual([]);
  });
  test.each(axisCases)('closed boundary on axis %s sign %s catches long movement', (axis, sign) => {
    const view = session(world(8)).queries(), velocity = [0, 0, 0]; velocity[axis] = sign * 32 * Q;
    const body = createTerrainBody3D(view, {minQ: [2 * Q, 2 * Q, 2 * Q], sizeQ: [Q, Q, Q], velocityQ: velocity, gravityQ: 0});
    const result = stepTerrainBody3D(view, body), normal = [0, 0, 0]; normal[axis] = -sign;
    expect(result.body.minQ[axis]).toBe(sign > 0 ? 7 * Q : 0); expect(result.body.velocityQ[axis]).toBe(0);
    expect(result.contacts).toHaveLength(1); expect(result.contacts[0].contact).toMatchObject({boundary: true, normal});
  });
  test('creation detects support and stationary gravity preserves the exact floor contact', () => {
    const view = session(floor()).queries(), body = createTerrainBody3D(view, {minQ: [Q, Q, Q], sizeQ: [Q, 2 * Q, Q]});
    expect(body.grounded).toBe(true); const r = stepTerrainBody3D(view, body);
    expect(r.movedQ).toEqual([0, 0, 0]); expect(r.body.velocityQ).toEqual([0, 0, 0]); expect(r.body.grounded).toBe(true);
    expect(r.supportAfter?.surfaces[0].areaQ2).toBe(Q * Q); expect(r.lostFooting).toBe(false); expect(r.landed).toBe(false);
  });
  test('removing the supporting voxel causes footing loss and falling on the candidate view', () => {
    const s = session(floor()), old = s.queries(), body = createTerrainBody3D(old, {minQ: [Q, Q, Q], sizeQ: [Q, 2 * Q, Q]});
    const b = s.branch({horizonTicks: 0}); b.edit([{kind: 'material', x: 1, y: 3, z: 1, material: MAT.AIR}]);
    const r = stepTerrainBody3D(b.queries(), body); expect(r.movedQ).toEqual([0, 64, 0]); expect(r.lostFooting).toBe(true); expect(r.body.grounded).toBe(false);
    expect(stepTerrainBody3D(old, body).movedQ).toEqual([0, 0, 0]); expect(r.stamp).toMatchObject({kind: 'preview', operation: 1});
  });
  test('a falling body lands on a voxel before reaching its requested endpoint', () => {
    const view = session(floor()).queries(), body = createTerrainBody3D(view, {minQ: [Q, 0, Q], sizeQ: [Q, Q, Q], velocityQ: [0, 8 * Q, 0], gravityQ: 0});
    const r = stepTerrainBody3D(view, body); expect(r.movedQ).toEqual([0, 2 * Q, 0]); expect(r.body.grounded).toBe(true); expect(r.landed).toBe(true);
    expect(r.contacts[0].contact).toMatchObject({boundary: false, cell: {coordinate: [1, 3, 1]}, normal: [0, -1, 0]});
  });
  test('ceiling collision clears upward velocity without inventing ground support', () => {
    const w = world(); w.setCell(1, 0, 1, MAT.STONE); const view = session(w).queries();
    const body = createTerrainBody3D(view, {minQ: [Q, Q + 128, Q], sizeQ: [Q, Q, Q], velocityQ: [0, -Q, 0], gravityQ: 0}), r = stepTerrainBody3D(view, body);
    expect(r.movedQ).toEqual([0, -128, 0]); expect(r.body.velocityQ[1]).toBe(0); expect(r.body.grounded).toBe(false); expect(r.contacts[0].contact.normal).toEqual([0, 1, 0]);
  });
  test('fractional-size long movement cannot tunnel through a newly added wall', () => {
    const s = session(world(8)), body = createTerrainBody3D(s.queries(), {minQ: [Q + 17, Q + 19, Q + 23], sizeQ: [Q - 31, Q - 37, Q - 41], velocityQ: [10 * Q, 0, 0], gravityQ: 0});
    const b = s.branch({horizonTicks: 0}); b.edit([{kind: 'material', x: 2, y: 1, z: 1, material: MAT.STONE}]);
    const r = stepTerrainBody3D(b.queries(), body); expect(r.movedQ).toEqual([14, 0, 0]); expect(r.body.minQ[0] + r.body.sizeQ[0]).toBe(2 * Q);
    expect(r.contacts[0].travelledQ).toBe(14);
  });
  test('frozen X then Z then Y order clips X while allowing tangential Z movement', () => {
    const w = world(); w.setCell(2, 1, 1, MAT.STONE); const view = session(w).queries();
    const body = createTerrainBody3D(view, {minQ: [Q, Q, Q], sizeQ: [Q, Q, Q], velocityQ: [Q, 0, Q], gravityQ: 0}), r = stepTerrainBody3D(view, body);
    expect(r.movedQ).toEqual([0, 0, Q]); expect(r.body.velocityQ).toEqual([0, 0, Q]); expect(r.contacts.map(c => c.axis)).toEqual([0]);
  });
  test('impulse, acceleration and saved gravity apply once without wall-clock input', () => {
    const view = session().queries(), body = createTerrainBody3D(view, {minQ: [Q, Q, Q], sizeQ: [Q, Q, Q], velocityQ: [2, 3, 4], gravityQ: 10});
    const command = {impulseQ: [1, 2, 3], accelerationQ: [4, 5, 6]}, r = stepTerrainBody3D(view, body, command);
    expect(r.movedQ).toEqual([7, 20, 13]); expect(r.body.velocityQ).toEqual([7, 20, 13]); expect(r.body.gravityQ).toBe(10);
    expect(stepTerrainBody3D(view, body, command)).toEqual(r);
  });
  test('initial embedding reports exposure but leaves every saved body field unchanged', () => {
    const s = session(), body = createTerrainBody3D(s.queries(), {minQ: [Q, Q, Q], sizeQ: [Q, Q, Q]}), b = s.branch({horizonTicks: 0});
    b.edit([{kind: 'material', x: 1, y: 1, z: 1, material: MAT.STONE}]); const r = stepTerrainBody3D(b.queries(), body);
    expect(r.status).toBe('embedded'); expect(r.body).toEqual(body); expect(r.movedQ).toEqual([0, 0, 0]); expect(r.supportAfter).toBeNull();
    expect(r.initialBlocker?.material).toBe(MAT.STONE); expect(r.exposure.materials[0].material).toBe(MAT.STONE);
  });
  test('outside saved placement returns unchanged state and explicitly unknown outside volume', () => {
    const view = session().queries(), body = createTerrainBody3D(view, {minQ: [Q, Q, Q], sizeQ: [Q, Q, Q]}); body.minQ[0] = -Q / 2;
    const r = stepTerrainBody3D(view, body); expect(r.status).toBe('outside'); expect(r.body).toEqual(body); expect(r.exposure.outsideVolumeQ3).toBe(String(Q ** 3 / 2));
  });
  test('zero-distance negative-direction contact canonicalizes travel to positive zero', () => {
    const view = session().queries(), body = createTerrainBody3D(view, {minQ: [0, Q, Q], sizeQ: [Q, Q, Q], velocityQ: [-1, 0, 0], gravityQ: 0});
    const r = stepTerrainBody3D(view, body); expect(Object.is(r.contacts[0].travelledQ, -0)).toBe(false); expect(r.contacts[0].travelledQ).toBe(0);
  });
  test('body saves and output arrays are isolated and resume exactly on the same geometry', () => {
    const view = session(world(8)).queries(); let a = createTerrainBody3D(view, {minQ: [Q, Q, Q], sizeQ: [Q, Q, Q], velocityQ: [3, 0, 4], gravityQ: 1});
    a = stepTerrainBody3D(view, a).body; let b = readTerrainBody3D(view, JSON.parse(JSON.stringify(a)));
    for (let i = 0; i < 4; i++) {const x = stepTerrainBody3D(view, a), y = stepTerrainBody3D(view, b); expect(x).toEqual(y); a = x.body; b = y.body;}
    const copy = readTerrainBody3D(view, a); copy.minQ[0] = 0; expect(a.minQ[0]).not.toBe(0);
  });
  test('invalid forces, dimensions, counter overflow and malformed arrays reject atomically', () => {
    const view = session().queries(), body = createTerrainBody3D(view, {minQ: [Q, Q, Q], sizeQ: [Q, Q, Q]}), before = structuredClone(body);
    for (const command of [{impulseQ: [0, 32768, 0]}, {accelerationQ: [0, NaN, 0]}, {impulseQ: new Array(3)}, {extra: true}, null]) expect(() => stepTerrainBody3D(view, body, command as never)).toThrow();
    for (const patch of [{sizeQ: [0, Q, Q]}, {sizeQ: [TERRAIN_BODY_LIMITS_3D.sizeQ + 1, Q, Q]}, {gravityQ: -1}, {step: Number.MAX_SAFE_INTEGER}]) expect(() => stepTerrainBody3D(view, {...body, ...patch} as never)).toThrow();
    expect(body).toEqual(before);
  });
  test('accessor fields, incompatible identities and forged views reject without user callbacks', () => {
    const view = session().queries(), body = createTerrainBody3D(view, {minQ: [Q, Q, Q], sizeQ: [Q, Q, Q]}), get = vi.fn(() => [1, 0, 0]);
    expect(() => stepTerrainBody3D(view, body, Object.defineProperty({}, 'impulseQ', {enumerable: true, get}))).toThrow(); expect(get).not.toHaveBeenCalled();
    for (const patch of [{rulesVersion: 'wrong'}, {geometryRulesVersion: 'wrong'}, {worldId: 'other'}, {domain: 'other'}, {materialCatalogHash: 'wrong'}, {physicsRulesVersion: 'wrong'}]) expect(() => readTerrainBody3D(view, {...body, ...patch} as never)).toThrow();
    expect(() => stepTerrainBody3D({...view}, body)).toThrow(/isolated/);
    expect(() => createTerrainBody3D(view, {minQ: [-1, Q, Q], sizeQ: [Q, Q, Q]})).toThrow(/outside/);
  });
});

describe('exact material and temperature exposure', () => {
  test('partial voxel overlap produces an exact volume-weighted temperature ratio', () => {
    const w = world(); w.setCell(0, 1, 1, MAT.WATER, 50); w.setCell(1, 1, 1, MAT.WATER, 100);
    const a = w.sample(0, 1, 1).temperatureQ, b = w.sample(1, 1, 1).temperatureQ, r = session(w).queries().exposure({box: {minQ: [Q / 2, Q, Q], maxQ: [2 * Q, 2 * Q, 2 * Q]}});
    const half = BigInt(Q ** 3 / 2), full = BigInt(Q ** 3);
    expect(r.volumeQ3).toBe((half + full).toString()); expect(r.outsideVolumeQ3).toBe('0');
    expect(r.materials).toEqual([{material: MAT.WATER, cells: 2, volumeQ3: (half + full).toString(), minTemperatureQ: Math.min(a, b), maxTemperatureQ: Math.max(a, b),
      meanTemperatureQ: {numerator: (BigInt(a) * half + BigInt(b) * full).toString(), denominator: (half + full).toString()}, maxImmersionDepthQ: Q}]);
  });
  test('material volumes include air, are sorted, and sum to the in-bounds volume', () => {
    const w = world(); w.setCell(1, 0, 0, MAT.WATER); w.setCell(2, 0, 0, MAT.STONE); const view = session(w).queries();
    const r = view.exposure({box: {minQ: [0, 0, 0], maxQ: [3 * Q, Q, Q]}});
    expect(r.materials.map(m => m.material)).toEqual([MAT.AIR, MAT.WATER, MAT.STONE].sort((a, b) => a - b));
    expect(r.materials.reduce((n, m) => n + BigInt(m.volumeQ3), 0n)).toBe(BigInt(r.inBoundsVolumeQ3));
  });
  test('only liquid runs touching the feet count as immersion, with per-column maximum depth', () => {
    const w = world(); w.setCell(0, 0, 0, MAT.WATER); w.setCell(0, 2, 0, MAT.WATER); w.setCell(1, 1, 0, MAT.WATER); w.setCell(1, 2, 0, MAT.WATER);
    const view = session(w).queries(), r = view.exposure({box: {minQ: [0, 0, 0], maxQ: [2 * Q, 3 * Q, Q]}});
    expect(r.materials.find(m => m.material === MAT.WATER)?.maxImmersionDepthQ).toBe(2 * Q);
    const overhead = view.exposure({box: {minQ: [0, 0, 0], maxQ: [Q, 2 * Q, Q]}});
    expect(overhead.materials.find(m => m.material === MAT.WATER)?.maxImmersionDepthQ).toBe(0);
  });
  test('fractional feet and top planes bound the reported immersion depth exactly', () => {
    const w = world(); w.setCell(1, 1, 1, MAT.WATER); w.setCell(1, 2, 1, MAT.WATER);
    const r = session(w).queries().exposure({box: {minQ: [Q, Q + 13, Q], maxQ: [2 * Q, 2 * Q + 7, 2 * Q]}});
    expect(r.materials[0].maxImmersionDepthQ).toBe(Q - 6);
  });
  test('outside space has an explicit volume and is never silently treated as air', () => {
    const view = session().queries(), r = view.exposure({box: {minQ: [-Q, 0, 0], maxQ: [Q, Q, Q]}});
    expect(r.volumeQ3).toBe(String(2 * Q ** 3)); expect(r.inBoundsVolumeQ3).toBe(String(Q ** 3)); expect(r.outsideVolumeQ3).toBe(String(Q ** 3));
    expect(r.materials[0].volumeQ3).toBe(String(Q ** 3));
  });
  test('large entirely outside boxes retain exact volume beyond safe Number products', () => {
    const r = session().queries().exposure({box: {minQ: [-524288, -524288, -524288], maxQ: [-1, -1, -1]}});
    expect(r.volumeQ3).toBe((524287n ** 3n).toString()); expect(r.outsideVolumeQ3).toBe(r.volumeQ3); expect(r.inBoundsVolumeQ3).toBe('0'); expect(r.materials).toEqual([]);
  });
  test('exposure returns isolated values and retained geometry ignores later edits', () => {
    const w = world(); w.setCell(1, 1, 1, MAT.WATER); const s = session(w), old = s.queries(), box = {minQ: [Q, Q, Q] as const, maxQ: [2 * Q, 2 * Q, 2 * Q] as const};
    const r = old.exposure({box}), expected = structuredClone(r); r.materials[0].meanTemperatureQ.numerator = '0';
    const b = s.branch({horizonTicks: 0}); b.edit([{kind: 'material', x: 1, y: 1, z: 1, material: MAT.ICE}]); s.commit(b);
    expect(old.exposure({box})).toEqual(expected); expect(s.queries().exposure({box}).materials[0].material).toBe(MAT.ICE);
  });
  test('prospective volume budget rejects an oversized scan before producing partial exposure', () => {
    const w = new CpuStructuralWorld3D({width: 64, height: 32, depth: 64, chunkSize: 8}), view = session(w).queries();
    expect(() => view.exposure({box: {minQ: [0, 0, 0], maxQ: [64 * Q, 32 * Q, 64 * Q]}})).toThrow(/cell budget/);
    expect(view.exposure({box: {minQ: [0, 0, 0], maxQ: [Q, Q, Q]}}).volumeQ3).toBe(String(Q ** 3));
  });
});

function inertFactory(): TacticalSimulationFactory3D {
  return input => {let state = structuredClone(input); return {load(value) {state = structuredClone(value);}, step() {state.tick++;}, snapshot: () => state, close() {}};};
}
describe('actor/terrain/application transactions with inert material ticks', () => {
  test('terrain edits, resolved body and AP publish together after a zero-horizon action', () => {
    const w = floor(), seed = session(w), actor = createTerrainBody3D(seed.queries(), {minQ: [Q, Q, Q], sizeQ: [Q, 2 * Q, Q]});
    const s = createTacticalSession3D({worldId: 'body-world', gameRulesVersion: 'body-game-1', terrain: w.snapshot(), game: {actor, ap: 2}}), before = s.snapshot(), b = s.branch({horizonTicks: 0});
    b.edit([{kind: 'material', x: 1, y: 3, z: 1, material: MAT.AIR}]); const r = stepTerrainBody3D(b.queries(), b.inspect().game.actor);
    b.setGame({actor: r.body, ap: 1}); expect(s.snapshot()).toEqual(before); const committed = s.commit(b);
    expect(committed.snapshot.game.actor.minQ[1]).toBe(Q + 64); expect(committed.snapshot.game.ap).toBe(1); expect(committed.snapshot.terrain.packedCells[29] & 255).toBe(MAT.AIR);
  });
  test('a rejected application commit preserves terrain, body state and AP', () => {
    const w = floor(), actor = createTerrainBody3D(session(w).queries(), {minQ: [Q, Q, Q], sizeQ: [Q, 2 * Q, Q]});
    const s = createTacticalSession3D({worldId: 'body-world', gameRulesVersion: 'body-game-1', terrain: w.snapshot(), game: {actor, ap: 2}}, {validateGame: ({game}) => game.ap >= 0});
    const before = s.snapshot(), b = s.branch({horizonTicks: 0}); b.edit([{kind: 'material', x: 1, y: 3, z: 1, material: MAT.AIR}]);
    b.setGame({actor: stepTerrainBody3D(b.queries(), actor).body, ap: -1}); expect(() => s.commit(b)).toThrow(/policy/); expect(s.snapshot()).toEqual(before);
  });
  test('reduceTick supplies the exact edited boundary for atomic per-tick body resolution', async () => {
    const w = floor(), actor = createTerrainBody3D(session(w).queries(), {minQ: [Q, Q, Q], sizeQ: [Q, 2 * Q, Q]}), stamps: number[] = [];
    const s = createTacticalSessionCore3D({worldId: 'body-world', gameRulesVersion: 'body-game-1', terrain: w.snapshot(), game: {actor, ap: 2}}, inertFactory(), {
      reduceTick: ({game, queries, tick}) => {const view = queries(); expect(view).toBe(queries()); expect(view.stamp.tick).toBe(tick); stamps.push(tick); return {...game, actor: stepTerrainBody3D(view, game.actor).body};},
    }, async () => {});
    const before = s.snapshot(), b = s.branch({horizonTicks: 2}); b.edit([{kind: 'material', x: 1, y: 3, z: 1, material: MAT.AIR}]); await b.advance(2);
    expect(s.snapshot()).toEqual(before); const result = s.commit(b); expect(stamps).toEqual([1, 2]); expect(result.snapshot.game.actor.minQ[1]).toBe(Q + 192); expect(result.snapshot.game.actor.step).toBe(2);
  });
  test('retained tick query closures own original state and frozen identity after later operations', async () => {
    const retained: (() => GameplayGeometry3D)[] = [], w = world(); w.setCell(1, 1, 1, MAT.WATER);
    const s = createTacticalSessionCore3D({worldId: 'body-world', gameRulesVersion: 'body-game-1', terrain: w.snapshot(), game: {ap: 2}}, inertFactory(), {
      reduceTick: ({game, queries, terrain}) => {retained.push(queries); terrain.packedCells.fill(0); return game;},
    }, async () => {});
    const b = s.branch({horizonTicks: 2}); await b.advance(1); b.edit([{kind: 'material', x: 1, y: 1, z: 1, material: MAT.ICE}]); await b.advance(1); s.commit(b);
    const request = {box: {minQ: [Q, Q, Q] as const, maxQ: [2 * Q, 2 * Q, 2 * Q] as const}};
    expect(retained[0]().stamp).toMatchObject({kind: 'preview', operation: 1, completedTicks: 1, tick: 1});
    expect(retained[1]().stamp).toMatchObject({kind: 'preview', operation: 3, completedTicks: 2, tick: 2});
    expect(retained[0]().exposure(request).materials[0].material).toBe(MAT.WATER); expect(retained[1]().exposure(request).materials[0].material).toBe(MAT.ICE);
  });
  test('body state cannot cross into a reservoir domain without an explicit game operation', async () => {
    const w = world(), actor = createTerrainBody3D(session(w).queries(), {minQ: [Q, Q, Q], sizeQ: [Q, Q, Q]});
    const s = createTacticalSessionCore3D({worldId: 'body-world', gameRulesVersion: 'body-game-1', terrain: w.snapshot(), reservoirs: [{id: 'flask', terrain: w.snapshot()}], game: {actor}}, inertFactory(), {
      reduceTick: ({game, queries}) => {expect(queries({domain: 'flask'}).stamp).toMatchObject({domain: 'flask', tick: 1}); return {actor: stepTerrainBody3D(queries({domain: 'flask'}), game.actor).body};},
    }, async () => {});
    const before = s.snapshot(), b = s.branch({horizonTicks: 1}); await expect(b.advance(1)).rejects.toThrow(/Incompatible/); expect(s.snapshot()).toEqual(before);
  });
});
