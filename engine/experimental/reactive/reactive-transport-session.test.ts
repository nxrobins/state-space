import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Tiny executed transport transactions. Old M5/native/GPU workloads remain held. */
import { beforeAll, describe, expect, test, vi } from 'vitest';

import { createReactiveMaterialRegistry3D, defaultReactiveMaterialCatalog3D, createReactiveMaterialBlock3D as block, editReactiveMaterialBlock3D as edit, createReactiveWorldSnapshot3D as world, createConstrainedReactiveWorldSnapshot3D as heldWorld, createReactiveDomainsSnapshot3D as domains, createReactiveSession3D as session, createReactiveMaterialTransport3D as control, createReactiveMaterialTransportJob3D as job, applyReactiveMaterialTransport3D as plan, captureReactiveMaterialTransportMemory3D as capture, restoreReactiveMaterialTransportMemory3D as restore, followReactiveMaterialTransport3D as follow, createReactiveBody3D as body, createReactiveTransportDisplacement3D as displace, createReactiveTransportedActorGroup3D as group, createReactiveActorGroup3D as tickGroup, createReactiveTranslatedActorGroup3D as translatedGroup, MAT, GEOMETRY_SCALE_3D as Q, type ReactiveMaterialRegistry3D, type ReactiveMaterialEdit3D, type ReactiveMaterialParcelSeed3D, type ReactiveMaterialTransportMemory3D, type ReactiveSessionPolicy3D, type ReactiveBranch3D, type NamedReactiveBody3D, type ReactiveTransportCommand3D, type ReactiveActorGroupResult3D, type ReactiveHold3D } from '../reactive-materials.js';
holdPhysics('volumeStep', 'solveStructure3D', ...STRUCTURAL_CALLS);
let r: ReactiveMaterialRegistry3D;
beforeAll(async () => {const c = defaultReactiveMaterialCatalog3D(); for (const m of c.propertiesCatalog.materials) m.properties.conductivity = 0; r = await createReactiveMaterialRegistry3D(c);});
type V = [number, number, number];
type Game = {ap: number; controls: Record<string, ReactiveMaterialTransportMemory3D>; units: NamedReactiveBody3D[]};
type Context = Parameters<NonNullable<ReactiveSessionPolicy3D<Game>['reduceCommand']>>[0];
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const place = (cell: V = [1, 3, 2], material: number = MAT.SAND, thermal = 70): ReactiveMaterialEdit3D => ({kind: 'place', x: cell[0], y: cell[1], z: cell[2], material, thermal});
const seed = (cell: V = [1, 3, 2], velocityQ: V = [Q, 0, 0], id = 'p'): ReactiveMaterialParcelSeed3D => ({id, cell, velocityQ});
const command = (impulses?: ReactiveTransportCommand3D['impulses'], control = 'wind', domain: string | null = null): ReactiveTransportCommand3D => ({kind: 'transport', domain, control, ...(impulses ? {impulses} : {})});
const accepted = (out: ReactiveActorGroupResult3D) => {if (out.status !== 'resolved') throw Error('Actor transport rejected: ' + out.reason); return out.bodies;};
const policy: ReactiveSessionPolicy3D<Game> = {
  readTransport(c) {const m = c.game.controls[c.command.control]; if (!m) throw Error('Unknown control'); return m;},
  reduceCommand(c) {
    const out = c.transport();
    if (out) {
      if (c.game.ap < 1) throw Error('Insufficient AP');
      const controls = {...c.game.controls};
      for (const [name, memory] of Object.entries(controls)) if (memory.identity.domain === out.domain) controls[name] = name === out.control ? out.memory : follow(r, c.beforeQueries(out.domain), c.queries(out.domain), out.movement, memory).memory;
      const units = c.game.units.length ? accepted(group(c.beforeQueries(out.domain), c.queries(out.domain), out.movement).resolve(c.game.units)) : [];
      return {...c.game, ap: c.game.ap - 1, controls, units};
    }
    if (c.command.kind === 'translate') {
      const domain = c.command.domain, controls = {...c.game.controls};
      for (const [name, memory] of Object.entries(controls)) if (memory.identity.domain === domain) controls[name] = follow(r, c.beforeQueries(domain), c.queries(domain), c.translation()!, memory).memory;
      return {...c.game, controls, units: c.game.units.length ? accepted(translatedGroup(c.beforeQueries(domain), c.queries(domain), c.translation()!).resolve(c.game.units)) : []};
    }
    return c.game;
  },
  reduceTick(c) {
    const controls = {...c.game.controls};
    for (const [id, memory] of Object.entries(controls)) {const domain = memory.identity.domain; controls[id] = follow(r, c.beforeQueries(domain), c.queries(domain), c.movement(domain), memory).memory;}
    return {...c.game, controls, units: c.game.units.length ? accepted(tickGroup(c.beforeQueries(), c.queries(), c.movement()).resolve(c.game.units)) : []};
  },
};
function fixture(edits = [place()], seeds = [seed()], p = policy, size = {width: 5, height: 5, depth: 5}, tick = 0, holds?: ReactiveHold3D[]) {
  expect(size.width * size.height * size.depth).toBeLessThanOrEqual(125);
  const b = edit(r, block(r, size), edits).block, w = holds ? heldWorld(r, b, tick, holds) : world(r, b, tick);
  const initial = {worldId: 'transport-ability', gameRulesVersion: 'ability-1', domains: domains(r, w), game: {ap: 8, controls: {}, units: []} as Game};
  const view = session(r, initial).queries(); initial.game.controls.wind = capture(r, control(r, view, seeds));
  return {initial, s: session(r, initial, p), state: restore(r, view, initial.game.controls.wind)};
}
function finish(b: ReactiveBranch3D<Game>, work = 7) {let n = 0; while (['preparing', 'running'].includes(b.progress().status)) {if (++n > 6000) throw Error('Tiny branch work limit'); b.advance(work);} return b;}
function finishJob(j: ReturnType<typeof job>) {let n = 0; while (j.progress().status === 'running') {if (++n > 5) throw Error('Tiny job bound'); j.advance();} const out = j.result(); expect(out.receipt.swaps.length).toBeLessThanOrEqual(8); return out;}
function observed(edits = [place()], seeds = [seed()], options: Parameters<ReturnType<typeof session<Game>>['branch']>[0] = {horizonTicks: 0, transport: {}}) {
  let context!: Context; const f = fixture(edits, seeds, {...policy, reduceCommand(c) {context = c; return policy.reduceCommand!(c);}});
  const branch = f.s.branch(options); branch.enqueue(command()); finish(branch);
  return {...f, branch, context, before: context.beforeQueries(), after: context.queries(), movement: context.transport()!.movement};
}
function withRider(extra: ReactiveMaterialEdit3D[] = [], peer = false) {
  const f = fixture([place(undefined, MAT.STONE), {kind: 'integrity', x: 1, y: 3, z: 2, integrity: 0}, ...extra]);
  const view = f.s.queries(); f.initial.game.units = [{id: 'a', body: body(view, {minQ: [1.25 * Q, 2.5 * Q, 2.25 * Q], sizeQ: [Q / 2, Q / 2, Q / 2], gravityQ: 0})}];
  if (peer) f.initial.game.units.push({id: 'b', body: body(view, {minQ: [2.25 * Q, 2.25 * Q, 2.25 * Q], sizeQ: [Q / 2, Q / 2, Q / 2], gravityQ: 0})});
  return {...f, s: session(r, f.initial, policy)};
}

