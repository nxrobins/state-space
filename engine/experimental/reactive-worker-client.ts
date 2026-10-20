/** One outstanding message, one latest intent, and a task yield between physical slices. */
import {
  reactiveSessionRevision3D,
  type ReactiveGameValue3D,
  type ReactiveSessionSnapshot3D,
  type ReactiveSessionRevision3D,
} from './reactive-session-state.js';
import type { ReactiveMaterialRegistry3D } from './reactive-registry.js';
import {
  reactiveDomain3D,
  reactiveDomainId3D,
  type ReactiveDomainId3D,
} from './reactive-domain-state.js';
import {
  readReactiveChangeOptions3D,
  type ReactiveChangeOptions3D,
  type ReactiveChangeReport3D,
  type ReactiveChangeProgress3D,
} from './reactive-changes.js';
import { readReactiveChangeReport3D } from './reactive-worker-changes.js';
import {
  readReactiveQueries3D,
  readReactiveQueryBatch3D,
  reactiveWorkerGeometryStamp3D,
  type ReactiveWorkerQuery3D,
  type ReactiveWorkerQueryBatch3D,
  type ReactiveQueryProgress3D,
} from './reactive-worker-queries.js';
import type {
  ReactiveBranchProgress3D,
  ReactiveSessionCommand3D,
  ReactiveSessionPreview3D,
  ReactiveSessionCommit3D,
} from './reactive-session.js';
import {
  fields,
  integer,
  workerName,
  workerMessage,
  workerEnvelope,
  workerSameRevision,
  workerRequest,
  workerSnapshot,
  workerProgress,
  workerEqual,
  workerError,
  REACTIVE_WORKER_LIMITS_3D,
  type ReactiveWorkerTransport3D,
  type ReactiveWorkerPreviewOptions3D,
} from './reactive-worker-wire.js';
export type ReactiveWorkerOutcome3D<T extends ReactiveGameValue3D> =
  | { id: number; status: 'ready'; preview: ReactiveSessionPreview3D<T> }
  | { id: number; status: 'cancelled' | 'superseded' | 'failed' | 'closed'; error: string | null };
export interface ReactiveWorkerTicket3D<T extends ReactiveGameValue3D> {
  readonly id: number;
  readonly result: Promise<ReactiveWorkerOutcome3D<T>>;
  cancel(): void;
}
export type ReactiveWorkerClientOptions3D = {
  channel: string;
  worldId: string;
  gameRulesVersion: string;
  timeoutMs?: number;
  /** Integration seam: schedule a later task, never call inline. Return its cancellation function. */
  schedule?: (task: () => void) => () => void;
};
export type ReactiveWorkerInspectionProgress3D =
  | { kind: 'queries'; value: ReactiveQueryProgress3D }
  | { kind: 'changes'; value: ReactiveChangeProgress3D };
export type ReactiveWorkerState3D = Readonly<{
  status: 'connecting' | 'ready' | 'working' | 'closing' | 'closed' | 'failed';
  activeId: number | null;
  waitingId: number | null;
  progress: ReactiveBranchProgress3D | null;
  inspection: ReactiveWorkerInspectionProgress3D | null;
  uncertain: boolean;
  error: string | null;
}>;

