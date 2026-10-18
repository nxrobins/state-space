/** Application coordination only. Physical advancement belongs to the SDK worker. */
import type { TacticalPreview3D, TacticalPreviewTicket3D, TacticalWorkerClient3D, TacticalWorkerQuery3D } from 'state-space-engine/experimental/3d/tactical-session';
import { MATERIALS_3D, INTEGRITY_3D, BONDS_3D, ANCHOR_3D } from 'state-space-engine/experimental/3d/structural-world';
import { createSlabSession, readSlabRequest, SLAB_LIMITS, type SlabGame, type SlabCommand, type SlabSnapshot, type inspectSlab } from './scenario.js';
import { prepareSlabScene } from './presentation.js';

export type SlabClient = Pick<TacticalWorkerClient3D<SlabGame, SlabCommand>, 'ready' | 'state' | 'snapshot' | 'query' | 'queryPreview' | 'request' | 'commit' | 'restore' | 'close'>;
type Snapshot = SlabSnapshot | TacticalPreview3D<SlabGame>;
type Observation = ReturnType<typeof inspectSlab>;
type Frame = {snapshot: Snapshot; observation: Observation; scene: ReturnType<typeof prepareSlabScene>};
type Outcome = 'ready' | 'superseded' | 'cancelled' | 'failed' | 'closed';
type Intent = {command: SlabCommand; horizon: number; phase?: 'preview' | 'inspect'; ticket?: TacticalPreviewTicket3D<SlabGame>; reason?: Outcome; resolve: (outcome: Outcome) => void};
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Tactical operation failed.';
export const SLAB_SAVE_BYTES = 262144;

/** Parse and validate before evicting any existing candidate or mutating the worker. */
export function parseSlabSave(text: string): SlabSnapshot {
  if (typeof text !== 'string' || text.length > SLAB_SAVE_BYTES || new TextEncoder().encode(text).length > SLAB_SAVE_BYTES) throw Error('Save exceeds the 256 KiB limit.');
  const snapshot = JSON.parse(text) as SlabSnapshot; createSlabSession(snapshot); return structuredClone(snapshot);
}
async function observe(client: SlabClient, snapshot: Snapshot, ticket?: TacticalPreviewTicket3D<SlabGame>): Promise<Frame> {
  const requests: TacticalWorkerQuery3D[] = [{kind: 'raycast', request: {fromQ: [512, 3584, 2560], toQ: [7680, 3584, 2560]}}];
  for (const unit of snapshot.game.units) {
    const box = {minQ: unit.body.minQ, maxQ: unit.body.minQ.map((v, i) => v + unit.body.sizeQ[i]) as [number, number, number]};
    requests.push({kind: 'support', request: {box, maxDropQ: 1024}}, {kind: 'exposure', request: {box}});
  }
  const batch = ticket ? await client.queryPreview(ticket, requests) : await client.query(requests), ray = batch.results[0];
  if (ray?.kind !== 'raycast' || batch.results.length !== 5) throw Error('Incomplete slab observation.');
  const units = snapshot.game.units.map((unit, i) => {
    const support = batch.results[1 + i * 2], exposure = batch.results[2 + i * 2];
    if (support?.kind !== 'support' || exposure?.kind !== 'exposure') throw Error('Incomplete unit observation.');
    return {id: unit.id, body: structuredClone(unit.body), support: support.value, exposure: exposure.value};
  });
  const observation: Observation = {stamp: ray.value.stamp, tick: snapshot.terrain.tick, ap: snapshot.game.ap, heatBudgetQ: snapshot.game.heatBudgetQ,
    firingLine: ray.value.contact ? 'blocked' : 'open', obstruction: ray.value.contact, units, wind: structuredClone(snapshot.game.wind), holds: structuredClone(snapshot.holds), energyAccounting: structuredClone(snapshot.accounting)};
  return {snapshot, observation, scene: prepareSlabScene(snapshot, observation)};
}

