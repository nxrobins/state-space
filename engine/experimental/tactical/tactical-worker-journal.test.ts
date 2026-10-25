import { createMicrotaskTransport } from '../../test-support/microtask-transport.js';
import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MAT } from '../3d.js';

import {
  CpuStructuralWorld3D,
  type StructuralSnapshot3D,
} from '../structural/structural-world-core.js';
import {
  createTacticalSessionCore3D,
  type TacticalSimulationFactory3D,
} from './tactical-session-core.js';
import { createTacticalWorkerHost3D } from './tactical-worker-host.js';
import {
  createTacticalWorkerClient3D,
  type TacticalWorkerCommit3D,
} from './tactical-worker-client.js';
import { MOTION_TRACE_RULES_3D, type MaterialMotionTrace3D } from '../motion-trace.js';
import { actionJournalData } from './tactical-worker-journal.js';
import { actionReceiptData } from './tactical-worker-action.js';
import type { ActionJournal3D } from '../gameplay/action-journal.js';
import type { TacticalPreviewCapture3D } from './tactical-preview-capture.js';
import type { TacticalPreviewTicket3D } from './tactical-previews.js';
import type { TacticalBranch3D, TacticalCommit3D } from './tactical-session-view.js';
import type { Wire } from './tactical-worker-wire.js';

