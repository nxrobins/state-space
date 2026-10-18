/** Real tiny reactive paths and shared actor arithmetic; native/M5 stepping held. */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { CpuVolume } from './3d-core.js';
import { CpuStructuralWorld3D } from './structural-world-core.js';
import * as mechanics from './structural-mechanics.js';
import { createTerrainBody3D } from './terrain-body.js';
import { moveTerrainActors3D } from './actor-movement.js';
import { createTacticalSession3D } from './tactical-session.js';
import { createReactiveMaterialRegistry3D, defaultReactiveMaterialCatalog3D, createReactiveMaterialBlock3D as block,
  editReactiveMaterialBlock3D as edit, createReactiveWorldSnapshot3D as world, createReactiveDomainsSnapshot3D as domains,
  createReactiveSession3D as session, createReactiveBody3D as body, stepReactiveBody3D as stepBody,
  createReactiveActorGroup3D as tickGroup, createReactiveTranslatedActorGroup3D as translationGroup,
  createReactiveDisplacement3D as tickBody, createReactiveTranslationDisplacement3D as translatedBody, moveReactiveActors3D as moveActors,
  GEOMETRY_SCALE_3D as Q, MAT, type ReactiveMaterialRegistry3D, type ReactiveMaterialEdit3D, type ReactiveGameplayGeometry3D,
  type ReactiveSessionPolicy3D, type ReactiveBranch3D, type ReactiveTranslationRequest3D, type NamedReactiveBody3D,
  type ReactiveActorGroupResult3D } from './reactive-materials.js';
const guards = [vi.spyOn(CpuVolume.prototype, 'step'), vi.spyOn(mechanics, 'solveStructure3D'),
  ...(['step', 'stepWithMotion', 'stepWithMotionPaths', 'inspectStructure'] as const).map(k => vi.spyOn(CpuStructuralWorld3D.prototype, k))];
