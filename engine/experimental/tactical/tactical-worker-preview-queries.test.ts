import { createMicrotaskTransport } from '../../test-support/microtask-transport.js';
import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Preview geometry via cloned mock messages; real physics and native workers held. */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MAT } from '../3d.js';

import { CpuStructuralWorld3D } from '../structural-world-core.js';
import {
  createTacticalSessionCore3D,
  type TacticalSimulationFactory3D,
} from './tactical-session-core.js';
import {
  createTacticalPreviewQueue3D,
  type TacticalPreviewEditor3D,
  type TacticalPreviewTicket3D,
} from './tactical-previews.js';
import type { TacticalBranch3D, TacticalQueryOptions3D } from './tactical-session-view.js';
import { createTacticalWorkerHost3D } from './tactical-worker-host.js';
import { createTacticalWorkerClient3D } from './tactical-worker-client.js';
import type { Wire } from './tactical-worker-wire.js';
import {
  TACTICAL_PREVIEW_QUERY_BATCH_RULES_3D,
  type TacticalWorkerQuery3D,
  type TacticalWorkerPreviewQueryBatch3D,
} from './tactical-worker-queries.js';
import type { GameplayGeometry3D } from '../gameplay-geometry.js';

holdPhysics('solveStructure3D', ...STRUCTURAL_CALLS);
afterEach(() => vi.useRealTimers());
type Game = { ap: number };
type Command = { store?: boolean };
const solid = { minQ: [2048, 1024, 1024], maxQ: [3072, 2048, 2048] } as const;
const body = { minQ: [2048, 0, 1024], maxQ: [3072, 1024, 2048] } as const;
const fit: TacticalWorkerQuery3D = { kind: 'fit', request: { box: solid } };
const all: TacticalWorkerQuery3D[] = [
  fit,
  { kind: 'support', request: { box: body, maxDropQ: 2048 } },
  { kind: 'raycast', request: { fromQ: [512, 1536, 1536], toQ: [3584, 1536, 1536] } },
  { kind: 'sweep', request: { box: body, deltaQ: [0, 2048, 0] } },
  { kind: 'exposure', request: { box: { minQ: [0, 0, 0], maxQ: [4096, 4096, 4096] } } },
];
function stage(e: TacticalPreviewEditor3D<Game>, c: Command) {
  e.translate({ cells: [[1, 1, 1]], path: [[1, 0, 0]] });
  e.addEnergy([{ x: 2, y: 1, z: 1, deltaQ: 100 }]);
  if (c.store) e.transfer({ from: null, to: 'flask', cells: [[2, 1, 1]], offset: [0, 0, 0] });
  e.setGame({ ap: 1 });
}
function fixture(
  options: { tick?: number; timeout?: number; beforeStep?: () => Promise<void> } = {},
) {
  const world = new CpuStructuralWorld3D({ width: 4, height: 4, depth: 4, chunkSize: 4 });
  world.setCell(1, 1, 1, MAT.STONE, 160);
  world.setIntegrity(1, 1, 1, 73);
  const terrain = world.snapshot();
  terrain.tick = options.tick ?? 0;
  const reservoir = new CpuStructuralWorld3D({
    width: 4,
    height: 4,
    depth: 4,
    chunkSize: 4,
  }).snapshot();
  reservoir.tick = terrain.tick;
  const made = vi.fn(),
    stepped = vi.fn(),
    cleaned = vi.fn(),
    views = vi.fn();
  const factory: TacticalSimulationFactory3D = (initial) => {
    made();
    let s = structuredClone(initial);
    return {
      load(value) {
        s = structuredClone(value);
      },
      async step() {
        await options.beforeStep?.();
        stepped();
        s.tick++;
      },
      snapshot: () => s,
      close() {
        cleaned();
      },
    };
  };
  const session = createTacticalSessionCore3D(
    {
      worldId: 'preview-world',
      gameRulesVersion: 'preview-game',
      terrain,
      reservoirs: [{ id: 'flask', terrain: reservoir }],
      game: { ap: 2 },
    },
    factory,
    {},
    async () => {},
  );
  const { ports, sent, closed, setRewrite: intercept, deliver } = createMicrotaskTransport<Wire>();
  let oversized = false,
    latest: TacticalBranch3D<Game>;
  const host = createTacticalWorkerHost3D(
    ports[1],
    {
      ...session,
      get revision() {
        return session.revision;
      },
      branch(options) {
        const branch = session.branch(options);
        latest = branch;
        return {
          ...branch,
          get status() {
            return branch.status;
          },
          get progress() {
            return branch.progress;
          },
          queries(options?: TacticalQueryOptions3D) {
            views(options?.domain ?? null);
            const view = branch.queries(options);
            return !oversized
              ? view
              : {
                  ...view,
                  support(request: Parameters<GameplayGeometry3D['support']>[0]) {
                    const result = view.support(request);
                    return {
                      ...result,
                      surfaces: Array.from({ length: 6000 }, () => result.surfaces[0]),
                    };
                  },
                };
          },
        };
      },
      commit() {
        return session.commit(latest);
      },
    },
    stage,
    'preview-channel',
  );
  const client = createTacticalWorkerClient3D<Game, Command>(ports[0], {
    channel: 'preview-channel',
    worldId: 'preview-world',
    gameRulesVersion: 'preview-game',
    timeoutMs: options.timeout,
  });
  return {
    session,
    host,
    client,
    made,
    stepped,
    cleaned,
    views,
    sent,
    closed,
    latest: () => latest,
    intercept,
    deliver: (m: Wire) => deliver(0, m),
    oversized: () => {
      oversized = true;
    },
  };
}
async function ready(f: ReturnType<typeof fixture>, horizon = 0, command: Command = {}) {
  await f.client.ready;
  const ticket = f.client.request(command, horizon);
  expect((await ticket.result).status).toBe('ready');
  return ticket;
}
async function finish(f: ReturnType<typeof fixture>) {
  if (f.client.state.status !== 'failed') await f.client.close();
  await f.host.close();
}
async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}
function direct(view: GameplayGeometry3D, item: TacticalWorkerQuery3D) {
  switch (item.kind) {
    case 'fit':
      return view.fit(item.request);
    case 'support':
      return view.support(item.request);
    case 'raycast':
      return view.raycast(item.request);
    case 'sweep':
      return view.sweep(item.request);
    case 'exposure':
      return view.exposure(item.request);
  }
}
function rewrite(
  f: ReturnType<typeof fixture>,
  change: (r: TacticalWorkerPreviewQueryBatch3D) => void,
) {
  f.intercept((m, side) => {
    if (side === 1 && m.kind === 'query-preview')
      change(m.payload as TacticalWorkerPreviewQueryBatch3D);
    return m;
  });
}
describe('queries against the exact ready preview', () => {
  test('all operations match direct preview geometry with reservoirs and odd multi-batch horizons', async () => {
    const f = fixture({ tick: 3 }),
      ticket = await ready(f, 33),
      before = f.client.snapshot();
    const requests = [...all, ...all.map((q) => ({ ...q, domain: 'flask' }))],
      r = await f.client.queryPreview(ticket, requests);
    expect(r).toEqual({
      rulesVersion: TACTICAL_PREVIEW_QUERY_BATCH_RULES_3D,
      target: f.sent[0].find((m) => m.kind === 'preview')!.seq,
      preview: f.latest().inspect().preview,
      results: requests.map((q) => ({
        kind: q.kind,
        domain: q.domain ?? null,
        value: direct(f.latest().queries({ domain: q.domain }), q),
      })),
    });
    expect(r.preview).toMatchObject({ horizonTicks: 33, completedTicks: 33, operation: 5 });
    expect(r.results.every((r) => r.value.stamp.tick === 36)).toBe(true);
    expect(f.client.snapshot()).toEqual(before);
    expect(f.session.snapshot()).toEqual(before);
    expect(f.stepped).toHaveBeenCalledTimes(66);
    expect(f.cleaned).toHaveBeenCalledTimes(4);
    await finish(f);
  });
  test('new position preserves heat and damage while committed cells remain unchanged', async () => {
    const f = fixture(),
      ticket = await ready(f),
      before = f.client.snapshot();
    const r = (await f.client.queryPreview(ticket, [fit])).results[0];
    if (r.kind !== 'fit') throw Error('Expected fit');
    expect(r.value.blocker).toMatchObject({
      index: 22,
      coordinate: [2, 1, 1],
      material: MAT.STONE,
      structure: 73,
      energyQ: before.terrain.energyQ[21] + 100,
    });
    expect((await f.client.query([fit])).results[0].value).toMatchObject({ fits: true });
    expect(f.made).not.toHaveBeenCalled();
    expect(f.session.snapshot()).toEqual(before);
    await finish(f);
  });
  test('transfer previews query the private reservoir rather than the empty live reservoir', async () => {
    const f = fixture(),
      ticket = await ready(f, 0, { store: true });
    const r = await f.client.queryPreview(ticket, [fit, { ...fit, domain: 'flask' }]);
    expect(r.results[0].value).toMatchObject({ fits: true });
    expect(r.results[1].value).toMatchObject({
      fits: false,
      blocker: { material: MAT.STONE, structure: 73 },
    });
    expect(f.client.snapshot().reservoirs[0].terrain.structure[22]).toBe(0);
    await finish(f);
  });
  test('one geometry view per requested domain is reused without a speculative primary copy', async () => {
    const f = fixture(),
      ticket = await ready(f);
    expect(f.views).not.toHaveBeenCalled();
    await f.client.queryPreview(
      ticket,
      all.map((q) => ({ ...q, domain: 'flask' })),
    );
    expect(f.views.mock.calls).toEqual([['flask']]);
    f.views.mockClear();
    await f.client.queryPreview(ticket, [...all, ...all.map((q) => ({ ...q, domain: 'flask' }))]);
    expect(f.views.mock.calls).toEqual([[null], ['flask']]);
    await finish(f);
  });
  test('caller mutation of ready snapshots requests and replies cannot change the private candidate', async () => {
    const f = fixture(),
      ticket = await ready(f),
      outcome = await ticket.result;
    if (outcome.status !== 'ready') throw Error('Ready required');
    outcome.preview.terrain.energyQ.fill(0);
    outcome.preview.terrain.structure.fill(0);
    outcome.preview.preview.branchId = 999;
    outcome.preview.game.ap = 999;
    const request = structuredClone(fit),
      pending = f.client.queryPreview(ticket, [request]);
    request.domain = 'flask';
    const r = await pending;
    expect(r.results[0].domain).toBe(null);
    r.preview.operation = 999;
    if (r.results[0].kind === 'fit') r.results[0].value.blocker!.energyQ = 0;
    const fresh = await f.client.queryPreview(ticket, [fit]);
    expect(fresh.preview.operation).toBe(4);
    expect(fresh.results[0].value).toMatchObject({ blocker: { structure: 73 } });
    expect((await f.client.commit(ticket)).snapshot.game.ap).toBe(1);
    await finish(f);
  });
  test('queue views are isolated historical answers and invalid tickets cannot acquire fresh views', async () => {
    const f = fixture(),
      queue = createTacticalPreviewQueue3D(f.session, stage),
      ticket = queue.request({}, 0);
    expect(() => queue.queries(ticket)).toThrow(/latest ready/);
    await ticket.result;
    const view = queue.queries(ticket),
      answer = view.fit({ box: solid });
    expect(answer.fits).toBe(false);
    answer.blocker!.structure = 0;
    expect(view.fit({ box: solid }).blocker!.structure).toBe(73);
    expect(() => queue.queries({ ...ticket })).toThrow(/latest ready/);
    ticket.cancel();
    expect(() => queue.queries(ticket)).toThrow(/latest ready/);
    expect(view.fit({ box: solid }).fits).toBe(false);
    await queue.close();
    await finish(f);
  });
  test('queue queries reject superseded committed restored and closed tickets', async () => {
    const f = fixture(),
      original = f.session.snapshot(),
      queue = createTacticalPreviewQueue3D(f.session, stage),
      a = queue.request({}, 0);
    await a.result;
    const b = queue.request({}, 0);
    expect(() => queue.queries(a)).toThrow();
    await b.result;
    queue.commit(b);
    expect(() => queue.queries(b)).toThrow();
    f.session.restore(original);
    const c = queue.request({}, 0);
    expect((await c.result).status).toBe('ready');
    f.session.restore(f.session.snapshot());
    expect(() => queue.queries(c)).toThrow();
    await queue.close();
    expect(() => queue.queries(c)).toThrow();
    await finish(f);
  });
  test('foreign copied and pending worker tickets fail without dispatch', async () => {
    const f = fixture(),
      other = fixture(),
      ticket = await ready(f),
      foreign = await ready(other);
    for (const t of [foreign, { ...ticket }])
      expect(() => f.client.queryPreview(t, [fit])).toThrow(/latest ready/);
    const pending = f.client.request({}, 0);
    expect(() => f.client.queryPreview(pending, [fit])).toThrow(/idle/);
    await pending.result;
    expect(f.sent[0].filter((m) => m.kind === 'query-preview')).toHaveLength(0);
    await finish(f);
    await finish(other);
  });
  test('cancelled and superseded worker candidates cannot be read or committed', async () => {
    const f = fixture(),
      a = await ready(f),
      b = f.client.request({}, 0);
    await b.result;
    expect(() => f.client.queryPreview(a, [fit])).toThrow(/latest ready/);
    b.cancel();
    await flush();
    expect(() => f.client.queryPreview(b, [fit])).toThrow(/latest ready/);
    expect(() => f.client.commit(b)).toThrow();
    await finish(f);
  });
  test('commit and restore invalidate reads against the former ready ticket', async () => {
    const f = fixture(),
      ticket = await ready(f),
      original = f.client.snapshot();
    await f.client.commit(ticket);
    expect(() => f.client.queryPreview(ticket, [fit])).toThrow(/latest ready/);
    await f.client.restore(original);
    const next = await ready(f);
    await f.client.restore(original);
    expect(() => f.client.queryPreview(next, [fit])).toThrow(/latest ready/);
    await finish(f);
  });
  test('an external revision change rejects the host read without publishing or rebasing', async () => {
    const f = fixture(),
      ticket = await ready(f),
      before = f.client.snapshot();
    f.session.restore(f.session.snapshot());
    await expect(f.client.queryPreview(ticket, [fit])).rejects.toThrow(/Stale/);
    expect(f.views).not.toHaveBeenCalled();
    expect(f.client.snapshot()).toEqual(before);
    expect(f.client.state.uncertain).toBe(false);
    await finish(f);
  });
  test('invalid batches fail before sending while the inclusive 32-query budget succeeds', async () => {
    const f = fixture(),
      ticket = await ready(f),
      getter = vi.fn();
    const invalid = [
      [],
      Array(33).fill(fit),
      Array(1),
      [{ ...fit, domain: 'missing' }],
      [{ ...fit, extra: true }],
      [Object.defineProperty({ kind: 'fit' }, 'request', { get: getter, enumerable: true })],
    ];
    for (const q of invalid)
      expect(() => f.client.queryPreview(ticket, q as TacticalWorkerQuery3D[])).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(f.sent[0].filter((m) => m.kind === 'query-preview')).toHaveLength(0);
    expect((await f.client.queryPreview(ticket, Array(32).fill(fit))).results).toHaveLength(32);
    await finish(f);
  });
  test('ordinary invalid geometry errors retain the ready candidate for a successful read and commit', async () => {
    const f = fixture(),
      ticket = await ready(f);
    await expect(
      f.client.queryPreview(ticket, [
        fit,
        { kind: 'support', request: { box: body, maxDropQ: -1 } },
      ]),
    ).rejects.toThrow(/distance/);
    expect(f.client.state).toMatchObject({ status: 'ready', readyId: ticket.id, uncertain: false });
    await f.client.queryPreview(ticket, [fit]);
    await f.client.commit(ticket);
    await finish(f);
  });
  test('portable response overflow fails the read without sending a partial result or losing the candidate', async () => {
    const f = fixture(),
      ticket = await ready(f);
    f.oversized();
    await expect(f.client.queryPreview(ticket, [all[1]])).rejects.toThrow(/budget/);
    expect(f.sent[1].filter((m) => m.kind === 'query-preview')).toHaveLength(0);
    expect(f.client.state.readyId).toBe(ticket.id);
    await f.client.commit(ticket);
    await finish(f);
  });
  test('a pending preview read excludes every other ordinary request', async () => {
    const f = fixture(),
      ticket = await ready(f);
    let held: Wire | undefined;
    f.intercept((m, side) => {
      if (side === 1 && m.kind === 'query-preview') {
        held = m;
        return null;
      }
      return m;
    });
    const pending = f.client.queryPreview(ticket, [fit]);
    await flush();
    expect(() => f.client.queryPreview(ticket, [fit])).toThrow(/idle/);
    expect(() => f.client.query([fit])).toThrow(/idle/);
    expect(() => f.client.request({}, 0)).toThrow(/in flight/);
    expect(() => f.client.commit(ticket)).toThrow(/idle/);
    expect(() => f.client.restore(f.client.snapshot())).toThrow(/idle/);
    f.deliver(held!);
    await pending;
    await finish(f);
  });
  test('cancel during a read rejects its late result and drains cancellation in either reply order', async () => {
    for (const cancelFirst of [false, true]) {
      const f = fixture(),
        ticket = await ready(f),
        held = new Map<string, Wire>();
      f.intercept((m, side) => {
        if (side === 1 && ['query-preview', 'cancel'].includes(m.kind)) {
          held.set(m.kind, m);
          return null;
        }
        return m;
      });
      const rejected = expect(f.client.queryPreview(ticket, [fit])).rejects.toThrow(
        /no longer current/,
      );
      await flush();
      ticket.cancel();
      await flush();
      for (const kind of cancelFirst ? ['cancel', 'query-preview'] : ['query-preview', 'cancel'])
        f.deliver(held.get(kind)!);
      await rejected;
      expect(f.client.state).toMatchObject({
        status: 'ready',
        readyId: null,
        activeId: null,
        uncertain: false,
      });
      expect(f.latest().status).toBe('discarded');
      await finish(f);
    }
  });
  test('close invalidates a pending preview read while waiting for its drain before disposal', async () => {
    const f = fixture(),
      ticket = await ready(f);
    let held: Wire | undefined;
    f.intercept((m, side) => {
      if (side === 1 && m.kind === 'query-preview') {
        held = m;
        return null;
      }
      return m;
    });
    const rejected = expect(f.client.queryPreview(ticket, [fit])).rejects.toThrow(
      /no longer current/,
    );
    await flush();
    const closing = f.client.close();
    expect(f.closed[0]).toBe(false);
    f.deliver(held!);
    await rejected;
    await closing;
    expect(f.closed[0]).toBe(true);
    expect(() => f.client.queryPreview(ticket, [fit])).toThrow(/closed/);
    await f.host.close();
  });
  test('read timeout closes the connection without uncertain mutation retry or owned driver leaks', async () => {
    vi.useFakeTimers();
    const f = fixture({ timeout: 30 }),
      ticket = await ready(f, 1),
      before = f.client.snapshot();
    f.intercept((m, side) => (side === 1 && m.kind === 'query-preview' ? null : m));
    const failed = expect(f.client.queryPreview(ticket, [fit])).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(31);
    await failed;
    expect(f.client.state).toMatchObject({ status: 'failed', readyId: null, uncertain: false });
    expect(f.client.snapshot()).toEqual(before);
    expect(f.sent[0].filter((m) => m.kind === 'query-preview')).toHaveLength(1);
    expect(f.cleaned.mock.calls.length).toBe(f.made.mock.calls.length);
    await finish(f);
  });
  test('batch target base branch and operation must match the private ready identity', async () => {
    for (const change of [
      (r: TacticalWorkerPreviewQueryBatch3D) => {
        r.target++;
      },
      (r: TacticalWorkerPreviewQueryBatch3D) => {
        r.preview.base = { ...r.preview.base, revision: 99 };
      },
      (r: TacticalWorkerPreviewQueryBatch3D) => {
        r.preview.branchId++;
      },
      (r: TacticalWorkerPreviewQueryBatch3D) => {
        r.preview.operation++;
      },
    ]) {
      const f = fixture(),
        ticket = await ready(f);
      rewrite(f, change);
      await expect(f.client.queryPreview(ticket, [fit])).rejects.toThrow(/identity|boundary/);
      expect(f.client.state.uncertain).toBe(false);
      await finish(f);
    }
  });
  test('horizon completed ticks and absolute tick cannot change in a read reply', async () => {
    for (const key of ['horizonTicks', 'completedTicks', 'tick'] as const) {
      const f = fixture(),
        ticket = await ready(f, 1);
      rewrite(f, (r) => {
        if (key !== 'tick') r.preview[key]++;
        else r.results[0].value.stamp = { ...r.results[0].value.stamp, tick: 99 };
      });
      await expect(f.client.queryPreview(ticket, [fit])).rejects.toThrow(/boundary|stamp/);
      await finish(f);
    }
  });
  test('every result retains preview identity and cannot impersonate a committed or different-domain result', async () => {
    for (const key of ['kind', 'branch', 'domain', 'order']) {
      const f = fixture(),
        ticket = await ready(f);
      rewrite(f, (r) => {
        const stamp = r.results[0].value.stamp;
        if (key === 'kind')
          r.results[0].value.stamp = {
            rulesVersion: stamp.rulesVersion,
            domain: null,
            tick: 0,
            kind: 'committed',
            revision: f.session.revision,
          };
        else if (key === 'branch' && stamp.kind === 'preview')
          r.results[0].value.stamp = { ...stamp, branchId: stamp.branchId + 1 };
        else if (key === 'domain') r.results[0].domain = 'flask';
        else r.results.reverse();
      });
      await expect(f.client.queryPreview(ticket, all)).rejects.toThrow();
      expect(f.client.state.status).toBe('failed');
      await finish(f);
    }
  });
  test('cell corruption is checked against private preview data despite caller edits to ready output', async () => {
    const f = fixture(),
      ticket = await ready(f),
      outcome = await ticket.result;
    if (outcome.status !== 'ready') throw Error('Ready required');
    outcome.preview.terrain.energyQ[22] = 0;
    rewrite(f, (r) => {
      const a = r.results[0];
      if (a.kind === 'fit') a.value.blocker!.energyQ = 0;
    });
    await expect(f.client.queryPreview(ticket, [fit])).rejects.toThrow(/queried terrain/);
    expect(f.client.state.uncertain).toBe(false);
    await finish(f);
  });
  test('wrong request targets and base revisions reject without executing a geometry view', async () => {
    for (const target of [true, false]) {
      const f = fixture(),
        ticket = await ready(f);
      f.intercept((m, side) => {
        if (side === 0 && m.kind === 'query-preview') {
          const p = m.payload as { target: number; base: { revision: number } };
          if (target) p.target++;
          else p.base.revision++;
        }
        return m;
      });
      await expect(f.client.queryPreview(ticket, [fit])).rejects.toThrow(/Stale/);
      expect(f.views).not.toHaveBeenCalled();
      expect(f.client.state.readyId).toBe(ticket.id);
      await finish(f);
    }
  });
  test('obsolete protocol replies cannot be accepted as current preview geometry', async () => {
    const f = fixture(),
      ticket = await ready(f);
    f.intercept((m, side) =>
      side === 1 && m.kind === 'query-preview'
        ? ({ ...m, protocol: 'tactical-worker-5' } as unknown as Wire)
        : m,
    );
    await expect(f.client.queryPreview(ticket, [fit])).rejects.toThrow(/Incompatible/);
    expect(f.client.state.status).toBe('failed');
    await finish(f);
  });
  test('transport send failures release candidate access and keep the committed snapshot exact', async () => {
    const f = fixture(),
      ticket = await ready(f),
      before = f.client.snapshot();
    f.intercept((m, side) => {
      if (side === 0 && m.kind === 'query-preview') throw Error('send failed');
      return m;
    });
    await expect(f.client.queryPreview(ticket, [fit])).rejects.toThrow(/send failed/);
    expect(f.client.state).toMatchObject({ status: 'failed', readyId: null, uncertain: false });
    expect(f.client.snapshot()).toEqual(before);
    expect(f.session.snapshot()).toEqual(before);
    await finish(f);
    expect(f.latest().status).toBe('discarded');
  });
  test('invalid preview identity is rejected before exposing a ready candidate', async () => {
    const f = fixture();
    await f.client.ready;
    f.intercept((m, side) => {
      if (side === 1 && m.kind === 'preview') {
        const p = m.payload as { preview: { preview: { branchId: number } } };
        p.preview.preview.branchId = 0;
      }
      return m;
    });
    const t: TacticalPreviewTicket3D<Game> = f.client.request({}, 0);
    expect((await t.result).status).toBe('failed');
    expect(() => f.client.queryPreview(t, [fit])).toThrow();
    await finish(f);
  });
});
