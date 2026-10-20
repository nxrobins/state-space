import { describe, expect, test, vi } from 'vitest';
import { createChamberLifecycle } from '../../examples/reactive-chamber/lifecycle.js';
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const host = () => {
  const dispose = vi.fn(async () => {});
  let closing: Promise<void> | undefined;
  return { dispose, close: () => (closing ??= Promise.resolve().then(dispose)) };
};
const client = () => ({ state: { busy: false }, ...host() });
function fixture() {
  const first = client(),
    view = host(),
    openClient = vi.fn(async () => first),
    openHost = vi.fn(async () => view);
  return {
    first,
    view,
    openClient,
    openHost,
    lifecycle: createChamberLifecycle({ openClient, openHost }),
  };
}
describe('chamber resource lifecycle', () => {
  test('owns resources through start, replacement, and idempotent shutdown', async () => {
    const f = fixture();
    await f.lifecycle.start();
    expect(f.lifecycle.status).toBe('running');
    const next = client();
    expect(await f.lifecycle.replace(async () => next)).toBe(true);
    expect(f.first.dispose).toHaveBeenCalledOnce();
    expect(f.view.dispose).not.toHaveBeenCalled();
    expect(f.lifecycle.current?.client).toBe(next);
    const a = f.lifecycle.stop(),
      b = f.lifecycle.stop();
    expect(a).toBe(b);
    await a;
    expect(f.lifecycle.status).toBe('stopped');
    expect(f.lifecycle.current).toBeNull();
    expect(next.dispose).toHaveBeenCalledOnce();
    expect(f.view.dispose).toHaveBeenCalledOnce();
  });
  test('stop drains pending host creation and prevents overlapping restarts', async () => {
    const f = fixture(),
      gate = deferred<ReturnType<typeof host>>();
    f.openHost.mockImplementation(() => gate.promise);
    const start = f.lifecycle.start(),
      stop = f.lifecycle.stop();
    await f.lifecycle.start();
    expect(f.lifecycle.status).toBe('stopping');
    expect(f.openHost).toHaveBeenCalledOnce();
    gate.resolve(f.view);
    await Promise.all([start, stop]);
    expect(f.openClient).not.toHaveBeenCalled();
    expect(f.view.dispose).toHaveBeenCalledOnce();
    expect(f.lifecycle.current).toBeNull();
  });
  test('stop during client creation disposes the unpublished client and host', async () => {
    const f = fixture(),
      gate = deferred<ReturnType<typeof client>>();
    f.openClient.mockImplementation(() => gate.promise);
    const start = f.lifecycle.start();
    await Promise.resolve();
    const stop = f.lifecycle.stop();
    gate.resolve(f.first);
    await Promise.all([start, stop]);
    expect(f.first.dispose).toHaveBeenCalledOnce();
    expect(f.view.dispose).toHaveBeenCalledOnce();
    expect(f.lifecycle.status).toBe('stopped');
  });
  test('failed import preserves the old client and host', async () => {
    const f = fixture();
    await f.lifecycle.start();
    await expect(
      f.lifecycle.replace(async () => {
        throw Error('Invalid recording');
      }),
    ).rejects.toThrow('Invalid recording');
    expect(f.lifecycle.current?.client).toBe(f.first);
    expect(f.lifecycle.status).toBe('running');
    expect(f.first.dispose).not.toHaveBeenCalled();
    await f.lifecycle.stop();
  });
  test('stop during replacement prevents late publication and drains both clients', async () => {
    const f = fixture(),
      gate = deferred<ReturnType<typeof client>>(),
      next = client();
    await f.lifecycle.start();
    const replace = f.lifecycle.replace(() => gate.promise),
      stop = f.lifecycle.stop();
    gate.resolve(next);
    expect(await replace).toBe(false);
    await stop;
    expect(next.dispose).toHaveBeenCalledOnce();
    expect(f.first.dispose).toHaveBeenCalledOnce();
    expect(f.view.dispose).toHaveBeenCalledOnce();
    expect(f.lifecycle.current).toBeNull();
  });
  test.each([false, true])(
    'stop while the previous client closes cannot install its replacement (failure: %s)',
    async (fails) => {
      const f = fixture(),
        gate = deferred<void>(),
        next = client();
      await f.lifecycle.start();
      f.first.dispose.mockImplementation(() => gate.promise);
      const replacing = f.lifecycle.replace(async () => next);
      await Promise.resolve();
      await Promise.resolve();
      const stop = f.lifecycle.stop();
      if (fails) gate.reject(Error('Client failed'));
      else gate.resolve();
      expect(await replacing).toBe(false);
      await stop;
      expect(f.first.dispose).toHaveBeenCalledOnce();
      expect(next.dispose).toHaveBeenCalledOnce();
      expect(f.lifecycle.current).toBeNull();
    },
  );
  test('busy and overlapping replacements are rejected before opening another client', async () => {
    const f = fixture(),
      next = vi.fn(async () => client());
    await f.lifecycle.start();
    f.first.state.busy = true;
    await expect(f.lifecycle.replace(next)).rejects.toThrow('unavailable');
    expect(next).not.toHaveBeenCalled();
    f.first.state.busy = false;
    const gate = deferred<ReturnType<typeof client>>(),
      replacing = f.lifecycle.replace(() => gate.promise);
    await expect(f.lifecycle.replace(next)).rejects.toThrow('unavailable');
    expect(next).not.toHaveBeenCalled();
    gate.resolve(client());
    await replacing;
    await f.lifecycle.stop();
  });
  test('startup failure drains the host before allowing another start and isolates observers', async () => {
    const f = fixture(),
      gate = deferred<void>();
    f.view.dispose.mockImplementation(() => gate.promise);
    f.openClient.mockRejectedValue(Error('Worker failed'));
    f.lifecycle.subscribe(() => {
      throw Error('Observer failed');
    });
    const start = f.lifecycle.start();
    const rejected = expect(start).rejects.toThrow('Worker failed');
    await Promise.resolve();
    await Promise.resolve();
    expect(f.lifecycle.status).toBe('starting');
    await f.lifecycle.start();
    expect(f.openHost).toHaveBeenCalledOnce();
    gate.resolve();
    await rejected;
    expect(f.lifecycle.status).toBe('stopped');
  });
});
