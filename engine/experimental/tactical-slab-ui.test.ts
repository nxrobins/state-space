import { holdPhysics, STRUCTURAL_CALLS } from '../test-support/hold-physics.js';
/** UI/transport scheduling with inert drivers and mock DOM/GPU ports only. */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createSlabUIModel, parseSlabSave, type SlabUIModel } from '../../examples/tactical-slab/ui-model.js';
import { createSlabFramePump, createSlabRuntimeGuard, slabOrbitCamera } from '../../examples/tactical-slab/ui-runtime.js';
import * as hostPorts from '../../examples/tactical-slab/ui-host.js';
import { mountSlabUI } from '../../examples/tactical-slab/ui-app.js';
import { createSlabInitial, createSlabPolicy, prepareSlabCommand, type SlabGame, type SlabCommand } from '../../examples/tactical-slab/scenario.js';
import { createTacticalSessionCore3D, type TacticalSimulationFactory3D } from './tactical-session-core.js';
import { createTacticalWorkerClient3D } from './tactical-worker-client.js';
import { createTacticalWorkerHost3D } from './tactical-worker-host.js';
import { projectTacticalPoint3D, type TacticalRenderer3D } from './tactical-renderer.js';

import { observe } from './terrain-motion.fixtures.js';
holdPhysics('solveStructure3D', ...STRUCTURAL_CALLS);
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});
function deferred<T>() {let resolve!: (v: T) => void; const promise = new Promise<T>(r => {resolve = r;}); return {promise, resolve};}
async function until(test: () => boolean) {for (let i = 0; i < 400; i++) {if (test()) return; await Promise.resolve();} throw Error('Expected asynchronous boundary did not arrive.');}
async function fixture() {
  let steps = 0;
  const driver: TacticalSimulationFactory3D = input => {
    let s = structuredClone(input), result: ReturnType<typeof observe>;
    return {load(next) {s = structuredClone(next);}, step() {steps++; result = observe(s, {after: s}); s = result.after;}, snapshot: () => s, motion: () => result.motion, paths: () => result.paths, close() {}};
  };
  const session = createTacticalSessionCore3D(createSlabInitial(), driver, createSlabPolicy(), async () => {});
  type Message = {kind: string; payload: unknown};
  let serverReceive = (_: unknown) => {}, clientReceive = (_: unknown) => {}, failed = (_: Error) => {}, hold: string | null = null;
  const sent: Message[] = [], held: unknown[] = [];
  const server = createTacticalWorkerHost3D<SlabGame, SlabCommand>({send(value) {if ((value as Message).kind === hold) held.push(structuredClone(value)); else queueMicrotask(() => clientReceive(structuredClone(value)));},
    subscribe(fn) {serverReceive = fn; return () => {serverReceive = () => {};};}, close() {}}, session, prepareSlabCommand, 'slab-ui-test');
  const client = createTacticalWorkerClient3D<SlabGame, SlabCommand>({send(value) {sent.push(structuredClone(value) as Message); queueMicrotask(() => serverReceive(structuredClone(value)));},
    subscribe(fn, error) {clientReceive = fn; failed = error; return () => {clientReceive = () => {};};}, close() {}}, {channel: 'slab-ui-test', worldId: 'hot-slab-chamber', gameRulesVersion: 'hot-slab-game-4'});
  const guard = vi.fn(async () => {}), model = await createSlabUIModel(client, guard);
  return {session, client, model, guard, sent, held, steps: () => steps, hold(kind: string) {hold = kind;},
    release() {hold = null; for (const reply of held.splice(0)) queueMicrotask(() => clientReceive(reply));}, fail() {failed(Error('connection failed'));},
    async close() {hold = null; for (const reply of held.splice(0)) clientReceive(reply); try {await model.close();} catch { /* Deliberate failed transport cases. */ } await server.close();}};
}