describe('bounded transport execution', () => {
  test('one parcel advances per call and publication is a separate boundary', () => {
    const f = fixture([place(), place([3, 3, 2])], [seed(), seed([3, 3, 2], [Q, 0, 0], 'z')]), j = job(r, f.state);
    expect(j.progress()).toEqual({status: 'running', phase: 'parcels', completedParcels: 0, totalParcels: 2});
    expect(j.advance().completedParcels).toBe(1); expect(() => j.result()).toThrow(); expect(j.advance().phase).toBe('publish'); expect(() => j.result()).toThrow();
    expect(j.advance().status).toBe('complete'); expect(j.result()).toEqual(plan(r, f.state));
  });
  test('cancellation at every incomplete boundary preserves the complete source', () => {
    const f = fixture([place(), place([3, 3, 2])], [seed(), seed([3, 3, 2], [Q, 0, 0], 'z')]), before = copy(f.state);
    for (let advances = 0; advances < 3; advances++) {const j = job(r, f.state); for (let i = 0; i < advances; i++) j.advance(); expect(j.cancel()).toBe(true); expect(j.cancel()).toBe(false); expect(() => j.advance()).toThrow(); expect(() => j.result()).toThrow(); expect(f.state).toEqual(before);}
  });
  test('inputs impulses progress and results cannot mutate an owned job', () => {
    const f = fixture(), s = copy(f.state), impulses = [{id: 'p', impulseQ: [1, 0, 0] as V}], expected = plan(r, s, impulses), j = job(r, s, impulses);
    s.parcels[0].velocityQ[0] = 0; s.world.block.energyQ[0] = 0; impulses[0].impulseQ[0] = 9; j.progress().completedParcels = 10;
    expect(finishJob(j)).toEqual(expected); const out = j.result(); out.receipt.swaps.length = 0; out.state.parcels.length = 0; expect(j.result()).toEqual(expected); expect(j.cancel()).toBe(false); expect(() => j.advance()).toThrow();
  });
  test('empty and fractional cycles still validate and publish once', () => {
    const f = fixture([], []), j = job(r, f.state); expect(j.progress().phase).toBe('publish'); expect(j.advance().status).toBe('complete'); expect(j.result().state.cycle).toBe(1);
    const slow = fixture(undefined, [seed(undefined, [400, -7, 9])]), out = finishJob(job(r, slow.state)); expect(out.receipt.swaps).toEqual([]); expect(out.state.parcels[0].remainderQ).toEqual([400, -7, 9]);
  });
  test('all axes signs and combined motion match the frozen planner', () => {
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {const v: V = [0, 0, 0]; v[axis] = sign * Q; const f = fixture([place([2, 2, 2])], [seed([2, 2, 2], v)]); expect(finishJob(job(r, f.state))).toEqual(plan(r, f.state));}
    const f = fixture([place([2, 2, 2])], [seed([2, 2, 2], [2 * Q, 2 * Q, 2 * Q])]); expect(finishJob(job(r, f.state)).receipt.swaps).toHaveLength(6);
  });
  test('invalid complete state and late impulses reject before a job escapes', () => {
    const f = fixture(), before = copy(f.state); expect(() => job(r, f.state, [{id: 'p', impulseQ: [1, 0, 0]}, {id: 'missing', impulseQ: [0, 0, 0]}])).toThrow();
    const bad = copy(f.state); bad.world.block.structure[66] = 255; expect(() => job(r, bad)).toThrow(); expect(f.state).toEqual(before);
  });
});

