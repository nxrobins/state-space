import { holdPhysics, STRUCTURAL_CALLS } from '../test-support/hold-physics.js';
import { describe, expect, test, vi } from 'vitest';
import { CpuStructuralWorld3D, type StructuralSnapshot3D } from './structural-world-core.js';
import { MAT } from './3d.js';
import { createTacticalSessionCore3D, type TacticalSimulationFactory3D } from './tactical-session-core.js';
import { createTacticalSession3D } from './tactical-session.js';
import { createTacticalPreviewQueue3D, TACTICAL_PREVIEW_LIMITS_3D, type TacticalPreviewEditor3D, type TacticalPreviewTicket3D, type TacticalPreviewQueue3D } from './tactical-previews.js';

holdPhysics(...STRUCTURAL_CALLS);
type Game = {ap: number; label: string; ticks: number; data: number[]};
type Command = {label: string; data: number[]};
const command = (label: string): Command => ({label, data: [7]});
function initial() {
  const world = new CpuStructuralWorld3D({width: 4, height: 4, depth: 4, chunkSize: 4});
  world.setCell(1, 1, 1, MAT.STONE, 160); world.setIntegrity(1, 1, 1, 73);
  return {worldId: 'preview-world', gameRulesVersion: 'preview-game-1', terrain: world.snapshot(), game: {ap: 2, label: '', ticks: 0, data: [0]}};
}
function stage(editor: TacticalPreviewEditor3D<Game>, value: Command) {
  editor.translate({cells: [[1, 1, 1]], path: [[1, 0, 0]]});
  editor.setGame({...editor.inspect().game, ap: 1, label: value.label, data: value.data});
}
function deferred() {
  let resolve!: () => void;
  return {promise: new Promise<void>(done => {resolve = done;}), resolve: () => resolve()};
}
function fixture(overrides: {step?: (state: StructuralSnapshot3D) => Promise<void> | void; close?: () => Promise<void> | void} = {}) {
  const made = vi.fn(), stepped = vi.fn(), closed = vi.fn();
  const factory: TacticalSimulationFactory3D = snapshot => {
    made(); let state = structuredClone(snapshot);
    return {load(value) {state = structuredClone(value);}, async step() {stepped(); await overrides.step?.(state); state.tick++;},
      snapshot: () => state, async close() {closed(); await overrides.close?.();}};
  };
  const session = createTacticalSessionCore3D(initial(), factory, {reduceTick: ({game}) => ({...game, ticks: game.ticks + 1})}, async () => {});
  return {session, made, stepped, closed};
}

