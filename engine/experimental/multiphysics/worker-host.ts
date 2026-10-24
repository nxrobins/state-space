/** Dedicated Worker owns the live world and one unpublished candidate. */
import {
  createMultiphysicsWorld3D,
  type MultiphysicsEdit3D,
  type MultiphysicsPreview3D,
} from './world.js';
import type { MultiphysicsProfiles3D } from './profiles.js';
import type { MultiphysicsSnapshot3D } from './model.js';
import {
  envelope,
  message,
  fields,
  integer,
  errorText,
  type MultiphysicsWorkerTransport3D,
  type MultiphysicsTaskScheduler3D,
} from './worker-wire.js';
export function createMultiphysicsWorkerHost3D(
  transport: MultiphysicsWorkerTransport3D,
  profiles: MultiphysicsProfiles3D,
  initial: MultiphysicsSnapshot3D,
  options: { schedule: MultiphysicsTaskScheduler3D; work?: number },
) {
  const world = createMultiphysicsWorld3D(profiles, initial),
    work = integer(options.work ?? 128, 1, 256);
  let closed = false,
    connected = false,
    receiving = false,
    sequence = 0,
    unsubscribe = () => {},
    unschedule = () => {};
  let current: { target: number; preview: MultiphysicsPreview3D; replied: boolean } | undefined;
  const discard = () => {
    unschedule();
    unschedule = () => {};
    current?.preview.cancel();
    current = undefined;
  };
  const close = () => {
    if (closed) return;
    closed = true;
    discard();
    try {
      unsubscribe();
    } finally {
      transport.close();
    }
  };
  const reply = (seq: number, kind: string, payload: unknown) =>
    transport.send(message(seq, kind, payload));
  const fail = () => {
    try {
      close();
    } catch {
      /* endpoint is terminal */
    }
  };
  function schedule() {
    let returned = false;
    const cancel = options.schedule(() => {
      if (!returned) {
        fail();
        throw Error('Worker scheduler must yield a task.');
      }
      unschedule = () => {};
      if (closed || !current) return;
      const candidate = current;
      try {
        const progress = candidate.preview.advance(work);
        if (progress.status === 'ready') {
          const result = candidate.preview.result();
          candidate.replied = true;
          reply(candidate.target, 'preview', {
            target: candidate.target,
            revision: world.revision(),
            result,
          });
        } else schedule();
      } catch (error) {
        discard();
        try {
          reply(candidate.target, 'error', { message: errorText(error) });
        } catch {
          fail();
        }
      }
    });
    returned = true;
    if (typeof cancel !== 'function') throw Error('Worker scheduler must return cancellation.');
    unschedule = cancel;
  }
  function receive(raw: unknown) {
    if (closed) return;
    let seq: number | undefined;
    try {
      const m = envelope(raw);
      seq = m.seq;
      if (receiving || m.seq !== sequence + 1) throw Error('Worker request ordering violation.');
      sequence = seq;
      receiving = true;
      if (!connected) {
        if (m.kind !== 'hello' || m.payload !== null) throw Error('Worker handshake required.');
        connected = true;
        reply(seq, 'hello', { revision: world.revision(), snapshot: world.snapshot() });
        return;
      }
      let result: unknown;
      try {
        if (m.kind === 'cancel') {
          fields(m.payload, ['target']);
          integer(m.payload.target, 1);
          if (!current || current.target !== m.payload.target)
            throw Error('Stale Worker cancellation.');
          const old = current;
          discard();
          if (!old.replied) reply(old.target, 'cancelled', null);
          result = null;
        } else if (m.kind === 'commit') {
          fields(m.payload, ['base', 'target']);
          integer(m.payload.base);
          integer(m.payload.target, 1);
          if (
            !current ||
            current.target !== m.payload.target ||
            m.payload.base !== world.revision() ||
            !current.replied
          )
            throw Error('Stale or unfinished Worker preview.');
          result = world.commit(current.preview);
          current = undefined;
        } else {
          if (current) throw Error('Discard or commit the active Worker preview first.');
          if (m.kind === 'snapshot') {
            if (m.payload !== null) throw Error('Invalid snapshot request.');
            result = { revision: world.revision(), snapshot: world.snapshot() };
          } else if (m.kind === 'restore') {
            fields(m.payload, ['base', 'snapshot']);
            if (integer(m.payload.base) !== world.revision()) throw Error('Stale Worker revision.');
            world.restore(m.payload.snapshot);
            result = { revision: world.revision(), snapshot: world.snapshot() };
          } else if (m.kind === 'preview') {
            fields(m.payload, ['base', 'edits', 'ticks']);
            if (integer(m.payload.base) !== world.revision()) throw Error('Stale Worker revision.');
            const preview = world.prepare(
              m.payload.edits as MultiphysicsEdit3D[],
              integer(m.payload.ticks, 0, 2),
            );
            current = { target: seq, preview, replied: false };
            schedule();
            return;
          } else throw Error('Unknown Worker operation.');
        }
      } catch (error) {
        if (m.kind === 'preview') discard();
        reply(seq, 'error', { message: errorText(error) });
        return;
      }
      reply(seq, m.kind, result);
    } catch {
      fail();
    } finally {
      receiving = false;
    }
  }
  try {
    unsubscribe = transport.subscribe(receive, fail);
  } catch (error) {
    fail();
    throw error;
  }
  return Object.freeze({ close });
}