describe('atomic named transport commands', () => {
  test('preview publishes only a complete command and commit does not resimulate', () => {
    const selector = vi.fn(policy.readTransport!), reducer = vi.fn(policy.reduceCommand!), f = fixture(undefined, undefined, {...policy, readTransport: selector, reduceCommand: reducer}), before = f.s.snapshot(), b = f.s.branch({horizonTicks: 0, transport: {}});
    b.enqueue(command()); for (let i = 0; i < 2; i++) {b.advance(); expect(b.inspect().state.domains).toEqual(before.domains); expect(b.inspect().state.game).toEqual(before.game); expect(b.lastTransport()).toBeNull();}
    b.advance(); expect(b.progress().completedCommands).toBe(1); const predicted = plan(r, f.state);
    expect(b.inspect().state.domains.world).toEqual(predicted.state.world); expect(b.inspect().state.game.controls.wind).toEqual(capture(r, predicted.state)); expect(b.inspect().state.game.ap).toBe(7); expect(f.s.snapshot()).toEqual(before);
    finish(b); const preview = b.inspect().state; expect(f.s.commit(b).snapshot).toEqual({...preview, revision: 1}); expect(selector).toHaveBeenCalledTimes(1); expect(reducer).toHaveBeenCalledTimes(1); expect(f.s.energyBalance().driftQ).toBe(0n);
  });
  test('chained fractional commands select the updated staged control each time', () => {
    const cycles: number[] = [], f = fixture(undefined, [seed(undefined, [400, 0, 0])], {...policy, readTransport(c) {const m = policy.readTransport!(c); cycles.push(m.cycle); return m;}}), b = f.s.branch({horizonTicks: 0, transport: {}});
    for (let i = 0; i < 3; i++) b.enqueue(command()); finish(b); f.s.commit(b);
    expect(cycles).toEqual([0, 1, 2]); expect(f.s.snapshot().game.controls.wind.parcels[0]).toMatchObject({cell: 67, remainderQ: [176, 0, 0]}); expect(f.s.snapshot().game.ap).toBe(5);
  });
  test('impulses are applied once to current memory and survive a later command', () => {
    const f = fixture(undefined, [seed(undefined, [0, 0, 0])]), b = f.s.branch({horizonTicks: 0}); b.enqueue(command([{id: 'p', impulseQ: [Q, 0, 0]}])); b.enqueue(command()); finish(b);
    expect(b.inspect().state.game.controls.wind.parcels[0]).toMatchObject({cell: 68, velocityQ: [Q, 0, 0]}); expect(b.inspect().state.game.controls.wind.cycle).toBe(2);
  });
  test('preceding translation updates control before transport reads it', () => {
    const f = fixture(), b = f.s.branch({horizonTicks: 0, translation: {}, transport: {}}); b.enqueue({kind: 'translate', domain: null, request: {cells: [[1, 3, 2]], path: [[0, 0, 1]]}}); b.enqueue(command()); finish(b);
    expect(b.inspect().state.game.controls.wind.parcels[0].cell).toBe(92); expect(b.inspect().state.game.controls.wind.cycle).toBe(1);
  });
  test('all required application hooks are explicit and missing hooks fail closed', () => {
    for (const p of [{}, {readTransport: policy.readTransport}, {reduceCommand: policy.reduceCommand}]) {const f = fixture(undefined, undefined, p), before = f.s.snapshot(), b = f.s.branch({horizonTicks: 0}); b.enqueue(command()); expect(() => finish(b)).toThrow(/selector/); expect(f.s.snapshot()).toEqual(before);}
  });
  test('a prior game command can acquire control used by the next command', () => {
    const f = fixture(), acquired = copy(f.initial.game), empty = {...f.initial, game: {...acquired, controls: {}}}, s = session(r, empty, policy), b = s.branch({horizonTicks: 0});
    b.enqueue({kind: 'game', game: acquired}); b.enqueue(command()); finish(b); expect(s.commit(b).snapshot.game.controls.wind.cycle).toBe(1);
  });
  test('selector input and command mutation cannot overwrite staged AP or impulses', () => {
    const f = fixture(undefined, [seed(undefined, [0, 0, 0])], {...policy, readTransport(c) {c.game.ap = 999; if (c.command.impulses) (c.command.impulses[0].impulseQ as V)[0] = 0; return policy.readTransport!(c);}}), b = f.s.branch({horizonTicks: 0});
    const request = command([{id: 'p', impulseQ: [Q, 0, 0]}]); b.enqueue(request); (request.impulses![0].impulseQ as V)[0] = 0; finish(b);
    expect(b.inspect().state.game.ap).toBe(7); expect(b.inspect().state.game.controls.wind.parcels[0].cell).toBe(67);
  });
  test('malformed stale and foreign memory roll back prior AP and energy changes', () => {
    for (const alter of [(m: ReactiveMaterialTransportMemory3D) => {m.parcels[0].energyQ++;}, (m: ReactiveMaterialTransportMemory3D) => {m.identity.worldId += 'x';}, (m: ReactiveMaterialTransportMemory3D) => {m.identity.tick++;}]) {
      const f = fixture(undefined, undefined, {...policy, readTransport(c) {const m = policy.readTransport!(c); alter(m); return m;}}), before = f.s.snapshot(), b = f.s.branch({horizonTicks: 0});
      b.enqueue({kind: 'game', game: {...before.game, ap: 2}}); b.enqueue({kind: 'edit', domain: null, edits: [{kind: 'energy', x: 0, y: 0, z: 0, energyQ: 999}]}); b.enqueue(command()); expect(() => finish(b)).toThrow(); expect(f.s.snapshot()).toEqual(before);
    }
  });
  test('late invalid impulse rolls back an earlier completed transport', () => {
    const f = fixture(), before = f.s.snapshot(), b = f.s.branch({horizonTicks: 0}); b.enqueue(command()); b.enqueue(command([{id: 'missing', impulseQ: [Q, 0, 0]}]));
    expect(() => finish(b)).toThrow(/Unknown/); expect(b.progress().status).toBe('failed'); expect(f.s.snapshot()).toEqual(before);
  });
  test('insufficient AP rejects after physical staging without publishing any prefix', () => {
    const f = fixture(), initial = {...f.initial, game: {...f.initial.game, ap: 1}}, s = session(r, initial, policy), before = s.snapshot(), b = s.branch({horizonTicks: 0}); b.enqueue(command()); b.enqueue(command());
    expect(() => finish(b)).toThrow(/AP/); expect(s.snapshot()).toEqual(before);
  });
  test('invalid game and async selector or reducer leave the committed world untouched', () => {
    const badPolicies: ReactiveSessionPolicy3D<Game>[] = [
      {...policy, readTransport: (() => Promise.resolve(null)) as never}, {...policy, reduceCommand: (() => Promise.resolve(null)) as never},
      {...policy, reduceCommand: (() => ({bad: Infinity})) as never}, {...policy, readTransport: (() => null) as never}];
    for (const p of badPolicies) {const f = fixture(undefined, undefined, p), before = f.s.snapshot(), b = f.s.branch({horizonTicks: 0}); b.enqueue(command()); expect(() => finish(b)).toThrow(); expect(f.s.snapshot()).toEqual(before);}
  });
  test('swallowed selector and reducer reentry poison the entire mutation', () => {
    for (const stage of ['selector', 'reducer']) {
      let s: ReturnType<typeof session<Game>>; const p = {...policy};
      if (stage === 'selector') p.readTransport = c => {try {s.branch({horizonTicks: 0});} catch {} return policy.readTransport!(c);};
      else p.reduceCommand = c => {try {s.restore(s.snapshot());} catch {} return policy.reduceCommand!(c);};
      const f = fixture(undefined, undefined, p); s = f.s; const before = s.snapshot(), b = s.branch({horizonTicks: 0}); b.enqueue(command()); expect(() => finish(b)).toThrow(/reentry/); expect(s.snapshot()).toEqual(before);
    }
  });
  test('policy accessor and malformed command fields reject without invoking getters', () => {
    const f = fixture(), getter = vi.fn(() => policy.readTransport), p = {...policy}; Object.defineProperty(p, 'readTransport', {get: getter, enumerable: true}); expect(() => session(r, f.initial, p)).toThrow();
    for (const patch of [{control: null}, {domain: false}, {control: ''}, {extra: 1}]) {const b = f.s.branch({horizonTicks: 0}); expect(() => b.enqueue({...command(), ...patch} as never)).toThrow();}
    expect(getter).not.toHaveBeenCalled();
  });
  test('cancelling each partial command discards physical and game changes', () => {
    for (let advances = 0; advances < 3; advances++) {const f = fixture(), before = f.s.snapshot(), b = f.s.branch({horizonTicks: 0}); b.enqueue(command()); for (let i = 0; i < advances; i++) b.advance(); expect(b.discard()).toBe(true); expect(f.s.snapshot()).toEqual(before); expect(() => b.inspect()).toThrow();}
  });
  test('a competing commit or restore invalidates a partial transport', () => {
    for (const mode of ['commit', 'restore']) {const f = fixture(), b = f.s.branch({horizonTicks: 0}); b.enqueue(command()); b.advance(); b.advance(); if (mode === 'commit') f.s.commit(finish(f.s.branch({horizonTicks: 0}))); else f.s.restore(f.s.snapshot()); const before = f.s.snapshot(); expect(() => b.advance()).toThrow(/stale/); expect(f.s.snapshot()).toEqual(before);}
  });
  test('invalid work leaves preparation open and commands seal on first advance', () => {
    const f = fixture(), b = f.s.branch({horizonTicks: 0}); b.enqueue(command()); expect(() => b.advance(0)).toThrow(); expect(b.progress().status).toBe('preparing'); b.advance(); expect(() => b.enqueue(command())).toThrow(/sealed/); finish(b); expect(b.progress().status).toBe('ready');
  });
  test('new holds reject remembered loose debris instead of silently releasing it', () => {
    const f = fixture([place(undefined, MAT.STONE), {kind: 'integrity', x: 1, y: 3, z: 2, integrity: 0}]), before = f.s.snapshot(), b = f.s.branch({horizonTicks: 0});
    b.enqueue({kind: 'hold', domain: null, request: {id: 'hold', cells: [[1, 3, 2]], expiresAtTick: 2}}); b.enqueue(command()); expect(() => finish(b)).toThrow(); expect(f.s.snapshot()).toEqual(before);
  });
  test('accounted heat survives repeated transport staging and a complete tick', () => {
    const f = fixture([place([0, 0, 0], MAT.SMOKE)], [seed([0, 0, 0], [Q, 0, 0])], policy, {width: 3, height: 1, depth: 1}), before = f.s.energyBalance(), b = f.s.branch({horizonTicks: 1, transport: {}, motion: {}});
    b.enqueue({kind: 'edit', domain: null, edits: [{kind: 'energy', x: 2, y: 0, z: 0, energyQ: 999}]}); b.enqueue(command()); b.enqueue(command()); finish(b); f.s.commit(b);
    expect(f.s.energyBalance().externalQ).toBe(999n - BigInt(f.initial.domains.world.block.energyQ[2])); expect(f.s.energyBalance().initialQ).toBe(before.initialQ); expect(f.s.energyBalance().driftQ).toBe(0n);
  });
  test('reservoir controls use their own domain without touching the primary world', () => {
    const f = fixture(), initial = {...f.initial, domains: domains(r, f.initial.domains.world, [{id: 'bottle', world: f.initial.domains.world}])}, temporary = session(r, initial);
    initial.game.controls = {bottle: capture(r, control(r, temporary.queries('bottle'), [seed()]))}; const s = session(r, initial, policy), b = s.branch({horizonTicks: 0}); b.enqueue(command(undefined, 'bottle', 'bottle')); finish(b); s.commit(b);
    expect(s.snapshot().domains.world).toEqual(initial.domains.world); expect(s.snapshot().domains.reservoirs[0].world.block.packedCells[67] & 255).toBe(MAT.SAND); expect(s.energyBalance().driftQ).toBe(0n);
  });
  test('an unknown control or wrong domain never silently acquires or reseeds it', () => {
    for (const request of [command(undefined, 'missing'), command(undefined, 'wind', 'missing')]) {const f = fixture(), before = f.s.snapshot(), b = f.s.branch({horizonTicks: 0}); b.enqueue(request); expect(() => finish(b)).toThrow(); expect(f.s.snapshot()).toEqual(before);}
  });
});

