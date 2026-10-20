import { holdPhysics } from '../test-support/hold-physics.js';
import { describe, expect, test, vi } from 'vitest';
import { MAT } from './3d.js';
import { volumeSchedule } from './3d-core.js';

import { createTacticalSessionCore3D } from './tactical-session-core.js';
import { createTerrainDisplacement3D, TERRAIN_DISPLACEMENT_RULES_3D, type TerrainDisplacement3D } from './terrain-displacement.js';
import { createTerrainBody3D } from './terrain-body.js';
import { GEOMETRY_SCALE_3D as Q, type GameplayGeometry3D } from './gameplay-geometry.js';
import type { TickMovement3D } from './path-journal.js';
import { seed, index, factory, type Spec } from './terrain-motion.fixtures.js';
import { thermalView } from '../thermal.js';
import { buildColdTable } from '../generated/materials.js';

holdPhysics('solveStructure3D', 'step', 'stepWithMotion', 'stepWithMotionPaths');
type V = [number, number, number];
const xpass = (parity: number) => volumeSchedule(0).findIndex(p => p.kind === 'liquid' && p.axis === 0 && p.parity === parity) + 1;
async function fixture(terrain = seed(), spec: Spec = {}, capturePaths = true) {
  let context!: TerrainDisplacement3D, before!: GameplayGeometry3D, after!: GameplayGeometry3D, movement!: TickMovement3D;
  const s = createTacticalSessionCore3D({worldId: 'displacement-world', gameRulesVersion: 'fixture-1', terrain, game: {ap: 2}}, factory(spec), {
    reduceTick: ({game, beforeQueries, queries, movement: read}) => {before = beforeQueries(); after = queries(); movement = read(); context = createTerrainDisplacement3D(before, after, movement); return game;},
  }, async () => {});
  const branch = s.branch({horizonTicks: 1, capturePaths}); await branch.advance(1); s.commit(branch);
  return {context, before, after, movement, s, body: (minQ: V, sizeQ: V = [Q / 2, Q / 2, Q / 2]) => createTerrainBody3D(before, {minQ, sizeQ})};
}
const pusher = () => seed([[1, 1, 1, MAT.SAND]]), push: Spec = {swaps: new Map([[xpass(1), [[index(1, 1, 1), index(2, 1, 1)]]]])};
const actor = (f: Awaited<ReturnType<typeof fixture>>) => f.body([Q * 2.25, Q * 1.25, Q * 1.25]);

