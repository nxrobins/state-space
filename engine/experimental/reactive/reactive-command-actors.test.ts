import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Tiny executed-command contacts. Native and old M5 stepping remain trapped. */
import { beforeAll, describe, expect, test, vi } from 'vitest';

import { createReactiveMaterialRegistry3D, defaultReactiveMaterialCatalog3D, createReactiveMaterialBlock3D as block,
  editReactiveMaterialBlock3D as edit, createReactiveWorldSnapshot3D as world, createReactiveDomainsSnapshot3D as domains,
  createReactiveSession3D as session, createReactiveBody3D as body, createReactiveTranslationDisplacement3D as displace,
  GEOMETRY_SCALE_3D as Q, MAT, BONDS_3D, ANCHOR_3D, type ReactiveMaterialRegistry3D, type ReactiveMaterialEdit3D,
  type ReactiveBody3D, type ReactiveBranch3D, type ReactiveSessionPolicy3D, type ReactiveSessionCommand3D,
  type ReactiveTranslationRequest3D, type ReactiveSessionInitial3D } from '../reactive-materials.js';
holdPhysics('volumeStep', 'solveStructure3D', ...STRUCTURAL_CALLS);
let r: ReactiveMaterialRegistry3D;
beforeAll(async () => {const c = defaultReactiveMaterialCatalog3D(); for (const m of c.propertiesCatalog.materials) m.properties.conductivity = 0; r = await createReactiveMaterialRegistry3D(c);});
type V = [number, number, number];
type Game = {ap: number; turn: number; body: ReactiveBody3D | null};
type Context = Parameters<NonNullable<ReactiveSessionPolicy3D<Game>['reduceCommand']>>[0];
const vec = (x: number, y: number, z: number): V => [x * Q, y * Q, z * Q];
const place = (x = 2, y = 2, z = 2, material: number = MAT.STONE, thermal = 70): ReactiveMaterialEdit3D => ({kind: 'place', x, y, z, material, thermal});
const shape = {width: 5, height: 5, depth: 5}, origin = 62;
const request: ReactiveTranslationRequest3D = {cells: [[2, 2, 2]], path: [[1, 0, 0]]};
function initial(edits: ReactiveMaterialEdit3D[] = [place()], dimensions = shape): ReactiveSessionInitial3D<Game> {
  expect(dimensions.width * dimensions.height * dimensions.depth).toBeLessThanOrEqual(125);
  return {worldId: 'command-actors', gameRulesVersion: 'command-actors-game-1', domains: domains(r, world(r, edit(r, block(r, dimensions), edits).block)), game: {ap: 2, turn: 0, body: null}};
}
function finish(b: ReactiveBranch3D<Game>) {let calls = 0; while (['preparing', 'running'].includes(b.progress().status)) {if (++calls > 10000) throw Error('Tiny command bound'); b.advance(7);} return b;}
const move = (req = request): ReactiveSessionCommand3D<Game> => {expect(req.path.length).toBeLessThanOrEqual(8); return {kind: 'translate', domain: null, request: req};};
function fixture(edits = [place()], req = request, capture: {translation?: {maxEntries?: number}} = {translation: {}}, dimensions = shape) {
  let c!: Context;
  const s = session(r, initial(edits, dimensions), {reduceCommand(value) {c = value; return value.game;}}), b = s.branch({horizonTicks: 0, ...capture});
  b.enqueue(move(req)); finish(b); const before = c.beforeQueries(), after = c.queries(), movement = c.translation()!;
  return {s, b, c, before, after, movement, context: displace(before, after, movement),
    make: (minQ = vec(2.25, 1.5, 2.25), sizeQ = vec(0.5, 0.5, 0.5)) => body(before, {minQ, sizeQ, gravityQ: 0})};
}
const policy: ReactiveSessionPolicy3D<Game> = {reduceCommand(c) {
  if (c.command.kind !== 'translate' || !c.game.body) return c.game;
  const out = displace(c.beforeQueries(c.command.domain), c.queries(c.command.domain), c.translation()!).resolve(c.game.body);
  if (out.status !== 'resolved') throw Error('Unsafe actor translation: ' + out.status);
  return {...c.game, body: out.body};
}, validateGame: s => s.game.ap >= 0};
function gameSession(edits = [place()], custom = policy) {
  const input = initial(edits), binding = session(r, input); input.game.body = body(binding.queries(), {minQ: vec(2.25, 1.5, 2.25), sizeQ: vec(0.5, 0.5, 0.5), gravityQ: 0});
  return session(r, input, custom);
}

