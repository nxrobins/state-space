import { holdPhysics } from '../test-support/hold-physics.js';
import { describe, expect, test, vi } from 'vitest';
import * as mechanics from './structural-mechanics.js';
import { CpuStructuralWorld3D, type StructuralSnapshot3D } from './structural-world-core.js';
import {
  createTacticalSessionCore3D,
  type TacticalSimulationFactory3D,
} from './tactical/tactical-session-core.js';
import {
  appendMotionFrame3D,
  createMotionRecorder3D,
  motionEntryLimit3D,
  motionJournal3D,
  readMotionTrace3D,
  MOTION_TRACE_RULES_3D,
  type MaterialMotionTrace3D,
  type MotionJournalData3D,
} from './motion-trace.js';

holdPhysics('solveStructure3D', 'step', 'stepWithMotion');
const world = () => new CpuStructuralWorld3D({ width: 4, height: 4, depth: 4, chunkSize: 4 });
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
function recorder(p = plan(), maximum = 4096) {
  const s = world().snapshot();
  return {
    before: s,
    after: { ...s, tick: 1 },
    recorder: createMotionRecorder3D(
      p,
      s,
      0,
      { physicsRulesVersion: s.rulesVersion, materialCatalogHash: s.materialCatalogHash },
      maximum,
    ),
  };
}
function fixturePass(r: ReturnType<typeof createMotionRecorder3D>, pairs: [number, number][]) {
  // Explicit synthetic swap events; this does not execute a material pass.
  const p = r.provenance;
  p.output.set(p.input);
  for (const [a, b] of pairs) {
    p.output[a] = p.input[b];
    p.output[b] = p.input[a];
    p.touched[p.input[a]] = p.touched[p.input[b]] = 1;
  }
  r.endPass();
}
function emptyTrace(s: StructuralSnapshot3D): MaterialMotionTrace3D {
  return {
    rulesVersion: MOTION_TRACE_RULES_3D,
    physicsRulesVersion: s.rulesVersion,
    materialCatalogHash: s.materialCatalogHash,
    width: s.width,
    height: s.height,
    depth: s.depth,
    fromTick: s.tick - 1,
    toTick: s.tick,
    status: 'complete',
    requiresReexecution: false,
    movedCells: 0,
    touchedCells: 0,
    fragmentCount: 0,
    fragmentCells: 0,
    moves: [],
    touched: [],
    fragments: [],
  };
}