for (const g of guards) g.mockImplementation(() => {throw Error('Old material runtime held.');});
afterAll(() => {for (const g of guards) {expect(g).not.toHaveBeenCalled(); g.mockRestore();}});
let registry: ReactiveMaterialRegistry3D;
beforeAll(async () => {const c = defaultReactiveMaterialCatalog3D(); for (const m of c.propertiesCatalog.materials) m.properties.conductivity = 0; registry = await createReactiveMaterialRegistry3D(c);});
type V = [number, number, number];
type Game = {ap: number; units: NamedReactiveBody3D[]; commands: {id: string; impulseQ: number[]}[]};
type Command = Parameters<NonNullable<ReactiveSessionPolicy3D<Game>['reduceCommand']>>[0];
type Tick = Parameters<NonNullable<ReactiveSessionPolicy3D<Game>['reduceTick']>>[0];
const vector = (axis: number, amount: number): V => {const v: V = [0, 0, 0]; v[axis] = amount; return v;};
const vec = (x: number, y: number, z: number): V => [x * Q, y * Q, z * Q];
const shape = {width: 5, height: 5, depth: 5};
const place = (x = 1, y = 3, z = 2, material: number = MAT.STONE, thermal = 70): ReactiveMaterialEdit3D => ({kind: 'place', x, y, z, material, thermal});
const platform: ReactiveTranslationRequest3D = {cells: [[1, 3, 2]], path: [[1, 0, 0]]};
function initial(edits: ReactiveMaterialEdit3D[] = [], dimensions = shape) {
  expect(dimensions.width * dimensions.height * dimensions.depth).toBeLessThanOrEqual(125);
  return {worldId: 'group-room', gameRulesVersion: 'group-game-1', domains: domains(registry, world(registry, edit(registry, block(registry, dimensions), edits).block)), game: {ap: 2, units: [], commands: []} as Game};
}
function finish(b: ReactiveBranch3D<Game>) {let calls = 0; while (['preparing', 'running'].includes(b.progress().status)) {if (++calls > 10000) throw Error('Tiny fixture bound'); b.advance(7);} return b;}
function actor(view: ReactiveGameplayGeometry3D, id: string, minQ = vec(1.25, 2.5, 2.25), sizeQ = vec(0.5, 0.5, 0.5), velocityQ: V = [0, 0, 0], gravityQ = 0): NamedReactiveBody3D {
  return {id, body: body(view, {minQ, sizeQ, velocityQ, gravityQ})};
}
function translated(request = platform, extra: ReactiveMaterialEdit3D[] = [], enabled = true, maxEntries = 4096) {
  expect(request.path.length).toBeLessThanOrEqual(8); let c!: Command;
  const s = session(registry, initial([...request.cells.map(([x, y, z]) => place(x, y, z)), ...extra]), {reduceCommand(value) {c = value; return value.game;}});
  const b = s.branch({horizonTicks: 0, ...(enabled ? {translation: {maxEntries}} : {})}); b.enqueue({kind: 'translate', domain: null, request}); finish(b);
  const before = c.beforeQueries(), after = c.queries(), movement = c.translation()!;
  return {s, b, c, before, after, movement, group: translationGroup(before, after, movement), single: translatedBody(before, after, movement),
    actor: (id: string, minQ?: V, sizeQ?: V) => actor(before, id, minQ, sizeQ)};
}
function tick(edits: ReactiveMaterialEdit3D[] = [], dimensions = shape, enabled = true) {
  let c!: Tick; const s = session(registry, initial(edits, dimensions), {reduceTick(value) {c = value; return value.game;}}), b = s.branch({horizonTicks: 1, ...(enabled ? {motion: {}} : {})}); finish(b);
  const before = c.beforeQueries(), after = c.queries(), movement = c.movement();
  return {s, b, c, before, after, movement, group: tickGroup(before, after, movement), single: tickBody(before, after, movement), actor: (id: string, minQ: V, sizeQ?: V) => actor(before, id, minQ, sizeQ)};
}
function crossing(path: V[] = [[1, 0, 0], [1, 0, 0]]) {
  const f = translated({...platform, path}); return {...f, units: [f.actor('a'), f.actor('b', vec(3.25, 2.25, 2.25))]};
}
const accept = (out: ReactiveActorGroupResult3D) => {if (out.status !== 'resolved') throw Error('Unsafe group: ' + out.reason); return out.bodies;};
const policy: ReactiveSessionPolicy3D<Game> = {
  reduceCommand(c) {
    if (c.command.kind === 'translate') return {...c.game, units: accept(translationGroup(c.beforeQueries(c.command.domain), c.queries(c.command.domain), c.translation()!).resolve(c.game.units))};
    if (c.command.kind !== 'game' || !c.game.commands.length) return c.game;
    const moved = moveActors(c.queries(), c.game.units, c.game.commands); if (moved.status !== 'resolved') throw Error('Unsafe movement'); return {...c.game, units: moved.bodies, commands: []};
  },
  reduceTick(c) {const units = accept(tickGroup(c.beforeQueries(), c.queries(), c.movement()).resolve(c.game.units)), moved = moveActors(c.queries(), units); if (moved.status !== 'resolved') throw Error('Unsafe movement'); return {...c.game, units: moved.bodies};},
};

