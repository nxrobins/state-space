/** Bounded asynchronous client; only acknowledged commits replace cached state. */
import { copyTacticalValue } from './tactical-session-core.js';
import { queryRequestsData, queryBatchData, previewQueryBatchData, type TacticalWorkerQuery3D, type TacticalWorkerQueryBatch3D, type TacticalWorkerPreviewQueryBatch3D } from './tactical-worker-queries.js';
import { changeOptionsData, changeReportData } from './tactical-worker-changes.js';
import { captureData, motionJournalData } from './tactical-worker-motion.js';
import { pathJournalData } from './tactical-worker-paths.js';
import { actionJournalData } from './tactical-worker-journal.js';
import type { ActionJournal3D } from './action-journal.js';
import type { PathJournal3D } from './path-journal.js';
import type { MotionJournal3D } from './motion-trace.js';
import type { TacticalPreviewCapture3D } from './tactical-preview-capture.js';
import type { ChangeReportOptions3D, GameplayChangeReport3D } from './change-reports.js';
import { checkedInteger } from '../validation.js';
import { TACTICAL_PREVIEW_LIMITS_3D, type TacticalPreviewOutcome3D, type TacticalPreviewTicket3D } from './tactical-previews.js';
import { TACTICAL_WORKER_LIMITS_3D, channelName, envelope, fields, revisionOf, sameRevision, snapshotData,
  compatibleSnapshot, outcomeData, wire, workerError, type TacticalTransport3D } from './tactical-worker-wire.js';
import type { TacticalCommit3D, TacticalPreview3D, TacticalRevision3D, TacticalSessionSnapshot3D, TacticalValue } from './tactical-session-view.js';

export type TacticalWorkerCommit3D<T extends TacticalValue> = Pick<TacticalCommit3D<T>, 'snapshot' | 'receipt'>;
export type TacticalWorkerOptions3D = {channel: string; worldId: string; gameRulesVersion: string; timeoutMs?: number};
export interface TacticalWorkerClient3D<T extends TacticalValue, C extends TacticalValue> {
  readonly ready: Promise<void>;
  readonly state: Readonly<{status: 'connecting' | 'ready' | 'working' | 'closing' | 'closed' | 'failed';
    activeId: number | null; waitingId: number | null; readyId: number | null; uncertain: boolean; error: string | null}>;
  snapshot(): TacticalSessionSnapshot3D<T>;
  query(requests: readonly TacticalWorkerQuery3D[]): Promise<TacticalWorkerQueryBatch3D>;
  queryPreview(ticket: TacticalPreviewTicket3D<T>, requests: readonly TacticalWorkerQuery3D[]): Promise<TacticalWorkerPreviewQueryBatch3D>;
  changes(commit: TacticalWorkerCommit3D<T>, options?: ChangeReportOptions3D): Promise<GameplayChangeReport3D>;
  motion(commit: TacticalWorkerCommit3D<T>): Promise<MotionJournal3D>;
  paths(commit: TacticalWorkerCommit3D<T>): Promise<PathJournal3D>;
  journal(commit: TacticalWorkerCommit3D<T>): Promise<ActionJournal3D>;
  journalPreview(ticket: TacticalPreviewTicket3D<T>): Promise<ActionJournal3D>;
  request(command: C, horizonTicks: number, capture?: TacticalPreviewCapture3D): TacticalPreviewTicket3D<T>;
  commit(ticket: TacticalPreviewTicket3D<T>): Promise<TacticalWorkerCommit3D<T>>;
  restore(snapshot: TacticalSessionSnapshot3D<T>): Promise<TacticalSessionSnapshot3D<T>>;
  close(): Promise<void>;
}
type Request<T extends TacticalValue, C extends TacticalValue> = {
  capture: TacticalPreviewCapture3D;
  candidate?: TacticalPreview3D<T>;
  id: number; command?: C; horizon: number; base: Readonly<TacticalRevision3D>; wireSeq?: number;
  reason?: 'superseded' | 'cancelled' | 'closed'; cancelSent?: boolean; settled: boolean; resolve: (value: TacticalPreviewOutcome3D<T>) => void;
};
type Pending<T extends TacticalValue> = {seq: number; kind: string; timer: ReturnType<typeof setTimeout>;
  base?: Readonly<TacticalRevision3D>; horizon?: number; saved?: TacticalSessionSnapshot3D<T>;
  queries?: TacticalWorkerQuery3D[];
  candidate?: TacticalPreview3D<T>; target?: number; previewCurrent?: () => boolean;
  changeFrom?: Readonly<TacticalRevision3D>; maxRuns?: number; operation?: number; externalQ?: bigint;
  capture?: TacticalPreviewCapture3D;
  resolve?: (value: unknown) => void; reject?: (error: Error) => void};
