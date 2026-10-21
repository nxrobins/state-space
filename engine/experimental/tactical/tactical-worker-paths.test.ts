import { createMicrotaskTransport } from '../../test-support/microtask-transport.js';
import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Serialized path history with inert permutations; no physical/native execution. */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MAT } from '../3d.js';
import { volumeSchedule } from '../3d-core.js';

import { type StructuralSnapshot3D } from '../structural-world-core.js';
import {
  createTacticalSessionCore3D,
  type TacticalSimulationFactory3D,
} from './tactical-session-core.js';
import type { TacticalCommit3D, TacticalSessionPolicy3D } from './tactical-session-view.js';
import { createTacticalWorkerHost3D } from './tactical-worker-host.js';
import { createTacticalWorkerClient3D } from './tactical-worker-client.js';
import type { Wire } from './tactical-worker-wire.js';
import type { TacticalPreviewCapture3D } from './tactical-preview-capture.js';
import { pathJournalData } from './tactical-worker-paths.js';
import { motionPathEntries3D, type PathJournal3D } from '../path-journal.js';
import { motionTraceEntries3D } from '../motion-trace.js';
import { readMotionPaths3D, readMotionPathsDomain3D } from '../motion-paths.js';
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
    beforeStep?: () => Promise<void>;
    policy?: TacticalSessionPolicy3D<Game>;
  } = {},
) {
  const { ports, sent, closed, setRewrite: intercept, deliver } = createMicrotaskTransport<Wire>();
  let failRead = false;
  const read = vi.fn(),
    made = vi.fn(),
    cleaned = vi.fn();
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
      motion: () => result.motion,
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
      worldId: 'paths-world',
      gameRulesVersion: 'paths-game',
      terrain,
      game: { ap: 2 },
      reservoirs: options.reservoir ? [{ id: 'flask', terrain: reservoir }] : [],
    },
    factory,
    options.policy,
    async () => {},
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
        const committed = latest;
        return {
          ...committed,
          paths() {
            read();
            if (failRead) throw Error('fixture paths unavailable');
            return committed.paths();
          },
        };
      },
    },
    (e, c: Game) => {
      e.setGame(c);
    },
    'paths-channel',
  );
  const client = createTacticalWorkerClient3D<Game, Game>(ports[0], {
    channel: 'paths-channel',
    worldId: 'paths-world',
    gameRulesVersion: 'paths-game',
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
  capture: TacticalPreviewCapture3D = { paths: {} },
) {
  const t = f.client.request({ ap: 1 }, horizon, capture);
  expect((await t.result).status).toBe('ready');
  return f.client.commit(t);
}
async function finish(f: ReturnType<typeof fixture>) {
  if (f.client.state.status !== 'failed') await f.client.close();
  await f.host.close();
}
function denseSpec(tick: number): Spec {
  const swaps = new Map<number, [number, number][]>();
  volumeSchedule(tick).forEach((pass, p) => {
    if (pass.kind === 'heat' || pass.kind === 'phase') return;
    const axis = ['gravity', 'diagonal', 'buoyancy'].includes(pass.kind) ? 1 : pass.axis,
      pairs: [number, number][] = [];
    for (let z = 0; z < 4; z++)
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          const a = [x, y, z],
            b = a.slice();
          if (a[axis] % 2 !== pass.parity) continue;
          b[axis]++;
          if (pass.kind === 'diagonal') b[pass.axis] += pass.direction;
          if (b.some((v) => v < 0 || v >= 4)) continue;
          pairs.push([index(x, y, z), index(...(b as [number, number, number]))]);
        }
    swaps.set(p + 1, pairs);
  });
  return { swaps };
}

