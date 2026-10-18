/** Real host/client framing through isolated structured-clone messages; inert ticks only. */
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { CpuStructuralWorld3D, type StructuralSnapshot3D } from './structural-world-core.js';
import { MAT } from './3d.js';
import { createTacticalSessionCore3D, type TacticalSimulationFactory3D } from './tactical-session-core.js';
import { createTacticalWorkerHost3D } from './tactical-worker-host.js';
import { createTacticalWorkerClient3D, tacticalBrowserWorkerTransport3D } from './tactical-worker-client.js';
import type { TacticalTransport3D, Wire } from './tactical-worker-wire.js';
import type { TacticalPreviewEditor3D, TacticalPreviewOutcome3D } from './tactical-previews.js';
import type { TacticalSessionSnapshot3D } from './tactical-session-view.js';

const traps = (['step', 'stepWithMotion', 'stepWithMotionPaths', 'inspectStructure'] as const)
  .map(name => vi.spyOn(CpuStructuralWorld3D.prototype, name).mockImplementation(() => {throw Error('Physical runtime is held.');}));
afterAll(() => {for (const trap of traps) {expect(trap).not.toHaveBeenCalled(); trap.mockRestore();}});
afterEach(() => vi.useRealTimers());
type Game = {ap: number; label: string; ticks: number};
type Command = {label: string};
const options = {channel: 'worker-test', worldId: 'transport-world', gameRulesVersion: 'transport-game'};
function initial() {
  const w = new CpuStructuralWorld3D({width: 4, height: 4, depth: 4, chunkSize: 4});
  w.setCell(1, 1, 1, MAT.STONE, 160); w.setIntegrity(1, 1, 1, 73);
  return {worldId: options.worldId, gameRulesVersion: options.gameRulesVersion, terrain: w.snapshot(), game: {ap: 2, label: '', ticks: 0}};
}
function stage(editor: TacticalPreviewEditor3D<Game>, command: Command) {
  editor.translate({cells: [[1, 1, 1]], path: [[1, 0, 0]]});
  editor.setGame({...editor.inspect().game, ap: 1, label: command.label});
}
function deferred() {let resolve!: () => void; return {promise: new Promise<void>(done => {resolve = done;}), resolve: () => resolve()};}
function link() {
  const sent: Wire[][] = [[], []], callbacks: ((value: unknown) => void)[] = [() => {}, () => {}], faults: ((error: Error) => void)[] = [() => {}, () => {}];
  const closed = [false, false], held: Wire[] = [];
  let rewrite: ((m: Wire, side: number) => Wire | null) | undefined;
  const ports: TacticalTransport3D[] = [0, 1].map(side => ({
    send(value) {
      if (closed[side]) throw Error('Mock endpoint closed');
      const m = structuredClone(value) as Wire; sent[side].push(structuredClone(m));
      const output = rewrite ? rewrite(m, side) : m; if (output !== null) queueMicrotask(() => {if (!closed[1 - side]) callbacks[1 - side](structuredClone(output));});
    },
    subscribe(receive, failed) {callbacks[side] = receive; faults[side] = failed; return () => {callbacks[side] = () => {}; faults[side] = () => {};};},
    close() {closed[side] = true;},
  }));
  return {ports, sent, held, closed, setRewrite: (fn: typeof rewrite) => {rewrite = fn;},
    deliver: (side: number, value: unknown) => callbacks[side](structuredClone(value)), fault: (side: number) => faults[side](Error('Disconnected'))};
}
function fixture(overrides: {step?: (s: StructuralSnapshot3D) => void | Promise<void>; close?: () => void | Promise<void>; rejectCommit?: boolean; timeoutMs?: number; reservoir?: boolean; hostCleanupThrows?: boolean} = {}) {
  const messages = link(), stepped = vi.fn(), made = vi.fn(), cleaned = vi.fn();
  const factory: TacticalSimulationFactory3D = snapshot => {made(); let s = structuredClone(snapshot); return {
    load(value) {s = structuredClone(value);}, async step() {stepped(); await overrides.step?.(s); s.tick++;},
    snapshot: () => s, async close() {cleaned(); await overrides.close?.();},
  };};
  const seed = initial();
  const start = overrides.reservoir ? {...seed, reservoirs: [{id: 'flask', terrain: new CpuStructuralWorld3D({width: 4, height: 4, depth: 4, chunkSize: 4}).snapshot()}]} : seed;
  const session = createTacticalSessionCore3D(start, factory, {
    reduceTick: ({game}) => ({...game, ticks: game.ticks + 1}),
    validateGame: ({game}) => !(overrides.rejectCommit && game.label === 'reject'),
  }, async () => {});
  if (overrides.hostCleanupThrows) {
    const subscribe = messages.ports[1].subscribe;
    messages.ports[1].subscribe = (receive, failed) => {
      const remove = subscribe(receive, failed); return () => {remove(); throw Error('Host listener cleanup failed');};
    };
  }
  const host = createTacticalWorkerHost3D(messages.ports[1], session, stage, options.channel);
  const client = createTacticalWorkerClient3D<Game, Command>(messages.ports[0], {...options, timeoutMs: overrides.timeoutMs});
  return {messages, session, host, client, stepped, made, cleaned};
}
async function finish(f: ReturnType<typeof fixture>) {if (f.client.state.status !== 'failed') await f.client.close(); await f.host.close().catch(() => {});}

