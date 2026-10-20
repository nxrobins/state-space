/** Mock ports execute tiny reactive jobs; no native Worker/browser/GPU is launched. */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { CpuVolume } from './3d-core.js';
import { CpuStructuralWorld3D } from './structural-world-core.js';
import * as mechanics from './structural-mechanics.js';
import { createReactiveMaterialRegistry3D, defaultReactiveMaterialCatalog3D, createReactiveMaterialBlock3D, editReactiveMaterialBlock3D,
  createReactiveWorldSnapshot3D, createReactiveDomainsSnapshot3D, createReactiveSession3D, createReactiveMaterialTransport3D,
  captureReactiveMaterialTransportMemory3D, followReactiveMaterialTransport3D, createReactiveBody3D, createReactiveTransportedActorGroup3D,
  createReactiveActorGroup3D, createReactiveWorkerHost3D, createReactiveWorkerClient3D, reactiveBrowserWorkerTransport3D,
  MAT, type ReactiveMaterialRegistry3D, type ReactiveSessionPolicy3D, type ReactiveSessionCommand3D, type ReactiveSessionInitial3D,
  type ReactiveMaterialTransportMemory3D, type NamedReactiveBody3D, type ReactiveWorkerTransport3D, type ReactiveWorkerClientOptions3D } from './reactive-materials.js';
import { workerMessage, REACTIVE_WORKER_PROTOCOL_3D, type ReactiveWorkerWire3D } from './reactive-worker-wire.js';
const guards = [vi.spyOn(CpuVolume.prototype, 'step'), vi.spyOn(mechanics, 'solveStructure3D'),
  ...(['step', 'stepWithMotion', 'stepWithMotionPaths', 'inspectStructure'] as const).map(k => vi.spyOn(CpuStructuralWorld3D.prototype, k))];
for (const g of guards) g.mockImplementation(() => {throw Error('Old runtime held.');});
afterAll(() => {for (const g of guards) {expect(g).not.toHaveBeenCalled(); g.mockRestore();}});
let registry: ReactiveMaterialRegistry3D;
beforeAll(async () => {const catalog = defaultReactiveMaterialCatalog3D(); for (const m of catalog.propertiesCatalog.materials) m.properties.conductivity = 0;
  registry = await createReactiveMaterialRegistry3D(catalog);});
type Game = {ap: number; label: string; memory: ReactiveMaterialTransportMemory3D; units: NamedReactiveBody3D[]};
const command: ReactiveSessionCommand3D<Game> = {kind: 'transport', domain: null, control: 'wind'};
const options = {horizonTicks: 1, transport: {}, motion: {}};
const accept = (r: ReturnType<ReturnType<typeof createReactiveActorGroup3D>['resolve']>) => {if (r.status !== 'resolved') throw Error(r.reason ?? 'Unresolved actors'); return r.bodies;};
const policy: ReactiveSessionPolicy3D<Game> = {readTransport: c => c.game.memory, reduceCommand(c) {
  const t = c.transport(); if (!t) return c.game; if (c.game.ap < 1) throw Error('No AP');
  return {...c.game, ap: c.game.ap - 1, memory: t.memory, units: accept(createReactiveTransportedActorGroup3D(c.beforeQueries(), c.queries(), t.movement).resolve(c.game.units))};
}, reduceTick(c) {return {...c.game, memory: followReactiveMaterialTransport3D(registry, c.beforeQueries(), c.queries(), c.movement(), c.game.memory).memory,
  units: accept(createReactiveActorGroup3D(c.beforeQueries(), c.queries(), c.movement()).resolve(c.game.units))};}};
