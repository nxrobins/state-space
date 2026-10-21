import { holdPhysics } from '../test-support/hold-physics.js';
import { describe, expect, test, vi } from 'vitest';
import { MAT } from './3d.js';
import * as mechanics from './structural-mechanics.js';
import { CpuStructuralWorld3D, type StructuralSnapshot3D } from './structural-world-core.js';
import {
  createTacticalSessionCore3D,
  type TacticalSimulationFactory3D,
} from './tactical/tactical-session-core.js';
import type { TacticalSessionInitial3D } from './tactical/tactical-session-view.js';
import type { SupportObservation3D, SupportObserver3D } from './change-reports.js';

// Selected suite: real edits, inert support observations, no physical solve/tick.
holdPhysics('solveStructure3D', 'step');
function volume() {
  return new CpuStructuralWorld3D({ width: 4, height: 4, depth: 4, chunkSize: 4 });
}
function initial(): TacticalSessionInitial3D<{ ap: number }> {
  const w = volume();
  w.setCell(1, 1, 1, MAT.STONE);
  return {
    worldId: 'change-world',
    gameRulesVersion: 'change-game-1',
    terrain: w.snapshot(),
    game: { ap: 2 },
  };
}
function empty(s: StructuralSnapshot3D): SupportObservation3D {
  const n = s.packedCells.length;
  return {
    distances: new Int32Array(n).fill(-1),
    loads: new Uint32Array(n),
    capacities: new Uint32Array(n),
    reactions: new Uint32Array(n),
  };
}
function session(source = initial(), observe: SupportObserver3D = empty) {
  const observed = vi.fn(observe);
  const factory: TacticalSimulationFactory3D = (snapshot) => {
    let state = structuredClone(snapshot);
    return {
      load(s) {
        state = structuredClone(s);
      },
      step() {
        state.tick++;
      },
      snapshot: () => state,
      close() {},
    };
  };
  return {
    s: createTacticalSessionCore3D(source, factory, {}, async () => {}, observed),
    observed,
  };
}

