import { holdPhysics, STRUCTURAL_CALLS } from '../test-support/hold-physics.js';
/** Tiny physical contacts only. Old M5/native/GPU runtime stays trapped. */
import { beforeAll, describe, expect, test, vi } from 'vitest';

import { CpuStructuralWorld3D } from './structural-world-core.js';

import { createTerrainBody3D, stepTerrainBody3D } from './terrain-body.js';
import { createTacticalSession3D } from './tactical-session.js';
import { displacementTrace3D } from './displacement-kernel.js';
import { createReactiveMaterialRegistry3D, defaultReactiveMaterialCatalog3D, createReactiveMaterialBlock3D as block, editReactiveMaterialBlock3D as edit, createReactiveWorldSnapshot3D as world, createReactiveDomainsSnapshot3D as domains, createReactiveSession3D as session, createReactiveBody3D as body, readReactiveBody3D as read, stepReactiveBody3D as step, createReactiveDisplacement3D as displace, GEOMETRY_SCALE_3D as Q, MAT, type ReactiveMaterialRegistry3D, type ReactiveMaterialEdit3D, type ReactiveBranch3D, type ReactiveSessionPolicy3D, type ReactiveGameplayGeometry3D, type ReactiveTickMovement3D, type ReactiveDisplacement3D } from './reactive-materials.js';
holdPhysics('volumeStep', 'solveStructure3D', ...STRUCTURAL_CALLS);
let r: ReactiveMaterialRegistry3D, warm: ReactiveMaterialRegistry3D;
beforeAll(async () => {
  warm = await createReactiveMaterialRegistry3D(); const c = defaultReactiveMaterialCatalog3D(); for (const m of c.propertiesCatalog.materials) m.properties.conductivity = 0;
  const base = await createReactiveMaterialRegistry3D(c), wood = base.material(MAT.WOOD);
  r = await base.extend([{...wood, id: 200, name: 'smoke_resin', properties: {...wood.properties, burns_into: MAT.SMOKE}}]);
});
type V = [number, number, number];
const vec = (x: number, y: number, z: number): V => [x * Q, y * Q, z * Q];
const place = (x: number, y: number, z = 0, material: number = MAT.STONE, thermal = 70): ReactiveMaterialEdit3D => ({kind: 'place', x, y, z, material, thermal});
const anchor = (x: number, y: number): ReactiveMaterialEdit3D => ({kind: 'anchor', x, y, z: 0, anchored: true});
const column = {width: 1, height: 5, depth: 1}, capture = {motion: {maxEntries: 8192}};
function initial(edits: ReactiveMaterialEdit3D[] = [], shape = column, tick = 0, registry = r) {
  expect(shape.width * shape.height * shape.depth + 1).toBeLessThanOrEqual(125);
  return {worldId: 'actors', gameRulesVersion: 'actors-game-1', domains: domains(registry, world(registry, edit(registry, block(registry, shape), edits).block, tick),
    [{id: 'flask', world: world(registry, block(registry, {width: 1, height: 1, depth: 1}), tick)}]), game: {ap: 2}};
}
function finish<T extends {ap: number}>(b: ReactiveBranch3D<T>) {let calls = 0; while (['preparing', 'running'].includes(b.progress().status)) {if (++calls > 10000) throw Error('Tiny work bound'); b.advance(7);} return b;}
function fixture(edits: ReactiveMaterialEdit3D[] = [place(0, 2)], shape = column, registry = r, options = capture) {
  let before!: ReactiveGameplayGeometry3D, after!: ReactiveGameplayGeometry3D, movement!: ReactiveTickMovement3D, context!: ReactiveDisplacement3D;
  const s = session(registry, initial(edits, shape, 0, registry), {reduceTick(c) {before = c.beforeQueries(); after = c.queries(); movement = c.movement(); context = displace(before, after, movement); return c.game;}});
  const b = finish(s.branch({horizonTicks: 1, ...options}));
  return {s, b, before, after, movement, context, make: (min = vec(0, 1, 0), size = vec(1, 1, 1)) => body(before, {minQ: min, sizeQ: size, gravityQ: 0})};
}
const pusher = () => fixture([place(0, 1)]);
const crushFixture = () => fixture([place(0, 1), place(0, 3), anchor(0, 3)]);
const under = (f: ReturnType<typeof fixture>) => f.make(vec(0.25, 2.25, 0.25), vec(0.5, 0.5, 0.5));