function initial(): ReactiveSessionInitial3D<Game> {
  const block = editReactiveMaterialBlock3D(registry, createReactiveMaterialBlock3D(registry, {width: 5, height: 2, depth: 1}),
    [{kind: 'place', x: 0, y: 1, z: 0, material: MAT.SAND, thermal: 70}]).block;
  const domains = createReactiveDomainsSnapshot3D(registry, createReactiveWorldSnapshot3D(registry, block, 3));
  const stub = createReactiveSession3D(registry, {worldId: 'worker-world', gameRulesVersion: 'worker-game-1', domains, game: null});
  const view = stub.queries(), memory = captureReactiveMaterialTransportMemory3D(registry, createReactiveMaterialTransport3D(registry, view, [{id: 'p', cell: [0, 1, 0], velocityQ: [1024, 0, 0]}]));
  return {worldId: 'worker-world', gameRulesVersion: 'worker-game-1', domains,
    game: {ap: 4, label: 'original', memory, units: [{id: 'rider', body: createReactiveBody3D(view, {minQ: [256, 512, 256], sizeQ: [512, 512, 512], gravityQ: 0})}]}};
}
function bus() {
  const tasks: {kind: string; run(): void}[] = [], sent: ReactiveWorkerWire3D[][] = [[], []];
  const receive: ((v: unknown) => void)[] = [() => {}, () => {}], errors: ((e: Error) => void)[] = [() => {}, () => {}];
  const closed = [false, false], removed = [false, false]; let inFlight = 0, maximum = 0;
  const config = {mapReply: (m: ReactiveWorkerWire3D): ReactiveWorkerWire3D | null => m, sendFailure: '', scheduleFailure: false};
  const ports = [0, 1].map(side => ({send(value: unknown) {
    const m = structuredClone(value) as ReactiveWorkerWire3D; if (closed[side] || config.sendFailure === m.kind) throw Error('Mock send failed'); sent[side].push(m);
    if (side === 0) {inFlight++; maximum = Math.max(maximum, inFlight);}
    const output = side ? config.mapReply(m) : m; if (!output) return;
    tasks.push({kind: side ? 'reply' : 'host', run() {if (side) inFlight--; receive[1 - side](structuredClone(output));}});
  }, subscribe(next: (v: unknown) => void, failed: (e: Error) => void) {receive[side] = next; errors[side] = failed; return () => {removed[side] = true; receive[side] = () => {};};},
  close() {closed[side] = true;}} satisfies ReactiveWorkerTransport3D));
  const schedule = (task: () => void) => {if (config.scheduleFailure) throw Error('Scheduler failed'); let cancelled = false;
    tasks.push({kind: 'slice', run() {if (!cancelled) task();}}); return () => {cancelled = true;};};
  const until = async (done: () => boolean) => {for (let n = 0; n < 4096; n++) {if (done()) return; const task = tasks.shift();
    if (task) task.run(); await Promise.resolve(); if (!task && !done()) throw Error('Mock transport stalled');} throw Error('Mock slice limit');};
  const settle = async <T>(p: Promise<T>): Promise<T> => {let done = false, value!: T, error: unknown; p.then(v => {value = v; done = true;}, e => {error = e; done = true;});
    await until(() => done); if (error) throw error; return value;};
  return {ports, tasks, sent, closed, removed, config, schedule, until, settle, receive, errors, maximum: () => maximum};
}
const resources: (() => void)[] = [];
afterEach(() => {for (const cleanup of resources.splice(0)) cleanup(); vi.useRealTimers();});
function fixture(p = policy, init = initial(), clientOptions: Partial<ReactiveWorkerClientOptions3D> = {}, work = 64) {
  const b = bus(), host = createReactiveWorkerHost3D(b.ports[1], registry, init, p, {channel: 'test', work});
  const client = createReactiveWorkerClient3D<Game>(b.ports[0], registry, {channel: 'test', worldId: init.worldId, gameRulesVersion: init.gameRulesVersion, schedule: b.schedule, ...clientOptions});
  resources.push(() => {b.errors[0](Error('Test cleanup')); host.close();}); return {b, host, client, init};
}
async function ready(f: ReturnType<typeof fixture>) {await f.b.settle(f.client.ready); return f;}
async function done(f: ReturnType<typeof fixture>) {await f.b.settle(f.client.close()); expect(f.b.closed).toEqual([true, true]); expect(f.b.removed).toEqual([true, true]);}
function direct(init: ReactiveSessionInitial3D<Game>, commands: ReactiveSessionCommand3D<Game>[], ticks = 1) {
  const s = createReactiveSession3D(registry, init, policy), branch = s.branch({...options, horizonTicks: ticks});
  for (const c of commands) branch.enqueue(c); for (let n = 0; branch.progress().status !== 'ready'; n++) {if (n > 4096) throw Error('Direct slice limit'); branch.advance();}
  return {s, branch, preview: branch.inspect()};
}
describe('bounded reactive worker authority', () => {
  test('handshake publishes an isolated catalog-bound save without executing physics', async () => {
    const f = await ready(fixture()); const expected = createReactiveSession3D(registry, f.init, policy).snapshot(); expect(f.client.snapshot()).toEqual(expected);
    const s = f.client.snapshot(); s.game.ap = 99; s.domains.world.block.energyQ[0] = 0; expect(f.client.snapshot()).toEqual(expected);
    expect(f.b.sent[0].map(m => m.kind)).toEqual(['hello']); await done(f);
  });
  test('transport tick actor and accounting match a direct session exactly', async () => {
    const f = await ready(fixture()), before = f.client.snapshot(), d = direct(f.init, [command]);
    const ticket = f.client.request([command], options), result = await f.b.settle(ticket.result); expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw Error('Expected ready'); expect(result.preview).toEqual(d.preview); expect(f.client.snapshot()).toEqual(before);
    expect(await f.b.settle(f.client.commit(ticket))).toEqual(d.s.commit(d.branch)); expect(f.client.snapshot().game.units[0].body.minQ[0]).toBe(1280);
    expect(f.b.maximum()).toBe(1); await done(f);
  });
  test('every advancement yields a task and progress contains no partial snapshot', async () => {
    const f = await ready(fixture()), ticket = f.client.request([command], options); await f.b.until(() => f.b.tasks[0]?.kind === 'slice');
    const count = f.b.sent[0].length; await Promise.resolve(); await Promise.resolve(); expect(f.b.sent[0]).toHaveLength(count);
    const result = await f.b.settle(ticket.result); expect(result.status).toBe('ready');
    for (const m of f.b.sent[1].filter(m => ['start', 'advance'].includes(m.kind))) {const p = m.payload as {progress: {status: string}; preview: unknown}; if (p.progress.status !== 'ready') expect(p.preview).toBeNull();}
    expect(f.b.sent[0].filter(m => m.kind === 'advance').length).toBeGreaterThan(29); await done(f);
  });
  test('superseding in-flight work retains only the latest intent and waits to discard', async () => {
    const f = await ready(fixture()), old = f.client.request([command], options);
    const middle = f.client.request([], {horizonTicks: 0}), last = f.client.request([{kind: 'game', game: {...f.init.game, label: 'latest'}}], {horizonTicks: 0});
    expect((await middle.result).status).toBe('superseded'); expect(f.b.sent[0].filter(m => m.kind === 'discard')).toHaveLength(0);
    expect((await f.b.settle(old.result)).status).toBe('superseded'); expect((await f.b.settle(last.result)).status).toBe('ready');
    const starts = f.b.sent[0].filter(m => m.kind === 'start'); expect(starts).toHaveLength(2); expect(f.b.sent[0].filter(m => m.kind === 'discard')).toHaveLength(1);
    expect((await f.b.settle(f.client.commit(last))).snapshot.game.label).toBe('latest'); expect(f.b.maximum()).toBe(1); await done(f);
  });
  test('cancelling a queued intent does not start it', async () => {
    const f = await ready(fixture()), a = f.client.request([], options), b = f.client.request([], options); b.cancel();
    expect((await b.result).status).toBe('cancelled'); expect((await f.b.settle(a.result)).status).toBe('superseded');
    expect(f.b.sent[0].filter(m => m.kind === 'start')).toHaveLength(1); await done(f);
  });
  test('cancellation during a physical slice preserves the acknowledged save', async () => {
    const f = await ready(fixture()), before = f.client.snapshot(), t = f.client.request([command], options);
    await f.b.until(() => f.b.sent[0].some(m => m.kind === 'advance')); t.cancel();
    expect((await f.b.settle(t.result)).status).toBe('cancelled'); expect(f.client.snapshot()).toEqual(before); expect(f.b.maximum()).toBe(1); await done(f);
  });
  test('a ready ticket cancellation revokes commit and discards its branch', async () => {
    const f = await ready(fixture()), t = f.client.request([], {horizonTicks: 0}); await f.b.settle(t.result); t.cancel();
    expect(() => f.client.commit(t)).toThrow(); await f.b.until(() => f.client.state.activeId === null); expect(f.client.snapshot().revision).toBe(0); await done(f);
  });
  test('copied tickets and mutated candidates cannot change commit authority', async () => {
    const f = await ready(fixture()), t = f.client.request([command], options), r = await f.b.settle(t.result); if (r.status !== 'ready') throw Error('Expected ready');
    r.preview.state.game.ap = 99; expect(() => f.client.commit({...t})).toThrow(); expect((await f.b.settle(f.client.commit(t))).snapshot.game.ap).toBe(3);
    expect(() => f.client.commit(t)).toThrow(); await done(f);
  });
  test('command option and initial input mutations are isolated', async () => {
    const init = initial(), f = fixture(policy, init); init.game.ap = 99; await ready(f);
    const commands: ReactiveSessionCommand3D<Game>[] = [{kind: 'game', game: {...f.client.snapshot().game, label: 'owned'}}], o = {horizonTicks: 0};
    const t = f.client.request(commands, o); commands[0] = {kind: 'game', game: {...init.game, label: 'changed'}}; o.horizonTicks = 64;
    const r = await f.b.settle(t.result); if (r.status !== 'ready') throw Error('Expected ready'); expect(r.preview.state.game).toMatchObject({ap: 4, label: 'owned'}); await done(f);
  });
  test('invalid request data cannot invalidate an existing ready ticket', async () => {
    const f = await ready(fixture()), t = f.client.request([], {horizonTicks: 0}); await f.b.settle(t.result);
    expect(() => f.client.request([], {horizonTicks: 65})).toThrow(); expect(() => f.client.request(new Array(257).fill(command), options)).toThrow();
    expect(() => f.client.request([], {horizonTicks: 0, transport: {maxEntries: -1}})).toThrow(); expect((await f.b.settle(f.client.commit(t))).snapshot.revision).toBe(1); await done(f);
  });
  test('slice budget exhaustion discards work without poisoning the connection', async () => {
    const f = await ready(fixture()), before = f.client.snapshot(), t = f.client.request([command], {...options, maxSlices: 1});
    expect(await f.b.settle(t.result)).toMatchObject({status: 'failed', error: expect.stringMatching(/slice budget/)}); expect(f.client.snapshot()).toEqual(before);
    const next = f.client.request([], {horizonTicks: 0}); expect((await f.b.settle(next.result)).status).toBe('ready'); await done(f);
  });
  test('late policy rejection rolls back commands and costs across the worker boundary', async () => {
    const init = initial(); init.game.ap = 1; const f = await ready(fixture(policy, init)), before = f.client.snapshot();
    const t = f.client.request([command, command], options); expect((await f.b.settle(t.result)).status).toBe('failed'); expect(f.client.snapshot()).toEqual(before); await done(f);
  });
  test('actor conflict rejects the complete ability', async () => {
    const init = initial(), view = createReactiveSession3D(registry, init).queries();
    init.game.units.push({id: 'peer', body: createReactiveBody3D(view, {minQ: [1280, 256, 256], sizeQ: [512, 512, 512], gravityQ: 0})});
    const f = await ready(fixture(policy, init)), before = f.client.snapshot(), t = f.client.request([command], {...options, horizonTicks: 0});
    expect(await f.b.settle(t.result)).toMatchObject({status: 'failed', error: expect.stringContaining('peer-contact')}); expect(f.client.snapshot()).toEqual(before); await done(f);
  });
  test('JSON restore and continued transport equal uninterrupted execution', async () => {
    const a = await ready(fixture()), first = a.client.request([command], options); await a.b.settle(first.result); await a.b.settle(a.client.commit(first));
    const b = await ready(fixture()); await b.b.settle(b.client.restore(JSON.parse(JSON.stringify(a.client.snapshot()))));
    const ta = a.client.request([command], options), tb = b.client.request([command], options); await a.b.settle(ta.result); await b.b.settle(tb.result);
    expect(await a.b.settle(a.client.commit(ta))).toEqual(await b.b.settle(b.client.commit(tb))); await done(a); await done(b);
  });
  test('restore validates first and refuses active previews', async () => {
    const f = await ready(fixture()), before = f.client.snapshot(); expect(() => f.client.restore({...before, accounting: {initialQ: '0', externalQ: '0'}})).toThrow();
    const t = f.client.request([], {horizonTicks: 0}); await f.b.settle(t.result); expect(() => f.client.restore(before)).toThrow(/idle/); await done(f);
  });
  test('closing during advancement cancels safely and releases both endpoints', async () => {
    const f = await ready(fixture()), t = f.client.request([command], options); await f.b.until(() => f.b.sent[0].some(m => m.kind === 'advance'));
    const closing = f.client.close(); expect(f.client.close()).toBe(closing); expect((await f.b.settle(t.result)).status).toBe('closed'); await f.b.settle(closing);
    expect(f.b.closed).toEqual([true, true]); expect(() => f.client.request([], options)).toThrow(); expect(f.client.snapshot().revision).toBe(0);
  });
  test('closing during handshake waits for its acknowledgement then closes', async () => {
    const f = fixture(), close = f.client.close(); await f.b.settle(close); expect(f.b.sent[0].map(m => m.kind)).toEqual(['hello', 'close']);
  });
  test('unknown commands reject atomically and allow another preview', async () => {
    const f = await ready(fixture()), t = f.client.request([{kind: 'bogus'} as unknown as ReactiveSessionCommand3D<Game>], {horizonTicks: 0});
    expect((await f.b.settle(t.result)).status).toBe('failed'); const next = f.client.request([], {horizonTicks: 0}); expect((await f.b.settle(next.result)).status).toBe('ready'); await done(f);
  });
  test('wrong application identity fails the handshake', async () => {
    const f = fixture(policy, initial(), {gameRulesVersion: 'other'}); await expect(f.b.settle(f.client.ready)).rejects.toThrow(/identity/); expect(f.client.state.status).toBe('failed');
  });
  test('wrong catalog state fails the handshake', async () => {
    const f = fixture(); f.b.config.mapReply = m => {if (m.kind === 'hello') (m.payload as {domains: {world: {block: {materialCatalogHash: string}}}}).domains.world.block.materialCatalogHash = 'wrong'; return m;};
    await expect(f.b.settle(f.client.ready)).rejects.toThrow(); expect(f.client.state.status).toBe('failed');
  });
  test('wrong protocol reply fails closed and retains the acknowledged save', async () => {
    const f = await ready(fixture()), before = f.client.snapshot(); f.b.config.mapReply = m => ({...m, protocol: 'wrong' as typeof REACTIVE_WORKER_PROTOCOL_3D});
    const t = f.client.request([], {horizonTicks: 0}); expect((await f.b.settle(t.result)).status).toBe('failed'); expect(f.client.snapshot()).toEqual(before);
  });
  test('wrong channel reply fails closed', async () => {
    const f = await ready(fixture()); f.b.config.mapReply = m => ({...m, channel: 'other'}); const t = f.client.request([], {horizonTicks: 0});
    expect((await f.b.settle(t.result)).status).toBe('failed'); expect(f.client.state.uncertain).toBe(false);
  });
  test('duplicate reply fails closed', async () => {
    const f = await ready(fixture()), old = structuredClone(f.b.sent[1][0]); f.b.receive[0](old); expect(f.client.state.status).toBe('failed');
  });
  test('partial preview payload is rejected', async () => {
    const f = await ready(fixture()); f.b.config.mapReply = m => {if (m.kind === 'start') (m.payload as {preview: unknown}).preview = {}; return m;};
    const t = f.client.request([], {horizonTicks: 0}); expect((await f.b.settle(t.result)).status).toBe('failed'); expect(f.client.state.status).toBe('failed');
  });
  test('changed branch identity is rejected', async () => {
    const f = await ready(fixture()); f.b.config.mapReply = m => {if (m.kind === 'advance') (m.payload as {branchId: number}).branchId++; return m;};
    const t = f.client.request([command], options); expect((await f.b.settle(t.result)).status).toBe('failed');
  });
  test('forged ready state must pass whole-state accounting validation', async () => {
    const f = await ready(fixture()); f.b.config.mapReply = m => {const p = m.payload as {preview?: {state: {accounting: {initialQ: string}}}};
      if (m.kind === 'advance' && p.preview) p.preview.state.accounting.initialQ = '0'; return m;};
    const t = f.client.request([], {horizonTicks: 0}); expect((await f.b.settle(t.result)).status).toBe('failed');
  });
  test('commit acknowledgement differing from the accepted preview is uncertain', async () => {
    const f = await ready(fixture()), before = f.client.snapshot(), t = f.client.request([], {horizonTicks: 0}); await f.b.settle(t.result);
    f.b.config.mapReply = m => {if (m.kind === 'commit') (m.payload as {snapshot: {game: Game}}).snapshot.game.ap++; return m;};
    await expect(f.b.settle(f.client.commit(t))).rejects.toThrow(/preview/); expect(f.client.state.uncertain).toBe(true); expect(f.client.snapshot()).toEqual(before);
  });
  test('restore acknowledgement differing from the requested save is uncertain', async () => {
    const f = await ready(fixture()), before = f.client.snapshot(); f.b.config.mapReply = m => {if (m.kind === 'restore') (m.payload as {game: Game}).game.ap++; return m;};
    await expect(f.b.settle(f.client.restore(before))).rejects.toThrow(/restore/); expect(f.client.state.uncertain).toBe(true); expect(f.client.snapshot()).toEqual(before);
  });
  test('dropped commit reply times out without retry or changing the cached save', async () => {
    vi.useFakeTimers(); const f = await ready(fixture(policy, initial(), {timeoutMs: 20})), before = f.client.snapshot(), t = f.client.request([], {horizonTicks: 0}); await f.b.settle(t.result);
    f.b.config.mapReply = m => m.kind === 'commit' ? null : m; const result = f.client.commit(t); const rejected = expect(result).rejects.toThrow(/timed out/);
    await f.b.until(() => f.b.sent[1].some(m => m.kind === 'commit')); await vi.advanceTimersByTimeAsync(21); await rejected;
    expect(f.b.sent[0].filter(m => m.kind === 'commit')).toHaveLength(1); expect(f.client.state.uncertain).toBe(true); expect(f.client.snapshot()).toEqual(before);
  });
  test('preview timeout closes transport without an uncertain commit', async () => {
    vi.useFakeTimers(); const f = await ready(fixture(policy, initial(), {timeoutMs: 20})); f.b.config.mapReply = () => null;
    const t = f.client.request([], {horizonTicks: 0}); await vi.advanceTimersByTimeAsync(21); expect((await t.result).status).toBe('failed'); expect(f.client.state.uncertain).toBe(false);
  });
  test('send failure during mutation is conservatively uncertain', async () => {
    const f = await ready(fixture()), before = f.client.snapshot(); f.b.config.sendFailure = 'restore'; await expect(f.client.restore(before)).rejects.toThrow(/send failed/);
    expect(f.client.state.uncertain).toBe(true); expect(f.client.snapshot()).toEqual(before);
  });
  test('worker error stops pending work and retains the last acknowledged save', async () => {
    const f = await ready(fixture()), before = f.client.snapshot(), t = f.client.request([command], options); f.b.errors[0](Error('device lost'));
    expect((await t.result).status).toBe('failed'); expect(f.client.snapshot()).toEqual(before); expect(f.b.closed[0]).toBe(true);
  });
  test('an inline scheduler is rejected instead of starting an unbounded recursive loop', async () => {
    const f = fixture(policy, initial(), {schedule: task => {task(); return () => {};}}); await f.b.settle(f.client.ready); expect(f.client.state.status).toBe('failed');
  });
  test('scheduler failure stops work without publishing a candidate', async () => {
    const f = await ready(fixture()); f.b.config.scheduleFailure = true; const t = f.client.request([command], options);
    expect((await f.b.settle(t.result)).status).toBe('failed'); expect(f.client.snapshot().revision).toBe(0);
  });
  test('host rejects out-of-order messages and closes its owned session', async () => {
    const f = await ready(fixture()); f.b.receive[1](workerMessage('test', 99, 'advance', null)); expect(f.b.closed[1]).toBe(true);
  });
  test('host work bounds and client deadline bounds reject before subscribing', () => {
    const b = bus(); expect(() => createReactiveWorkerHost3D(b.ports[1], registry, initial(), policy, {channel: 'test', work: 257})).toThrow();
    expect(() => createReactiveWorkerClient3D(b.ports[0], registry, {channel: 'test', worldId: 'a', gameRulesVersion: 'b', timeoutMs: 0})).toThrow(); expect(b.sent.flat()).toEqual([]);
  });
  test('browser adapter forwards events and releases the supplied worker only', () => {
    const events = new Map<string, EventListener>(), sent: unknown[] = [], terminate = vi.fn();
    const worker = {postMessage: (m: unknown) => sent.push(m), terminate, addEventListener: (k: string, f: EventListener) => events.set(k, f), removeEventListener: (k: string) => events.delete(k)} as unknown as Worker;
    const port = reactiveBrowserWorkerTransport3D(worker), receive = vi.fn(), fail = vi.fn(), unsubscribe = port.subscribe(receive, fail);
    port.send({x: 1}); events.get('message')!({data: 7} as unknown as Event); events.get('messageerror')!({} as Event);
    expect(sent).toEqual([{x: 1}]); expect(receive).toHaveBeenCalledWith(7); expect(fail).toHaveBeenCalledOnce(); unsubscribe(); port.close(); expect(events.size).toBe(0); expect(terminate).toHaveBeenCalledOnce();
  });
  test('regressing command progress is rejected after a completed boundary', async () => {
    const f = await ready(fixture()); let observed = false;
    f.b.config.mapReply = m => {if (m.kind === 'advance') {const p = (m.payload as {progress: {completedCommands: number; phase: string}}).progress;
      if (observed) {p.completedCommands = 0; p.phase = 'commands';} else if (p.completedCommands === 1) observed = true;} return m;};
    const t = f.client.request([{kind: 'game', game: {...f.init.game, label: 'first'}}, command], options);
    expect((await f.b.settle(t.result)).status).toBe('failed'); expect(f.client.state.status).toBe('failed');
  });
  test('explicit commit rejection is certain and permits another preview', async () => {
    const f = await ready(fixture({...policy, validateGame: s => s.revision === 0})), before = f.client.snapshot(), t = f.client.request([], {horizonTicks: 0});
    await f.b.settle(t.result); await expect(f.b.settle(f.client.commit(t))).rejects.toThrow(/policy/);
    expect(f.client.state.uncertain).toBe(false); expect(f.client.snapshot()).toEqual(before); const next = f.client.request([], {horizonTicks: 0});
    expect((await f.b.settle(next.result)).status).toBe('ready'); await done(f);
  });
  test('explicit restore rejection leaves the connection and acknowledged save usable', async () => {
    const f = await ready(fixture({...policy, validateGame: s => s.game.ap <= 4})), before = f.client.snapshot(), invalid = structuredClone(before); invalid.game.ap = 9;
    await expect(f.b.settle(f.client.restore(invalid))).rejects.toThrow(/policy/); expect(f.client.state.uncertain).toBe(false); expect(f.client.snapshot()).toEqual(before);
    const next = f.client.request([], {horizonTicks: 0}); expect((await f.b.settle(next.result)).status).toBe('ready'); await done(f);
  });
  test('close during an in-flight commit retains its acknowledged result before shutdown', async () => {
    const f = await ready(fixture()), t = f.client.request([], {horizonTicks: 0}); await f.b.settle(t.result);
    const commit = f.client.commit(t), closing = f.client.close(); expect((await f.b.settle(commit)).snapshot.revision).toBe(1); await f.b.settle(closing);
    expect(f.client.snapshot().revision).toBe(1); expect(f.client.state.uncertain).toBe(false); expect(f.b.maximum()).toBe(1);
  });
  test('another request or restore cannot overlap an unacknowledged mutation', async () => {
    const f = await ready(fixture()), t = f.client.request([], {horizonTicks: 0}); await f.b.settle(t.result);
    const commit = f.client.commit(t); expect(() => f.client.request([], {horizonTicks: 0})).toThrow(/mutation/); expect(() => f.client.restore(f.client.snapshot())).toThrow(/idle/);
    await f.b.settle(commit); await done(f);
  });
  test('different bounded slice sizes produce identical complete physics and game state', async () => {
    const a = await ready(fixture(policy, initial(), {}, 1)), b = await ready(fixture(policy, initial(), {}, 256));
    const ta = a.client.request([command], options), tb = b.client.request([command], options); await a.b.settle(ta.result); await b.b.settle(tb.result);
    expect(await a.b.settle(a.client.commit(ta))).toEqual(await b.b.settle(b.client.commit(tb))); await done(a); await done(b);
  });
  test('superseding a physical slice discards it before starting the replacement', async () => {
    const f = await ready(fixture()), old = f.client.request([command], options); await f.b.until(() => f.b.sent[0].some(m => m.kind === 'advance'));
    const next = f.client.request([], {horizonTicks: 0}); expect((await f.b.settle(old.result)).status).toBe('superseded'); expect((await f.b.settle(next.result)).status).toBe('ready');
    const messages = f.b.sent[0], discard = messages.findIndex(m => m.kind === 'discard'), starts = messages.map((m, i) => m.kind === 'start' ? i : -1).filter(i => i >= 0);
    expect(discard).toBeLessThan(starts[1]); expect(f.client.snapshot().game.memory.cycle).toBe(0); expect(f.b.maximum()).toBe(1); await done(f);
  });
});


