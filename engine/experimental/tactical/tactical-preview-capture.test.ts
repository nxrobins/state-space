import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Queue observations use synthetic permutations, never production physics. */
import { describe, expect, test, vi } from 'vitest';
import { MAT } from '../3d.js';

import { type StructuralSnapshot3D } from '../structural/structural-world-core.js';
import { createTacticalSession3D } from '../tactical-session.js';
import {
  createTacticalSessionCore3D,
  type TacticalSimulationFactory3D,
} from './tactical-session-core.js';
import {
  createTacticalPreviewQueue3D,
  type TacticalPreviewCapture3D,
  type TacticalPreviewQueue3D,
  type TacticalPreviewTicket3D,
} from './tactical-previews.js';
import type { TacticalSessionPolicy3D } from './tactical-session-view.js';
import { observe, seed, index, type Spec } from '../terrain/terrain-motion.fixtures.js';
import type { SupportObserver3D } from '../change-reports.js';

holdPhysics('solveStructure3D', ...STRUCTURAL_CALLS);
type Game = { ap: number };
const all: TacticalPreviewCapture3D = { motion: {}, paths: {}, journal: {} };
const inertSupport: SupportObserver3D = (s) => ({
  distances: new Int32Array(s.packedCells.length).fill(-1),
  loads: new Uint32Array(s.packedCells.length),
  capacities: new Uint32Array(s.packedCells.length),
  reactions: new Uint32Array(s.packedCells.length),
});
function deferred() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve: () => resolve(),
  };
}
function fixture(
  options: {
    reservoir?: boolean;
    spec?: Spec;
    beforeStep?: () => Promise<void>;
    malformed?: boolean;
    policy?: TacticalSessionPolicy3D<Game>;
    support?: SupportObserver3D;
    terrain?: StructuralSnapshot3D;
  } = {},
) {
  const made = vi.fn(),
    closed = vi.fn(),
    motionRead = vi.fn(),
    pathsRead = vi.fn(),
    support = vi.fn(options.support ?? inertSupport);
  const factory: TacticalSimulationFactory3D = (
    initial,
    domain,
    motion,
    motionLimit,
    paths,
    pathLimit,
  ) => {
    made({ domain, motion, motionLimit, paths, pathLimit });
    let before = structuredClone(initial),
      result: ReturnType<typeof observe>;
    return {
      load(s) {
        before = structuredClone(s);
      },
      async step() {
        await options.beforeStep?.();
        result = observe(before, options.spec);
        before = structuredClone(result.after);
      },
      snapshot: () => result.after,
      motion() {
        motionRead(domain);
        return result.motion;
      },
      paths() {
        pathsRead(domain);
        return options.malformed
          ? { ...result.paths, toTick: result.paths.toTick + 1 }
          : result.paths;
      },
      close() {
        closed(domain);
      },
    };
  };
  const initial = {
    worldId: 'capture-world',
    gameRulesVersion: 'capture-game-1',
    terrain: options.terrain ?? seed([[1, 0, 1, MAT.SAND]]),
    game: { ap: 2 },
    reservoirs: options.reservoir ? [{ id: 'flask', terrain: seed() }] : [],
  };
  const session = createTacticalSessionCore3D(
    initial,
    factory,
    options.policy,
    async () => {},
    support,
  );
  const queue = createTacticalPreviewQueue3D(session, (editor, command: Game) => {
    editor.setGame(command);
  });
  return { session, queue, initial, made, closed, motionRead, pathsRead, support };
}
function rejectsReads(
  queue: TacticalPreviewQueue3D<Game, Game>,
  ticket: TacticalPreviewTicket3D<Game>,
) {
  expect(() => queue.motion(ticket)).toThrow();
  expect(() => queue.paths(ticket)).toThrow();
  expect(() => queue.journal(ticket)).toThrow();
}

