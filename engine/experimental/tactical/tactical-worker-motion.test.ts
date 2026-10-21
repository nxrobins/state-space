import { createMicrotaskTransport } from '../../test-support/microtask-transport.js';
import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Clone-isolated worker transport with bounded synthetic execution history. */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MAT } from '../3d.js';

import { type StructuralSnapshot3D } from '../structural-world-core.js';
import {
  createTacticalSessionCore3D,
  type TacticalSimulationFactory3D,
} from './tactical-session-core.js';
import type { TacticalCommit3D, TacticalSessionPolicy3D } from './tactical-session-view.js';
import { createTacticalWorkerClient3D } from './tactical-worker-client.js';
import { createTacticalWorkerHost3D } from './tactical-worker-host.js';
import type { Wire } from './tactical-worker-wire.js';
import type { TacticalPreviewCapture3D } from './tactical-preview-capture.js';
import { motionJournalData } from './tactical-worker-motion.js';
import { readMotionTraceDomain3D, type MotionJournal3D } from '../motion-trace.js';
import { seed, observe, index, type Spec } from '../terrain/terrain-motion.fixtures.js';

holdPhysics('solveStructure3D', ...STRUCTURAL_CALLS);
afterEach(() => vi.useRealTimers());
type Game = { ap: number };
function fixture(
  options: {
    spec?: Spec;
    terrain?: StructuralSnapshot3D;
    reservoir?: boolean;
    timeout?: number;
    netOverflow?: boolean;
    beforeStep?: () => Promise<void>;
    policy?: TacticalSessionPolicy3D<Game>;
  } = {},
) {
  const { ports, sent, closed, setRewrite: intercept, deliver } = createMicrotaskTransport<Wire>();
  let failRead = false;
  const made = vi.fn(),
    cleaned = vi.fn(),
    read = vi.fn();
  const factory: TacticalSimulationFactory3D = (
    initial,
    domain,
    motion,
    motionLimit,
    paths,
    pathLimit,
  ) => {
    made({ domain, motion, motionLimit, paths, pathLimit });
    let state = structuredClone(initial),
      result: ReturnType<typeof observe>;
    return {
      load(s) {
        state = structuredClone(s);
      },
      async step() {
        await options.beforeStep?.();
        result = observe(state, options.spec);
        state = structuredClone(result.after);
      },
      snapshot: () => state,
      motion: () =>
        options.netOverflow
          ? {
              ...result.motion,
              status: 'overflow',
              requiresReexecution: true,
              moves: [],
              touched: [],
              fragments: [],
            }
          : result.motion,
      paths: () => result.paths,
      close() {
        cleaned(domain);
      },
    };
  };
  const terrain = options.terrain ?? seed([[1, 0, 1, MAT.SAND]]),
    reservoir = seed();
  reservoir.tick = terrain.tick;
  const session = createTacticalSessionCore3D(
    {
      worldId: 'motion-world',
      gameRulesVersion: 'motion-game',
      terrain,
      game: { ap: 2 },
      reservoirs: options.reservoir ? [{ id: 'flask', terrain: reservoir }] : [],
    },
    factory,
    options.policy,
    async () => {},
    (s) => ({
      distances: new Int32Array(s.packedCells.length).fill(-1),
      loads: new Uint32Array(s.packedCells.length),
      capacities: new Uint32Array(s.packedCells.length),
      reactions: new Uint32Array(s.packedCells.length),
    }),
  );
  let latest: TacticalCommit3D<Game>;
  const host = createTacticalWorkerHost3D(
    ports[1],
    {
      ...session,
      get revision() {
        return session.revision;
      },
      commit(branch) {
        latest = session.commit(branch);
        return {
          ...latest,
          motion() {
            read();
            if (failRead) throw Error('fixture report unavailable');
            return latest.motion();
          },
        };
      },
    },
    (e, c: Game) => {
      e.setGame(c);
    },
    'motion-channel',
  );
  const client = createTacticalWorkerClient3D<Game, Game>(ports[0], {
    channel: 'motion-channel',
    worldId: 'motion-world',
    gameRulesVersion: 'motion-game',
    timeoutMs: options.timeout,
  });
  return {
    session,
    host,
    client,
    read,
    made,
    cleaned,
    sent,
    closed,
    latest: () => latest,
    intercept,
    deliver: (m: Wire) => deliver(0, m),
    failRead: (v: boolean) => {
      failRead = v;
    },
  };
}
async function commit(
  f: ReturnType<typeof fixture>,
  horizon = 1,
  capture: TacticalPreviewCapture3D = { motion: {} },
) {
  const t = f.client.request({ ap: 1 }, horizon, capture);
  expect((await t.result).status).toBe('ready');
  return f.client.commit(t);
}
async function finish(f: ReturnType<typeof fixture>) {
  if (f.client.state.status !== 'failed') await f.client.close();
  await f.host.close();
}

