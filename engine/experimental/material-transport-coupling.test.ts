import { createMicrotaskTransport } from '../test-support/microtask-transport.js';
import { holdPhysics, STRUCTURAL_CALLS } from '../test-support/hold-physics.js';
/** Real conservative edits plus inert material provenance; native physics is held. */
import { describe, expect, test, vi } from 'vitest';
import { MAT } from './3d.js';
import { CpuStructuralWorld3D, type StructuralSnapshot3D } from './structural-world-core.js';

import { createMaterialTransport3D, applyMaterialTransport3D } from './material-transport.js';
import {
  captureMaterialTransportMemory3D as capture,
  restoreMaterialTransportMemory3D as restore,
  followMaterialTransport3D as follow,
  prepareMaterialTransport3D as prepare,
  type MaterialTransportMemory3D,
} from './material-transport-coupling.js';
import {
  createTacticalSessionCore3D,
  type TacticalSimulationFactory3D,
} from './tactical/tactical-session-core.js';
import {
  createTacticalPreviewQueue3D,
  type TacticalPreviewEditor3D,
} from './tactical/tactical-previews.js';
import { createTacticalWorkerHost3D } from './tactical/tactical-worker-host.js';
import { createTacticalWorkerClient3D } from './tactical/tactical-worker-client.js';

import type { TacticalSessionPolicy3D } from './tactical/tactical-session-view.js';
import { observe, type Spec } from './terrain/terrain-motion.fixtures.js';
holdPhysics('solveStructure3D', ...STRUCTURAL_CALLS);
type Game = { ap: number; rng: number; actor: number; wind: MaterialTransportMemory3D };
type Command = { impulse: number };
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const world = () => new CpuStructuralWorld3D({ width: 4, height: 4, depth: 4, chunkSize: 4 });
function initial(material: number = MAT.SAND) {
  const w = world();
  w.setCell(1, 1, 1, material);
  if (material === MAT.STONE) w.setIntegrity(1, 1, 1, 0);
  const terrain = w.snapshot();
  return {
    worldId: 'wind-room',
    gameRulesVersion: 'wind-game-1',
    terrain,
    game: {
      ap: 3,
      rng: 71,
      actor: 0,
      wind: capture(createMaterialTransport3D(terrain, [{ id: 'parcel', cell: [1, 1, 1] }])),
    },
  };
}
function fixture(
  options: {
    initial?: ReturnType<typeof initial>;
    spec?: (s: StructuralSnapshot3D) => Spec;
    pause?: Promise<void>;
    failTick?: number;
    actorFailure?: number;
    requiresPaths?: boolean;
    rejectCommit?: boolean;
  } = {},
) {
  const start = options.initial ?? initial(),
    contexts: Parameters<NonNullable<TacticalSessionPolicy3D<Game>['reduceTick']>>[0][] = [];
  let made = 0,
    closed = 0,
    steps = 0,
    translations = 0;
  const factory: TacticalSimulationFactory3D = (input) => {
    let s = structuredClone(input),
      result: ReturnType<typeof observe>;
    made++;
    return {
      load(v) {
        s = structuredClone(v);
      },
      async step() {
        steps++;
        await options.pause;
        if (steps === options.failTick) throw Error('inert tick failed');
        result = observe(s, options.spec?.(s) ?? { after: s });
        s = result.after;
      },
      snapshot: () => s,
      motion: () => result.motion,
      paths: () => result.paths,
      close() {
        closed++;
      },
    };
  };
  const policy: TacticalSessionPolicy3D<Game> = {
    requiresPaths: options.requiresPaths ?? true,
    validateGame({ game, terrain }) {
      restore(terrain, game.wind);
      return !(options.rejectCommit && game.ap < 3);
    },
    reduceTranslation({ game }) {
      translations++;
      if (translations === options.actorFailure) throw Error('actor cannot fit');
      return { ...game, actor: game.actor + 1 };
    },
    reduceTick(c) {
      contexts.push(c);
      return {
        ...c.game,
        wind: follow(c.beforeQueries(), c.queries(), c.movement(), c.game.wind).memory,
      };
    },
  };
  const support = (s: StructuralSnapshot3D) => ({
    distances: new Int32Array(s.packedCells.length).fill(-1),
    loads: new Uint32Array(s.packedCells.length),
    capacities: new Uint32Array(s.packedCells.length),
    reactions: new Uint32Array(s.packedCells.length),
  });
  const session = createTacticalSessionCore3D(start, factory, policy, async () => {}, support);
  return { session, contexts, counts: () => ({ made, closed, steps, translations }) };
}
function stage(e: TacticalPreviewEditor3D<Game>, c: Command) {
  prepare(
    e,
    e.inspect().game.wind,
    [{ id: 'parcel', impulseQ: [c.impulse, 0, 0] }],
    ({ game, memory }) => {
      if (game.ap < 1) throw Error('Insufficient AP');
      return { ...game, ap: game.ap - 1, wind: memory };
    },
  );
}
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function until(testValue: () => boolean) {
  for (let i = 0; i < 400; i++) {
    if (testValue()) return;
    await Promise.resolve();
  }
  throw Error('Expected inert progress.');
}

