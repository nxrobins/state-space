/** Worker-owned session. One message executes at most one existing session slice. */
import {
  createReactiveSession3D,
  type ReactiveSessionPolicy3D,
  type ReactiveBranch3D,
} from './reactive-session.js';
import type { ReactiveMaterialRegistry3D } from './reactive-registry.js';
import type { ReactiveGameValue3D, ReactiveSessionInitial3D } from './reactive-session-state.js';
import {
  fields,
  integer,
  workerName,
  workerEnvelope,
  workerMessage,
  workerSameRevision,
  workerRequest,
  workerError,
  REACTIVE_WORKER_LIMITS_3D,
  type ReactiveWorkerTransport3D,
  type ReactiveWorkerPreviewOptions3D,
} from './reactive-worker-wire.js';
import type { ReactiveSessionCommand3D } from './reactive-session.js';
import {
  createReactiveChangeJob3D,
  readReactiveChangeOptions3D,
  type ReactiveChangeJob3D,
} from './reactive-changes.js';
import {
  readReactiveQueries3D,
  createReactiveQueryJob3D,
  reactiveWorkerGeometryStamp3D,
  type ReactiveQueryJob3D,
} from './reactive-worker-queries.js';
import {
  reactiveSessionRevision3D,
  type ReactiveSessionSnapshot3D,
} from './reactive-session-state.js';
import { reactiveDomain3D, reactiveDomainId3D } from './reactive-domain-state.js';
import { createReactiveGeometry3D } from './reactive-geometry.js';
export function createReactiveWorkerHost3D<T extends ReactiveGameValue3D>(
  transport: ReactiveWorkerTransport3D,
  registry: ReactiveMaterialRegistry3D,
  initial: ReactiveSessionInitial3D<T>,
  policy: ReactiveSessionPolicy3D<T>,
  options: { channel: string; work?: number },
) {
  fields(options, ['channel'], ['work']);
  const channel = workerName(options.channel);
  const work = Object.hasOwn(options, 'work')
    ? integer(options.work, 1, REACTIVE_WORKER_LIMITS_3D.work)
    : REACTIVE_WORKER_LIMITS_3D.defaultWork;
  const session = createReactiveSession3D(registry, initial, policy);
  let sequence = 0,
    lastTarget = 0,
    connected = false,
    closed = false,
    receiving = false,
    unsubscribe = () => {};
  let current: {
    target: number;
    branch: ReactiveBranch3D<T>;
    slices: number;
    maximum: number;
  } | null = null;
  let latest: { before: ReactiveSessionSnapshot3D<T>; after: ReactiveSessionSnapshot3D<T> } | null =
    null;
  let inspection:
    | ({ id: number; slices: number } & (
        | { kind: 'queries'; job: ReactiveQueryJob3D }
        | { kind: 'changes'; job: ReactiveChangeJob3D }
      ))
    | null = null;
  let lastInspection = 0;
  const cancelInspection = () => {
    inspection?.job.cancel();
    inspection = null;
  };
  const discard = () => {
    const old = current;
    current = null;
    old?.branch.discard();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    latest = null;
    cancelInspection();
    try {
      discard();
    } finally {
      try {
        unsubscribe();
      } finally {
        transport.close();
      }
    }
  };
  const reply = (seq: number, kind: string, payload: unknown) =>
    transport.send(workerMessage(channel, seq, kind, payload));
  const fatal = (error: unknown, seq?: number) => {
    try {
      if (seq !== undefined) reply(seq, 'error', { message: workerError(error), fatal: true });
    } catch {
      /* transport failed */
    }
    try {
      close();
    } catch {
      /* already terminal */
    }
  };
  const progress = () => {
    if (!current) throw Error('No reactive worker preview.');
    const p = current.branch.progress();
    return {
      target: current.target,
      branchId: current.branch.branchId,
      progress: p,
      preview: p.status === 'ready' ? current.branch.inspect() : null,
    };
  };
  function receive(raw: unknown) {
    if (closed) return;
    let seq: number | undefined;
    try {
      const m = workerEnvelope(raw, channel);
      seq = m.seq;
      if (receiving || m.seq !== sequence + 1) throw Error('Reactive worker ordering violation.');
      receiving = true;
      sequence = m.seq;
      if (m.kind === 'hello') {
        if (connected || m.payload !== null) throw Error('Reactive worker handshake differs.');
        connected = true;
        reply(seq, 'hello', session.snapshot());
        return;
      }
      if (!connected) throw Error('Reactive worker handshake required.');
      if (m.kind === 'close') {
        if (m.payload !== null) throw Error('Invalid close request.');
        cancelInspection();
        discard();
        reply(seq, 'close', null);
        close();
        return;
      }
      let result: unknown;
      // Data/ability errors are atomic rejections; send errors after publication are fatal.
      try {
        if (m.kind === 'inspect-start') {
          fields(m.payload, ['inspection', 'base', 'target', 'kind', 'request', 'from']);
          const id = integer(m.payload.inspection, lastInspection + 1, Number.MAX_SAFE_INTEGER);
          if (
            inspection ||
            !workerSameRevision(m.payload.base, session.revision) ||
            (current && current.branch.progress().status !== 'ready')
          )
            throw Error('Reactive inspection requires an idle complete boundary.');
          const preview = m.payload.target !== null;
          if (preview && (!current || current.target !== m.payload.target))
            throw Error('Stale reactive inspection target.');
          const snapshot = preview ? current!.branch.inspect().state : session.snapshot();
          const getView = (domain: string | null) =>
            preview ? current!.branch.queries(domain) : session.queries(domain);
          if (m.payload.kind === 'queries') {
            if (m.payload.from !== null) throw Error('Unexpected reactive query comparison.');
            const requests = readReactiveQueries3D(m.payload.request, snapshot);
            inspection = {
              id,
              kind: 'queries',
              slices: 0,
              job: createReactiveQueryJob3D(requests, getView),
            };
          } else if (m.payload.kind === 'changes') {
            fields(m.payload.request, ['domain', 'maxRuns']);
            const domain = reactiveDomainId3D(m.payload.request.domain);
            const request = readReactiveChangeOptions3D({
              maxRuns: m.payload.request.maxRuns as number,
            });
            if (
              preview
                ? m.payload.from !== null
                : !latest ||
                  !workerSameRevision(m.payload.from, reactiveSessionRevision3D(latest.before)) ||
                  !workerSameRevision(session.revision, reactiveSessionRevision3D(latest.after))
            )
              throw Error('Stale reactive change comparison.');
            const before = preview ? session.snapshot() : latest!.before;
            const beforeView = createReactiveGeometry3D(
              registry,
              reactiveDomain3D(before.domains, domain),
              reactiveWorkerGeometryStamp3D(before, domain),
            );
            inspection = {
              id,
              kind: 'changes',
              slices: 0,
              job: createReactiveChangeJob3D(registry, beforeView, getView(domain), request),
            };
          } else throw Error('Unknown reactive inspection kind.');
          lastInspection = id;
          result = {
            inspection: id,
            kind: inspection.kind,
            progress: inspection.job.progress(),
            result: null,
          };
        } else if (m.kind === 'inspect-advance' || m.kind === 'inspect-cancel') {
          fields(m.payload, ['inspection']);
          if (!inspection || inspection.id !== m.payload.inspection)
            throw Error('Stale reactive inspection.');
          if (m.kind === 'inspect-cancel') {
            result = { inspection: inspection.id };
            cancelInspection();
          } else {
            if (++inspection.slices > REACTIVE_WORKER_LIMITS_3D.slices)
              throw Error('Reactive inspection slice budget exhausted.');
            const p = inspection.job.advance(work);
            result = {
              inspection: inspection.id,
              kind: inspection.kind,
              progress: p,
              result: p.status === 'complete' ? inspection.job.result() : null,
            };
            if (p.status === 'complete') inspection = null;
          }
        } else if (inspection) throw Error('A reactive inspection is in flight.');
        else if (m.kind === 'start') {
          fields(m.payload, ['target', 'base', 'commands', 'options']);
          const target = integer(m.payload.target, lastTarget + 1, Number.MAX_SAFE_INTEGER);
          if (current || !workerSameRevision(m.payload.base, session.revision))
            throw Error('Reactive worker preview requires an idle current revision.');
          const r = workerRequest(
            m.payload.commands as ReactiveSessionCommand3D<T>[],
            m.payload.options as ReactiveWorkerPreviewOptions3D,
          );
          const branch = session.branch(r.branch);
          current = { target, branch, slices: 0, maximum: r.maxSlices };
          lastTarget = target;
          for (const command of r.commands) branch.enqueue(command);
          result = progress();
        } else if (m.kind === 'advance' || m.kind === 'discard' || m.kind === 'commit') {
          fields(m.payload, ['target', 'base']);
          if (
            !current ||
            current.target !== m.payload.target ||
            !workerSameRevision(m.payload.base, session.revision)
          )
            throw Error('Stale reactive worker target.');
          if (m.kind === 'advance') {
            if (current.slices >= current.maximum)
              throw Error('Reactive preview slice budget exhausted.');
            current.slices++;
            current.branch.advance(work);
            result = progress();
          } else if (m.kind === 'discard') {
            result = { target: current.target };
            discard();
          } else {
            const before = session.snapshot(),
              committed = session.commit(current.branch);
            result = committed;
            latest = { before, after: committed.snapshot };
            current = null;
          }
        } else if (m.kind === 'restore') {
          fields(m.payload, ['base', 'snapshot']);
          if (current || !workerSameRevision(m.payload.base, session.revision))
            throw Error('Reactive restore requires an idle current revision.');
          result = session.restore(m.payload.snapshot);
          latest = null;
        } else throw Error('Unknown reactive worker operation.');
      } catch (error) {
        if (m.kind.startsWith('inspect-')) cancelInspection();
        else discard();
        reply(seq, 'error', { message: workerError(error), fatal: false });
        return;
      }
      reply(seq, m.kind, result);
    } catch (error) {
      fatal(error, seq);
    } finally {
      receiving = false;
    }
  }
  try {
    unsubscribe = transport.subscribe(receive, (error) => fatal(error));
    if (closed) unsubscribe();
  } catch (error) {
    fatal(error);
    throw error;
  }
  return Object.freeze({ close });
}