describe('reactive controlled material and actors', () => {
  test('all six cardinal directions carry grounded actors and preserve their cadence', () => {
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
      const delta: V = [0, 0, 0]; delta[axis] = sign;
      const f = fixture(undefined, {...request, path: [delta]}), input = f.make(), out = f.context.resolve(input);
      expect(out.status).toBe('resolved'); expect(out.movedQ).toEqual(delta.map(v => v * Q)); expect(out.body.grounded).toBe(true);
      expect(out.carries).toEqual([{pass: 0, requestedQ: delta.map(v => v * Q), origins: [origin]}]);
      expect(out.body.step).toBe(input.step); expect(out.body.velocityQ).toEqual(input.velocityQ); expect(out.body.gravityQ).toBe(input.gravityQ);
    }
  });
  test('fractional pushes use the exact remaining travel on all axes and signs', () => {
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
      const delta: V = [0, 0, 0], min = vec(2.25, 2.25, 2.25); delta[axis] = sign; min[axis] += sign * Q;
      const f = fixture(undefined, {...request, path: [delta]}), out = f.context.resolve(f.make(min));
      expect(out.status).toBe('resolved'); expect(out.movedQ[axis]).toBe(sign * Q * 0.75); expect(out.contacts[0].time).toEqual({numerator: 1, denominator: 4}); expect(out.contacts[0].normal[axis]).toBe(sign);
    }
  });
  test('multi-axis carry tracks the original selected support across each real pass', () => {
    const f = fixture(undefined, {...request, path: [[1, 0, 0], [0, -1, 0], [0, 0, 1]]}), out = f.context.resolve(f.make());
    expect(out.status).toBe('resolved'); expect(out.movedQ).toEqual([Q, -Q, Q]); expect(out.throughPass).toBe(2);
    expect(out.carries.map(c => c.origins)).toEqual([[origin], [origin], [origin]]);
  });
  test('an out-and-back route retains transient carry and pushes despite equal terrain', () => {
    const f = fixture(undefined, {...request, path: [[1, 0, 0], [-1, 0, 0]]}), input = f.make(), out = f.context.resolve(input);
    expect(out.body).toEqual(input); expect(out.carries).toHaveLength(2);
    expect(f.b.inspect().state.domains).toEqual(f.s.snapshot().domains);
    expect(f.context.resolve(f.make(vec(3.25, 2.25, 2.25))).movedQ).toEqual([0.75 * Q, 0, 0]);
  });
  test('all touching controlled upper faces jointly authorize a carry', () => {
    const f = fixture([place(), place(3)], {cells: [[3, 2, 2], [2, 2, 2]], path: [[0, 0, 1]]});
    const out = f.context.resolve(f.make(vec(2.5, 1.5, 2.25), vec(1, 0.5, 0.5)));
    expect(out.status).toBe('resolved'); expect(out.movedQ).toEqual([0, 0, Q]); expect(out.carries[0].origins).toEqual([62, 63]);
  });
  test('a stationary support vetoes carry while the surviving floor retains footing', () => {
    const f = fixture([place(), place(3)], {...request, path: [[-1, 0, 0]]}), out = f.context.resolve(f.make(vec(2.5, 1.5, 2.25), vec(1, 0.5, 0.5)));
    expect(out.movedQ).toEqual([0, 0, 0]); expect(out.carries).toEqual([]); expect(out.body.grounded).toBe(true);
  });
  test('airborne actors and the closed floor do not acquire unrelated first-pass carry', () => {
    const f = fixture(), airborne = {...f.make(), grounded: false}, floor = f.make(vec(2.25, 4.5, 2.25));
    for (const input of [airborne, floor]) {const out = f.context.resolve(input); expect(out.status).toBe('resolved'); expect(out.movedQ).toEqual([0, 0, 0]); expect(out.carries).toEqual([]);}
  });
  test('support arriving underneath an actor can carry on the next complete pass', () => {
    const f = fixture(undefined, {...request, path: [[1, 0, 0], [1, 0, 0]]}), input = f.make(vec(3.25, 1.5, 2.25)), out = f.context.resolve(input);
    expect(input.grounded).toBe(false); expect(out.status).toBe('resolved'); expect(out.movedQ).toEqual([Q, 0, 0]); expect(out.carries.map(c => c.pass)).toEqual([1]); expect(out.landed).toBe(true);
  });
  test('a fixed side wall limits realized carry and can remove footing', () => {
    const f = fixture([place(), place(3, 1)]), out = f.context.resolve(f.make());
    expect(out.status).toBe('resolved'); expect(out.movedQ).toEqual([Q / 4, 0, 0]); expect(out.carries[0].requestedQ).toEqual([Q, 0, 0]); expect(out.lostFooting).toBe(true);
  });
  test('a lift beneath a fixed ceiling reports opposed constraints without changing the body', () => {
    const f = fixture([place(), place(2, 0)], {...request, path: [[0, -1, 0]]}), input = f.make(), out = f.context.resolve(input);
    expect(out.status).toBe('crushed'); expect(out.crush).toEqual({axis: 1, lowerVelocityQ: 0, upperVelocityQ: -Q}); expect(out.body).toEqual(input); expect(out.movedQ).toEqual([0, 0, 0]);
  });
  test('closed boundaries participate in causal crush', () => {
    const f = fixture([place(3)], {cells: [[3, 2, 2]], path: [[1, 0, 0]]}), input = f.make(vec(4.25, 2.25, 2.25)), out = f.context.resolve(input);
    expect(out.status).toBe('crushed'); expect(out.contacts.some(c => c.boundary === 1)).toBe(true); expect(out.body).toEqual(input);
  });
  test('displaced powder checks its endpoint without inventing a swept route', () => {
    const f = fixture([place(2, 2, 2, MAT.WATER), place(3, 2, 2, MAT.SAND)], {...request, displacement: 'mobile'}), input = f.make(vec(2.25, 2.25, 2.25)), out = f.context.resolve(input);
    expect(out).toMatchObject({status: 'embedded', reason: 'relocation-overlap', body: input}); expect(out.contacts).toHaveLength(1);
    expect(out.contacts[0]).toMatchObject({origin: 63, from: 63, to: 62, time: {numerator: 1, denominator: 1}});
    expect(f.movement.paths.passes[0].segments.find(s => s.origin === 63)?.mode).toBe('relocation');
  });
  test('liquids and gases do not supply blocking force while solid frozen and powder supports carry', () => {
    for (const material of [MAT.WATER, MAT.STEAM]) {const f = fixture([place(2, 2, 2, material)]), out = f.context.resolve(f.make(vec(3.25, 2.25, 2.25))); expect(out.status).toBe('resolved'); expect(out.contacts).toEqual([]); expect(out.movedQ).toEqual([0, 0, 0]);}
    for (const material of [MAT.STONE, MAT.ICE, MAT.SAND]) {const f = fixture([place(2, 2, 2, material)]); expect(f.context.resolve(f.make()).movedQ).toEqual([Q, 0, 0]);}
  });
  test('exposure follows the resolved actor into hot water', () => {
    const f = fixture([place(), place(3, 1, 2, MAT.WATER, 80)]), out = f.context.resolve(f.make());
    expect(out.status).toBe('resolved'); expect(out.exposure.materials.find(m => m.material === MAT.WATER)).toMatchObject({minTemperatureQ: 80 * 256});
  });
});