describe('worker state observations and completion', () => {
  test('publishes initial, progress, acknowledged and terminal states without inline callbacks', async () => {
    const f = fixture(), states: string[] = [];
    f.client.subscribe(state => states.push(state.status)); expect(states).toEqual([]);
    await ready(f); await Promise.resolve(); expect(states).toContain('connecting'); expect(states).toContain('ready');
    const ticket = f.client.request([], {horizonTicks: 0}); await f.b.settle(ticket.result);
    expect(states).toContain('working'); expect(states.at(-1)).toBe('ready');
    await done(f); await Promise.resolve(); expect(states).toContain('closing'); expect(states.at(-1)).toBe('closed');
  });
  test('isolates observer errors and state copies, and supports unsubscribe', async () => {
    const f = await ready(fixture()), discarded = vi.fn(); const remove = f.client.subscribe(discarded); remove();
    f.client.subscribe(() => {throw Error('Observer failure');});
    f.client.subscribe(state => {if (state.progress) state.progress.completedTicks = 999;});
    const seen: number[] = []; f.client.subscribe(state => {if (state.progress) seen.push(state.progress.completedTicks);});
    const ticket = f.client.request([], options); expect((await f.b.settle(ticket.result)).status).toBe('ready');
    expect(discarded).not.toHaveBeenCalled(); expect(seen.length).toBeGreaterThan(0); expect(seen).not.toContain(999);
    expect(f.client.state.progress?.completedTicks).toBe(1); await done(f);
  });
  test('waiting for idle waits for discard acknowledgement, then permits a new command', async () => {
    const f = await ready(fixture()), ticket = f.client.request([], {horizonTicks: 0}); await f.b.settle(ticket.result);
    ticket.cancel(); let settled = false; const idle = f.client.whenIdle().then(() => {settled = true;});
    await Promise.resolve(); expect(settled).toBe(false); await f.b.settle(idle);
    expect(f.client.state.activeId).toBeNull(); const next = f.client.request([], {horizonTicks: 0}); await f.b.settle(next.result); await done(f);
  });
  test('timeout wakes idle waiters and observers even without an inbound event', async () => {
    vi.useFakeTimers(); const f = await ready(fixture(policy, initial(), {timeoutMs: 20}));
    const ticket = f.client.request([], {horizonTicks: 0}); await f.b.settle(ticket.result);
    const states: string[] = []; f.client.subscribe(state => states.push(state.status)); f.b.config.mapReply = m => m.kind === 'discard' ? null : m;
    ticket.cancel(); const idle = f.client.whenIdle(); const rejected = expect(idle).rejects.toThrow(/timed out/);
    await f.b.until(() => f.b.sent[1].some(m => m.kind === 'discard')); await vi.advanceTimersByTimeAsync(21); await rejected;
    expect(states.at(-1)).toBe('failed'); expect(f.client.state.uncertain).toBe(false);
  });
  test('shutdown rejects idle waiters and late subscribers receive the terminal state once', async () => {
    const f = await ready(fixture()), ticket = f.client.request([], {horizonTicks: 0}); await f.b.settle(ticket.result);
    ticket.cancel(); const waiting = expect(f.client.whenIdle()).rejects.toThrow(/closed/); await done(f); await waiting;
    const late = vi.fn(); f.client.subscribe(late); await Promise.resolve(); expect(late).toHaveBeenCalledOnce(); expect(late.mock.calls[0][0].status).toBe('closed');
    await f.client.close(); await Promise.resolve(); expect(late).toHaveBeenCalledOnce();
  });
  test('subscribing from an observer does not rebroadcast to existing observers', async () => {
    const f = await ready(fixture()); let calls = 0; const peer = vi.fn();
    const remove = f.client.subscribe(() => {calls++; if (calls === 1) f.client.subscribe(peer);});
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(calls).toBe(1); expect(peer).toHaveBeenCalledOnce(); remove(); await done(f);
  });
});