describe('capture and observation of bounded queued previews', () => {
  test('default capture remains explicitly disabled without extra driver reads', async () => {
    const f = fixture(),
      t = f.queue.request({ ap: 1 }, 1);
    await t.result;
    for (const r of [f.queue.motion(t), f.queue.paths(t), f.queue.journal(t)])
      expect(r).toMatchObject({
        status: 'disabled',
        requiresReexecution: true,
        recordsObserved: 0,
      });
    expect(f.motionRead).not.toHaveBeenCalled();
    expect(f.pathsRead).not.toHaveBeenCalled();
    expect(f.support).not.toHaveBeenCalled();
    await f.queue.close();
  });
  test('zero-tick public capture returns empty complete motion and a game action journal', async () => {
    const f = fixture(),
      session = createTacticalSession3D(f.initial),
      queue = createTacticalPreviewQueue3D(session, (e, c: Game) => {
        e.setGame(c);
      });
    const t = queue.request({ ap: 1 }, 0, all);
    await t.result;
    expect(queue.motion(t)).toMatchObject({ status: 'complete', frames: [], recordsObserved: 0 });
    expect(queue.paths(t)).toMatchObject({ status: 'complete', frames: [], recordsObserved: 0 });
    expect(queue.journal(t).events.map((e) => e.action.kind)).toEqual(['game']);
    const journal = queue.journal(t),
      committed = queue.commit(t);
    expect(committed.journal().events).toEqual(journal.events);
    expect(committed.journal().to).toMatchObject({
      kind: 'committed',
      revision: { revision: 1, tick: 0 },
    });
    rejectsReads(queue, t);
    await queue.close();
    await f.queue.close();
  });
  test('path capture enables motion while retaining session-required paths when omitted', async () => {
    for (const capture of [{ paths: {} }, {}, { motion: { maxEntries: 9 } }]) {
      const reducer = vi.fn(
        ({
          game,
          movement,
        }: Parameters<NonNullable<TacticalSessionPolicy3D<Game>['reduceTick']>>[0]) => {
          expect(movement().status).toBe('complete');
          return game;
        },
      );
      const f = fixture({ policy: { requiresPaths: true, reduceTick: reducer } }),
        t = f.queue.request({ ap: 1 }, 1, capture);
      expect((await t.result).status).toBe('ready');
      expect(f.made.mock.calls[0][0]).toMatchObject({ motion: true, paths: true });
      expect(f.queue.paths(t).frames).toHaveLength(1);
      expect(reducer).toHaveBeenCalledTimes(1);
      await f.queue.close();
    }
  });
  test('net-only and journal-only captures retain their distinct scope', async () => {
    for (const capture of [{ motion: {} }, { journal: {} }]) {
      const f = fixture(),
        t = f.queue.request({ ap: 1 }, 1, capture);
      await t.result;
      expect(f.queue.motion(t).status).toBe('complete');
      expect(f.queue.paths(t).status).toBe('disabled');
      expect(f.pathsRead).not.toHaveBeenCalled();
      expect(f.queue.journal(t).status).toBe('journal' in capture ? 'complete' : 'disabled');
      await f.queue.close();
    }
  });
  test('malformed options reject before superseding accepted work or consuming identities', async () => {
    const f = fixture(),
      t = f.queue.request({ ap: 1 }, 0, all);
    await t.result;
    const bad = [
      null,
      [],
      1,
      { extra: 1 },
      { paths: false },
      { motion: null },
      { journal: [] },
      { capturePaths: false },
      { paths: { maxPathEntries: 2 } },
      { motion: { extra: 1 } },
      { journal: { maxRuns: -1 } },
      { journal: { maxRuns: 4097 } },
      ...[-1, 0.5, NaN, Infinity, 65537].flatMap((maxEntries) => [
        { paths: { maxEntries } },
        { motion: { maxEntries } },
      ]),
    ];
    for (const value of bad) {
      expect(() => f.queue.request({ ap: 0 }, 0, value as never)).toThrow();
      expect(f.queue.state.readyId).toBe(t.id);
    }
    expect(f.queue.journal(t).events).toHaveLength(1);
    const next = f.queue.request({ ap: 0 }, 0);
    expect(next.id).toBe(t.id + 1);
    await next.result;
    await f.queue.close();
  });
  test('capture accessors hidden fields prototypes and symbols reject without invoking getters', async () => {
    const f = fixture(),
      t = f.queue.request({ ap: 1 }, 0),
      getter = vi.fn();
    const nested = Object.defineProperty({}, 'maxEntries', { get: getter, enumerable: true });
    for (const value of [
      Object.defineProperty({}, 'paths', { get: getter, enumerable: true }),
      { paths: nested },
      Object.defineProperty({}, 'motion', { value: {}, enumerable: false }),
      { [Symbol('x')]: {} },
      Object.create({ paths: {} }),
      { journal: new Date() },
    ]) {
      expect(() => f.queue.request({ ap: 0 }, 0, value as never)).toThrow();
    }
    expect(getter).not.toHaveBeenCalled();
    expect((await t.result).status).toBe('ready');
    await f.queue.close();
  });
  test('nested capture budgets are detached before a waiting request can execute', async () => {
    const f = fixture(),
      capture = { motion: { maxEntries: 9 }, paths: { maxEntries: 12 }, journal: { maxRuns: 0 } };
    const t = f.queue.request({ ap: 1 }, 1, capture);
    capture.motion.maxEntries = -1;
    capture.paths.maxEntries = -1;
    capture.journal.maxRuns = -1;
    expect((await t.result).status).toBe('ready');
    expect(f.made.mock.calls[0][0]).toMatchObject({ motionLimit: 9, pathLimit: 12 });
    await f.queue.close();
  });
  test('zero and maximum capture budgets retain the existing inclusive limits', async () => {
    for (const maxEntries of [0, 65536]) {
      const f = fixture(),
        t = f.queue.request({ ap: 1 }, 1, {
          motion: { maxEntries },
          paths: { maxEntries },
          journal: { maxRuns: maxEntries ? 4096 : 0 },
        });
      expect((await t.result).status).toBe('ready');
      expect(f.made.mock.calls[0][0]).toMatchObject({
        motionLimit: maxEntries,
        pathLimit: maxEntries,
      });
      expect(f.queue.paths(t).status).toBe('complete');
      await f.queue.close();
    }
  });
  test('queued observations and complete state equal a direct branch across a batch boundary and reservoir', async () => {
    const f = fixture({ reservoir: true }),
      direct = fixture({ reservoir: true });
    const b = direct.session.branch({ horizonTicks: 33, capturePaths: true, captureJournal: true });
    b.setGame({ ap: 1 });
    await b.advance(32);
    await b.advance(1);
    const t = f.queue.request({ ap: 1 }, 33, all);
    expect((await t.result).status).toBe('ready');
    expect(f.queue.motion(t)).toEqual(b.motion());
    expect(f.queue.paths(t)).toEqual(b.paths());
    expect(f.queue.journal(t)).toEqual(b.journal());
    const frames = f.queue.paths(t).frames;
    expect(frames).toHaveLength(66);
    expect(
      frames.slice(-4).map((r) => [r.domain, r.operation, r.paths.fromTick, r.paths.toTick]),
    ).toEqual([
      [null, 2, 31, 32],
      ['flask', 2, 31, 32],
      [null, 3, 32, 33],
      ['flask', 3, 32, 33],
    ]);
    const queued = f.queue.commit(t),
      baseline = direct.session.commit(b);
    expect(queued.snapshot).toEqual(baseline.snapshot);
    expect(queued.receipt).toEqual(baseline.receipt);
    expect(queued.motion()).toEqual(baseline.motion());
    expect(queued.paths()).toEqual(baseline.paths());
    expect(queued.journal()).toEqual(baseline.journal());
    expect(f.made).toHaveBeenCalledTimes(4);
    expect(f.closed).toHaveBeenCalledTimes(4);
    await f.queue.close();
    await direct.queue.close();
  });
  test('return-to-origin execution retains touched identities and both subpass crossings', async () => {
    const a = index(1, 0, 1),
      b = a + 4,
      f = fixture({
        spec: {
          swaps: new Map([
            [1, [[a, b]]],
            [15, [[a, b]]],
          ]),
        },
      });
    const original = f.session.snapshot(),
      t = f.queue.request({ ap: 1 }, 1, { paths: {} });
    expect((await t.result).status).toBe('ready');
    expect(f.queue.motion(t).frames[0].trace).toMatchObject({
      movedCells: 0,
      touchedCells: 2,
      moves: [],
    });
    expect(f.queue.paths(t).frames[0].paths.passes.map((p) => p.index)).toEqual([1, 15]);
    expect(f.queue.commit(t).snapshot.terrain.energyQ).toEqual(original.terrain.energyQ);
    await f.queue.close();
  });
  test('falling fragment membership comes from execution and survives commit', async () => {
    const a = index(1, 2, 1),
      f = fixture({ terrain: seed([[1, 2, 1, MAT.STONE]]), spec: { falls: [[a]] } });
    const t = f.queue.request({ ap: 1 }, 1, { motion: {}, paths: {} });
    expect((await t.result).status).toBe('ready');
    const motion = f.queue.motion(t);
    expect(motion.frames[0].trace.fragments).toEqual([{ id: a, cells: 1, sourceRuns: [[a, 1]] }]);
    const result = f.queue.commit(t);
    expect(result.motion().frames).toEqual(motion.frames);
    await f.queue.close();
  });
  test('journal coarse fallback keeps complete change counts rather than partial runs', async () => {
    const f = fixture(),
      queue = createTacticalPreviewQueue3D(f.session, (e, c: Game) => {
        e.addEnergy([{ x: 1, y: 0, z: 1, deltaQ: 1 }]);
        e.setGame(c);
      });
    const t = queue.request({ ap: 1 }, 0, { journal: { maxRuns: 0 } });
    expect((await t.result).status).toBe('ready');
    const journal = queue.journal(t);
    expect(journal).toMatchObject({ status: 'coarse', requiresFullRead: true });
    expect(journal.events[0].changes.domains[0].channels.energy).toMatchObject({
      count: 1,
      runs: [],
      mode: 'bounds',
    });
    expect(queue.commit(t).journal().events).toEqual(journal.events);
    await queue.close();
    await f.queue.close();
  });
  test('path overflow drops all partial paths while retaining an exact commit candidate', async () => {
    const a = index(1, 0, 1),
      f = fixture({ spec: { swaps: new Map([[1, [[a, a + 4]]]]), overflow: true } });
    const t = f.queue.request({ ap: 1 }, 1, { paths: { maxEntries: 0 } });
    expect((await t.result).status).toBe('ready');
    expect(f.queue.paths(t)).toMatchObject({
      status: 'overflow',
      frames: [],
      recordsObserved: 1,
      requiresReexecution: true,
    });
    expect(f.queue.motion(t).status).toBe('complete');
    expect(f.queue.commit(t).snapshot.terrain.tick).toBe(1);
    await f.queue.close();
  });
  test('journal record limits remain bounded across multiple scheduler batches', async () => {
    const f = fixture(),
      t = f.queue.request({ ap: 1 }, 257, all);
    expect((await t.result).status).toBe('ready');
    for (const r of [f.queue.motion(t), f.queue.paths(t), f.queue.journal(t)])
      expect(r).toMatchObject({ status: 'overflow', requiresReexecution: true, entries: 0 });
    expect(f.queue.motion(t).frames).toEqual([]);
    expect(f.queue.paths(t).frames).toEqual([]);
    expect(f.queue.journal(t).events).toEqual([]);
    expect(f.queue.commit(t).snapshot.terrain.tick).toBe(257);
    await f.queue.close();
  });
  test('reads reject waiting running and cancelled requests without exposing partial history', async () => {
    const entered = deferred(),
      gate = deferred(),
      f = fixture({
        beforeStep: async () => {
          entered.resolve();
          await gate.promise;
        },
      }),
      before = f.session.snapshot();
    const t = f.queue.request({ ap: 1 }, 2, all);
    rejectsReads(f.queue, t);
    await entered.promise;
    rejectsReads(f.queue, t);
    t.cancel();
    gate.resolve();
    expect((await t.result).status).toBe('cancelled');
    rejectsReads(f.queue, t);
    expect(f.session.snapshot()).toEqual(before);
    expect(f.closed).toHaveBeenCalledTimes(1);
    await f.queue.close();
  });
  test('superseded foreign and copied tickets cannot read the latest candidate', async () => {
    const f = fixture(),
      other = fixture(),
      old = f.queue.request({ ap: 1 }, 0, all);
    await old.result;
    const t = f.queue.request({ ap: 0 }, 0, all);
    rejectsReads(f.queue, old);
    await t.result;
    rejectsReads(other.queue, t);
    rejectsReads(f.queue, { ...t });
    expect(f.queue.journal(t).events).toHaveLength(1);
    await f.queue.close();
    await other.queue.close();
  });
  test('restore commit cancellation and close revoke read permits without mutating historical copies', async () => {
    for (const action of ['restore', 'commit', 'cancel', 'close']) {
      const f = fixture(),
        t = f.queue.request({ ap: 1 }, 0, all);
      await t.result;
      const historical = f.queue.journal(t),
        saved = structuredClone(historical);
      if (action === 'restore') f.session.restore(f.session.snapshot());
      else if (action === 'commit') f.queue.commit(t);
      else if (action === 'cancel') t.cancel();
      else await f.queue.close();
      rejectsReads(f.queue, t);
      expect(historical).toEqual(saved);
      await f.queue.close();
    }
  });
  test('every read owns nested observations and cannot mutate later committed data', async () => {
    const a = index(1, 2, 1),
      f = fixture({ terrain: seed([[1, 2, 1, MAT.STONE]]), spec: { falls: [[a]] } });
    const t = f.queue.request({ ap: 1 }, 1, all);
    expect((await t.result).status).toBe('ready');
    const motion = f.queue.motion(t),
      paths = f.queue.paths(t),
      journal = f.queue.journal(t);
    const expected = structuredClone({ motion, paths, journal });
    motion.frames[0].trace.fragments[0].sourceRuns[0][0] = 0;
    paths.frames[0].paths.passes[0].segments[0].origin = 63;
    journal.events[0].changes.domains[0].channels.energy.count = 64;
    journal.events.length = 0;
    expect({
      motion: f.queue.motion(t),
      paths: f.queue.paths(t),
      journal: f.queue.journal(t),
    }).toEqual(expected);
    const c = f.queue.commit(t);
    expect(c.motion().frames).toEqual(expected.motion.frames);
    expect(c.paths().frames).toEqual(expected.paths.frames);
    expect(c.journal().events).toEqual(expected.journal.events);
    await f.queue.close();
  });
  test('observation reads cannot reenter a staging callback', async () => {
    const f = fixture();
    let queue!: TacticalPreviewQueue3D<Game, Game>, ticket!: TacticalPreviewTicket3D<Game>;
    queue = createTacticalPreviewQueue3D(f.session, (e, c) => {
      rejectsReads(queue, ticket);
      e.setGame(c);
    });
    ticket = queue.request({ ap: 1 }, 0, all);
    expect((await ticket.result).status).toBe('ready');
    expect(queue.journal(ticket).events).toHaveLength(1);
    await queue.close();
    await f.queue.close();
  });
  test('malformed driver observations fail atomically and release owned domain drivers', async () => {
    const f = fixture({ reservoir: true, malformed: true }),
      before = f.session.snapshot(),
      t = f.queue.request({ ap: 1 }, 1, all);
    expect((await t.result).status).toBe('failed');
    rejectsReads(f.queue, t);
    expect(f.session.snapshot()).toEqual(before);
    expect(f.closed.mock.calls.map((c) => c[0])).toEqual(['flask', null]);
    await f.queue.close();
  });
  test('capture observation failure rolls back terrain and game and allows a fresh request', async () => {
    const f = fixture({
        terrain: seed([[1, 0, 1, MAT.STONE]]),
        support: () => {
          throw Error('inert observer failure');
        },
      }),
      before = f.session.snapshot();
    const queue = createTacticalPreviewQueue3D(f.session, (e, c: Game) => {
      if (c.ap === 0) e.edit([{ kind: 'integrity', x: 1, y: 0, z: 1, integrity: 1 }]);
      e.setGame(c);
    });
    const bad = queue.request({ ap: 0 }, 0, { journal: {} });
    expect(await bad.result).toMatchObject({ status: 'failed', error: 'inert observer failure' });
    rejectsReads(queue, bad);
    expect(f.session.snapshot()).toEqual(before);
    const good = queue.request({ ap: 1 }, 0, all);
    expect((await good.result).status).toBe('ready');
    expect(queue.commit(good).snapshot.game.ap).toBe(1);
    await queue.close();
    await f.queue.close();
  });
  test('an unrepresentable absolute end tick rejects before replacing accepted work', async () => {
    const terrain = seed();
    terrain.tick = Number.MAX_SAFE_INTEGER;
    const f = fixture({ terrain }),
      t = f.queue.request({ ap: 1 }, 0, all);
    await t.result;
    expect(() => f.queue.request({ ap: 0 }, 1, all)).toThrow(/end tick/);
    expect(f.queue.state.readyId).toBe(t.id);
    expect(f.queue.journal(t).status).toBe('complete');
    await f.queue.close();
  });
});