describe('worker-owned tactical UI state', () => {
  test('wind preview and A/B expose saved controls only at the displayed boundary', async () => {
    const f = await fixture(), saved = f.model.save(); expect(await f.model.preview({kind: 'wind', parcel: 'steam', direction: 'east'}, 0)).toBe('ready');
    expect(f.model.view().observation.wind.cycle).toBe(1); expect(f.model.save()).toBe(saved);
    f.model.show('committed'); expect(f.model.view().observation.wind.cycle).toBe(0); f.model.show('preview'); expect(f.model.view().observation.wind.parcels[1].velocityQ).toEqual([512, 0, 0]);
    await f.model.commit(); expect(JSON.parse(f.model.save()).game.wind.cycle).toBe(1); expect(f.steps()).toBe(0); await f.close();
  });
  test('worker-owned drift continues saved momentum after restore', async () => {
    const f = await fixture(); await f.model.preview({kind: 'wind', parcel: 'steam', direction: 'east'}, 0); await f.model.commit(); const saved = f.model.save();
    await f.model.preview({kind: 'drift'}, 0); const preview = f.model.view().observation.wind; f.model.discard(); await until(() => f.model.view().canRestore); await f.model.restore(saved);
    await f.model.preview({kind: 'drift'}, 0); expect(f.model.view().observation.wind).toEqual(preview); await f.model.commit(); expect(f.model.view().committedAP).toBe(1); await f.close();
  });
  test('initializes from one five-query batch and no physical work', async () => {
    const f = await fixture(); expect(f.steps()).toBe(0); expect(f.sent.filter(m => m.kind === 'query')).toHaveLength(1);
    expect(f.model.view()).toMatchObject({status: 'idle', committedAP: 3, displayedAP: 3, committedRevision: 0}); expect(f.model.scene().actors).toBe(2); await f.close();
  });
  test('zero-tick lift previews changed cover and rider while preserving committed save', async () => {
    const f = await fixture(), save = f.model.save(); expect(await f.model.preview({kind: 'lift'}, 0)).toBe('ready');
    expect(f.model.save()).toBe(save); expect(f.model.view()).toMatchObject({horizon: 0, displayedAP: 2, committedAP: 3, observation: {firingLine: 'blocked'}});
    f.model.show('committed'); expect(f.model.view().observation.firingLine).toBe('open'); f.model.show('preview'); expect(f.model.view().observation.units[0].body.minQ[1]).toBe(2304); await f.close();
  });
  test('default horizon requests two exact ticks through the injected inert worker driver', async () => {
    const f = await fixture(); expect(await f.model.preview({kind: 'wait'})).toBe('ready'); expect(f.steps()).toBe(2); expect(f.model.view()).toMatchObject({horizon: 2, displayedTick: 2, baseTick: 0}); await f.close();
  });
  test('air preview uses the worker reducer supports A/B and publishes only after commit acknowledgement', async () => {
    const f = await fixture(), save = f.model.save(), startY = f.model.view().observation.units[1].body.minQ[1];
    expect(await f.model.preview({kind: 'air', unit: 'scout', direction: 'up'}, 2)).toBe('ready'); expect(f.model.save()).toBe(save); expect(f.steps()).toBe(2);
    expect(f.model.view()).toMatchObject({displayedAP: 2, committedAP: 3, displayedTick: 2, horizon: 2}); expect(f.model.view().observation.units[1].body.minQ[1]).toBe(startY - 832);
    f.model.show('committed'); expect(f.model.view().observation.units[1].body.minQ[1]).toBe(startY); f.model.show('preview'); await f.model.commit();
    const saved = JSON.parse(f.model.save()); expect(saved.game.ap).toBe(2); expect(saved.game.pendingAir).toBeNull(); expect(saved.game.units[1].body.velocityQ[1]).toBe(-384); await f.close();
  });
  test('zero-tick air and v1 imports retain a current candidate without worker mutations', async () => {
    const f = await fixture(); await f.model.preview({kind: 'lift'}, 0); const scene = f.model.scene(), save = f.model.save(), sent = f.sent.length;
    expect(() => f.model.preview({kind: 'air', unit: 'scout', direction: 'up'}, 0)).toThrow(/at least one/);
    const old = JSON.parse(save); old.gameRulesVersion = old.game.rulesVersion = 'hot-slab-game-1'; await expect(f.model.restore(JSON.stringify(old))).rejects.toThrow();
    expect(f.sent.length).toBe(sent); expect(f.model.scene()).toBe(scene); expect(f.model.save()).toBe(save); expect(f.model.view().canCommit).toBe(true); await f.close();
  });
  test('discarding a delayed air result retains acknowledged actors AP and velocity', async () => {
    const f = await fixture(), save = f.model.save(); f.hold('preview'); const pending = f.model.preview({kind: 'air', unit: 'scout', direction: 'east'}, 2);
    await until(() => f.held.length === 1); f.model.discard(); f.release(); expect(await pending).toBe('cancelled'); expect(f.model.save()).toBe(save); expect(f.model.view().mode).toBe('committed'); await f.close();
  });
  test('invalid commands and horizons preserve the ready candidate and save', async () => {
    const f = await fixture(); await f.model.preview({kind: 'lift'}, 0); const scene = f.model.scene(), save = f.model.save();
    for (const horizon of [-1, 9, 0.1, NaN]) expect(() => f.model.preview({kind: 'wait'}, horizon)).toThrow(); expect(() => f.model.preview({kind: 'heat', deltaQ: 0}, 0)).toThrow();
    expect(f.model.scene()).toBe(scene); expect(f.model.save()).toBe(save); expect(f.model.view().canCommit).toBe(true); await f.close();
  });
  test('coalesces rapid guarded intents to the latest one without dispatching older commands', async () => {
    const f = await fixture(), gate = deferred<void>(); f.guard.mockReturnValueOnce(gate.promise);
    const a = f.model.preview({kind: 'heat', deltaQ: 1}, 0), b = f.model.preview({kind: 'wait'}, 0), c = f.model.preview({kind: 'lift'}, 0);
    expect(await b).toBe('superseded'); gate.resolve(); expect(await a).toBe('superseded'); expect(await c).toBe('ready'); expect(f.sent.filter(m => m.kind === 'preview')).toHaveLength(1); await f.close();
  });
  test('waits for an old query to finish before dispatching its replacement and suppresses stale display', async () => {
    const f = await fixture(); f.hold('query-preview'); const a = f.model.preview({kind: 'lift'}, 0); await until(() => f.held.length === 1);
    const b = f.model.preview({kind: 'heat', deltaQ: 1}, 0); expect(f.sent.filter(m => m.kind === 'preview')).toHaveLength(1); expect(f.model.view().canCommit).toBe(false);
    f.release(); expect(await a).toBe('superseded'); expect(await b).toBe('ready'); expect(f.model.view().observation.firingLine).toBe('open'); await f.close();
  });
  test('discarding a delayed preview never publishes or spends its resources', async () => {
    const f = await fixture(), save = f.model.save(); f.hold('preview'); const pending = f.model.preview({kind: 'lift'}, 0); await until(() => f.held.length === 1);
    f.model.discard(); f.release(); expect(await pending).toBe('cancelled'); expect(f.model.save()).toBe(save); expect(f.model.view().mode).toBe('committed'); await f.close();
  });
  test('discarding a ready preview rejects later commit', async () => {
    const f = await fixture(); await f.model.preview({kind: 'lift'}, 0); f.model.discard(); await expect(f.model.commit()).rejects.toThrow(/ready/); await f.close();
  });
  test('publishes commit state only after acknowledgement and rejects overlap', async () => {
    const f = await fixture(), save = f.model.save(); await f.model.preview({kind: 'lift'}, 0); f.hold('commit'); const commit = f.model.commit(); await until(() => f.held.length === 1);
    expect(f.model.save()).toBe(save); expect(() => f.model.preview({kind: 'wait'}, 0)).toThrow(/mutation/); await expect(f.model.commit()).rejects.toThrow();
    f.release(); await commit; expect(f.model.view()).toMatchObject({committedRevision: 1, displayedRevision: 1, committedAP: 2, mode: 'committed'}); expect(JSON.parse(f.model.save()).game.units[0].body.minQ[1]).toBe(2304); await f.close();
  });
  test('lost commit reply reports uncertainty and keeps the last acknowledged save without retry', async () => {
    const f = await fixture(), save = f.model.save(); await f.model.preview({kind: 'lift'}, 0); f.hold('commit'); const pending = f.model.commit(), rejected = expect(pending).rejects.toThrow(/uncertain/); await until(() => f.held.length === 1);
    f.fail(); await rejected; expect(f.model.view()).toMatchObject({uncertain: true, status: 'failed', committedRevision: 0}); expect(f.model.save()).toBe(save); expect(f.sent.filter(m => m.kind === 'commit')).toHaveLength(1); await f.close();
  });
  test('inspection failure after commit retains the acknowledged save and labels the older display', async () => {
    const f = await fixture(); await f.model.preview({kind: 'lift'}, 0); f.hold('query'); const pending = f.model.commit(), rejected = expect(pending).rejects.toThrow(/Commit acknowledged/); await until(() => f.held.length === 1);
    f.fail(); await rejected; expect(f.model.view()).toMatchObject({committedRevision: 1, displayedRevision: 0, uncertain: false}); expect(JSON.parse(f.model.save()).game.ap).toBe(2); await f.close();
  });
  test('invalid saves are atomic and retain a candidate', async () => {
    const f = await fixture(); await f.model.preview({kind: 'lift'}, 0); const scene = f.model.scene(), save = f.model.save();
    for (const text of ['{', '{}', 'x'.repeat(262145), JSON.stringify({...JSON.parse(save), preview: {}})]) await expect(f.model.restore(text)).rejects.toThrow();
    expect(f.model.scene()).toBe(scene); expect(f.model.save()).toBe(save); expect(f.model.view().canCommit).toBe(true); await f.close();
  });
  test('restores a complete save through the worker and invalidates the candidate', async () => {
    const f = await fixture(), original = f.model.save(); await f.model.preview({kind: 'lift'}, 0); await f.model.commit(); await f.model.preview({kind: 'heat', deltaQ: 1}, 0);
    await f.model.restore(original); expect(f.model.view()).toMatchObject({committedRevision: 2, displayedAP: 3, mode: 'committed', observation: {firingLine: 'open'}}); expect(JSON.parse(f.model.save()).game).toEqual(JSON.parse(original).game); await f.close();
  });
  test('a reactivated runtime hold blocks commit before transmission and retains the ready candidate', async () => {
    const f = await fixture(); await f.model.preview({kind: 'lift'}, 0); f.guard.mockRejectedValueOnce(Error('held'));
    await expect(f.model.commit()).rejects.toThrow(/held/); expect(f.sent.some(m => m.kind === 'commit')).toBe(false); expect(f.model.view().canCommit).toBe(true); await f.close();
  });
  test('close waits through an in-flight query and suppresses its result', async () => {
    const f = await fixture(); f.hold('query-preview'); const pending = f.model.preview({kind: 'lift'}, 0); await until(() => f.held.length === 1);
    const closed = f.model.close(); f.release(); expect(await pending).toBe('closed'); await closed; expect(f.model.view().status).toBe('closed'); await f.close();
  });
  test('failed UI cancels active work and resolves the waiting intent', async () => {
    const f = await fixture(), gate = deferred<void>(); f.guard.mockReturnValueOnce(gate.promise); const a = f.model.preview({kind: 'lift'}, 0), b = f.model.preview({kind: 'wait'}, 0);
    f.model.fail('renderer failed'); gate.resolve(); expect(await a).toBe('failed'); expect(await b).toBe('failed'); expect(f.sent.some(m => m.kind === 'preview')).toBe(false); await f.close();
  });
  test('view inspection and parsed save results cannot mutate stored or rendered state', async () => {
    const f = await fixture(), save = f.model.save(), view = f.model.view(); view.observation.units[0].body.minQ[0] = 0;
    const cell = f.model.inspectCell(2, 5, 2); expect(cell.integrity).toBe(96); expect(cell.energyQ).toBeGreaterThan(0); expect(() => f.model.inspectCell(8, 0, 0)).toThrow();
    parseSlabSave(save).game.ap = 0; expect(f.model.save()).toBe(save); expect(f.model.view().observation.units[0].body.minQ[0]).toBe(2304); await f.close();
  });
});