function equalData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => equalData(v, b[i]));
  if (Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>, keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(k => Object.hasOwn(right, k) && equalData(left[k], right[k]));
}

export function createTacticalWorkerClient3D<T extends TacticalValue, C extends TacticalValue>(
  transport: TacticalTransport3D, options: TacticalWorkerOptions3D,
): TacticalWorkerClient3D<T, C> {
  fields(options, ['channel', 'worldId', 'gameRulesVersion'], ['timeoutMs']);
  const channel = channelName(options.channel), worldId = options.worldId, gameRulesVersion = options.gameRulesVersion;
  for (const value of [worldId, gameRulesVersion]) if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value)) throw Error('Invalid worker identity.');
  const timeout = checkedInteger(options.timeoutMs ?? TACTICAL_WORKER_LIMITS_3D.timeoutMs, 1, TACTICAL_WORKER_LIMITS_3D.maxTimeoutMs, 'worker timeout');
  let serial = 0, requestSerial = 0, confirmed: TacticalSessionSnapshot3D<T> | undefined, fatal: string | null = null;
  let closing = false, closed = false, uncertain = false, flight: Pending<T> | undefined, cancellation: Pending<T> | undefined;
  let active: Request<T, C> | undefined, waiting: Request<T, C> | undefined, readyRecord: Request<T, C> | undefined;
  let unsubscribe = () => {}, resolveReady!: () => void, rejectReady!: (error: Error) => void;
  let closePromise: Promise<void> | undefined, resolveClose: (() => void) | undefined, rejectClose: ((error: Error) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {resolveReady = resolve; rejectReady = reject;}); void ready.catch(() => {});
  const tickets = new WeakMap<TacticalPreviewTicket3D<T>, Request<T, C>>();
  type CommitStamp = {from: Readonly<TacticalRevision3D>; to: Readonly<TacticalRevision3D>; capture: TacticalPreviewCapture3D; operation: number; externalQ: bigint};
  const commits = new WeakMap<TacticalWorkerCommit3D<T>, CommitStamp>(); let latestCommit: CommitStamp | undefined;
  const current = () => {if (!confirmed) throw Error('Worker handshake is incomplete.'); return confirmed;};
  const usable = () => {if (fatal || closing || closed) throw Error(fatal ?? 'Worker client is closed.'); current();};
  function terminal(r: Request<T, C> | undefined, status: 'superseded' | 'cancelled' | 'closed' | 'failed', error: string | null = null) {
    if (!r) return; r.command = undefined; r.candidate = undefined;
    if (!r.settled) {r.settled = true; r.resolve({id: r.id, base: r.base, horizonTicks: r.horizon, status, error});}
  }
  function dispose() {
    try {unsubscribe();} catch (error) {fatal ??= workerError(error);}
    try {transport.close();} catch (error) {fatal ??= workerError(error);}
  }
  function fail(error: unknown) {
    if (fatal || closed) return;
    fatal = workerError(error); uncertain ||= flight?.kind === 'commit' || flight?.kind === 'restore';
    const failure = Error(fatal);
    for (const p of [flight, cancellation]) if (p) {clearTimeout(p.timer); p.reject?.(failure);}
    flight = undefined; cancellation = undefined;
    terminal(active, 'failed', fatal); terminal(waiting, 'failed', fatal); terminal(readyRecord, 'failed', fatal);
    active = undefined; waiting = undefined; readyRecord = undefined; latestCommit = undefined; rejectReady(failure); rejectClose?.(failure); dispose();
  }
  function send(kind: string, payload: unknown, extra: Omit<Pending<T>, 'seq' | 'kind' | 'timer'> = {}) {
    const seq = checkedInteger(serial + 1, 1, Number.MAX_SAFE_INTEGER, 'worker message sequence'); serial = seq;
    const pending: Pending<T> = {seq, kind, ...extra, timer: setTimeout(() => fail(Error('Worker request timed out; no automatic retry.')), timeout)};
    if (kind === 'cancel') cancellation = pending; else flight = pending;
    if (kind === 'preview' && active) active.wireSeq = seq;
    try {transport.send(wire(channel, seq, kind, payload));} catch (error) {fail(error);}
  }
  function pump() {
    if (fatal || closed) return;
    if (flight?.kind === 'preview' && active?.reason && !active.cancelSent && !cancellation) {
      active.cancelSent = true; send('cancel', {target: flight.seq});
    }
    if (flight || cancellation) return;
    if (closing) {send('close', null); return;}
    if (waiting) {
      const next = waiting; active = next; waiting = undefined;
      const payload = {base: next.base, command: next.command, horizonTicks: next.horizon, capture: next.capture}; next.command = undefined;
      send('preview', payload);
    }
  }
  function invalidate(r: Request<T, C>, reason: 'superseded' | 'cancelled' | 'closed') {
    r.reason ??= reason; r.candidate = undefined;
    if (waiting === r) {waiting = undefined; terminal(r, r.reason);}
    if (readyRecord === r) readyRecord = undefined;
  }
  function receive(raw: unknown) {
    if (fatal || closed) return;
    try {
      const m = envelope(raw, channel), p = m.seq === flight?.seq ? flight : m.seq === cancellation?.seq ? cancellation : undefined;
      if (!p) throw Error('Unexpected or duplicate worker reply.');
      if (m.kind === 'error') {
        fields(m.payload, ['message', 'fatal']);
        if (typeof m.payload.message !== 'string' || m.payload.message.length > 4096 || typeof m.payload.fatal !== 'boolean') throw Error('Malformed worker error.');
        if (m.payload.fatal || !['commit', 'query', 'query-preview', 'journal', 'journal-preview', 'changes', 'motion', 'paths'].includes(p.kind)) throw Error(m.payload.message);
        clearTimeout(p.timer); flight = undefined; if (p.kind === 'commit') readyRecord = undefined;
        p.reject?.(Error(p.previewCurrent && !p.previewCurrent() ? 'Preview is no longer current.' : m.payload.message)); pump(); return;
      }
      if (m.kind !== p.kind) throw Error('Worker reply operation differs.');
      // Keep mutation in flight until validation finishes, so failures remain uncertain.
      if (p.kind === 'hello') {
        const s = snapshotData<T>(m.payload);
        if (s.worldId !== worldId || s.gameRulesVersion !== gameRulesVersion) throw Error('Worker handshake identity differs.');
        confirmed = s; resolveReady();
      } else if (p.kind === 'cancel') {
        fields(m.payload, ['target']);
        if (m.payload.target !== active?.wireSeq) throw Error('Cancellation acknowledgement differs.');
      } else if (p.kind === 'preview') {
        if (!active) throw Error('Missing active preview.');
        const r = active, outcome = outcomeData<T>(m.payload, r.base, r.horizon, r.id);
        if (outcome.status === 'ready') compatibleSnapshot(current(), outcome.preview);
        if (r.reason) terminal(r, r.reason);
        else {
          r.settled = true;
          if (outcome.status === 'ready') {r.candidate = outcome.preview; readyRecord = r;}
          r.resolve(structuredClone(outcome));
        }
        // Retain active until an outstanding cancellation acknowledgement arrives.
        if (!cancellation) active = undefined;
      } else if (p.kind === 'commit') {
        fields(m.payload, ['snapshot', 'receipt']); fields(m.payload.receipt, ['base', 'revision', 'horizonTicks', 'endTick', 'externalEnergyQ']);
        const s = snapshotData<T>(m.payload.snapshot), receipt = m.payload.receipt;
        compatibleSnapshot(current(), s);
        if (!sameRevision(receipt.base, p.base!) || s.revision !== p.base!.revision + 1 || receipt.revision !== s.revision ||
            receipt.horizonTicks !== p.horizon || receipt.endTick !== s.terrain.tick || s.terrain.tick !== p.base!.tick + p.horizon! ||
            s.accounting.initialQ !== current().accounting.initialQ || receipt.externalEnergyQ !== (BigInt(s.accounting.externalQ) - BigInt(current().accounting.externalQ)).toString()) throw Error('Worker commit receipt differs.');
        const committed = {snapshot: structuredClone(s), receipt: structuredClone(receipt)} as TacticalWorkerCommit3D<T>;
        latestCommit = {from: p.base!, to: revisionOf(s), capture: p.capture!, operation: p.operation!, externalQ: BigInt(receipt.externalEnergyQ as string)}; commits.set(committed, latestCommit);
        confirmed = s; p.resolve?.(committed);
      } else if (p.kind === 'restore') {
        const s = snapshotData<T>(m.payload); compatibleSnapshot(current(), s);
        if (!equalData(s, {...p.saved!, revision: p.base!.revision + 1})) throw Error('Worker restore differs from the requested state.');
        latestCommit = undefined; confirmed = s; p.resolve?.(structuredClone(s));
      } else if (p.kind === 'query') {
        p.resolve?.(queryBatchData(m.payload, p.queries!, p.base!, current()));
      } else if (p.kind === 'query-preview') {
        const result = previewQueryBatchData(m.payload, p.queries!, p.target!, p.candidate!);
        if (!p.previewCurrent!()) p.reject?.(Error('Preview is no longer current.')); else p.resolve?.(result);
      } else if (p.kind === 'changes') {
        p.resolve?.(changeReportData(m.payload, p.changeFrom!, p.base!, current(), p.maxRuns!));
      } else if (p.kind === 'motion') {
        p.resolve?.(motionJournalData(m.payload, p.changeFrom!, p.base!, current(), p.capture!));
      } else if (p.kind === 'paths') {
        p.resolve?.(pathJournalData(m.payload, p.changeFrom!, p.base!, current(), p.capture!));
      } else if (p.kind === 'journal') {
        p.resolve?.(actionJournalData(m.payload, p.changeFrom!, {kind: 'committed', revision: p.base!}, current(), p.operation!, p.capture!, p.externalQ!));
      } else if (p.kind === 'journal-preview') {
        fields(m.payload, ['target', 'journal']);
        if (m.payload.target !== p.target) throw Error('Action preview target differs.');
        const candidate = p.candidate!, target = {kind: 'preview' as const, ...candidate.preview};
        const result = actionJournalData(m.payload.journal, target.base, target, candidate, target.operation, p.capture!,
          BigInt(candidate.accounting.externalQ) - BigInt(current().accounting.externalQ));
        if (!p.previewCurrent!()) p.reject?.(Error('Preview is no longer current.')); else p.resolve?.(result);
      } else if (p.kind === 'close') {
        if (m.payload !== null) throw Error('Invalid close acknowledgement.');
        closed = true; dispose(); if (fatal) rejectClose?.(Error(fatal)); else resolveClose?.();
      } else throw Error('Unsupported worker reply.');
      clearTimeout(p.timer);
      if (p === cancellation) {cancellation = undefined; if (!flight || flight.kind !== 'preview') active = undefined;}
      else flight = undefined;
      pump();
    } catch (error) {fail(error);}
  }
  const client = Object.freeze<TacticalWorkerClient3D<T, C>>({ready,
    get state() {return Object.freeze({status: fatal ? 'failed' : closed ? 'closed' : closing ? 'closing' : !confirmed ? 'connecting' : flight || cancellation ? 'working' : 'ready',
      activeId: active?.id ?? null, waitingId: waiting?.id ?? null, readyId: readyRecord?.id ?? null, uncertain, error: fatal});},
    snapshot: () => structuredClone(current()),
    journal(commit) {
      usable(); if (flight || cancellation || waiting) throw Error('Action journals require an idle worker.');
      const stamp = commits.get(commit);
      if (!stamp || stamp !== latestCommit || !sameRevision(stamp.to, revisionOf(current()))) throw Error('Only the latest acknowledged commit from this client has an action journal.');
      return new Promise<ActionJournal3D>((resolve, reject) => send('journal', {from: stamp.from, to: stamp.to},
        {base: stamp.to, changeFrom: stamp.from, capture: stamp.capture, operation: stamp.operation, externalQ: stamp.externalQ, resolve: value => resolve(value as ActionJournal3D), reject}));
    },
    journalPreview(ticket) {
      usable(); if (flight || cancellation || waiting) throw Error('Preview journals require an idle worker.');
      const r = tickets.get(ticket);
      if (!r || readyRecord !== r || r.reason || !r.candidate || !sameRevision(r.base, revisionOf(current()))) throw Error('Only the latest ready preview from this client has an action journal.');
      const candidate = r.candidate, target = r.wireSeq!;
      return new Promise<ActionJournal3D>((resolve, reject) => send('journal-preview', {base: r.base, target},
        {candidate, target, capture: r.capture, previewCurrent: () => !closing && !r.reason && readyRecord === r && r.candidate === candidate && sameRevision(r.base, revisionOf(current())),
          resolve: value => resolve(value as ActionJournal3D), reject}));
    },
    paths(commit) {
      usable(); if (flight || cancellation || waiting) throw Error('Path reports require an idle worker.');
      const stamp = commits.get(commit);
      if (!stamp || stamp !== latestCommit || !sameRevision(stamp.to, revisionOf(current()))) throw Error('Only the latest acknowledged commit from this client has a path report.');
      return new Promise<PathJournal3D>((resolve, reject) => send('paths', {from: stamp.from, to: stamp.to},
        {base: stamp.to, changeFrom: stamp.from, capture: stamp.capture, resolve: value => resolve(value as PathJournal3D), reject}));
    },
    motion(commit) {
      usable(); if (flight || cancellation || waiting) throw Error('Motion reports require an idle worker.');
      const stamp = commits.get(commit);
      if (!stamp || stamp !== latestCommit || !sameRevision(stamp.to, revisionOf(current()))) throw Error('Only the latest acknowledged commit from this client has a motion report.');
      return new Promise<MotionJournal3D>((resolve, reject) => send('motion', {from: stamp.from, to: stamp.to},
        {base: stamp.to, changeFrom: stamp.from, capture: stamp.capture, resolve: value => resolve(value as MotionJournal3D), reject}));
    },
    changes(commit, options = {}) {
      usable(); if (flight || cancellation || waiting) throw Error('Change reports require an idle worker.');
      const stamp = commits.get(commit), parsed = changeOptionsData(options);
      if (!stamp || stamp !== latestCommit || !sameRevision(stamp.to, revisionOf(current()))) throw Error('Only the latest acknowledged commit from this client has a report.');
      return new Promise<GameplayChangeReport3D>((resolve, reject) => send('changes', {from: stamp.from, to: stamp.to, options: parsed},
        {base: stamp.to, changeFrom: stamp.from, maxRuns: parsed.maxRuns, resolve: value => resolve(value as GameplayChangeReport3D), reject}));
    },
    query(value) {
      usable(); if (flight || cancellation || waiting) throw Error('Queries require an idle worker.');
      const queries = queryRequestsData(value, current()), base = revisionOf(current());
      return new Promise<TacticalWorkerQueryBatch3D>((resolve, reject) => send('query', {base, queries},
        {base, queries, resolve: value => resolve(value as TacticalWorkerQueryBatch3D), reject}));
    },
    queryPreview(ticket, value) {
      usable(); if (flight || cancellation || waiting) throw Error('Preview queries require an idle worker.');
      const r = tickets.get(ticket);
      if (!r || readyRecord !== r || r.reason || !r.candidate || !sameRevision(r.base, revisionOf(current()))) throw Error('Only the latest ready preview from this client can be queried.');
      const candidate = r.candidate, queries = queryRequestsData(value, candidate), target = r.wireSeq!;
      return new Promise<TacticalWorkerPreviewQueryBatch3D>((resolve, reject) => send('query-preview', {base: r.base, target, queries},
        {candidate, target, queries, previewCurrent: () => !closing && !r.reason && readyRecord === r && r.candidate === candidate && sameRevision(r.base, revisionOf(current())),
          resolve: value => resolve(value as TacticalWorkerPreviewQueryBatch3D), reject}));
    },
    request(command, horizonTicks, capture = {}) {
      usable(); if (flight && flight.kind !== 'preview') throw Error('Worker mutation is in flight.');
      checkedInteger(horizonTicks, 0, TACTICAL_PREVIEW_LIMITS_3D.horizonTicks, 'preview horizon');
      const parsed = captureData(capture), copied = copyTacticalValue(command), id = checkedInteger(requestSerial + 1, 1, Number.MAX_SAFE_INTEGER, 'preview identity');
      checkedInteger(current().terrain.tick + horizonTicks, 0, Number.MAX_SAFE_INTEGER, 'preview end tick');
      if (waiting) invalidate(waiting, 'superseded'); if (active) invalidate(active, 'superseded'); if (readyRecord) invalidate(readyRecord, 'superseded');
      let resolve!: Request<T, C>['resolve']; const result = new Promise<TacticalPreviewOutcome3D<T>>(done => {resolve = done;});
      const r: Request<T, C> = {id, command: copied, horizon: horizonTicks, capture: parsed, base: revisionOf(current()), settled: false, resolve};
      const ticket = Object.freeze<TacticalPreviewTicket3D<T>>({id, result, cancel() {
        if (fatal || closed || r.reason) return;
        const wasReady = readyRecord === r; invalidate(r, 'cancelled');
        if (wasReady && !cancellation) {active = r; r.cancelSent = true; send('cancel', {target: r.wireSeq});} pump();
      }});
      requestSerial = id; tickets.set(ticket, r); waiting = r; pump(); return ticket;
    },
    commit(ticket) {
      usable(); const r = tickets.get(ticket);
      if (flight || cancellation || waiting || !r || readyRecord !== r || r.reason || !sameRevision(r.base, revisionOf(current()))) throw Error('Only the latest idle ready preview can commit.');
      const operation = r.candidate!.preview.operation; readyRecord = undefined; r.candidate = undefined;
      return new Promise<TacticalWorkerCommit3D<T>>((resolve, reject) => send('commit', {target: r.wireSeq, base: r.base},
        {base: r.base, horizon: r.horizon, capture: r.capture, operation, resolve: value => resolve(value as TacticalWorkerCommit3D<T>), reject}));
    },
    restore(value) {
      usable(); if (flight || cancellation || waiting) throw Error('Restore requires an idle worker.');
      const saved = snapshotData<T>(value); compatibleSnapshot(current(), saved); if (readyRecord) invalidate(readyRecord, 'superseded');
      const base = revisionOf(current());
      return new Promise<TacticalSessionSnapshot3D<T>>((resolve, reject) => send('restore', {base, snapshot: saved},
        {base, saved, resolve: value => resolve(value as TacticalSessionSnapshot3D<T>), reject}));
    },
    close() {
      if (closePromise) return closePromise;
      closePromise = new Promise<void>((resolve, reject) => {resolveClose = resolve; rejectClose = reject;}); void closePromise.catch(() => {});
      if (fatal) {rejectClose!(Error(fatal)); return closePromise;}
      closing = true; if (waiting) invalidate(waiting, 'closed'); if (active) invalidate(active, 'closed'); if (readyRecord) invalidate(readyRecord, 'closed'); latestCommit = undefined;
      pump(); return closePromise;
    },
  });
  try {unsubscribe = transport.subscribe(receive, fail); if (fatal) unsubscribe(); else send('hello', null);} catch (error) {fail(error);}
  return client;
}

/** Takes ownership of this Worker; failures and close terminate it. No Worker is launched here. */
export function tacticalBrowserWorkerTransport3D(worker: Worker): TacticalTransport3D {
  return {send: value => worker.postMessage(value), close: () => worker.terminate(), subscribe(receive, failed) {
    const message = (event: MessageEvent) => receive(event.data), error = () => failed(Error('Worker transport failed.'));
    worker.addEventListener('message', message); worker.addEventListener('error', error); worker.addEventListener('messageerror', error);
    return () => {worker.removeEventListener('message', message); worker.removeEventListener('error', error); worker.removeEventListener('messageerror', error);};
  }};
}
