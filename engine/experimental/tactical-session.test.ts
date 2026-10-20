import { holdPhysics } from '../test-support/hold-physics.js';
import { describe, expect, test, vi } from 'vitest';
import { CpuStructuralWorld3D, type StructuralSnapshot3D } from './structural-world-core.js';
import { MAT } from './3d.js';
import { createTacticalSession3D } from './tactical-session.js';
import { copyTacticalValue, createTacticalSessionCore3D, type TacticalSimulationFactory3D } from './tactical-session-core.js';
import type { TacticalSession3D, TacticalSessionInitial3D, TacticalSessionPolicy3D, TacticalPreview3D, TacticalValue } from './tactical-session-view.js';

// A mistaken call to real physics fails immediately. Only inert drivers advance.
holdPhysics('step');
type Game = {actors: {id: string; position: number[]}[]; ap: number; resource: number; turn: number; rng: number; history: string[]};
function initial(): TacticalSessionInitial3D<Game> {
  const world = new CpuStructuralWorld3D({width: 4, height: 4, depth: 4, chunkSize: 4});
  world.setCell(1, 1, 1, MAT.STONE, 160); world.setIntegrity(1, 1, 1, 73);
  const balance = world.energyBalance();
  return {worldId: 'test-world', gameRulesVersion: 'test-game-1', terrain: world.snapshot(),
    game: {actors: [{id: 'earth', position: [0, 0, 0]}], ap: 2, resource: 10, turn: 0, rng: 7, history: []},
    accounting: {initialQ: balance.initialQ.toString(), externalQ: balance.externalQ.toString()}};
}
const rule: TacticalSessionPolicy3D<Game> = {validateGame: ({game}) => Number.isInteger(game.ap) && game.ap >= 0 && game.resource >= 0};
function previewState<T extends TacticalValue>(value: TacticalPreview3D<T>) {
  const {preview, ...state} = value; void preview; return state;
}
function mock(policy: TacticalSessionPolicy3D<Game> = {}, overrides: {step?: (s: StructuralSnapshot3D, count: number) => void | Promise<void>; close?: () => void} = {}) {
  const steps = vi.fn(), closed = vi.fn(), made = vi.fn();
  const factory: TacticalSimulationFactory3D = snapshot => {
    made(); let state = structuredClone(snapshot), count = 0;
    return {
      load(snapshot) {state = structuredClone(snapshot);},
      async step() {steps(); count++; if (overrides.step) await overrides.step(state, count); else state.tick++;},
      snapshot: () => state,
      close() {closed(); overrides.close?.();},
    };
  };
  return {session: createTacticalSessionCore3D(initial(), factory, policy, async () => {}), steps, closed, made};
}
function deferred() {
  let resolve!: () => void;
  return {promise: new Promise<void>(done => {resolve = done;}), resolve: () => resolve()};
}

