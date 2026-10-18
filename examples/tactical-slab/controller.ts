/** Explicit application controller; the caller owns lifecycle and UI scheduling. */
import { createTacticalPreviewQueue3D, type TacticalSession3D, type TacticalPreviewTicket3D, type TacticalPreview3D } from 'state-space-engine/experimental/3d/tactical-session';
import { SLAB_LIMITS, createSlabSession, inspectSlab, prepareSlabCommand, readSlabRequest, type SlabCommand, type SlabGame, type SlabSnapshot } from './scenario.js';

export function createSlabController(session: TacticalSession3D<SlabGame> = createSlabSession()) {
  const queue = createTacticalPreviewQueue3D<SlabGame, SlabCommand>(session, prepareSlabCommand);
  const candidates = new WeakMap<TacticalPreviewTicket3D<SlabGame>, Promise<TacticalPreview3D<SlabGame> | null>>();
  let closed = false;
  const open = () => {if (closed) throw Error('Slab controller is closed.');};
  return Object.freeze({
    get state() {return queue.state;}, snapshot: () => session.snapshot(),
    inspect() {open(); return inspectSlab(session.snapshot(), session.queries());},
    request(raw: unknown, horizonTicks: number = SLAB_LIMITS.horizon) {
      open(); const {command} = readSlabRequest(raw, horizonTicks);
      const ticket = queue.request(command, horizonTicks, {paths: {maxEntries: 4096}});
      // Register before exposing the ticket: public result mutations cannot change
      // the candidate used by the controller's own display/query boundary.
      candidates.set(ticket, ticket.result.then(r => r.status === 'ready' ? structuredClone(r.preview) : null)); return ticket;
    },
    async inspectPreview(ticket: TacticalPreviewTicket3D<SlabGame>) {
      open(); const pending = candidates.get(ticket); if (!pending) throw Error('Unknown slab preview.');
      const candidate = await pending; open(); if (!candidate) throw Error('Slab preview is not ready.');
      return inspectSlab(candidate, queue.queries(ticket));
    },
    commit(ticket: TacticalPreviewTicket3D<SlabGame>) {open(); return queue.commit(ticket);},
    restore(snapshot: SlabSnapshot) {open(); if (queue.state.activeId !== null || queue.state.waitingId !== null) throw Error('Restore requires an idle slab controller.'); return session.restore(snapshot);},
    async close() {closed = true; await queue.close();},
  });
}