describe('executed transport paths and actor consequences', () => {
  test('capture reconstructs every cell tuple and original identity in canonical swap order', () => {
    const f = observed([place([2, 2, 2])], [seed([2, 2, 2], [2 * Q, Q, Q])]), paths = f.movement.paths, before = f.initial.domains.world.block, after = f.branch.inspect().state.domains.world.block;
    expect(paths).toMatchObject({status: 'complete', entries: 16, stepsObserved: 4}); const origins = before.packedCells.map((_, i) => i);
    for (const pass of paths.passes) {expect(pass.controlledSources).toEqual([62]); expect(pass.segments).toHaveLength(2); for (const s of pass.segments) expect(origins[s.from]).toBe(s.origin); for (const s of pass.segments) origins[s.to] = s.origin;}
    for (const key of ['packedCells', 'energyQ', 'structure'] as const) expect(after[key]).toEqual(origins.map(i => before[key][i]));
  });
  test('identical gas swaps stay observable and unrelated controllers follow without an extra cycle', () => {
    const f = fixture([place(undefined, MAT.SMOKE), place([2, 3, 2], MAT.SMOKE)]), initial = copy(f.initial);
    initial.game.controls.other = capture(r, control(r, f.s.queries(), [seed([2, 3, 2], [7, 0, 0], 'other')])); initial.game.controls.other.cycle = 4;
    const s = session(r, initial, policy), b = s.branch({horizonTicks: 0, transport: {}}); b.enqueue(command()); finish(b);
    expect(b.inspect().state.domains).toEqual(initial.domains); expect(b.lastTransport()!.receipt.editedCells).toEqual([]); expect(b.lastTransport()!.movement.paths.stepsObserved).toBe(1);
    expect(b.inspect().state.game.controls.other).toMatchObject({cycle: 4, parcels: [{cell: 66, velocityQ: [7, 0, 0]}]});
  });
  test('disabled and overflowed capture cannot change physical or control results', () => {
    const results = [];
    for (const transport of [undefined, {maxEntries: 3}, {maxEntries: 4}]) {const f = fixture(), b = f.s.branch({horizonTicks: 0, ...(transport ? {transport} : {})}); b.enqueue(command()); finish(b); const out = b.lastTransport()!; expect(out.movement.paths.status).toBe(!transport ? 'disabled' : transport.maxEntries < 4 ? 'overflow' : 'complete'); if (out.movement.paths.status !== 'complete') expect(out.movement.paths.passes).toEqual([]); results.push(b.inspect().state);}
    expect(results[0]).toEqual(results[1]); expect(results[1]).toEqual(results[2]);
  });
  test('empty motion can be completely captured with zero entries', () => {
    const f = observed(undefined, [seed(undefined, [1, 0, 0])], {horizonTicks: 0, transport: {maxEntries: 0}}); expect(f.movement.paths).toMatchObject({status: 'complete', entries: 0, passes: [], stepsObserved: 0});
  });
  test('public mutation and serialized lookalikes cannot forge executed transport', () => {
    const f = observed(), m = f.initial.game.controls.wind, expected = follow(r, f.before, f.after, f.movement, m);
    f.movement.paths.passes.length = 0; expect(follow(r, f.before, f.after, f.movement, m)).toEqual(expected);
    expect(() => follow(r, f.before, f.after, copy(f.movement), m)).toThrow(/live/); expect(() => follow(r, f.after, f.before, f.movement, m)).toThrow(/boundaries/);
    expect(() => group(f.s.queries(), f.after, f.movement)).toThrow(/boundaries/);
  });
  test('retained receipts views and movement remain historical after commit and restore', () => {
    const f = observed(), out = f.branch.lastTransport()!, m = f.initial.game.controls.wind, expected = follow(r, f.before, f.after, out.movement, m);
    out.memory.parcels.length = 0; out.receipt.swaps.length = 0; expect(f.branch.lastTransport()!.memory.parcels).toHaveLength(1);
    f.s.commit(f.branch); f.s.restore(f.s.snapshot()); expect(follow(r, f.before, f.after, out.movement, m)).toEqual(expected);
  });
  test('latest transport access clears at the next command or physical tick', () => {
    for (const tick of [false, true]) {const f = fixture(), b = f.s.branch({horizonTicks: tick ? 1 : 0, transport: {}, motion: {}}); b.enqueue(command()); if (!tick) b.enqueue({kind: 'game', game: f.initial.game}); while (b.progress().completedCommands < 1) b.advance(); expect(b.lastTransport()).not.toBeNull(); finish(b); expect(b.lastTransport()).toBeNull();}
  });
  test('moving failed debris carries a grounded actor and publishes actor AP and terrain together', () => {
    const f = withRider(), before = f.s.snapshot(), b = f.s.branch({horizonTicks: 0, transport: {}}); b.enqueue(command()); finish(b);
    expect(b.inspect().state.game.units[0].body.minQ[0]).toBe(2.25 * Q); expect(f.s.snapshot()).toEqual(before); f.s.commit(b);
    expect(f.s.snapshot().game.ap).toBe(7); expect(f.s.snapshot().game.units[0].body.step).toBe(0); expect(f.s.snapshot().domains.world.block.structure[67]).toBe(0);
  });
  test('carry and pushes use exact fractional geometry on all axes and signs', () => {
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
      const v: V = [0, 0, 0]; v[axis] = sign * Q; const f = observed([place([2, 2, 2])], [seed([2, 2, 2], v)]);
      const actor = body(f.before, {minQ: [2.25 * Q, 1.5 * Q, 2.25 * Q], sizeQ: [Q / 2, Q / 2, Q / 2], gravityQ: 0}), out = displace(f.before, f.after, f.movement).resolve(actor);
      expect(out.status).toBe('resolved'); expect(out.movedQ).toEqual(v); expect(out.carries[0].requestedQ).toEqual(v); expect(out.body.step).toBe(0);
    }
  });
  test('a stationary controlled support cannot hitchhike on another parcel motion', () => {
    const f = observed([place(), place([3, 3, 2])], [seed(), seed([3, 3, 2], [0, 0, 0], 'z')]);
    const actor = body(f.before, {minQ: [1.25 * Q, 2.5 * Q, 2.25 * Q], sizeQ: [2.5 * Q, Q / 2, Q / 2], gravityQ: 0}), out = displace(f.before, f.after, f.movement).resolve(actor);
    expect(out.status).toBe('resolved'); expect(out.movedQ).toEqual([0, 0, 0]); expect(out.carries).toEqual([]);
  });
  test('stationary terrain clips carry and opposed constraints reject a crush', () => {
    const f = observed([place(), place([2, 2, 2], MAT.STONE)]), actor = body(f.before, {minQ: [1.25 * Q, 1.5 * Q, 2.25 * Q], sizeQ: [Q / 2, 1.5 * Q, Q / 2], gravityQ: 0});
    expect(displace(f.before, f.after, f.movement).resolve(actor).movedQ[0]).toBe(Q / 4);
    const g = observed([place([2, 3, 2]), place([2, 1, 2], MAT.STONE)], [seed([2, 3, 2], [0, -Q, 0])]), trapped = body(g.before, {minQ: [2.25 * Q, 2 * Q, 2.25 * Q], sizeQ: [Q / 2, Q, Q / 2], gravityQ: 0});
    expect(displace(g.before, g.after, g.movement).resolve(trapped)).toMatchObject({status: 'crushed', body: trapped});
  });
  test('an exact intermediate peer contact rejects all prior game and heat commands', () => {
    const f = withRider([], true), before = f.s.snapshot(), b = f.s.branch({horizonTicks: 0, transport: {}}); b.enqueue({kind: 'edit', domain: null, edits: [{kind: 'energy', x: 0, y: 0, z: 0, energyQ: 999}]}); b.enqueue(command());
    expect(() => finish(b)).toThrow(/peer-contact/); expect(f.s.snapshot()).toEqual(before);
    const o = observed([place(undefined, MAT.STONE), {kind: 'integrity', x: 1, y: 3, z: 2, integrity: 0}]);
    const out = group(o.before, o.after, o.movement).resolve(f.initial.game.units); expect(out.peerContact).toMatchObject({pass: 0, time: {numerator: 1, denominator: 2}}); expect(out.bodies).toEqual(f.initial.game.units);
  });
  test('response budgets return the whole original group and clear incomplete details', () => {
    const f = observed(), actor = body(f.before, {minQ: [1.25 * Q, 2.5 * Q, 2.25 * Q], sizeQ: [Q / 2, Q / 2, Q / 2]}), actors = [{id: 'a', body: actor}], solver = group(f.before, f.after, f.movement);
    for (const options of [{maxCarryEntries: 0}, {maxWork: 0}]) expect(solver.resolve(actors, options)).toMatchObject({status: 'incomplete', bodies: actors, responses: [], requiresReexecution: true});
    // Carry itself is not a collision event; a swept push does consume an event.
    expect(solver.resolve(actors, {maxEvents: 0}).status).toBe('resolved');
    const pushed = [{id: 'p', body: body(f.before, {minQ: [2.25 * Q, 3.25 * Q, 2.25 * Q], sizeQ: [Q / 2, Q / 2, Q / 2]})}];
    expect(solver.resolve(pushed, {maxEvents: 0})).toMatchObject({status: 'incomplete', bodies: pushed, responses: [], requiresReexecution: true});
  });
  test('missing capture with actors rejects the whole transport ability', () => {
    for (const transport of [undefined, {maxEntries: 0}]) {const f = withRider(), before = f.s.snapshot(), b = f.s.branch({horizonTicks: 0, ...(transport ? {transport} : {})}); b.enqueue(command()); expect(() => finish(b)).toThrow(/rejected/); expect(f.s.snapshot()).toEqual(before);}
  });
  test('saved actor control and accounting continue exactly after an odd-tick restart', () => {
    const f = fixture([place([1, 1, 0])], [seed([1, 1, 0], [Q, 0, 0])], policy, {width: 5, height: 2, depth: 1}, 3);
    const view = f.s.queries(); f.initial.game.units = [{id: 'rider', body: body(view, {minQ: [1.25 * Q, Q / 2, Q / 4], sizeQ: [Q / 2, Q / 2, Q / 2], gravityQ: 0})}];
    const a = session(r, f.initial, policy), first = a.branch({horizonTicks: 1, transport: {}, motion: {}}); first.enqueue(command()); finish(first); a.commit(first);
    const b = session(r, f.initial, policy); b.restore(copy(a.snapshot())); const out = [];
    for (const owner of [a, b]) {const next = owner.branch({horizonTicks: 1, transport: {}, motion: {}}); next.enqueue(command()); finish(next); out.push(owner.commit(next));}
    expect(out[0]).toEqual(out[1]); expect(a.energyBalance().driftQ).toBe(0n); expect(a.snapshot().game.controls.wind.cycle).toBe(2); expect(a.snapshot().game.controls.wind.identity.tick).toBe(5);
  });
});