describe('bounded isolated command observations', () => {
  test('one controlled origin plus one header and two segments consumes exactly four entries', () => {
    const a = fixture(undefined, undefined, {translation: {maxEntries: 4}}), b = fixture(undefined, undefined, {translation: {maxEntries: 3}});
    expect(a.movement.paths).toMatchObject({status: 'complete', entries: 4, stepsObserved: 1, requiresReexecution: false});
    expect(b.movement.paths).toMatchObject({status: 'overflow', entries: 0, passes: [], controlledSources: [], requiresReexecution: true});
    expect(a.b.inspect().state).toEqual(b.b.inspect().state); expect(b.context.resolve(b.make()).status).toBe('incomplete');
  });
  test('disabled capture is explicit and cannot masquerade as an empty safe path', () => {
    const f = fixture(undefined, undefined, {}), input = f.make(); expect(f.movement.paths.status).toBe('disabled');
    expect(f.context.resolve(input)).toMatchObject({status: 'incomplete', reason: 'missing-paths', body: input, carries: [], requiresReexecution: true});
  });
  test('exact carry budgets and late overflow preserve the original body and clear details', () => {
    const f = fixture(), input = f.make(); expect(f.context.resolve(input, {maxCarryEntries: 2}).status).toBe('resolved');
    expect(f.context.resolve(input, {maxCarryEntries: 1})).toMatchObject({status: 'incomplete', reason: 'budget', body: input, carries: [], contacts: [], movedQ: [0, 0, 0]});
    const twice = fixture(undefined, {...request, path: [[1, 0, 0], [0, 0, 1]]}), actor = twice.make();
    expect(twice.context.resolve(actor, {maxCarryEntries: 3})).toMatchObject({status: 'incomplete', body: actor, carries: [], contacts: [], crush: null});
  });
  test('contact event and work limits cannot leak partial poses or contacts', () => {
    const f = fixture(), input = f.make(vec(3.25, 2.25, 2.25));
    for (const options of [{maxContacts: 0}, {maxEvents: 0}, {maxWork: 0}]) expect(f.context.resolve(input, options)).toMatchObject({status: 'incomplete', body: input, contacts: [], carries: []});
    const done = f.context.resolve(input); expect(f.context.resolve(input, {maxWork: done.work}).status).toBe('resolved');
    expect(f.context.resolve(input, {maxWork: done.work - 1}).status).toBe('incomplete');
  });
  test('invalid capture and response options reject without invoking getters', () => {
    const s = session(r, initial()), f = fixture(), get = vi.fn(() => 1);
    for (const v of [undefined, null, [], {maxEntries: undefined}, {maxEntries: -1}, {maxEntries: 65537}, {extra: 1}, Object.defineProperty({}, 'maxEntries', {enumerable: true, get})]) expect(() => s.branch({horizonTicks: 0, translation: v as never})).toThrow();
    for (const v of [null, [], {extra: 1}, {maxCarryEntries: -1}, {maxCarryEntries: 65537}, {maxCarryEntries: NaN}, {maxEvents: -1}, Object.defineProperty({}, 'maxCarryEntries', {enumerable: true, get})]) expect(() => f.context.resolve(f.make(), v as never)).toThrow(); expect(get).not.toHaveBeenCalled();
  });
  test('capture options are owned when a branch is created', () => {
    const s = session(r, initial()), options = {maxEntries: 4}, b = s.branch({horizonTicks: 0, translation: options}); options.maxEntries = 0; b.enqueue(move()); finish(b); expect(b.lastTranslation()!.paths.status).toBe('complete');
  });
  test('clones foreign boundaries and foreign domains cannot forge observation provenance', () => {
    const a = fixture(), b = fixture(); expect(a.before.stamp).toEqual(b.before.stamp);
    expect(() => displace(a.before, b.after, a.movement)).toThrow(); expect(() => displace(a.before, a.after, structuredClone(a.movement))).toThrow();
    expect(() => displace({...a.before}, a.after, a.movement)).toThrow(); expect(() => displace(a.after, a.before, a.movement)).toThrow();
  });
  test('public path edits and resolve order leave privately bound execution unchanged', () => {
    const f = fixture(), input = f.make(), expected = f.context.resolve(input); f.movement.paths.passes.length = 0; f.movement.paths.controlledSources.length = 0; f.movement.paths.status = 'overflow';
    f.context.resolve(f.make(vec(0, 0, 0))); expect(f.context.resolve(input)).toEqual(expected); expect(displace(f.before, f.after, f.movement).resolve(input)).toEqual(expected);
    const copy = f.context.resolve(input); copy.body.minQ[0] = 0; copy.carries[0].origins[0] = 0; expect(f.context.resolve(input)).toEqual(expected);
  });
  test('retained command contexts remain historical after discard and later edits', () => {
    const f = fixture(), input = f.make(), expected = f.context.resolve(input); f.b.discard();
    const next = f.s.branch({horizonTicks: 0}); next.enqueue({kind: 'edit', domain: null, edits: [place(3, 1)]}); finish(next); f.s.commit(next);
    expect(displace(f.c.beforeQueries(), f.c.queries(), f.c.translation()!).resolve(input)).toEqual(expected);
  });
  test('partial jobs publish no new paths and a later command or tick clears the latest translation', () => {
    for (const tail of ['command', 'tick'] as const) {
      const s = session(r, initial()), b = s.branch({horizonTicks: tail === 'tick' ? 1 : 0, translation: {}}); b.enqueue(move()); if (tail === 'command') b.enqueue({kind: 'game', game: {ap: 1, turn: 0, body: null}});
      b.advance(1); expect(b.lastTranslation()).toBeNull(); while (!b.progress().completedCommands) {b.advance(1); if (!b.progress().completedCommands) expect(b.lastTranslation()).toBeNull();}
      const retained = b.lastTranslation()!; expect(retained.paths.status).toBe('complete'); finish(b); expect(b.lastTranslation()).toBeNull(); expect(retained.paths.passes).toHaveLength(1);
    }
  });
  test('hot damaged internal bonds travel without repair cooling or automatic joining', () => {
    const edits: ReactiveMaterialEdit3D[] = [place(2, 2, 2, MAT.STONE, 100), place(3, 2, 2, MAT.STONE, 90), {kind: 'bond', x: 2, y: 2, z: 2, direction: 1, bonded: true}, {kind: 'integrity', x: 3, y: 2, z: 2, integrity: 73}];
    const f = fixture(edits, {cells: [[2, 2, 2], [3, 2, 2]], path: [[0, 0, 1]]}), before = f.s.snapshot().domains.world.block, after = f.b.inspect().state.domains.world.block;
    for (const key of ['packedCells', 'energyQ', 'structure'] as const) expect(after[key].slice(87, 89)).toEqual(before[key].slice(62, 64));
    expect(after.structure[88] & 255).toBe(73); expect(after.structure[87] & BONDS_3D[1]).toBe(BONDS_3D[1]); expect(f.movement.paths.controlledSources).toEqual([62, 63]);
  });
  test('explicit cuts and releases validate exact history even with singleton axes', () => {
    for (const axis of [0, 1, 2]) {
      const dimensions = {width: axis === 0 ? 4 : 1, height: axis === 1 ? 4 : 1, depth: axis === 2 ? 4 : 1}, a: V = [0, 0, 0], b: V = [0, 0, 0], delta: V = [0, 0, 0]; b[axis] = 1; delta[axis] = 1;
      const edits: ReactiveMaterialEdit3D[] = [place(...a), place(...b), {kind: 'bond', x: a[0], y: a[1], z: a[2], direction: axis * 2 + 1, bonded: true}, {kind: 'anchor', x: b[0], y: b[1], z: b[2], anchored: true}];
      const f = fixture(edits, {cells: [b], path: [delta], externalBonds: 'cut', anchors: 'release'}, undefined, dimensions), saved = f.b.inspect().state.domains.world.block;
      expect(f.movement.paths.status).toBe('complete'); expect(saved.structure[0] & BONDS_3D[axis * 2 + 1]).toBe(0); expect(saved.structure[2] & ANCHOR_3D).toBe(0); expect(saved.structure[2] & 255).toBe(255);
    }
  });
});