describe('causal exact terrain displacement', () => {
  test('empty observations preserve saved state without events or displacement work', async () => {
    const f = await fixture(), body = actor(f), r = f.context.resolve(body); expect(r.status).toBe('resolved'); expect(r.body).toEqual(body); expect(r.events).toBe(0); expect(r.work).toBe(0);
  });
  test('linear terrain pushes fractional bodies by the exact remaining travel on every axis/sign', async () => {
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
      const a: V = [1, 1, 1], b: V = [1, 1, 1]; a[axis] = sign > 0 ? 1 : 2; b[axis] = sign > 0 ? 2 : 1;
      const p = volumeSchedule(0).findIndex(p => p.kind === (axis === 1 ? 'gravity' : 'liquid') && p.axis === axis && p.parity === 1) + 1;
      const f = await fixture(seed([[...a, MAT.SAND]]), {swaps: new Map([[p, [[index(...a), index(...b)]]]])});
      const input = f.body(b.map(v => v * Q + Q / 4) as V), r = f.context.resolve(input);
      expect(r.status).toBe('resolved'); expect(r.movedQ[axis]).toBe(sign * 3 * Q / 4);
      expect(r.contacts[0]).toMatchObject({time: {numerator: 1, denominator: 4}, origin: index(...a)}); expect(r.contacts[0].normal[axis]).toBe(sign);
      expect(r.body.velocityQ).toEqual(input.velocityQ); expect(r.body.step).toBe(input.step); expect(r.body.gravityQ).toBe(input.gravityQ);
    }
  });
  test('fractional contact times retain their exact reduced ratio and integer final coordinates', async () => {
    const f = await fixture(pusher(), push), input = f.body([2 * Q + 13, Q + 11, Q + 7], [17, 31, 47]), r = f.context.resolve(input);
    expect(r.status).toBe('resolved'); expect(r.contacts[0].time).toEqual({numerator: 13, denominator: Q}); expect(r.body.minQ).toEqual([3 * Q, Q + 11, Q + 7]);
  });
  test('diagonal corner contact chooses X and leaves the tangential coordinate unchanged', async () => {
    const p = volumeSchedule(0).findIndex(p => p.kind === 'diagonal' && p.axis === 0 && p.parity === 1 && p.direction === 1) + 1;
    const f = await fixture(seed([[1, 1, 1, MAT.SAND]]), {swaps: new Map([[p, [[index(1, 1, 1), index(2, 2, 1)]]]])});
    const input = f.body([Q * 2.25, Q * 2.25, Q * 1.25]), r = f.context.resolve(input);
    expect(r.status).toBe('resolved'); expect(r.body.minQ).toEqual([3 * Q, Q * 2.25, Q * 1.25]); expect(r.contacts[0].normal).toEqual([1, 0, 0]);
  });
  test('simultaneous perpendicular pushes combine normal velocities without choosing actor order', async () => {
    const p = volumeSchedule(0).findIndex(p => p.kind === 'diagonal' && p.axis === 0 && p.parity === 0 && p.direction === 1) + 1;
    const f = await fixture(seed([[1, 0, 1, MAT.SAND], [2, 1, 1, MAT.SAND]]), {swaps: new Map([[p, [[index(1, 0, 1), index(2, 1, 1)]]]])});
    const r = f.context.resolve(f.body([1.25 * Q, 1.25 * Q, 1.25 * Q]));
    expect(r.status).toBe('resolved'); expect(r.body.minQ).toEqual([Q / 2, 2 * Q, 1.25 * Q]); expect(r.events).toBe(1); expect(r.contacts).toHaveLength(2);
  });
  test('a transient out-and-back path can displace an actor despite zero final net terrain motion', async () => {
    const a = index(1, 1, 1), b = index(1, 2, 1), f = await fixture(seed([[1, 1, 1, MAT.SAND]]), {swaps: new Map([[2, [[a, b]]], [16, [[a, b]]]])});
    const r = f.context.resolve(f.body([Q * 1.25, Q * 2.25, Q * 1.25]));
    expect(f.movement.motion!.movedCells).toBe(0); expect(r.status).toBe('resolved'); expect(r.body.minQ[1]).toBe(3 * Q); expect(r.contacts[0].pass).toBe(2);
  });
  test('an endpoint touch reports contact without displacing the actor', async () => {
    const f = await fixture(pusher(), push), input = f.body([3 * Q, Q * 1.25, Q * 1.25]), r = f.context.resolve(input);
    expect(r.status).toBe('resolved'); expect(r.body.minQ).toEqual(input.minQ); expect(r.contacts[0].time).toEqual({numerator: 1, denominator: 1});
  });
  test('a grounded body follows its falling fragment with no contact impulse or actor step', async () => {
    const f = await fixture(seed([[1, 2, 1, MAT.STONE]]), {falls: [[index(1, 2, 1)]]}), input = f.body([Q, Q, Q], [Q, Q, Q]), r = f.context.resolve(input);
    expect(r.status).toBe('resolved'); expect(r.movedQ).toEqual([0, Q, 0]); expect(r.body.grounded).toBe(true); expect(r.body.step).toBe(input.step); expect(r.supportFragments).toEqual([index(1, 2, 1)]);
  });
  test('a stationary support prevents automatic carry and loose powder can leave an actor unsupported', async () => {
    const f = await fixture(seed([[1, 2, 1, MAT.STONE], [2, 2, 1, MAT.STONE]]), {falls: [[index(1, 2, 1)]]});
    expect(f.context.resolve(f.body([Q, Q, Q], [2 * Q, Q, Q])).movedQ).toEqual([0, 0, 0]);
    const a = index(1, 2, 1), loose = await fixture(seed([[1, 2, 1, MAT.SAND]]), {swaps: new Map([[1, [[a, a + 4]]]])});
    expect(loose.context.resolve(loose.body([Q, Q, Q], [Q, Q, Q]))).toMatchObject({status: 'resolved', lostFooting: true, movedQ: [0, 0, 0]});
  });
  test('a moving obstacle vacates space rather than acting as a wall at its old position', async () => {
    const a = index(0, 1, 1), b = index(2, 1, 1), f = await fixture(seed([[0, 1, 1, MAT.SAND], [2, 1, 1, MAT.STONE]]), {swaps: new Map([[xpass(0), [[a, a + 1], [b, b + 1]]]])});
    const r = f.context.resolve(f.body([Q * 1.25, Q * 1.25, Q * 1.25])); expect(r.status).toBe('resolved'); expect(r.body.minQ[0]).toBe(2 * Q); expect(r.contacts).toHaveLength(1);
  });
});