describe('reactive terrain and peer groups', () => {
  test('actual translation paths find an intermediate peer collision even when final poses separate', () => {
    const f = crossing([[1, 0, 0], [1, 0, 0], [1, 0, 0]]), out = f.group.resolve(f.units);
    expect(out).toMatchObject({rulesVersion: 'reactive-actor-group-1', scope: 'reactive-translation-domain', status: 'unresolved', reason: 'peer-contact', bodies: f.units, responses: [], peerContact: {first: 'a', second: 'b', pass: 1, time: {numerator: 1, denominator: 2}, normal: [-1, 0, 0]}});
    expect(f.single.resolve(f.units[0].body).body.minQ[0]).toBe(4.25 * Q);
  });
  test('returning terrain to its original state does not erase peer crossing', () => {
    const f = crossing([[1, 0, 0], [1, 0, 0], [-1, 0, 0], [-1, 0, 0]]); expect(f.b.inspect().state.domains).toEqual(f.s.snapshot().domains); expect(f.group.resolve(f.units).peerContact?.pass).toBe(1);
  });
  test('delayed pushes retain exact peer times on every axis and sign', () => {
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
      const cell: V = [2, 2, 2], delta = vector(axis, sign), peer = vec(2.25, 2.25, 2.25); cell[axis] -= sign; peer[axis] += sign * Q;
      const f = translated({cells: [cell], path: [delta]}), units = [f.actor('a', vec(2.25, 2.25, 2.25)), f.actor('b', peer)], out = f.group.resolve(units);
      expect(out.peerContact).toMatchObject({pass: 0, time: {numerator: 3, denominator: 4}, normal: vector(axis, -sign)}); expect(out.bodies).toEqual(units);
    }
  });
  test('actual structural falling paths report the causal peer time in pass 28', () => {
    const f = tick([place(2, 1, 2)]), units = [f.actor('a', vec(2.25, 2.25, 2.25)), f.actor('b', vec(2.25, 3.25, 2.25))], out = f.group.resolve(units);
    expect(out).toMatchObject({scope: 'reactive-tick-domain', reason: 'peer-contact', bodies: units, peerContact: {pass: 28, time: {numerator: 3, denominator: 4}, normal: [0, -1, 0]}});
  });
  test('a fixed wall clips actual carry before it can reach a peer', () => {
    const f = translated(platform, [place(2, 2, 2)]), units = [f.actor('a', vec(1.25, 1.5, 2.25), vec(0.5, 1.5, 0.5)), f.actor('b', vec(2.25, 1.25, 2.25))], out = f.group.resolve(units);
    expect(out.status).toBe('resolved'); expect(out.bodies[0].body.minQ[0]).toBe(1.5 * Q); expect(out.peerContact).toBeNull();
  });
  test('parallel carried actors retain their separation', () => {
    const f = translated({cells: [[1, 3, 2], [3, 3, 2]], path: [[1, 0, 0]]}), units = [f.actor('a'), f.actor('b', vec(3.25, 2.5, 2.25))], out = f.group.resolve(units);
    expect(out.status).toBe('resolved'); expect(out.bodies.map(a => a.body.minQ[0])).toEqual([2.25 * Q, 4.25 * Q]);
  });
  test('end-only touching and tangential grazing are not positive interior overlap', () => {
    const f = translated(); expect(f.group.resolve([f.actor('a'), f.actor('b', vec(2.75, 2.25, 2.25))]).status).toBe('resolved');
    const c = crossing(); expect(c.group.resolve([c.units[0], c.actor('b', vec(3.25, 2.25, 2.75))]).status).toBe('resolved');
  });
  test('initial peer overlap is explicit and returns the complete original group', () => {
    const f = translated(), units = [f.actor('a'), f.actor('b')], out = f.group.resolve(units);
    expect(out).toMatchObject({status: 'unresolved', bodies: units, responses: [], peerContact: {kind: 'initial-overlap', pass: null, time: {numerator: 0, denominator: 1}}});
  });
  test('earliest physical contact beats lexical pair order and simultaneous ties use IDs', () => {
    const f = crossing(), near = f.actor('z', vec(2.25, 2.25, 2.25)), out = f.group.resolve([...f.units, near]); expect(out.peerContact).toMatchObject({first: 'a', second: 'z', pass: 0});
    const units = [f.units[0], f.actor('z', vec(3.25, 2.25, 2)), f.actor('B', vec(3.25, 2.25, 2.5))], tie = f.group.resolve(units);
    expect(tie.peerContact).toMatchObject({first: 'B', second: 'a', normal: [1, 0, 0]}); expect(f.group.resolve([...units].reverse())).toEqual(tie);
  });
  test('a one-fixed-point-unit gap retains its exact fraction without epsilon', () => {
    const f = translated(), out = f.group.resolve([f.actor('a'), f.actor('b', [1.75 * Q + 1, 2.25 * Q, 2.25 * Q])]); expect(out.peerContact?.time).toEqual({numerator: 1, denominator: Q});
  });
  test('empty and singleton groups preserve individual terrain responses', () => {
    const f = translated(); expect(f.group.resolve([])).toMatchObject({status: 'resolved', evaluatedBodies: 0, work: 0, peerWork: 0, bodies: []});
    const a = f.actor('a'), out = f.group.resolve([a]); expect(out.responses[0].response).toEqual(f.single.resolve(a.body)); expect(out.peerWork).toBe(0);
  });
  test('the exact combined work budget succeeds and one fewer clears unproven peer details', () => {
    const f = crossing(), full = f.group.resolve(f.units); expect(f.group.resolve(f.units, {maxWork: full.work})).toEqual(full);
    expect(f.group.resolve(f.units, {maxWork: full.work - 1})).toMatchObject({status: 'incomplete', reason: 'peer-budget', bodies: f.units, responses: [], peerContact: null, requiresReexecution: true});
    const terrainWork = f.units.reduce((n, a) => n + f.single.resolve(a.body).work, 0); expect(f.group.resolve(f.units, {maxWork: terrainWork})).toMatchObject({reason: 'peer-budget', peerWork: 0, work: terrainWork});
  });
  test('late aggregate carry exhaustion is incomplete for both translation and real ticks', () => {
    const translated = translationGroupFixture();
    const falling = tick([place(1, 2, 1), place(3, 2, 3)]), units = [falling.actor('a', vec(1.25, 1.5, 1.25)), falling.actor('b', vec(3.25, 1.5, 3.25))];
    for (const f of [translated, {group: falling.group, units}]) {
      expect(f.group.resolve(f.units, {maxCarryEntries: 4}).status).toBe('resolved');
      expect(f.group.resolve(f.units, {maxCarryEntries: 3})).toMatchObject({status: 'incomplete', reason: 'terrain-response', bodies: f.units, responses: [], evaluatedBodies: 2, failure: {id: 'b', response: {reason: 'budget', carries: []}}});
    }
  });
  test('tick carry limits reject malformed input and preserve legacy defaults', () => {
    const f = tick([place(1, 3, 2)]), a = f.actor('a', vec(1.25, 2.5, 2.25));
    expect(f.single.resolve(a.body, {maxCarryEntries: 2})).toEqual(f.single.resolve(a.body));
    expect(f.single.resolve(a.body, {maxCarryEntries: 1})).toMatchObject({status: 'incomplete', body: a.body, carries: [], contacts: []});
    for (const n of [-1, 65537, NaN, 1.5]) expect(() => f.single.resolve(a.body, {maxCarryEntries: n})).toThrow();
  });
  test('terrain crush and phase overlap take precedence over any peer result', () => {
    const f = translated({...platform, path: [[0, -1, 0]]}, [place(1, 1, 2)]), out = f.group.resolve([f.actor('a')]);
    expect(out).toMatchObject({reason: 'terrain-response', status: 'unresolved', peerWork: 0, peerContact: null, failure: {response: {status: 'crushed'}}});
    const frozen = tick([place(0, 1, 0, MAT.WATER, 0)], {width: 1, height: 2, depth: 1});
    expect(frozen.group.resolve([frozen.actor('a', vec(0.25, 1.25, 0.25))])).toMatchObject({reason: 'terrain-response', failure: {response: {reason: 'phase-overlap', throughPass: 26}}});
  });
  test('disabled and overflowed movement remain incomplete before peer assessment', () => {
    for (const f of [translated(undefined, undefined, false), translated(undefined, undefined, true, 0)]) expect(f.group.resolve([f.actor('a')])).toMatchObject({status: 'incomplete', reason: 'terrain-response', peerContact: null});
    const f = tick([], shape, false); expect(f.group.resolve([f.actor('a', vec(1, 1, 1))]).status).toBe('incomplete');
  });
  test('invalid IDs arrays options and late incompatible bodies reject before group resolution', () => {
    const f = crossing(), get = vi.fn();
    for (const rows of [null, new Array(2), [f.units[0], f.units[0]], [{...f.units[0], id: ''}], [f.units[0], {...f.units[1], body: {...f.units[1].body, worldId: 'wrong'}}], Array.from({length: 65}, (_, i) => ({...f.units[0], id: 'a' + i})), [Object.defineProperty({}, 'id', {get, enumerable: true})]]) expect(() => f.group.resolve(rows as never)).toThrow();
    for (const options of [null, {maxWork: -1}, {maxContacts: 0.5}, {extra: 1}, Object.defineProperty({}, 'maxWork', {get, enumerable: true})]) expect(() => f.group.resolve(f.units, options as never)).toThrow(); expect(get).not.toHaveBeenCalled();
  });
  test('the 64-body limit accepts distinct tiny actors while 65 rejects', () => {
    const f = tick([], {width: 1, height: 1, depth: 1}), units = Array.from({length: 64}, (_, i) => f.actor('a' + i.toString().padStart(2, '0'), [i % 4 * 256, Math.floor(i / 4) % 4 * 256, Math.floor(i / 16) * 256], [1, 1, 1]));
    expect(f.group.resolve(units).status).toBe('resolved'); expect(() => f.group.resolve([...units, {...units[0], id: 'extra'}])).toThrow();
  });
  test('provenance and public mutations cannot alter historical group results', () => {
    const f = crossing(), other = crossing(), expected = f.group.resolve(f.units), input = structuredClone(f.units);
    expect(() => translationGroup(f.before, other.after, f.movement)).toThrow(); expect(() => translationGroup(f.before, f.after, structuredClone(f.movement))).toThrow();
    const out = f.group.resolve(f.units); out.peerContact!.time.numerator = 99; out.bodies[0].body.minQ[0] = 0; f.movement.paths.passes.length = 0; f.b.discard();
    expect(f.group.resolve(f.units)).toEqual(expected); expect(f.units).toEqual(input); expect(translationGroup(f.c.beforeQueries(), f.c.queries(), f.c.translation()!).resolve(f.units)).toEqual(expected);
  });
});
function translationGroupFixture() {const f = translated({cells: [[1, 3, 1], [3, 3, 3]], path: [[0, -1, 0]]}); return {group: f.group, units: [f.actor('a', vec(1.25, 2.5, 1.25)), f.actor('b', vec(3.25, 2.5, 3.25))]};}