describe('atomic command policy and continuation', () => {
  test('command callbacks see matching candidate queries while branch and live reads retain the prior boundary', () => {
    let b!: ReactiveBranch3D<Game>, c!: Context;
    const s = session(r, initial(), {reduceCommand(value) {c = value; expect(b.inspect().state).toEqual(s.snapshot()); expect(b.progress().completedCommands).toBe(0); expect(b.lastTranslation()).toBeNull(); return {...value.game, ap: 1};}});
    b = s.branch({horizonTicks: 0, translation: {}}); b.enqueue(move()); finish(b);
    expect(c.beforeQueries().stamp).toMatchObject({completedCommands: 0, tick: 0}); expect(c.queries().stamp).toMatchObject({completedCommands: 1, tick: 0}); expect(c.translation()!.from).toEqual(c.beforeQueries().stamp);
    expect(s.snapshot().game.ap).toBe(2); expect(s.commit(b).snapshot.game.ap).toBe(1);
  });
  test('all command kinds invoke policy once and transfer provides no invented translation', () => {
    const input = initial([place(1, 1, 0)], {width: 4, height: 4, depth: 1}); input.domains = domains(r, input.domains.world, [{id: 'flask', world: world(r, block(r, {width: 4, height: 4, depth: 1}))}]);
    const seen: string[] = [], s = session(r, input, {reduceCommand(c) {seen.push(c.command.kind); expect(c.beforeQueries().stamp).toMatchObject({completedCommands: seen.length - 1}); expect(c.queries().stamp).toMatchObject({completedCommands: seen.length}); expect(c.translation() === null).toBe(c.command.kind !== 'translate'); if (c.command.kind === 'transfer') expect(c.queries('flask').stamp.domain).toBe('flask'); return {...c.game, turn: c.game.turn + 1};}}), b = s.branch({horizonTicks: 0, translation: {}});
    b.enqueue({kind: 'game', game: {...input.game, ap: 1}}); b.enqueue({kind: 'edit', domain: null, edits: [{kind: 'energy', x: 1, y: 1, z: 0, energyQ: input.domains.world.block.energyQ[5] + 256}]});
    b.enqueue({kind: 'hold', domain: null, request: {id: 'lift', cells: [[1, 1, 0]], expiresAtTick: 3}}); b.enqueue({kind: 'releaseHold', domain: null, id: 'lift'});
    b.enqueue(move({cells: [[1, 1, 0]], path: [[1, 0, 0]]})); b.enqueue({kind: 'transfer', request: {from: null, to: 'flask', cells: [[2, 1, 0]], offset: [0, 0, 0]}});
    finish(b); const out = s.commit(b); expect(seen).toEqual(['game', 'edit', 'hold', 'releaseHold', 'translate', 'transfer']); expect(out.snapshot.game).toMatchObject({ap: 1, turn: 6}); expect(s.energyBalance()).toMatchObject({externalQ: 256n, driftQ: 0n});
  });
  test('command input game receipt and resulting state copies cannot mutate future publication', () => {
    let held!: Game;
    const s = session(r, initial(), {reduceCommand(c) {c.command.kind = 'game'; (c.receipt as {gameChanged: boolean}).gameChanged = false; held = {...c.game, ap: 1}; return held;}}), b = s.branch({horizonTicks: 0, translation: {}});
    b.enqueue(move()); finish(b); held.ap = 0; const out = s.commit(b); expect(out.snapshot.game.ap).toBe(1); expect(out.snapshot.domains.world.block.packedCells[63] & 255).toBe(MAT.STONE); expect(out.snapshot.domains.tick).toBe(0);
  });
  test('a rejected lift rolls back prior AP and energy commands as one transaction', () => {
    const s = gameSession([place(), place(2, 0)]), before = s.snapshot(), balance = s.energyBalance(), b = s.branch({horizonTicks: 0, translation: {}});
    b.enqueue({kind: 'game', game: {...before.game, ap: 1}}); b.enqueue({kind: 'edit', domain: null, edits: [{kind: 'energy', x: 2, y: 2, z: 2, energyQ: before.domains.world.block.energyQ[62] + 256}]}); b.enqueue(move({...request, path: [[0, -1, 0]]}));
    expect(() => finish(b)).toThrow(/crushed/); expect(b.progress().status).toBe('failed'); expect(s.snapshot()).toEqual(before); expect(s.energyBalance()).toEqual(balance); expect(() => s.commit(b)).toThrow();
  });
  test('invalid returned games and promises reject the entire branch', async () => {
    for (const value of [undefined, NaN, new Date(), Promise.resolve({ap: 0}), Promise.reject(Error('async policy'))]) {
      const s = session(r, initial(), {reduceCommand: () => value as never}), before = s.snapshot(), b = s.branch({horizonTicks: 0}); b.enqueue(move());
      expect(() => finish(b)).toThrow(); expect(b.progress().status).toBe('failed'); expect(s.snapshot()).toEqual(before);
    } await Promise.resolve();
  });
  test('swallowed callback mutation reentry still poisons and rolls back the command', () => {
    const s = session(r, initial(), {reduceCommand(c) {try {s.branch({horizonTicks: 0});} catch { /* Deliberately swallowed. */ } return c.game;}}), before = s.snapshot(), b = s.branch({horizonTicks: 0}); b.enqueue(move());
    expect(() => finish(b)).toThrow(/reentry/); expect(s.snapshot()).toEqual(before); expect(b.progress().status).toBe('failed');
  });
  test('policy validation rejects accessors and owns the callback identity', () => {
    const get = vi.fn(), candidate: ReactiveSessionPolicy3D<Game> = {reduceCommand: c => ({...c.game, ap: 1})};
    expect(() => session(r, initial(), Object.defineProperty({}, 'reduceCommand', {get, enumerable: true}))).toThrow(); expect(get).not.toHaveBeenCalled();
    const s = session(r, initial(), candidate); candidate.reduceCommand = () => {throw Error('mutated');}; const b = s.branch({horizonTicks: 0}); b.enqueue(move()); finish(b); expect(s.commit(b).snapshot.game.ap).toBe(1);
  });
  test('cancelling a partially executed path retains every committed coordinate and ledger', () => {
    const s = gameSession(), before = s.snapshot(), b = s.branch({horizonTicks: 0, translation: {}}); b.enqueue({kind: 'game', game: {...before.game, ap: 1}}); b.enqueue(move({...request, path: [[1, 0, 0], [-1, 0, 0]]}));
    b.advance(1); b.advance(1); b.advance(1); expect(b.progress().completedCommands).toBe(1); expect(b.discard()).toBe(true); expect(s.snapshot()).toEqual(before); expect(() => b.lastTranslation()).toThrow();
  });
  test('held cells cannot translate or publish prior game costs', () => {
    const s = gameSession(), before = s.snapshot(), b = s.branch({horizonTicks: 0, translation: {}}); b.enqueue({kind: 'game', game: {...before.game, ap: 1}});
    b.enqueue({kind: 'hold', domain: null, request: {id: 'pin', cells: [[2, 2, 2]], expiresAtTick: 2}}); b.enqueue(move()); expect(() => finish(b)).toThrow(/release the reactive hold/); expect(s.snapshot()).toEqual(before);
  });
  test('final game validation and competing commits still govern publication', () => {
    const s = gameSession(), before = s.snapshot(), rejected = s.branch({horizonTicks: 0, translation: {}}); rejected.enqueue({kind: 'game', game: {...before.game, ap: -1}}); rejected.enqueue(move()); expect(() => finish(rejected)).toThrow(/policy/); expect(s.snapshot()).toEqual(before);
    const a = s.branch({horizonTicks: 0, translation: {}}), b = s.branch({horizonTicks: 0, translation: {}}); a.enqueue(move()); b.enqueue(move()); finish(a); finish(b); s.commit(a); expect(() => s.commit(b)).toThrow(/stale/);
  });
  test('repeated command staging accumulates charges across translations and physical ticks exactly', () => {
    const s = session(r, initial()), b = s.branch({horizonTicks: 1, translation: {}});
    let energyQ = s.snapshot().domains.world.block.energyQ[62];
    for (const amount of [256, 512, -128]) {energyQ += amount; b.enqueue({kind: 'edit', domain: null, edits: [{kind: 'energy', x: 2, y: 2, z: 2, energyQ}]}); b.enqueue({kind: 'game', game: {ap: 1, turn: 0, body: null}});}
    b.enqueue(move()); finish(b); s.commit(b); expect(s.energyBalance()).toMatchObject({externalQ: 640n, driftQ: 0n});
    const saved = JSON.parse(JSON.stringify(s.snapshot())); const restored = session(r, initial()); restored.restore(saved); expect(restored.energyBalance()).toEqual(s.energyBalance());
  });
  test('actor AP and material history publish atomically and resume through the next command and tick', () => {
    const s = gameSession([place(2, 2, 2, MAT.STONE, 100), {kind: 'integrity', x: 2, y: 2, z: 2, integrity: 73}]), before = s.snapshot(), b = s.branch({horizonTicks: 0, translation: {}});
    b.enqueue({kind: 'game', game: {...before.game, ap: 1}}); b.enqueue(move()); finish(b); expect(s.snapshot()).toEqual(before); s.commit(b);
    expect(s.snapshot().game).toMatchObject({ap: 1, body: {minQ: vec(3.25, 1.5, 2.25)}}); for (const key of ['packedCells', 'energyQ', 'structure'] as const) expect(s.snapshot().domains.world.block[key][63]).toBe(before.domains.world.block[key][62]);
    const resumed = session(r, initial(), policy); resumed.restore(JSON.parse(JSON.stringify(s.snapshot())));
    for (const owner of [s, resumed]) {const next = owner.branch({horizonTicks: 1, translation: {}}); next.enqueue(move({cells: [[3, 2, 2]], path: [[0, 0, 1]]})); finish(next); owner.commit(next);}
    expect(resumed.snapshot()).toEqual(s.snapshot()); expect(resumed.energyBalance()).toEqual(s.energyBalance()); expect(s.energyBalance().driftQ).toBe(0n);
  });
});