describe('supersedable previews with inert drivers', () => {
  test('public zero-horizon preview commits terrain damage heat and AP atomically', async () => {
    const session = createTacticalSession3D(initial()), original = session.snapshot(), queue = createTacticalPreviewQueue3D(session, stage);
    const ticket = queue.request(command('wall'), 0), result = await ticket.result;
    expect(result.status).toBe('ready'); expect(session.snapshot()).toEqual(original);
    const committed = queue.commit(ticket);
    expect(committed.snapshot.game).toEqual({ap: 1, label: 'wall', ticks: 0, data: [7]});
    expect(committed.snapshot.terrain.energyQ[22]).toBe(original.terrain.energyQ[21]);
    expect(committed.snapshot.terrain.structure[22]).toBe(73); expect(committed.snapshot.accounting).toEqual(original.accounting);
    expect(() => queue.commit(ticket)).toThrow(/latest ready/); await queue.close();
  });
  test('a burst before execution keeps only the newest waiting command', async () => {
    const f = fixture(), prepare = vi.fn(stage), queue = createTacticalPreviewQueue3D(f.session, prepare);
    const first = queue.request(command('first'), 1), second = queue.request(command('second'), 1), last = queue.request(command('last'), 1);
    expect(queue.state).toMatchObject({activeId: null, waitingId: last.id, readyId: null});
    expect((await first.result).status).toBe('superseded'); expect((await second.result).status).toBe('superseded');
    expect((await last.result).status).toBe('ready'); expect(prepare).toHaveBeenCalledTimes(1); expect(f.stepped).toHaveBeenCalledTimes(1);
    await queue.close();
  });
  test('superseding active work waits for its complete boundary and cleanup', async () => {
    const entered = deferred(), step = deferred(), closeEntered = deferred(), cleanup = deferred(); let first = true;
    const f = fixture({step: async () => {if (first) {entered.resolve(); await step.promise;}}, close: async () => {if (first) {closeEntered.resolve(); await cleanup.promise; first = false;}}});
    const queue = createTacticalPreviewQueue3D(f.session, stage), original = f.session.snapshot();
    const old = queue.request(command('old'), 3); await entered.promise;
    const middle = queue.request(command('middle'), 1), last = queue.request(command('last'), 2);
    expect((await middle.result).status).toBe('superseded'); expect(f.made).toHaveBeenCalledTimes(1);
    let oldSettled = false; void old.result.then(() => {oldSettled = true;});
    step.resolve(); await closeEntered.promise; expect(oldSettled).toBe(false); expect(f.made).toHaveBeenCalledTimes(1);
    cleanup.resolve(); expect((await old.result).status).toBe('superseded'); expect((await last.result).status).toBe('ready');
    expect(f.made).toHaveBeenCalledTimes(2); expect(f.stepped).toHaveBeenCalledTimes(3); expect(f.session.snapshot()).toEqual(original);
    expect(queue.commit(last).snapshot.game).toMatchObject({label: 'last', ticks: 2}); await queue.close();
  });
  test('waiting commands own nested input and retain their submission revision', async () => {
    const f = fixture(), queue = createTacticalPreviewQueue3D(f.session, stage), input = command('original'), base = f.session.revision;
    const ticket = queue.request(input, 0); input.label = 'mutated'; input.data[0] = 99;
    const outcome = await ticket.result; expect(outcome.base).toEqual(base); expect(outcome.horizonTicks).toBe(0);
    expect(queue.commit(ticket).snapshot.game).toMatchObject({label: 'original', data: [7]}); await queue.close();
  });
  test('invalid commands do not supersede accepted work or invoke getters', async () => {
    const f = fixture(), queue = createTacticalPreviewQueue3D(f.session, stage), ticket = queue.request(command('valid'), 0);
    const getter = vi.fn(); const invalid = Object.defineProperty({}, 'label', {get: getter, enumerable: true}) as Command;
    expect(() => queue.request(invalid, 0)).toThrow(); expect(getter).not.toHaveBeenCalled();
    const cycle: unknown[] = []; cycle.push(cycle); expect(() => queue.request(cycle as unknown as Command, 0)).toThrow();
    expect((await ticket.result).status).toBe('ready'); expect(queue.commit(ticket).snapshot.game.label).toBe('valid'); await queue.close();
  });
  test('invalid horizons preserve the waiting request and its identity sequence', async () => {
    const f = fixture(), queue = createTacticalPreviewQueue3D(f.session, stage), ticket = queue.request(command('valid'), 0);
    for (const n of [-1, 0.5, NaN, Infinity, TACTICAL_PREVIEW_LIMITS_3D.horizonTicks + 1]) expect(() => queue.request(command('bad'), n)).toThrow();
    expect((await ticket.result).status).toBe('ready'); const next = queue.request(command('next'), 0); expect(next.id).toBe(ticket.id + 1);
    await next.result; await queue.close();
  });
  test('cancelled waiting work never creates a branch or driver', async () => {
    const f = fixture(), prepare = vi.fn(stage), queue = createTacticalPreviewQueue3D(f.session, prepare), ticket = queue.request(command('cancel'), 2);
    ticket.cancel(); ticket.cancel(); expect((await ticket.result).status).toBe('cancelled'); await queue.close();
    expect(prepare).not.toHaveBeenCalled(); expect(f.made).not.toHaveBeenCalled();
  });
  test('active cancellation cannot publish a partial horizon or partial game state', async () => {
    const entered = deferred(), gate = deferred(), f = fixture({step: async () => {entered.resolve(); await gate.promise;}});
    const original = f.session.snapshot(), queue = createTacticalPreviewQueue3D(f.session, stage), ticket = queue.request(command('cancel'), 3);
    await entered.promise; ticket.cancel(); gate.resolve(); expect((await ticket.result).status).toBe('cancelled');
    expect(f.closed).toHaveBeenCalledTimes(1); expect(f.session.snapshot()).toEqual(original); expect(() => queue.commit(ticket)).toThrow(); await queue.close();
  });
  test('close waits for active cleanup and rejects new work', async () => {
    const entered = deferred(), step = deferred(), cleanup = deferred(), closing = deferred();
    const f = fixture({step: async () => {entered.resolve(); await step.promise;}, close: async () => {closing.resolve(); await cleanup.promise;}});
    const queue = createTacticalPreviewQueue3D(f.session, stage), active = queue.request(command('active'), 2); await entered.promise;
    const pending = queue.request(command('pending'), 1); let done = false; const end = queue.close().then(() => {done = true;});
    expect((await pending.result).status).toBe('closed'); expect(() => queue.request(command('new'), 0)).toThrow(/closed/);
    step.resolve(); await closing.promise; expect(done).toBe(false); cleanup.resolve(); await end;
    expect((await active.result).status).toBe('superseded'); expect(f.made).toHaveBeenCalledTimes(1); await queue.close();
  });
  test('ready results remain historical after close and cannot commit', async () => {
    const f = fixture(), queue = createTacticalPreviewQueue3D(f.session, stage), ticket = queue.request(command('ready'), 0);
    const result = await ticket.result; await queue.close(); expect(result.status).toBe('ready'); expect(queue.state.readyId).toBeNull();
    expect(() => queue.commit(ticket)).toThrow(/latest ready/);
  });
  test('a changed world makes waiting work stale without running preparation', async () => {
    const f = fixture(), prepare = vi.fn(stage), queue = createTacticalPreviewQueue3D(f.session, prepare), ticket = queue.request(command('old'), 1);
    f.session.restore(f.session.snapshot()); expect((await ticket.result).status).toBe('stale');
    expect(prepare).not.toHaveBeenCalled(); expect(f.made).not.toHaveBeenCalled(); await queue.close();
  });
  test('external revision change during advancement discards the result', async () => {
    const entered = deferred(), gate = deferred(), f = fixture({step: async () => {entered.resolve(); await gate.promise;}});
    const queue = createTacticalPreviewQueue3D(f.session, stage), ticket = queue.request(command('old'), 2); await entered.promise;
    const restored = f.session.restore(f.session.snapshot()); gate.resolve(); expect((await ticket.result).status).toBe('stale');
    expect(f.session.snapshot()).toEqual(restored); expect(f.closed).toHaveBeenCalledTimes(1); await queue.close();
  });
  test('ready previews require recomputation after any committed revision change', async () => {
    const f = fixture(), queue = createTacticalPreviewQueue3D(f.session, stage), ticket = queue.request(command('old'), 0); await ticket.result;
    f.session.restore(f.session.snapshot()); expect(queue.state.readyId).toBeNull(); expect(() => queue.commit(ticket)).toThrow(/recompute/);
    const next = queue.request(command('fresh'), 0); await next.result; expect(queue.commit(next).snapshot.game.label).toBe('fresh'); await queue.close();
  });
  test('foreign or copied tickets cannot authorize a commit', async () => {
    const f = fixture(), queue = createTacticalPreviewQueue3D(f.session, stage), other = createTacticalPreviewQueue3D(f.session, stage);
    const ticket = queue.request(command('owned'), 0); await ticket.result;
    expect(() => other.commit(ticket)).toThrow(); expect(() => queue.commit({...ticket})).toThrow(); queue.commit(ticket); await queue.close(); await other.close();
  });
  test('preview mutations cannot change the private commit candidate', async () => {
    const f = fixture(), queue = createTacticalPreviewQueue3D(f.session, stage), ticket = queue.request(command('copy'), 0), result = await ticket.result;
    if (result.status !== 'ready') throw Error('Expected ready'); result.preview.game.ap = -100; result.preview.terrain.energyQ.fill(0); result.preview.game.data[0] = -1;
    const committed = queue.commit(ticket).snapshot; expect(committed.game.ap).toBe(1); expect(committed.game.data).toEqual([7]); expect(committed.terrain.energyQ[22]).toBeGreaterThan(0); await queue.close();
  });
  test('a horizon crossing the batch boundary runs every inert tick exactly once', async () => {
    const f = fixture(), queue = createTacticalPreviewQueue3D(f.session, stage), ticket = queue.request(command('long'), 33);
    const outcome = await ticket.result; expect(outcome).toMatchObject({status: 'ready', horizonTicks: 33});
    expect(f.stepped).toHaveBeenCalledTimes(33); expect(f.made).toHaveBeenCalledTimes(2); expect(f.closed).toHaveBeenCalledTimes(2);
    const s = queue.commit(ticket).snapshot; expect(s.terrain.tick).toBe(33); expect(s.game.ticks).toBe(33); await queue.close();
  });
  test('the maximum horizon fits the existing operation and request limits', async () => {
    const f = fixture(), queue = createTacticalPreviewQueue3D(f.session, stage), ticket = queue.request(command('max'), 1024);
    expect((await ticket.result).status).toBe('ready'); expect(f.stepped).toHaveBeenCalledTimes(1024); expect(f.made).toHaveBeenCalledTimes(32); await queue.close();
  });
  test('preparation failure rolls back its edits and permits a later valid request', async () => {
    const f = fixture(), before = f.session.snapshot(), queue = createTacticalPreviewQueue3D(f.session, (editor, c: Command) => {stage(editor, c); if (c.label === 'bad') throw Error('game rejection');});
    const bad = queue.request(command('bad'), 0); expect(await bad.result).toMatchObject({status: 'failed', error: 'game rejection'}); expect(f.session.snapshot()).toEqual(before);
    const good = queue.request(command('good'), 0); await good.result; queue.commit(good); await queue.close();
  });
  test('retained staging editors expire after preparation', async () => {
    const f = fixture(); let retained!: TacticalPreviewEditor3D<Game>;
    const queue = createTacticalPreviewQueue3D(f.session, (editor, c: Command) => {retained = editor; stage(editor, c);}), ticket = queue.request(command('ready'), 0);
    await ticket.result; expect(Object.isFrozen(retained)).toBe(true); expect('advance' in retained).toBe(false); expect('discard' in retained).toBe(true);
    expect(() => retained.setGame(initial().game)).toThrow(/expired/); expect(() => retained.inspect()).toThrow(/expired/); expect(() => retained.discard()).toThrow(/expired/); await queue.close();
  });
  test('async preparation is rejected and its rejected promise is observed', async () => {
    const f = fixture(); let retained!: TacticalPreviewEditor3D<Game>;
    const queue = createTacticalPreviewQueue3D(f.session, async editor => {retained = editor; throw Error('late failure');});
    const result = await queue.request(command('async'), 0).result; expect(result).toMatchObject({status: 'failed', error: 'Preview preparation must return undefined synchronously.'});
    expect(() => retained.inspect()).toThrow(/expired/); expect(f.made).not.toHaveBeenCalled(); await queue.close();
  });
  test('queue mutation cannot reenter a staging callback', async () => {
    const f = fixture(); let ticket!: TacticalPreviewTicket3D<Game>, queue!: TacticalPreviewQueue3D<Game, Command>;
    queue = createTacticalPreviewQueue3D(f.session, (editor, c: Command) => {
      expect(() => queue.request(c, 0)).toThrow(/reentered/); expect(() => queue.close()).toThrow(/reentered/);
      expect(() => ticket.cancel()).toThrow(/reentered/); expect(() => queue.commit(ticket)).toThrow(/reentered/); stage(editor, c);
    });
    ticket = queue.request(command('ok'), 0); expect((await ticket.result).status).toBe('ready'); await queue.close();
  });
  test('cleanup failure closes the queue and prevents the waiting preview from starting', async () => {
    const entered = deferred(), gate = deferred(), f = fixture({step: async () => {entered.resolve(); await gate.promise;}, close: () => {throw Error('driver cleanup');}});
    const queue = createTacticalPreviewQueue3D(f.session, stage), first = queue.request(command('first'), 1); await entered.promise;
    const second = queue.request(command('second'), 1); gate.resolve(); expect((await first.result).status).toBe('failed'); expect((await second.result).status).toBe('failed');
    expect(queue.state).toMatchObject({closed: true, waitingId: null}); expect(f.made).toHaveBeenCalledTimes(1); await expect(queue.close()).rejects.toThrow(/cleanup/);
  });
  test('a replacement requested immediately after ready does not leak branch slots', async () => {
    const f = fixture(), queue = createTacticalPreviewQueue3D(f.session, stage);
    for (let i = 0; i < 12; i++) {const ticket = queue.request(command(String(i)), 0); expect((await ticket.result).status).toBe('ready');}
    await queue.close(); const branches = Array.from({length: 4}, () => f.session.branch({horizonTicks: 0})); branches.forEach(b => b.discard());
  });
});