describe('portable reactive bodies and shared kinematic arithmetic', () => {
  test('creation binds catalog and component rules while owning all input vectors', () => {
    const s = session(r, initial()), input = {minQ: vec(0, 1, 0), sizeQ: vec(1, 1, 1)}, a = body(s.queries(), input); input.minQ[1] = 0;
    expect(a).toMatchObject({rulesVersion: 'reactive-body-1', geometryRulesVersion: 'reactive-geometry-1', evolutionRulesVersion: 'reactive-evolution-1', structureRulesVersion: 'reactive-structure-1', worldId: 'actors', domain: null, materialCatalogHash: r.hash, minQ: vec(0, 1, 0), step: 0});
    const copy = read(s.queries(), a); copy.velocityQ[0] = 99; expect(a.velocityQ[0]).toBe(0);
  });
  test('all six axis directions collide exactly with the closed world boundary', () => {
    const q = session(r, initial([], {width: 3, height: 3, depth: 3})).queries();
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
      const a = body(q, {minQ: vec(1.25, 1.25, 1.25), sizeQ: vec(0.5, 0.5, 0.5), gravityQ: 0}), impulse: V = [0, 0, 0]; impulse[axis] = sign * 3 * Q;
      const out = step(q, a, {impulseQ: impulse}); expect(out.status).toBe('resolved'); expect(out.movedQ[axis]).toBe(sign * 1.25 * Q); expect(out.body.velocityQ[axis]).toBe(0); expect(out.body.step).toBe(1);
    }
  });
  test('X Z Y ordering and fractional travel exactly match the existing M5 adapter', () => {
    const old = new CpuStructuralWorld3D({width: 4, height: 4, depth: 4, chunkSize: 4}); old.setCell(2, 1, 1, MAT.STONE, 70);
    const saved = old.snapshot(), q = createTacticalSession3D({worldId: 'old', gameRulesVersion: 'g', terrain: saved, game: {}}).queries();
    const modern = session(r, initial([place(2, 1, 1)], {width: 4, height: 4, depth: 4})).queries(), input = {minQ: vec(1.25, 1.25, 1.25), sizeQ: vec(0.5, 0.5, 0.5), gravityQ: 0};
    const a = stepTerrainBody3D(q, createTerrainBody3D(q, input), {impulseQ: vec(2, 2, 2)}), b = step(modern, body(modern, input), {impulseQ: vec(2, 2, 2)});
    expect(b.movedQ).toEqual(a.movedQ); expect(b.contacts).toEqual(a.contacts); expect(b.body.minQ).toEqual(a.body.minQ); expect(b.body.velocityQ).toEqual(a.body.velocityQ);
  });
  test('an absent floor loses footing and gravity advances the explicit actor cadence', () => {
    const s = session(r, initial([place(0, 2)])), a = body(s.queries(), {minQ: vec(0, 1, 0), sizeQ: vec(1, 1, 1)}), b = s.branch({horizonTicks: 0});
    b.enqueue({kind: 'edit', domain: null, edits: [place(0, 2, 0, MAT.AIR)]}); finish(b); s.commit(b);
    const out = step(s.queries(), a); expect(out.lostFooting).toBe(true); expect(out.movedQ).toEqual([0, 64, 0]); expect(out.body.step).toBe(1); expect(out.body.velocityQ[1]).toBe(64);
  });
  test('body exposure reports immersion and sensible heat without blocking fluids', () => {
    const q = session(r, initial([place(0, 2, 0, MAT.WATER, 80)])).queries(), a = body(q, {minQ: vec(0, 2, 0), sizeQ: vec(1, 1, 1), gravityQ: 0}), out = step(q, a);
    expect(out.status).toBe('resolved'); expect(out.exposure.materials.find(m => m.material === MAT.WATER)).toMatchObject({minTemperatureQ: 80 * 256, maxImmersionDepthQ: Q});
  });
  test('malformed body fields rules vectors and getters reject without side effects', () => {
    const q = session(r, initial()).queries(), a = body(q, {minQ: vec(0, 1, 0), sizeQ: vec(1, 1, 1)}), get = vi.fn();
    for (const bad of [{...a, rulesVersion: 'terrain-body-1'}, {...a, extra: 1}, {...a, minQ: [0, 1]}, {...a, sizeQ: [0, Q, Q]}, {...a, velocityQ: [Infinity, 0, 0]}, {...a, grounded: 1}, {...a, step: -1}]) expect(() => read(q, bad as never)).toThrow();
    expect(() => read(q, Object.defineProperty({...a}, 'step', {get, enumerable: true}))).toThrow(); expect(get).not.toHaveBeenCalled();
  });
  test('world domain and catalog mismatches cannot silently rebind a saved body', () => {
    const input = initial(), s = session(r, input), a = body(s.queries(), {minQ: vec(0, 1, 0), sizeQ: vec(1, 1, 1)});
    expect(() => read(s.queries('flask'), a)).toThrow(); expect(() => read(session(r, {...input, worldId: 'foreign'}).queries(), a)).toThrow();
    expect(() => read(session(warm, initial([], column, 0, warm)).queries(), a)).toThrow(); expect(() => read({...s.queries()}, a)).toThrow();
  });
  test('adding and releasing holds preserves body compatibility across world envelope versions', () => {
    const s = session(r, initial([place(0, 2)])), a = body(s.queries(), {minQ: vec(0, 1, 0), sizeQ: vec(1, 1, 1)}), b = s.branch({horizonTicks: 0});
    b.enqueue({kind: 'hold', domain: null, request: {id: 'lift', cells: [[0, 2, 0]], expiresAtTick: 2}}); finish(b); s.commit(b);
    expect(s.queries().stamp.worldRulesVersion).toBe('reactive-world-2'); expect(read(s.queries(), a)).toEqual(a);
    const release = s.branch({horizonTicks: 0}); release.enqueue({kind: 'releaseHold', domain: null, id: 'lift'}); finish(release); s.commit(release); expect(read(s.queries(), a)).toEqual(a);
  });
  test('invalid summed speed step overflow and command accessors leave the input untouched', () => {
    const q = session(r, initial()).queries(), a = body(q, {minQ: vec(0, 1, 0), sizeQ: vec(1, 1, 1), gravityQ: 0}), saved = structuredClone(a), get = vi.fn();
    expect(() => step(q, {...a, step: Number.MAX_SAFE_INTEGER})).toThrow(); expect(() => step(q, {...a, velocityQ: vec(32, 0, 0)}, {impulseQ: [1, 0, 0]})).toThrow();
    expect(() => step(q, a, Object.defineProperty({}, 'impulseQ', {get, enumerable: true}))).toThrow(); expect(get).not.toHaveBeenCalled(); expect(a).toEqual(saved);
  });
  test('initial embedded and outside resolutions keep the original step and position', () => {
    const q = session(r, initial([place(0, 2)])).queries(), a = body(q, {minQ: vec(0, 1, 0), sizeQ: vec(1, 1, 1)});
    expect(step(q, {...a, minQ: vec(0, 2, 0)})).toMatchObject({status: 'embedded', body: {step: 0, minQ: vec(0, 2, 0)}});
    expect(step(q, {...a, minQ: [-1, Q, 0]})).toMatchObject({status: 'outside', body: {step: 0, minQ: [-1, Q, 0]}});
  });
});