describe('worker captured path journals', () => {
  test('disabled and zero-tick complete journals retain distinct meanings without eager reads', async () => {
    const f = fixture();
    await f.client.ready;
    const disabled = await commit(f, 1, { motion: {} });
    expect(f.read).not.toHaveBeenCalled();
    expect(await f.client.paths(disabled)).toMatchObject({
      status: 'disabled',
      requiresReexecution: true,
      recordsObserved: 0,
      frames: [],
    });
    const empty = await commit(f, 0);
    expect(await f.client.paths(empty)).toMatchObject({
      status: 'complete',
      recordsObserved: 0,
      entries: 0,
      frames: [],
      includesSubpassPaths: true,
      includesInterventions: false,
    });
    await finish(f);
  });
  test('odd-start domain and batch history equals the complete direct path journal', async () => {
    const terrain = seed();
    terrain.tick = 3;
    const f = fixture({ terrain, reservoir: true });
    await f.client.ready;
    const c = await commit(f, 33, { motion: { maxEntries: 0 }, paths: { maxEntries: 0 } }),
      r = await f.client.paths(c);
    expect(r).toEqual(f.latest().paths());
    expect(r.entries).toBe(66);
    expect(
      r.frames.slice(-4).map((f) => [f.domain, f.operation, f.paths.fromTick, f.paths.toTick]),
    ).toEqual([
      [null, 2, 34, 35],
      ['flask', 2, 34, 35],
      [null, 3, 35, 36],
      ['flask', 3, 35, 36],
    ]);
    expect(c.snapshot).toEqual(f.session.snapshot());
    expect(f.cleaned).toHaveBeenCalledTimes(4);
    await finish(f);
  });
  test('out-and-back paths retain both crossings despite identical final positions', async () => {
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
      r = await f.client.paths(c);
    expect(r).toEqual(f.latest().paths());
    expect(r.frames[0].motion.moves).toEqual([]);
    expect(r.frames[0].paths.cellTransfers).toBe(4);
    expect(r.frames[0].paths.passes.map((p) => p.index)).toEqual([1, 15]);
    await finish(f);
  });
  test('falling members remain linear and displaced occupants remain instantaneous relocations', async () => {
    const a = index(1, 1, 1),
      f = fixture({
        terrain: seed([
          [1, 1, 1, MAT.STONE],
          [1, 2, 1, MAT.STONE],
        ]),
        spec: { falls: [[a, a + 4]] },
      });
    await f.client.ready;
    const c = await commit(f),
      r = await f.client.paths(c);
    expect(r).toEqual(f.latest().paths());
    expect(r.frames[0].paths.passes).toEqual([
      {
        index: 0,
        segments: [
          { origin: a, from: a, to: a + 4, mode: 'linear' },
          { origin: a + 4, from: a + 4, to: a + 8, mode: 'linear' },
          { origin: a + 8, from: a + 8, to: a, mode: 'relocation' },
        ],
      },
    ]);
    await finish(f);
  });
  test('all scheduled movement axes parities and diagonal directions survive transport at even and odd ticks', async () => {
    for (const tick of [0, 1]) {
      const terrain = seed();
      terrain.tick = tick;
      const f = fixture({ terrain, spec: denseSpec(tick) });
      await f.client.ready;
      const c = await commit(f),
        r = await f.client.paths(c);
      expect(r).toEqual(f.latest().paths());
      expect(r.frames[0].paths.passes.length).toBe(
        volumeSchedule(tick).filter((p) => p.kind !== 'heat' && p.kind !== 'phase').length,
      );
      await finish(f);
    }
  });
  test('required paths remain enabled by policy when client capture options are omitted', async () => {
    const f = fixture({
      policy: {
        requiresPaths: true,
        reduceTick: ({ game, movement }) => {
          expect(movement().status).toBe('complete');
          return game;
        },
      },
    });
    await f.client.ready;
    const c = await commit(f, 1, {});
    expect(await f.client.paths(c)).toEqual(f.latest().paths());
    expect(f.made.mock.calls[0][0]).toMatchObject({ motion: true, paths: true });
    await finish(f);
  });
  test('per-tick and cumulative overflow discard prefixes without discarding the committed action', async () => {
    const a = index(1, 0, 1),
      f = fixture({ spec: { swaps: new Map([[1, [[a, a + 4]]]]), overflow: true } });
    await f.client.ready;
    const c = await commit(f, 1, { paths: { maxEntries: 0 } });
    expect(await f.client.paths(c)).toMatchObject({
      status: 'overflow',
      requiresReexecution: true,
      frames: [],
      entries: 0,
      recordsObserved: 1,
    });
    await finish(f);
    const g = fixture();
    await g.client.ready;
    const long = await commit(g, 257);
    expect(await g.client.paths(long)).toMatchObject({
      status: 'overflow',
      recordsObserved: 257,
      entries: 0,
      frames: [],
    });
    expect(g.client.snapshot().terrain.tick).toBe(257);
    await finish(g);
  });
  test('nested caller mutations cannot alter later reports or their private commit identity', async () => {
    const a = index(1, 2, 1),
      f = fixture({ terrain: seed([[1, 2, 1, MAT.STONE]]), spec: { falls: [[a]] } });
    await f.client.ready;
    const c = await commit(f),
      expected = f.latest().paths(),
      before = f.client.snapshot();
    c.receipt.base = { ...c.receipt.base, tick: 900 };
    c.snapshot.terrain.energyQ.fill(0);
    const r = await f.client.paths(c);
    r.frames[0].paths.passes[0].segments[0].origin = 0;
    r.frames[0].motion.fragments[0].sourceRuns.length = 0;
    expect(await f.client.paths(c)).toEqual(expected);
    expect(f.client.snapshot()).toEqual(before);
    expect(f.session.snapshot()).toEqual(before);
    await finish(f);
  });
  test('copied foreign older restored and closed handles cannot authorize path reads', async () => {
    const f = fixture(),
      other = fixture();
    await f.client.ready;
    await other.client.ready;
    const old = await commit(f, 0);
    expect(() => other.client.paths(old)).toThrow(/latest/);
    expect(() => f.client.paths({ ...old })).toThrow(/latest/);
    const current = await commit(f, 0);
    expect(() => f.client.paths(old)).toThrow(/latest/);
    await f.client.restore(current.snapshot);
    expect(() => f.client.paths(current)).toThrow(/latest/);
    await finish(f);
    expect(() => f.client.paths(current)).toThrow(/closed/);
    await finish(other);
  });
  test('ordinary read failure preserves a ready preview and the acknowledged state', async () => {
    const f = fixture();
    await f.client.ready;
    const c = await commit(f, 0),
      before = f.client.snapshot();
    const t = f.client.request({ ap: 0 }, 0);
    await t.result;
    f.failRead(true);
    await expect(f.client.paths(c)).rejects.toThrow(/unavailable/);
    expect(f.client.state).toMatchObject({ status: 'ready', readyId: t.id, uncertain: false });
    expect(f.client.snapshot()).toEqual(before);
    f.failRead(false);
    expect(await f.client.paths(c)).toEqual(f.latest().paths());
    expect((await f.client.commit(t)).snapshot.game.ap).toBe(0);
    await finish(f);
  });
  test('external revision change rejects a path read while preserving the last confirmed snapshot', async () => {
    const f = fixture();
    await f.client.ready;
    const c = await commit(f, 0),
      before = f.client.snapshot();
    f.session.restore(f.session.snapshot());
    await expect(f.client.paths(c)).rejects.toThrow(/Stale/);
    expect(f.client.snapshot()).toEqual(before);
    expect(f.client.state.uncertain).toBe(false);
    await finish(f);
  });
  test('pending paths exclude other reads previews commits and restores', async () => {
    const f = fixture();
    await f.client.ready;
    const c = await commit(f, 0),
      t = f.client.request({ ap: 0 }, 0);
    await t.result;
    let held: Wire | undefined;
    f.intercept((m, side) => {
      if (side === 1 && m.kind === 'paths') {
        held = m;
        return null;
      }
      return m;
    });
    const pending = f.client.paths(c);
    await Promise.resolve();
    await Promise.resolve();
    expect(() => f.client.paths(c)).toThrow(/idle/);
    expect(() => f.client.motion(c)).toThrow(/idle/);
    expect(() => f.client.changes(c)).toThrow(/idle/);
    expect(() => f.client.request({ ap: 0 }, 0)).toThrow(/in flight/);
    expect(() => f.client.commit(t)).toThrow(/idle/);
    expect(() => f.client.restore(c.snapshot)).toThrow(/idle/);
    f.deliver(held!);
    await pending;
    expect(f.client.state.readyId).toBe(t.id);
    await finish(f);
  });
  test('read timeout fails closed without retry or an uncertain mutation', async () => {
    vi.useFakeTimers();
    const f = fixture({ timeout: 30 });
    await f.client.ready;
    const c = await commit(f, 0),
      before = f.client.snapshot();
    f.intercept((m, side) => (side === 1 && m.kind === 'paths' ? null : m));
    const pending = expect(f.client.paths(c)).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(31);
    await pending;
    expect(f.client.state).toMatchObject({ status: 'failed', uncertain: false });
    expect(f.client.snapshot()).toEqual(before);
    expect(f.sent[0].filter((m) => m.kind === 'paths')).toHaveLength(1);
    await finish(f);
  });
  test('close waits for a pending path read before disposing the endpoint', async () => {
    const f = fixture();
    await f.client.ready;
    const c = await commit(f, 0),
      pending = f.client.paths(c),
      close = f.client.close();
    expect(f.closed[0]).toBe(false);
    await pending;
    await close;
    expect(f.closed[0]).toBe(true);
    await f.host.close();
  });
  test('cancelled previews cannot publish path prefixes before a replacement commits', async () => {
    let first = true,
      enter!: () => void,
      release!: () => void;
    const start = new Promise<void>((r) => {
        enter = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    const f = fixture({
      beforeStep: async () => {
        if (first) {
          first = false;
          enter();
          await gate;
        }
      },
    });
    await f.client.ready;
    const old = f.client.request({ ap: 0 }, 3, { paths: {} });
    await start;
    old.cancel();
    const next = f.client.request({ ap: 1 }, 1, { paths: {} });
    release();
    expect((await old.result).status).toBe('cancelled');
    expect((await next.result).status).toBe('ready');
    const c = await f.client.commit(next);
    expect(await f.client.paths(c)).toEqual(f.latest().paths());
    expect(f.cleaned).toHaveBeenCalledTimes(2);
    await finish(f);
  });
  test('stamps scope flags missing domains operation order and counts reject malformed complete reports', async () => {
    const mutations: ((r: PathJournal3D) => void)[] = [
      (r) => {
        r.from = { ...r.from, revision: 999 };
      },
      (r) => {
        r.rulesVersion = 'wrong' as never;
      },
      (r) => {
        r.to = { kind: 'committed', revision: { ...r.from, tick: 99 } };
      },
      (r) => {
        r.includesInterventions = true as never;
      },
      (r) => {
        r.includesSubpassPaths = false as never;
      },
      (r) => {
        r.requiresReexecution = true;
      },
      (r) => {
        r.recordsObserved--;
      },
      (r) => {
        r.entries--;
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
        r.frames[0].paths.toTick++;
      },
      (r) => {
        r.frames[0].paths.depth++;
      },
      (r) => {
        r.status = 'overflow';
        r.requiresReexecution = true;
      },
      (r) => {
        r.status = 'disabled';
        r.requiresReexecution = true;
        r.entries = 0;
        r.frames = [];
        r.recordsObserved = 0;
      },
    ];
    for (const mutate of mutations) {
      const f = fixture({ reservoir: true });
      await f.client.ready;
      const c = await commit(f, 2),
        before = f.client.snapshot();
      f.intercept((m, side) => {
        if (side === 1 && m.kind === 'paths') mutate(m.payload as PathJournal3D);
        return m;
      });
      await expect(f.client.paths(c)).rejects.toThrow();
      expect(f.client.state).toMatchObject({ status: 'failed', uncertain: false });
      expect(f.client.snapshot()).toEqual(before);
      await finish(f);
    }
  });
  test('wrong parity identity composition segment mode and simultaneous permutations fail closed', async () => {
    const a = index(1, 0, 1),
      mutations: ((r: PathJournal3D) => void)[] = [
        (r) => {
          r.frames[0].paths.passes[0].index = 2;
        },
        (r) => {
          r.frames[0].paths.passes[0].segments[0].origin = 0;
        },
        (r) => {
          r.frames[0].paths.passes[0].segments[0].to = 0;
        },
        (r) => {
          r.frames[0].paths.passes[0].segments[0].mode = 'relocation';
        },
        (r) => {
          r.frames[0].paths.passes[0].segments.reverse();
        },
        (r) => {
          r.frames[0].paths.passes[0].segments.pop();
        },
        (r) => {
          r.frames[0].paths.passes[1].segments[0].origin = a;
        },
        (r) => {
          r.frames[0].paths.cellTransfers--;
        },
        (r) => {
          r.frames[0].paths.status = 'overflow';
          r.frames[0].paths.requiresReexecution = true;
          r.frames[0].paths.passes = [];
          r.entries = 1 + motionTraceEntries3D(r.frames[0].motion);
        },
        (r) => {
          r.frames[0].motion.moves = [
            [a, a + 4, 1],
            [a + 4, a, 1],
          ];
          r.frames[0].motion.movedCells = 2;
          r.entries += 2;
        },
      ];
    for (const mutate of mutations) {
      const f = fixture({
        spec: {
          swaps: new Map([
            [1, [[a, a + 4]]],
            [15, [[a, a + 4]]],
          ]),
        },
      });
      await f.client.ready;
      const c = await commit(f);
      f.intercept((m, side) => {
        if (side === 1 && m.kind === 'paths') mutate(m.payload as PathJournal3D);
        return m;
      });
      await expect(f.client.paths(c)).rejects.toThrow();
      expect(f.client.state.uncertain).toBe(false);
      await finish(f);
    }
  });
  test('nested accessors sparse arrays and oversized frames reject without evaluating getters', async () => {
    const a = index(1, 0, 1),
      f = fixture({ spec: { swaps: new Map([[1, [[a, a + 4]]]]) } });
    await f.client.ready;
    await commit(f);
    const original = f.latest().paths(),
      getter = vi.fn(),
      read = (r: PathJournal3D) =>
        pathJournalData(r, original.from, f.session.revision, f.session.snapshot(), { paths: {} });
    expect(() => read({ ...original, frames: Array(1) })).toThrow();
    expect(() => read({ ...original, frames: Array(257).fill(original.frames[0]) })).toThrow();
    const bad = structuredClone(original);
    Object.defineProperty(bad.frames[0].paths.passes[0].segments[0], 'to', {
      get: getter,
      enumerable: true,
    });
    expect(() => read(bad)).toThrow();
    const sparse = structuredClone(original);
    delete sparse.frames[0].paths.passes[0].segments[0];
    expect(() => read(sparse)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    await finish(f);
  });
  test('frame overhead and per-tick detail budgets are inclusive and cannot omit charged entries', async () => {
    const a = index(1, 0, 1),
      f = fixture({ spec: { swaps: new Map([[1, [[a, a + 4]]]]) } });
    await f.client.ready;
    const c = await commit(f, 1, { motion: { maxEntries: 4 }, paths: { maxEntries: 3 } }),
      r = await f.client.paths(c);
    expect(r.entries).toBe(8);
    expect(() =>
      pathJournalData(r, r.from, f.session.revision, f.session.snapshot(), {
        motion: { maxEntries: 3 },
        paths: { maxEntries: 3 },
      }),
    ).toThrow();
    expect(() =>
      pathJournalData(r, r.from, f.session.revision, f.session.snapshot(), {
        paths: { maxEntries: 2 },
      }),
    ).toThrow();
    expect(() =>
      pathJournalData({ ...r, entries: 7 }, r.from, f.session.revision, f.session.snapshot(), {
        paths: {},
      }),
    ).toThrow();
    await finish(f);
  });
  test('valid per-frame paths cannot bypass the shared journal budget by understating total entries', async () => {
    const f = fixture();
    await f.client.ready;
    await commit(f, 0);
    const r = f.latest().paths(),
      snapshot = f.session.snapshot(),
      count = 128;
    const frames = Array.from({ length: count }, (_, i) => {
      const before = seed();
      before.tick = i;
      const result = observe(before, denseSpec(i));
      return {
        domain: null,
        operation: 2 + Math.floor(i / 32),
        motion: result.motion,
        paths: result.paths,
      };
    });
    const total = frames.reduce(
      (n, f) => n + 1 + motionTraceEntries3D(f.motion) + motionPathEntries3D(f.paths),
      0,
    );
    expect(total).toBeGreaterThan(65536);
    const to = { ...f.session.revision, tick: count };
    snapshot.terrain.tick = count;
    expect(() =>
      pathJournalData(
        {
          ...r,
          recordsObserved: count,
          entries: 65536,
          frames,
          to: { kind: 'committed', revision: to },
        },
        r.from,
        to,
        snapshot,
        { motion: { maxEntries: 4096 }, paths: { maxEntries: 4096 } },
      ),
    ).toThrow(/budget|bounded/);
    await finish(f);
  });
  test('public decoder still validates complete snapshots while metadata decoder agrees on valid input', () => {
    const before = seed(),
      a = index(1, 0, 1),
      r = observe(before, { swaps: new Map([[1, [[a, a + 4]]]]) }),
      domain = { ...before, cellCount: before.packedCells.length };
    expect(readMotionPathsDomain3D(r.paths, r.motion, domain, 0, 1, 3)).toEqual(
      readMotionPaths3D(r.paths, r.motion, before, r.after),
    );
    const invalid = structuredClone(before);
    invalid.packedCells.pop();
    expect(() => readMotionPaths3D(r.paths, r.motion, invalid, r.after)).toThrow();
    expect(() => readMotionPathsDomain3D(r.paths, r.motion, domain, 0, 1, 2)).toThrow(/budget/);
  });
  test('batch transitions and older protocol responses cannot pass path validation', async () => {
    const f = fixture();
    await f.client.ready;
    const c = await commit(f, 33);
    f.intercept((m, side) => {
      if (side === 1 && m.kind === 'paths') (m.payload as PathJournal3D).frames[32].operation--;
      return m;
    });
    await expect(f.client.paths(c)).rejects.toThrow(/order/);
    await finish(f);
    const g = fixture();
    await g.client.ready;
    const empty = await commit(g, 0);
    g.intercept((m, side) =>
      side === 1 && m.kind === 'paths'
        ? ({ ...m, protocol: 'tactical-worker-4' } as unknown as Wire)
        : m,
    );
    await expect(g.client.paths(empty)).rejects.toThrow(/Incompatible/);
    await finish(g);
  });
});
