import { createMicrotaskTransport } from '../../test-support/microtask-transport.js';
import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Worker geometry contract over structured-clone mocks; no real physics or Worker. */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MAT } from '../3d.js';
import { CpuStructuralWorld3D } from '../structural-world-core.js';
import { createTacticalSessionCore3D } from './tactical-session-core.js';
import { createTacticalWorkerHost3D } from './tactical-worker-host.js';
import { createTacticalWorkerClient3D } from './tactical-worker-client.js';
import {
  TACTICAL_QUERY_BATCH_RULES_3D,
  type TacticalWorkerQuery3D,
  type TacticalWorkerQueryBatch3D,
} from './tactical-worker-queries.js';
import type { Wire } from './tactical-worker-wire.js';
import type { GeometryCell3D } from '../gameplay-geometry.js';

holdPhysics(...STRUCTURAL_CALLS);
afterEach(() => vi.useRealTimers());
const body = { minQ: [1024, 0, 1024], maxQ: [2048, 1024, 2048] } as const;
const solid = { minQ: [1024, 1024, 1024], maxQ: [2048, 2048, 2048] } as const;
const fit: TacticalWorkerQuery3D = { kind: 'fit', request: { box: solid } };
const all: TacticalWorkerQuery3D[] = [
  fit,
  { kind: 'support', request: { box: body, maxDropQ: 2048 } },
  { kind: 'raycast', request: { fromQ: [512, 1536, 1536], toQ: [3584, 1536, 1536] } },
  { kind: 'sweep', request: { box: body, deltaQ: [0, 2048, 0] } },
  { kind: 'exposure', request: { box: { minQ: [0, 0, 0], maxQ: [4096, 4096, 4096] } } },
];
function fixture(options: { timeoutMs?: number; oversized?: boolean } = {}) {
  const world = new CpuStructuralWorld3D({ width: 4, height: 4, depth: 4, chunkSize: 4 });
  world.setCell(1, 1, 1, MAT.STONE, 160);
  world.setIntegrity(1, 1, 1, 73);
  world.setCell(2, 2, 2, MAT.WATER, 40);
  const flask = new CpuStructuralWorld3D({ width: 4, height: 4, depth: 4, chunkSize: 4 });
  flask.setCell(1, 1, 1, MAT.ICE, 5);
  const session = createTacticalSessionCore3D(
    {
      worldId: 'query-world',
      gameRulesVersion: 'query-game',
      terrain: world.snapshot(),
      reservoirs: [{ id: 'flask', terrain: flask.snapshot() }],
      game: { ap: 2 },
    },
    () => {
      throw Error('No driver may be created by these queries.');
    },
  );
  const queries = vi.fn((opts?: Parameters<typeof session.queries>[0]) => {
    const view = session.queries(opts);
    if (!options.oversized) return view;
    return {
      ...view,
      support: (request: Parameters<typeof view.support>[0]) => {
        const result = view.support(request);
        return { ...result, surfaces: Array.from({ length: 6000 }, () => result.surfaces[0]) };
      },
    };
  });
  const { ports, sent, closed, setRewrite: intercept, deliver } = createMicrotaskTransport<Wire>();
  const host = createTacticalWorkerHost3D(
    ports[1],
    {
      ...session,
      get revision() {
        return session.revision;
      },
      queries,
    },
    (editor, command: { ap: number }) => editor.setGame(command),
    'query-channel',
  );
  const client = createTacticalWorkerClient3D<{ ap: number }, { ap: number }>(ports[0], {
    channel: 'query-channel',
    worldId: 'query-world',
    gameRulesVersion: 'query-game',
    timeoutMs: options.timeoutMs,
  });
  return { client, host, session, queries, sent, closed, intercept, deliver };
}
async function finish(f: ReturnType<typeof fixture>) {
  if (f.client.state.status !== 'failed') await f.client.close();
  await f.host.close();
}
function direct(f: ReturnType<typeof fixture>, item: TacticalWorkerQuery3D) {
  const view = f.session.queries({ domain: item.domain ?? null });
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
describe('committed worker geometry batches without physical runtime', () => {
  test('all five query operations match direct fixed-point primary and reservoir reads', async () => {
    const f = fixture();
    await f.client.ready;
    const before = f.client.snapshot();
    const requests = [...all, ...all.map((q) => ({ ...q, domain: 'flask' }))];
    const result = await f.client.query(requests);
    expect(result).toEqual({
      rulesVersion: TACTICAL_QUERY_BATCH_RULES_3D,
      base: f.session.revision,
      results: requests.map((q) => ({
        kind: q.kind,
        domain: q.domain ?? null,
        value: direct(f, q),
      })),
    });
    expect(f.client.snapshot()).toEqual(before);
    expect(f.session.snapshot()).toEqual(before);
    await finish(f);
  });
  test('hand-checkable contact retains exact time, hot-cell energy and damaged integrity', async () => {
    const f = fixture();
    await f.client.ready;
    const r = (await f.client.query([all[2]])).results[0];
    if (r.kind !== 'raycast') throw Error('Expected ray');
    expect(r.value.contact).toMatchObject({
      time: { numerator: 1, denominator: 6 },
      cell: { coordinate: [1, 1, 1], material: MAT.STONE, structure: 73 },
    });
    expect(r.value.contact!.cell!.energyQ).toBe(f.session.snapshot().terrain.energyQ[21]);
    await finish(f);
  });
  test('one batch reuses one isolated geometry view per domain and one wire request', async () => {
    const f = fixture();
    await f.client.ready;
    await f.client.query([...all, ...all.map((q) => ({ ...q, domain: 'flask' }))]);
    expect(f.queries).toHaveBeenCalledTimes(2);
    expect(f.sent[0].filter((m) => m.kind === 'query')).toHaveLength(1);
    await finish(f);
  });
  test('copied requests and returned results cannot mutate committed state', async () => {
    const f = fixture();
    await f.client.ready;
    const before = f.client.snapshot(),
      request = structuredClone(fit);
    const pending = f.client.query([request]);
    request.domain = 'flask';
    const result = await pending;
    expect(result.results[0].domain).toBe(null);
    result.base = { ...result.base, revision: 99 };
    const value = result.results[0];
    if (value.kind === 'fit' && value.value.blocker) value.value.blocker.structure = 0;
    expect(f.client.snapshot()).toEqual(before);
    expect(f.session.snapshot()).toEqual(before);
    await finish(f);
  });
  test('the inclusive 32-query limit succeeds without truncation', async () => {
    const f = fixture();
    await f.client.ready;
    expect((await f.client.query(Array.from({ length: 32 }, () => fit))).results).toHaveLength(32);
    await finish(f);
  });
  test('empty, oversized, sparse and getter-bearing batches reject without sending', async () => {
    const f = fixture();
    await f.client.ready;
    const getter = vi.fn(),
      cases: unknown[] = [
        [],
        Array(33).fill(fit),
        Array(1),
        [Object.defineProperty({ kind: 'fit' }, 'request', { get: getter, enumerable: true })],
      ];
    for (const value of cases)
      expect(() => f.client.query(value as TacticalWorkerQuery3D[])).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(f.sent[0].filter((m) => m.kind === 'query')).toHaveLength(0);
    await finish(f);
  });
  test('unknown domains, extra fields and unknown kinds reject before dispatch', async () => {
    const f = fixture();
    await f.client.ready;
    for (const value of [
      { ...fit, domain: 'missing' },
      { ...fit, extra: 1 },
      { ...fit, kind: 'solveStructure' },
    ])
      expect(() => f.client.query([value] as TacticalWorkerQuery3D[])).toThrow();
    expect(f.sent[0].filter((m) => m.kind === 'query')).toHaveLength(0);
    await finish(f);
  });
  test('invalid geometry rejects the entire read batch but preserves a ready commit', async () => {
    const f = fixture();
    await f.client.ready;
    const before = f.client.snapshot(),
      ticket = f.client.request({ ap: 1 }, 0);
    await ticket.result;
    await expect(
      f.client.query([fit, { kind: 'support', request: { box: body, maxDropQ: -1 } }]),
    ).rejects.toThrow(/distance/);
    expect(f.client.snapshot()).toEqual(before);
    expect(f.client.state).toMatchObject({ status: 'ready', readyId: ticket.id, uncertain: false });
    expect((await f.client.commit(ticket)).snapshot.game.ap).toBe(1);
    await finish(f);
  });
  test('successful queries keep an existing ready candidate committable', async () => {
    const f = fixture();
    await f.client.ready;
    const ticket = f.client.request({ ap: 0 }, 0);
    await ticket.result;
    await f.client.query(all);
    expect(f.client.state.readyId).toBe(ticket.id);
    expect((await f.client.commit(ticket)).snapshot.game.ap).toBe(0);
    await finish(f);
  });
  test('stale committed bases reject without silently rebasing or changing client state', async () => {
    const f = fixture();
    await f.client.ready;
    const before = f.client.snapshot();
    f.session.restore(f.session.snapshot());
    const changed = f.session.snapshot();
    await expect(f.client.query([fit])).rejects.toThrow(/Stale/);
    expect(f.queries).not.toHaveBeenCalled();
    expect(f.client.snapshot()).toEqual(before);
    expect(f.session.snapshot()).toEqual(changed);
    expect(f.client.state.uncertain).toBe(false);
    await finish(f);
  });
  test('pending queries exclude another query, preview, commit and restore', async () => {
    const f = fixture();
    await f.client.ready;
    const ticket = f.client.request({ ap: 1 }, 0);
    await ticket.result;
    let held: Wire | undefined;
    f.intercept((m, side) => {
      if (side === 1 && m.kind === 'query') {
        held = m;
        return null;
      }
      return m;
    });
    const pending = f.client.query([fit]);
    await Promise.resolve();
    await Promise.resolve();
    expect(() => f.client.query([fit])).toThrow(/idle/);
    expect(() => f.client.request({ ap: 0 }, 0)).toThrow(/in flight/);
    expect(() => f.client.commit(ticket)).toThrow(/idle/);
    expect(() => f.client.restore(f.client.snapshot())).toThrow(/idle/);
    f.deliver(0, held!);
    await pending;
    await f.client.commit(ticket);
    await finish(f);
  });
  test('queries cannot overlap an executing preview request', async () => {
    const f = fixture();
    await f.client.ready;
    const ticket = f.client.request({ ap: 1 }, 0);
    expect(() => f.client.query([fit])).toThrow(/idle/);
    await ticket.result;
    await finish(f);
  });
  test('close waits for a read reply before disposing the owned endpoint', async () => {
    const f = fixture();
    await f.client.ready;
    const pending = f.client.query([fit]),
      closing = f.client.close();
    expect(f.closed[0]).toBe(false);
    await pending;
    await closing;
    expect(f.closed[0]).toBe(true);
    await f.host.close();
  });
  test('read timeout is a failed connection with no uncertain mutation or retry', async () => {
    vi.useFakeTimers();
    const f = fixture({ timeoutMs: 30 });
    await f.client.ready;
    const before = f.client.snapshot();
    f.intercept((m, side) => (side === 1 && m.kind === 'query' ? null : m));
    const failed = expect(f.client.query([fit])).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(31);
    await failed;
    expect(f.client.state).toMatchObject({ status: 'failed', uncertain: false });
    expect(f.client.snapshot()).toEqual(before);
    expect(f.session.snapshot()).toEqual(before);
    expect(f.sent[0].filter((m) => m.kind === 'query')).toHaveLength(1);
    await finish(f);
  });
  test('reply count, kind, domain and revision corruption fail closed', async () => {
    const changes: ((r: TacticalWorkerQueryBatch3D) => void)[] = [
      (r) => {
        r.results.pop();
      },
      (r) => {
        r.base = { ...r.base, revision: 99 };
      },
      (r) => {
        r.results[0].domain = 'flask';
      },
      (r) => {
        r.results.reverse();
      },
      (r) => {
        r.results[0].value.stamp = { ...r.results[0].value.stamp, tick: 9 };
      },
    ];
    for (const change of changes) {
      const f = fixture();
      await f.client.ready;
      const before = f.client.snapshot();
      f.intercept((m, side) => {
        if (side === 1 && m.kind === 'query') change(m.payload as TacticalWorkerQueryBatch3D);
        return m;
      });
      await expect(f.client.query(all)).rejects.toThrow();
      expect(f.client.state).toMatchObject({ status: 'failed', uncertain: false });
      expect(f.client.snapshot()).toEqual(before);
      await finish(f);
    }
  });
  test('cell data in a reply must match the confirmed terrain coordinates', async () => {
    const f = fixture();
    await f.client.ready;
    const before = f.client.snapshot();
    f.intercept((m, side) => {
      if (side === 1 && m.kind === 'query') {
        const r = (m.payload as TacticalWorkerQueryBatch3D).results[0];
        if (r.kind === 'fit') (r.value.blocker as GeometryCell3D).energyQ++;
      }
      return m;
    });
    await expect(f.client.query([fit])).rejects.toThrow(/queried terrain/);
    expect(f.client.snapshot()).toEqual(before);
    await finish(f);
  });
  test('exposure volume and temperature fractions are validated before publication', async () => {
    for (const target of ['volume', 'temperature']) {
      const f = fixture();
      await f.client.ready;
      f.intercept((m, side) => {
        if (side === 1 && m.kind === 'query') {
          const r = (m.payload as TacticalWorkerQueryBatch3D).results[0];
          if (r.kind === 'exposure') {
            if (target === 'volume') r.value.volumeQ3 = '0';
            else r.value.materials[0].meanTemperatureQ.denominator = '0';
          }
        }
        return m;
      });
      await expect(f.client.query([all[4]])).rejects.toThrow();
      expect(f.client.state.uncertain).toBe(false);
      await finish(f);
    }
  });
  test('oversized portable responses reject without sending a partial query result', async () => {
    const f = fixture({ oversized: true });
    await f.client.ready;
    const before = f.client.snapshot();
    await expect(f.client.query([all[1]])).rejects.toThrow(/budget/);
    expect(f.client.state.status).toBe('ready');
    expect(f.sent[1].filter((m) => m.kind === 'query')).toHaveLength(0);
    expect(f.client.snapshot()).toEqual(before);
    await finish(f);
  });
  test('the old worker protocol cannot be mistaken for a current reply', async () => {
    const f = fixture();
    await f.client.ready;
    f.intercept((m, side) =>
      side === 1 && m.kind === 'query'
        ? ({ ...m, protocol: 'tactical-worker-1' } as unknown as Wire)
        : m,
    );
    await expect(f.client.query([fit])).rejects.toThrow(/Incompatible/);
    expect(f.client.state.status).toBe('failed');
    await finish(f);
  });
  test('queries after an acknowledged commit use the new complete revision', async () => {
    const f = fixture();
    await f.client.ready;
    const ticket = f.client.request({ ap: 1 }, 0);
    await ticket.result;
    const committed = await f.client.commit(ticket);
    const result = await f.client.query(all);
    expect(result.base.revision).toBe(committed.snapshot.revision);
    expect(
      result.results.every(
        (r) =>
          r.value.stamp.kind === 'committed' &&
          r.value.stamp.revision.revision === result.base.revision,
      ),
    ).toBe(true);
    await finish(f);
  });
});