describe('causal response to actual reactive physics', () => {
  test('a grounded body follows its falling platform without an actor step or impulse', () => {
    const f = fixture(), a = f.make(), out = f.context.resolve(a); expect(out).toMatchObject({status: 'resolved', movedQ: [0, Q, 0], body: {step: 0, velocityQ: [0, 0, 0], grounded: true}});
    expect(out.carries).toEqual([{pass: 28, requestedQ: [0, Q, 0], origins: [2], components: [2]}]); expect(out.supportFragments).toEqual([2]); expect(displacementTrace3D(out).some(s => s.pass === 28 && s.velocityQ[1] === Q)).toBe(true);
  });
  test('fractional debris contact pushes by exact remaining travel and records the rational time', () => {
    const f = pusher(), a = under(f), out = f.context.resolve(a); expect(out.status).toBe('resolved'); expect(out.movedQ).toEqual([0, 0.75 * Q, 0]);
    expect(out.contacts[0]).toMatchObject({pass: 28, time: {numerator: 1, denominator: 4}, normal: [0, 1, 0], material: MAT.STONE, fragment: 1}); expect(out.body.step).toBe(a.step);
  });
  test('debris crushing against anchored terrain reports exact opposing constraints without publishing a body', () => {
    const f = crushFixture(), a = under(f), out = f.context.resolve(a); expect(out).toMatchObject({status: 'crushed', reason: 'opposed-constraints', body: a, movedQ: [0, 0, 0], crush: {axis: 1, lowerVelocityQ: Q, upperVelocityQ: 0}});
    expect(out.events).toBe(2); expect(out.contacts.some(c => c.from === 3 && c.time.numerator === 1 && c.time.denominator === 2)).toBe(true);
  });
  test('the closed bottom boundary participates in debris crushing', () => {
    const f = fixture([place(0, 1)], {width: 1, height: 3, depth: 1}), out = f.context.resolve(under(f)); expect(out.status).toBe('crushed'); expect(out.contacts.some(c => c.boundary === 3)).toBe(true);
  });
  test('one stationary support prevents carry by a neighboring falling fragment', () => {
    const f = fixture([place(0, 2), place(1, 2), anchor(1, 2)], {width: 2, height: 4, depth: 1}), a = f.make(vec(0, 1, 0), vec(2, 1, 1)), out = f.context.resolve(a);
    expect(out.status).toBe('resolved'); expect(out.movedQ).toEqual([0, 0, 0]); expect(out.carries).toEqual([]); expect(out.body.grounded).toBe(true);
  });
  test('loose powder leaves its rider unsupported without automatic carry', () => {
    const f = fixture([place(0, 2, 0, MAT.SAND)]), out = f.context.resolve(f.make()); expect(out).toMatchObject({status: 'resolved', movedQ: [0, 0, 0], lostFooting: true, carries: []});
  });
  test('melting ice stops supporting the actor before structural settlement', () => {
    const f = fixture([place(0, 2, 0, MAT.ICE, 60)]), out = f.context.resolve(f.make()); expect(out).toMatchObject({status: 'resolved', lostFooting: true, carries: [], contacts: []});
    expect(f.movement.trace!.passes[26].changes.some(c => (c.packed & 255) === MAT.WATER)).toBe(true);
  });
  test('combustion into custom smoke retires support without a phantom solid collider', () => {
    const f = fixture([place(0, 2, 0, 200, 181)]), out = f.context.resolve(f.make()); expect(f.movement.trace!.passes[27].changes.some(c => (c.packed & 255) === MAT.SMOKE)).toBe(true);
    expect(out).toMatchObject({status: 'resolved', lostFooting: true, carries: [], contacts: []});
  });
  test('freezing around an immersed actor reports the exact phase-overlap boundary', () => {
    const f = fixture([place(0, 1, 0, MAT.WATER, 0)], {width: 1, height: 2, depth: 1}), a = f.make(vec(0.25, 1.25, 0.25), vec(0.5, 0.5, 0.5)), out = f.context.resolve(a);
    expect(out).toMatchObject({status: 'embedded', reason: 'phase-overlap', throughPass: 26, body: a}); expect(out.contacts.at(-1)).toMatchObject({pass: 26, material: MAT.ICE, normal: [0, 0, 0]});
  });
  test('a transient phase overlap is detected before settlement through lighter melt clears the cell', async () => {
    const c = r.toCatalog(); c.propertiesCatalog.materials.find(m => m.id === MAT.MOLTEN_GLASS)!.properties.density = 160;
    const lighter = await createReactiveMaterialRegistry3D(c);
    const f = fixture([place(0, 1, 0, MAT.MOLTEN_GLASS, 200), place(0, 2, 0, MAT.GLASS, 255), {kind: 'energy', x: 0, y: 2, z: 0, energyQ: 400 * 256}], {width: 1, height: 4, depth: 1}, lighter);
    const a = f.make(vec(0.25, 1.25, 0.25), vec(0.5, 0.5, 0.5)); expect(f.after.fit({box: {minQ: a.minQ, maxQ: vec(0.75, 1.75, 0.75)}}).fits).toBe(true);
    expect(f.context.resolve(a)).toMatchObject({status: 'embedded', reason: 'phase-overlap', throughPass: 26, body: a});
  });
  test('contact energy reflects completed heat exchange before structural movement', () => {
    const f = fixture([place(0, 1, 0, MAT.STONE, 150)], column, warm), a = under(f), out = f.context.resolve(a), contact = out.contacts.find(c => c.from === 1)!;
    const changes = f.movement.trace!.passes.slice(0, 28).flatMap(p => p.changes).filter(c => c.index === 1); expect(changes.length).toBeGreaterThan(0);
    expect(contact.energyQ).toBe(changes.at(-1)!.energyQ); expect(contact.energyQ).not.toBe(f.before.fit({box: {minQ: vec(0, 1, 0), maxQ: vec(1, 2, 1)}}).blocker!.energyQ);
  });
  test('held platforms stay fixed then carry on the first tick after absolute expiry', () => {
    const raw = initial([place(0, 2)]), base = session(r, raw), a = body(base.queries(), {minQ: vec(0, 1, 0), sizeQ: vec(1, 1, 1), gravityQ: 0});
    const moves: V[] = [], s = session(r, {...raw, game: {ap: 2, body: a}}, {reduceTick(c) {const out = displace(c.beforeQueries(), c.queries(), c.movement()).resolve(c.game.body); expect(out.status).toBe('resolved'); moves.push(out.movedQ); return {...c.game, body: out.body};}});
    const b = s.branch({horizonTicks: 2, ...capture}); b.enqueue({kind: 'hold', domain: null, request: {id: 'lift', cells: [[0, 2, 0]], expiresAtTick: 1}}); finish(b); s.commit(b); expect(moves).toEqual([[0, 0, 0], [0, Q, 0]]);
  });
  test('liquid displaced by a falling fragment is not treated as a swept solid', () => {
    const f = fixture([place(0, 1), place(0, 2), place(0, 3, 0, MAT.WATER, 50), place(0, 4)], column), out = f.context.resolve(f.make(vec(0.25, 3.25, 0.25), vec(0.5, 0.5, 0.5)));
    expect(f.movement.trace!.passes[28].segments.some(s => s.mode === 'relocation')).toBe(true); expect(out.contacts.every(c => c.material !== MAT.WATER)).toBe(true);
  });
  test('final exposure follows the carried body into existing water with no implicit actor load', () => {
    const f = fixture([place(0, 2), place(0, 3, 0, MAT.WATER, 80), place(0, 4)]), a = f.make(), before = f.s.snapshot(), out = f.context.resolve(a);
    expect(out.status).toBe('resolved'); expect(out.body.minQ[1]).toBe(2 * Q); expect(out.exposure.materials.some(m => m.material === MAT.WATER && m.maxImmersionDepthQ === Q)).toBe(true); expect(f.s.snapshot()).toEqual(before);
  });
});