describe('worker framing with mock transport and inert simulation', () => {
  test('handshake retains a complete isolated committed snapshot', async () => {
    const f = fixture(); await f.client.ready; expect(f.client.snapshot()).toEqual(f.session.snapshot());
    const value = f.client.snapshot(); value.game.ap = -1; value.terrain.energyQ.fill(0);
    expect(f.client.snapshot()).toEqual(f.session.snapshot()); expect(f.client.state.status).toBe('ready'); await finish(f);
  });
  test('worker preview leaves the cached and authoritative committed state unchanged', async () => {
    const f = fixture(); await f.client.ready; const before = f.client.snapshot(), ticket = f.client.request({label: 'wall'}, 2);
    const outcome = await ticket.result; expect(outcome).toMatchObject({status: 'ready', horizonTicks: 2});
    expect(f.client.snapshot()).toEqual(before); expect(f.session.snapshot()).toEqual(before); expect(f.stepped).toHaveBeenCalledTimes(2); await finish(f);
  });
  test('acknowledged commit publishes terrain energy damage and game together', async () => {
    const f = fixture(); await f.client.ready; const before = f.client.snapshot(), ticket = f.client.request({label: 'wall'}, 2); await ticket.result;
    const commit = await f.client.commit(ticket); expect(commit.snapshot).toEqual(f.session.snapshot()); expect(commit.snapshot).toEqual(f.client.snapshot());
    expect(commit.snapshot.terrain.energyQ[22]).toBe(before.terrain.energyQ[21]); expect(commit.snapshot.terrain.structure[22]).toBe(73);
    expect(commit.snapshot.game).toEqual({ap: 1, label: 'wall', ticks: 2}); expect(commit.receipt).toMatchObject({revision: 1, horizonTicks: 2, endTick: 2, externalEnergyQ: '0'});
    commit.snapshot.game.ap = 999; expect(f.client.snapshot().game.ap).toBe(1); await finish(f);
  });
  test('ready result edits and copied tickets cannot change commit authority', async () => {
    const f = fixture(); await f.client.ready; const t = f.client.request({label: 'actual'}, 0), result = await t.result;
    if (result.status !== 'ready') throw Error('Expected ready'); result.preview.game.label = 'fake'; result.preview.terrain.energyQ.fill(0);
    expect(() => f.client.commit({...t})).toThrow(/latest/); expect((await f.client.commit(t)).snapshot.game.label).toBe('actual');
    expect(() => f.client.commit(t)).toThrow(/latest/); await finish(f);
  });
  test('rapid replacements coalesce locally and send one cancellation', async () => {
    const entered = deferred(), step = deferred(); let first = true;
    const f = fixture({step: async () => {if (first) {entered.resolve(); await step.promise; first = false;}}}); await f.client.ready;
    const old = f.client.request({label: 'old'}, 3); await entered.promise;
    const middle = f.client.request({label: 'middle'}, 1), input = {label: 'last'}, last = f.client.request(input, 2); input.label = 'mutated';
    expect((await middle.result).status).toBe('superseded'); await Promise.resolve(); await Promise.resolve();
    expect(f.messages.sent[0].filter(m => m.kind === 'cancel')).toHaveLength(1); step.resolve();
    expect((await old.result).status).toBe('superseded'); expect((await last.result).status).toBe('ready');
    expect(f.messages.sent[0].filter(m => m.kind === 'preview')).toHaveLength(2);
    expect((await f.client.commit(last)).snapshot.game.label).toBe('last'); await finish(f);
  });
  test('preview completion before cancellation acknowledgement cannot release the next request', async () => {
    const entered = deferred(), gate = deferred(); let first = true;
    const f = fixture({step: async () => {if (first) {entered.resolve(); await gate.promise; first = false;}}}); await f.client.ready;
    f.messages.setRewrite((m, side) => {if (side === 1 && m.kind === 'cancel') {f.messages.held.push(m); return null;} return m;});
    const old = f.client.request({label: 'old'}, 2); await entered.promise; const next = f.client.request({label: 'next'}, 1); gate.resolve();
    expect((await old.result).status).toBe('superseded'); expect(f.made).toHaveBeenCalledTimes(1); expect(f.messages.held).toHaveLength(1);
    f.messages.deliver(0, f.messages.held[0]); expect((await next.result).status).toBe('ready'); expect(f.made).toHaveBeenCalledTimes(2); await finish(f);
  });
  test('delayed driver cleanup prevents successor execution', async () => {
    const entered = deferred(), step = deferred(), closing = deferred(), cleanup = deferred(); let first = true;
    const f = fixture({step: async () => {if (first) {entered.resolve(); await step.promise;}}, close: async () => {if (first) {closing.resolve(); await cleanup.promise; first = false;}}});
    await f.client.ready; const old = f.client.request({label: 'old'}, 2); await entered.promise; const next = f.client.request({label: 'next'}, 1);
    step.resolve(); await closing.promise; expect(f.made).toHaveBeenCalledTimes(1); cleanup.resolve(); await old.result;
    expect((await next.result).status).toBe('ready'); await finish(f);
  });
  test('invalid input does not evict the accepted preview', async () => {
    const f = fixture(); await f.client.ready; const ticket = f.client.request({label: 'valid'}, 0), getter = vi.fn();
    expect(() => f.client.request(Object.defineProperty({}, 'label', {get: getter, enumerable: true}) as Command, 0)).toThrow();
    expect(() => f.client.request({label: 'bad'}, 1025)).toThrow(); expect(getter).not.toHaveBeenCalled();
    expect((await ticket.result).status).toBe('ready'); expect((await f.client.commit(ticket)).snapshot.game.label).toBe('valid'); await finish(f);
  });
  test('cancelling a ready ticket frees it without starting more work', async () => {
    const f = fixture(); await f.client.ready; const ticket = f.client.request({label: 'cancel'}, 0); await ticket.result; ticket.cancel();
    await Promise.resolve(); await Promise.resolve(); expect(() => f.client.commit(ticket)).toThrow(); expect(f.made).not.toHaveBeenCalled(); await finish(f);
  });
  test('worker rejects stale submissions without rebasing them', async () => {
    const f = fixture(); await f.client.ready; f.session.restore(f.session.snapshot());
    const result = await f.client.request({label: 'old'}, 1).result; expect(result.status).toBe('stale'); expect(f.made).not.toHaveBeenCalled(); await finish(f);
  });
  test('lost commit response is uncertain and never automatically retried', async () => {
    vi.useFakeTimers(); const f = fixture({timeoutMs: 40}); await f.client.ready; const before = f.client.snapshot(), ticket = f.client.request({label: 'committed'}, 0); await ticket.result;
    f.messages.setRewrite((m, side) => side === 1 && m.kind === 'commit' ? null : m);
    const pending = f.client.commit(ticket), rejected = expect(pending).rejects.toThrow(/timed out/); await vi.advanceTimersByTimeAsync(41); await rejected;
    expect(f.session.snapshot().game.label).toBe('committed'); expect(f.client.snapshot()).toEqual(before); expect(f.client.state).toMatchObject({status: 'failed', uncertain: true});
    expect(f.messages.sent[0].filter(m => m.kind === 'commit')).toHaveLength(1); expect(f.messages.closed[0]).toBe(true); await finish(f);
  });
  test('a send failure after worker publication is reported as uncertain', async () => {
    const f = fixture(); await f.client.ready; const before = f.client.snapshot(), ticket = f.client.request({label: 'written'}, 0); await ticket.result;
    f.messages.setRewrite((m, side) => {if (side === 1 && m.kind === 'commit') throw Error('reply lost'); return m;});
    await expect(f.client.commit(ticket)).rejects.toThrow(/reply lost/); expect(f.session.snapshot().game.label).toBe('written');
    expect(f.client.snapshot()).toEqual(before); expect(f.client.state.uncertain).toBe(true); await finish(f);
  });
  test('explicit atomic commit rejection is certain and leaves both worlds unchanged', async () => {
    const f = fixture({rejectCommit: true}); await f.client.ready; const before = f.client.snapshot(), t = f.client.request({label: 'reject'}, 0); await t.result;
    await expect(f.client.commit(t)).rejects.toThrow(/rejected/); expect(f.session.snapshot()).toEqual(before); expect(f.client.snapshot()).toEqual(before);
    expect(f.client.state.uncertain).toBe(false); const next = f.client.request({label: 'allowed'}, 0); await next.result; await f.client.commit(next); await finish(f);
  });
  test('malformed commit data cannot replace the last confirmed snapshot', async () => {
    const f = fixture(); await f.client.ready; const before = f.client.snapshot(), t = f.client.request({label: 'wall'}, 0); await t.result;
    f.messages.setRewrite((m, side) => {if (side === 1 && m.kind === 'commit') (m.payload as {receipt: {revision: number}}).receipt.revision += 1; return m;});
    await expect(f.client.commit(t)).rejects.toThrow(/receipt/); expect(f.client.snapshot()).toEqual(before); expect(f.client.state.uncertain).toBe(true); await finish(f);
  });
  test('preview replies cannot change reservoir identities', async () => {
    const f = fixture({reservoir: true}); await f.client.ready; const before = f.client.snapshot();
    f.messages.setRewrite((m, side) => {
      if (side === 1 && m.kind === 'preview') {
        const result = m.payload as TacticalPreviewOutcome3D<Game>;
        if (result.status === 'ready') result.preview.reservoirs[0].id = 'other';
      }
      return m;
    });
    const ticket = f.client.request({label: 'bad-domain'}, 0);
    expect((await ticket.result).status).toBe('failed'); expect(f.client.snapshot()).toEqual(before);
    expect(f.session.snapshot()).toEqual(before); expect(() => f.client.commit(ticket)).toThrow(); await finish(f);
  });
  test('commit replies cannot change reservoir identities or overwrite cached state', async () => {
    const f = fixture({reservoir: true}); await f.client.ready; const before = f.client.snapshot();
    const ticket = f.client.request({label: 'bad-domain'}, 0); await ticket.result;
    f.messages.setRewrite((m, side) => {
      if (side === 1 && m.kind === 'commit') (m.payload as {snapshot: TacticalSessionSnapshot3D<Game>}).snapshot.reservoirs[0].id = 'other';
      return m;
    });
    await expect(f.client.commit(ticket)).rejects.toThrow(/[Rr]eservoir/);
    expect(f.client.snapshot()).toEqual(before); expect(f.client.state.uncertain).toBe(true);
    expect(f.session.snapshot().reservoirs[0].id).toBe('flask'); await finish(f);
  });
  test('duplicate replies fail the connection without changing its cached state', async () => {
    const f = fixture(); await f.client.ready; const before = f.client.snapshot(); f.messages.deliver(0, f.messages.sent[1][0]);
    expect(f.client.state.status).toBe('failed'); expect(f.client.snapshot()).toEqual(before); await finish(f);
  });
  test('a duplicated commit request cannot apply its effects twice', async () => {
    const f = fixture(); await f.client.ready; const t = f.client.request({label: 'once'}, 0); await t.result; await f.client.commit(t);
    const committed = f.session.snapshot(), sent = f.messages.sent[0].find(m => m.kind === 'commit')!;
    f.messages.deliver(1, sent); await Promise.resolve(); expect(f.session.snapshot()).toEqual(committed); expect(f.client.snapshot()).toEqual(committed); await finish(f);
  });
  test('malformed request envelopes stop before running an intervention', async () => {
    vi.useFakeTimers(); const f = fixture({timeoutMs: 40}); await f.client.ready; const before = f.session.snapshot();
    f.messages.setRewrite((m, side) => side === 0 && m.kind === 'preview' ? {...m, extra: true} : m);
    const t = f.client.request({label: 'invalid'}, 0); await vi.advanceTimersByTimeAsync(41);
    expect((await t.result).status).toBe('failed'); expect(f.session.snapshot()).toEqual(before); expect(f.made).not.toHaveBeenCalled(); await finish(f);
  });
  test('the worker rejects committing against an externally changed revision', async () => {
    const f = fixture(); await f.client.ready; const before = f.client.snapshot(), t = f.client.request({label: 'old'}, 0); await t.result;
    const changed = f.session.restore(f.session.snapshot()); await expect(f.client.commit(t)).rejects.toThrow(/Stale/);
    expect(f.session.snapshot()).toEqual(changed); expect(f.client.snapshot()).toEqual(before); await finish(f);
  });
  test('mismatched channel and operation responses are not accepted', async () => {
    for (const key of ['channel', 'kind'] as const) {
      const f = fixture(); await f.client.ready; const before = f.client.snapshot();
      f.messages.setRewrite((m, side) => {if (side === 1 && m.kind === 'preview') m[key] = 'wrong'; return m;});
      expect((await f.client.request({label: 'bad'}, 0).result).status).toBe('failed'); expect(f.client.snapshot()).toEqual(before); await finish(f);
    }
  });
  test('incomplete preview metadata fails without making a ticket committable', async () => {
    const f = fixture(); await f.client.ready;
    f.messages.setRewrite((m, side) => {if (side === 1 && m.kind === 'preview') (m.payload as {horizonTicks: number}).horizonTicks += 1; return m;});
    const t = f.client.request({label: 'bad'}, 0); expect((await t.result).status).toBe('failed'); expect(() => f.client.commit(t)).toThrow(); await finish(f);
  });
  test('restore publishes the exact saved state with a new revision', async () => {
    const f = fixture(); await f.client.ready; const saved = f.client.snapshot(), t = f.client.request({label: 'wall'}, 0); await t.result; await f.client.commit(t);
    const restored = await f.client.restore(saved); expect(restored).toEqual({...saved, revision: 2}); expect(f.client.snapshot()).toEqual(f.session.snapshot()); await finish(f);
  });
  test('invalid restore fails locally without sending or changing state', async () => {
    const f = fixture(); await f.client.ready; const saved = f.client.snapshot(), broken = structuredClone(saved); broken.accounting.externalQ = '999';
    expect(() => f.client.restore(broken)).toThrow(); expect(f.messages.sent[0].filter(m => m.kind === 'restore')).toHaveLength(0); expect(f.session.snapshot()).toEqual(saved); await finish(f);
  });
  test('restore with changed reservoir identity rejects locally without invalidating ready work', async () => {
    const f = fixture({reservoir: true}); await f.client.ready; const before = f.client.snapshot();
    const ticket = f.client.request({label: 'valid'}, 0); await ticket.result;
    const bad = structuredClone(before); bad.reservoirs[0].id = 'other';
    expect(() => f.client.restore(bad)).toThrow(/[Rr]eservoir/);
    expect(f.messages.sent[0].filter(m => m.kind === 'restore')).toHaveLength(0);
    expect(f.session.snapshot()).toEqual(before); expect((await f.client.commit(ticket)).snapshot.game.label).toBe('valid'); await finish(f);
  });
  test('host shutdown during restore cleanup prevents later publication', async () => {
    vi.useFakeTimers(); const f = fixture({timeoutMs: 40}); await f.client.ready;
    const before = f.client.snapshot(), saved = structuredClone(before); saved.game.ap = 0;
    f.messages.setRewrite((m, side) => side === 0 && m.kind === 'restore' ? null : m);
    const pending = f.client.restore(saved), rejected = expect(pending).rejects.toThrow(/timed out/);
    f.messages.deliver(1, f.messages.sent[0].find(m => m.kind === 'restore')!);
    await f.host.close(); await vi.advanceTimersByTimeAsync(41); await rejected;
    expect(f.session.snapshot()).toEqual(before); expect(f.client.snapshot()).toEqual(before);
    expect(f.client.state.uncertain).toBe(true); await finish(f);
  });
  test('restore cannot interrupt an active preview mutation', async () => {
    const entered = deferred(), gate = deferred(), f = fixture({step: async () => {entered.resolve(); await gate.promise;}}); await f.client.ready;
    const t = f.client.request({label: 'running'}, 1); await entered.promise; expect(() => f.client.restore(f.client.snapshot())).toThrow(/idle/); t.cancel(); gate.resolve(); await t.result; await finish(f);
  });
  test('close waits for active cancellation before disposing the transport', async () => {
    const entered = deferred(), gate = deferred(), f = fixture({step: async () => {entered.resolve(); await gate.promise;}}); await f.client.ready;
    const t = f.client.request({label: 'running'}, 2); await entered.promise; const end = f.client.close(); expect(f.messages.closed[0]).toBe(false);
    gate.resolve(); expect((await t.result).status).toBe('closed'); await end; expect(f.client.state.status).toBe('closed'); expect(f.cleaned).toHaveBeenCalledTimes(1); await finish(f);
  });
  test('transport failure during preview retains confirmed state without uncertain mutation', async () => {
    const entered = deferred(), gate = deferred(), f = fixture({step: async () => {entered.resolve(); await gate.promise;}}); await f.client.ready;
    const before = f.client.snapshot(), t = f.client.request({label: 'lost'}, 2); await entered.promise; f.messages.fault(0); gate.resolve();
    expect((await t.result).status).toBe('failed'); expect(f.client.snapshot()).toEqual(before); expect(f.client.state.uncertain).toBe(false); await finish(f);
  });
  test('handshake identity mismatch is rejected before exposing a snapshot', async () => {
    const messages = link(); messages.setRewrite((m, side) => {if (side === 1 && m.kind === 'hello') (m.payload as {worldId: string}).worldId = 'wrong-world'; return m;});
    const session = createTacticalSessionCore3D(initial(), () => {throw Error('No ticks');}), host = createTacticalWorkerHost3D(messages.ports[1], session, stage, options.channel);
    const client = createTacticalWorkerClient3D<Game, Command>(messages.ports[0], options); await expect(client.ready).rejects.toThrow(/identity/);
    expect(() => client.snapshot()).toThrow(/handshake/); await host.close();
  });
  test('handshake timeout terminates its owned endpoint', async () => {
    vi.useFakeTimers(); const messages = link(), client = createTacticalWorkerClient3D<Game, Command>(messages.ports[0], {...options, timeoutMs: 20});
    const failed = expect(client.ready).rejects.toThrow(/timed out/); await vi.advanceTimersByTimeAsync(21); await failed; expect(messages.closed[0]).toBe(true);
  });
  test('worker cleanup failure prevents the next queued command', async () => {
    const entered = deferred(), gate = deferred(), f = fixture({step: async () => {entered.resolve(); await gate.promise;}, close: () => {throw Error('cleanup failed');}});
    await f.client.ready; const first = f.client.request({label: 'old'}, 1); await entered.promise; const next = f.client.request({label: 'next'}, 1); gate.resolve();
    expect((await first.result).status).toBe('failed'); expect((await next.result).status).toBe('failed'); expect(f.made).toHaveBeenCalledTimes(1); await finish(f);
  });
  test('host listener cleanup failure still cancels the preview and closes its driver', async () => {
    const entered = deferred(), gate = deferred();
    const f = fixture({hostCleanupThrows: true, step: async () => {entered.resolve(); await gate.promise;}}); await f.client.ready;
    const before = f.session.snapshot(), ticket = f.client.request({label: 'cancelled'}, 2); await entered.promise;
    const close = f.host.close(), failed = expect(close).rejects.toThrow(/host cleanup failed/);
    gate.resolve(); await failed; expect(f.cleaned).toHaveBeenCalledTimes(1); expect(f.stepped).toHaveBeenCalledTimes(1);
    expect(f.session.snapshot()).toEqual(before); f.messages.fault(0); expect((await ticket.result).status).toBe('failed'); await finish(f);
  });
  test('a synchronous host transport failure cleans its returned subscription once', async () => {
    const remove = vi.fn(() => {throw Error('Host listener cleanup failed');});
    const transport: TacticalTransport3D = {send() {}, close() {}, subscribe(_receive, failed) {
      failed(Error('Transport startup failed')); return remove;
    }};
    const session = createTacticalSessionCore3D(initial(), () => {throw Error('No ticks');});
    const host = createTacticalWorkerHost3D(transport, session, stage, options.channel);
    await expect(host.close()).rejects.toThrow(/host cleanup failed/); expect(remove).toHaveBeenCalledTimes(1);
  });
  test('browser adapter installs transport error handlers and terminates only its worker', () => {
    const handlers = new Map<string, (event: {data?: unknown}) => void>(), terminate = vi.fn(), postMessage = vi.fn();
    const worker = {postMessage, terminate, addEventListener: (type: string, fn: (e: {data?: unknown}) => void) => handlers.set(type, fn),
      removeEventListener: (type: string) => handlers.delete(type)} as unknown as Worker;
    const port = tacticalBrowserWorkerTransport3D(worker), receive = vi.fn(), failed = vi.fn(), unsubscribe = port.subscribe(receive, failed);
    port.send({hello: 1}); expect(postMessage).toHaveBeenCalledWith({hello: 1}); handlers.get('message')!({data: 7}); expect(receive).toHaveBeenCalledWith(7);
    handlers.get('messageerror')!({}); expect(failed).toHaveBeenCalledTimes(1); unsubscribe(); expect(handlers.size).toBe(0); port.close(); expect(terminate).toHaveBeenCalledTimes(1);
  });
  test('subscription cleanup failure still disposes the endpoint and rejects close', async () => {
    const messages = link(), subscribe = messages.ports[0].subscribe;
    messages.ports[0].subscribe = (receive, failed) => {
      const remove = subscribe(receive, failed); return () => {remove(); throw Error('unsubscribe failed');};
    };
    const session = createTacticalSessionCore3D(initial(), () => {throw Error('No ticks');});
    const host = createTacticalWorkerHost3D(messages.ports[1], session, stage, options.channel);
    const client = createTacticalWorkerClient3D<Game, Command>(messages.ports[0], options); await client.ready;
    const before = client.snapshot(); await expect(client.close()).rejects.toThrow(/unsubscribe failed/);
    expect(messages.closed[0]).toBe(true); expect(client.snapshot()).toEqual(before); expect(client.state.status).toBe('failed'); await host.close();
  });
});
