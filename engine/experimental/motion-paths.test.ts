import { holdPhysics } from '../test-support/hold-physics.js';
import { describe, expect, test, vi } from 'vitest';
import * as mechanics from './structural-mechanics.js';
import { CpuStructuralWorld3D } from './structural/structural-world-core.js';
import { volumeSchedule } from './3d-core.js';
import { createMotionRecorder3D } from './motion-trace.js';
import {
  createMotionPathRecorder3D,
  readMotionPaths3D,
  motionPathLimits3D,
  type MaterialMotionPaths3D,
} from './motion-paths.js';

// Recorder/decoder fixtures only: no material pass or real solve is permitted.
holdPhysics('solveStructure3D', 'step', 'stepWithMotion', 'stepWithMotionPaths');
function plan(): mechanics.StructuralPlan3D {
  return {
    state: {
      grid: new Uint32Array(64),
      energyQ: new Uint32Array(64),
      structure: new Uint32Array(64),
    },
    sources: Uint32Array.from({ length: 64 }, (_, i) => i),
    distances: new Int32Array(64).fill(-1),
    loads: new Uint32Array(64),
    capacities: new Uint32Array(64),
    reactions: new Uint32Array(64),
    componentIds: new Int32Array(64).fill(-1),
    moving: new Uint8Array(64),
    supportedWeight: 0,
    brokenCells: 0,
    movedCells: 0,
  };
}
function falling() {
  const p = plan();
  p.sources[25] = 21;
  p.sources[29] = 25;
  p.sources[21] = 29;
  p.moving[21] = p.moving[25] = 1;
  p.componentIds[21] = p.componentIds[25] = 21;
  return p;
}
function fixture(
  options: {
    plan?: mechanics.StructuralPlan3D;
    maximum?: number;
    motionMaximum?: number;
    tick?: number;
  } = {},
) {
  const before = new CpuStructuralWorld3D({
    width: 4,
    height: 4,
    depth: 4,
    chunkSize: 4,
  }).snapshot();
  before.tick = options.tick ?? 0;
  const after = { ...before, tick: before.tick + 1 },
    identity = {
      physicsRulesVersion: before.rulesVersion,
      materialCatalogHash: before.materialCatalogHash,
    };
  const p = options.plan ?? plan(),
    net = createMotionRecorder3D(p, before, before.tick, identity, options.motionMaximum ?? 4096);
  const path = createMotionPathRecorder3D(
    p,
    before,
    before.tick,
    identity,
    options.maximum ?? 4096,
  );
  net.provenance.pathSwap = path.swap;
  const schedule = volumeSchedule(before.tick);
  let at = 0;
  function pass(pairs: [number, number][] = []) {
    const v = net.provenance;
    v.output.set(v.input);
    for (const [a, b] of pairs) {
      // Explicit synthetic executed swaps: not the physical material kernel.
      v.output[a] = v.input[b];
      v.output[b] = v.input[a];
      v.touched[v.input[a]] = v.touched[v.input[b]] = 1;
      v.pathSwap?.(a, b, v.input[a], v.input[b]);
    }
    path.endPass(schedule[at++]);
    net.endPass();
  }
  function finish() {
    while (at < schedule.length) pass();
    const motion = net.finish(),
      paths = path.finish(motion);
    return { motion, paths, before, after };
  }
  return { before, after, path, net, schedule, pass, finish };
}
function decode(r: ReturnType<ReturnType<typeof fixture>['finish']>) {
  return readMotionPaths3D(r.paths, r.motion, r.before, r.after);
}
function basic() {
  const f = fixture();
  f.pass([[0, 4]]);
  return f.finish();
}
const movementCases = volumeSchedule(0)
  .map((pass, index) => ({ pass, index }))
  .filter(({ pass }) => !['heat', 'phase'].includes(pass.kind));