function frameFixture() {
  let serial = 0; const callbacks = new Map<number, () => void>();
  const guard = vi.fn(async () => {}), draw = vi.fn(async () => {}), error = vi.fn();
  const pump = createSlabFramePump({requestFrame(cb) {callbacks.set(++serial, cb); return serial;}, cancelFrame(id) {callbacks.delete(id);}, guard, draw, onError: error});
  return {pump, callbacks, guard, draw, error, fire() {const [id, cb] = callbacks.entries().next().value!; callbacks.delete(id); cb();}};
}
describe('runtime gate and bounded frame scheduling', () => {
  test('blocks missing unreadable malformed and active runtime holds', async () => {
    for (const value of [null, [], {}, {blockRecovery: true}, {blockRecovery: 0}, {blockRecovery: 'false'}]) {
      const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({ok: true, json: async () => value} as Response)); await expect(createSlabRuntimeGuard(fetcher, 'http://localhost/dist/tactical-slab/index.html')()).rejects.toThrow();
      expect(String(fetcher.mock.calls[0][0])).toBe('http://localhost/dist/verification/safety-hold.json');
    }
    await expect(createSlabRuntimeGuard(async () => ({ok: false} as Response), 'http://localhost/dist/tactical-slab/')()).rejects.toThrow(/read/);
  });
  test('requires explicit cleared hold and disables HTTP caching', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({ok: true, json: async () => ({blockRecovery: false})} as Response));
    await createSlabRuntimeGuard(fetcher, 'http://localhost/dist/tactical-slab/')(); expect(fetcher.mock.calls[0][1]?.cache).toBe('no-store');
  });
  test('bounds hold reads with an abort and clears the timer', async () => {
    vi.useFakeTimers(); const fetcher: typeof fetch = (_url, options) => new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(Error('aborted'))));
    const checked = expect(createSlabRuntimeGuard(fetcher, 'http://localhost/dist/tactical-slab/')()).rejects.toThrow(/aborted/); await vi.advanceTimersByTimeAsync(2000); await checked; expect(vi.getTimerCount()).toBe(0);
  });
  test('orbit cameras use the shared projection without modifying simulation', () => {
    const camera = slabOrbitCamera(0.6, 0.55, 14), p = projectTacticalPoint3D(camera, [4096, 4096, 4096], 1280, 720)!;
    expect(p.x).toBeCloseTo(640, 3); expect(p.y).toBeCloseTo(360, 3); expect(p.visible).toBe(true); expect(() => slabOrbitCamera(0, 2, 14)).toThrow();
  });
  test('coalesces camera invalidations to one pending and one outstanding frame', async () => {
    const f = frameFixture(), done = deferred<void>(); f.draw.mockReturnValueOnce(done.promise);
    for (let i = 0; i < 20; i++) f.pump.invalidate(); expect(f.callbacks.size).toBe(1); f.fire(); await until(() => f.draw.mock.calls.length === 1);
    for (let i = 0; i < 20; i++) f.pump.invalidate(); expect(f.callbacks.size).toBe(0); done.resolve(); await until(() => f.callbacks.size === 1); f.fire(); await until(() => f.draw.mock.calls.length === 2); await f.pump.close();
  });
  test('settled waits for a scheduled frame and its draw completion', async () => {
    const f = frameFixture(), done = deferred<void>(); f.draw.mockReturnValueOnce(done.promise);
    f.pump.invalidate(); let settled = false; const waiting = f.pump.settled().then(() => {settled = true;});
    await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false);
    f.fire(); await until(() => f.draw.mock.calls.length === 1); expect(settled).toBe(false);
    done.resolve(); await waiting; await f.pump.close();
  });
  test('settled includes the dirty successor but does not chase later invalidations', async () => {
    const f = frameFixture(), first = deferred<void>(), second = deferred<void>();
    f.draw.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    f.pump.invalidate(); f.fire(); await until(() => f.draw.mock.calls.length === 1);
    f.pump.invalidate(); let settled = false; const waiting = f.pump.settled().then(() => {settled = true;});
    first.resolve(); await until(() => f.callbacks.size === 1); await Promise.resolve(); expect(settled).toBe(false);
    f.fire(); await until(() => f.draw.mock.calls.length === 2); expect(settled).toBe(false);
    f.pump.invalidate(); second.resolve(); await waiting;
    expect(f.draw).toHaveBeenCalledTimes(2); await f.pump.close();
  });
  test('close rejects completion waits for cancelled frames', async () => {
    const f = frameFixture(); f.pump.invalidate(); const waiting = expect(f.pump.settled()).rejects.toThrow(/closed/);
    await f.pump.close(); await waiting; await expect(f.pump.settled()).rejects.toThrow(/closed/);
  });
  test('draw failure rejects both active and queued completion waits', async () => {
    const f = frameFixture(), done = deferred<void>(); f.draw.mockImplementation(async () => {await done.promise; throw Error('draw failed');});
    f.pump.invalidate(); f.fire(); await until(() => f.draw.mock.calls.length === 1);
    const active = expect(f.pump.settled()).rejects.toThrow('draw failed');
    f.pump.invalidate(); const queued = expect(f.pump.settled()).rejects.toThrow('draw failed');
    done.resolve(); await Promise.all([active, queued]); await f.pump.close();
  });
  test('close cancels a scheduled frame without drawing', async () => {
    const f = frameFixture(); f.pump.invalidate(); await f.pump.close(); expect(f.callbacks.size).toBe(0); expect(f.draw).not.toHaveBeenCalled(); f.pump.invalidate(); expect(f.callbacks.size).toBe(0);
  });
  test('close drains an outstanding frame without scheduling a dirty successor', async () => {
    const f = frameFixture(), done = deferred<void>(); f.draw.mockReturnValue(done.promise); f.pump.invalidate(); f.fire(); await until(() => f.draw.mock.calls.length === 1); f.pump.invalidate();
    const cancelled = expect(f.pump.settled()).rejects.toThrow(/closed/);
    let closed = false; const pending = f.pump.close().then(() => {closed = true;}); await Promise.resolve(); expect(closed).toBe(false); done.resolve(); await pending; await cancelled; expect(f.callbacks.size).toBe(0);
  });
  test('close during the guard cancels completion without starting a draw', async () => {
    const f = frameFixture(), gate = deferred<void>(); f.guard.mockReturnValue(gate.promise);
    await f.pump.settled(); f.pump.invalidate(); f.fire(); await until(() => f.guard.mock.calls.length === 1);
    const cancelled = expect(f.pump.settled()).rejects.toThrow(/closed/), closed = f.pump.close();
    gate.resolve(); await closed; await cancelled; expect(f.draw).not.toHaveBeenCalled();
  });
  test('reactivated hold blocks a frame and stops future scheduling', async () => {
    const f = frameFixture(); f.guard.mockRejectedValue(Error('held')); f.pump.invalidate(); f.fire(); await until(() => f.error.mock.calls.length === 1);
    expect(f.draw).not.toHaveBeenCalled(); f.pump.invalidate(); expect(f.callbacks.size).toBe(0); await f.pump.close();
  });
  test.each([undefined, Error('')])('a draw error stops the pump even when its error callback throws: %s', async failure => {
    const f = frameFixture(); f.draw.mockRejectedValue(failure); f.error.mockImplementation(() => {throw Error('callback');}); f.pump.invalidate(); f.fire(); await until(() => f.error.mock.calls.length === 1);
    expect(f.pump.state().error).toBe('Frame failed.'); f.pump.invalidate(); expect(f.callbacks.size).toBe(0); await f.pump.close();
  });
});