describe('worker captured motion reports', () => {
  test('default capture stays disabled and requested zero-tick capture is complete and empty', async () => {
    const f = fixture();
    await f.client.ready;
    const disabled = await commit(f, 1, {});
    expect(f.read).not.toHaveBeenCalled();
    expect(await f.client.motion(disabled)).toMatchObject({
      status: 'disabled',
      requiresReexecution: true,
      frames: [],
    });
    const empty = await commit(f, 0);
    expect(await f.client.motion(empty)).toMatchObject({
      status: 'complete',
      requiresReexecution: false,
      recordsObserved: 0,
      frames: [],
    });
    await finish(f);
  });
  test('all domain and operation records match the direct commit across an odd-start batch boundary', async () => {
    const terrain = seed();
    terrain.tick = 1;
    const f = fixture({ terrain, reservoir: true });
    await f.client.ready;
    const c = await commit(f, 33, {
        motion: { maxEntries: 17 },
        paths: { maxEntries: 19 },
        journal: { maxRuns: 0 },
      }),
      direct = f.latest().motion();
    expect(f.read).not.toHaveBeenCalled();
    const report = await f.client.motion(c);
    expect(report).toEqual(direct);
    expect(
      report.frames.slice(-4).map((r) => [r.domain, r.operation, r.trace.fromTick, r.trace.toTick]),
    ).toEqual([
      [null, 2, 32, 33],
      ['flask', 2, 32, 33],
      [null, 3, 33, 34],
      ['flask', 3, 33, 34],
    ]);
    expect(report.frames).toHaveLength(66);
    expect(f.made.mock.calls.every((c) => c[0].motionLimit === 17 && c[0].pathLimit === 19)).toBe(
      true,
    );
    expect(c.snapshot).toEqual(f.session.snapshot());
    expect(f.cleaned).toHaveBeenCalledTimes(4);
    await finish(f);
  });
  test('touched identities retain out-and-back motion without inventing net moves or paths', async () => {
    const a = index(1, 0, 1),
      f = fixture({
        spec: {
          swaps: new Map([
            [1, [[a, a + 4]]],
            [15, [[a, a + 4]]],
          ]),
        },
      });
    await f.client.ready;
    const c = await commit(f),
      r = await f.client.motion(c);
    expect(r).toEqual(f.latest().motion());
    expect(r.frames[0].trace).toMatchObject({
      movedCells: 0,
      touchedCells: 2,
      moves: [],
      touched: [
        [a, 1],
        [a + 4, 1],
      ],
    });
    expect(r.includesInterventions).toBe(false);
    expect(r.includesSubpassPaths).toBe(false);
    await finish(f);
  });
  test('captured structural fragments keep source membership and one-cell descent', async () => {
    const a = index(1, 2, 1),
      f = fixture({ terrain: seed([[1, 2, 1, MAT.STONE]]), spec: { falls: [[a]] } });
    await f.client.ready;
    const c = await commit(f),
      r = await f.client.motion(c);
    expect(r).toEqual(f.latest().motion());
    expect(r.frames[0].trace.fragments).toEqual([{ id: a, cells: 1, sourceRuns: [[a, 1]] }]);
    await finish(f);
  });
  test('per-tick and record overflow retain accounting without an apparently complete prefix', async () => {
    const f = fixture();
    await f.client.ready;
    const c = await commit(f, 257),
      r = await f.client.motion(c);
    expect(r).toEqual(f.latest().motion());
    expect(r).toMatchObject({
      status: 'overflow',
      recordsObserved: 257,
      entries: 0,
      frames: [],
      requiresReexecution: true,
    });
    await finish(f);
    const a = index(1, 0, 1),
      g = fixture({ netOverflow: true, spec: { swaps: new Map([[1, [[a, a + 4]]]]) } });
    await g.client.ready;
    const short = await commit(g, 1, { motion: { maxEntries: 0 } });
    expect(await g.client.motion(short)).toMatchObject({
      status: 'overflow',
      recordsObserved: 1,
      entries: 0,
      frames: [],
      requiresReexecution: true,
    });
    await finish(g);
  });
  test('required session paths still enable motion when request capture is omitted', async () => {
    const reduceTick: NonNullable<TacticalSessionPolicy3D<Game>['reduceTick']> = ({
      game,
      movement,
    }) => {
      expect(movement().status).toBe('complete');
      return game;
    };
    const f = fixture({ policy: { requiresPaths: true, reduceTick } });
    await f.client.ready;
    const c = await commit(f, 1, {});
    expect(await f.client.motion(c)).toEqual(f.latest().motion());
    expect(f.made.mock.calls[0][0]).toMatchObject({ motion: true, paths: true });
    await finish(f);
  });
  test('input capture options are detached and invalid replacements do not revoke a ready ticket', async () => {
    const f = fixture();
    await f.client.ready;
    const capture = { motion: { maxEntries: 7 }, paths: { maxEntries: 9 } };
    const t = f.client.request({ ap: 1 }, 1, capture);
    capture.motion.maxEntries = -1;
    capture.paths.maxEntries = -1;
    await t.result;
    const getter = vi.fn(),
      accessor = Object.defineProperty({}, 'motion', { get: getter, enumerable: true });
    for (const invalid of [
      accessor,
      null,
      { motion: false },
      { paths: { maxEntries: -1 } },
      { journal: { maxRuns: 4097 } },
    ])
      expect(() => f.client.request({ ap: 0 }, 1, invalid as never)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(f.client.state.readyId).toBe(t.id);
    const c = await f.client.commit(t);
    expect(await f.client.motion(c)).toEqual(f.latest().motion());
    expect(f.made.mock.calls[0][0]).toMatchObject({ motionLimit: 7, pathLimit: 9 });
    await finish(f);
  });
  test('absolute tick overflow cannot replace accepted preview work', async () => {
    const terrain = seed();
    terrain.tick = Number.MAX_SAFE_INTEGER;
    const f = fixture({ terrain });
    await f.client.ready;
    const t = f.client.request({ ap: 1 }, 0);
    await t.result;
    expect(() => f.client.request({ ap: 0 }, 1)).toThrow(/end tick/);
    expect(f.client.state.readyId).toBe(t.id);
    await finish(f);
  });
  test('public snapshot receipt and report mutation cannot alter retained commit provenance', async () => {
    const a = index(1, 2, 1),
      f = fixture({ terrain: seed([[1, 2, 1, MAT.STONE]]), spec: { falls: [[a]] } });
    await f.client.ready;
    const c = await commit(f),
      expected = f.latest().motion(),
      before = f.client.snapshot();
    c.receipt.base = { ...c.receipt.base, revision: 99 };
    c.snapshot.terrain.energyQ.fill(0);
    c.receipt.endTick = 999;
    const r = await f.client.motion(c);
    r.frames[0].trace.fragments[0].sourceRuns[0][0] = 0;
    r.frames[0].trace.moves.length = 0;
    expect(await f.client.motion(c)).toEqual(expected);
    expect(f.client.snapshot()).toEqual(before);
    expect(f.session.snapshot()).toEqual(before);
    await finish(f);
  });
  test('copied foreign superseded and restored commit handles cannot authorize reads', async () => {
    const f = fixture(),
      other = fixture();
    await f.client.ready;
    await other.client.ready;
    const old = await commit(f, 0);
    expect(() => other.client.motion(old)).toThrow(/latest/);
    expect(() => f.client.motion({ ...old })).toThrow(/latest/);
    const latest = await commit(f, 0);
    expect(() => f.client.motion(old)).toThrow(/latest/);
    await f.client.restore(latest.snapshot);
    expect(() => f.client.motion(latest)).toThrow(/latest/);
    await finish(f);
    await finish(other);
  });
  test('ordinary observation failures keep the acknowledged commit and ready preview usable', async () => {
    const f = fixture();
    await f.client.ready;
    const c = await commit(f, 0),
      before = f.client.snapshot();
    const next = f.client.request({ ap: 0 }, 0);
    await next.result;
    f.failRead(true);
    await expect(f.client.motion(c)).rejects.toThrow(/unavailable/);
    expect(f.client.state).toMatchObject({ status: 'ready', uncertain: false, readyId: next.id });
    expect(f.client.snapshot()).toEqual(before);
    f.failRead(false);
    expect(await f.client.motion(c)).toEqual(f.latest().motion());
    expect((await f.client.commit(next)).snapshot.game.ap).toBe(0);
    await finish(f);
  });
  test('external revision changes reject reads without pretending cached state advanced', async () => {
    const f = fixture();
    await f.client.ready;
    const c = await commit(f, 0),
      before = f.client.snapshot();
    f.session.restore(f.session.snapshot());
    await expect(f.client.motion(c)).rejects.toThrow(/Stale/);
    expect(f.client.snapshot()).toEqual(before);
    expect(f.client.state.uncertain).toBe(false);
    await finish(f);
  });
  test('one pending motion request excludes other reads previews commits and restores', async () => {
    const f = fixture();
    await f.client.ready;
    const c = await commit(f, 0),
      t = f.client.request({ ap: 0 }, 0);
    await t.result;
    let held: Wire | undefined;
    f.intercept((m, side) => {
      if (side === 1 && m.kind === 'motion') {
        held = m;
        return null;
      }
      return m;
    });
    const pending = f.client.motion(c);
    await Promise.resolve();
    await Promise.resolve();
    expect(() => f.client.motion(c)).toThrow(/idle/);
    expect(() => f.client.changes(c)).toThrow(/idle/);
    expect(() => f.client.commit(t)).toThrow(/idle/);
    expect(() => f.client.request({ ap: 0 }, 0)).toThrow(/in flight/);
    expect(() => f.client.restore(c.snapshot)).toThrow(/idle/);
    f.deliver(held!);
    await pending;
    expect(f.client.state.readyId).toBe(t.id);
    await finish(f);
  });
  test('timeout does not retry or mark an already acknowledged mutation uncertain', async () => {
    vi.useFakeTimers();
    const f = fixture({ timeout: 30 });
    await f.client.ready;
    const c = await commit(f, 0),
      before = f.client.snapshot();
    f.intercept((m, side) => (side === 1 && m.kind === 'motion' ? null : m));
    const pending = expect(f.client.motion(c)).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(31);
    await pending;
    expect(f.client.state).toMatchObject({ status: 'failed', uncertain: false });
    expect(f.client.snapshot()).toEqual(before);
    expect(f.sent[0].filter((m) => m.kind === 'motion')).toHaveLength(1);
    await finish(f);
  });
  test('close waits for a pending motion read and then revokes the handle', async () => {
    const f = fixture();
    await f.client.ready;
    const c = await commit(f, 0),
      pending = f.client.motion(c),
      close = f.client.close();
    expect(f.closed[0]).toBe(false);
    await pending;
    await close;
    expect(f.closed[0]).toBe(true);
    expect(() => f.client.motion(c)).toThrow(/closed/);
    await f.host.close();
  });
  test('supersession waits for inert cancellation and retains only the accepted action motion', async () => {
    let release!: () => void,
      entered!: () => void,
      first = true;
    const start = new Promise<void>((r) => {
        entered = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    const f = fixture({
      beforeStep: async () => {
        if (first) {
          first = false;
          entered();
          await gate;
        }
      },
    });
    await f.client.ready;
    const old = f.client.request({ ap: 0 }, 3, { motion: {} });
    await start;
    const next = f.client.request({ ap: 1 }, 1, { motion: { maxEntries: 0 } });
    release();
    expect((await old.result).status).toBe('superseded');
    expect((await next.result).status).toBe('ready');
    const c = await f.client.commit(next);
    expect(await f.client.motion(c)).toEqual(f.latest().motion());
    expect(f.cleaned).toHaveBeenCalledTimes(2);
    await finish(f);
  });
  test('wrong identities flags counts domain order operations and partial horizons fail closed', async () => {
    const mutations: ((r: MotionJournal3D) => void)[] = [
      (r) => {
        r.from = { ...r.from, tick: 999 };
      },
      (r) => {
        r.rulesVersion = 'wrong' as never;
      },
      (r) => {
        r.to = { kind: 'committed', revision: { ...r.from, revision: 99 } };
      },
      (r) => {
        r.includesInterventions = true as never;
      },
      (r) => {
        r.includesSubpassPaths = true as never;
      },
      (r) => {
        r.requiresReexecution = true;
      },
      (r) => {
        r.recordsObserved--;
      },
      (r) => {
        r.entries++;
      },
      (r) => {
        r.frames.pop();
      },
      (r) => {
        r.frames[0].domain = 'flask';
      },
      (r) => {
        r.frames[1].operation++;
      },
      (r) => {
        r.frames[2].operation++;
      },
      (r) => {
        r.frames[0].trace.toTick++;
      },
      (r) => {
        r.frames[0].trace.width++;
      },
      (r) => {
        r.frames[0].trace.materialCatalogHash = 'wrong';
      },
      (r) => {
        r.status = 'overflow';
        r.requiresReexecution = true;
      },
      (r) => {
        r.status = 'disabled';
        r.requiresReexecution = true;
        r.recordsObserved = 0;
        r.frames = [];
        r.entries = 0;
      },
    ];
    for (const mutate of mutations) {
      const f = fixture({ reservoir: true });
      await f.client.ready;
      const c = await commit(f, 2),
        before = f.client.snapshot();
      f.intercept((m, side) => {
        if (side === 1 && m.kind === 'motion') mutate(m.payload as MotionJournal3D);
        return m;
      });
      await expect(f.client.motion(c)).rejects.toThrow();
      expect(f.client.state).toMatchObject({ status: 'failed', uncertain: false });
      expect(f.client.snapshot()).toEqual(before);
      await finish(f);
    }
  });
  test('malformed permutations and fragment detail cannot pass as a complete report', async () => {
    const a = index(1, 2, 1),
      mutations: ((r: MotionJournal3D) => void)[] = [
        (r) => {
          r.frames[0].trace.moves[0][1] = 0;
        },
        (r) => {
          r.frames[0].trace.touched.length = 0;
        },
        (r) => {
          r.frames[0].trace.movedCells++;
        },
        (r) => {
          r.frames[0].trace.fragments[0].cells++;
        },
        (r) => {
          r.frames[0].trace.fragments[0].sourceRuns[0][0] = 63;
        },
        (r) => {
          r.frames[0].trace.status = 'overflow';
          r.frames[0].trace.requiresReexecution = true;
        },
      ];
    for (const mutate of mutations) {
      const f = fixture({ terrain: seed([[1, 2, 1, MAT.STONE]]), spec: { falls: [[a]] } });
      await f.client.ready;
      const c = await commit(f);
      f.intercept((m, side) => {
        if (side === 1 && m.kind === 'motion') mutate(m.payload as MotionJournal3D);
        return m;
      });
      await expect(f.client.motion(c)).rejects.toThrow();
      expect(f.client.state.uncertain).toBe(false);
      await finish(f);
    }
  });
  test('sparse accessor and oversized frame arrays reject before reading their payloads', async () => {
    const f = fixture();
    await f.client.ready;
    await commit(f);
    const report = f.latest().motion(),
      getter = vi.fn();
    const bad: unknown[][] = [
      Array(1),
      Array(257).fill({}),
      Object.defineProperty([], '0', { get: getter, enumerable: true }),
    ];
    for (const frames of bad)
      expect(() =>
        motionJournalData(
          { ...report, frames },
          report.from,
          f.session.revision,
          f.session.snapshot(),
          { motion: {} },
        ),
      ).toThrow();
    expect(getter).not.toHaveBeenCalled();
    await finish(f);
  });
  test('metadata-only validation enforces the exact shared allowance before copying detail', () => {
    const before = seed(),
      a = index(1, 0, 1),
      { motion } = observe(before, { swaps: new Map([[1, [[a, a + 4]]]]) });
    const domain = { ...before, cellCount: before.packedCells.length };
    expect(readMotionTraceDomain3D(motion, domain, 0, 1, 4)).toEqual(motion);
    expect(() => readMotionTraceDomain3D(motion, domain, 0, 1, 3)).toThrow();
  });
  test('batch operation ordering must advance at the 33rd tick rather than any earlier tick', async () => {
    const f = fixture();
    await f.client.ready;
    const c = await commit(f, 33);
    f.intercept((m, side) => {
      if (side === 1 && m.kind === 'motion') (m.payload as MotionJournal3D).frames[32].operation--;
      return m;
    });
    await expect(f.client.motion(c)).rejects.toThrow(/order/);
    await finish(f);
  });
  test('version three peers cannot supply version four motion reports', async () => {
    const f = fixture();
    await f.client.ready;
    const c = await commit(f, 0);
    f.intercept((m, side) =>
      side === 1 && m.kind === 'motion'
        ? ({ ...m, protocol: 'tactical-worker-3' } as unknown as Wire)
        : m,
    );
    await expect(f.client.motion(c)).rejects.toThrow(/Incompatible/);
    await finish(f);
  });
});