describe('tactical transactions: real edits and inert advancement only', () => {
  test('translation, actors, resources, AP and history publish together after a zero-horizon preview', async () => {
    const session = createTacticalSession3D(initial(), rule), before = session.snapshot();
    const branch = session.branch({horizonTicks: 0});
    branch.translate({cells: [[1, 1, 1]], path: [[1, 0, 0]]});
    const game = branch.inspect().game;
    game.ap--; game.resource -= 2; game.actors[0].position = [2, 0, 1]; game.history.push('lift');
    branch.setGame(game); await branch.advance(0);
    expect(session.snapshot()).toEqual(before);
    const preview = branch.inspect(), result = session.commit(branch);
    expect(result.snapshot).toEqual({...previewState(preview), revision: 1});
    expect(session.snapshot()).toEqual(result.snapshot);
    expect(result.snapshot.terrain.structure[22]).toBe(73);
    expect(result.snapshot.terrain.energyQ[22]).toBe(before.terrain.energyQ[21]);
    expect(result.receipt).toMatchObject({revision: 1, horizonTicks: 0, endTick: 0, externalEnergyQ: '0'});
    expect(branch.status).toBe('committed'); expect(() => session.commit(branch)).toThrow(/committed/);
  });

  test('accounting survives snapshot branches and records exact edit deltas', () => {
    const session = createTacticalSession3D(initial()), before = session.snapshot();
    const branch = session.branch({horizonTicks: 0});
    branch.edit([{kind: 'energy', x: 1, y: 1, z: 1, energyQ: before.terrain.energyQ[21] + 7}]);
    const result = session.commit(branch);
    expect(result.snapshot.accounting.initialQ).toBe(before.accounting.initialQ);
    expect(BigInt(result.snapshot.accounting.externalQ)).toBe(BigInt(before.accounting.externalQ) + 7n);
    expect(result.receipt.externalEnergyQ).toBe('7');
  });

  test('late invalid edit makes the entire branch terminal without committing earlier work', () => {
    const session = createTacticalSession3D(initial()), before = session.snapshot();
    const branch = session.branch({horizonTicks: 0});
    branch.translate({cells: [[1, 1, 1]], path: [[1, 0, 0]]});
    branch.setGame({...before.game, ap: 0, resource: 2});
    expect(() => branch.edit([{kind: 'energy', x: 2, y: 1, z: 1, energyQ: 50000}, {kind: 'anchor', x: 0, y: 0, z: 0, anchored: true}])).toThrow();
    expect(branch.status).toBe('failed'); expect(() => session.commit(branch)).toThrow(/failed/);
    expect(session.snapshot()).toEqual(before);
  });

  test('invalid final game policy rejects both terrain and game publication', () => {
    const session = createTacticalSession3D(initial(), rule), before = session.snapshot();
    const branch = session.branch({horizonTicks: 0});
    branch.translate({cells: [[1, 1, 1]], path: [[1, 0, 0]]}); branch.setGame({...before.game, ap: -1});
    expect(() => session.commit(branch)).toThrow(/policy/); expect(branch.status).toBe('failed');
    expect(session.snapshot()).toEqual(before);
  });

  test('sibling game-only commit invalidates a preview even when tick is unchanged', () => {
    const session = createTacticalSession3D(initial()), a = session.branch({horizonTicks: 0}), b = session.branch({horizonTicks: 0});
    const game = b.inspect().game; game.ap--; b.setGame(game); const committed = session.commit(b);
    expect(a.base.tick).toBe(committed.snapshot.terrain.tick); expect(a.status).toBe('stale');
    expect(() => session.commit(a)).toThrow(/stale/); expect(session.snapshot()).toEqual(committed.snapshot);
  });

  test('foreign and forged handles cannot commit even with identical public identity', () => {
    const a = createTacticalSession3D(initial()), b = createTacticalSession3D(initial());
    const branch = a.branch({horizonTicks: 0}), before = b.snapshot();
    expect(() => b.commit(branch)).toThrow(/Foreign/);
    expect(() => a.commit({...branch})).toThrow(/forged/); expect(b.snapshot()).toEqual(before);
    branch.discard(); expect(() => a.commit(branch)).toThrow(/discarded/);
  });

  test('restore preserves accounting and advances revision instead of resurrecting old tokens', () => {
    const session = createTacticalSession3D(initial()), saved = session.snapshot(), old = session.branch({horizonTicks: 0});
    const update = session.branch({horizonTicks: 0}); update.setGame({...saved.game, ap: 1}); session.commit(update);
    const fresh = session.branch({horizonTicks: 0}), restored = session.restore(JSON.parse(JSON.stringify(saved)));
    expect(restored).toEqual({...saved, revision: 2}); expect(old.status).toBe('stale'); expect(fresh.status).toBe('stale');
    expect(() => session.commit(fresh)).toThrow(/stale/);
  });

  test('malformed restore never changes live state or invalidates a usable branch', () => {
    const session = createTacticalSession3D(initial()), before = session.snapshot(), branch = session.branch({horizonTicks: 0});
    const invalid = [null, {...before, worldId: 'another-world'}, {...before, gameRulesVersion: 'different-law'},
      {...before, rulesVersion: 'unknown'}, {...before, interventionRulesVersion: 'unknown'}, {...before, schemaVersion: 1},
      {...before, extra: true}, {...before, revision: -1}, {...before, accounting: {...before.accounting, externalQ: '0'}},
      {...before, accounting: {...before.accounting, initialQ: '-1'}}, {...before, accounting: {...before.accounting, initialQ: '01'}}];
    for (const saved of invalid) {expect(() => session.restore(saved as never)).toThrow(); expect(session.snapshot()).toEqual(before); expect(branch.status).toBe('ready');}
    session.commit(branch);
  });

  test('all input, preview, committed-result and snapshot storage is isolated', () => {
    const source = initial(), session = createTacticalSession3D(source), before = session.snapshot();
    source.game.actors[0].position[0] = 99; source.terrain.energyQ.fill(0); source.accounting!.initialQ = '0';
    const branch = session.branch({horizonTicks: 0}), inspected = branch.inspect();
    inspected.game.ap = 0; inspected.terrain.structure.fill(0); inspected.accounting.initialQ = '0';
    expect(previewState(branch.inspect())).toEqual(before); expect(session.snapshot()).toEqual(before);
    const result = session.commit(branch), expected = session.snapshot();
    result.snapshot.game.actors[0].position[0] = 888; result.snapshot.terrain.packedCells.fill(0);
    expect(session.snapshot()).toEqual(expected);
  });

  test('portable game values reject cycles, holes, accessors and non-JSON data', () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    const getter = vi.fn(() => 1), accessor = Object.defineProperty({}, 'x', {get: getter, enumerable: true});
    for (const bad of [cycle, new Array(1), accessor, {x: undefined}, {x: NaN}, {x: Infinity}, {x: () => 1}, new Date(), new Map(), {[Symbol('x')]: 1}, Array(65537).fill(0), 'a'.repeat(1048577)]) {
      expect(() => copyTacticalValue(bad as TacticalValue)).toThrow();
    }
    expect(getter).not.toHaveBeenCalled(); expect(copyTacticalValue([-0])).toEqual([0]);
    const data = JSON.parse('{"__proto__":{"safe":true}}');
    expect(Object.hasOwn(copyTacticalValue(data), '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).safe).toBeUndefined();
    expect(() => createTacticalSession3D({...initial(), accounting: null} as never)).toThrow();
  });

  test('malformed game update closes its branch and preserves the live game', () => {
    const session = createTacticalSession3D(initial()), before = session.snapshot(), branch = session.branch({horizonTicks: 0});
    expect(() => branch.setGame({...before.game, rng: NaN})).toThrow();
    expect(branch.status).toBe('failed'); expect(session.snapshot()).toEqual(before);
  });

  test('publication validation sees copies and cannot reenter a session mutation', () => {
    let session: TacticalSession3D<Game> | undefined;
    const blocked = vi.fn();
    session = createTacticalSession3D(initial(), {validateGame: ({game, terrain}) => {
      game.ap = -100; terrain.packedCells.fill(0);
      if (session) {expect(() => session!.restore(session!.snapshot())).toThrow(/publication/); blocked();}
      return true;
    }});
    const branch = session.branch({horizonTicks: 0}), before = branch.inspect();
    const result = session.commit(branch);
    expect(result.snapshot.game).toEqual(before.game); expect(result.snapshot.terrain).toEqual(before.terrain); expect(blocked).toHaveBeenCalledOnce();
  });

  test('nonzero mock horizons must finish before commit and reducers see each complete tick', async () => {
    const reducer = vi.fn(({game, terrain, tick}: {game: Game; terrain: StructuralSnapshot3D; tick: number}) => {
      terrain.energyQ[0] = 0; return {...game, turn: game.turn + 1, rng: game.rng + tick};
    });
    const {session, steps, closed} = mock({reduceTick: reducer}), before = session.snapshot(), branch = session.branch({horizonTicks: 3});
    expect(() => session.commit(branch)).toThrow(/incomplete/);
    await branch.advance(2); expect(branch.inspect().terrain.tick).toBe(2); expect(session.snapshot()).toEqual(before);
    expect(() => session.commit(branch)).toThrow(/incomplete/);
    await branch.advance(1); const result = session.commit(branch);
    expect(result.snapshot.game).toMatchObject({turn: 3, rng: 13}); expect(result.snapshot.accounting).toEqual(before.accounting);
    expect(result.snapshot.terrain.energyQ).toEqual(before.terrain.energyQ);
    expect(result.receipt).toMatchObject({horizonTicks: 3, endTick: 3}); expect(steps).toHaveBeenCalledTimes(3); expect(closed).toHaveBeenCalledTimes(2);
  });

  test('inspection identifies its horizon and cannot be mistaken for a committed save', async () => {
    const {session} = mock(), before = session.snapshot(), branch = session.branch({horizonTicks: 2});
    await branch.advance(1);
    const preview = branch.inspect();
    expect(preview.preview).toEqual({base: branch.base, branchId: 1, operation: 1, horizonTicks: 2, completedTicks: 1});
    expect(() => session.restore(JSON.parse(JSON.stringify(preview)))).toThrow(/fields/);
    expect(session.snapshot()).toEqual(before); expect(branch.status).toBe('ready');
    expect(() => session.commit(branch)).toThrow(/incomplete/);
  });

  test('a later simulation failure cannot commit earlier complete ticks', async () => {
    const {session, closed} = mock({}, {step: (s, count) => {if (count === 2) throw Error('mock solve failure'); s.tick++;}});
    const before = session.snapshot(), branch = session.branch({horizonTicks: 3}); branch.setGame({...before.game, ap: 1});
    await expect(branch.advance(3)).rejects.toThrow(/mock solve/);
    expect(branch.status).toBe('failed'); expect(() => session.commit(branch)).toThrow(/failed/);
    expect(session.snapshot()).toEqual(before); expect(closed).toHaveBeenCalledOnce();
  });

  test('cleanup failure prevents branch publication even after successful work', async () => {
    const {session, closed} = mock({}, {close: () => {throw Error('mock cleanup failure');}});
    const before = session.snapshot(), branch = session.branch({horizonTicks: 1});
    await expect(branch.advance(1)).rejects.toThrow(/cleanup/); expect(branch.status).toBe('failed');
    expect(session.snapshot()).toEqual(before); expect(closed).toHaveBeenCalledOnce();
  });

  test.each(['tick', 'energy', 'rules'] as const)('invalid mock driver %s output rejects without publication', async problem => {
    const {session, closed} = mock({}, {step: s => {s.tick++; if (problem === 'tick') s.tick++; if (problem === 'energy') s.energyQ[0]++; if (problem === 'rules') s.rulesVersion = 'unknown';}});
    const before = session.snapshot(), branch = session.branch({horizonTicks: 1});
    await expect(branch.advance(1)).rejects.toThrow(); expect(branch.status).toBe('failed'); expect(session.snapshot()).toEqual(before); expect(closed).toHaveBeenCalledOnce();
  });

  test('throwing and asynchronous reducers cannot leave a committable partial result', async () => {
    for (const reduceTick of [() => {throw Error('game resolution failed');}, (() => Promise.reject(Error('async policy'))) as never]) {
      const {session, closed} = mock({reduceTick}), before = session.snapshot(), branch = session.branch({horizonTicks: 1});
      await expect(branch.advance(1)).rejects.toThrow(); expect(branch.status).toBe('failed'); expect(session.snapshot()).toEqual(before); expect(closed).toHaveBeenCalledOnce();
    }
  });

  test('cancellation during in-flight work waits for its safe boundary and cleans once', async () => {
    const entered = deferred(), release = deferred();
    const {session, steps, closed} = mock({}, {step: async s => {entered.resolve(); await release.promise; s.tick++;}});
    const before = session.snapshot(), branch = session.branch({horizonTicks: 2}), other = session.branch({horizonTicks: 1});
    const running = branch.advance(2); await entered.promise;
    expect(branch.status).toBe('running'); expect(() => branch.inspect()).toThrow(/in flight/);
    branch.discard(); expect(branch.status).toBe('discarded'); expect(closed).not.toHaveBeenCalled();
    await expect(other.advance(1)).rejects.toThrow(/already in flight/);
    release.resolve(); await expect(running).rejects.toThrow(/discarded/);
    expect(steps).toHaveBeenCalledOnce(); expect(closed).toHaveBeenCalledOnce(); expect(session.snapshot()).toEqual(before);
    other.discard();
  });

  test('already-aborted requests create no driver and cannot commit', async () => {
    const {session, made} = mock(), controller = new AbortController(); controller.abort();
    const branch = session.branch({horizonTicks: 1}), before = session.snapshot();
    await expect(branch.advance(1, {signal: controller.signal})).rejects.toThrow(/discarded/);
    expect(made).not.toHaveBeenCalled(); expect(() => session.commit(branch)).toThrow(/discarded/); expect(session.snapshot()).toEqual(before);
  });

  test('an external commit supersedes pending work without overwriting the newer state', async () => {
    const entered = deferred(), release = deferred();
    const {session, closed} = mock({}, {step: async s => {entered.resolve(); await release.promise; s.tick++;}});
    const branch = session.branch({horizonTicks: 1}), other = session.branch({horizonTicks: 0});
    const running = branch.advance(1); await entered.promise;
    const game = other.inspect().game; game.ap = 0; other.setGame(game); const newer = session.commit(other);
    expect(branch.status).toBe('stale'); release.resolve(); await expect(running).rejects.toThrow(/stale/);
    expect(session.snapshot()).toEqual(newer.snapshot); expect(closed).toHaveBeenCalledOnce();
  });

  test('retained branch count is bounded and discarded work frees capacity', () => {
    const session = createTacticalSession3D(initial());
    const branches = Array.from({length: 4}, () => session.branch({horizonTicks: 0}));
    expect(() => session.branch({horizonTicks: 0})).toThrow(/budget/);
    branches[0].discard(); expect(() => session.branch({horizonTicks: 0})).not.toThrow();
  });

  test('horizons, advancement sizes and tick overflow reject before simulation', async () => {
    const {session, made} = mock(), before = session.snapshot();
    for (const options of [null, {}, {horizonTicks: -1}, {horizonTicks: 1025}, {horizonTicks: 1.5}, {horizonTicks: 0, extra: true}]) expect(() => session.branch(options as never)).toThrow();
    const branch = session.branch({horizonTicks: 1024}); await expect(branch.advance(33)).rejects.toThrow();
    expect(branch.status).toBe('failed'); expect(made).not.toHaveBeenCalled(); expect(session.snapshot()).toEqual(before);
    const source = initial(); source.terrain.tick = Number.MAX_SAFE_INTEGER;
    expect(() => createTacticalSession3D(source).branch({horizonTicks: 1})).toThrow();
  });

  test('policy function replacement after creation cannot change branch rules', async () => {
    const policy: TacticalSessionPolicy3D<Game> = {reduceTick: ({game}) => ({...game, turn: game.turn + 1})};
    const {session} = mock(policy); policy.reduceTick = ({game}) => ({...game, turn: 999});
    const branch = session.branch({horizonTicks: 1}); await branch.advance(1);
    expect(session.commit(branch).snapshot.game.turn).toBe(1);
  });
});