describe('pure motion recorder and portable trace validation', () => {
  test('identity has no invented motion and needs no detail entries', () => {
    const { recorder: r, before, after } = recorder(plan(), 0);
    const trace = r.finish();
    expect(trace).toMatchObject({
      status: 'complete',
      movedCells: 0,
      touchedCells: 0,
      moves: [],
      touched: [],
      fragments: [],
    });
    expect(readMotionTrace3D(trace, before, after)).toEqual(trace);
    expect('chunkSize' in trace).toBe(false);
  });
  test('records a falling two-cell fragment and its displaced occupant despite equal cell values', () => {
    const p = falling(),
      { recorder: r, before, after } = recorder(p),
      physical = p.state.grid.slice();
    const trace = r.finish();
    expect(trace).toMatchObject({
      movedCells: 3,
      touchedCells: 3,
      fragmentCount: 1,
      fragmentCells: 2,
      moves: [
        [21, 25, 1],
        [25, 29, 1],
        [29, 21, 1],
      ],
      touched: [
        [21, 1],
        [25, 1],
        [29, 1],
      ],
      fragments: [
        {
          id: 21,
          cells: 2,
          sourceRuns: [
            [21, 1],
            [25, 1],
          ],
        },
      ],
    });
    expect(p.state.grid).toEqual(physical);
    expect(readMotionTrace3D(trace, before, after)).toEqual(trace);
  });
  test('correspondence composes later swaps by original identity', () => {
    const { recorder: r } = recorder();
    fixturePass(r, [[0, 1]]);
    fixturePass(r, [[1, 2]]);
    expect(r.finish()).toMatchObject({
      movedCells: 3,
      touchedCells: 3,
      moves: [
        [0, 2, 1],
        [1, 0, 2],
      ],
      touched: [[0, 3]],
    });
  });
  test('returning to the original cell retains touched identity', () => {
    const { recorder: r, before, after } = recorder();
    fixturePass(r, [[0, 1]]);
    fixturePass(r, [[0, 1]]);
    const trace = r.finish();
    expect(trace).toMatchObject({ movedCells: 0, touchedCells: 2, moves: [], touched: [[0, 2]] });
    expect(readMotionTrace3D(trace, before, after)).toEqual(trace);
  });
  test('nonmoving heat/phase fixture passes preserve correspondence and fragment metadata', () => {
    const { recorder: r } = recorder(falling());
    fixturePass(r, []);
    fixturePass(r, []);
    expect(r.finish().fragments).toEqual([
      {
        id: 21,
        cells: 2,
        sourceRuns: [
          [21, 1],
          [25, 1],
        ],
      },
    ]);
  });
  test('the exact shared budget boundary is complete, one fewer entry is explicit overflow', () => {
    expect(recorder(falling(), 9).recorder.finish().status).toBe('complete');
    const { recorder: r, before, after } = recorder(falling(), 8),
      trace = r.finish();
    expect(trace).toMatchObject({
      status: 'overflow',
      requiresReexecution: true,
      movedCells: 3,
      touchedCells: 3,
      fragmentCells: 2,
      fragmentCount: 1,
      moves: [],
      touched: [],
      fragments: [],
    });
    expect(readMotionTrace3D(trace, before, after)).toEqual(trace);
  });
  test('duplicate or out-of-bounds source identity fails before a trace can publish', () => {
    const p = plan();
    p.sources[1] = 0;
    expect(() => recorder(p).recorder.finish()).toThrow(/permutation/);
    p.sources[1] = 64;
    expect(() => recorder(p)).toThrow(/integer/);
  });
  test('fragment roots and closed-floor descent are checked', () => {
    const p = falling();
    p.componentIds[21] = p.componentIds[25] = 20;
    expect(() => recorder(p).recorder.finish()).toThrow(/root/);
    const floor = plan();
    floor.sources[33] = 29;
    floor.sources[29] = 33;
    floor.moving[29] = 1;
    floor.componentIds[29] = 29;
    expect(() => recorder(floor).recorder.finish()).toThrow(/descent/);
  });
  test('a later fixture cannot silently relocate a structurally intact fragment', () => {
    const { recorder: r } = recorder(falling());
    fixturePass(r, [[25, 26]]);
    expect(() => r.finish()).toThrow(/correspondence/);
  });
  test('portable reads own all nested detail arrays', () => {
    const { recorder: r, before, after } = recorder(falling()),
      original = r.finish(),
      copy = readMotionTrace3D(original, before, after);
    original.moves[0][0] = 0;
    original.touched[0][0] = 0;
    original.fragments[0].sourceRuns[0][0] = 0;
    expect(copy.moves[0][0]).toBe(21);
    expect(copy.touched[0][0]).toBe(21);
    expect(copy.fragments[0].sourceRuns[0][0]).toBe(21);
  });
  test('malformed metadata, counts, permutations and missing touched identities reject', () => {
    const { recorder: r, before, after } = recorder(falling()),
      trace = r.finish();
    const mutations: ((v: MaterialMotionTrace3D) => void)[] = [
      (v) => {
        v.fromTick++;
      },
      (v) => {
        v.materialCatalogHash = 'wrong';
      },
      (v) => {
        v.width++;
      },
      (v) => {
        v.movedCells++;
      },
      (v) => {
        v.moves[0][1] = v.moves[1][1];
      },
      (v) => {
        v.touched = [];
        v.touchedCells = 0;
      },
      (v) => {
        v.moves = [
          [21, 29, 1],
          [25, 21, 1],
          [29, 25, 1],
        ];
      },
      (v) => {
        v.status = 'overflow';
        v.requiresReexecution = true;
      },
      (v) => {
        v.fragments[0].cells++;
      },
    ];
    for (const mutate of mutations) {
      const copy = structuredClone(trace);
      mutate(copy);
      expect(() => readMotionTrace3D(copy, before, after)).toThrow();
    }
  });
  test('portable decoding enforces one shared budget before copying nested fragment runs', () => {
    const { recorder: r, before, after } = recorder(falling()),
      trace = r.finish();
    trace.fragments[0].sourceRuns = new Array(65536).fill([21, 1]);
    expect(() => readMotionTrace3D(trace, before, after)).toThrow(/bounded/);
  });
  test('accessors, sparse arrays and invalid limits reject without reading getters', () => {
    const { recorder: r, before, after } = recorder(),
      trace = r.finish(),
      getter = vi.fn(() => 1);
    const bad = Object.defineProperty({ ...trace }, 'moves', { get: getter, enumerable: true });
    expect(() => readMotionTrace3D(bad, before, after)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() => readMotionTrace3D({ ...trace, touched: new Array(1) }, before, after)).toThrow();
    for (const options of [
      null,
      { maxEntries: -1 },
      { maxEntries: 65537 },
      { maxEntries: 0.5 },
      { unknown: true },
    ])
      expect(() => motionEntryLimit3D(options as never)).toThrow();
  });
  test('journal record overflow exposes no seemingly complete prefix', () => {
    const data: MotionJournalData3D = {
        status: 'complete',
        recordsObserved: 0,
        entries: 0,
        frames: [],
      },
      trace = emptyTrace({ ...world().snapshot(), tick: 1 });
    for (let i = 0; i < 256; i++) appendMotionFrame3D(data, { domain: null, operation: 1, trace });
    expect(data.status).toBe('complete');
    appendMotionFrame3D(data, { domain: null, operation: 1, trace });
    expect(data).toMatchObject({
      status: 'overflow',
      recordsObserved: 257,
      frames: [],
      entries: 0,
    });
  });
  test('journal detail budget and incomplete tick traces cause explicit overflow', () => {
    const trace = recorder().recorder.finish();
    trace.touchedCells = 1;
    trace.touched = [[0, 1]];
    const data: MotionJournalData3D = {
      status: 'complete',
      recordsObserved: 0,
      entries: 65535,
      frames: [],
    };
    appendMotionFrame3D(data, { domain: null, operation: 1, trace });
    expect(data.status).toBe('complete');
    appendMotionFrame3D(data, { domain: null, operation: 1, trace });
    expect(data.status).toBe('overflow');
    expect(data.frames).toEqual([]);
    const fresh: MotionJournalData3D = {
      status: 'complete',
      recordsObserved: 0,
      entries: 0,
      frames: [],
    };
    appendMotionFrame3D(fresh, {
      domain: null,
      operation: 1,
      trace: recorder(falling(), 0).recorder.finish(),
    });
    expect(fresh.status).toBe('overflow');
  });
});