describe('constraints, occupancy and failed responses', () => {
  test('a pusher reaches an actor first, then crushes it against a wall at the causal time', async () => {
    const f = await fixture(seed([[1, 1, 1, MAT.SAND], [3, 1, 1, MAT.STONE]]), push), input = actor(f), saved = structuredClone(input), r = f.context.resolve(input);
    expect(r.status).toBe('crushed'); expect(r.events).toBe(2); expect(r.crush).toEqual({axis: 0, lowerVelocityQ: Q, upperVelocityQ: 0});
    expect(r.contacts.some(c => c.origin === index(3, 1, 1) && c.time.numerator === 1 && c.time.denominator === 2)).toBe(true);
    expect(r.body).toEqual(saved); expect(input).toEqual(saved); expect(r.movedQ).toEqual([0, 0, 0]);
  });
  test('an already touching stationary wall participates in opposing constraints', async () => {
    const f = await fixture(seed([[1, 1, 1, MAT.SAND], [3, 1, 1, MAT.STONE]]), push), r = f.context.resolve(f.body([2.5 * Q, 1.25 * Q, 1.25 * Q]));
    expect(r.status).toBe('crushed'); expect(r.events).toBe(1); expect(r.contacts.map(c => c.origin)).toEqual([index(1, 1, 1), index(3, 1, 1)]);
  });
  test('two approaching cells produce an exact opposing-velocity crush witness', async () => {
    const a = index(0, 1, 1), b = index(3, 1, 1), f = await fixture(seed([[0, 1, 1, MAT.SAND], [3, 1, 1, MAT.SAND]]), {swaps: new Map([[xpass(0), [[a, a + 1], [b, b - 1]]]])});
    const r = f.context.resolve(f.body([1.5 * Q, 1.25 * Q, 1.25 * Q], [Q, Q / 2, Q / 2]));
    expect(r.status).toBe('crushed'); expect(r.crush).toEqual({axis: 0, lowerVelocityQ: Q, upperVelocityQ: -Q}); expect(r.contacts.every(c => c.time.numerator === 1 && c.time.denominator === 2)).toBe(true);
  });
  test('a later opposing impact retains an odd numerator over doubled relative speed', async () => {
    const a = index(0, 1, 1), b = index(3, 1, 1), f = await fixture(seed([[0, 1, 1, MAT.SAND], [3, 1, 1, MAT.SAND]]), {swaps: new Map([[xpass(0), [[a, a + 1], [b, b - 1]]]])});
    const input = f.body([Q + 13, Q + 11, Q + 7], [17, 31, 47]), r = f.context.resolve(input);
    expect(r.status).toBe('crushed'); expect(r.events).toBe(2); expect(r.body).toEqual(input);
    expect(r.contacts[0].time).toEqual({numerator: 13, denominator: Q});
    expect(r.contacts.find(c => c.origin === b)?.time).toEqual({numerator: 2031, denominator: 2048});
  });
  test('closed boundaries constrain pushes on every axis and sign', async () => {
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
      const a: V = [1, 1, 1], b: V = [1, 1, 1]; a[axis] = sign > 0 ? 2 : 1; b[axis] = sign > 0 ? 3 : 0;
      const p = volumeSchedule(0).findIndex(p => p.kind === (axis === 1 ? 'gravity' : 'liquid') && p.axis === axis && p.parity === 0) + 1;
      const f = await fixture(seed([[...a, MAT.SAND]]), {swaps: new Map([[p, [[index(...a), index(...b)]]]])}), r = f.context.resolve(f.body(b.map(v => v * Q + Q / 4) as V));
      expect(r.status).toBe('crushed'); expect(r.contacts.some(c => c.boundary === axis * 2 + Number(sign > 0))).toBe(true);
    }
  });
  test('an obstacle moved by an earlier pass constrains a later push at its new position', async () => {
    const wall = index(3, 0, 1), f = await fixture(seed([[1, 1, 1, MAT.SAND], [3, 0, 1, MAT.STONE]]), {swaps: new Map([[1, [[wall, wall + 4]]], [xpass(1), [[index(1, 1, 1), index(2, 1, 1)]]]])});
    const r = f.context.resolve(actor(f)); expect(r.status).toBe('crushed'); expect(r.contacts.some(c => c.origin === wall && c.from === wall + 4)).toBe(true);
  });
  test('the vacated position of an earlier mover is not a phantom stationary obstacle', async () => {
    const wall = index(3, 0, 1), f = await fixture(seed([[1, 0, 1, MAT.SAND], [3, 0, 1, MAT.STONE]]), {swaps: new Map([[1, [[wall, wall + 4]]], [xpass(1), [[index(1, 0, 1), index(2, 0, 1)]]]])});
    const r = f.context.resolve(f.body([2.25 * Q, Q / 4, 1.25 * Q])); expect(r.status).toBe('resolved'); expect(r.body.minQ[0]).toBe(3 * Q);
  });
  test('original identity follows a moving cell through multiple passes', async () => {
    const a = index(1, 0, 1), f = await fixture(seed([[1, 0, 1, MAT.SAND]]), {swaps: new Map([[1, [[a, a + 4]]], [xpass(1), [[a + 4, a + 5]]]])});
    const r = f.context.resolve(actor(f)); expect(r.status).toBe('resolved'); expect(r.contacts[0]).toMatchObject({origin: a, from: a + 4, to: a + 5});
  });
  test('relocated occupants are checked at their destination without inventing a push path', async () => {
    const f = await fixture(seed([[1, 3, 1, MAT.STONE]]), {falls: [[index(1, 0, 1), index(1, 1, 1), index(1, 2, 1)]]});
    const middle = f.context.resolve(f.body([Q, Q, Q], [Q, Q, Q])); expect(middle.status).toBe('resolved'); expect(middle.contacts).toEqual([]);
    const input = f.body([Q, 0, Q], [Q, Q, Q]), r = f.context.resolve(input); expect(r).toMatchObject({status: 'embedded', reason: 'relocation-overlap', movedQ: [0, 0, 0]}); expect(r.body).toEqual(input);
  });
  test('newly frozen overlap remains explicit rather than inventing a depenetration direction', async () => {
    const before = seed([[1, 1, 1, MAT.WATER]]), after = seed([[1, 1, 1, MAT.ICE]]); after.energyQ = before.energyQ.slice();
    after.packedCells[index(1, 1, 1)] = thermalView(after.packedCells[index(1, 1, 1)], after.energyQ[index(1, 1, 1)], buildColdTable());
    const f = await fixture(before, {after}), input = f.body([Q, Q, Q]), r = f.context.resolve(input); expect(r).toMatchObject({status: 'embedded', reason: 'phase-overlap'}); expect(r.body).toEqual(input);
  });
  test('fluid and gas transfers affect exposure without imparting solid collision motion', async () => {
    for (const material of [MAT.WATER, MAT.STEAM]) {
      const f = await fixture(seed([[1, 1, 1, material]]), push), input = actor(f), r = f.context.resolve(input);
      expect(r.status).toBe('resolved'); expect(r.body).toEqual(input); expect(r.contacts).toEqual([]); expect(r.exposure.materials[0].material).toBe(material);
    }
  });
});