holdPhysics('solveStructure3D', ...STRUCTURAL_CALLS);
afterEach(() => vi.useRealTimers());
type Game = { ap: number };
type Command = { kind: string };
function emptyMotion(s: StructuralSnapshot3D): MaterialMotionTrace3D {
  return {
    rulesVersion: MOTION_TRACE_RULES_3D,
    physicsRulesVersion: s.rulesVersion,
    materialCatalogHash: s.materialCatalogHash,
    width: s.width,
    height: s.height,
    depth: s.depth,
    fromTick: s.tick - 1,
    toTick: s.tick,
    status: 'complete',
    requiresReexecution: false,
    movedCells: 0,
    touchedCells: 0,
    fragmentCount: 0,
    fragmentCells: 0,
    moves: [],
    touched: [],
    fragments: [],
  };
}
function fixture(timeoutMs = 10000) {
  const world = new CpuStructuralWorld3D({ width: 4, height: 4, depth: 4, chunkSize: 4 });
  world.setCell(1, 1, 1, MAT.STONE, 120);
  world.setIntegrity(1, 1, 1, 73);
  const flask = new CpuStructuralWorld3D({ width: 4, height: 4, depth: 4, chunkSize: 4 });
  const terrain = world.snapshot();
  terrain.tick = 3;
  const reservoir = flask.snapshot();
  reservoir.tick = 3;
  let steps = 0,
    drivers = 0,
    disposed = 0;
  const factory: TacticalSimulationFactory3D = (initial) => {
    let s = structuredClone(initial);
    drivers++;
    return {
      load(value) {
        s = structuredClone(value);
      },
      step() {
        s.tick++;
        steps++;
      },
      snapshot: () => s,
      motion: () => emptyMotion(s),
      close() {
        disposed++;
      },
    };
  };
  const observer = vi.fn((s: StructuralSnapshot3D) => {
    const n = s.packedCells.length;
    const result = {
      distances: new Int32Array(n).fill(-1),
      loads: new Uint32Array(n),
      capacities: new Uint32Array(n),
      reactions: new Uint32Array(n),
    };
    result.capacities[63] = s.structure[21] & 255;
    return result;
  });
  const session = createTacticalSessionCore3D(
    {
      worldId: 'journal-world',
      gameRulesVersion: 'journal-game',
      terrain,
      game: { ap: 2 },
      reservoirs: [{ id: 'flask', terrain: reservoir }],
    },
    factory,
    {},
    async () => {},
    observer,
  );
  let branch: TacticalBranch3D<Game> | undefined, latest: TacticalCommit3D<Game> | undefined;
  const { ports, sent, closed, setRewrite: intercept, deliver } = createMicrotaskTransport<Wire>();
  const host = createTacticalWorkerHost3D(
    ports[1],
    {
      ...session,
      get revision() {
        return session.revision;
      },
      branch(options) {
        branch = session.branch(options);
        return branch;
      },
      commit(b) {
        latest = session.commit(b);
        return latest;
      },
    },
    (editor, command: Command) => {
      if (command.kind === 'mixed') {
        editor.edit([{ kind: 'integrity', x: 1, y: 1, z: 1, integrity: 70 }]);
        editor.translate({ cells: [[1, 1, 1]], path: [[1, 0, 0]] });
        editor.hold({ id: 'lift', cells: [[2, 1, 1]], expiresAtTick: 8 });
        editor.releaseHold('lift');
        editor.addEnergy([{ x: 2, y: 1, z: 1, deltaQ: 3 }]);
        editor.transfer({ from: null, to: 'flask', cells: [[2, 1, 1]], offset: [0, 0, 0] });
      } else if (command.kind === 'roundtrip') {
        editor.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 3 }]);
        editor.setGame({ ap: 1 });
        editor.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: -3 }]);
        editor.setGame({ ap: 2 });
        return;
      } else if (command.kind === 'empty') return;
      else if (command.kind !== 'game') throw Error('Unknown command');
      editor.setGame({ ap: 1 });
    },
    'journal-channel',
  );
  const client = createTacticalWorkerClient3D<Game, Command>(ports[0], {
    channel: 'journal-channel',
    worldId: 'journal-world',
    gameRulesVersion: 'journal-game',
    timeoutMs,
  });
  return {
    client,
    host,
    session,
    observer,
    sent,
    closed,
    branch: () => branch!,
    latest: () => latest!,
    counts: () => ({ steps, drivers, disposed }),
    intercept,
    deliver,
  };
}
async function ready(
  f: ReturnType<typeof fixture>,
  kind = 'mixed',
  horizon = 0,
  capture: TacticalPreviewCapture3D = { journal: {} },
) {
  const ticket = f.client.request({ kind }, horizon, capture);
  expect((await ticket.result).status).toBe('ready');
  return ticket;
}
async function finish(f: ReturnType<typeof fixture>) {
  if (f.client.state.status !== 'failed') await f.client.close();
  await f.host.close();
  expect(f.counts().disposed).toBe(f.counts().drivers);
}
const turn = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('worker action history with mock transport and inert physics', () => {
  test('mixed receipts match direct history before and after an acknowledged commit', async () => {
    const f = fixture();
    await f.client.ready;
    const t = await ready(f),
      before = f.client.snapshot(),
      observerCalls = f.observer.mock.calls.length;
    const preview = await f.client.journalPreview(t);
    expect(preview).toEqual(f.branch().journal());
    expect(preview.events.map((e) => e.action.kind)).toEqual([
      'edit',
      'translate',
      'hold',
      'release-hold',
      'energy',
      'transfer',
      'game',
    ]);
    const c = await f.client.commit(t),
      committed = await f.client.journal(c);
    expect(committed).toEqual(f.latest().journal());
    expect(committed.events).toEqual(preview.events);
    expect(committed.to).toMatchObject({ kind: 'committed', revision: { revision: 1, tick: 3 } });
    expect(f.observer).toHaveBeenCalledTimes(observerCalls);
    expect(before.game.ap).toBe(2);
    expect(c.snapshot.game.ap).toBe(1);
    expect(f.counts().steps).toBe(0);
    await finish(f);
  });
  test('odd-start multi-batch histories cover both domains and exact operation order', async () => {
    const f = fixture();
    await f.client.ready;
    const t = await ready(f, 'game', 33),
      r = await f.client.journalPreview(t);
    expect(r).toEqual(f.branch().journal());
    expect(r.recordsObserved).toBe(34);
    expect(r.domainTicksObserved).toBe(66);
    expect(r.events.slice(1, 33).every((e) => e.operation === 2)).toBe(true);
    expect(r.events[33]).toMatchObject({ operation: 3, from: { tick: 35 }, to: { tick: 36 } });
    expect(r.events[1].motion.map((m) => m.domain)).toEqual([null, 'flask']);
    const c = await f.client.commit(t);
    expect((await f.client.journal(c)).events).toEqual(r.events);
    await finish(f);
  });
  test('intervening heat and resource changes remain visible after exact reversal', async () => {
    const f = fixture();
    await f.client.ready;
    const t = await ready(f, 'roundtrip'),
      r = await f.client.journalPreview(t);
    expect(r.events.filter((e) => e.changes.accountingChanged)).toHaveLength(2);
    expect(r.events.filter((e) => e.changes.gameChanged)).toHaveLength(2);
    const c = await f.client.commit(t),
      changes = await f.client.changes(c);
    expect(changes.accountingChanged).toBe(false);
    expect(changes.gameChanged).toBe(false);
    await finish(f);
  });
  test('distant support changes survive coarse zero-run capture without invented detail', async () => {
    const f = fixture();
    await f.client.ready;
    const t = await ready(f, 'mixed', 0, { journal: { maxRuns: 0 } }),
      r = await f.client.journalPreview(t);
    expect(r).toEqual(f.branch().journal());
    expect(r.status).toBe('coarse');
    expect(r.requiresFullRead).toBe(true);
    expect(r.requiresReexecution).toBe(false);
    expect(r.events[0].changes.domains[0].channels.support).toEqual({
      mode: 'bounds',
      count: 1,
      bounds: { min: [3, 3, 3], max: [4, 4, 4] },
      runs: [],
      requiresFullRead: true,
    });
    await finish(f);
  });
  test('disabled capture stays explicit and performs no support observations', async () => {
    const f = fixture();
    await f.client.ready;
    const t = await ready(f, 'mixed', 0, {}),
      r = await f.client.journalPreview(t);
    expect(r).toMatchObject({
      status: 'disabled',
      events: [],
      recordsObserved: 0,
      domainTicksObserved: 0,
      entries: 0,
      requiresReexecution: true,
    });
    const c = await f.client.commit(t);
    expect((await f.client.journal(c)).status).toBe('disabled');
    expect(f.observer).not.toHaveBeenCalled();
    await finish(f);
  });
  test('empty zero-tick actions have complete empty history despite completion operation', async () => {
    const f = fixture();
    await f.client.ready;
    const t = await ready(f, 'empty'),
      r = await f.client.journalPreview(t);
    expect(r).toMatchObject({
      status: 'complete',
      entries: 0,
      recordsObserved: 0,
      events: [],
      to: { operation: 1 },
    });
    await finish(f);
  });
  test('domain tick overflow removes the entire prefix while preserving observed counts', async () => {
    const f = fixture();
    await f.client.ready;
    const t = await ready(f, 'empty', 129),
      r = await f.client.journalPreview(t);
    expect(r).toEqual(f.branch().journal());
    expect(r).toMatchObject({
      status: 'overflow',
      entries: 0,
      events: [],
      recordsObserved: 129,
      domainTicksObserved: 258,
      requiresReexecution: true,
    });
    await finish(f);
  });
  test('caller mutations cannot replace private preview or commit provenance', async () => {
    const f = fixture();
    await f.client.ready;
    const t = await ready(f);
    const outcome = await t.result;
    if (outcome.status !== 'ready') throw Error('Missing preview');
    outcome.preview.preview.operation = 99;
    outcome.preview.preview.branchId = 99;
    const r = await f.client.journalPreview(t);
    r.events[0].operation = 99;
    r.events[0].changes.domains.length = 0;
    expect(await f.client.journalPreview(t)).toEqual(f.branch().journal());
    const c = await f.client.commit(t);
    c.receipt.revision = 99;
    c.snapshot.terrain.tick = 99;
    expect(await f.client.journal(c)).toEqual(f.latest().journal());
    await finish(f);
  });
  test('foreign copied and absent handles reject locally without dispatch', async () => {
    const a = fixture(),
      b = fixture();
    await Promise.all([a.client.ready, b.client.ready]);
    const t = await ready(a);
    for (const candidate of [{ ...t }, null as unknown as TacticalPreviewTicket3D<Game>])
      expect(() => a.client.journalPreview(candidate)).toThrow(/latest/);
    expect(() => b.client.journalPreview(t)).toThrow(/latest/);
    const c = await a.client.commit(t);
    expect(() => a.client.journal({ ...c })).toThrow(/latest/);
    expect(() => a.client.journal(null as unknown as TacticalWorkerCommit3D<Game>)).toThrow(
      /latest/,
    );
    expect(() => b.client.journal(c)).toThrow(/latest/);
    expect(a.sent[0].filter((m) => m.kind.startsWith('journal'))).toHaveLength(0);
    await finish(a);
    await finish(b);
  });
  test('supersession and commit expire preview history access', async () => {
    const f = fixture();
    await f.client.ready;
    const old = await ready(f),
      next = await ready(f, 'game');
    expect(() => f.client.journalPreview(old)).toThrow(/latest/);
    const c = await f.client.commit(next);
    expect(() => f.client.journalPreview(next)).toThrow(/latest/);
    await f.client.journal(c);
    await finish(f);
  });
  test('new commits and restore expire acknowledged history handles', async () => {
    const f = fixture();
    await f.client.ready;
    const saved = f.client.snapshot(),
      c = await f.client.commit(await ready(f, 'game'));
    const next = await f.client.commit(await ready(f, 'game'));
    expect(() => f.client.journal(c)).toThrow(/latest/);
    const t = await ready(f, 'game');
    await f.client.restore(saved);
    expect(() => f.client.journal(next)).toThrow(/latest/);
    expect(() => f.client.journalPreview(t)).toThrow(/latest/);
    await finish(f);
  });
  test('out-of-band revisions reject reads at host without recomputing support', async () => {
    for (const committed of [false, true]) {
      const f = fixture();
      await f.client.ready;
      const t = await ready(f),
        c = committed ? await f.client.commit(t) : undefined;
      const calls = f.observer.mock.calls.length;
      f.session.restore(f.session.snapshot());
      await expect(c ? f.client.journal(c) : f.client.journalPreview(t)).rejects.toThrow(/Stale/);
      expect(f.observer).toHaveBeenCalledTimes(calls);
      expect(f.client.state.uncertain).toBe(false);
      await finish(f);
    }
  });
  test('pending journal reads exclude all other ordinary requests', async () => {
    const f = fixture();
    await f.client.ready;
    const t = await ready(f);
    let held: Wire | undefined;
    f.intercept((m, side) => {
      if (side === 1 && m.kind === 'journal-preview') {
        held = m;
        return null;
      }
      return m;
    });
    const pending = f.client.journalPreview(t);
    await turn();
    expect(() => f.client.journalPreview(t)).toThrow(/idle/);
    expect(() => f.client.commit(t)).toThrow(/idle/);
    expect(() => f.client.request({ kind: 'game' }, 0)).toThrow(/in flight/);
    expect(() => f.client.restore(f.client.snapshot())).toThrow(/idle/);
    f.deliver(0, held);
    await pending;
    await finish(f);
  });
  test('cancelled ready previews reject an outstanding read in either reply order', async () => {
    for (const cancelFirst of [false, true]) {
      const f = fixture();
      await f.client.ready;
      const t = await ready(f),
        held = new Map<string, Wire>();
      f.intercept((m, side) => {
        if (side === 1 && ['journal-preview', 'cancel'].includes(m.kind)) {
          held.set(m.kind, m);
          return null;
        }
        return m;
      });
      const pending = expect(f.client.journalPreview(t)).rejects.toThrow(/no longer current/);
      await turn();
      t.cancel();
      await turn();
      for (const kind of cancelFirst
        ? ['cancel', 'journal-preview']
        : ['journal-preview', 'cancel'])
        f.deliver(0, held.get(kind));
      await pending;
      expect(f.client.state).toMatchObject({ status: 'ready', readyId: null, uncertain: false });
      expect(() => f.client.journalPreview(t)).toThrow(/latest/);
      f.intercept(undefined);
      await finish(f);
    }
  });
  test('close invalidates pending preview delivery and waits for it to drain', async () => {
    const f = fixture();
    await f.client.ready;
    const t = await ready(f);
    let held: Wire | undefined;
    f.intercept((m, side) => {
      if (side === 1 && m.kind === 'journal-preview') {
        held = m;
        return null;
      }
      return m;
    });
    const pending = expect(f.client.journalPreview(t)).rejects.toThrow(/no longer current/);
    await turn();
    const close = f.client.close();
    expect(f.closed[0]).toBe(false);
    f.deliver(0, held);
    await pending;
    await close;
    await f.host.close();
    expect(f.closed[0]).toBe(true);
  });
  test('close drains an outstanding committed history before disposing transport', async () => {
    const f = fixture();
    await f.client.ready;
    const c = await f.client.commit(await ready(f)),
      pending = f.client.journal(c),
      close = f.client.close();
    await pending;
    await close;
    expect(f.closed[0]).toBe(true);
    await f.host.close();
  });
  test('read exceptions are nonfatal and preserve the ready candidate', async () => {
    const f = fixture();
    await f.client.ready;
    const t = await ready(f),
      original = f.branch().journal;
    // Wrap the captured reader at the transport seam without changing authority.
    f.intercept((m, side) =>
      side === 1 && m.kind === 'journal-preview'
        ? { ...m, kind: 'error', payload: { message: 'capture unavailable', fatal: false } }
        : m,
    );
    await expect(f.client.journalPreview(t)).rejects.toThrow(/capture unavailable/);
    expect(f.client.state).toMatchObject({ status: 'ready', readyId: t.id, uncertain: false });
    f.intercept(undefined);
    expect(await f.client.journalPreview(t)).toEqual(original());
    await f.client.commit(t);
    await finish(f);
  });
  test('timeouts retain last confirmed state and never retry or imply an uncertain commit', async () => {
    vi.useFakeTimers();
    const f = fixture(30);
    await f.client.ready;
    const t = await ready(f),
      before = f.client.snapshot();
    f.intercept((m, side) => (side === 1 && m.kind === 'journal-preview' ? null : m));
    const failed = expect(f.client.journalPreview(t)).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(31);
    await failed;
    expect(f.client.state).toMatchObject({ status: 'failed', uncertain: false });
    expect(f.client.snapshot()).toEqual(before);
    expect(f.session.snapshot()).toEqual(before);
    expect(f.sent[0].filter((m) => m.kind === 'journal-preview')).toHaveLength(1);
    await finish(f);
  });
  test('wrong preview target and protocol fail closed without publishing candidate state', async () => {
    for (const protocol of [false, true]) {
      const f = fixture();
      await f.client.ready;
      const t = await ready(f),
        before = f.client.snapshot();
      f.intercept((m, side) => {
        if (side === 1 && m.kind === 'journal-preview') {
          if (protocol) return { ...m, protocol: 'tactical-worker-6' } as unknown as Wire;
          (m.payload as { target: number }).target++;
        }
        return m;
      });
      await expect(f.client.journalPreview(t)).rejects.toThrow();
      expect(f.client.snapshot()).toEqual(before);
      expect(f.client.state.uncertain).toBe(false);
      await finish(f);
    }
  });
  test('journal stamp and chronology corruption fail closed on committed and preview reads', async () => {
    const corrupt: ((r: ActionJournal3D) => void)[] = [
      (r) => {
        r.rulesVersion = 'bad' as never;
      },
      (r) => {
        r.from = { ...r.from, revision: 99 };
      },
      (r) => {
        r.recordsObserved--;
      },
      (r) => {
        r.events[0].operation++;
      },
      (r) => {
        r.events[0].from.tick++;
      },
      (r) => {
        r.events[0].to.sequence++;
      },
      (r) => {
        r.events[0].to.completedTicks++;
      },
      (r) => {
        r.entries++;
      },
      (r) => {
        r.requiresReexecution = true;
      },
      (r) => {
        r.domainTicksObserved++;
      },
      (r) => {
        if (r.to.kind === 'preview') r.to = { ...r.to, branchId: 99 };
        else r.to = { ...r.to, revision: { ...r.to.revision, revision: 99 } };
      },
    ];
    for (const committed of [false, true])
      for (const mutate of corrupt) {
        const f = fixture();
        await f.client.ready;
        const t = await ready(f),
          c = committed ? await f.client.commit(t) : undefined,
          before = f.client.snapshot();
        f.intercept((m, side) => {
          if (side === 1 && m.kind === 'journal') mutate(m.payload as ActionJournal3D);
          if (side === 1 && m.kind === 'journal-preview')
            mutate((m.payload as { journal: ActionJournal3D }).journal);
          return m;
        });
        await expect(c ? f.client.journal(c) : f.client.journalPreview(t)).rejects.toThrow();
        expect(f.client.state).toMatchObject({ status: 'failed', uncertain: false });
        expect(f.client.snapshot()).toEqual(before);
        expect(f.session.snapshot()).toEqual(before);
        await finish(f);
      }
  });
  test('domain geometry runs and distant support bounds are checked on every boundary', async () => {
    const f = fixture();
    await f.client.ready;
    const t = await ready(f),
      r = await f.client.journalPreview(t),
      candidate = f.branch().inspect();
    const corrupt: ((j: ActionJournal3D) => void)[] = [
      (j) => {
        j.events[0].changes.domains.pop();
      },
      (j) => {
        j.events[0].changes.domains[1].domain = 'absent';
      },
      (j) => {
        j.events[0].changes.domains[0].width++;
      },
      (j) => {
        j.events[0].changes.domains[0].fromTick++;
      },
      (j) => {
        j.events[0].changes.domains[0].channels.support.count++;
      },
      (j) => {
        j.events[0].changes.domains[0].channels.support.runs[0][0]--;
      },
      (j) => {
        j.events[0].changes.domains[0].channels.support.bounds!.max[0]--;
      },
      (j) => {
        j.status = 'coarse';
        j.requiresFullRead = true;
      },
    ];
    for (const mutate of corrupt) {
      const copy = structuredClone(r);
      mutate(copy);
      expect(() =>
        actionJournalData(
          copy,
          r.from,
          r.to,
          candidate,
          candidate.preview.operation,
          { journal: {} },
          BigInt(candidate.accounting.externalQ),
        ),
      ).toThrow();
    }
    await finish(f);
  });
  test('receipt versions mappings budgets energy and hold lifetime reject malformed history', async () => {
    const f = fixture();
    await f.client.ready;
    const t = await ready(f),
      r = await f.client.journalPreview(t),
      s = f.branch().inspect();
    const actions = Object.fromEntries(r.events.map((e) => [e.action.kind, e.action])) as Record<
      string,
      Record<string, unknown>
    >;
    const corrupt = [
      { ...actions.edit, externalEnergyQ: '-0' },
      { ...actions.game, externalEnergyQ: '1' },
      {
        ...actions.translate,
        receipt: { ...(actions.translate.receipt as object), destinations: [23] },
      },
      {
        ...actions.translate,
        receipt: { ...(actions.translate.receipt as object), path: [[1, 1, 0]] },
      },
      {
        ...actions.translate,
        receipt: { ...(actions.translate.receipt as object), path: [[0, 0, 1]] },
      },
      {
        ...actions.translate,
        receipt: { ...(actions.translate.receipt as object), cutBonds: [[0, 21]] },
      },
      {
        ...actions.translate,
        receipt: { ...(actions.translate.receipt as object), releasedAnchors: [0] },
      },
      { ...actions.transfer, receipt: { ...(actions.transfer.receipt as object), from: 'absent' } },
      {
        ...actions.transfer,
        receipt: { ...(actions.transfer.receipt as object), destinationEnergyDeltaQ: '1' },
      },
      { ...actions.energy, receipt: { ...(actions.energy.receipt as object), suppliedQ: '4' } },
      {
        ...actions.energy,
        receipt: {
          ...(actions.energy.receipt as object),
          changes: [{ index: 22, beforeQ: 1, afterQ: 3, deltaQ: 1 }],
        },
      },
      { ...actions.hold, hold: { ...(actions.hold.hold as object), expiresAtTick: 3 } },
      { ...actions.hold, hold: { ...(actions.hold.hold as object), cells: [22, 22] } },
    ];
    for (const raw of corrupt) expect(() => actionReceiptData(raw, s, 3, 65536)).toThrow();
    expect(() => actionReceiptData(actions.translate, s, 3, 1)).toThrow(
      'Invalid bounded action array.',
    );
    await finish(f);
  });
  test('raw accessor sparse and decorated arrays reject without invoking accessors', async () => {
    const f = fixture();
    await f.client.ready;
    const t = await ready(f),
      r = await f.client.journalPreview(t),
      s = f.branch().inspect(),
      getter = vi.fn();
    const raw = { ...r, events: [r.events[0]] };
    Object.defineProperty(raw.events, '0', { get: getter, enumerable: true });
    const invalid = [
      raw,
      { ...r, events: new Array(7) },
      { ...r, events: Object.assign([...r.events], { extra: 1 }) },
    ];
    for (const value of invalid)
      expect(() =>
        actionJournalData(
          value,
          r.from,
          r.to,
          s,
          s.preview.operation,
          { journal: {} },
          BigInt(s.accounting.externalQ),
        ),
      ).toThrow();
    expect(getter).not.toHaveBeenCalled();
    await finish(f);
  });
  test('internally balanced forged heat receipts cannot disagree with private accounting', async () => {
    for (const committed of [false, true]) {
      const f = fixture();
      await f.client.ready;
      const t = await ready(f),
        c = committed ? await f.client.commit(t) : undefined,
        before = f.client.snapshot();
      f.intercept((m, side) => {
        if (side === 1 && (m.kind === 'journal' || m.kind === 'journal-preview')) {
          const r = (
            m.kind === 'journal' ? m.payload : (m.payload as { journal: ActionJournal3D }).journal
          ) as ActionJournal3D;
          const action = r.events.find((e) => e.action.kind === 'energy')!.action;
          if (action.kind !== 'energy') throw Error('Missing energy fixture');
          action.receipt.suppliedQ = action.receipt.externalQ = '4';
          action.receipt.changes[0].afterQ++;
          action.receipt.changes[0].deltaQ++;
        }
        return m;
      });
      await expect(c ? f.client.journal(c) : f.client.journalPreview(t)).rejects.toThrow(
        /acknowledged energy/,
      );
      expect(f.client.snapshot()).toEqual(before);
      expect(f.client.state.uncertain).toBe(false);
      await finish(f);
    }
  });
  test('tick motion coverage identity and complete permutation are validated', async () => {
    const f = fixture();
    await f.client.ready;
    const t = await ready(f, 'game', 1),
      r = await f.client.journalPreview(t),
      s = f.branch().inspect();
    const corrupt: ((j: ActionJournal3D) => void)[] = [
      (j) => {
        j.events[1].motion.pop();
      },
      (j) => {
        j.events[1].motion[1].domain = null;
      },
      (j) => {
        j.events[1].motion[0].trace.fromTick++;
      },
      (j) => {
        j.events[1].motion[0].trace.status = 'overflow';
      },
      (j) => {
        j.events[1].motion[0].trace.moves = [[0, 1, 1]];
        j.events[1].motion[0].trace.movedCells = 1;
      },
      (j) => {
        j.events[1].operation++;
      },
      (j) => {
        j.events[1].action = { kind: 'game', externalEnergyQ: '0' };
      },
    ];
    for (const mutate of corrupt) {
      const copy = structuredClone(r);
      mutate(copy);
      expect(() =>
        actionJournalData(
          copy,
          r.from,
          r.to,
          s,
          s.preview.operation,
          { journal: {} },
          BigInt(s.accounting.externalQ),
        ),
      ).toThrow();
    }
    await finish(f);
  });
  test('disabled overflow and coarse statuses cannot carry misleading partial prefixes', async () => {
    const f = fixture();
    await f.client.ready;
    const t = await ready(f),
      r = await f.client.journalPreview(t),
      s = f.branch().inspect();
    for (const status of ['disabled', 'overflow', 'coarse'] as const) {
      const raw = {
        ...r,
        status,
        requiresReexecution: status !== 'coarse',
        requiresFullRead: status === 'coarse',
      };
      expect(() =>
        actionJournalData(
          raw,
          r.from,
          r.to,
          s,
          s.preview.operation,
          { journal: {} },
          BigInt(s.accounting.externalQ),
        ),
      ).toThrow();
    }
    expect(() =>
      actionJournalData(
        r,
        r.from,
        r.to,
        s,
        s.preview.operation,
        {},
        BigInt(s.accounting.externalQ),
      ),
    ).toThrow();
    await finish(f);
  });
});