describe('material transport memory and complete-tick continuity', () => {
  test('compact memory owns only metadata parcel control and cell witnesses', () => {
    const s = initial(),
      memory = s.game.wind,
      state = restore(s.terrain, memory);
    expect(memory.rulesVersion).toBe('material-transport-memory-1');
    expect(Object.keys(memory.terrain)).not.toContain('packedCells');
    expect(memory.parcels[0]).toMatchObject({
      cell: 21,
      packed: s.terrain.packedCells[21],
      energyQ: s.terrain.energyQ[21],
      structure: 0,
    });
    expect(capture(state)).toEqual(memory);
    state.parcels[0].velocityQ[0] = 9;
    expect(memory.parcels[0].velocityQ).toEqual([0, 0, 0]);
  });
  test('stale ticks shapes versions and selected cell history reject', () => {
    const s = initial();
    for (const mutate of [
      (m: MaterialTransportMemory3D) => {
        m.terrain.tick++;
      },
      (m: MaterialTransportMemory3D) => {
        m.terrain.width = 8;
      },
      (m: MaterialTransportMemory3D) => {
        m.terrain.materialCatalogHash = 'other';
      },
      (m: MaterialTransportMemory3D) => {
        m.parcels[0].energyQ++;
      },
      (m: MaterialTransportMemory3D) => {
        m.parcels[0].packed ^= 1;
      },
      (m: MaterialTransportMemory3D) => {
        m.parcels[0].structure = 1;
      },
    ]) {
      const m = copy(s.game.wind);
      mutate(m);
      expect(() => restore(s.terrain, m)).toThrow();
    }
  });
  test('malformed memory rejects accessors sparse rows symbols and extra fields', () => {
    const s = initial(),
      get = vi.fn();
    for (const mutate of [
      (m: MaterialTransportMemory3D) => {
        Object.defineProperty(m, 'cycle', { get, enumerable: true });
      },
      (m: MaterialTransportMemory3D) => {
        delete (m.parcels as unknown[])[0];
      },
      (m: MaterialTransportMemory3D) => {
        Object.defineProperty(m.parcels[0], 'packed', { get, enumerable: true });
      },
      (m: MaterialTransportMemory3D) => {
        Object.defineProperty(m.terrain, Symbol('hidden'), { value: 1 });
      },
      (m: MaterialTransportMemory3D) => {
        Object.assign(m, { extra: 1 });
      },
      (m: MaterialTransportMemory3D) => {
        m.parcels = Array(257).fill(m.parcels[0]);
      },
    ]) {
      const bad = copy(s.game.wind);
      mutate(bad);
      expect(() => restore(s.terrain, bad)).toThrow();
    }
    expect(get).not.toHaveBeenCalled();
  });
  test('identity ticks refresh witnesses without applying another transport cycle', async () => {
    const f = fixture(),
      b = f.session.branch({ horizonTicks: 1 });
    stage(b, { impulse: 333 });
    const staged = b.inspect().game.wind;
    await b.advance(1);
    const after = b.inspect().game.wind;
    expect(after.cycle).toBe(1);
    expect(after.terrain.tick).toBe(1);
    expect(after.parcels).toEqual(staged.parcels);
    f.session.commit(b);
    expect(f.counts().closed).toBe(f.counts().made);
  });
  test('identical steam parcels follow original identities through a complete permutation', async () => {
    const s = initial(MAT.STEAM),
      w = world();
    w.restore(s.terrain);
    w.setCell(1, 2, 1, MAT.STEAM);
    s.terrain = w.snapshot();
    s.game.wind = capture(
      createMaterialTransport3D(s.terrain, [
        { id: 'a', cell: [1, 1, 1], velocityQ: [111, 0, 0] },
        { id: 'b', cell: [1, 2, 1], velocityQ: [-333, 0, 0] },
      ]),
    );
    const f = fixture({ initial: s, spec: () => ({ swaps: new Map([[2, [[21, 25]]]]) }) }),
      b = f.session.branch({ horizonTicks: 1 });
    await b.advance(1);
    const wind = b.inspect().game.wind;
    expect(wind.parcels.map((p) => [p.id, p.cell, p.velocityQ[0]])).toEqual([
      ['a', 25, 111],
      ['b', 21, -333],
    ]);
    expect(wind.cycle).toBe(0);
    expect(b.inspect().terrain.packedCells).toEqual(s.terrain.packedCells);
    b.discard();
  });
  test('solidification retires control while preserving the resulting material', async () => {
    const s = initial(MAT.WATER),
      w = world();
    w.restore(s.terrain);
    w.setEnergy(1, 1, 1, 0);
    s.terrain = w.snapshot();
    s.game.wind = capture(
      createMaterialTransport3D(s.terrain, [
        { id: 'parcel', cell: [1, 1, 1], velocityQ: [20, 0, 0] },
      ]),
    );
    w.setCell(1, 1, 1, MAT.ICE);
    w.setEnergy(1, 1, 1, 0);
    const ice = w.snapshot();
    const f = fixture({ initial: s, spec: () => ({ after: ice }) }),
      b = f.session.branch({ horizonTicks: 1 });
    await b.advance(1);
    const c = f.contexts[0],
      followed = follow(c.beforeQueries(), c.queries(), c.movement(), c.game.wind);
    expect(followed.retired).toEqual([
      { id: 'parcel', source: 21, destination: 21, reason: 'immobile' },
    ]);
    expect(followed.memory.parcels).toEqual([]);
    expect(b.inspect().terrain.packedCells[21] & 255).toBe(MAT.ICE);
    expect(b.inspect().accounting).toEqual(f.session.snapshot().accounting);
    b.discard();
  });
  test('condensation retains control velocity and refreshes material witnesses', async () => {
    const s = initial(MAT.STEAM),
      w = world();
    w.restore(s.terrain);
    w.setEnergy(1, 1, 1, 0);
    s.terrain = w.snapshot();
    s.game.wind = capture(
      createMaterialTransport3D(s.terrain, [
        { id: 'parcel', cell: [1, 1, 1], velocityQ: [333, 0, 0] },
      ]),
    );
    w.setCell(1, 1, 1, MAT.WATER);
    w.setEnergy(1, 1, 1, 0);
    const water = w.snapshot();
    const f = fixture({ initial: s, spec: () => ({ after: water }) }),
      b = f.session.branch({ horizonTicks: 1 });
    await b.advance(1);
    const m = b.inspect().game.wind;
    expect(m.parcels[0].packed & 255).toBe(MAT.WATER);
    expect(m.parcels[0].velocityQ).toEqual([333, 0, 0]);
    b.discard();
  });
  test('cloned foreign and mixed-boundary observations reject', async () => {
    const f = fixture(),
      b = f.session.branch({ horizonTicks: 2 });
    await b.advance(2);
    const [a, c] = f.contexts;
    expect(() => follow(a.beforeQueries(), a.queries(), copy(a.movement()), a.game.wind)).toThrow(
      /live tick/,
    );
    expect(() => follow(a.beforeQueries(), c.queries(), a.movement(), a.game.wind)).toThrow(
      /boundaries/,
    );
    expect(() => follow(f.session.queries(), a.queries(), a.movement(), a.game.wind)).toThrow(
      /boundaries/,
    );
    b.discard();
  });
  test('mutating public motion reports cannot alter private parcel correspondence', async () => {
    const f = fixture({ spec: () => ({ swaps: new Map([[2, [[21, 25]]]]) }) }),
      b = f.session.branch({ horizonTicks: 1 });
    await b.advance(1);
    const c = f.contexts[0],
      observed = c.movement();
    observed.motion!.moves = [];
    observed.status = 'disabled';
    expect(
      follow(c.beforeQueries(), c.queries(), observed, c.game.wind).memory.parcels[0].cell,
    ).toBe(25);
    b.discard();
  });
  test('double-following rejects the already advanced memory tick', async () => {
    const f = fixture(),
      b = f.session.branch({ horizonTicks: 1 });
    await b.advance(1);
    const c = f.contexts[0];
    expect(() =>
      follow(c.beforeQueries(), c.queries(), c.movement(), b.inspect().game.wind),
    ).toThrow(/tick differs/);
    b.discard();
  });
  test('disabled and overflow provenance fail the action instead of guessing', async () => {
    for (const f of [
      fixture({ requiresPaths: false }),
      fixture({ spec: () => ({ overflow: true, swaps: new Map([[2, [[21, 25]]]]) }) }),
    ]) {
      const before = f.session.snapshot(),
        b = f.session.branch({ horizonTicks: 1 });
      await expect(b.advance(1)).rejects.toThrow(/complete material provenance/);
      expect(f.session.snapshot()).toEqual(before);
      expect(() => f.session.commit(b)).toThrow();
      expect(f.counts().closed).toBe(f.counts().made);
    }
  });
});