describe('observed material paths from synthetic executed permutations', () => {
  test('identity records complete schedule coverage without allocating detail entries', () => {
    const r = fixture({ maximum: 0, motionMaximum: 0 }).finish();
    expect(r.paths).toMatchObject({
      status: 'complete',
      passesObserved: 28,
      cellTransfers: 0,
      passes: [],
    });
    expect(decode(r)).toEqual(r.paths);
  });
  test('structural falling members are linear while terminal occupants relocate instantly', () => {
    const r = fixture({ plan: falling() }).finish();
    expect(r.paths.passes).toEqual([
      {
        index: 0,
        segments: [
          { origin: 21, from: 21, to: 25, mode: 'linear' },
          { origin: 25, from: 25, to: 29, mode: 'linear' },
          { origin: 29, from: 29, to: 21, mode: 'relocation' },
        ],
      },
    ]);
    expect(decode(r)).toEqual(r.paths);
  });
  test('original identity survives multiple passes rather than restarting at each cell', () => {
    const f = fixture();
    f.pass([[0, 4]]);
    f.pass([[4, 8]]);
    const r = f.finish();
    expect(r.paths.passes[1]).toEqual({
      index: 2,
      segments: [
        { origin: 0, from: 4, to: 8, mode: 'linear' },
        { origin: 8, from: 8, to: 4, mode: 'linear' },
      ],
    });
    expect(decode(r)).toEqual(r.paths);
  });
  test('round trips retain both visited segments even when net displacement is zero', () => {
    const f = fixture();
    f.pass([[0, 4]]);
    for (let i = 1; i < 14; i++) f.pass();
    f.pass([[0, 4]]);
    const r = f.finish();
    expect(r.motion.moves).toEqual([]);
    expect(r.motion.touched).toEqual([
      [0, 1],
      [4, 1],
    ]);
    expect(r.paths.cellTransfers).toBe(4);
    expect(r.paths.passes.map((p) => p.index)).toEqual([1, 15]);
    expect(decode(r)).toEqual(r.paths);
  });
  test('a simultaneous pass is canonical regardless of callback enumeration order', () => {
    const a = fixture(),
      b = fixture();
    a.pass([
      [1, 5],
      [0, 4],
    ]);
    b.pass([
      [0, 4],
      [1, 5],
    ]);
    const x = a.finish(),
      y = b.finish();
    expect(x.paths).toEqual(y.paths);
    expect(decode(x)).toEqual(x.paths);
  });
  test.each(movementCases)(
    'pass $index ($pass.kind) obeys its axis, direction and parity',
    ({ pass, index }) => {
      const f = fixture();
      for (let i = 0; i < index; i++) f.pass();
      const vertical = ['gravity', 'diagonal', 'buoyancy'].includes(pass.kind),
        axis = vertical ? 1 : pass.axis;
      const a = [1, 1, 1];
      a[axis] = pass.parity;
      const b = a.slice();
      b[axis]++;
      if (pass.kind === 'diagonal') b[pass.axis] += pass.direction;
      const cell = (v: number[]) => v[0] + 4 * (v[1] + 4 * v[2]);
      f.pass([[cell(a), cell(b)]]);
      const r = f.finish();
      expect(decode(r)).toEqual(r.paths);
    },
  );
  test('odd absolute ticks use their own rotated diagonal and horizontal schedule', () => {
    const f = fixture({ tick: 3 });
    f.pass();
    f.pass();
    f.pass([[17, 5]]);
    const r = f.finish();
    expect(r.paths).toMatchObject({ fromTick: 3, toTick: 4 });
    expect(decode(r)).toEqual(r.paths);
  });
  test('the shared pass-plus-segment budget is exact and overflow removes all detail', () => {
    const a = fixture({ maximum: 3 });
    a.pass([[0, 4]]);
    expect(a.finish().paths.status).toBe('complete');
    const b = fixture({ maximum: 2 });
    b.pass([[0, 4]]);
    const r = b.finish();
    expect(r.paths).toMatchObject({
      status: 'overflow',
      requiresReexecution: true,
      passes: [],
      cellTransfers: 2,
    });
    expect(decode(r)).toEqual(r.paths);
  });
  test('late overflow drops earlier passes and continues exact observed counts', () => {
    const f = fixture({ maximum: 3 });
    f.pass([[0, 4]]);
    f.pass([[4, 8]]);
    const r = f.finish();
    expect(r.paths).toMatchObject({
      status: 'overflow',
      passes: [],
      cellTransfers: 4,
      passesObserved: 28,
    });
    expect(decode(r)).toEqual(r.paths);
  });
  test('net trace overflow prevents a complete path claim even with enough path budget', () => {
    const r = fixture({ plan: falling(), motionMaximum: 0 }).finish();
    expect(r.paths).toMatchObject({ status: 'overflow', passes: [], cellTransfers: 3 });
    expect(decode(r)).toEqual(r.paths);
  });
  test('returned path detail and decoder results own nested storage', () => {
    const r = basic(),
      copy = decode(r),
      again = structuredClone(copy);
    r.paths.passes[0].segments[0].origin = 60;
    expect(copy).toEqual(again);
    copy.passes[0].segments.length = 0;
    expect(again.passes[0].segments).toHaveLength(2);
  });
  test('incomplete coverage, wrong ordering, thermal swaps and post-finish events reject', () => {
    const f = fixture();
    expect(() => f.path.finish(f.net.finish())).toThrow(/coverage/);
    expect(() => f.path.endPass(f.schedule[1])).toThrow(/schedule/);
    for (let i = 0; i < 20; i++) f.pass();
    expect(() => f.path.swap(0, 4, 0, 4)).toThrow(/movement/);
    f.finish();
    expect(() => f.path.endPass(f.schedule[0])).toThrow(/Unexpected/);
    expect(() => f.path.swap(0, 4, 0, 4)).toThrow();
  });
  test('invalid options reject accessors, excess fields and limits without callbacks', () => {
    for (const input of [
      null,
      { maxPathEntries: -1 },
      { maxPathEntries: 65537 },
      { maxPathEntries: 0.1 },
      { maxEntries: -1 },
      { extra: true },
    ])
      expect(() => motionPathLimits3D(input as never)).toThrow();
    const getter = vi.fn(() => 0);
    expect(() =>
      motionPathLimits3D(
        Object.defineProperty({}, 'maxPathEntries', { get: getter, enumerable: true }),
      ),
    ).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(motionPathLimits3D()).toEqual({ motionLimit: 4096, pathLimit: 4096 });
    expect(motionPathLimits3D({ maxPathEntries: 0 })).toMatchObject({ pathLimit: 0 });
  });
});