describe('complete endpoint reports with inert support observations', () => {
  test('no-op and game-only inspections do not invoke the global observer', () => {
    const { s, observed } = session(),
      branch = s.branch({ horizonTicks: 0 });
    const before = branch.changes();
    expect(
      Object.values(before.domains[0].channels).every(
        (c) => c.count === 0 && c.mode === 'unchanged',
      ),
    ).toBe(true);
    expect(before.gameChanged).toBe(false);
    branch.setGame({ ap: 1 });
    expect(branch.changes()).toMatchObject({ gameChanged: true, accountingChanged: false });
    expect(observed).not.toHaveBeenCalled();
  });

  test('one quantum changes exact temperature even when the packed thermal byte is unchanged', () => {
    const { s } = session(),
      before = s.snapshot(),
      branch = s.branch({ horizonTicks: 0 });
    branch.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 1 }]);
    expect(branch.inspect().terrain.packedCells).toEqual(before.terrain.packedCells);
    const report = branch.changes(),
      c = report.domains[0].channels;
    expect(c.energy.runs).toEqual([[21, 1]]);
    expect(c.temperature.runs).toEqual([[21, 1]]);
    expect(c.material.count).toBe(0);
    expect(c.phase.count).toBe(0);
    expect(report.accountingChanged).toBe(true);
  });

  test('latent energy changes do not falsely report a temperature change', () => {
    const source = initial(),
      w = volume();
    w.setCell(1, 1, 1, MAT.WATER);
    w.setEnergy(1, 1, 1, 120 * 256);
    const { s } = session({ ...source, terrain: w.snapshot() }),
      branch = s.branch({ horizonTicks: 0 });
    branch.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 1 }]);
    const c = branch.changes().domains[0].channels;
    expect(c.energy.count).toBe(1);
    expect(c.temperature.count).toBe(0);
    expect(c.material.count).toBe(0);
  });

  test('material and phase changes are independent of the mechanical word', () => {
    const { s } = session(),
      branch = s.branch({ horizonTicks: 0 });
    branch.edit([{ kind: 'material', x: 1, y: 1, z: 1, material: MAT.ICE }]);
    const c = branch.changes().domains[0].channels;
    expect(c.material.runs).toEqual([[21, 1]]);
    expect(c.phase.runs).toEqual([[21, 1]]);
    expect(c.structure.count).toBe(0);
  });

  test.each(['distances', 'loads', 'capacities', 'reactions'] as const)(
    'global %s changes include an unchanged distant cell',
    (key) => {
      const { s } = session(initial(), (state) => {
        const result = empty(state);
        result[key][63] = (state.structure[21] & 255) === 255 ? 0 : 1;
        return result;
      });
      const branch = s.branch({ horizonTicks: 0 });
      branch.edit([{ kind: 'integrity', x: 1, y: 1, z: 1, integrity: 200 }]);
      const c = branch.changes().domains[0].channels;
      expect(c.structure.runs).toEqual([[21, 1]]);
      expect(c.support.runs).toEqual([[63, 1]]);
      expect(c.support.bounds).toEqual({ min: [3, 3, 3], max: [4, 4, 4] });
    },
  );

  test('hold lifetime changes are reported even with identical present anchor masks', () => {
    const source = { ...initial(), holds: [{ id: 'lift', cells: [21], expiresAtTick: 2 }] };
    const { s, observed } = session(source),
      branch = s.branch({ horizonTicks: 0 });
    branch.releaseHold('lift');
    branch.hold({ id: 'lift', cells: [[1, 1, 1]], expiresAtTick: 3 });
    const c = branch.changes().domains[0].channels;
    expect(c.constraints.runs).toEqual([[21, 1]]);
    expect(c.structure.count).toBe(0);
    expect(c.support.count).toBe(0);
    expect(observed).not.toHaveBeenCalled();
  });

  test('temporary anchors reach the observer without leaking into canonical terrain', () => {
    const { s, observed } = session(initial(), (state) => {
      const p = empty(state);
      p.distances[63] = state.structure[21] & mechanics.ANCHOR_3D ? 3 : -1;
      return p;
    });
    const before = s.snapshot(),
      branch = s.branch({ horizonTicks: 0 });
    branch.hold({ id: 'lift', cells: [[1, 1, 1]], expiresAtTick: 2 });
    const c = branch.changes().domains[0].channels;
    expect(c.constraints.runs).toEqual([[21, 1]]);
    expect(c.support.runs).toEqual([[63, 1]]);
    expect(c.structure.count).toBe(0);
    expect(observed).toHaveBeenCalledTimes(2);
    expect(branch.inspect().terrain).toEqual(before.terrain);
    expect(s.snapshot()).toEqual(before);
  });

  test('holding an already permanent anchor does not invent a support-input change', () => {
    const w = volume();
    w.setCell(1, 1, 1, MAT.STONE);
    w.setAnchor(1, 1, 1, true);
    const { s, observed } = session({ ...initial(), terrain: w.snapshot() }),
      branch = s.branch({ horizonTicks: 0 });
    branch.hold({ id: 'lift', cells: [[1, 1, 1]], expiresAtTick: 2 });
    expect(branch.changes().domains[0].channels.constraints.count).toBe(1);
    expect(observed).not.toHaveBeenCalled();
  });

  test('adjacent changed indices coalesce into ascending x-major runs', () => {
    const { s } = session(),
      branch = s.branch({ horizonTicks: 0 });
    branch.edit(
      [2, 1, 3].map((x) => ({ kind: 'material' as const, x, y: 0, z: 0, material: MAT.SAND })),
    );
    const c = branch.changes().domains[0].channels.material;
    expect(c).toMatchObject({ mode: 'runs', count: 3, runs: [[1, 3]], requiresFullRead: false });
    expect(c.bounds).toEqual({ min: [1, 0, 0], max: [4, 1, 1] });
  });

  test('overflow keeps the exact count and complete bounds without a truncated list', () => {
    const { s } = session(),
      branch = s.branch({ horizonTicks: 0 });
    branch.edit([
      { kind: 'material', x: 1, y: 0, z: 0, material: MAT.SAND },
      { kind: 'material', x: 2, y: 0, z: 0, material: MAT.SAND },
      { kind: 'material', x: 3, y: 3, z: 3, material: MAT.SAND },
    ]);
    for (const maxRuns of [0, 1]) {
      const c = branch.changes({ maxRuns }).domains[0].channels.material;
      expect(c).toEqual({
        mode: 'bounds',
        count: 3,
        bounds: { min: [1, 0, 0], max: [4, 4, 4] },
        runs: [],
        requiresFullRead: true,
      });
    }
  });

  test('one budget covers all channels and separate reservoir domains', () => {
    const { s } = session({
        ...initial(),
        reservoirs: [{ id: 'flask', terrain: volume().snapshot() }],
      }),
      branch = s.branch({ horizonTicks: 0 });
    branch.transfer({ from: null, to: 'flask', cells: [[1, 1, 1]], offset: [0, 0, 0] });
    const report = branch.changes({ maxRuns: 1 });
    expect(report.domains.map((d) => d.domain)).toEqual([null, 'flask']);
    expect(report.domains[0].channels.material).toMatchObject({
      mode: 'runs',
      count: 1,
      runs: [[21, 1]],
    });
    expect(report.domains[1].channels.material).toMatchObject({
      mode: 'bounds',
      count: 1,
      runs: [],
      requiresFullRead: true,
    });
    expect(
      report.domains
        .flatMap((d) => Object.values(d.channels))
        .reduce((n, c) => n + c.runs.length, 0),
    ).toBeLessThanOrEqual(1);
  });

  test('motion is explicitly unobserved even when matter returns to identical endpoints', () => {
    const { s } = session(),
      branch = s.branch({ horizonTicks: 0 });
    branch.translate({ cells: [[1, 1, 1]], path: [[1, 0, 0]] });
    branch.translate({ cells: [[2, 1, 1]], path: [[-1, 0, 0]] });
    const report = branch.changes();
    expect(Object.values(report.domains[0].channels).every((c) => c.count === 0)).toBe(true);
    expect(report).toMatchObject({
      scope: 'endpoints',
      motion: { status: 'not-observed', requiresExecutionTrace: true },
    });
  });

  test('preview and committed reports agree on channels and identify their separate endpoints', () => {
    const { s } = session(),
      branch = s.branch({ horizonTicks: 0 });
    branch.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 1 }]);
    const preview = branch.changes(),
      commit = s.commit(branch),
      report = commit.changes();
    expect(preview.to).toMatchObject({
      kind: 'preview',
      operation: 1,
      horizonTicks: 0,
      completedTicks: 0,
    });
    expect(report.to).toMatchObject({ kind: 'committed', revision: { revision: 1 } });
    expect(report.from.revision).toBe(0);
    expect(report.domains).toEqual(preview.domains);
    expect(Object.isFrozen(report.from)).toBe(true);
    expect(Object.isFrozen(report.to)).toBe(true);
  });

  test('commit is lazy and retained reports survive later commits, restore and caller mutations', () => {
    const { s, observed } = session(),
      saved = s.snapshot(),
      branch = s.branch({ horizonTicks: 0 });
    branch.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 7 }]);
    const commit = s.commit(branch);
    expect(observed).not.toHaveBeenCalled();
    const expected = commit.changes(),
      caller = commit.changes();
    caller.domains[0].channels.energy.runs[0][0] = 0;
    commit.snapshot.terrain.energyQ[21] = 0;
    const next = s.branch({ horizonTicks: 0 });
    next.setGame({ ap: 0 });
    s.commit(next);
    s.restore(saved);
    expect(commit.changes()).toEqual(expected);
    expect(s.snapshot().terrain).toEqual(saved.terrain);
  });

  test('inert advancement reports absolute ticks but never claims an observed motion trajectory', async () => {
    const { s, observed } = session(),
      branch = s.branch({ horizonTicks: 1 });
    await branch.advance(1);
    const report = s.commit(branch).changes();
    expect(report.domains[0]).toMatchObject({ fromTick: 0, toTick: 1 });
    expect(report.motion.status).toBe('not-observed');
    expect(observed).not.toHaveBeenCalled();
  });

  test('a failed or malformed observation leaves the branch and live state intact', () => {
    let invalid = true;
    const { s } = session(initial(), (state) =>
      invalid ? { ...empty(state), loads: new Uint32Array(1) } : empty(state),
    );
    const before = s.snapshot(),
      branch = s.branch({ horizonTicks: 0 });
    branch.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 1 }]);
    const candidate = branch.inspect();
    expect(() => branch.changes()).toThrow(/observation/);
    expect(branch.status).toBe('ready');
    expect(branch.inspect()).toEqual(candidate);
    expect(s.snapshot()).toEqual(before);
    invalid = false;
    expect(branch.changes().domains[0].channels.energy.count).toBe(1);
  });

  test('observer input mutations cannot change stored endpoints', () => {
    const { s } = session(initial(), (state) => {
      state.energyQ.fill(0);
      state.structure.fill(0);
      return empty(state);
    });
    const branch = s.branch({ horizonTicks: 0 });
    branch.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 1 }]);
    const candidate = branch.inspect(),
      before = s.snapshot();
    branch.changes();
    expect(branch.inspect()).toEqual(candidate);
    expect(s.snapshot()).toEqual(before);
  });

  test('invalid options reject before observation without invoking getters', () => {
    const { s, observed } = session(),
      branch = s.branch({ horizonTicks: 0 });
    branch.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 1 }]);
    const getter = vi.fn(() => 1),
      accessor = Object.defineProperty({}, 'maxRuns', { get: getter, enumerable: true });
    for (const options of [
      null,
      { maxRuns: -1 },
      { maxRuns: 4097 },
      { maxRuns: 0.5 },
      { maxRuns: NaN },
      { extra: true },
      accessor,
    ])
      expect(() => branch.changes(options as never)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(observed).not.toHaveBeenCalled();
    expect(branch.status).toBe('ready');
  });

  test('stale branches reject report requests while retained committed comparisons remain valid', () => {
    const { s } = session(),
      stale = s.branch({ horizonTicks: 0 }),
      winner = s.branch({ horizonTicks: 0 });
    winner.setGame({ ap: 1 });
    const commit = s.commit(winner);
    expect(() => stale.changes()).toThrow(/stale/);
    expect(commit.changes().gameChanged).toBe(true);
  });

  test('observation cannot reenter a terrain mutation', () => {
    let edit: (() => void) | undefined;
    const { s } = session(initial(), (state) => {
      edit?.();
      return empty(state);
    });
    const branch = s.branch({ horizonTicks: 0 });
    branch.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 1 }]);
    const candidate = branch.inspect();
    edit = () => branch.setGame({ ap: 0 });
    expect(() => branch.changes()).toThrow(/in progress/);
    expect(branch.inspect()).toEqual(candidate);
    expect(branch.status).toBe('ready');
  });
});