export async function createSlabUIModel(client: SlabClient, guard: () => Promise<void>) {
  let committed: SlabSnapshot, committedFrame: Frame;
  try {await guard(); await client.ready; committed = client.snapshot(); committedFrame = await observe(client, committed);}
  catch (e) {try {await client.close();} catch { /* Preserve startup failure. */ } throw e;}
  let candidate: (Frame & {ticket: TacticalPreviewTicket3D<SlabGame>}) | undefined;
  let active: Intent | undefined, waiting: Intent | undefined, running: Promise<void> | undefined;
  let closed = false, fatal = false, error: string | null = null, mutation: 'committing' | 'restoring' | null = null, mode: 'committed' | 'preview' = 'committed';
  let closing: Promise<void> | undefined;
  const health = () => {if (client.state.status === 'failed') {fatal = true; error = client.state.uncertain ? 'Worker connection lost during a mutation. Outcome is uncertain; do not retry automatically.' : client.state.error ?? 'Worker failed.';}};
  const usable = () => {health(); if (closed || fatal) throw Error(error ?? 'Slab UI is closed.');};
  const frame = () => mode === 'preview' && candidate ? candidate : committedFrame;
  const settleWaiting = (outcome: Outcome) => {const pending = waiting; waiting = undefined; pending?.resolve(outcome);};
  function pump() {
    if (active || !waiting || closed || fatal) return;
    const intent = waiting; waiting = undefined; active = intent;
    running = (async () => {
      let outcome: Outcome = 'failed';
      try {
        await guard(); if (intent.reason || closed) return;
        intent.phase = 'preview'; intent.ticket = client.request(intent.command, intent.horizon, {paths: {maxEntries: 4096}});
        const result = await intent.ticket.result; if (intent.reason || closed) return;
        if (result.status !== 'ready') {error = result.error ?? result.status; return;}
        intent.phase = 'inspect'; const presented = await observe(client, result.preview, intent.ticket); if (intent.reason || closed) return;
        candidate = {...presented, ticket: intent.ticket}; mode = 'preview'; error = null; outcome = 'ready';
      } catch (e) {if (!intent.reason && !closed) {error = errorText(e); health();}}
      finally {
        if (intent.reason || closed) intent.ticket?.cancel();
        intent.resolve(closed ? 'closed' : intent.reason ?? outcome); active = undefined; running = undefined;
        if (fatal) settleWaiting('failed'); pump();
      }
    })();
  }
  const discard = () => {
    usable(); if (mutation) throw Error('A mutation is in flight.');
    mode = 'committed'; candidate?.ticket.cancel(); candidate = undefined;
    if (waiting) {waiting.resolve('cancelled'); waiting = undefined;}
    if (active) {active.reason = 'cancelled'; if (active.phase === 'preview') active.ticket?.cancel();}
  };
  return Object.freeze({
    scene: () => frame().scene,
    view() {
      health(); const current = frame(), state = current.snapshot, preview = 'preview' in state ? state.preview : null;
      return structuredClone({status: closed ? 'closed' : fatal ? 'failed' : mutation ?? (active || waiting ? 'previewing' : candidate ? 'ready' : 'idle'),
        error, uncertain: client.state.uncertain, mode, committedRevision: committed.revision, displayedRevision: state.revision,
        displayedTick: state.terrain.tick, horizon: preview?.horizonTicks ?? null, baseTick: preview?.base.tick ?? null,
        canCommit: !closed && !fatal && !mutation && !active && !waiting && !!candidate && client.state.status === 'ready',
        canRestore: !closed && !fatal && !mutation && !active && !waiting && client.state.status === 'ready',
        observation: current.observation, committedAP: committed.game.ap, committedHeatBudgetQ: committed.game.heatBudgetQ,
        displayedAP: state.game.ap, displayedHeatBudgetQ: state.game.heatBudgetQ, displayedTurn: state.game.turn});
    },
    preview(raw: unknown, horizon: number = SLAB_LIMITS.horizon): Promise<Outcome> {
      usable(); if (mutation) throw Error('A mutation is in flight.'); const {command} = readSlabRequest(raw, horizon);
      if (waiting) waiting.resolve('superseded');
      if (active) {active.reason = 'superseded'; if (active.phase === 'preview') active.ticket?.cancel();}
      candidate?.ticket.cancel(); candidate = undefined; mode = 'committed'; error = null;
      const result = new Promise<Outcome>(resolve => {waiting = {command, horizon, resolve};}); pump(); return result;
    },
    discard,
    show(which: 'committed' | 'preview') {usable(); if (which !== 'committed' && which !== 'preview' || which === 'preview' && !candidate) throw Error('No ready candidate to display.'); mode = which;},
    async commit() {
      usable(); if (mutation || active || waiting || !candidate || client.state.status !== 'ready') throw Error('Only an idle ready candidate can commit.');
      const selected = candidate; mutation = 'committing'; error = null;
      let acknowledged = false;
      try {
        await guard(); usable();
        candidate = undefined; mode = 'committed'; const result = await client.commit(selected.ticket); committed = result.snapshot; acknowledged = true;
        committedFrame = await observe(client, committed); return result.receipt;
      } catch (e) {
        health(); error = acknowledged ? `Commit acknowledged at revision ${committed.revision}; inspection failed: ${errorText(e)}` : error ?? errorText(e);
        if (acknowledged) fatal = true; throw Error(error);
      } finally {mutation = null;}
    },
    async restore(text: string) {
      usable(); if (mutation || active || waiting || client.state.status !== 'ready') throw Error('Restore requires an idle worker.');
      const snapshot = parseSlabSave(text); mutation = 'restoring'; error = null; let acknowledged = false;
      try {
        await guard(); usable(); candidate = undefined; mode = 'committed'; committed = await client.restore(snapshot); acknowledged = true;
        committedFrame = await observe(client, committed);
      } catch (e) {
        health(); error = acknowledged ? `Restore acknowledged at revision ${committed.revision}; inspection failed: ${errorText(e)}` : error ?? errorText(e);
        if (acknowledged) fatal = true; throw Error(error);
      } finally {mutation = null;}
    },
    save: () => JSON.stringify(committed, null, 2),
    inspectCell(x: number, y: number, z: number) {
      if ([x, y, z].some(v => !Number.isSafeInteger(v) || v < 0 || v >= 8)) throw Error('Cell coordinates must be zero through seven.');
      const current = frame(), i = x + 8 * (y + 8 * z), s = current.snapshot.terrain, packed = s.packedCells[i], structure = s.structure[i];
      return {stamp: structuredClone(current.observation.stamp), x, y, z, material: MATERIALS_3D.find(m => m.id === (packed & 255))!.name,
        energyQ: s.energyQ[i], integrity: structure & INTEGRITY_3D, bonds: BONDS_3D.filter(b => structure & b).length, anchored: !!(structure & ANCHOR_3D)};
    },
    fail(reason: string) {
      fatal = true; error = reason;
      if (waiting) {waiting.resolve('failed'); waiting = undefined;}
      if (active) {active.reason = 'failed'; if (active.phase === 'preview') active.ticket?.cancel();}
    },
    close() {
      if (closing) return closing; closed = true;
      if (waiting) {waiting.resolve('closed'); waiting = undefined;}
      if (active) {active.reason = 'closed'; if (active.phase === 'preview') active.ticket?.cancel();}
      closing = (async () => {try {await client.close();} finally {await running;}})(); return closing;
    },
  });
}
export type SlabUIModel = Awaited<ReturnType<typeof createSlabUIModel>>;