describe('reactive serial actor movement', () => {
  test('all axis signs and closed boundaries match the individual body solver', () => {
    const view = session(registry, initial()).queries();
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) for (const distance of [Q, 32 * Q]) {
      const a = actor(view, 'a', vec(2, 2, 2), vec(1, 1, 1), vector(axis, sign * distance)), out = moveActors(view, [a]);
      expect(out.rulesVersion).toBe('reactive-actor-movement-1'); expect(out.bodies[0].body).toEqual(stepBody(view, a.body).body); expect(out.bodyStep).toBe(1);
    }
  });
  test('high speed cannot tunnel through a one-unit-thick peer on any axis or sign', () => {
    const view = session(registry, initial()).queries();
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
      const min = vec(2, 2, 2), peer = [...min] as V, size = vec(1, 1, 1); size[axis] = 1; peer[axis] += sign > 0 ? Q + 13 : -14;
      const out = moveActors(view, [actor(view, 'a', min, vec(1, 1, 1), vector(axis, sign * 32 * Q)), actor(view, 'peer', peer, size)]).responses[0];
      expect(out.movedQ).toEqual(vector(axis, sign * 13)); expect(out.contacts[0].obstacle).toEqual({kind: 'actor', id: 'peer', time: {numerator: 13, denominator: 32768}, normal: vector(axis, -sign)});
    }
  });
  test('canonical ID order and X Z Y sweeps stop head-on crossing and preserve tangential slide', () => {
    const v = session(registry, initial()).queries(), units = [actor(v, 'a', vec(1, 1, 1), vec(1, 1, 1), vec(4, 0, 0)), actor(v, 'b', vec(4, 1, 1), vec(1, 1, 1), vec(-4, 0, 0))], out = moveActors(v, units);
    expect(out.bodies.map(a => a.body.minQ[0])).toEqual([3 * Q, 4 * Q]); expect(moveActors(v, [...units].reverse())).toEqual(out);
    const slide = moveActors(v, [actor(v, 'a', vec(1, 1, 1), vec(1, 1, 1), vec(1, 0, 1)), actor(v, 'b', vec(2, 1, 1), vec(1, 1, 1))]);
    expect(slide.responses[0].movedQ).toEqual([0, 0, Q]); expect(slide.responses[0].segments.map(s => s.axis)).toEqual([0, 2]);
  });
  test('terrain wins equal-distance ties and peer ties use canonical IDs', () => {
    const v = session(registry, initial([place(3, 1, 1)])).queries(), a = actor(v, 'a', vec(1, 1, 1), vec(1, 2, 1), vec(4, 0, 0));
    expect(moveActors(v, [a, actor(v, 'b', vec(3, 2, 1), vec(1, 1, 1))]).responses[0].contacts[0].obstacle.kind).toBe('terrain');
    const empty = session(registry, initial()).queries(), units = [a, actor(empty, 'z', vec(3, 1, 1), vec(1, 1, 1)), actor(empty, 'b', vec(3, 2, 1), vec(1, 1, 1))];
    expect(moveActors(empty, units).responses[0].contacts[0].obstacle).toMatchObject({kind: 'actor', id: 'b'});
  });
  test('touching faces may separate while endpoint contact stops the normal velocity', () => {
    const v = session(registry, initial()).queries(), units = [actor(v, 'a', vec(2, 1, 1), vec(1, 1, 1)), actor(v, 'b', vec(1, 1, 1), vec(1, 1, 1))];
    expect(moveActors(v, units, [{id: 'a', impulseQ: vec(1, 0, 0)}]).responses[0].movedQ).toEqual([Q, 0, 0]);
    const stopped = moveActors(v, units, [{id: 'a', impulseQ: vec(-1, 0, 0)}]).responses[0]; expect(stopped.movedQ).toEqual([0, 0, 0]); expect(Object.is(stopped.contacts[0].travelledQ, -0)).toBe(false);
    const end = moveActors(v, [actor(v, 'a', vec(0, 1, 1), vec(1, 1, 1)), actor(v, 'b', vec(2, 1, 1), vec(1, 1, 1))], [{id: 'a', impulseQ: [Q, 0, 0]}]);
    expect(end.responses[0].contacts[0].obstacle).toMatchObject({kind: 'actor', time: {numerator: 1, denominator: 1}}); expect(end.bodies[0].body.velocityQ).toEqual([0, 0, 0]);
  });
  test('saved velocity impulse acceleration and gravity are applied exactly once', () => {
    const v = session(registry, initial()).queries(), a = actor(v, 'a', vec(1, 1, 1), vec(1, 1, 1), [2, 3, 4], 10), commands = [{id: 'a', impulseQ: [1, 2, 3], accelerationQ: [4, 5, 6]}], out = moveActors(v, [a], commands);
    expect(out.responses[0].movedQ).toEqual([7, 20, 13]); expect(out.bodyStep).toBe(1); expect(out.bodies[0].body).toEqual(stepBody(v, a.body, {impulseQ: commands[0].impulseQ, accelerationQ: commands[0].accelerationQ}).body);
  });
  test('peer landing reports support area and a departing support removes footing', () => {
    const v = session(registry, initial()).queries(), units = [actor(v, 'a', vec(1, 1, 1), vec(0.5, 1, 0.5), vec(0, 4, 0)), actor(v, 'b', vec(1, 4, 1), vec(1, 1, 1))], out = moveActors(v, units).responses[0];
    expect(out.movedQ).toEqual([0, 2 * Q, 0]); expect(out.landed).toBe(true); expect(out.footingAfter.actors).toEqual([{id: 'b', areaQ2: Q * Q / 4}]);
    const rider = actor(v, 'a', vec(1, 1, 1), vec(1, 1, 1)); rider.body.grounded = true;
    const leaving = moveActors(v, [rider, actor(v, 'z', vec(1, 2, 1), vec(1, 1, 1), vec(2, 0, 0))]).responses[0]; expect(leaving.lostFooting).toBe(true); expect(leaving.movedQ).toEqual([0, 0, 0]);
  });
  test('new terrain blocks explicit movement and removing a floor causes falling', () => {
    const s = session(registry, initial([place(1, 2, 1)])), a = actor(s.queries(), 'a', vec(1, 1, 1), vec(1, 1, 1), [0, 0, 0], 64), b = s.branch({horizonTicks: 0});
    b.enqueue({kind: 'edit', domain: null, edits: [place(1, 2, 1, MAT.AIR), place(2, 1, 1)]}); finish(b);
    const out = moveActors(b.queries(), [a], [{id: 'a', impulseQ: vec(3, 0, 0)}]).responses[0]; expect(out.movedQ).toEqual([0, 64, 0]); expect(out.lostFooting).toBe(true); expect(out.contacts[0].obstacle.kind).toBe('terrain');
  });
  test('body exposure follows movement into hot water without changing the material world', () => {
    const s = session(registry, initial([place(3, 2, 1, MAT.WATER, 80)])), before = s.snapshot(), v = s.queries(), a = actor(v, 'a', vec(1, 2, 1), vec(1, 1, 1), vec(2, 0, 0)), out = moveActors(v, [a]);
    expect(out.responses[0].exposure.materials.find(m => m.material === MAT.WATER)).toMatchObject({minTemperatureQ: 80 * 256, maxImmersionDepthQ: Q}); expect(s.snapshot()).toEqual(before);
  });
  test('initial overlap outside and embedded late actors reject the entire group', () => {
    const v = session(registry, initial([place(4, 1, 1)])).queries(), a = actor(v, 'a', vec(1, 1, 1)), b = actor(v, 'b', vec(3, 1, 1));
    for (const [min, kind] of [[vec(1, 1, 1), 'actor-overlap'], [[-1, Q, Q], 'outside'], [vec(4, 1, 1), 'embedded']] as const) {
      const units = [a, {...b, body: {...b.body, minQ: [...min] as V}}], out = moveActors(v, units); expect(out.status).toBe('unresolved'); expect(out.failure?.kind).toBe(kind); expect(out.bodies).toEqual(units); expect(out.responses).toEqual([]); expect(out.bodyStep).toBe(0);
    }
  });
  test('malformed commands identities clocks and late summed velocities reject atomically', () => {
    const v = session(registry, initial()).queries(), a = actor(v, 'a', vec(1, 1, 1)), b = actor(v, 'b', vec(3, 1, 1)), get = vi.fn();
    for (const rows of [[a, a], new Array(1), [a, {...b, body: {...b.body, step: 1}}], [{...a, body: {...a.body, step: Number.MAX_SAFE_INTEGER}}], [{...a, body: {...a.body, domain: 'other'}}]]) expect(() => moveActors(v, rows)).toThrow();
    for (const commands of [null, new Array(1), [{id: 'absent'}], [{id: 'a'}, {id: 'a'}], [{id: 'a', impulseQ: [NaN, 0, 0]}], [{id: 'a', impulseQ: [1, 2]}], [Object.defineProperty({id: 'a'}, 'impulseQ', {get, enumerable: true})]]) expect(() => moveActors(v, [a], commands as never)).toThrow();
    const outside = {...a, body: {...a.body, minQ: [-1, Q, Q] as V}}, fast = {...b, body: {...b.body, velocityQ: [32768, 0, 0] as V}};
    expect(() => moveActors(v, [outside, fast], [{id: 'b', impulseQ: [1, 0, 0]}])).toThrow(/integer/); expect(get).not.toHaveBeenCalled(); expect(() => moveActors({...v}, [])).toThrow();
  });
  test('input command order and mutable outputs cannot affect subsequent resolution', () => {
    const v = session(registry, initial()).queries(), units = [actor(v, 'z', vec(1, 1, 1)), actor(v, 'a', vec(3, 1, 1))], commands = [{id: 'z', impulseQ: [71, 7, 13]}, {id: 'a', accelerationQ: [3, 5, 11]}], saved = structuredClone(units), expected = moveActors(v, units, commands);
    expect(moveActors(v, [...units].reverse(), [...commands].reverse())).toEqual(expected);
    const out = moveActors(v, units, commands); out.responses[0].body.minQ.fill(0); out.bodies[1].body.velocityQ.fill(0); expect(units).toEqual(saved); expect(moveActors(v, units, commands)).toEqual(expected);
  });
  test('M5 and reactive adapters preserve identical geometry and movement arithmetic', () => {
    const old = new CpuStructuralWorld3D({width: 4, height: 4, depth: 4, chunkSize: 4}); old.setCell(3, 1, 1, MAT.STONE, 70);
    const v = createTacticalSession3D({worldId: 'old', gameRulesVersion: 'g', terrain: old.snapshot(), game: {}}).queries(), modern = session(registry, initial([place(3, 1, 1)], {width: 4, height: 4, depth: 4})).queries();
    const input = {minQ: vec(1, 1, 1), sizeQ: vec(1, 1, 1), velocityQ: vec(4, 0, 1), gravityQ: 64}, a = moveTerrainActors3D(v, [{id: 'a', body: createTerrainBody3D(v, input)}]).responses[0], b = moveActors(modern, [{id: 'a', body: body(modern, input)}]).responses[0];
    expect(b.movedQ).toEqual(a.movedQ); expect(b.segments).toEqual(a.segments); expect(b.contacts).toEqual(a.contacts); expect(b.body.minQ).toEqual(a.body.minQ); expect(b.body.velocityQ).toEqual(a.body.velocityQ);
  });
  test('repeated and JSON-restored multi-actor movement stays bit-exact over eight steps', () => {
    const v = session(registry, initial()).queries(), start = [actor(v, 'a', vec(1, 1, 1), vec(0.5, 0.5, 0.5), [17, 3, 11], 7), actor(v, 'b', vec(3, 1, 3))];
    const run = (copy: boolean) => {let units = structuredClone(start); const results = []; for (let i = 0; i < 8; i++) {const out = moveActors(v, units); results.push(out); units = copy ? JSON.parse(JSON.stringify(out.bodies)) : out.bodies;} return results;};
    expect(run(false)).toEqual(run(false)); expect(run(true)).toEqual(run(false));
  });
});

