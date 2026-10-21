import { holdPhysics } from '../test-support/hold-physics.js';
/** Edit-only regressions. All real material steps and support solves are trapped. */
import { describe, expect, test, vi } from 'vitest';
import { MAT, ENERGY_SCALE } from './3d.js';
import * as mechanics from './structural-mechanics.js';
import * as interventions from './interventions.js';
import * as paths from './translation-paths.js';
import { CpuStructuralWorld3D, type StructuralSnapshot3D } from './structural-world-core.js';
import { createTacticalSession3D } from './tactical-session.js';
import {
  createTacticalSessionCore3D,
  type TacticalSimulationFactory3D,
} from './tactical/tactical-session-core.js';
import { gameplayGeometrySource3D } from './gameplay-geometry.js';
import type { CellCoordinate3D, TranslationRequest3D } from './interventions.js';
import type { TranslationAction3D, TranslationMovement3D } from './translation-paths.js';
import type {
  TacticalSessionPolicy3D,
  TacticalBranch3D,
} from './tactical/tactical-session-view.js';
import type { SupportObserver3D } from './change-reports.js';

holdPhysics('solveStructure3D', 'step', 'stepWithMotion', 'stepWithMotionPaths');
const world = () => new CpuStructuralWorld3D({ width: 8, height: 8, depth: 8, chunkSize: 4 });
const index = ([x, y, z]: CellCoordinate3D) => x + 8 * (y + 8 * z);
const request: TranslationRequest3D = { cells: [[3, 3, 3]], path: [[1, 0, 0]] };
const translate = paths.translateStructuralRegionWithPaths3D;
const originalTranslate = interventions.translateStructuralRegion3D;
type Game = { ap: number; position: number };
function seed() {
  const w = world();
  w.setCell(3, 3, 3, MAT.STONE, 150);
  w.setIntegrity(3, 3, 3, 73);
  return w.snapshot();
}
function initial(terrain = seed()) {
  return {
    worldId: 'translation-world',
    gameRulesVersion: 'translation-game-1',
    terrain,
    game: { ap: 2, position: index([3, 3, 3]) },
  };
}
const emptySupport: SupportObserver3D = (s) => ({
  distances: new Int32Array(s.packedCells.length).fill(-1),
  loads: new Uint32Array(s.packedCells.length),
  capacities: new Uint32Array(s.packedCells.length),
  reactions: new Uint32Array(s.packedCells.length),
});
function fixture(policy: TacticalSessionPolicy3D<Game> = {}, terrain = seed()) {
  const factory = vi.fn<TacticalSimulationFactory3D>(() => {
    throw Error('Zero-horizon fixture must not create a simulation driver.');
  });
  const observer = vi.fn(emptySupport),
    s = createTacticalSessionCore3D(initial(terrain), factory, policy, async () => {}, observer);
  return { s, factory, observer };
}
const at = (s: StructuralSnapshot3D, i: number) => [s.packedCells[i], s.energyQ[i], s.structure[i]];
function exact(before: StructuralSnapshot3D, req: TranslationRequest3D) {
  const saved = structuredClone(before),
    actual = translate(before, req),
    expected = originalTranslate(before, req);
  expect(actual.snapshot).toEqual(expected.snapshot);
  expect(actual.receipt).toEqual(expected.receipt);
  expect(before).toEqual(saved);
  expect(actual.snapshot.energyQ.reduce((n, q) => n + BigInt(q), 0n)).toBe(
    before.energyQ.reduce((n, q) => n + BigInt(q), 0n),
  );
  expect(actual.snapshot.packedCells.map((n) => n & 255).sort((a, b) => a - b)).toEqual(
    before.packedCells.map((n) => n & 255).sort((a, b) => a - b),
  );
  expect(actual.receipt.externalEnergyQ).toBe(0n);
  return actual;
}