function mock(
  options: {
    reservoir?: boolean;
    missing?: boolean;
    trace?: (
      s: StructuralSnapshot3D,
      domain: string | null,
    ) => MaterialMotionTrace3D | Promise<MaterialMotionTrace3D>;
    closeFails?: boolean;
  } = {},
) {
  const terrain = world().snapshot(),
    closed: (string | null)[] = [],
    requested: { domain: string | null; capture: boolean; maximum: number }[] = [],
    reads = vi.fn();
  const factory: TacticalSimulationFactory3D = (input, domain, capture, maximum) => {
    requested.push({ domain, capture, maximum });
    let state = structuredClone(input);
    return {
      load(s) {
        state = structuredClone(s);
      },
      step() {
        state.tick++;
      },
      snapshot: () => state,
      ...(!options.missing
        ? {
            motion() {
              reads();
              return options.trace ? options.trace(state, domain) : emptyTrace(state);
            },
          }
        : {}),
      close() {
        closed.push(domain);
        if (options.closeFails) throw Error('fixture close failure');
      },
    };
  };
  const s = createTacticalSessionCore3D(
    {
      worldId: 'motion-world',
      gameRulesVersion: 'motion-game-1',
      terrain,
      game: { ap: 2 },
      reservoirs: options.reservoir ? [{ id: 'flask', terrain: structuredClone(terrain) }] : [],
    },
    factory,
    {},
    async () => {},
  );
  return { s, closed, requested, reads };
}

