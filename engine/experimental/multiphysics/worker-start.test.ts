import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { createMultiphysicsProfiles3D, type MultiphysicsProfiles3D } from './profiles.js';
import { createMultiphysicsSnapshot3D } from './model.js';
import { startMultiphysicsWorker3D } from './worker-client.js';
import { message, MULTIPHYSICS_WORKER_BOOTSTRAP_3D } from './worker-wire.js';

class MockWorker extends EventTarget {
  static instances: MockWorker[] = [];
  static failPost = false;
  terminate = vi.fn();
  constructor() {
    super();
    MockWorker.instances.push(this);
  }
  postMessage() {
    if (MockWorker.failPost) throw Error('clone failed');
  }
  reply(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}
let profiles: MultiphysicsProfiles3D;
beforeAll(async () => {
  profiles = await createMultiphysicsProfiles3D();
});
beforeEach(() => {
  MockWorker.instances = [];
  MockWorker.failPost = false;
  vi.stubGlobal('Worker', MockWorker);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const snapshot = () => createMultiphysicsSnapshot3D(profiles, { parcels: [] });
const start = (options = { timeoutMs: 10 }) =>
  startMultiphysicsWorker3D('inert', profiles, snapshot(), options);

test('silence rejects on the startup deadline and removes listeners', async () => {
  const pending = start();
  const worker = MockWorker.instances[0];
  const remove = vi.spyOn(worker, 'removeEventListener');
  const rejected = expect(pending).rejects.toThrow(/startup timed out/);
  await vi.advanceTimersByTimeAsync(10);
  await rejected;
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(remove.mock.calls.map(([type]) => type)).toEqual(['message', 'error', 'messageerror']);
  expect(vi.getTimerCount()).toBe(0);
});
test.each(['error', 'messageerror'])('%s rejects startup and clears its deadline', async (kind) => {
  const pending = start();
  const rejected = expect(pending).rejects.toThrow(/failed to load/);
  MockWorker.instances[0].dispatchEvent(new Event(kind));
  await rejected;
  expect(MockWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
test('an invalid bootstrap reply rejects and cleans up', async () => {
  const pending = start();
  const rejected = expect(pending).rejects.toThrow(/did not start/);
  MockWorker.instances[0].reply({ ready: true });
  await rejected;
  expect(MockWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test('invalid timeout and work options reject before allocating a Worker', async () => {
  await expect(start({ timeoutMs: 0 })).rejects.toThrow();
  await expect(
    startMultiphysicsWorker3D('inert', profiles, snapshot(), { work: 0 }),
  ).rejects.toThrow();
  expect(MockWorker.instances).toHaveLength(0);
});
test('a synchronous post failure clears the deadline and terminates', async () => {
  MockWorker.failPost = true;
  await expect(start()).rejects.toThrow('clone failed');
  expect(MockWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
test('successful bootstrap and hello return a client with no stale startup timer', async () => {
  const initial = snapshot();
  const pending = startMultiphysicsWorker3D('inert', profiles, initial, { timeoutMs: 10 });
  const worker = MockWorker.instances[0];
  worker.reply({ kind: MULTIPHYSICS_WORKER_BOOTSTRAP_3D, ready: true });
  await Promise.resolve();
  worker.reply(message(1, 'hello', { revision: 0, snapshot: initial }));
  const client = await pending;
  expect(vi.getTimerCount()).toBe(0);
  expect(worker.terminate).not.toHaveBeenCalled();
  client.close();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
test('a stalled hello also releases the Worker after a successful bootstrap', async () => {
  const pending = start();
  const rejected = expect(pending).rejects.toThrow(/timed out/);
  const worker = MockWorker.instances[0];
  worker.reply({ kind: MULTIPHYSICS_WORKER_BOOTSTRAP_3D, ready: true });
  await vi.advanceTimersByTimeAsync(10);
  await rejected;
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