describe('explicit startup and cleanup', () => {
  function ports() {
    const controller = new AbortController(), device = {destroy: vi.fn()}, client = {close: vi.fn(async () => {})}, model = {close: vi.fn(async () => {})}, renderer = {close: vi.fn(async () => {})};
    const options = {signal: controller.signal, guard: vi.fn(async () => {}), device: vi.fn(async () => device as unknown as GPUDevice), client: vi.fn(() => client as unknown as Parameters<typeof createSlabUIModel>[0]),
      model: vi.fn(async () => model as unknown as SlabUIModel), renderer: vi.fn(async () => renderer as unknown as TacticalRenderer3D)};
    return {controller, device, client, model, renderer, options};
  }
  test('held startup acquires neither a device nor a worker', async () => {
    const p = ports(); p.options.guard.mockRejectedValue(Error('held')); await expect(hostPorts.openSlabUIRuntime(p.options)).rejects.toThrow(/held/); expect(p.options.device).not.toHaveBeenCalled(); expect(p.options.client).not.toHaveBeenCalled();
  });
  test('model startup failure cleans the client and owned device', async () => {
    const p = ports(); p.options.model.mockRejectedValue(Error('model')); await expect(hostPorts.openSlabUIRuntime(p.options)).rejects.toThrow(/model/); expect(p.client.close).toHaveBeenCalledTimes(1); expect(p.device.destroy).toHaveBeenCalledTimes(1);
  });
  test('renderer startup failure closes the model and device', async () => {
    const p = ports(); p.options.renderer.mockRejectedValue(Error('renderer')); await expect(hostPorts.openSlabUIRuntime(p.options)).rejects.toThrow(/renderer/); expect(p.model.close).toHaveBeenCalledTimes(1); expect(p.device.destroy).toHaveBeenCalledTimes(1);
  });
  test('cancellation during device acquisition disposes it without starting a worker', async () => {
    const p = ports(), acquired = deferred<GPUDevice>(); p.options.device.mockReturnValue(acquired.promise); const pending = hostPorts.openSlabUIRuntime(p.options), rejected = expect(pending).rejects.toThrow(/cancelled/);
    await until(() => p.options.device.mock.calls.length === 1); p.controller.abort(); acquired.resolve(p.device as unknown as GPUDevice); await rejected; expect(p.device.destroy).toHaveBeenCalledTimes(1); expect(p.options.client).not.toHaveBeenCalled();
  });
  test('close drains both owned components and destroys the device once even on failure', async () => {
    const p = ports(), done = deferred<void>(), runtime = await hostPorts.openSlabUIRuntime(p.options); p.renderer.close.mockReturnValue(done.promise); p.model.close.mockRejectedValue(Error('close failed'));
    const closing = runtime.close(), rejected = expect(closing).rejects.toThrow(/close failed/); expect(runtime.close()).toBe(closing); await Promise.resolve(); expect(p.device.destroy).not.toHaveBeenCalled(); done.resolve(); await rejected; expect(p.device.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('DOM adapter remains inert behind the hold', () => {
  test('air and wind controls dispatch selections and horizon through the existing UI model', async () => {
    const f = await fixture(), context = {configure: vi.fn(), unconfigure: vi.fn()};
    class Element extends EventTarget {textContent = ''; disabled = false; value = ''; dataset: {command?: string} = {}; replaceChildren = vi.fn(); getContext() {return context;}}
    const ids = ['scene', 'message', 'start', 'stop', 'commit', 'discard', 'compare', 'reset', 'save', 'import', 'inspect', 'boundary', 'resources', 'consequences', 'parcels', 'units', 'status', 'air-unit', 'air-direction', 'wind-parcel', 'wind-direction', 'horizon'];
    const elements = new Map(ids.map(id => [id, new Element()])), button = new Element(); button.dataset.command = 'air';
    elements.get('air-unit')!.value = 'scout'; elements.get('air-direction')!.value = 'east'; elements.get('horizon')!.value = '1';
    const document = Object.assign(new EventTarget(), {baseURI: 'http://localhost/dist/tactical-slab/index.html', getElementById: (id: string) => elements.get(id), querySelectorAll: () => [button], createElement: () => new Element()});
    const window = Object.assign(new EventTarget(), {fetch: vi.fn(), requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn(), setInterval: vi.fn(() => 1), clearInterval: vi.fn(),
      ResizeObserver: class {observe() {} disconnect() {}}});
    const runtime = {model: f.model, client: f.client, device: {}, renderer: {}, close: async () => f.model.close()};
    const open = vi.spyOn(hostPorts, 'openSlabUIRuntime').mockResolvedValue(runtime as unknown as Awaited<ReturnType<typeof hostPorts.openSlabUIRuntime>>);
    let dispose: (() => Promise<void>) | undefined;
    try {
      dispose = mountSlabUI(document as unknown as Document, window as unknown as Window & typeof globalThis); elements.get('start')!.dispatchEvent(new Event('click')); await until(() => window.setInterval.mock.calls.length === 1);
      button.dispatchEvent(new Event('click')); await until(() => f.model.view().status === 'ready'); await until(() => elements.get('units')!.replaceChildren.mock.calls.at(-1)?.some((p: Element) => p.textContent.includes('velocity [512, 0, 0]')) ?? false);
      expect(f.model.view().horizon).toBe(1); expect(f.model.view().observation.units[1].body.minQ[0]).toBe(5888); expect(f.model.view().committedAP).toBe(3);
      elements.get('air-unit')!.value = 'rider'; elements.get('air-direction')!.value = 'west'; button.dispatchEvent(new Event('click'));
      await until(() => f.model.view().status === 'ready'); expect(f.model.view().observation.units[0].body.minQ[0]).toBe(1792); expect(f.model.view().observation.units[1].body.minQ[0]).toBe(5376);
      button.dataset.command = 'wind'; elements.get('wind-parcel')!.value = 'steam'; elements.get('wind-direction')!.value = 'east'; elements.get('horizon')!.value = '0'; button.dispatchEvent(new Event('click'));
      await until(() => f.model.view().status === 'ready'); await until(() => elements.get('parcels')!.textContent.includes('velocity [512, 0, 0]'));
      expect(f.model.view().observation.wind.cycle).toBe(1); expect(f.model.view().horizon).toBe(0); expect(f.model.view().committedAP).toBe(3);
    } finally {await dispose?.(); open.mockRestore(); await f.close();}
  });
  test('a canvas observer startup failure disposes partially acquired resources and permits retry', async () => {
    const f = await fixture(), context = {configure: vi.fn(), unconfigure: vi.fn()}, disconnect = vi.fn();
    class Element extends EventTarget {textContent = ''; disabled = false; value = ''; dataset = {}; replaceChildren = vi.fn(); getContext() {return context;}}
    const ids = ['scene', 'message', 'start', 'stop', 'commit', 'discard', 'compare', 'reset', 'save', 'import', 'inspect', 'boundary', 'resources', 'consequences', 'parcels', 'units', 'status'];
    const elements = new Map(ids.map(id => [id, new Element()]));
    const document = Object.assign(new EventTarget(), {baseURI: 'http://localhost/dist/tactical-slab/index.html', getElementById: (id: string) => elements.get(id), querySelectorAll: () => [], createElement: () => new Element()});
    const window = Object.assign(new EventTarget(), {fetch: vi.fn(), requestAnimationFrame: vi.fn(), cancelAnimationFrame: vi.fn(), setInterval: vi.fn(), clearInterval: vi.fn(),
      ResizeObserver: class {observe() {throw Error('observer failed');} disconnect() {disconnect();}}});
    const close = vi.fn(async () => {await f.model.close();}), runtime = {model: f.model, client: f.client, device: {}, renderer: {}, close};
    const open = vi.spyOn(hostPorts, 'openSlabUIRuntime').mockResolvedValue(runtime as unknown as Awaited<ReturnType<typeof hostPorts.openSlabUIRuntime>>);
    let dispose: (() => Promise<void>) | undefined;
    try {
      dispose = mountSlabUI(document as unknown as Document, window as unknown as Window & typeof globalThis); elements.get('start')!.dispatchEvent(new Event('click'));
      await until(() => close.mock.calls.length === 1); await until(() => !elements.get('start')!.disabled);
      expect(disconnect).toHaveBeenCalledTimes(1); expect(context.unconfigure).toHaveBeenCalledTimes(1); expect(window.setInterval).not.toHaveBeenCalled(); expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    } finally {await dispose?.(); open.mockRestore(); await f.close();}
  });
  test('mount binds controls without acquisition; blocked Start and teardown leave apps untouched', async () => {
    class Element extends EventTarget {textContent = ''; disabled = false; value = ''; dataset = {};}
    const elements = new Map(['scene', 'message', 'start', 'stop', 'commit', 'discard', 'compare', 'reset', 'save', 'import', 'inspect'].map(id => [id, new Element()]));
    const document = Object.assign(new EventTarget(), {baseURI: 'http://localhost/dist/tactical-slab/index.html', getElementById: (id: string) => elements.get(id), querySelectorAll: () => []});
    const requestAdapter = vi.fn(), Worker = vi.fn(), fetcher = vi.fn(async () => ({ok: true, json: async () => ({blockRecovery: true})}));
    const window = Object.assign(new EventTarget(), {fetch: fetcher, navigator: {gpu: {requestAdapter}}, Worker});
    const dispose = mountSlabUI(document as unknown as Document, window as unknown as Window & typeof globalThis);
    expect(fetcher).not.toHaveBeenCalled(); expect(requestAdapter).not.toHaveBeenCalled(); elements.get('start')!.dispatchEvent(new Event('click'));
    await until(() => elements.get('message')!.textContent.includes('held')); expect(requestAdapter).not.toHaveBeenCalled(); expect(Worker).not.toHaveBeenCalled(); await dispose();
    elements.get('start')!.dispatchEvent(new Event('click')); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