describe('motion journals with inert drivers only', () => {
  test('disabled capture never asks the driver for motion', async () => {
    const { s, reads, requested } = mock(),
      b = s.branch({ horizonTicks: 1 });
    await b.advance(1);
    const result = s.commit(b);
    expect(reads).not.toHaveBeenCalled();
    expect(requested[0].capture).toBe(false);
    expect(result.motion()).toMatchObject({
      status: 'disabled',
      requiresReexecution: true,
      scope: 'simulation-ticks',
      frames: [],
    });
  });
  test('ordered primary/reservoir frames retain operation, tick and committed identities', async () => {
    const { s, requested } = mock({ reservoir: true }),
      b = s.branch({ horizonTicks: 2, captureMotion: true, motionMaxEntries: 9 });
    await b.advance(1);
    await b.advance(1);
    const preview = b.motion(),
      result = s.commit(b),
      committed = result.motion();
    expect(
      committed.frames.map((f) => [f.domain, f.operation, f.trace.fromTick, f.trace.toTick]),
    ).toEqual([
      [null, 1, 0, 1],
      ['flask', 1, 0, 1],
      [null, 2, 1, 2],
      ['flask', 2, 1, 2],
    ]);
    expect(committed.frames).toEqual(preview.frames);
    expect(committed.to).toMatchObject({ kind: 'committed', revision: { revision: 1 } });
    expect(requested.every((r) => r.capture && r.maximum === 9)).toBe(true);
    expect(committed.includesInterventions).toBe(false);
    expect(committed.includesSubpassPaths).toBe(false);
  });
  test('retained journals are isolated from callers and subsequent restore', async () => {
    const { s } = mock(),
      saved = s.snapshot(),
      b = s.branch({ horizonTicks: 1, captureMotion: true });
    await b.advance(1);
    const result = s.commit(b),
      expected = result.motion(),
      caller = result.motion();
    caller.frames[0].trace.fromTick = 99;
    result.snapshot.terrain.tick = 99;
    s.restore(saved);
    expect(result.motion()).toEqual(expected);
    expect('motion' in saved).toBe(false);
    expect('captureMotion' in saved).toBe(false);
  });
  test('requested capture without driver support fails atomically and closes the driver', async () => {
    const { s, closed } = mock({ missing: true }),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 1, captureMotion: true });
    await expect(b.advance(1)).rejects.toThrow(/requested motion/);
    expect(s.snapshot()).toEqual(before);
    expect(closed).toEqual([null]);
    expect(() => b.motion()).toThrow(/failed/);
  });
  test('a bad reservoir trace cannot publish a staged primary trace', async () => {
    const { s, closed } = mock({
      reservoir: true,
      trace: (state, domain) => ({ ...emptyTrace(state), fromTick: domain ? 99 : state.tick - 1 }),
    });
    const before = s.snapshot(),
      b = s.branch({ horizonTicks: 1, captureMotion: true });
    await expect(b.advance(1)).rejects.toThrow(/identity/);
    expect(s.snapshot()).toEqual(before);
    expect(closed).toEqual(['flask', null]);
    expect(() => s.commit(b)).toThrow(/failed/);
  });
  test('driver detail above the requested budget fails before publication', async () => {
    const { s } = mock({
        trace: (state) => ({ ...emptyTrace(state), touchedCells: 1, touched: [[0, 1]] }),
      }),
      before = s.snapshot();
    const b = s.branch({ horizonTicks: 1, captureMotion: true, motionMaxEntries: 0 });
    await expect(b.advance(1)).rejects.toThrow(/budget/);
    expect(s.snapshot()).toEqual(before);
  });
  test('a valid overflow trace preserves simulation but reports the journal as incomplete', async () => {
    const { s } = mock({
      trace: (state) => ({
        ...emptyTrace(state),
        status: 'overflow',
        requiresReexecution: true,
        touchedCells: 1,
      }),
    });
    const b = s.branch({ horizonTicks: 1, captureMotion: true });
    await b.advance(1);
    const result = s.commit(b);
    expect(result.snapshot.terrain.tick).toBe(1);
    expect(result.motion()).toMatchObject({
      status: 'overflow',
      requiresReexecution: true,
      recordsObserved: 1,
      frames: [],
    });
  });
  test('cancellation during trace retrieval discards private frames and cleans the driver', async () => {
    let release!: () => void, entered!: () => void;
    const ready = new Promise<void>((r) => {
        entered = r;
      }),
      wait = new Promise<void>((r) => {
        release = r;
      });
    const { s, closed } = mock({
        trace: async (state) => {
          entered();
          await wait;
          return emptyTrace(state);
        },
      }),
      before = s.snapshot(),
      signal = new AbortController();
    const b = s.branch({ horizonTicks: 1, captureMotion: true }),
      advancement = b.advance(1, { signal: signal.signal });
    await ready;
    expect(() => b.motion()).toThrow(/in flight/);
    signal.abort();
    release();
    await expect(advancement).rejects.toThrow(/discarded/);
    expect(s.snapshot()).toEqual(before);
    expect(closed).toEqual([null]);
  });
  test('cleanup failure does not publish an otherwise complete journal or world', async () => {
    const { s, closed } = mock({ closeFails: true }),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 1, captureMotion: true });
    await expect(b.advance(1)).rejects.toThrow(/cleanup/);
    expect(s.snapshot()).toEqual(before);
    expect(closed).toEqual([null]);
    expect(() => b.motion()).toThrow(/failed/);
  });
  test('invalid capture options reject before creating a branch or driver', () => {
    const { s, requested } = mock();
    for (const options of [
      { captureMotion: null },
      { captureMotion: 1 },
      { captureMotion: true, motionMaxEntries: 65537 },
      { motionMaxEntries: 1 },
    ])
      expect(() => s.branch({ horizonTicks: 1, ...options } as never)).toThrow();
    expect(requested).toEqual([]);
  });
  test('stale preview journals reject while a committed zero-tick journal stays bound', () => {
    const { s } = mock(),
      a = s.branch({ horizonTicks: 0, captureMotion: true }),
      b = s.branch({ horizonTicks: 0, captureMotion: true });
    b.setGame({ ap: 1 });
    const result = s.commit(b);
    expect(() => a.motion()).toThrow(/stale/);
    expect(result.motion()).toMatchObject({ status: 'complete', recordsObserved: 0, frames: [] });
    const copied = motionJournal3D(
      { status: 'complete', recordsObserved: 0, entries: 0, frames: [] },
      result.receipt.base,
      { kind: 'committed', revision: s.revision },
    );
    expect(Object.isFrozen(copied.to)).toBe(true);
  });
});
