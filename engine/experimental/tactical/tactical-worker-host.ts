/** Worker-owned tactical authority. Callbacks stay in the worker module. */
import {
  createTacticalPreviewQueue3D,
  TACTICAL_PREVIEW_LIMITS_3D,
  type TacticalPreviewEditor3D,
  type TacticalPreviewTicket3D,
} from './tactical-previews.js';
import { copyPortableValue } from '../../portable-data.js';
import {
  queryRequestsData,
  executeQueryBatch,
  executePreviewQueryBatch,
} from './tactical-worker-queries.js';
import { changeOptionsData, portableChanges } from './tactical-worker-changes.js';
import { captureData } from './tactical-worker-motion.js';
import type { ChangeReportOptions3D } from '../gameplay/change-reports.js';
import { checkedInteger } from '../../validation.js';
import {
  channelName,
  envelope,
  fields,
  sameRevision,
  snapshotData,
  compatibleSnapshot,
  wire,
  workerError,
  type TacticalTransport3D,
} from './tactical-worker-wire.js';
import type {
  TacticalSession3D,
  TacticalValue,
  TacticalCommit3D,
} from './tactical-session-view.js';

export function createTacticalWorkerHost3D<T extends TacticalValue, C extends TacticalValue>(
  transport: TacticalTransport3D,
  session: TacticalSession3D<T>,
  prepare: (editor: TacticalPreviewEditor3D<T>, command: C) => void,
  channel: string,
): { close(): Promise<void> } {
  channelName(channel);
  let queue = createTacticalPreviewQueue3D(session, prepare),
    sequence = 0,
    connected = false,
    closed = false,
    mutating = false;
  let current: { seq: number; ticket: TacticalPreviewTicket3D<T>; complete: boolean } | undefined;
  let latestCommit: TacticalCommit3D<T> | undefined;
  let unsubscribe = () => {};
  let shutdown: Promise<void> | undefined;
  const reply = (seq: number, kind: string, payload: unknown) =>
    transport.send(wire(channel, seq, kind, payload));
  function close() {
    if (!shutdown) {
      closed = true;
      latestCommit = undefined;
      current = undefined;
      shutdown = Promise.resolve().then(async () => {
        const failures: unknown[] = [];
        try {
          unsubscribe();
        } catch (error) {
          failures.push(error);
        }
        try {
          await queue.close();
        } catch (error) {
          failures.push(error);
        }
        if (failures.length) throw new AggregateError(failures, 'Worker host cleanup failed.');
      });
      void shutdown.catch(() => {});
    }
    return shutdown;
  }
  function fatal(error: unknown, seq?: number) {
    if (seq !== undefined) {
      try {
        reply(seq, 'error', { message: workerError(error), fatal: true });
      } catch {
        /* transport already failed */
      }
    }
    void close().catch(() => {});
  }
  function receive(raw: unknown) {
    if (closed) return;
    let seq: number | undefined;
    try {
      const m = envelope(raw, channel);
      seq = m.seq;
      if (m.seq !== sequence + 1 || mutating) throw Error('Worker request ordering violation.');
      sequence = m.seq;
      if (m.kind === 'hello') {
        if (connected || m.payload !== null) throw Error('Worker already initialized.');
        connected = true;
        reply(seq, 'hello', session.snapshot());
        return;
      }
      if (!connected) throw Error('Worker handshake required.');
      if (m.kind === 'motion' || m.kind === 'paths' || m.kind === 'journal') {
        let report;
        try {
          fields(m.payload, ['from', 'to']);
          if (current && !current.complete) throw Error('Motion reports require an idle worker.');
          if (
            !latestCommit ||
            !sameRevision(m.payload.from, latestCommit.receipt.base) ||
            !sameRevision(m.payload.to, session.revision) ||
            latestCommit.receipt.revision !== session.revision.revision
          )
            throw Error('Stale or unavailable worker motion report.');
          report =
            m.kind === 'motion'
              ? latestCommit.motion()
              : m.kind === 'paths'
                ? latestCommit.paths()
                : latestCommit.journal();
        } catch (error) {
          reply(seq, 'error', { message: workerError(error), fatal: false });
          return;
        }
        reply(seq, m.kind, report);
        return;
      }
      if (m.kind === 'journal-preview') {
        let result;
        try {
          fields(m.payload, ['base', 'target']);
          if (
            !current ||
            !current.complete ||
            m.payload.target !== current.seq ||
            !sameRevision(m.payload.base, session.revision)
          )
            throw Error('Stale or unavailable preview journal target.');
          result = { target: current.seq, journal: queue.journal(current.ticket) };
        } catch (error) {
          reply(seq, 'error', { message: workerError(error), fatal: false });
          return;
        }
        reply(seq, 'journal-preview', result);
        return;
      }
      if (m.kind === 'changes') {
        let report;
        try {
          fields(m.payload, ['from', 'to', 'options']);
          if (current && !current.complete) throw Error('Change reports require an idle worker.');
          if (
            !latestCommit ||
            !sameRevision(m.payload.from, latestCommit.receipt.base) ||
            !sameRevision(m.payload.to, session.revision) ||
            latestCommit.receipt.revision !== session.revision.revision
          )
            throw Error('Stale or unavailable worker commit report.');
          report = portableChanges(
            latestCommit.changes(changeOptionsData(m.payload.options as ChangeReportOptions3D)),
          );
        } catch (error) {
          reply(seq, 'error', { message: workerError(error), fatal: false });
          return;
        }
        reply(seq, 'changes', report);
        return;
      }
      if (m.kind === 'query-preview') {
        let result;
        try {
          fields(m.payload, ['base', 'target', 'queries']);
          if (
            !current ||
            !current.complete ||
            m.payload.target !== current.seq ||
            !sameRevision(m.payload.base, session.revision)
          )
            throw Error('Stale or unavailable preview query target.');
          const ticket = current.ticket;
          result = executePreviewQueryBatch(
            current.seq,
            queryRequestsData(m.payload.queries, session.snapshot()),
            (id) => queue.queries(ticket, { domain: id }),
          );
        } catch (error) {
          reply(seq, 'error', { message: workerError(error), fatal: false });
          return;
        }
        reply(seq, 'query-preview', result);
        return;
      }
      if (m.kind === 'query') {
        let result;
        try {
          fields(m.payload, ['base', 'queries']);
          if (current && !current.complete) throw Error('Queries require an idle worker.');
          if (!sameRevision(m.payload.base, session.revision))
            throw Error('Stale query revision; recompute from the current committed state.');
          result = executeQueryBatch(
            session,
            queryRequestsData(m.payload.queries, session.snapshot()),
          );
        } catch (error) {
          reply(seq, 'error', { message: workerError(error), fatal: false });
          return;
        }
        reply(seq, 'query', result);
        return;
      }
      if (m.kind === 'preview') {
        fields(m.payload, ['base', 'command', 'horizonTicks', 'capture']);
        if (current && !current.complete) throw Error('A preview is already in flight.');
        const command = copyPortableValue(m.payload.command as C),
          capture = captureData(m.payload.capture);
        const horizon = checkedInteger(
          m.payload.horizonTicks as number,
          0,
          TACTICAL_PREVIEW_LIMITS_3D.horizonTicks,
          'preview horizon',
        );
        if (!sameRevision(m.payload.base, session.revision)) {
          reply(seq, 'preview', {
            id: seq,
            base: m.payload.base,
            horizonTicks: horizon,
            status: 'stale',
            error: null,
          });
          return;
        }
        const ticket = queue.request(command, horizon, capture),
          record = { seq, ticket, complete: false };
        current = record;
        void ticket.result
          .then((outcome) => {
            record.complete = true;
            if (closed) return;
            if (queue.state.closed) {
              fatal(Error(queue.state.error ?? 'Worker preview queue failed.'), record.seq);
              return;
            }
            try {
              reply(record.seq, 'preview', outcome);
            } catch (error) {
              fatal(error);
            }
          })
          .catch((error) => fatal(error, record.seq));
        return;
      }
      if (m.kind === 'cancel') {
        fields(m.payload, ['target']);
        if (!current || m.payload.target !== current.seq)
          throw Error('Unknown cancellation target.');
        const record = current;
        record.ticket.cancel();
        current = undefined;
        reply(seq, 'cancel', { target: record.seq });
        return;
      }
      if (m.kind === 'commit') {
        fields(m.payload, ['target', 'base']);
        if (
          !current ||
          !current.complete ||
          m.payload.target !== current.seq ||
          !sameRevision(m.payload.base, session.revision)
        )
          throw Error('Stale worker commit.');
        let result;
        try {
          result = queue.commit(current.ticket);
        } catch (error) {
          reply(seq, 'error', { message: workerError(error), fatal: false });
          return;
        }
        current = undefined;
        latestCommit = result;
        // A send failure after commit is uncertain, never an atomic rejection.
        reply(seq, 'commit', { snapshot: result.snapshot, receipt: result.receipt });
        return;
      }
      if (m.kind === 'restore') {
        fields(m.payload, ['base', 'snapshot']);
        if ((current && !current.complete) || !sameRevision(m.payload.base, session.revision))
          throw Error('Restore requires an idle current revision.');
        const snapshot = snapshotData<T>(m.payload.snapshot);
        compatibleSnapshot(session.snapshot(), snapshot);
        mutating = true;
        void (async () => {
          try {
            await queue.close();
            current = undefined;
            if (closed) return;
            const result = session.restore(snapshot);
            latestCommit = undefined;
            queue = createTacticalPreviewQueue3D(session, prepare);
            mutating = false;
            reply(m.seq, 'restore', result);
          } catch (error) {
            fatal(error, m.seq);
          }
        })();
        return;
      }
      if (m.kind === 'close') {
        if (m.payload !== null) throw Error('Invalid close request.');
        void close()
          .then(() => reply(m.seq, 'close', null))
          .catch((error) => fatal(error, m.seq));
        return;
      }
      throw Error('Unknown worker operation.');
    } catch (error) {
      fatal(error, seq);
    }
  }
  unsubscribe = transport.subscribe(receive, (error) => fatal(error));
  return Object.freeze({ close });
}