describe('group policies and exact application transactions', () => {
  test('a peer-conflicting translation rolls back prior AP energy and explicit actor movement', () => {
    const f = crossing(), input = initial([place()]); input.game.units = f.units; const s = session(registry, input, policy), before = s.snapshot(), b = s.branch({horizonTicks: 0, translation: {}});
    b.enqueue({kind: 'game', game: {...before.game, ap: 1, commands: [{id: 'a', impulseQ: [0, 0, 1]}]}});
    b.enqueue({kind: 'edit', domain: null, edits: [{kind: 'energy', x: 1, y: 3, z: 2, energyQ: before.domains.world.block.energyQ[66] + 256}]});
    b.enqueue({kind: 'translate', domain: null, request: {...platform, path: [[1, 0, 0], [1, 0, 0]]}});
    expect(() => finish(b)).toThrow(/peer-contact/); expect(s.snapshot()).toEqual(before); expect(s.energyBalance().driftQ).toBe(0n); expect(b.progress().status).toBe('failed');
  });
  test('an actual falling-debris peer conflict rejects the whole paid tick', () => {
    const f = tick([place(2, 1, 2)]), input = initial([place(2, 1, 2)]); input.game.units = [f.actor('a', vec(2.25, 2.25, 2.25)), f.actor('b', vec(2.25, 3.25, 2.25))];
    const s = session(registry, input, policy), before = s.snapshot(), b = s.branch({horizonTicks: 1, motion: {}}); b.enqueue({kind: 'game', game: {...before.game, ap: 1}});
    expect(() => finish(b)).toThrow(/peer-contact/); expect(s.snapshot()).toEqual(before);
  });
  test('group state and accounting resume exactly through translation tick and movement', () => {
    const input = initial([place(1, 3, 1), place(3, 3, 3)]), bind = session(registry, input); input.game.units = [actor(bind.queries(), 'a', vec(1.25, 2.5, 1.25)), actor(bind.queries(), 'b', vec(3.25, 2.5, 3.25))];
    const s = session(registry, input, policy), b = s.branch({horizonTicks: 1, translation: {}, motion: {}});
    b.enqueue({kind: 'game', game: {...input.game, ap: 1}}); b.enqueue({kind: 'translate', domain: null, request: {cells: [[1, 3, 1], [3, 3, 3]], path: [[0, -1, 0]]}}); finish(b); s.commit(b);
    const resumed = session(registry, input, policy); resumed.restore(JSON.parse(JSON.stringify(s.snapshot())));
    for (const owner of [s, resumed]) {const next = owner.branch({horizonTicks: 1, translation: {}, motion: {}}); next.enqueue({kind: 'game', game: {...owner.snapshot().game, commands: [{id: 'a', impulseQ: [7, 0, 5]}]}}); finish(next); owner.commit(next);}
    expect(resumed.snapshot()).toEqual(s.snapshot()); expect(resumed.energyBalance()).toEqual(s.energyBalance()); expect(s.energyBalance().driftQ).toBe(0n);
  });
  test('observed group policy leaves exact material state equal to an unobserved command and tick', () => {
    const input = initial([place()]), bind = session(registry, input); input.game.units = [actor(bind.queries(), 'a')];
    const a = session(registry, input, policy), b = session(registry, input);
    for (const owner of [a, b]) {const branch = owner.branch({horizonTicks: 1, ...(owner === a ? {translation: {}, motion: {}} : {})}); branch.enqueue({kind: 'translate', domain: null, request: platform}); finish(branch); owner.commit(branch);}
    expect(a.snapshot().domains).toEqual(b.snapshot().domains); expect(a.energyBalance()).toEqual(b.energyBalance());
  });
});
