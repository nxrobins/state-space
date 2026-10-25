import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Exact storage-strategy comparisons. Physical steps/support solves remain held. */
import { describe, expect, test, vi } from 'vitest';
import {
  createTacticalSessionCore3D,
  type TacticalSimulationFactory3D,
} from './tactical-session-core.js';
import { createTacticalSession3D } from '../tactical-session.js';
import {
  createTacticalSnapshotReuse3D,
  inspectTacticalSnapshotReuse3D,
  type TacticalSnapshotReuseOptions3D,
} from './tactical-snapshot-reuse.js';
import {
  CpuStructuralWorld3D,
  type StructuralSnapshot3D,
} from '../structural/structural-world-core.js';

import type { SupportObserver3D } from '../gameplay/change-reports.js';
import type {
  TacticalBranch3D,
  TacticalSessionInitial3D,
  TacticalSessionPolicy3D,
} from './tactical-session-view.js';
import { MAT } from '../3d.js';
import { observe } from '../terrain/terrain-motion.fixtures.js';
holdPhysics('solveStructure3D', ...STRUCTURAL_CALLS);
type Game = {
  ap: number;
  turn: number;
  rng: number;
  actors: { id: string; cell: number }[];
  log: string[];
};
function initial(tick = 0): TacticalSessionInitial3D<Game> {
  const world = new CpuStructuralWorld3D({ width: 8, height: 8, depth: 8, chunkSize: 4 }),
    flask = new CpuStructuralWorld3D({ width: 4, height: 4, depth: 4, chunkSize: 4 });
  world.setCell(1, 1, 1, MAT.STONE, 140);
  world.setCell(2, 1, 1, MAT.STONE, 100);
  world.setIntegrity(1, 1, 1, 73);
  world.setIntegrity(2, 1, 1, 91);
  world.setCell(1, 2, 1, MAT.WATER, 30);
  world.setCell(5, 1, 1, MAT.STONE);
  world.setAnchor(5, 1, 1, true);
  const terrain = world.snapshot(),
    storage = flask.snapshot();
  terrain.tick = storage.tick = tick;
  return {
    worldId: 'reuse-world',
    gameRulesVersion: 'reuse-game-1',
    terrain,
    reservoirs: [{ id: 'flask', terrain: storage }],
    game: { ap: 3, turn: 0, rng: 7, actors: [{ id: 'earth', cell: 73 }], log: [] },
  };
}
const support: SupportObserver3D = (s) => ({
  distances: new Int32Array(s.packedCells.length).fill(-1),
  loads: Uint32Array.from(s.energyQ),
  capacities: Uint32Array.from(s.structure),
  reactions: new Uint32Array(s.packedCells.length),
});
function fixture(
  mode: 'shared' | 'copy' = 'shared',
  options: {
    source?: TacticalSessionInitial3D<Game>;
    policy?: TacticalSessionPolicy3D<Game>;
    pause?: Promise<void>;
    failClose?: boolean;
    badDriver?: boolean;
    observer?: SupportObserver3D;
  } = {},
) {
  const inputs: StructuralSnapshot3D[] = [],
    outputs: StructuralSnapshot3D[] = [],
    loads: StructuralSnapshot3D[] = [];
  let made = 0,
    closed = 0;
  const factory: TacticalSimulationFactory3D = (input) => {
    made++;
    inputs.push(input);
    if (options.badDriver) {
      input.packedCells.fill(0xffffffff);
      throw Error('bad driver');
    }
    let state = structuredClone(input),
      result: ReturnType<typeof observe>;
    return {
      load(next) {
        loads.push(next);
        state = structuredClone(next);
      },
      async step() {
        await options.pause;
        result = observe(state, { after: state });
        state = result.after;
      },
      snapshot() {
        outputs.push(state);
        return state;
      },
      motion: () => result.motion,
      paths: () => result.paths,
      close() {
        closed++;
        if (options.failClose) throw Error('cleanup failed');
      },
    };
  };
  const session = createTacticalSessionCore3D(
    options.source ?? initial(),
    factory,
    options.policy ?? {},
    async () => {},
    options.observer ?? support,
    { mode, freezeForVerification: mode === 'shared', measureForVerification: true },
  );
  return { session, inputs, outputs, loads, counts: () => ({ made, closed }) };
}
const pair = (options: Parameters<typeof fixture>[1] = {}) =>
  [fixture('shared', options), fixture('copy', options)] as const;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function until(check: () => boolean) {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await Promise.resolve();
  }
  throw Error('Inert driver did not reach the expected boundary.');
}
const box = { minQ: [0, 0, 0] as const, maxQ: [1024, 1024, 1024] as const };
function state(branch: TacticalBranch3D<Game>) {
  return {
    snapshot: branch.inspect(),
    changes: branch.changes(),
    journal: branch.journal(),
    paths: branch.paths(),
    motion: branch.motion(),
    query: branch.queries().fit({ box }),
    stored: branch.queries({ domain: 'flask' }).exposure({ box }),
  };
}