export interface ReactiveWorkerClient3D<T extends ReactiveGameValue3D> {
  readonly ready: Promise<void>;
  readonly state: ReactiveWorkerState3D;
  /** Coalesced microtask notifications, including the initial and final state. Observer errors are isolated. */
  subscribe(listener: (state: ReactiveWorkerState3D) => void): () => void;
  /** Await an idle complete boundary; rejects on failure or shutdown. Call after ticket.cancel() to await discard. */
  whenIdle(): Promise<void>;
  snapshot(): ReactiveSessionSnapshot3D<T>;
  query(requests: readonly ReactiveWorkerQuery3D[]): Promise<ReactiveWorkerQueryBatch3D>;
  queryPreview(
    ticket: ReactiveWorkerTicket3D<T>,
    requests: readonly ReactiveWorkerQuery3D[],
  ): Promise<ReactiveWorkerQueryBatch3D>;
  changes(
    commit: ReactiveSessionCommit3D<T>,
    domain?: ReactiveDomainId3D,
    options?: ReactiveChangeOptions3D,
  ): Promise<ReactiveChangeReport3D>;
  changesPreview(
    ticket: ReactiveWorkerTicket3D<T>,
    domain?: ReactiveDomainId3D,
    options?: ReactiveChangeOptions3D,
  ): Promise<ReactiveChangeReport3D>;
  cancelInspection(): boolean;
  request(
    commands: readonly ReactiveSessionCommand3D<T>[],
    options: ReactiveWorkerPreviewOptions3D,
  ): ReactiveWorkerTicket3D<T>;
  commit(ticket: ReactiveWorkerTicket3D<T>): Promise<ReactiveSessionCommit3D<T>>;
  restore(saved: unknown): Promise<ReactiveSessionSnapshot3D<T>>;
  close(): Promise<void>;
}
type Reason = 'cancelled' | 'superseded' | 'closed';
type Request<T extends ReactiveGameValue3D> = ReturnType<typeof workerRequest<T>> & {
  id: number;
  base: Readonly<ReactiveSessionRevision3D>;
  resolve(value: ReactiveWorkerOutcome3D<T>): void;
  settled: boolean;
  reason?: Reason;
  branchId?: number;
  progress?: ReactiveBranchProgress3D;
  candidate?: ReactiveSessionPreview3D<T>;
};
type Inspection = {
  id: number;
  kind: 'queries' | 'changes';
  payload: unknown;
  started: boolean;
  reason: string | null;
  progress: ReactiveWorkerInspectionProgress3D | null;
  total: number;
  validate(raw: unknown): unknown;
  resolve(value: unknown): void;
  reject(error: Error): void;
};
export function createReactiveWorkerClient3D<T extends ReactiveGameValue3D>(
  transport: ReactiveWorkerTransport3D,
  registry: ReactiveMaterialRegistry3D,
  options: ReactiveWorkerClientOptions3D,
): ReactiveWorkerClient3D<T> {
  fields(options, ['channel', 'worldId', 'gameRulesVersion'], ['timeoutMs', 'schedule']);
  const channel = workerName(options.channel),
    worldId = workerName(options.worldId),
    gameRulesVersion = workerName(options.gameRulesVersion);
  const timeout = Object.hasOwn(options, 'timeoutMs')
    ? integer(options.timeoutMs, 1, REACTIVE_WORKER_LIMITS_3D.maxTimeoutMs)
    : REACTIVE_WORKER_LIMITS_3D.timeoutMs;
  if (Object.hasOwn(options, 'schedule') && typeof options.schedule !== 'function')
    throw Error('Invalid reactive task scheduler.');
  const schedule =
    options.schedule ??
    ((task) => {
      const id = setTimeout(task, 0);
      return () => clearTimeout(id);
    });
  let confirmed: ReactiveSessionSnapshot3D<T> | null = null,
    active: Request<T> | null = null,
    waiting: Request<T> | null = null;
  let sequence = 0,
    serial = 0,
    failed: string | null = null,
    uncertain = false,
    closing = false,
    closed = false;
  let unsubscribe = () => {},
    cancelTask: (() => void) | null = null,
    taskGeneration = 0;
  const tickets = new WeakMap<ReactiveWorkerTicket3D<T>, Request<T>>();
  const commits = new WeakMap<
    ReactiveSessionCommit3D<T>,
    { before: ReactiveSessionSnapshot3D<T>; after: ReactiveSessionSnapshot3D<T> }
  >();
  let latestCommit: {
    before: ReactiveSessionSnapshot3D<T>;
    after: ReactiveSessionSnapshot3D<T>;
  } | null = null;
  let inspection: Inspection | null = null,
    inspectionSerial = 0;
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => {});
  let closePromise: Promise<void> | null = null,
    resolveClose = () => {},
    rejectClose = (_error: Error) => {};
  let flight: {
    seq: number;
    kind: string;
    timer: ReturnType<typeof setTimeout>;
    mutation: boolean;
    accept(value: unknown): void;
    reject(error: Error): void;
  } | null = null;
  const listeners = new Set<{ listener: (state: ReactiveWorkerState3D) => void }>();
  let notificationQueued = false;
  function readState(): ReactiveWorkerState3D {
    return Object.freeze({
      status: failed
        ? 'failed'
        : closed
          ? 'closed'
          : closing
            ? 'closing'
            : !confirmed
              ? 'connecting'
              : flight || inspection || waiting || (active && !active.candidate)
                ? 'working'
                : 'ready',
      activeId: active?.id ?? null,
      waitingId: waiting?.id ?? null,
      progress: active?.progress ? { ...active.progress } : null,
      inspection: structuredClone(inspection?.progress ?? null),
      uncertain,
      error: failed,
    });
  }
  function deliver(
    token: { listener: (state: ReactiveWorkerState3D) => void },
    state: ReactiveWorkerState3D,
  ) {
    if (!listeners.has(token)) return;
    try {
      token.listener(Object.freeze(structuredClone(state)));
    } catch {
      /* Observers cannot interrupt protocol processing or strand other observers. */
    }
    if (state.status === 'failed' || state.status === 'closed') listeners.delete(token);
  }
  function changed() {
    if (notificationQueued || !listeners.size) return;
    notificationQueued = true;
    queueMicrotask(() => {
      notificationQueued = false;
      const state = readState();
      for (const token of [...listeners]) deliver(token, state);
    });
  }
  const current = () => {
    if (!confirmed) throw Error('Reactive worker is not ready.');
    return confirmed;
  };
  const usable = () => {
    if (failed || closed || closing) throw Error(failed ?? 'Reactive worker is closed.');
    current();
  };
  function finish(r: Request<T>, status: Reason | 'failed', error: string | null = null) {
    r.candidate = undefined;
    if (!r.settled) {
      r.settled = true;
      r.resolve({ id: r.id, status, error });
    }
  }
  function unschedule() {
    taskGeneration++;
    const cancel = cancelTask;
    cancelTask = null;
    cancel?.();
  }
  function dispose() {
    unschedule();
    try {
      unsubscribe();
    } finally {
      transport.close();
    }
  }
  function fail(error: unknown) {
    if (failed || closed) return;
    failed = workerError(error);
    const e = Error(failed),
      p = flight;
    flight = null;
    if (p) {
      clearTimeout(p.timer);
      uncertain ||= p.mutation;
      p.reject(e);
    }
    inspection?.reject(e);
    inspection = null;
    if (active) finish(active, 'failed', failed);
    if (waiting) finish(waiting, 'failed', failed);
    active = null;
    waiting = null;
    rejectReady(e);
    rejectClose(e);
    try {
      dispose();
    } catch {
      /* terminal; keep the last acknowledged save */
    } finally {
      changed();
    }
  }
  function send(
    kind: string,
    payload: unknown,
    accept: (value: unknown) => void,
    reject: (error: Error) => void,
    mutation = false,
  ) {
    if (flight || failed || closed) throw Error('Reactive worker request already in flight.');
    const seq = integer(sequence + 1, 1, Number.MAX_SAFE_INTEGER);
    sequence = seq;
    const timer = setTimeout(() => fail(Error('Reactive worker request timed out.')), timeout);
    flight = { seq, kind, timer, accept, reject, mutation };
    changed();
    try {
      transport.send(workerMessage(channel, seq, kind, payload));
    } catch (error) {
      fail(error);
    }
  }
  function later() {
    if (cancelTask || failed || closed) return;
    let armed = false;
    const generation = ++taskGeneration;
    const cancel = schedule(() => {
      if (!armed) {
        fail(Error('Reactive scheduler must yield a task.'));
        return;
      }
      if (generation !== taskGeneration || failed || closed) return;
      cancelTask = null;
      pump();
    });
    armed = true;
    if (typeof cancel !== 'function') throw Error('Reactive scheduler must return cancellation.');
    if (failed || closed) cancel();
    else cancelTask = cancel;
  }
  function rejectPreview(r: Request<T>, error: Error) {
    finish(r, r.reason ?? 'failed', workerError(error));
    if (active === r) active = null;
  }
  function acceptProgress(r: Request<T>, raw: unknown) {
    fields(raw, ['target', 'branchId', 'progress', 'preview']);
    const branchId = integer(raw.branchId, 1, Number.MAX_SAFE_INTEGER);
    if (raw.target !== r.id || (r.branchId !== undefined && r.branchId !== branchId))
      throw Error('Reactive preview target differs.');
    const progress = workerProgress(
      raw.progress,
      r.commands.length,
      r.options.horizonTicks,
      r.progress,
    );
    if (!r.progress && progress.status !== 'preparing')
      throw Error('Reactive worker skipped preparation.');
    r.branchId = branchId;
    r.progress = progress;
    if (progress.status === 'ready') {
      fields(raw.preview, ['base', 'branchId', 'progress', 'state']);
      if (
        !workerSameRevision(raw.preview.base, r.base) ||
        raw.preview.branchId !== branchId ||
        !workerEqual(raw.preview.progress, progress)
      )
        throw Error('Reactive preview identity differs.');
      const state = workerSnapshot<T>(registry, raw.preview.state, current());
      if (
        state.revision !== r.base.revision ||
        state.domains.tick !== r.base.tick + r.options.horizonTicks ||
        state.accounting.initialQ !== current().accounting.initialQ
      )
        throw Error('Reactive preview state differs.');
      if (!r.reason) {
        r.candidate = { base: { ...r.base }, branchId, progress, state };
        r.settled = true;
        r.resolve({ id: r.id, status: 'ready', preview: structuredClone(r.candidate) });
      }
    } else if (raw.preview !== null) throw Error('Reactive worker exposed a partial preview.');
  }
  function inspectionReply(r: Inspection, raw: unknown) {
    fields(raw, ['inspection', 'kind', 'progress', 'result']);
    if (raw.inspection !== r.id || raw.kind !== r.kind)
      throw Error('Reactive inspection identity differs.');
    const p = raw.progress,
      old = r.progress;
    if (r.kind === 'queries') {
      fields(p, ['status', 'completedQueries', 'totalQueries']);
      const completed = integer(p.completedQueries, 0, r.total);
      if (
        p.totalQueries !== r.total ||
        !['running', 'complete'].includes(p.status as string) ||
        (p.status === 'complete' && completed !== r.total) ||
        (p.status === 'running' && completed === r.total) ||
        (old && old.kind === 'queries' && completed < old.value.completedQueries) ||
        (!old && completed !== 0)
      )
        throw Error('Reactive query progress differs.');
      r.progress = { kind: 'queries', value: { ...p } as ReactiveQueryProgress3D };
    } else {
      fields(p, ['status', 'phase', 'scannedCells', 'comparedSupportCells', 'totalCells']);
      const scanned = integer(p.scannedCells, 0, r.total),
        compared = integer(p.comparedSupportCells, 0, r.total);
      const phases = ['scan', 'support-before', 'support-after', 'support-compare', 'complete'],
        at = phases.indexOf(p.phase as string);
      if (
        p.totalCells !== r.total ||
        !['running', 'complete'].includes(p.status as string) ||
        at < 0 ||
        (p.status === 'complete') !== (p.phase === 'complete') ||
        (at > 0 && scanned !== r.total) ||
        (at < 3 && compared !== 0) ||
        (p.status === 'complete' && compared !== r.total) ||
        (!old && (scanned !== 0 || compared !== 0 || p.phase !== 'scan')) ||
        (old &&
          old.kind === 'changes' &&
          (scanned < old.value.scannedCells ||
            compared < old.value.comparedSupportCells ||
            at < phases.indexOf(old.value.phase)))
      )
        throw Error('Reactive change progress differs.');
      r.progress = { kind: 'changes', value: { ...p } as ReactiveChangeProgress3D };
    }
    if (r.progress.value.status === 'complete') {
      const result = r.validate(raw.result);
      inspection = null;
      if (r.reason) r.reject(Error(r.reason));
      else r.resolve(result);
    } else if (raw.result !== null) throw Error('Reactive inspection exposed a partial result.');
  }
  function inspect<R>(
    kind: Inspection['kind'],
    payload: object,
    total: number,
    validate: (raw: unknown) => R,
  ): Promise<R> {
    usable();
    if (flight || inspection || waiting || (active && (!active.candidate || active.reason)))
      throw Error('Reactive inspection requires an idle complete boundary.');
    unschedule();
    const id = integer(inspectionSerial + 1, 1, Number.MAX_SAFE_INTEGER);
    inspectionSerial = id;
    return new Promise<R>((resolve, reject) => {
      inspection = {
        id,
        kind,
        payload: { inspection: id, kind, base: reactiveSessionRevision3D(current()), ...payload },
        started: false,
        reason: null,
        progress: null,
        total,
        validate,
        resolve: (value) => resolve(value as R),
        reject,
      };
      pump();
    });
  }
  function candidate(ticket: ReactiveWorkerTicket3D<T>) {
    usable();
    const r = tickets.get(ticket);
    if (
      !r ||
      active !== r ||
      !r.candidate ||
      r.reason ||
      !workerSameRevision(r.base, reactiveSessionRevision3D(current()))
    )
      throw Error('Only the latest ready reactive ticket can be inspected.');
    return r;
  }
  function query(requests: readonly ReactiveWorkerQuery3D[], r?: Request<T>) {
    const preview = r?.candidate,
      state = preview?.state ?? current(),
      owned = readReactiveQueries3D(requests, state);
    return inspect(
      'queries',
      { target: r?.id ?? null, from: null, request: owned },
      owned.length,
      (raw) => readReactiveQueryBatch3D(registry, raw, owned, state, preview),
    );
  }
  function changes(
    before: ReactiveSessionSnapshot3D<T>,
    after: ReactiveSessionSnapshot3D<T>,
    domain: ReactiveDomainId3D,
    request: ReactiveChangeOptions3D,
    r?: Request<T>,
  ) {
    reactiveDomainId3D(domain);
    const options = readReactiveChangeOptions3D(request),
      n = reactiveDomain3D(after.domains, domain).block.packedCells.length;
    const from = reactiveWorkerGeometryStamp3D(before, domain),
      to = reactiveWorkerGeometryStamp3D(after, domain, r?.candidate);
    return inspect(
      'changes',
      {
        target: r?.id ?? null,
        from: r ? null : reactiveSessionRevision3D(before),
        request: { domain, ...options },
      },
      n,
      (raw) => readReactiveChangeReport3D(registry, raw, before, after, from, to, options.maxRuns),
    );
  }
  function pump() {
    changed();
    if (flight || cancelTask || failed || closed || !confirmed) return;
    try {
      if (inspection) {
        const r = inspection;
        const reject = (error: Error) => {
          inspection = null;
          r.reject(error);
        };
        if (r.reason && !r.started) {
          inspection = null;
          r.reject(Error(r.reason));
          later();
        } else if (r.reason)
          send(
            'inspect-cancel',
            { inspection: r.id },
            (raw) => {
              fields(raw, ['inspection']);
              if (raw.inspection !== r.id) throw Error('Reactive inspection cancellation differs.');
              inspection = null;
              r.reject(Error(r.reason!));
            },
            reject,
          );
        else {
          const start = !r.started;
          r.started = true;
          send(
            start ? 'inspect-start' : 'inspect-advance',
            start ? r.payload : { inspection: r.id },
            (raw) => inspectionReply(r, raw),
            reject,
          );
        }
        return;
      }
      if (active?.reason) {
        const r = active;
        send(
          'discard',
          { target: r.id, base: r.base },
          (raw) => {
            fields(raw, ['target']);
            if (raw.target !== r.id) throw Error('Reactive discard acknowledgement differs.');
            finish(r, r.reason!);
            active = null;
          },
          (error) => rejectPreview(r, error),
        );
        return;
      }
      if (closing) {
        send(
          'close',
          null,
          (raw) => {
            if (raw !== null) throw Error('Reactive close acknowledgement differs.');
            dispose();
            closed = true;
            resolveClose();
          },
          (error) => fail(error),
        );
        return;
      }
      if (!active && waiting) {
        const r = waiting;
        waiting = null;
        active = r;
        send(
          'start',
          { target: r.id, base: r.base, commands: r.commands, options: r.options },
          (raw) => acceptProgress(r, raw),
          (error) => rejectPreview(r, error),
        );
        return;
      }
      if (active && !active.candidate) {
        const r = active;
        send(
          'advance',
          { target: r.id, base: r.base },
          (raw) => acceptProgress(r, raw),
          (error) => rejectPreview(r, error),
        );
      }
    } catch (error) {
      fail(error);
    }
  }
  function receive(raw: unknown) {
    if (failed || closed) return;
    try {
      const m = workerEnvelope(raw, channel),
        p = flight;
      if (!p || p.seq !== m.seq) throw Error('Unexpected or duplicate reactive worker reply.');
      if (m.kind === 'error') {
        fields(m.payload, ['message', 'fatal']);
        if (
          typeof m.payload.message !== 'string' ||
          m.payload.message.length > 4096 ||
          typeof m.payload.fatal !== 'boolean'
        )
          throw Error('Invalid reactive worker error.');
        if (m.payload.fatal || p.kind === 'hello' || p.kind === 'close')
          throw Error(m.payload.message);
        clearTimeout(p.timer);
        flight = null;
        p.reject(Error(m.payload.message));
      } else {
        if (m.kind !== p.kind) throw Error('Reactive worker reply kind differs.');
        p.accept(m.payload);
        clearTimeout(p.timer);
        flight = null;
      }
      // Never spin physical work in a microtask chain, even with an immediate mock port.
      later();
    } catch (error) {
      fail(error);
    } finally {
      changed();
    }
  }
  const client = Object.freeze<ReactiveWorkerClient3D<T>>({
    ready,
    get state() {
      return readState();
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw Error('Expected a worker state listener.');
      // Each subscription owns its own token, including repeated subscriptions of one callback.
      const token = { listener };
      listeners.add(token);
      // Initial delivery targets this subscription only; subscribing must not rebroadcast to peers.
      queueMicrotask(() => deliver(token, readState()));
      return () => {
        listeners.delete(token);
      };
    },
    whenIdle() {
      return new Promise<void>((resolve, reject) => {
        let remove = () => {};
        const check = (state: ReactiveWorkerState3D) => {
          if (
            state.status === 'failed' ||
            state.status === 'closed' ||
            state.status === 'closing'
          ) {
            remove();
            reject(Error(state.error ?? 'Reactive worker is closed.'));
          } else if (state.status === 'ready') {
            remove();
            resolve();
          }
        };
        remove = client.subscribe(check);
        check(readState());
      });
    },
    snapshot: () => structuredClone(current()),
    query(requests) {
      usable();
      return query(requests);
    },
    queryPreview(ticket, requests) {
      return query(requests, candidate(ticket));
    },
    changes(commit, domain = null, options = {}) {
      usable();
      const saved = commits.get(commit);
      if (
        !saved ||
        saved !== latestCommit ||
        !workerSameRevision(
          reactiveSessionRevision3D(saved.after),
          reactiveSessionRevision3D(current()),
        )
      )
        throw Error('Only the latest acknowledged reactive commit can be inspected.');
      return changes(saved.before, saved.after, domain, options);
    },
    changesPreview(ticket, domain = null, options = {}) {
      const r = candidate(ticket);
      return changes(current(), r.candidate!.state, domain, options, r);
    },
    cancelInspection() {
      if (!inspection || inspection.reason || failed || closed) return false;
      inspection.reason = 'Reactive inspection cancelled.';
      try {
        unschedule();
        pump();
      } catch (error) {
        fail(error);
      }
      return true;
    },
    request(commands, requestOptions) {
      usable();
      if (flight?.mutation) throw Error('Reactive mutation is in flight.');
      const r = workerRequest(commands, requestOptions),
        base = reactiveSessionRevision3D(current());
      integer(base.tick + r.options.horizonTicks, 0, Number.MAX_SAFE_INTEGER);
      const id = integer(serial + 1, 1, Number.MAX_SAFE_INTEGER);
      let resolve!: Request<T>['resolve'];
      const result = new Promise<ReactiveWorkerOutcome3D<T>>((done) => {
        resolve = done;
      });
      const record: Request<T> = { ...r, id, base, resolve, settled: false };
      const ticket = Object.freeze({
        id,
        result,
        cancel() {
          if (failed || closed || record.reason || (active !== record && waiting !== record))
            return;
          record.reason = 'cancelled';
          if (waiting === record) {
            waiting = null;
            finish(record, 'cancelled');
          }
          if (inspection) inspection.reason = 'Reactive preview inspection cancelled.';
          try {
            unschedule();
            pump();
          } catch (error) {
            fail(error);
          }
        },
      });
      if (waiting) finish(waiting, 'superseded');
      if (active && !active.reason) active.reason = 'superseded';
      if (inspection) inspection.reason = 'Reactive inspection superseded.';
      serial = id;
      tickets.set(ticket, record);
      waiting = record;
      try {
        unschedule();
        pump();
      } catch (error) {
        fail(error);
      }
      return ticket;
    },
    commit(ticket) {
      usable();
      const r = tickets.get(ticket);
      if (
        flight ||
        inspection ||
        waiting ||
        !r ||
        active !== r ||
        !r.candidate ||
        r.reason ||
        !workerSameRevision(r.base, reactiveSessionRevision3D(current()))
      )
        throw Error('Only the latest idle ready reactive ticket can commit.');
      const candidate = r.candidate,
        previous = current();
      unschedule();
      active = null;
      return new Promise<ReactiveSessionCommit3D<T>>((resolve, reject) =>
        send(
          'commit',
          { target: r.id, base: r.base },
          (raw) => {
            fields(raw, ['snapshot', 'receipt']);
            fields(raw.receipt, [
              'base',
              'revision',
              'completedCommands',
              'horizonTicks',
              'endTick',
              'externalEnergyQ',
            ]);
            const snapshot = workerSnapshot<T>(registry, raw.snapshot, previous),
              receipt = raw.receipt;
            if (
              !workerEqual(snapshot, { ...candidate.state, revision: r.base.revision + 1 }) ||
              !workerSameRevision(receipt.base, r.base) ||
              receipt.revision !== snapshot.revision ||
              receipt.completedCommands !== r.commands.length ||
              receipt.horizonTicks !== r.options.horizonTicks ||
              receipt.endTick !== snapshot.domains.tick ||
              receipt.externalEnergyQ !==
                (
                  BigInt(snapshot.accounting.externalQ) - BigInt(previous.accounting.externalQ)
                ).toString()
            )
              throw Error('Reactive commit differs from accepted preview.');
            const committed = structuredClone({ snapshot, receipt }) as ReactiveSessionCommit3D<T>;
            latestCommit = { before: previous, after: snapshot };
            commits.set(committed, latestCommit);
            confirmed = snapshot;
            resolve(committed);
          },
          reject,
          true,
        ),
      );
    },
    restore(value) {
      usable();
      if (flight || inspection || active || waiting)
        throw Error('Reactive restore requires an idle worker; discard its preview first.');
      const saved = workerSnapshot<T>(registry, value, current()),
        base = reactiveSessionRevision3D(current());
      unschedule();
      return new Promise<ReactiveSessionSnapshot3D<T>>((resolve, reject) =>
        send(
          'restore',
          { base, snapshot: saved },
          (raw) => {
            const snapshot = workerSnapshot<T>(registry, raw, current());
            if (!workerEqual(snapshot, { ...saved, revision: base.revision + 1 }))
              throw Error('Reactive restore acknowledgement differs.');
            latestCommit = null;
            confirmed = snapshot;
            resolve(structuredClone(snapshot));
          },
          reject,
          true,
        ),
      );
    },
    close() {
      if (closePromise) return closePromise;
      closePromise = new Promise<void>((resolve, reject) => {
        resolveClose = resolve;
        rejectClose = reject;
      });
      void closePromise.catch(() => {});
      if (failed) {
        rejectClose(Error(failed));
        return closePromise;
      }
      closing = true;
      if (waiting) finish(waiting, 'closed');
      waiting = null;
      if (active) active.reason = 'closed';
      if (inspection) inspection.reason = 'Reactive worker is closing.';
      try {
        unschedule();
        pump();
      } catch (error) {
        fail(error);
      }
      return closePromise;
    },
  });
  try {
    unsubscribe = transport.subscribe(receive, (error) => fail(error));
    if (failed) unsubscribe();
    else
      send(
        'hello',
        null,
        (raw) => {
          const s = workerSnapshot<T>(registry, raw);
          if (s.worldId !== worldId || s.gameRulesVersion !== gameRulesVersion)
            throw Error('Reactive worker handshake identity differs.');
          confirmed = s;
          resolveReady();
        },
        (error) => fail(error),
      );
  } catch (error) {
    fail(error);
  }
  return client;
}
/** Owns and terminates an already-created Worker. This adapter never launches one. */
export function reactiveBrowserWorkerTransport3D(worker: Worker): ReactiveWorkerTransport3D {
  return {
    send: (value) => worker.postMessage(value),
    close: () => worker.terminate(),
    subscribe(receive, failed) {
      const message = (event: MessageEvent) => receive(event.data),
        error = () => failed(Error('Reactive Worker transport failed.'));
      worker.addEventListener('message', message);
      worker.addEventListener('error', error);
      worker.addEventListener('messageerror', error);
      return () => {
        worker.removeEventListener('message', message);
        worker.removeEventListener('error', error);
        worker.removeEventListener('messageerror', error);
      };
    },
  };
}
