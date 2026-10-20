/** Actual physics acceptance; excluded from the edit/inert selector while held. */
import { describe, expect, test } from 'vitest';
import { CpuStructuralWorld3D } from '../structural-world-core.js';
import { MAT } from '../3d.js';
import { createTacticalSession3D, createTacticalPreviewQueue3D, type TacticalPreviewEditor3D, type TacticalPreviewQueue3D, type TacticalPreviewTicket3D } from '../tactical-session.js';
type Game = {ap: number; ticks: number};
function seed() {
  const w = new CpuStructuralWorld3D({width: 4, height: 4, depth: 4, chunkSize: 4});
  w.setCell(1, 1, 1, MAT.STONE, 160); w.setIntegrity(1, 1, 1, 73); w.setCell(1, 3, 1, MAT.WATER, 100);
  return {worldId: 'physical-preview', gameRulesVersion: 'preview-1', terrain: w.snapshot(), game: {ap: 2, ticks: 0}};
}
function prepare(editor: TacticalPreviewEditor3D<Game>, _command: null) {
  editor.translate({cells: [[1, 1, 1]], path: [[1, 0, 0]]});
  editor.setGame({...editor.inspect().game, ap: 1});
}
const policy = {reduceTick: ({game}: {game: Game}) => ({...game, ticks: game.ticks + 1})};
describe('held preview physical continuation', () => {
  test('queued batching equals direct advancement across the request boundary', async () => {
    const a = createTacticalSession3D(seed(), policy), b = createTacticalSession3D(seed(), policy), queue = createTacticalPreviewQueue3D(a, prepare);
    const ticket = queue.request(null, 33); expect((await ticket.result).status).toBe('ready');
    const direct = b.branch({horizonTicks: 33}); prepare(direct, null); await direct.advance(32); await direct.advance(1);
    expect(queue.commit(ticket).snapshot).toEqual(b.commit(direct).snapshot); await queue.close();
  });
  test('odd-tick restored worlds produce the same exact next preview and commit', async () => {
    const a = createTacticalSession3D(seed(), policy), initial = a.branch({horizonTicks: 17}); await initial.advance(17); const saved = a.commit(initial).snapshot;
    const b = createTacticalSession3D(seed(), policy); b.restore(saved);
    const qa = createTacticalPreviewQueue3D(a, () => {}), qb = createTacticalPreviewQueue3D(b, () => {});
    const left = qa.request(null, 3), right = qb.request(null, 3); await left.result; await right.result;
    expect(qa.commit(left).snapshot).toEqual(qb.commit(right).snapshot); await qa.close(); await qb.close();
  });
  test('superseding after a physical tick leaves no effects in the successor', async () => {
    let queue!: TacticalPreviewQueue3D<Game, null>, replacement: TacticalPreviewTicket3D<Game> | undefined;
    const a = createTacticalSession3D(seed(), {reduceTick: ({game}) => {
      if (!replacement) replacement = queue.request(null, 2); return {...game, ticks: game.ticks + 1};
    }});
    queue = createTacticalPreviewQueue3D(a, prepare); const old = queue.request(null, 4);
    expect((await old.result).status).toBe('superseded'); expect((await replacement!.result).status).toBe('ready');
    const b = createTacticalSession3D(seed(), policy), direct = b.branch({horizonTicks: 2}); prepare(direct, null); await direct.advance(2);
    expect(queue.commit(replacement!).snapshot).toEqual(b.commit(direct).snapshot); await queue.close();
  });
});
