/** Latest-request scheduling over exact, revision-bound tactical branches. */
import { copyPortableValue } from '../portable-data.js';
import { TACTICAL_SESSION_LIMITS_3D } from './tactical-session-core.js';
import { checkedInteger } from '../validation.js';
import { previewCaptureOptions3D, type TacticalPreviewCapture3D } from './tactical-preview-capture.js';
export type { TacticalPreviewCapture3D } from './tactical-preview-capture.js';
import type { TacticalBranch3D, TacticalCommit3D, TacticalPreview3D, TacticalRevision3D, TacticalSession3D, TacticalValue } from './tactical-session-view.js';

export const TACTICAL_PREVIEW_RULES_3D = 'tactical-previews-1';
export const TACTICAL_PREVIEW_LIMITS_3D = Object.freeze({active: 1, waiting: 1,
  horizonTicks: TACTICAL_SESSION_LIMITS_3D.horizonTicks, batchTicks: TACTICAL_SESSION_LIMITS_3D.requestTicks});
export type TacticalPreviewEditor3D<T extends TacticalValue> = Pick<TacticalBranch3D<T>,
  'inspect' | 'queries' | 'edit' | 'translate' | 'translateWithMotion' | 'transfer' | 'hold' | 'releaseHold' | 'addEnergy' | 'setGame' | 'updateGame' | 'discard'>;
type Terminal = 'superseded' | 'cancelled' | 'stale' | 'closed' | 'failed';
type Stamp = {id: number; base: Readonly<TacticalRevision3D>; horizonTicks: number};
export type TacticalPreviewOutcome3D<T extends TacticalValue> = Stamp & (
  {status: 'ready'; preview: TacticalPreview3D<T>} | {status: Terminal; error: string | null});