describe('bounded provenance and atomic game integration', () => {
  test('disabled or overflowed capture cannot be accepted as a clear terrain response', () => {
    for (const options of [{}, {motion: {maxEntries: 0}}]) {const f = fixture([place(0, 2)], column, r, options as typeof capture), a = f.make(); expect(f.context.resolve(a)).toMatchObject({status: 'incomplete', reason: 'missing-paths', requiresReexecution: true, body: a, contacts: [], carries: []});}
  });
  test('the exact measured work budget succeeds and one fewer discards the complete response', () => {
    const f = pusher(), a = under(f), out = f.context.resolve(a); expect(f.context.resolve(a, {maxWork: out.work})).toEqual(out);
    expect(f.context.resolve(a, {maxWork: out.work - 1})).toMatchObject({status: 'incomplete', body: a, contacts: [], carries: [], movedQ: [0, 0, 0]});
  });
  test('contact and event exhaustion discard an earlier push and its crush witness', () => {
    const f = crushFixture(), a = under(f); for (const options of [{maxEvents: 1}, {maxContacts: 1}]) expect(f.context.resolve(a, options)).toMatchObject({status: 'incomplete', body: a, contacts: [], crush: null});
  });
  test('invalid budgets and accessor options cannot execute or mutate state', () => {
    const f = pusher(), a = under(f), get = vi.fn(); for (const o of [{maxWork: -1}, {maxWork: 1048577}, {maxEvents: 513}, {maxContacts: NaN}, {extra: 1}]) expect(() => f.context.resolve(a, o)).toThrow();
    expect(() => f.context.resolve(a, Object.defineProperty({}, 'maxWork', {get, enumerable: true}))).toThrow(); expect(get).not.toHaveBeenCalled();
  });
  test('cloned observations and equal-stamp foreign views cannot forge executed provenance', () => {
    const a = fixture(), b = fixture(); expect(a.before.stamp).toEqual(b.before.stamp); expect(() => displace(a.before, b.after, a.movement)).toThrow();
    expect(() => displace(a.before, a.after, structuredClone(a.movement))).toThrow(); expect(() => displace({...a.before}, a.after, a.movement)).toThrow(); expect(() => displace(a.after, a.before, a.movement)).toThrow();
  });
  test('public movement and response mutation cannot alter repeated resolution or physics', () => {
    const f = pusher(), a = under(f), before = f.s.snapshot(), out = f.context.resolve(a), saved = structuredClone(out); f.movement.trace!.passes.length = 0; f.movement.status = 'overflow';
    out.body.minQ[1] = 0; out.contacts.length = 0; expect(displace(f.before, f.after, f.movement).resolve(a)).toEqual(saved); expect(f.context.resolve(a)).toEqual(saved); expect(f.s.snapshot()).toEqual(before);
  });
  test('contexts remain historical after commit and restore without binding to a newer revision', () => {
    const f = fixture(), a = f.make(), out = f.context.resolve(a); f.s.commit(f.b); f.s.restore(f.s.snapshot()); expect(f.context.resolve(a)).toEqual(out); expect(Object.isFrozen(f.context)).toBe(true);
  });
  test('reusing a context for different bodies never leaks pass state between resolutions', () => {
    const f = pusher(), a = under(f), first = f.context.resolve(a); f.context.resolve(f.make(vec(0.25, 4.25, 0.25), vec(0.5, 0.5, 0.5))); expect(f.context.resolve(a)).toEqual(first);
  });
  test('initial outside and embedded saved bodies remain unresolved without partial motion', () => {
    const f = fixture(), a = f.make(); expect(f.context.resolve({...a, minQ: [-1, Q, 0]})).toMatchObject({status: 'outside', reason: 'initial-outside', movedQ: [0, 0, 0]});
    expect(f.context.resolve({...a, minQ: vec(0, 2, 0)})).toMatchObject({status: 'embedded', reason: 'initial-overlap', movedQ: [0, 0, 0]});
  });
  test('a paid ability publishes carried body and terrain together only at commit', () => {
    const raw = initial([place(0, 2)]), a = body(session(r, raw).queries(), {minQ: vec(0, 1, 0), sizeQ: vec(1, 1, 1), gravityQ: 0});
    const s = session(r, {...raw, game: {ap: 2, body: a}}, {reduceTick(c) {const out = displace(c.beforeQueries(), c.queries(), c.movement()).resolve(c.game.body); if (out.status !== 'resolved') throw Error('contact'); return {...c.game, body: step(c.queries(), out.body).body};}});
    const saved = s.snapshot(), b = s.branch({horizonTicks: 1, ...capture}); b.enqueue({kind: 'game', game: {ap: 1, body: a}}); finish(b); expect(s.snapshot()).toEqual(saved);
    s.commit(b); expect(s.snapshot().game).toMatchObject({ap: 1, body: {minQ: vec(0, 2, 0), step: 1}}); expect(s.energyBalance().driftQ).toBe(0n);
  });
  test('rejected crushing rolls back actor terrain AP accounting and revision', () => {
    const raw = initial([place(0, 1), place(0, 3), anchor(0, 3)]), a = body(session(r, raw).queries(), {minQ: vec(0.25, 2.25, 0.25), sizeQ: vec(0.5, 0.5, 0.5), gravityQ: 0});
    const s = session(r, {...raw, game: {ap: 2, body: a}}, {reduceTick(c) {const out = displace(c.beforeQueries(), c.queries(), c.movement()).resolve(c.game.body); if (out.status !== 'resolved') throw Error('crush rejected'); return {...c.game, body: out.body};}});
    const saved = s.snapshot(), b = s.branch({horizonTicks: 1, ...capture}); b.enqueue({kind: 'game', game: {ap: 0, body: a}}); expect(() => finish(b)).toThrow(/crush rejected/); expect(s.snapshot()).toEqual(saved);
  });
  test('body response and complete physics continue exactly after an odd-tick JSON restart', () => {
    const raw = initial([place(0, 2)], column, 3), a = body(session(r, raw).queries(), {minQ: vec(0, 1, 0), sizeQ: vec(1, 1, 1), gravityQ: 0}), start = {...raw, game: {ap: 2, body: a}};
    const policy: ReactiveSessionPolicy3D<typeof start.game> = {reduceTick(c) {const out = displace(c.beforeQueries(), c.queries(), c.movement()).resolve(c.game.body); if (out.status !== 'resolved') throw Error('response'); return {...c.game, body: step(c.queries(), out.body).body};}};
    const left = session(r, start, policy); left.commit(finish(left.branch({horizonTicks: 1, ...capture}))); const right = session(r, start, policy); right.restore(JSON.parse(JSON.stringify(left.snapshot())));
    expect(left.commit(finish(left.branch({horizonTicks: 2, ...capture})))).toEqual(right.commit(finish(right.branch({horizonTicks: 2, ...capture})))); expect(left.snapshot()).toEqual(right.snapshot());
  });
  test('body response leaves complete material states identical to an unobserved branch', () => {
    const raw = initial([place(0, 2)]), a = body(session(r, raw).queries(), {minQ: vec(0, 1, 0), sizeQ: vec(1, 1, 1), gravityQ: 0}), start = {...raw, game: {ap: 2, body: a}};
    const left = session(r, start, {reduceTick(c) {return {...c.game, body: displace(c.beforeQueries(), c.queries(), c.movement()).resolve(c.game.body).body};}}), right = session(r, start);
    left.commit(finish(left.branch({horizonTicks: 1, ...capture}))); right.commit(finish(right.branch({horizonTicks: 1}))); expect(left.snapshot().domains).toEqual(right.snapshot().domains); expect(left.energyBalance()).toEqual(right.energyBalance());
  });
});