describe('portable movement chronology rejects inconsistent or forged detail', () => {
  test('identity, pass coverage and count mismatches reject', () => {
    const r = basic();
    for (const patch of [
      { rulesVersion: 'wrong' },
      { width: 8 },
      { fromTick: 1 },
      { materialCatalogHash: 'bad' },
      { passesObserved: 27 },
      { cellTransfers: 3 },
      { requiresReexecution: true },
    ])
      expect(() =>
        readMotionPaths3D({ ...r.paths, ...patch } as never, r.motion, r.before, r.after),
      ).toThrow();
  });
  test('malformed snapshots and incompatible after geometry reject before acceptance', () => {
    const r = basic();
    expect(() =>
      readMotionPaths3D(r.paths, r.motion, { ...r.before, packedCells: [] }, r.after),
    ).toThrow();
    expect(() => readMotionPaths3D(r.paths, r.motion, r.before, { ...r.after, tick: 2 })).toThrow();
  });
  test('lost paths, wrong origins, parity and destination permutation reject', () => {
    const r = basic(),
      changes: ((p: MaterialMotionPaths3D) => void)[] = [
        (p) => {
          p.passes = [];
        },
        (p) => {
          p.passes[0].segments[0].origin = 1;
        },
        (p) => {
          p.passes[0].index = 2;
        },
        (p) => {
          p.passes[0].segments[0].to = 8;
        },
        (p) => {
          p.passes[0].segments[1].to = 4;
        },
        (p) => {
          p.passes[0].segments[0].mode = 'relocation';
        },
        (p) => {
          p.passes[0].index = 21;
        },
      ];
    for (const change of changes) {
      const p = structuredClone(r.paths);
      change(p);
      expect(() => readMotionPaths3D(p, r.motion, r.before, r.after)).toThrow();
    }
  });
  test('structural relocation cannot masquerade as a swept fall or omit a member', () => {
    const r = fixture({ plan: falling() }).finish(),
      p = structuredClone(r.paths);
    p.passes[0].segments[2].mode = 'linear';
    expect(() => readMotionPaths3D(p, r.motion, r.before, r.after)).toThrow();
    p.passes = [];
    p.cellTransfers = 0;
    expect(() => readMotionPaths3D(p, r.motion, r.before, r.after)).toThrow();
  });
  test('paths returning to start cannot drop their touched identities', () => {
    const f = fixture();
    f.pass([[0, 4]]);
    for (let i = 1; i < 14; i++) f.pass();
    f.pass([[0, 4]]);
    const r = f.finish();
    expect(() =>
      readMotionPaths3D({ ...r.paths, cellTransfers: 0, passes: [] }, r.motion, r.before, r.after),
    ).toThrow();
  });
  test('a forged local round trip cannot move intact structural members despite matching endpoints', () => {
    const f = fixture({ plan: falling() });
    f.pass([[25, 29]]);
    for (let i = 1; i < 14; i++) f.pass();
    f.pass([[25, 29]]);
    const r = f.finish();
    expect(r.motion.fragments).toEqual([
      {
        id: 21,
        cells: 2,
        sourceRuns: [
          [21, 1],
          [25, 1],
        ],
      },
    ]);
    expect(() => decode(r)).toThrow(/intact fragment/);
  });
  test('nested arrays share one prospective budget and cannot hide getters or holes', () => {
    const r = basic(),
      p = structuredClone(r.paths);
    p.passes[0].segments = new Array(65536).fill(p.passes[0].segments[0]);
    expect(() => readMotionPaths3D(p, r.motion, r.before, r.after)).toThrow(/budget/);
    const getter = vi.fn(() => []),
      bad = Object.defineProperty({ ...r.paths }, 'passes', { enumerable: true, get: getter });
    expect(() => readMotionPaths3D(bad, r.motion, r.before, r.after)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() =>
      readMotionPaths3D({ ...r.paths, passes: new Array(1) }, r.motion, r.before, r.after),
    ).toThrow();
  });
  test('overflow records cannot expose a prefix or impossible transfer count', () => {
    const r = basic();
    expect(() =>
      readMotionPaths3D(
        { ...r.paths, status: 'overflow', requiresReexecution: true },
        r.motion,
        r.before,
        r.after,
      ),
    ).toThrow(/partial/);
    expect(() =>
      readMotionPaths3D(
        { ...r.paths, status: 'overflow', requiresReexecution: true, passes: [], cellTransfers: 0 },
        r.motion,
        r.before,
        r.after,
      ),
    ).toThrow();
  });
});