describe('atomic transport preparation in branches and workers', () => {
  test('fraction-only preparation publishes saved momentum and AP atomically', () => {
    const f = fixture(),
      before = f.session.snapshot(),
      b = f.session.branch({ horizonTicks: 0 });
    stage(b, { impulse: 512 });
    expect(b.inspect().terrain).toEqual(before.terrain);
    expect(b.inspect().game.wind.parcels[0].remainderQ).toEqual([512, 0, 0]);
    expect(f.session.snapshot()).toEqual(before);
    const result = f.session.commit(b).snapshot;
    expect(result.game.ap).toBe(2);
    expect(result.game.rng).toBe(71);
    expect(result.game.wind.cycle).toBe(1);
  });
  test('full transport matches the primitive and retains translation actor policy', () => {
    const f = fixture(),
      before = f.session.snapshot(),
      b = f.session.branch({ horizonTicks: 0 });
    stage(b, { impulse: 1024 });
    const expected = applyMaterialTransport3D(restore(before.terrain, before.game.wind), [
      { id: 'parcel', impulseQ: [1024, 0, 0] },
    ]);
    expect(b.inspect().terrain).toEqual(expected.state.terrain);
    expect(b.inspect().game.wind).toEqual(capture(expected.state));
    expect(b.inspect().game.actor).toBe(1);
    const result = f.session.commit(b).snapshot;
    expect(result.accounting).toEqual(before.accounting);
    expect(result.game.ap).toBe(2);
  });
  test('one multi-axis parcel path uses one translation operation and one game write', () => {
    const f = fixture(),
      b = f.session.branch({ horizonTicks: 0 });
    prepare(
      b,
      b.inspect().game.wind,
      [{ id: 'parcel', impulseQ: [1024, 1024, 1024] }],
      ({ game, memory }) => ({ ...game, wind: memory }),
    );
    expect(b.inspect().preview.operation).toBe(2);
    expect(f.counts().translations).toBe(1);
    expect(b.inspect().game.wind.parcels[0].cell).toBe(42);
    b.discard();
  });
  test('journal retains complete translation paths and the final game boundary', () => {
    const f = fixture(),
      b = f.session.branch({ horizonTicks: 0, captureJournal: true });
    stage(b, { impulse: 2048 });
    const journal = b.journal();
    expect(journal.status).toBe('complete');
    expect(journal.events.map((e) => e.action.kind)).toEqual(['translate', 'game']);
    const first = journal.events[0].action;
    if (first.kind !== 'translate') throw Error('Missing translation');
    expect(first.receipt.path).toEqual([
      [1, 0, 0],
      [1, 0, 0],
    ]);
    b.discard();
  });
  test('a throwing final game reducer discards the whole translated candidate', () => {
    const f = fixture(),
      before = f.session.snapshot(),
      b = f.session.branch({ horizonTicks: 0 });
    expect(() =>
      prepare(b, before.game.wind, [{ id: 'parcel', impulseQ: [1024, 0, 0] }], () => {
        throw Error('AP rejected');
      }),
    ).toThrow(/AP rejected/);
    expect(f.counts().translations).toBe(1);
    expect(b.status).toBe('failed');
    expect(() => f.session.commit(b)).toThrow();
    expect(f.session.snapshot()).toEqual(before);
  });
  test('invalid asynchronous and nonportable game callbacks cannot publish prefixes', async () => {
    for (const callback of [
      () => Promise.reject(Error('async callback')),
      () => ({ bad: () => {} }),
    ]) {
      const f = fixture(),
        before = f.session.snapshot(),
        b = f.session.branch({ horizonTicks: 0 });
      expect(() =>
        prepare(b, before.game.wind, [{ id: 'parcel', impulseQ: [1024, 0, 0] }], callback as never),
      ).toThrow();
      expect(() => f.session.commit(b)).toThrow();
      expect(f.session.snapshot()).toEqual(before);
    }
    await Promise.resolve();
  });
  test('game reducers cannot reenter commit restore or sibling mutation before costs publish', () => {
    for (const operation of ['commit', 'restore', 'sibling'] as const) {
      const f = fixture(),
        before = f.session.snapshot(),
        b = f.session.branch({ horizonTicks: 0 }),
        sibling = f.session.branch({ horizonTicks: 0 });
      expect(() =>
        prepare(
          b,
          before.game.wind,
          [{ id: 'parcel', impulseQ: [333, 0, 0] }],
          ({ game, memory }) => {
            if (operation === 'commit') f.session.commit(b);
            else if (operation === 'restore') f.session.restore(before);
            else sibling.setGame({ ...before.game, ap: 0 });
            return { ...game, ap: game.ap - 1, wind: memory };
          },
        ),
      ).toThrow();
      expect(f.session.snapshot()).toEqual(before);
      expect(sibling.inspect().game).toEqual(before.game);
      expect(() => f.session.commit(b)).toThrow();
      sibling.discard();
    }
  });
  test('guarded game updates own callback inputs and expire with the preview editor', async () => {
    const f = fixture(),
      before = f.session.snapshot(),
      b = f.session.branch({ horizonTicks: 0 });
    let exposed!: Game;
    b.updateGame((game) => {
      exposed = game;
      return { ...game, ap: 2 };
    });
    exposed.wind.parcels[0].velocityQ[0] = 9;
    expect(b.inspect().game.wind).toEqual(before.game.wind);
    expect(f.session.snapshot()).toEqual(before);
    b.discard();
    let editor!: TacticalPreviewEditor3D<Game>;
    const queue = createTacticalPreviewQueue3D<Game, null>(f.session, (e) => {
      editor = e;
    });
    await queue.request(null, 0).result;
    expect(() => editor.updateGame((game) => game)).toThrow(/expired/);
    await queue.close();
  });
  test('late actor rejection discards earlier parcel motion', () => {
    const s = initial(),
      w = world();
    w.restore(s.terrain);
    w.setCell(1, 1, 2, MAT.SAND);
    s.terrain = w.snapshot();
    s.game.wind = capture(
      createMaterialTransport3D(s.terrain, [
        { id: 'a', cell: [1, 1, 1] },
        { id: 'b', cell: [1, 1, 2] },
      ]),
    );
    const f = fixture({ initial: s, actorFailure: 2 }),
      before = f.session.snapshot(),
      b = f.session.branch({ horizonTicks: 0 });
    expect(() =>
      prepare(
        b,
        s.game.wind,
        [
          { id: 'a', impulseQ: [1024, 0, 0] },
          { id: 'b', impulseQ: [1024, 0, 0] },
        ],
        ({ game, memory }) => ({ ...game, wind: memory }),
      ),
    ).toThrow(/actor cannot fit/);
    expect(f.counts().translations).toBe(2);
    expect(() => f.session.commit(b)).toThrow();
    expect(f.session.snapshot()).toEqual(before);
  });
  test('operation budget includes game publication and rejects before the first move', () => {
    for (const existing of [254, 255]) {
      const f = fixture(),
        before = f.session.snapshot(),
        b = f.session.branch({ horizonTicks: 0 });
      for (let i = 0; i < existing; i++) b.setGame(before.game);
      if (existing === 254) {
        stage(b, { impulse: 1024 });
        expect(b.inspect().preview.operation).toBe(256);
        b.discard();
      } else {
        expect(() => stage(b, { impulse: 1024 })).toThrow(/operation budget/);
        expect(f.counts().translations).toBe(0);
        expect(() => f.session.commit(b)).toThrow();
      }
      expect(f.session.snapshot()).toEqual(before);
    }
  });
  test('commit validation rejects incorrectly saved memory after successful staging', () => {
    const f = fixture(),
      before = f.session.snapshot(),
      b = f.session.branch({ horizonTicks: 0 });
    prepare(b, before.game.wind, [{ id: 'parcel', impulseQ: [1024, 0, 0] }], ({ game }) => game);
    expect(() => f.session.commit(b)).toThrow();
    expect(f.session.snapshot()).toEqual(before);
  });
  test('temporary structural holds still block controlled debris transport', () => {
    const s = initial(MAT.STONE),
      w = world();
    w.restore(s.terrain);
    w.setIntegrity(1, 1, 1, 0);
    s.terrain = w.snapshot();
    s.game.wind = capture(
      createMaterialTransport3D(s.terrain, [{ id: 'parcel', cell: [1, 1, 1] }]),
    );
    const f = fixture({ initial: s }),
      before = f.session.snapshot(),
      b = f.session.branch({ horizonTicks: 0 });
    b.hold({ id: 'pin', cells: [[1, 1, 1]], expiresAtTick: 2 });
    expect(() => stage(b, { impulse: 1024 })).toThrow();
    expect(() => f.session.commit(b)).toThrow();
    expect(f.session.snapshot()).toEqual(before);
  });
  test('a new sibling revision invalidates a staged transport preview', () => {
    const f = fixture(),
      a = f.session.branch({ horizonTicks: 0 }),
      b = f.session.branch({ horizonTicks: 0 });
    stage(a, { impulse: 1024 });
    b.setGame({ ...b.inspect().game, rng: 81 });
    f.session.commit(b);
    const newer = f.session.snapshot();
    expect(() => f.session.commit(a)).toThrow();
    expect(f.session.snapshot()).toEqual(newer);
  });
  test('inert tick failure after transport cannot publish actors AP or terrain', async () => {
    const f = fixture({ failTick: 2 }),
      before = f.session.snapshot(),
      b = f.session.branch({ horizonTicks: 2 });
    stage(b, { impulse: 1024 });
    await expect(b.advance(2)).rejects.toThrow(/inert tick failed/);
    expect(f.session.snapshot()).toEqual(before);
    expect(() => f.session.commit(b)).toThrow();
    expect(f.counts().closed).toBe(f.counts().made);
  });
  test('serialized continuation preserves memory future transport and complete terrain', async () => {
    const a = fixture(),
      first = a.session.branch({ horizonTicks: 1 });
    stage(first, { impulse: 333 });
    await first.advance(1);
    const saved = a.session.commit(first).snapshot;
    const b = fixture();
    b.session.restore(copy(saved));
    const results = [];
    for (const f of [a, b]) {
      const next = f.session.branch({ horizonTicks: 2 });
      stage(next, { impulse: 0 });
      await next.advance(2);
      results.push(f.session.commit(next).snapshot);
    }
    expect(results[0]).toEqual(results[1]);
  });
  test('a swallowed helper error inside preview preparation still cannot become ready', async () => {
    const f = fixture(),
      before = f.session.snapshot(),
      queue = createTacticalPreviewQueue3D<Game, null>(f.session, (e) => {
        try {
          prepare(e, e.inspect().game.wind, [{ id: 'parcel', impulseQ: [1024, 0, 0] }], () => {
            throw Error('late failure');
          });
        } catch {
          /* Deliberately swallow the error. */
        }
      });
    const ticket = queue.request(null, 0);
    expect((await ticket.result).status).toBe('failed');
    expect(f.session.snapshot()).toEqual(before);
    await queue.close();
  });
  test('cancelling an in-flight transport preview preserves the acknowledged state', async () => {
    const pause = deferred(),
      f = fixture({ pause: pause.promise }),
      before = f.session.snapshot(),
      queue = createTacticalPreviewQueue3D(f.session, stage);
    const ticket = queue.request({ impulse: 1024 }, 1);
    await until(() => f.counts().steps === 1);
    ticket.cancel();
    pause.resolve();
    expect((await ticket.result).status).toBe('cancelled');
    expect(f.session.snapshot()).toEqual(before);
    await queue.close();
    expect(f.counts().closed).toBe(f.counts().made);
  });
  test('preview discard capability expires after preparation', async () => {
    const f = fixture();
    let held!: TacticalPreviewEditor3D<Game>;
    const queue = createTacticalPreviewQueue3D<Game, null>(f.session, (e) => {
      held = e;
    });
    const ticket = queue.request(null, 0);
    expect((await ticket.result).status).toBe('ready');
    expect(() => held.discard()).toThrow(/expired/);
    queue.commit(ticket);
    await queue.close();
  });
  test('mocked worker carries transport memory costs and translation journals exactly', async () => {
    const f = fixture(),
      { ports } = createMicrotaskTransport();
    const host = createTacticalWorkerHost3D(ports[1], f.session, stage, 'wind-test');
    const client = createTacticalWorkerClient3D<Game, Command>(ports[0], {
      channel: 'wind-test',
      worldId: 'wind-room',
      gameRulesVersion: 'wind-game-1',
    });
    await client.ready;
    const ticket = client.request({ impulse: 1024 }, 1, {
        journal: { maxRuns: 4096 },
        paths: { maxEntries: 4096 },
      }),
      outcome = await ticket.result;
    expect(outcome.status).toBe('ready');
    const committed = await client.commit(ticket);
    expect(client.snapshot()).toEqual(f.session.snapshot());
    expect(client.snapshot().game.ap).toBe(2);
    const journal = await client.journal(committed);
    expect(journal.events.map((e) => e.action.kind)).toEqual(['translate', 'game', 'tick']);
    await client.close();
    await host.close();
    expect(f.counts().closed).toBe(f.counts().made);
  });
});
