/** One operation in flight, plus cancellation. No queue, physics, or implicit commit. */
import { readMultiphysicsSnapshot3D, type MultiphysicsSnapshot3D } from './model.js';
import type { MultiphysicsProfiles3D } from './profiles.js';
import type { MultiphysicsEdit3D, MultiphysicsPreviewResult3D } from './world.js';
import {
  envelope,
  message,
  fields,
  integer,
  owned,
  type MultiphysicsWorkerTransport3D,
} from './worker-wire.js';
export type MultiphysicsWorkerState3D = { revision: number; snapshot: MultiphysicsSnapshot3D };
export type MultiphysicsWorkerPreview3D = {
  target: number;
  revision: number;
  result: MultiphysicsPreviewResult3D;
};
const cancelled = () => Object.assign(Error('Preview cancelled.'), { name: 'AbortError' });
export function createMultiphysicsWorkerClient3D(
  transport: MultiphysicsWorkerTransport3D,
  profiles: MultiphysicsProfiles3D,
  options: { timeoutMs?: number } = {},
) {
  const timeoutMs = integer(options.timeoutMs ?? 30000, 1, 60000);
  let sequence = 0,
    closed = false,
    unsubscribe = () => {},
    state: MultiphysicsWorkerState3D | undefined;
  let target: number | undefined,
    cancelling = false,
    requestedTicks = 0,
    held: MultiphysicsWorkerPreview3D | undefined;
  const tokens = new WeakMap<MultiphysicsWorkerPreview3D, number>();
  const pending = new Map<
    number,
    {
      kind: string;
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  function close(error = Error('Multiphysics Worker closed.')) {
    if (closed) return;
    closed = true;
    held = undefined;
    target = undefined;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    pending.clear();
    try {
      unsubscribe();
    } finally {
      transport.close();
    }
  }
  const fail = (error: unknown) => {
    try {
      close(error instanceof Error ? error : Error('Worker transport failed.'));
    } catch {
      /* terminal */
    }
  };
  function request(kind: string, payload: unknown): Promise<unknown> {
    if (closed) return Promise.reject(Error('Multiphysics Worker closed.'));
    const seq = ++sequence;
    return new Promise((resolve, reject) => {
      if (!Number.isSafeInteger(seq)) {
        reject(Error('Worker sequence exhausted.'));
        fail(Error('Worker sequence exhausted.'));
        return;
      }
      const timer = setTimeout(() => fail(Error('Multiphysics Worker timed out.')), timeoutMs);
      pending.set(seq, { kind, resolve, reject, timer });
      try {
        transport.send(message(seq, kind, owned(payload)));
      } catch (error) {
        fail(error);
      }
    });
  }
  const readState = (raw: unknown, revision: number) => {
    fields(raw, ['revision', 'snapshot']);
    if (integer(raw.revision) !== revision) throw Error('Worker revision differs.');
    return { revision, snapshot: readMultiphysicsSnapshot3D(profiles, raw.snapshot) };
  };
  const readResult = (raw: unknown): MultiphysicsPreviewResult3D => {
    fields(raw, ['snapshot', 'edits', 'ticks']);
    if (!Array.isArray(raw.ticks) || raw.ticks.length !== requestedTicks)
      throw Error('Worker tick report count differs.');
    const snapshot = readMultiphysicsSnapshot3D(profiles, raw.snapshot);
    if (!state || snapshot.tick !== state.snapshot.tick + requestedTicks)
      throw Error('Worker preview tick differs.');
    return { ...(owned(raw) as MultiphysicsPreviewResult3D), snapshot };
  };
  function receive(raw: unknown) {
    if (closed) return;
    try {
      const m = envelope(raw),
        p = pending.get(m.seq);
      if (!p) throw Error('Unexpected Worker reply.');
      let result: unknown;
      if (m.kind === 'error') {
        fields(m.payload, ['message']);
        if (typeof m.payload.message !== 'string' || m.payload.message.length > 4096)
          throw Error('Invalid Worker error.');
        pending.delete(m.seq);
        clearTimeout(p.timer);
        if (p.kind === 'preview') {
          target = undefined;
          held = undefined;
        }
        if (p.kind === 'cancel') {
          cancelling = false;
          fail(Error(m.payload.message));
        }
        p.reject(Error(m.payload.message));
        return;
      }
      if (m.kind === 'cancelled') {
        if (p.kind !== 'preview' || !cancelling || m.payload !== null)
          throw Error('Unexpected Worker cancellation.');
        pending.delete(m.seq);
        clearTimeout(p.timer);
        p.reject(cancelled());
        return;
      }
      if (m.kind !== p.kind) throw Error('Worker reply kind differs.');
      if (p.kind === 'hello' || p.kind === 'snapshot' || p.kind === 'restore') {
        result = readState(
          m.payload,
          p.kind === 'hello' ? 0 : state!.revision + Number(p.kind === 'restore'),
        );
        state = result as MultiphysicsWorkerState3D;
      } else if (p.kind === 'preview') {
        fields(m.payload, ['target', 'revision', 'result']);
        if (m.payload.target !== target || m.payload.revision !== state!.revision)
          throw Error('Worker preview identity differs.');
        const candidate = {
          target: target!,
          revision: state!.revision,
          result: readResult(m.payload.result),
        };
        if (!cancelling) {
          held = owned(candidate);
          result = owned(candidate);
        }
      } else if (p.kind === 'commit') {
        fields(m.payload, ['revision', 'result']);
        if (!held || integer(m.payload.revision) !== state!.revision + 1)
          throw Error('Worker commit revision differs.');
        const committed = readResult(m.payload.result);
        if (JSON.stringify(owned(committed)) !== JSON.stringify(owned(held.result)))
          throw Error('Worker committed a different preview.');
        state = { revision: m.payload.revision as number, snapshot: committed.snapshot };
        result = { revision: state.revision, result: committed };
        held = undefined;
        target = undefined;
      } else if (p.kind === 'cancel') {
        if (m.payload !== null) throw Error('Invalid Worker cancellation acknowledgement.');
        cancelling = false;
        target = undefined;
        held = undefined;
      } else throw Error('Unknown Worker reply.');
      pending.delete(m.seq);
      clearTimeout(p.timer);
      if (p.kind === 'preview' && cancelling) p.reject(cancelled());
      else {
        const value = owned(result ?? null);
        if (p.kind === 'preview') tokens.set(value as MultiphysicsWorkerPreview3D, target!);
        p.resolve(value);
      }
    } catch (error) {
      fail(error);
    }
  }
  try {
    unsubscribe = transport.subscribe(receive, fail);
  } catch (error) {
    fail(error);
    throw error;
  }
  const ready = request('hello', null) as Promise<MultiphysicsWorkerState3D>;
  const idle = () => {
    if (closed || !state || pending.size || target !== undefined)
      throw Error('Worker requires an idle ready boundary.');
  };
  return Object.freeze({
    ready,
    snapshot(): Promise<MultiphysicsWorkerState3D> {
      try {
        idle();
        return request('snapshot', null) as Promise<MultiphysicsWorkerState3D>;
      } catch (error) {
        return Promise.reject(error);
      }
    },
    restore(snapshot: unknown): Promise<MultiphysicsWorkerState3D> {
      try {
        idle();
        const next = readMultiphysicsSnapshot3D(profiles, snapshot);
        return request('restore', {
          base: state!.revision,
          snapshot: next,
        }) as Promise<MultiphysicsWorkerState3D>;
      } catch (error) {
        return Promise.reject(error);
      }
    },
    preview(
      edits: readonly MultiphysicsEdit3D[] = [],
      ticks = 1,
    ): Promise<MultiphysicsWorkerPreview3D> {
      try {
        idle();
        integer(ticks, 0, 2);
        const copied = owned(edits);
        requestedTicks = ticks;
        target = sequence + 1;
        return request('preview', {
          base: state!.revision,
          edits: copied,
          ticks,
        }) as Promise<MultiphysicsWorkerPreview3D>;
      } catch (error) {
        return Promise.reject(error);
      }
    },
    commit(
      preview: MultiphysicsWorkerPreview3D,
    ): Promise<{ revision: number; result: MultiphysicsPreviewResult3D }> {
      if (closed || pending.size || !held || tokens.get(preview) !== held.target || cancelling)
        return Promise.reject(Error('Worker preview is stale or not ready.'));
      tokens.delete(preview);
      return request('commit', { base: held.revision, target: held.target }) as Promise<{
        revision: number;
        result: MultiphysicsPreviewResult3D;
      }>;
    },
    cancel(): Promise<void> {
      if (
        closed ||
        target === undefined ||
        cancelling ||
        [...pending.values()].some((p) => p.kind !== 'preview')
      )
        return Promise.reject(Error('No cancellable Worker preview.'));
      cancelling = true;
      return request('cancel', { target }).then(() => {});
    },
    close: () => close(),
  });
}
/** Adapter owns an already-created browser Worker, including error teardown. */
export function multiphysicsBrowserWorkerTransport3D(
  worker: Worker,
): MultiphysicsWorkerTransport3D {
  return {
    send: (value) => worker.postMessage(value),
    close: () => worker.terminate(),
    subscribe(receive, failed) {
      const next = (event: MessageEvent) => receive(event.data),
        error = () => failed(Error('Multiphysics Worker failed.'));
      worker.addEventListener('message', next);
      worker.addEventListener('error', error);
      worker.addEventListener('messageerror', error);
      return () => {
        worker.removeEventListener('message', next);
        worker.removeEventListener('error', error);
        worker.removeEventListener('messageerror', error);
      };
    },
  };
}