describe('private immutable snapshot reuse', () => {
  test('shared forks reuse the private root while eager forks own all state coordinates', () => {
    const snapshot = createTacticalSession3D(initial()).snapshot(),
      shared = createTacticalSnapshotReuse3D(structuredClone),
      copied = createTacticalSnapshotReuse3D(structuredClone, { mode: 'copy' });
    expect(shared.fork(snapshot)).toBe(snapshot);
    const clone = copied.fork(snapshot);
    expect(clone).toEqual(snapshot);
    expect(clone.terrain.packedCells).not.toBe(snapshot.terrain.packedCells);
    expect(clone.reservoirs[0].terrain.energyQ).not.toBe(snapshot.reservoirs[0].terrain.energyQ);
    expect(clone.game).not.toBe(snapshot.game);
  });
  test('verification freezing covers game holds reservoirs accounting and every cell array', () => {
    const s = createTacticalSession3D(initial()).snapshot();
    s.holds.push({ id: 'held', cells: [73], expiresAtTick: 2 });
    const reuse = createTacticalSnapshotReuse3D(structuredClone, { freezeForVerification: true });
    reuse.retain(s);
    for (const object of [
      s,
      s.terrain,
      s.terrain.packedCells,
      s.terrain.energyQ,
      s.terrain.structure,
      s.game.actors[0],
      s.holds[0].cells,
      s.reservoirs[0].terrain.energyQ,
      s.accounting,
    ])
      expect(Object.isFrozen(object)).toBe(true);
  });
  test('public sessions expose neither internal modes nor diagnostics and preserve the save schema', () => {
    const s = createTacticalSession3D(initial());
    expect(Object.keys(s).sort()).toEqual([
      'branch',
      'commit',
      'queries',
      'restore',
      'revision',
      'snapshot',
    ]);
    expect(() => inspectTacticalSnapshotReuse3D(s)).toThrow(/not enabled/);
    expect(s.snapshot().rulesVersion).toBe('tactical-session-3');
  });
  test('internal option validation rejects malformed modes and accessors without invoking getters', () => {
    const get = vi.fn();
    const raw = Object.defineProperty({}, 'mode', { enumerable: true, get });
    for (const options of [
      null,
      [],
      { mode: 'other' },
      { freezeForVerification: 1 },
      { extra: true },
      raw,
    ])
      expect(() =>
        createTacticalSnapshotReuse3D(structuredClone, options as TacticalSnapshotReuseOptions3D),
      ).toThrow();
    expect(get).not.toHaveBeenCalled();
  });
  test('creating and discarding branches no longer copies any primary or reservoir coordinates', () => {
    const cases = pair();
    for (const f of cases)
      for (let i = 0; i < 12; i++) f.session.branch({ horizonTicks: 0 }).discard();
    expect(inspectTacticalSnapshotReuse3D(cases[0].session)).toMatchObject({
      forks: 12,
      copiedCellCoordinates: 0,
      sharedCellCoordinates: 20736,
      saturated: false,
    });
    expect(inspectTacticalSnapshotReuse3D(cases[1].session)).toMatchObject({
      forks: 12,
      copiedCellCoordinates: 20736,
      sharedCellCoordinates: 0,
    });
    expect(cases[0].session.snapshot()).toEqual(cases[1].session.snapshot());
  });
  test('zero-tick setup omits the second eager coordinate copy and records bounded logical copy evidence', async () => {
    const cases = pair();
    for (const f of cases)
      for (let i = 0; i < 12; i++) {
        const b = f.session.branch({ horizonTicks: 0 });
        await b.advance(0);
        b.discard();
      }
    const shared = inspectTacticalSnapshotReuse3D(cases[0].session),
      copy = inspectTacticalSnapshotReuse3D(cases[1].session);
    expect(shared).toEqual({
      mode: 'shared',
      forks: 24,
      copiedCellCoordinates: 0,
      sharedCellCoordinates: 41472,
      saturated: false,
    });
    expect(copy).toEqual({
      mode: 'copy',
      forks: 24,
      copiedCellCoordinates: 41472,
      sharedCellCoordinates: 0,
      saturated: false,
    });
    expect(cases.map((f) => f.counts().made)).toEqual([0, 0]);
    console.info(
      'SNAPSHOT_REUSE_EVIDENCE ' +
        JSON.stringify({
          primaryCells: 512,
          reservoirCells: 64,
          branches: 12,
          advances: 12,
          shared,
          copy,
          avoidedCoordinatorCoordinateArrays: 144,
          physicsTicks: 0,
          timingMeasured: false,
        }),
    );
  });
  test('siblings retain complete independent state across every edit family and eager-copy comparison', async () => {
    const results = [];
    for (const f of pair()) {
      const before = f.session.snapshot(),
        sibling = f.session.branch({ horizonTicks: 0 }),
        untouched = sibling.inspect();
      const b = f.session.branch({ horizonTicks: 0, captureJournal: true, capturePaths: true }),
        observations = [state(b)];
      b.setGame({ ...before.game, ap: 2, log: ['prepared'] });
      observations.push(state(b));
      b.edit([
        { kind: 'material', x: 4, y: 1, z: 1, material: MAT.ICE, thermal: 20 },
        { kind: 'integrity', x: 4, y: 1, z: 1, integrity: 41 },
        { kind: 'anchor', x: 4, y: 1, z: 1, anchored: true },
      ]);
      observations.push(state(b));
      b.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 7 }]);
      observations.push(state(b));
      b.hold({ id: 'control', cells: [[1, 1, 1]], expiresAtTick: 3 });
      observations.push(state(b));
      b.releaseHold('control');
      observations.push(state(b));
      const translated = b.translateWithMotion({
        cells: [
          [1, 1, 1],
          [2, 1, 1],
        ],
        path: [[0, 0, 1]],
        externalBonds: 'cut',
      });
      observations.push(state(b));
      const motion = translated.movement();
      b.transfer({ from: null, to: 'flask', cells: [[1, 2, 1]], offset: [0, 0, 0] });
      observations.push(state(b));
      b.transfer({ from: 'flask', to: null, cells: [[1, 2, 1]], offset: [0, 0, 0] });
      observations.push(state(b));
      await b.advance(0);
      observations.push(state(b));
      expect(f.session.snapshot()).toEqual(before);
      expect(sibling.inspect()).toEqual(untouched);
      const committed = f.session.commit(b);
      expect(sibling.status).toBe('stale');
      results.push({
        observations,
        motion,
        snapshot: committed.snapshot,
        receipt: committed.receipt,
        changes: committed.changes(),
        journal: committed.journal(),
        paths: committed.paths(),
      });
    }
    expect(results[0]).toEqual(results[1]);
  });
  test('plain translation remains exact without path capture', () => {
    const result = pair().map((f) => {
      const b = f.session.branch({ horizonTicks: 0 });
      const receipt = b.translate({ cells: [[1, 1, 1]], path: [[0, 0, 1]], externalBonds: 'cut' });
      return { receipt, result: f.session.commit(b).snapshot };
    });
    expect(result[0]).toEqual(result[1]);
  });
  test('inert multi-domain ticks preserve paths journals holds and game reducers across odd boundaries', async () => {
    const results = [];
    for (const f of pair({
      source: initial(3),
      policy: {
        requiresPaths: true,
        reduceTick: (c) => ({
          ...c.game,
          turn: c.game.turn + 1,
          rng: Math.imul(c.game.rng, 1664525) >>> 0,
        }),
      },
    })) {
      const before = f.session.snapshot(),
        b = f.session.branch({ horizonTicks: 3, captureJournal: true });
      b.hold({ id: 'control', cells: [[1, 1, 1]], expiresAtTick: 4 });
      await b.advance(1);
      const middle = state(b);
      await b.advance(2);
      const after = state(b);
      expect(f.session.snapshot()).toEqual(before);
      const result = f.session.commit(b);
      results.push({
        middle,
        after,
        snapshot: result.snapshot,
        receipt: result.receipt,
        journal: result.journal(),
        paths: result.paths(),
        counts: f.counts(),
      });
    }
    expect(results[0]).toEqual(results[1]);
  });
  test('initial and public nested arrays remain mutable copies even when canonical shared nodes are frozen', () => {
    const source = initial(),
      f = fixture('shared', { source }),
      before = f.session.snapshot(),
      b = f.session.branch({ horizonTicks: 0 });
    source.terrain.packedCells.fill(0);
    source.reservoirs![0].terrain.energyQ.fill(0);
    source.game.ap = 0;
    const output = b.inspect();
    output.terrain.energyQ.fill(0);
    output.reservoirs[0].terrain.structure.fill(0);
    output.game.actors[0].cell = 99;
    output.accounting.externalQ = '999';
    expect(f.session.snapshot()).toEqual(before);
    const clean = b.inspect();
    expect(clean.terrain).toEqual(before.terrain);
    expect(clean.game).toEqual(before.game);
    b.discard();
  });
  test('all retained policy arguments are isolated from later canonical state', async () => {
    const retained: Parameters<NonNullable<TacticalSessionPolicy3D<Game>['reduceTick']>>[0][] = [];
    const f = fixture('shared', {
      policy: {
        validateGame(c) {
          c.terrain.packedCells.fill(0);
          c.reservoirs[0].terrain.energyQ.fill(0);
          c.game.ap = 0;
          return true;
        },
        reduceTick(c) {
          retained.push(c);
          c.game.turn++;
          return c.game;
        },
      },
    });
    const before = f.session.snapshot(),
      b = f.session.branch({ horizonTicks: 2 });
    await b.advance(1);
    const first = b.inspect();
    retained[0].terrain.energyQ.fill(0);
    retained[0].reservoirs[0].terrain.packedCells.fill(0);
    retained[0].game.ap = 99;
    await b.advance(1);
    expect(b.inspect().game.ap).toBe(3);
    expect(b.inspect().terrain.energyQ).toEqual(first.terrain.energyQ);
    expect(f.session.snapshot()).toEqual(before);
    f.session.commit(b);
    expect(f.session.snapshot().game.ap).toBe(3);
  });
  test('translation reducer inputs and receipts cannot mutate source or published matter', () => {
    let retained:
      Parameters<NonNullable<TacticalSessionPolicy3D<Game>['reduceTranslation']>>[0] | undefined;
    const f = fixture('shared', {
      policy: {
        reduceTranslation(c) {
          retained = c;
          c.game.ap--;
          return c.game;
        },
      },
    });
    const b = f.session.branch({ horizonTicks: 0 }),
      receipt = b.translate({ cells: [[1, 1, 1]], path: [[0, 0, 1]], externalBonds: 'cut' }),
      before = b.inspect();
    retained!.game.ap = 99;
    retained!.receipt.destinations.fill(0);
    receipt.destinations.fill(0);
    expect(b.inspect()).toEqual(before);
    f.session.commit(b);
    expect(f.session.snapshot().game.ap).toBe(2);
  });
  test('driver inputs loads and published outputs do not alias canonical state', async () => {
    const f = fixture(),
      before = f.session.snapshot(),
      b = f.session.branch({ horizonTicks: 2 });
    b.hold({ id: 'held', cells: [[1, 1, 1]], expiresAtTick: 1 });
    await b.advance(2);
    const after = b.inspect();
    expect(f.loads).toHaveLength(1);
    for (const s of [...f.inputs, ...f.outputs, ...f.loads]) {
      expect(Object.isFrozen(s.energyQ)).toBe(false);
      s.energyQ.fill(0);
      s.packedCells.fill(0);
      s.structure.fill(0);
    }
    expect(b.inspect()).toEqual(after);
    expect(f.session.snapshot()).toEqual(before);
    f.session.commit(b);
  });
  test('a driver that mutates its input and throws cannot corrupt live state or sibling branches', async () => {
    const f = fixture('shared', { badDriver: true }),
      before = f.session.snapshot(),
      sibling = f.session.branch({ horizonTicks: 0 }),
      b = f.session.branch({ horizonTicks: 1 });
    await expect(b.advance(1)).rejects.toThrow(/bad driver/);
    expect(f.session.snapshot()).toEqual(before);
    expect(sibling.inspect().terrain).toEqual(before.terrain);
    sibling.discard();
  });
  test('support observation receives copies rather than shared canonical endpoints', () => {
    const f = fixture('shared', {
      observer(s) {
        const result = support(s);
        s.packedCells.fill(0);
        s.energyQ.fill(0);
        s.structure.fill(0);
        return result;
      },
    });
    const before = f.session.snapshot(),
      b = f.session.branch({ horizonTicks: 0, captureJournal: true });
    b.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 5 }]);
    const preview = b.inspect();
    b.changes();
    b.journal();
    expect(b.inspect()).toEqual(preview);
    expect(f.session.snapshot()).toEqual(before);
    f.session.commit(b);
  });
  test('commit reports and lazy geometry remain stable after later terrain edits and restore', () => {
    const f = fixture(),
      b = f.session.branch({ horizonTicks: 0, captureJournal: true });
    b.setGame({ ...b.inspect().game, ap: 2 });
    const result = f.session.commit(b),
      report = result.changes(),
      journal = result.journal(),
      view = f.session.queries(),
      query = view.fit({ box }),
      saved = f.session.snapshot();
    const next = f.session.branch({ horizonTicks: 0 });
    next.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 4 }]);
    f.session.commit(next);
    f.session.restore(saved);
    result.snapshot.terrain.packedCells.fill(0);
    expect(result.changes()).toEqual(report);
    expect(result.journal()).toEqual(journal);
    expect(view.fit({ box })).toEqual(query);
  });
  test('invalid late edits and failed game validation preserve every live coordinate in both modes', () => {
    for (const f of pair({ policy: { validateGame: (c) => c.game.ap >= 0 } })) {
      const before = f.session.snapshot(),
        bad = f.session.branch({ horizonTicks: 0 });
      bad.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 5 }]);
      expect(() =>
        bad.edit([
          { kind: 'material', x: 0, y: 0, z: 0, material: MAT.WATER },
          { kind: 'anchor', x: 7, y: 7, z: 7, anchored: true },
        ]),
      ).toThrow();
      expect(bad.status).toBe('failed');
      expect(f.session.snapshot()).toEqual(before);
      const rejected = f.session.branch({ horizonTicks: 0 });
      rejected.setGame({ ...before.game, ap: -1 });
      expect(() => f.session.commit(rejected)).toThrow(/policy/);
      expect(f.session.snapshot()).toEqual(before);
    }
  });
  test('malformed restore does not evict a valid shared candidate; valid restore invalidates it', () => {
    const f = fixture(),
      saved = f.session.snapshot(),
      b = f.session.branch({ horizonTicks: 0 });
    b.setGame({ ...saved.game, ap: 2 });
    expect(() =>
      f.session.restore({ ...saved, accounting: { ...saved.accounting, externalQ: '1' } }),
    ).toThrow();
    expect(b.status).toBe('ready');
    expect(f.session.snapshot()).toEqual(saved);
    f.session.restore(saved);
    expect(b.status).toBe('stale');
    expect(() => f.session.commit(b)).toThrow();
    saved.terrain.energyQ.fill(0);
    expect(f.session.snapshot().terrain.energyQ[73]).not.toBe(0);
  });
  test('cancellation waits for private advancement cleanup and preserves shared siblings', async () => {
    for (const mode of ['shared', 'copy'] as const) {
      const gate = deferred(),
        f = fixture(mode, { pause: gate.promise }),
        before = f.session.snapshot(),
        sibling = f.session.branch({ horizonTicks: 0 }),
        b = f.session.branch({ horizonTicks: 2 }),
        abort = new AbortController();
      const pending = b.advance(2, { signal: abort.signal }),
        rejected = expect(pending).rejects.toThrow(/discarded/);
      await until(() => f.counts().made === 2);
      abort.abort();
      gate.resolve();
      await rejected;
      expect(f.session.snapshot()).toEqual(before);
      expect(sibling.inspect().terrain).toEqual(before.terrain);
      expect(f.counts()).toEqual({ made: 2, closed: 2 });
      sibling.discard();
    }
  });
  test('publication from a sibling invalidates an in-flight shared branch without accepting its partial state', async () => {
    const gate = deferred(),
      f = fixture('shared', { pause: gate.promise }),
      pendingBranch = f.session.branch({ horizonTicks: 1 }),
      sibling = f.session.branch({ horizonTicks: 0 });
    const pending = pendingBranch.advance(1),
      rejected = expect(pending).rejects.toThrow(/stale/);
    await until(() => f.counts().made === 2);
    sibling.setGame({ ...sibling.inspect().game, ap: 1 });
    const committed = f.session.commit(sibling);
    gate.resolve();
    await rejected;
    expect(f.session.snapshot()).toEqual(committed.snapshot);
    expect(f.counts().closed).toBe(2);
  });
  test('driver cleanup failure cannot publish a completed inert branch in either mode', async () => {
    for (const f of pair({ failClose: true })) {
      const before = f.session.snapshot(),
        b = f.session.branch({ horizonTicks: 1 });
      await expect(b.advance(1)).rejects.toThrow(/cleanup/);
      expect(f.session.snapshot()).toEqual(before);
      expect(b.status).toBe('failed');
      expect(f.counts()).toEqual({ made: 2, closed: 2 });
    }
  });
  test('repeated exact save restore continuation matches the eager strategy without a physical replay claim', async () => {
    const results = [];
    for (const f of pair()) {
      const b = f.session.branch({ horizonTicks: 1 });
      b.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 3 }]);
      await b.advance(1);
      f.session.commit(b);
      const save = JSON.parse(JSON.stringify(f.session.snapshot()));
      f.session.restore(save);
      const resumed = f.session.branch({ horizonTicks: 2 });
      resumed.transfer({ from: null, to: 'flask', cells: [[1, 2, 1]], offset: [0, 0, 0] });
      await resumed.advance(2);
      results.push(f.session.commit(resumed).snapshot);
    }
    expect(results[0]).toEqual(results[1]);
  });
});