describe('bounded isolated displacement and application transactions', () => {
  test('disabled and overflow captures cannot masquerade as an unobstructed body response', async () => {
    const disabled = await fixture(seed(), {}, false); expect(disabled.context.resolve(actor(disabled))).toMatchObject({status: 'incomplete', reason: 'missing-paths', contacts: [], requiresReexecution: true});
    const overflow = await fixture(pusher(), {...push, overflow: true}); expect(overflow.context.resolve(actor(overflow))).toMatchObject({status: 'incomplete', movedQ: [0, 0, 0]});
  });
  test('work budget is inclusive at the exact completed cost and overflow discards partial response', async () => {
    const f = await fixture(pusher(), push), input = actor(f), first = f.context.resolve(input); expect(first.status).toBe('resolved'); expect(first.work).toBeGreaterThan(0);
    expect(f.context.resolve(input, {maxWork: first.work})).toEqual(first);
    expect(f.context.resolve(input, {maxWork: first.work - 1})).toMatchObject({status: 'incomplete', reason: 'budget', body: input, contacts: [], movedQ: [0, 0, 0]});
  });
  test('event budget stops before a second collision and never commits the first push', async () => {
    const f = await fixture(seed([[1, 1, 1, MAT.SAND], [3, 1, 1, MAT.STONE]]), push), input = actor(f);
    expect(f.context.resolve(input, {maxEvents: 1})).toMatchObject({status: 'incomplete', events: 1, body: input, contacts: [], crush: null});
    expect(f.context.resolve(input, {maxEvents: 2}).status).toBe('crushed');
  });
  test('contact budget includes the stationary crush witness and clears partial detail', async () => {
    const f = await fixture(seed([[1, 1, 1, MAT.SAND], [3, 1, 1, MAT.STONE]]), push), input = actor(f);
    expect(f.context.resolve(input, {maxContacts: 1})).toMatchObject({status: 'incomplete', contacts: [], crush: null, body: input});
    expect(f.context.resolve(input).contacts.length).toBeGreaterThan(1);
  });
  test('zero budgets allow an empty history and reject the first corresponding unit of work', async () => {
    const empty = await fixture(); expect(empty.context.resolve(actor(empty), {maxWork: 0, maxEvents: 0, maxContacts: 0}).status).toBe('resolved');
    const f = await fixture(pusher(), push), input = actor(f);
    for (const options of [{maxWork: 0}, {maxEvents: 0}, {maxContacts: 0}]) expect(f.context.resolve(input, options).status).toBe('incomplete');
  });
  test('invalid options fail before getters can execute', async () => {
    const f = await fixture(), input = actor(f), getter = vi.fn(() => 1);
    for (const value of [{maxWork: -1}, {maxWork: 1048577}, {maxEvents: 513}, {maxContacts: 4097}, {maxWork: NaN}, {maxEvents: 0.5}]) expect(() => f.context.resolve(input, value)).toThrow(/budget/);
    expect(() => f.context.resolve(input, Object.defineProperty({}, 'maxWork', {enumerable: true, get: getter}))).toThrow(/options/); expect(getter).not.toHaveBeenCalled();
  });
  test('geometry must match owned observations, not just identical public stamps', async () => {
    const a = await fixture(), b = await fixture(); expect(a.before.stamp).toEqual(b.before.stamp);
    expect(() => createTerrainDisplacement3D(a.before, b.after, a.movement)).toThrow(/boundaries/); expect(() => createTerrainDisplacement3D(a.before, a.after, structuredClone(a.movement))).toThrow(/live tick/);
    expect(() => createTerrainDisplacement3D({...a.before}, a.after, a.movement)).toThrow(/isolated/);
  });
  test('public observation mutations and actor iteration order cannot change responses', async () => {
    const f = await fixture(pusher(), push), input = actor(f), first = f.context.resolve(input);
    f.movement.paths!.passes.length = 0; f.movement.status = 'disabled'; f.context.resolve(f.body([0, 0, 0]));
    expect(createTerrainDisplacement3D(f.before, f.after, f.movement).resolve(input)).toEqual(first); expect(f.context.resolve(input)).toEqual(first);
    first.body.minQ[0] = 0; first.contacts[0].normal[0] = 99; first.exposure.materials.length = 0; expect(f.context.resolve(input).body.minQ[0]).toBe(3 * Q);
  });
  test('retained contexts keep their original state after commit, edits and restore', async () => {
    const f = await fixture(pusher(), push), input = actor(f), first = f.context.resolve(input), saved = f.s.snapshot();
    const b = f.s.branch({horizonTicks: 0}); b.edit([{kind: 'material', x: 2, y: 1, z: 1, material: MAT.AIR}]); f.s.commit(b); f.s.restore(saved);
    expect(f.context.resolve(input)).toEqual(first); expect(Object.isFrozen(f.context)).toBe(true); expect(f.context.rulesVersion).toBe(TERRAIN_DISPLACEMENT_RULES_3D);
  });
  test('querying displacement cannot change terrain, energy accounting or the supplied actor', async () => {
    const f = await fixture(pusher(), push), input = actor(f), saved = structuredClone(input), world = f.s.snapshot(); f.context.resolve(input);
    expect(input).toEqual(saved); expect(f.s.snapshot()).toEqual(world);
  });
  test('initial overlap and outside placement stay unresolved without changing saved body', async () => {
    const f = await fixture(pusher(), push), input = actor(f);
    expect(f.context.resolve({...input, minQ: [Q, Q, Q]})).toMatchObject({status: 'embedded', reason: 'initial-overlap'});
    expect(f.context.resolve({...input, minQ: [-1, Q, Q]})).toMatchObject({status: 'outside', reason: 'initial-outside'});
  });
  test('resolved pushes publish actor, terrain and AP atomically', async () => {
    const base = await fixture(pusher(), push), body = actor(base), s = createTacticalSessionCore3D({worldId: 'displacement-world', gameRulesVersion: 'push-game-1', terrain: pusher(), game: {body, ap: 2}}, factory(push), {
      requiresPaths: true, reduceTick: ({game, beforeQueries, queries, movement}) => {
        const r = createTerrainDisplacement3D(beforeQueries(), queries(), movement()).resolve(game.body); if (r.status !== 'resolved') throw Error('unresolved'); return {body: r.body, ap: 1};
      },
    }, async () => {});
    const saved = s.snapshot(), b = s.branch({horizonTicks: 1}); await b.advance(1); expect(s.snapshot()).toEqual(saved);
    const result = s.commit(b).snapshot; expect(result.game.body.minQ[0]).toBe(3 * Q); expect(result.game.ap).toBe(1); expect(result.terrain.tick).toBe(1);
  });
  test('game rejection of crush preserves actor, terrain, AP and revision', async () => {
    const terrain = seed([[1, 1, 1, MAT.SAND], [3, 1, 1, MAT.STONE]]), base = await fixture(terrain, push), body = actor(base);
    const s = createTacticalSessionCore3D({worldId: 'displacement-world', gameRulesVersion: 'push-game-1', terrain, game: {body, ap: 2}}, factory(push), {
      requiresPaths: true, reduceTick: ({game, beforeQueries, queries, movement}) => {const r = createTerrainDisplacement3D(beforeQueries(), queries(), movement()).resolve(game.body); if (r.status !== 'resolved') throw Error('crush rejected'); return {body: r.body, ap: 1};},
    }, async () => {});
    const saved = s.snapshot(), revision = s.revision, b = s.branch({horizonTicks: 1}); await expect(b.advance(1)).rejects.toThrow(/crush rejected/);
    expect(s.snapshot()).toEqual(saved); expect(s.revision).toEqual(revision);
  });
  test('cleanup failure cannot publish an otherwise successful displacement', async () => {
    const base = await fixture(pusher(), push), body = actor(base), s = createTacticalSessionCore3D({worldId: 'displacement-world', gameRulesVersion: 'push-game-1', terrain: pusher(), game: {body}}, factory(push, true), {
      requiresPaths: true, reduceTick: ({game, beforeQueries, queries, movement}) => ({body: createTerrainDisplacement3D(beforeQueries(), queries(), movement()).resolve(game.body).body}),
    }, async () => {});
    const saved = s.snapshot(), b = s.branch({horizonTicks: 1}); await expect(b.advance(1)).rejects.toThrow(/cleanup failed/); expect(s.snapshot()).toEqual(saved);
  });
});
