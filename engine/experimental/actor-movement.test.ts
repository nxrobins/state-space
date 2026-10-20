import { holdPhysics, STRUCTURAL_CALLS } from '../test-support/hold-physics.js';
/** Pure actor/geometry checks. No material tick or structural solve is authorized. */
import { describe, expect, test, vi } from 'vitest';
import { moveTerrainActors3D, ACTOR_MOVEMENT_RULES_3D, type ActorMovementCommand3D } from './actor-movement.js';
import { createTerrainBody3D, stepTerrainBody3D, type TerrainBodyState3D } from './terrain-body.js';
import type { NamedTerrainBody3D } from './terrain-body-group.js';
import { createTacticalSession3D } from './tactical-session.js';
import { CpuStructuralWorld3D } from './structural-world-core.js';

import { MAT } from './3d.js';
import { GEOMETRY_SCALE_3D as Q, type GameplayGeometry3D } from './gameplay-geometry.js';
holdPhysics('solveStructure3D', ...STRUCTURAL_CALLS);
type V = [number, number, number];
const world = () => new CpuStructuralWorld3D({width: 8, height: 8, depth: 8, chunkSize: 4});
const session = (w = world()) => createTacticalSession3D({worldId: 'air-room', gameRulesVersion: 'air-game-1', terrain: w.snapshot(), game: null});
function actor(view: GameplayGeometry3D, id: string, minQ: V = [Q, Q, Q], velocityQ: V = [0, 0, 0], sizeQ: V = [Q, Q, Q], gravityQ = 0): NamedTerrainBody3D {
  return {id, body: createTerrainBody3D(view, {minQ, sizeQ, velocityQ, gravityQ})};
}
const vector = (axis: number, value: number) => {const v: V = [0, 0, 0]; v[axis] = value; return v;};
const axes = [0, 1, 2];
function floor() {const w = world(); for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) w.setCell(x, 7, z, MAT.STONE); return w;}
const box = (b: TerrainBodyState3D) => ({minQ: b.minQ, maxQ: b.minQ.map((v, a) => v + b.sizeQ[a]) as V});
function gameSession(reject = false) {
  const w = floor(), view = session(w).queries(), units = [actor(view, 'air', [Q, 6 * Q, Q]), actor(view, 'ally', [5 * Q, 6 * Q, Q])];
  return createTacticalSession3D({worldId: 'air-room', gameRulesVersion: 'air-game-1', terrain: w.snapshot(), game: {ap: 2, rng: 123, units}},
    {validateGame: c => !reject || c.game.ap === 2});
}
describe('bounded serial actor movement', () => {
  test('empty groups return a versioned resolved result without starting a body clock', () => {
    const view = session().queries(); expect(moveTerrainActors3D(view, [])).toEqual({rulesVersion: ACTOR_MOVEMENT_RULES_3D, stamp: view.stamp, status: 'resolved', bodyStep: null, bodies: [], responses: [], failure: null});
  });
  test('all axes and signs preserve exact unobstructed velocity and singleton behavior', () => {
    const view = session().queries();
    for (const axis of axes) for (const sign of [-1, 1]) {
      const unit = actor(view, 'air', [3 * Q, 3 * Q, 3 * Q], vector(axis, sign * Q)), old = stepTerrainBody3D(view, unit.body), result = moveTerrainActors3D(view, [unit]);
      expect(result.bodies[0].body).toEqual(old.body); expect(result.responses[0].movedQ).toEqual(vector(axis, sign * Q)); expect(result.bodyStep).toBe(1); expect(result.responses[0].contacts).toEqual([]);
    }
  });
  test('high-speed travel cannot tunnel through a one-unit-thick peer on any axis or sign', () => {
    const view = session().queries();
    for (const axis of axes) for (const sign of [-1, 1]) {
      const min: V = [3 * Q, 3 * Q, 3 * Q], peer = [...min] as V, size: V = [Q, Q, Q]; size[axis] = 1; peer[axis] += sign > 0 ? Q + 13 : -14;
      const units = [actor(view, 'air', min, vector(axis, sign * 32 * Q)), actor(view, 'peer', peer, [0, 0, 0], size)], result = moveTerrainActors3D(view, units), r = result.responses[0];
      expect(r.movedQ).toEqual(vector(axis, sign * 13)); expect(r.body.velocityQ).toEqual([0, 0, 0]); expect(r.contacts[0].obstacle).toEqual({kind: 'actor', id: 'peer', time: {numerator: 13, denominator: 32768}, normal: vector(axis, -sign)});
    }
  });
  test('closed world boundaries clip long movement on all axes and signs', () => {
    const view = session().queries();
    for (const axis of axes) for (const sign of [-1, 1]) {
      const unit = actor(view, 'air', [3 * Q, 3 * Q, 3 * Q], vector(axis, sign * 32 * Q)), result = moveTerrainActors3D(view, [unit]);
      expect(result.bodies[0].body).toEqual(stepTerrainBody3D(view, unit.body).body); expect(result.responses[0].contacts[0].obstacle).toMatchObject({kind: 'terrain', contact: {boundary: true, normal: vector(axis, -sign)}});
    }
  });
  test('face-touching actors may separate and zero travel is canonical positive zero', () => {
    const view = session().queries(), units = [actor(view, 'air', [2 * Q, Q, Q]), actor(view, 'peer', [Q, Q, Q])];
    expect(moveTerrainActors3D(view, units, [{id: 'air', impulseQ: [Q, 0, 0]}]).responses[0].movedQ).toEqual([Q, 0, 0]);
    const blocked = moveTerrainActors3D(view, units, [{id: 'air', impulseQ: [-Q, 0, 0]}]); expect(blocked.responses[0].movedQ).toEqual([0, 0, 0]); expect(Object.is(blocked.responses[0].contacts[0].travelledQ, -0)).toBe(false);
  });
  test('blocked normal motion preserves tangential sliding in frozen X Z Y order', () => {
    const view = session().queries(), units = [actor(view, 'air', [Q, Q, Q], [Q, 0, Q]), actor(view, 'peer', [2 * Q, Q, Q])];
    const r = moveTerrainActors3D(view, units).responses[0]; expect(r.movedQ).toEqual([0, 0, Q]); expect(r.body.velocityQ).toEqual([0, 0, Q]); expect(r.segments.map(s => s.axis)).toEqual([0, 2]);
  });
  test('edge and corner touching do not create false collisions', () => {
    const view = session().queries();
    for (const offset of [[0, Q, 0], [0, 0, Q], [0, Q, Q]]) {
      const result = moveTerrainActors3D(view, [actor(view, 'air', [Q, Q, Q], [3 * Q, 0, 0]), actor(view, 'peer', [3 * Q, Q + offset[1], Q + offset[2]])]);
      expect(result.responses[0].movedQ).toEqual([3 * Q, 0, 0]); expect(result.responses[0].contacts).toEqual([]);
    }
  });
  test('terrain wins an exact-distance tie against a nonoverlapping peer', () => {
    const w = world(); w.setCell(3, 1, 1, MAT.STONE); const view = session(w).queries();
    const units = [actor(view, 'air', [Q, Q, Q], [4 * Q, 0, 0], [Q, 2 * Q, Q]), actor(view, 'peer', [3 * Q, 2 * Q, Q])];
    const r = moveTerrainActors3D(view, units).responses[0]; expect(r.movedQ).toEqual([Q, 0, 0]); expect(r.contacts[0].obstacle).toMatchObject({kind: 'terrain', contact: {cell: {coordinate: [3, 1, 1]}}});
  });
  test('peer ties use canonical IDs independent of caller order', () => {
    const view = session().queries(), units = [actor(view, 'air', [Q, Q, Q], [4 * Q, 0, 0], [Q, 2 * Q, Q]), actor(view, 'z', [3 * Q, Q, Q]), actor(view, 'b', [3 * Q, 2 * Q, Q])];
    const a = moveTerrainActors3D(view, units), b = moveTerrainActors3D(view, [...units].reverse()); expect(a).toEqual(b); expect(a.responses[0].contacts[0].obstacle).toMatchObject({kind: 'actor', id: 'b'});
  });
  test('head-on commands stop at peers without swapping or overlapping', () => {
    const view = session().queries(), units = [actor(view, 'air', [Q, Q, Q], [4 * Q, 0, 0]), actor(view, 'peer', [4 * Q, Q, Q], [-4 * Q, 0, 0])];
    const r = moveTerrainActors3D(view, units); expect(r.bodies.map(b => b.body.minQ[0])).toEqual([3 * Q, 4 * Q]); expect(r.responses.map(b => b.body.velocityQ)).toEqual([[0, 0, 0], [0, 0, 0]]);
  });
  test('crossing paths are explicit serial substeps rather than simultaneous trajectories', () => {
    const view = session().queries(), units = [actor(view, 'a', [Q, Q, 2 * Q], [4 * Q, 0, 0]), actor(view, 'b', [3 * Q, Q, 4 * Q], [0, 0, -3 * Q])];
    const r = moveTerrainActors3D(view, units); expect(r.responses.map(v => v.movedQ)).toEqual([[4 * Q, 0, 0], [0, 0, -3 * Q]]); expect(r.responses.map(v => v.id)).toEqual(['a', 'b']);
    expect(r.responses[0].segments[0]).toMatchObject({fromMinQ: [Q, Q, 2 * Q], toMinQ: [5 * Q, Q, 2 * Q]});
  });
  test('a trailing actor waits for a later-priority convoy member even when both request motion', () => {
    const view = session().queries(), units = [actor(view, 'a', [Q, Q, Q], [Q, 0, 0]), actor(view, 'b', [2 * Q, Q, Q], [Q, 0, 0])];
    const r = moveTerrainActors3D(view, units); expect(r.responses.map(v => v.movedQ)).toEqual([[0, 0, 0], [Q, 0, 0]]); expect(moveTerrainActors3D(view, [...units].reverse())).toEqual(r);
  });
  test('commands and input permutation cannot alter full results', () => {
    const view = session().queries(), units = [actor(view, 'z', [Q, Q, Q]), actor(view, 'a', [Q, Q, 3 * Q])], commands = [{id: 'z', impulseQ: [31, 7, 11]}, {id: 'a', accelerationQ: [-19, 3, 5]}];
    expect(moveTerrainActors3D(view, units, commands)).toEqual(moveTerrainActors3D(view, [...units].reverse(), [...commands].reverse()));
  });
  test('saved velocity impulse acceleration and gravity sum exactly once', () => {
    const view = session().queries(), unit = actor(view, 'air', [Q, Q, Q], [2, 3, 4], [Q, Q, Q], 10), command = {id: 'air', impulseQ: [1, 2, 3], accelerationQ: [4, 5, 6]};
    const r = moveTerrainActors3D(view, [unit], [command]); expect(r.responses[0].movedQ).toEqual([7, 20, 13]); expect(r.bodies[0].body).toEqual(stepTerrainBody3D(view, unit.body, {impulseQ: command.impulseQ, accelerationQ: command.accelerationQ}).body);
  });
  test('a falling body lands on terrain with exact support area and singleton agreement', () => {
    const view = session(floor()).queries(), unit = actor(view, 'air', [Q, Q, Q], [0, 32 * Q, 0]);
    const r = moveTerrainActors3D(view, [unit]).responses[0]; expect(r.body).toEqual(stepTerrainBody3D(view, unit.body).body); expect(r.landed).toBe(true); expect(r.footingAfter.terrain.surfaces[0].areaQ2).toBe(Q * Q);
  });
  test('vertical peer landing has exact contact area without introducing actor loads', () => {
    const view = session().queries(), units = [actor(view, 'air', [Q, Q, Q], [0, 4 * Q, 0], [Q / 2, Q, Q / 2]), actor(view, 'peer', [Q, 4 * Q, Q])];
    const r = moveTerrainActors3D(view, units).responses[0]; expect(r.movedQ).toEqual([0, 2 * Q, 0]); expect(r.landed).toBe(true); expect(r.body.grounded).toBe(true); expect(r.footingAfter.actors).toEqual([{id: 'peer', areaQ2: Q * Q / 4}]);
  });
  test('final footing notices a later peer moving away and does not carry its rider implicitly', () => {
    const view = session().queries(), rider = actor(view, 'a', [Q, Q, Q]), support = actor(view, 'z', [Q, 2 * Q, Q], [2 * Q, 0, 0]); rider.body.grounded = true;
    const r = moveTerrainActors3D(view, [rider, support]).responses[0]; expect(r.footingBefore.grounded).toBe(true); expect(r.footingAfter.grounded).toBe(false); expect(r.lostFooting).toBe(true); expect(r.movedQ).toEqual([0, 0, 0]);
  });
  test('an overhead peer cancels upward velocity without becoming footing', () => {
    const view = session().queries(), units = [actor(view, 'air', [Q, 3 * Q, Q], [0, -4 * Q, 0]), actor(view, 'peer', [Q, Q, Q])];
    const r = moveTerrainActors3D(view, units).responses[0]; expect(r.movedQ).toEqual([0, -Q, 0]); expect(r.body.grounded).toBe(false); expect(r.footingAfter.actors).toEqual([]);
  });
  test('the final body reports water depth and temperature without changing the water', () => {
    const w = world(); w.setCell(3, 2, 1, MAT.WATER, 80); const s = session(w), view = s.queries(), before = s.snapshot();
    const r = moveTerrainActors3D(view, [actor(view, 'air', [Q, 2 * Q, Q], [2 * Q, 0, 0])]).responses[0];
    expect(r.exposure.materials).toEqual(view.exposure({box: box(r.body)}).materials); expect(r.exposure.materials[0]).toMatchObject({material: MAT.WATER, maxImmersionDepthQ: Q}); expect(s.snapshot()).toEqual(before);
  });
  test('a newly edited wall stops the impulse before its requested endpoint', () => {
    const s = session(), unit = actor(s.queries(), 'air', [Q + 17, Q + 19, Q + 23], [10 * Q, 0, 0], [Q - 31, Q - 37, Q - 41]);
    const b = s.branch({horizonTicks: 0}); b.edit([{kind: 'material', x: 2, y: 1, z: 1, material: MAT.STONE}]); const r = moveTerrainActors3D(b.queries(), [unit]).responses[0];
    expect(r.movedQ).toEqual([14, 0, 0]); expect(r.body.minQ[0] + r.body.sizeQ[0]).toBe(2 * Q); expect(s.snapshot().terrain.packedCells[74] & 255).toBe(MAT.AIR);
  });
  test('removing terrain support causes footing loss on the new revision', () => {
    const s = session(floor()), unit = actor(s.queries(), 'air', [Q, 6 * Q, Q], [0, 0, 0], [Q, Q, Q], 64), b = s.branch({horizonTicks: 0});
    b.edit([{kind: 'material', x: 1, y: 7, z: 1, material: MAT.AIR}]); const r = moveTerrainActors3D(b.queries(), [unit]).responses[0]; expect(r.lostFooting).toBe(true); expect(r.movedQ).toEqual([0, 64, 0]); expect(r.body.grounded).toBe(false);
  });
  test('endpoint contact is reported and cancels the contacted component', () => {
    const view = session().queries(), units = [actor(view, 'air', [Q, Q, Q], [Q, 0, 0]), actor(view, 'peer', [3 * Q, Q, Q])];
    const r = moveTerrainActors3D(view, units).responses[0]; expect(r.movedQ).toEqual([Q, 0, 0]); expect(r.body.velocityQ).toEqual([0, 0, 0]); expect(r.contacts[0].obstacle).toMatchObject({kind: 'actor', time: {numerator: 1, denominator: 1}});
  });
  test('initial peer overlap returns the original whole group with no accepted prefix', () => {
    const view = session().queries(), units = [actor(view, 'a', [Q, Q, Q], [Q, 0, 0]), actor(view, 'z', [Q + 1, Q, Q])], before = structuredClone(units);
    const r = moveTerrainActors3D(view, units); expect(r.status).toBe('unresolved'); expect(r.failure).toEqual({id: 'a', kind: 'actor-overlap', actor: 'z'}); expect(r.bodies).toEqual(before); expect(r.bodyStep).toBe(0); expect(r.responses).toEqual([]); expect(units).toEqual(before);
  });
  test('a late outside or embedded actor leaves every original body and clock intact', () => {
    const w = world(); w.setCell(4, 1, 1, MAT.STONE); const view = session(w).queries(), a = actor(view, 'a', [Q, Q, Q], [Q, 0, 0]), z = actor(view, 'z', [6 * Q, Q, Q]);
    for (const [x, kind] of [[-1, 'outside'], [4 * Q, 'embedded']] as const) {
      const bad = structuredClone(z); bad.body.minQ[0] = x; const input = [a, bad], r = moveTerrainActors3D(view, input); expect(r.status).toBe('unresolved'); expect(r.failure).toMatchObject({id: 'z', kind}); expect(r.responses).toEqual([]); expect(r.bodies).toEqual(input);
    }
  });
  test('all malformed commands reject without invoking accessors or altering input', () => {
    const view = session().queries(), units = [actor(view, 'a')], before = structuredClone(units), get = vi.fn(), accessor = Object.defineProperty({id: 'a'}, 'impulseQ', {get, enumerable: true});
    const malformed = [null, {}, [{id: 'missing'}], [{id: 'a'}, {id: 'a'}], [{id: 'a', impulseQ: [1, 2]}], [{id: 'a', impulseQ: [NaN, 0, 0]}], [{id: 'a', impulseQ: [32769, 0, 0]}], [{id: 'a', extra: 1}], [accessor], new Array(1)];
    for (const command of malformed) expect(() => moveTerrainActors3D(view, units, command as ActorMovementCommand3D[])).toThrow(); expect(get).not.toHaveBeenCalled(); expect(units).toEqual(before);
  });
  test('body identities clocks saved bindings and group limits reject invalid sets', () => {
    const view = session().queries(), unit = actor(view, 'a'), late = actor(view, 'z', [3 * Q, Q, Q]); late.body.step = 1;
    const foreign = structuredClone(unit); foreign.body.worldId = 'other';
    const maxClock = structuredClone(unit); maxClock.body.step = Number.MAX_SAFE_INTEGER;
    const bad = [[unit, unit], [{...unit, id: ''}], [unit, late], [foreign], [maxClock], Array.from({length: 65}, (_, i) => ({id: 'n' + i, body: unit.body})), new Array(1)];
    for (const rows of bad) expect(() => moveTerrainActors3D(view, rows)).toThrow(); expect(() => moveTerrainActors3D({} as GameplayGeometry3D, [])).toThrow();
  });
  test('a late invalid summed speed rejects before even an earlier outside pose is queried', () => {
    const view = session().queries(), outside = actor(view, 'a'), fast = actor(view, 'z', [3 * Q, Q, Q], [32768, 0, 0]); outside.body.minQ[0] = -1;
    expect(() => moveTerrainActors3D(view, [outside, fast], [{id: 'z', impulseQ: [1, 0, 0]}])).toThrow(/integer/);
  });
  test('caller arrays results and response bodies have independent mutable storage', () => {
    const view = session().queries(), input = [actor(view, 'a')], command = [{id: 'a', impulseQ: [64, 0, 0]}], before = structuredClone(input), r = moveTerrainActors3D(view, input, command), saved = structuredClone(r.bodies);
    r.responses[0].body.minQ.fill(0); r.responses[0].segments[0].fromMinQ.fill(0); r.bodies[0].body.velocityQ.fill(0); command[0].impulseQ.fill(0);
    expect(input).toEqual(before); expect(r.bodies[0].body.minQ).toEqual(saved[0].body.minQ); expect(moveTerrainActors3D(view, input, [{id: 'a', impulseQ: [64, 0, 0]}]).bodies).toEqual(saved);
  });
  test('repeated execution and serialized body continuation are exactly identical', () => {
    const view = session(floor()).queries(), initial = [actor(view, 'a', [Q, 6 * Q, Q], [0, 0, 0], [Q, Q, Q], 64), actor(view, 'b', [5 * Q, 6 * Q, 3 * Q])];
    const run = (save: boolean) => {let bodies = structuredClone(initial); const results = []; for (let i = 0; i < 12; i++) {const r = moveTerrainActors3D(view, bodies, i === 0 ? [{id: 'a', impulseQ: [71, -256, 13]}] : []); results.push(r); bodies = save ? JSON.parse(JSON.stringify(r.bodies)) : r.bodies;} return results;};
    expect(run(false)).toEqual(run(false)); expect(run(true)).toEqual(run(false));
  });
  test('air impulse preview publishes actors AP and RNG atomically with unchanged terrain', () => {
    const s = gameSession(), before = s.snapshot(), b = s.branch({horizonTicks: 0}), game = b.inspect().game;
    const result = moveTerrainActors3D(b.queries(), game.units, [{id: 'air', impulseQ: [2 * Q, -Q, 0]}]); expect(result.status).toBe('resolved'); b.setGame({...game, units: result.bodies, ap: game.ap - 1});
    expect(s.snapshot()).toEqual(before); const committed = s.commit(b).snapshot; expect(committed.terrain).toEqual(before.terrain); expect(committed.game.ap).toBe(1); expect(committed.game.rng).toBe(123); expect(committed.game.units[0].body.minQ).toEqual([3 * Q, 5 * Q, Q]);
  });
  test('late application rejection preserves all actor terrain AP and RNG state', () => {
    const s = gameSession(true), before = s.snapshot(), b = s.branch({horizonTicks: 0}), game = b.inspect().game, moved = moveTerrainActors3D(b.queries(), game.units, [{id: 'air', impulseQ: [Q, 0, 0]}]);
    b.setGame({...game, units: moved.bodies, ap: 1}); expect(() => s.commit(b)).toThrow(/policy/); expect(s.snapshot()).toEqual(before);
  });
  test('terrain publication invalidates an older air preview and recomputation observes the wall', () => {
    const s = gameSession(), b = s.branch({horizonTicks: 0}), game = b.inspect().game, moved = moveTerrainActors3D(b.queries(), game.units, [{id: 'air', impulseQ: [2 * Q, 0, 0]}]); b.setGame({...game, units: moved.bodies, ap: 1});
    const wall = s.branch({horizonTicks: 0}); wall.edit([{kind: 'material', x: 2, y: 6, z: 1, material: MAT.STONE}]); const latest = s.commit(wall).snapshot;
    expect(() => s.commit(b)).toThrow(/stale/); expect(s.snapshot()).toEqual(latest); const next = moveTerrainActors3D(s.queries(), latest.game.units, [{id: 'air', impulseQ: [2 * Q, 0, 0]}]); expect(next.responses[0].movedQ).toEqual([0, 0, 0]);
  });
  test('complete tactical save restore preserves subsequent movement and accounting', () => {
    const a = gameSession(), b = a.branch({horizonTicks: 0}), game = b.inspect().game, moved = moveTerrainActors3D(b.queries(), game.units, [{id: 'air', impulseQ: [81, -64, 9]}]); b.setGame({...game, units: moved.bodies, ap: 1}); a.commit(b);
    const save = a.snapshot(), other = gameSession(); other.restore(JSON.parse(JSON.stringify(save)));
    const x = moveTerrainActors3D(a.queries(), save.game.units), y = moveTerrainActors3D(other.queries(), other.snapshot().game.units); expect(y).toEqual(x); expect(other.snapshot()).toEqual(save);
  });
});