export interface TacticalPreviewTicket3D<T extends TacticalValue> {
  readonly id: number;
  readonly result: Promise<TacticalPreviewOutcome3D<T>>;
  cancel(): void;
}
export interface TacticalPreviewQueue3D<T extends TacticalValue, C extends TacticalValue> {
  readonly rulesVersion: typeof TACTICAL_PREVIEW_RULES_3D;
  readonly state: Readonly<{closed: boolean; activeId: number | null; waitingId: number | null; readyId: number | null; error: string | null}>;
  request(command: C, horizonTicks: number, capture?: TacticalPreviewCapture3D): TacticalPreviewTicket3D<T>;
  /** Lazy isolated observations from this queue's latest ready, current preview. */
  queries(ticket: TacticalPreviewTicket3D<T>, options?: Parameters<TacticalBranch3D<T>['queries']>[0]): ReturnType<TacticalBranch3D<T>['queries']>;
  motion(ticket: TacticalPreviewTicket3D<T>): ReturnType<TacticalBranch3D<T>['motion']>;
  paths(ticket: TacticalPreviewTicket3D<T>): ReturnType<TacticalBranch3D<T>['paths']>;
  journal(ticket: TacticalPreviewTicket3D<T>): ReturnType<TacticalBranch3D<T>['journal']>;
  commit(ticket: TacticalPreviewTicket3D<T>): TacticalCommit3D<T>;
  /** Waits for cooperative cancellation and cleanup; cannot interrupt a native hang. */
  close(): Promise<void>;
}
type Request<T extends TacticalValue, C extends TacticalValue> = Stamp & {
  capture: ReturnType<typeof previewCaptureOptions3D>;
  command: C | undefined; branch?: TacticalBranch3D<T>; controller: AbortController;
  reason?: Terminal; settled: boolean; settle: (value: TacticalPreviewOutcome3D<T>) => void;
};
function sameRevision(a: Readonly<TacticalRevision3D>, b: Readonly<TacticalRevision3D>) {
  const keys = Object.keys(a) as (keyof TacticalRevision3D)[];
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Preview preparation or advancement failed.';

export function createTacticalPreviewQueue3D<T extends TacticalValue, C extends TacticalValue>(
  session: TacticalSession3D<T>, prepare: (editor: TacticalPreviewEditor3D<T>, command: C) => void,
): TacticalPreviewQueue3D<T, C> {
  if (typeof prepare !== 'function') throw Error('A synchronous preview preparation callback is required.');
  let serial = 0, closed = false, editing = false, fatal: string | null = null;
  let active: Request<T, C> | undefined, waiting: Request<T, C> | undefined, ready: Request<T, C> | undefined;
  let drain: Promise<void> | undefined;
  const tickets = new WeakMap<TacticalPreviewTicket3D<T>, Request<T, C>>();
  const unlocked = () => {if (editing) throw Error('Preview queue cannot be reentered during preparation.');};
  const fresh = (r: Request<T, C>) => sameRevision(r.base, session.revision);
  const stamp = (r: Request<T, C>): Stamp => ({id: r.id, base: r.base, horizonTicks: r.horizonTicks});
  function settle(r: Request<T, C>, status: Terminal, error: string | null = null) {
    r.command = undefined;
    if (!r.settled) {r.settled = true; r.settle({...stamp(r), status, error});}
  }
  function discard(r: Request<T, C>) {
    if (r.branch && r.branch.status !== 'committed') r.branch.discard();
    r.branch = undefined;
  }
  function invalidate(r: Request<T, C> | undefined, reason: Terminal) {
    if (!r) return;
    r.reason ??= reason; r.controller.abort();
    if (r === active) return; // Its advance call owns cleanup until it settles.
    discard(r); settle(r, r.reason);
    if (waiting === r) waiting = undefined;
    if (ready === r) ready = undefined;
  }
  function failClosed(error: unknown) {
    fatal = message(error); closed = true;
    if (waiting) {waiting.reason = 'failed'; settle(waiting, 'failed', fatal); waiting = undefined;}
  }
  function checkpoint(r: Request<T, C>) {
    if (!r.reason && !fresh(r)) r.reason = 'stale';
    if (r.reason || closed) throw Error('Preview is no longer current.');
  }
  function editor(r: Request<T, C>, branch: TacticalBranch3D<T>): TacticalPreviewEditor3D<T> {
    let valid = true;
    const check = () => {if (!valid || !editing || active !== r) throw Error('Preview staging editor has expired.'); checkpoint(r);};
    const view = Object.freeze<TacticalPreviewEditor3D<T>>({
      inspect: () => {check(); return branch.inspect();}, queries: options => {check(); return branch.queries(options);},
      edit: edits => {check(); branch.edit(edits);}, translate: request => {check(); return branch.translate(request);},
      translateWithMotion: (request, options) => {check(); return branch.translateWithMotion(request, options);},
      transfer: request => {check(); return branch.transfer(request);}, hold: request => {check(); branch.hold(request);},
      releaseHold: id => {check(); branch.releaseHold(id);}, addEnergy: deltas => {check(); return branch.addEnergy(deltas);},
      setGame: game => {check(); branch.setGame(game);},
      updateGame: reducer => {check(); branch.updateGame(reducer);},
      discard: () => {check(); branch.discard();},
    });
    editing = true;
    try {
      const returned = prepare(view, r.command!);
      if (returned !== undefined) {
        // Observe a rejected async return, but never permit it to keep staging.
        void Promise.resolve(returned).catch(() => {});
        throw Error('Preview preparation must return undefined synchronously.');
      }
    } finally {valid = false; editing = false; r.command = undefined;}
    return view;
  }
  async function execute(r: Request<T, C>) {
    try {
      checkpoint(r);
      const branch = session.branch({horizonTicks: r.horizonTicks, ...r.capture}); r.branch = branch;
      if (!sameRevision(r.base, branch.base)) {r.reason = 'stale'; checkpoint(r);}
      editor(r, branch); checkpoint(r);
      let remaining = r.horizonTicks;
      // Even zero-horizon requests use the same branch completion boundary.
      do {
        const ticks = Math.min(remaining, TACTICAL_PREVIEW_LIMITS_3D.batchTicks);
        await branch.advance(ticks, {signal: r.controller.signal}); checkpoint(r); remaining -= ticks;
      } while (remaining > 0);
      const preview = branch.inspect(); checkpoint(r);
      active = undefined; ready = r; r.settled = true; r.settle({...stamp(r), status: 'ready', preview});
    } catch (error) {
      let failure = error;
      try {discard(r);} catch (cleanup) {failure = new AggregateError([error, cleanup], 'Preview cleanup failed.');}
      if (failure instanceof AggregateError) {failClosed(failure); r.reason = 'failed';}
      if (!r.reason && !fresh(r)) r.reason = 'stale';
      settle(r, r.reason ?? 'failed', r.reason && r.reason !== 'failed' ? null : message(failure));
    }
  }
  function schedule() {
    if (drain) return;
    drain = Promise.resolve().then(async () => {
      while (waiting && !closed) {
        const next = waiting; waiting = undefined; active = next;
        await execute(next); active = undefined;
      }
    }).catch(error => {failClosed(error); if (active) settle(active, 'failed', fatal); active = undefined;})
      .finally(() => {drain = undefined; if (waiting && !closed) schedule();});
  }
  function readyBranch(ticket: TacticalPreviewTicket3D<T>) {
    unlocked(); const record = tickets.get(ticket);
    if (closed || !record || ready !== record || record.reason || !record.branch) throw Error('Only this queue\'s latest ready preview can be read or committed.');
    if (!fresh(record)) {invalidate(record, 'stale'); throw Error('Preview revision changed; recompute before reading or committing.');}
    return {record, branch: record.branch};
  }
  return Object.freeze<TacticalPreviewQueue3D<T, C>>({rulesVersion: TACTICAL_PREVIEW_RULES_3D,
    get state() {return Object.freeze({closed, activeId: active?.id ?? null, waitingId: waiting?.id ?? null,
      readyId: ready && fresh(ready) ? ready.id : null, error: fatal});},
    request(command, horizonTicks, capture = {}) {
      unlocked(); if (closed) throw Error('Preview queue is closed.');
      checkedInteger(horizonTicks, 0, TACTICAL_PREVIEW_LIMITS_3D.horizonTicks, 'preview horizon');
      const parsedCapture = previewCaptureOptions3D(capture), copied = copyPortableValue(command), id = checkedInteger(serial + 1, 1, Number.MAX_SAFE_INTEGER, 'preview identity');
      const base = Object.freeze({...session.revision});
      checkedInteger(base.tick + horizonTicks, 0, Number.MAX_SAFE_INTEGER, 'preview end tick');
      invalidate(waiting, 'superseded'); invalidate(active, 'superseded'); invalidate(ready, 'superseded');
      let resolve!: Request<T, C>['settle'];
      const result = new Promise<TacticalPreviewOutcome3D<T>>(done => {resolve = done;});
      const record: Request<T, C> = {id, base, horizonTicks, capture: parsedCapture, command: copied, controller: new AbortController(), settled: false, settle: resolve};
      const ticket = Object.freeze<TacticalPreviewTicket3D<T>>({id, result, cancel() {unlocked(); invalidate(record, 'cancelled');}});
      serial = id; tickets.set(ticket, record); waiting = record; schedule(); return ticket;
    },
    queries: (ticket, options) => readyBranch(ticket).branch.queries(options),
    motion: ticket => readyBranch(ticket).branch.motion(),
    paths: ticket => readyBranch(ticket).branch.paths(),
    journal: ticket => readyBranch(ticket).branch.journal(),
    commit(ticket) {
      const {record, branch} = readyBranch(ticket);
      try {return session.commit(branch);} finally {ready = undefined; discard(record);}
    },
    close() {
      unlocked(); closed = true;
      invalidate(waiting, 'closed'); invalidate(active, 'closed'); invalidate(ready, 'closed');
      return (drain ?? Promise.resolve()).then(() => {if (fatal) throw Error(fatal);});
    },
  });
}