describe('canonical translation receipt expansion', () => {
  test('all six cardinal directions preserve hot damaged overlapping runs and internal bonds', () => {
    for (const axis of [0, 1, 2])
      for (const sign of [-1, 1]) {
        const a: [number, number, number] = [3, 3, 3],
          b: [number, number, number] = [3, 3, 3],
          delta: [number, number, number] = [0, 0, 0];
        b[axis]++;
        delta[axis] = sign;
        const w = world();
        w.setCell(...a, MAT.STONE, 100);
        w.setCell(...b, MAT.GLASS, 120);
        w.setIntegrity(...a, 71);
        w.setIntegrity(...b, 129);
        const before = w.snapshot(),
          r = exact(before, { cells: [b, a], path: [delta] });
        for (const cell of [a, b]) {
          const to = index(cell.map((n, k) => n + delta[k]) as [number, number, number]);
          expect(at(r.snapshot, to)).toEqual(at(before, index(cell)));
          expect(r.paths.passes[0].segments).toContainEqual({
            origin: index(cell),
            from: index(cell),
            to,
            mode: 'linear',
          });
        }
        expect(r.paths).toMatchObject({
          status: 'complete',
          controlledCells: 2,
          stepsObserved: 1,
          cellTransfers: 3,
          derivation: 'canonical-receipt-expansion',
        });
      }
  });
  test('run terminal occupants relocate to the head without invented transit through the slab', () => {
    const w = world();
    for (const x of [2, 3, 4]) w.setCell(x, 3, 3, MAT.STONE);
    w.setEnergy(5, 3, 3, 75 * ENERGY_SCALE);
    const r = exact(w.snapshot(), {
      cells: [
        [2, 3, 3],
        [3, 3, 3],
        [4, 3, 3],
      ],
      path: [[1, 0, 0]],
    });
    expect(r.paths.passes[0].segments.filter((s) => s.mode === 'relocation')).toEqual([
      {
        origin: index([5, 3, 3]),
        from: index([5, 3, 3]),
        to: index([2, 3, 3]),
        mode: 'relocation',
      },
    ]);
    expect(r.snapshot.energyQ[index([2, 3, 3])]).toBe(75 * ENERGY_SCALE);
  });
  test('direction changes retain original identities and deterministic source order', () => {
    const w = world();
    w.setCell(2, 3, 3, MAT.STONE);
    w.setCell(4, 3, 3, MAT.GLASS);
    const req: TranslationRequest3D = {
        cells: [
          [4, 3, 3],
          [2, 3, 3],
        ],
        path: [
          [1, 0, 0],
          [0, -1, 0],
          [0, 0, 1],
        ],
      },
      r = exact(w.snapshot(), req);
    expect(translate(w.snapshot(), { ...req, cells: [...req.cells].reverse() })).toEqual(r);
    expect(r.paths.controlledSources).toEqual([index([2, 3, 3]), index([4, 3, 3])]);
    for (const p of r.paths.passes)
      expect(p.segments.filter((s) => s.mode === 'linear').map((s) => s.origin)).toEqual(
        r.paths.controlledSources,
      );
  });
  test('out-and-back paths survive an empty endpoint edit receipt', () => {
    const before = seed(),
      r = exact(before, {
        ...request,
        path: [
          [1, 0, 0],
          [-1, 0, 0],
        ],
      });
    expect(r.snapshot).toEqual(before);
    expect(r.receipt.editedCells).toHaveLength(0);
    expect(r.paths.passes).toHaveLength(2);
    expect(r.paths.cellTransfers).toBe(4);
    expect(r.paths.passes[1].segments).toContainEqual({
      origin: index([4, 3, 3]),
      from: index([3, 3, 3]),
      to: index([4, 3, 3]),
      mode: 'relocation',
    });
  });
  test('displaced sand water and steam preserve original energy across successive exchanges', () => {
    for (const material of [MAT.SAND, MAT.WATER, MAT.STEAM]) {
      const w = world();
      w.setCell(3, 3, 3, MAT.STONE, 150);
      w.setCell(4, 3, 3, material, 90);
      w.setCell(5, 3, 3, material, 40);
      const before = w.snapshot(),
        r = exact(before, {
          ...request,
          path: [
            [1, 0, 0],
            [1, 0, 0],
          ],
          displacement: 'mobile',
        });
      expect(at(r.snapshot, index([3, 3, 3]))).toEqual(at(before, index([4, 3, 3])));
      expect(at(r.snapshot, index([4, 3, 3]))).toEqual(at(before, index([5, 3, 3])));
      expect(r.paths.passes[1].segments).toContainEqual({
        origin: index([5, 3, 3]),
        from: index([5, 3, 3]),
        to: index([4, 3, 3]),
        mode: 'relocation',
      });
    }
  });
  test('explicit cuts and pin releases preserve damage and external anchors without welding', () => {
    const w = world();
    for (const x of [2, 3, 4]) {
      w.setCell(x, 3, 3, MAT.STONE);
      w.setIntegrity(x, 3, 3, 61);
    }
    w.setAnchor(2, 3, 3, true);
    w.setAnchor(3, 3, 3, true);
    const r = exact(w.snapshot(), {
      ...request,
      path: [[0, -1, 0]],
      externalBonds: 'cut',
      anchors: 'release',
    });
    expect(r.receipt.cutBonds).toHaveLength(2);
    expect(r.receipt.releasedAnchors).toEqual(Uint32Array.of(index([3, 3, 3])));
    expect(r.snapshot.structure[index([3, 2, 3])]).toBe(61);
    expect(r.snapshot.structure[index([2, 3, 3])]).toBe(61 | mechanics.ANCHOR_3D);
  });
  test('late obstruction or boundary failure leaves every input coordinate untouched', () => {
    const w = world();
    w.setCell(3, 3, 3, MAT.STONE);
    w.setCell(5, 3, 3, MAT.STONE);
    for (const [before, req] of [
      [
        w.snapshot(),
        {
          ...request,
          path: [
            [1, 0, 0],
            [1, 0, 0],
          ],
        },
      ],
      [seed(), { ...request, path: Array(5).fill([0, -1, 0]) }],
    ] as [StructuralSnapshot3D, TranslationRequest3D][]) {
      const saved = structuredClone(before);
      expect(() => translate(before, req)).toThrow();
      expect(before).toEqual(saved);
    }
  });
  test('one identity one header and two segments require exactly four detail entries', () => {
    expect(translate(seed(), request, { maxEntries: 4 }).paths).toMatchObject({
      status: 'complete',
      requiresReexecution: false,
      controlledSources: [index([3, 3, 3])],
    });
    expect(translate(seed(), request, { maxEntries: 3 }).paths).toMatchObject({
      status: 'overflow',
      requiresReexecution: true,
      controlledSources: [],
      passes: [],
      cellTransfers: 2,
    });
  });
  test('late overflow clears the whole path prefix while retaining complete counts and state', () => {
    const req: TranslationRequest3D = {
        ...request,
        path: [
          [1, 0, 0],
          [-1, 0, 0],
        ],
      },
      complete = translate(seed(), req, { maxEntries: 7 }),
      overflow = translate(seed(), req, { maxEntries: 6 });
    expect(overflow.snapshot).toEqual(complete.snapshot);
    expect(overflow.receipt).toEqual(complete.receipt);
    expect(overflow.paths).toMatchObject({
      status: 'overflow',
      controlledSources: [],
      passes: [],
      controlledCells: 1,
      stepsObserved: 2,
      cellTransfers: 4,
    });
  });
  test('zero detail budget reports overflow without discarding the executed operation', () => {
    const r = translate(seed(), request, { maxEntries: 0 });
    expect(r.paths.status).toBe('overflow');
    expect(r.receipt.destinations).toEqual(Uint32Array.of(index([4, 3, 3])));
  });
  test('invalid options including accessors fail before executing translation', () => {
    const spy = vi.spyOn(interventions, 'translateStructuralRegion3D'),
      get = vi.fn(() => 4);
    try {
      for (const options of [
        null,
        [],
        { extra: 1 },
        { maxEntries: -1 },
        { maxEntries: 65537 },
        { maxEntries: 0.5 },
        { maxEntries: NaN },
        Object.create({ maxEntries: 4 }),
        Object.defineProperty({}, 'maxEntries', { enumerable: true, get }),
      ])
        expect(() => translate(seed(), request, options as never)).toThrow();
      expect(get).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  test('receipt path and input/result storage cannot alias retained path detail', () => {
    const before = seed(),
      saved = structuredClone(before),
      r = translate(before, request),
      expected = paths.copyTranslationPaths3D(r.paths);
    r.receipt.path[0] = [-1, 0, 0];
    r.receipt.sources.fill(0);
    r.snapshot.structure.fill(0);
    r.snapshot.energyQ.fill(0);
    expect(r.paths).toEqual(expected);
    expect(before).toEqual(saved);
    const copied = paths.copyTranslationPaths3D(r.paths);
    copied.controlledSources[0] = 0;
    copied.passes[0].segments[0].origin = 0;
    copied.passes[0].delta = [0, 1, 0];
    expect(r.paths).toEqual(expected);
  });
  test('complete-state verification rejects a wrong packed energy or structure coordinate', () => {
    for (const key of ['packedCells', 'energyQ', 'structure'] as const) {
      const spy = vi
        .spyOn(interventions, 'translateStructuralRegion3D')
        .mockImplementation((s, q) => {
          const r = originalTranslate(s, q);
          r.snapshot[key][0] ^= 1;
          return r;
        });
      try {
        expect(() => translate(seed(), request)).toThrow(/executed complete state/);
      } finally {
        spy.mockRestore();
      }
    }
  });
  test('receipt and output identity or coordinate length mismatches fail closed', () => {
    const mutations: ((r: interventions.TranslationResult3D) => void)[] = [
      (r) => {
        r.receipt.tick++;
      },
      (r) => {
        r.receipt.externalEnergyQ = 1n;
      },
      (r) => {
        r.snapshot.tick++;
      },
      (r) => {
        r.snapshot.energyQ.push(0);
      },
      (r) => {
        r.receipt.destinations = new Uint32Array();
      },
      (r) => {
        r.receipt.destinations[0]++;
      },
    ];
    for (const mutate of mutations) {
      const spy = vi
        .spyOn(interventions, 'translateStructuralRegion3D')
        .mockImplementation((s, q) => {
          const r = originalTranslate(s, q);
          mutate(r);
          return r;
        });
      try {
        expect(() => translate(seed(), request)).toThrow();
      } finally {
        spy.mockRestore();
      }
    }
  });
});

describe('atomic translation game reduction and boundary observations', () => {
  test('public zero-horizon translation reports before and after at one physical tick', () => {
    const s = createTacticalSession3D(initial()),
      b = s.branch({ horizonTicks: 0 }),
      before = s.snapshot(),
      a = b.translateWithMotion(request);
    expect(a.beforeQueries().stamp).toMatchObject({ kind: 'preview', operation: 0, tick: 0 });
    expect(a.queries().stamp).toMatchObject({ kind: 'preview', operation: 1, tick: 0 });
    expect(a.movement().from).toEqual(a.beforeQueries().stamp);
    expect(a.movement().to).toEqual(a.queries().stamp);
    expect(s.snapshot()).toEqual(before);
    expect(s.commit(b).snapshot.terrain).toEqual(
      originalTranslate(before.terrain, request).snapshot,
    );
  });
  test('default plain translation avoids path reconstruction and lazy geometry', () => {
    const spy = vi.spyOn(paths, 'translateStructuralRegionWithPaths3D');
    try {
      const { s, factory, observer } = fixture(),
        b = s.branch({ horizonTicks: 0 });
      b.translate(request);
      s.commit(b);
      expect(spy).not.toHaveBeenCalled();
      expect(factory).not.toHaveBeenCalled();
      expect(observer).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  test('normal translation captures when a frozen reducer needs it and commits game with terrain', () => {
    const reducer = vi.fn<NonNullable<TacticalSessionPolicy3D<Game>['reduceTranslation']>>(
      ({ game, receipt, tick, beforeQueries, queries, movement }) => {
        expect(tick).toBe(0);
        expect(movement().status).toBe('complete');
        expect(movement().from).toEqual(beforeQueries().stamp);
        expect(movement().to).toEqual(queries().stamp);
        return { ...game, ap: game.ap - 1, position: receipt.destinations[0] };
      },
    );
    const policy = { reduceTranslation: reducer },
      { s } = fixture(policy);
    policy.reduceTranslation = vi.fn(() => {
      throw Error('Replacement must not run.');
    });
    const before = s.snapshot(),
      b = s.branch({ horizonTicks: 0 });
    b.translate(request);
    expect(s.snapshot()).toEqual(before);
    const saved = s.commit(b).snapshot;
    expect(saved.game).toEqual({ ap: 1, position: index([4, 3, 3]) });
    expect(saved.accounting).toEqual(before.accounting);
    expect(reducer).toHaveBeenCalledTimes(1);
  });
  test('policy game receipt and public movement mutations cannot corrupt private histories', () => {
    let observed!: TranslationMovement3D;
    const { s } = fixture({
      reduceTranslation: ({ game, receipt, movement }) => {
        game.ap--;
        receipt.sources.fill(0);
        receipt.destinations.fill(0);
        receipt.path[0] = [-1, 0, 0];
        observed = movement();
        observed.paths.passes[0].segments[0].origin = 0;
        return game;
      },
    });
    const b = s.branch({ horizonTicks: 0 }),
      a = b.translateWithMotion(request);
    a.receipt.sources.fill(0);
    expect(a.movement().paths.controlledSources).toEqual([index([3, 3, 3])]);
    expect(paths.translationMovementSource3D(observed).paths.passes[0].segments[0].origin).not.toBe(
      0,
    );
    expect(s.commit(b).snapshot.game.ap).toBe(1);
  });
  test('a throwing reducer leaves all live domains holds game and accounting intact', () => {
    const w = world();
    w.setCell(3, 3, 3, MAT.STONE, 150);
    w.setCell(1, 1, 1, MAT.STONE);
    const source = {
      ...initial(w.snapshot()),
      reservoirs: [{ id: 'flask', terrain: seed() }],
      holds: [{ id: 'other', cells: [index([1, 1, 1])], expiresAtTick: 2 }],
    };
    const s = createTacticalSessionCore3D(
      source,
      () => {
        throw Error('Unexpected physical driver.');
      },
      {
        reduceTranslation: ({ game }) => {
          game.ap = 0;
          throw Error('Actor collision');
        },
      },
      async () => {},
      emptySupport,
    );
    const saved = s.snapshot(),
      b = s.branch({ horizonTicks: 0, captureJournal: true });
    b.addEnergy([{ x: 3, y: 3, z: 3, deltaQ: 3 }]);
    expect(() => b.translateWithMotion(request)).toThrow(/Actor collision/);
    expect(b.status).toBe('failed');
    expect(s.snapshot()).toEqual(saved);
    expect(() => b.journal()).toThrow(/failed/);
  });
  test('asynchronous reducers fail without publishing and their rejected promise is observed', async () => {
    const { s } = fixture({
        reduceTranslation: (async () => {
          throw Error('asynchronous failure');
        }) as never,
      }),
      saved = s.snapshot(),
      b = s.branch({ horizonTicks: 0 });
    expect(() => b.translate(request)).toThrow(/synchronous/);
    await Promise.resolve();
    expect(s.snapshot()).toEqual(saved);
    expect(b.status).toBe('failed');
  });
  test('nonportable reducer output fails before branch publication', () => {
    const { s } = fixture({ reduceTranslation: () => ({ ap: NaN, position: 0 }) }),
      saved = s.snapshot(),
      b = s.branch({ horizonTicks: 0 });
    expect(() => b.translate(request)).toThrow(/finite/);
    expect(b.status).toBe('failed');
    expect(s.snapshot()).toEqual(saved);
  });
  test('reentrant edits commits restores and branch creation are rejected atomically', () => {
    for (const kind of ['edit', 'commit', 'restore', 'branch']) {
      let intervene!: () => void;
      const { s } = fixture({
          reduceTranslation: ({ game }) => {
            intervene();
            return game;
          },
        }),
        saved = s.snapshot(),
        b = s.branch({ horizonTicks: 0 });
      intervene = () => {
        if (kind === 'edit') b.setGame({ ap: 0, position: 0 });
        else if (kind === 'commit') s.commit(b);
        else if (kind === 'restore') s.restore(saved);
        else s.branch({ horizonTicks: 0 });
      };
      expect(() => b.translate(request)).toThrow(/in progress/);
      expect(s.snapshot()).toEqual(saved);
      expect(b.status).toBe('failed');
    }
  });
  test('commit validation can reject the combined candidate without partial publication', () => {
    const { s } = fixture({
        reduceTranslation: ({ game }) => ({ ...game, ap: -1 }),
        validateGame: ({ game }) => game.ap >= 0,
      }),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 0 });
    b.translate(request);
    expect(() => s.commit(b)).toThrow(/rejected/);
    expect(s.snapshot()).toEqual(before);
    expect(b.status).toBe('failed');
  });
  test('invalid and obstructed requests never invoke game policy', () => {
    const w = world();
    w.setCell(3, 3, 3, MAT.STONE);
    w.setCell(4, 3, 3, MAT.STONE);
    const reducer = vi.fn(({ game }: { game: Game }) => game),
      { s } = fixture({ reduceTranslation: reducer }, w.snapshot()),
      saved = s.snapshot();
    for (const req of [
      { ...request, cells: [] },
      { ...request, externalBonds: 'cut' as const },
    ]) {
      const b = s.branch({ horizonTicks: 0 });
      expect(() => b.translate(req)).toThrow();
    }
    expect(reducer).not.toHaveBeenCalled();
    expect(s.snapshot()).toEqual(saved);
  });
  test('overflow reaches policy explicitly and can reject the whole action', () => {
    const { s } = fixture({
        reduceTranslation: ({ game, movement }) => {
          if (movement().requiresReexecution) throw Error('Actor paths incomplete');
          return game;
        },
      }),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 0 });
    expect(() => b.translateWithMotion(request, { maxEntries: 0 })).toThrow(/incomplete/);
    expect(s.snapshot()).toEqual(before);
  });
  test('selected holds require explicit release even with translation anchor release', () => {
    const { s } = fixture(),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 0 });
    b.hold({ id: 'lift', cells: [[3, 3, 3]], expiresAtTick: 2 });
    expect(() => b.translateWithMotion({ ...request, anchors: 'release' })).toThrow(/Release held/);
    expect(s.snapshot()).toEqual(before);
    const c = s.branch({ horizonTicks: 0 });
    c.hold({ id: 'lift', cells: [[3, 3, 3]], expiresAtTick: 2 });
    c.releaseHold('lift');
    c.translateWithMotion(request);
    expect(s.commit(c).snapshot.holds).toEqual([]);
  });
  test('other held cells remain canonical and path observations bind to their exact geometry', () => {
    const w = world();
    w.setCell(3, 3, 3, MAT.STONE);
    w.setCell(1, 1, 1, MAT.STONE);
    const { s } = fixture({}, w.snapshot()),
      b = s.branch({ horizonTicks: 0 });
    b.hold({ id: 'other', cells: [[1, 1, 1]], expiresAtTick: 2 });
    const a = b.translateWithMotion(request),
      m = a.movement(),
      source = paths.translationMovementSource3D(m);
    expect(gameplayGeometrySource3D(a.beforeQueries()).token).toBe(source.before);
    expect(gameplayGeometrySource3D(a.queries()).token).toBe(source.after);
    expect(
      gameplayGeometrySource3D(a.queries()).at(index([1, 1, 1])).structure & mechanics.ANCHOR_3D,
    ).toBe(0);
    expect(s.commit(b).snapshot.holds).toEqual([
      { id: 'other', cells: [index([1, 1, 1])], expiresAtTick: 2 },
    ]);
  });
  test('retained action views survive later edits and discard without becoming current state', () => {
    const { s } = fixture(),
      b = s.branch({ horizonTicks: 0 }),
      a = b.translateWithMotion(request),
      expected = a.movement();
    b.edit([{ kind: 'material', x: 4, y: 3, z: 3, material: MAT.ICE }]);
    b.discard();
    expect(a.movement()).toEqual(expected);
    expect(gameplayGeometrySource3D(a.queries()).at(index([4, 3, 3])).packed & 255).toBe(MAT.STONE);
    expect(a.queries()).toBe(a.queries());
    expect(a.beforeQueries()).toBe(a.beforeQueries());
    expect(a.queries().stamp.kind).toBe('preview');
  });
  test('game-only operations and multiple translations receive distinct correct boundaries', () => {
    const { s } = fixture(),
      b = s.branch({ horizonTicks: 0 });
    b.setGame({ ap: 1, position: index([3, 3, 3]) });
    const a = b.translateWithMotion(request),
      c = b.translateWithMotion({ cells: [[4, 3, 3]], path: [[-1, 0, 0]] });
    s.commit(b);
    expect(a.movement().from).toMatchObject({ operation: 1, tick: 0 });
    expect(a.movement().to).toMatchObject({ operation: 2, tick: 0 });
    expect(c.movement().from).toMatchObject({ operation: 2, tick: 0 });
    expect(c.movement().to).toMatchObject({ operation: 3, tick: 0 });
  });
  test('copied or forged movement reports cannot acquire live observation provenance', () => {
    const { s } = fixture(),
      b = s.branch({ horizonTicks: 0 }),
      m = b.translateWithMotion(request).movement();
    expect(() => paths.translationMovementSource3D(structuredClone(m))).toThrow(/live/);
    expect(() => paths.translationMovementSource3D({ ...m })).toThrow(/live/);
    expect(Object.isFrozen(m.from)).toBe(true);
    expect(Object.isFrozen(m.to)).toBe(true);
    b.discard();
  });
  test('journal captures the legacy receipt once without adding paths to saves or tick journals', () => {
    const { s, factory } = fixture(),
      b = s.branch({ horizonTicks: 0, captureJournal: true, capturePaths: true }),
      a = b.translateWithMotion(request);
    a.receipt.destinations.fill(0);
    const r = s.commit(b),
      journal = r.journal();
    expect(journal.events).toHaveLength(1);
    expect(journal.events[0].action).toMatchObject({
      kind: 'translate',
      receipt: { destinations: [index([4, 3, 3])] },
    });
    expect(r.paths().frames).toHaveLength(0);
    expect(r.motion().frames).toHaveLength(0);
    expect('translationPaths' in r.snapshot).toBe(false);
    expect('paths' in r.snapshot).toBe(false);
    expect(factory).not.toHaveBeenCalled();
  });
  test('retained reducer callbacks keep their original operation after later translations', () => {
    const actions: TranslationAction3D[] = [],
      { s } = fixture({
        reduceTranslation: (context) => {
          actions.push(context);
          return context.game;
        },
      }),
      b = s.branch({ horizonTicks: 0 });
    b.translate(request);
    b.translate({ cells: [[4, 3, 3]], path: [[0, -1, 0]] });
    s.commit(b);
    expect(actions[0].movement().to).toMatchObject({ operation: 1, tick: 0 });
    expect(actions[1].movement().to).toMatchObject({ operation: 2, tick: 0 });
    expect(gameplayGeometrySource3D(actions[0].queries()).at(index([4, 3, 3])).packed & 255).toBe(
      MAT.STONE,
    );
  });
  test('a stale branch cannot execute its reducer or publish paths', () => {
    const reduceTranslation = vi.fn(({ game }: { game: Game }) => game),
      { s } = fixture({ reduceTranslation }),
      stale = s.branch({ horizonTicks: 0 }),
      winner = s.branch({ horizonTicks: 0 });
    s.commit(winner);
    expect(() => stale.translateWithMotion(request)).toThrow(/stale/);
    expect(reduceTranslation).not.toHaveBeenCalled();
  });
  test('no in-flight action object escapes when its game reducer fails', () => {
    const { s } = fixture({
        reduceTranslation: () => {
          throw Error('failed action');
        },
      }),
      b: TacticalBranch3D<Game> = s.branch({ horizonTicks: 0 });
    let result: TranslationAction3D | undefined;
    expect(() => {
      result = b.translateWithMotion(request);
    }).toThrow(/failed action/);
    expect(result).toBeUndefined();
    expect(b.status).toBe('failed');
  });
  test('later report failure discards successful game reduction and translation together', () => {
    const reduceTranslation = vi.fn(({ game }: { game: Game }) => ({ ...game, ap: 1 }));
    const s = createTacticalSessionCore3D(
      initial(),
      () => {
        throw Error('Unexpected physical driver.');
      },
      { reduceTranslation },
      async () => {},
      () => {
        throw Error('Report observer failed');
      },
    );
    const saved = s.snapshot(),
      b = s.branch({ horizonTicks: 0, captureJournal: true });
    expect(() => b.translateWithMotion(request)).toThrow(/Report observer failed/);
    expect(reduceTranslation).toHaveBeenCalledTimes(1);
    expect(s.snapshot()).toEqual(saved);
    expect(b.status).toBe('failed');
  });
  test('absolute odd ticks remain unchanged and actions remain preview-stamped after commit', () => {
    const terrain = seed();
    terrain.tick = 17;
    const { s } = fixture({}, terrain),
      b = s.branch({ horizonTicks: 0 }),
      a = b.translateWithMotion(request);
    const r = s.commit(b);
    expect(r.snapshot.terrain.tick).toBe(17);
    expect(a.receipt.tick).toBe(17);
    expect(a.movement().to).toMatchObject({
      kind: 'preview',
      tick: 17,
      operation: 1,
      completedTicks: 0,
    });
    expect(r.snapshot.revision).toBe(1);
  });
});
