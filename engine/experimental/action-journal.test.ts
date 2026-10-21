import { holdPhysics } from '../test-support/hold-physics.js';
import { describe, expect, test, vi } from 'vitest';
import { MAT } from './3d.js';
import * as mechanics from './structural-mechanics.js';
import {
  CpuStructuralWorld3D,
  type StructuralSnapshot3D,
} from './structural/structural-world-core.js';
import {
  createTacticalSessionCore3D,
  type TacticalSimulationFactory3D,
} from './tactical/tactical-session-core.js';
import {
  appendActionEvent3D,
  createActionJournal3D,
  ACTION_JOURNAL_LIMITS_3D,
  type RawAction3D,
} from './action-journal.js';
import { MOTION_TRACE_RULES_3D, type MaterialMotionTrace3D } from './motion-trace.js';
import type { GameplayChangeReport3D, SupportObserver3D } from './change-reports.js';
import type {
  TacticalSessionInitial3D,
  TacticalSessionPolicy3D,
} from './tactical/tactical-session-view.js';

holdPhysics('solveStructure3D', 'step', 'stepWithMotion');
const world = () => new CpuStructuralWorld3D({ width: 4, height: 4, depth: 4, chunkSize: 4 });
function initial(): TacticalSessionInitial3D<{ ap: number }> {
  const w = world();
  w.setCell(1, 1, 1, MAT.STONE, 100);
  w.setIntegrity(1, 1, 1, 73);
  return {
    worldId: 'action-world',
    gameRulesVersion: 'action-game-1',
    terrain: w.snapshot(),
    game: { ap: 2 },
  };
}
const emptySupport: SupportObserver3D = (s) => ({
  distances: new Int32Array(s.packedCells.length).fill(-1),
  loads: new Uint32Array(s.packedCells.length),
  capacities: new Uint32Array(s.packedCells.length),
  reactions: new Uint32Array(s.packedCells.length),
});
function trace(s: StructuralSnapshot3D): MaterialMotionTrace3D {
  return {
    width: s.width,
    height: s.height,
    depth: s.depth,
    rulesVersion: MOTION_TRACE_RULES_3D,
    physicsRulesVersion: s.rulesVersion,
    materialCatalogHash: s.materialCatalogHash,
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
function fixture(
  options: {
    source?: TacticalSessionInitial3D<{ ap: number }>;
    observe?: SupportObserver3D;
    policy?: TacticalSessionPolicy3D<{ ap: number }>;
    tick?: (s: StructuralSnapshot3D, domain: string | null) => void;
    motion?: (
      s: StructuralSnapshot3D,
      domain: string | null,
    ) => MaterialMotionTrace3D | Promise<MaterialMotionTrace3D>;
    closeFails?: boolean;
  } = {},
) {
  const observed = vi.fn(options.observe ?? emptySupport),
    closed: (string | null)[] = [],
    requested: boolean[] = [];
  const factory: TacticalSimulationFactory3D = (input, domain, capture) => {
    let s = structuredClone(input);
    requested.push(capture);
    return {
      load(value) {
        s = structuredClone(value);
      },
      step() {
        s.tick++;
        options.tick?.(s, domain);
      },
      snapshot: () => s,
      motion: () => (options.motion ? options.motion(s, domain) : trace(s)),
      close() {
        closed.push(domain);
        if (options.closeFails) throw Error('fixture cleanup');
      },
    };
  };
  return {
    s: createTacticalSessionCore3D(
      options.source ?? initial(),
      factory,
      options.policy ?? {},
      async () => {},
      observed,
    ),
    observed,
    closed,
    requested,
  };
}

describe('ordered action capture with inert simulation and support observers', () => {
  test('default branches add no support observations or motion requirements', async () => {
    const { s, observed, requested } = fixture(),
      b = s.branch({ horizonTicks: 1 });
    b.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 1 }]);
    await b.advance(1);
    expect(s.commit(b).journal()).toMatchObject({
      status: 'disabled',
      requiresReexecution: true,
      recordsObserved: 0,
      events: [],
    });
    expect(observed).not.toHaveBeenCalled();
    expect(requested).toEqual([false]);
  });
  test('mixed operations and two ticks retain exact sequence and operation identities', async () => {
    const { s, requested } = fixture(),
      b = s.branch({ horizonTicks: 2, captureJournal: true });
    b.edit([{ kind: 'integrity', x: 1, y: 1, z: 1, integrity: 70 }]);
    b.translate({ cells: [[1, 1, 1]], path: [[1, 0, 0]] });
    b.hold({ id: 'lift', cells: [[2, 1, 1]], expiresAtTick: 2 });
    b.releaseHold('lift');
    b.addEnergy([{ x: 2, y: 1, z: 1, deltaQ: 3 }]);
    b.setGame({ ap: 1 });
    await b.advance(2);
    const preview = b.journal(),
      result = s.commit(b),
      journal = result.journal();
    expect(journal.events.map((e) => e.action.kind)).toEqual([
      'edit',
      'translate',
      'hold',
      'release-hold',
      'energy',
      'game',
      'tick',
      'tick',
    ]);
    expect(journal.events.map((e) => e.operation)).toEqual([1, 2, 3, 4, 5, 6, 7, 7]);
    expect(journal.events.map((e) => [e.from.sequence, e.to.sequence])).toEqual(
      Array.from({ length: 8 }, (_, i) => [i, i + 1]),
    );
    expect(
      journal.events.slice(-2).map((e) => [e.from.tick, e.to.tick, e.to.completedTicks]),
    ).toEqual([
      [0, 1, 1],
      [1, 2, 2],
    ]);
    expect(journal.events).toEqual(preview.events);
    expect(journal.to).toMatchObject({ kind: 'committed', revision: { revision: 1, tick: 2 } });
    expect(preview.to).toMatchObject({ kind: 'preview', operation: 7, completedTicks: 2 });
    expect(requested).toEqual([true]);
  });
  test('a zero-tick advance changes no physical event coverage', async () => {
    const { s } = fixture(),
      b = s.branch({ horizonTicks: 0, captureJournal: true });
    await b.advance(0);
    b.setGame({ ap: 1 });
    expect(b.journal().events).toHaveLength(1);
    expect(b.journal().events[0]).toMatchObject({
      operation: 2,
      from: { sequence: 0 },
      to: { sequence: 1, tick: 0 },
    });
  });
  test('reversed energy and game changes remain visible despite identical endpoints', () => {
    const { s } = fixture(),
      b = s.branch({ horizonTicks: 0, captureJournal: true });
    b.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 3 }]);
    b.setGame({ ap: 1 });
    b.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: -3 }]);
    b.setGame({ ap: 2 });
    const endpoints = b.changes(),
      events = b.journal().events;
    expect(endpoints.accountingChanged).toBe(false);
    expect(endpoints.gameChanged).toBe(false);
    expect(endpoints.domains[0].channels.energy.count).toBe(0);
    expect(events.filter((e) => e.changes.accountingChanged)).toHaveLength(2);
    expect(events.filter((e) => e.changes.gameChanged)).toHaveLength(2);
    expect(events[0].action).toMatchObject({
      kind: 'energy',
      receipt: { suppliedQ: '3', removedQ: '0', externalQ: '3' },
    });
    expect(events[2].action).toMatchObject({
      kind: 'energy',
      receipt: { suppliedQ: '0', removedQ: '3', externalQ: '-3' },
    });
  });
  test('each local cut/restoration reports its full distant support reach', () => {
    const { s } = fixture({
      observe: (state) => {
        const result = emptySupport(state);
        result.capacities[63] = state.structure[21] & 255;
        return result;
      },
    });
    const b = s.branch({ horizonTicks: 0, captureJournal: true });
    b.edit([{ kind: 'integrity', x: 1, y: 1, z: 1, integrity: 30 }]);
    b.edit([{ kind: 'integrity', x: 1, y: 1, z: 1, integrity: 73 }]);
    for (const event of b.journal().events) {
      expect(event.changes.domains[0].channels.support.runs).toEqual([[63, 1]]);
      expect(event.changes.domains[0].channels.structure.runs).toEqual([[21, 1]]);
    }
    expect(b.changes().domains[0].channels.support.count).toBe(0);
  });
  test('translation receipts are portable, own their route, and survive caller mutation', () => {
    const { s } = fixture(),
      b = s.branch({ horizonTicks: 0, captureJournal: true });
    const receipt = b.translate({ cells: [[1, 1, 1]], path: [[1, 0, 0]] });
    receipt.sources[0] = 0;
    receipt.path[0] = [0, 0, 1];
    const journal = b.journal(),
      action = journal.events[0].action;
    expect(action).toMatchObject({
      kind: 'translate',
      receipt: { sources: [21], destinations: [22], path: [[1, 0, 0]], externalEnergyQ: '0' },
    });
    expect(JSON.parse(JSON.stringify(journal))).toEqual(journal);
    if (action.kind !== 'translate') throw Error('Wrong fixture action.');
    action.receipt.path[0] = [-1, 0, 0];
    expect(b.journal().events[0].action).toMatchObject({ receipt: { path: [[1, 0, 0]] } });
  });
  test('explicit cuts and released permanent anchors remain in the translation receipt', () => {
    const w = world();
    w.setCell(1, 1, 1, MAT.STONE);
    w.setCell(2, 1, 1, MAT.STONE);
    w.setAnchor(1, 1, 1, true);
    const { s } = fixture({ source: { ...initial(), terrain: w.snapshot() } }),
      b = s.branch({ horizonTicks: 0, captureJournal: true });
    b.translate({
      cells: [[1, 1, 1]],
      path: [[-1, 0, 0]],
      externalBonds: 'cut',
      anchors: 'release',
    });
    expect(b.journal().events[0].action).toMatchObject({
      kind: 'translate',
      receipt: { cutBonds: [[21, 22]], releasedAnchors: [21] },
    });
  });
  test('reservoir transfer reports both domains and exact accounted handoff', () => {
    const source = { ...initial(), reservoirs: [{ id: 'flask', terrain: world().snapshot() }] },
      { s } = fixture({ source });
    const b = s.branch({ horizonTicks: 0, captureJournal: true });
    const receipt = b.transfer({ from: null, to: 'flask', cells: [[1, 1, 1]], offset: [1, 0, 0] });
    receipt.sources[0] = 0;
    const event = b.journal().events[0];
    expect(event.changes.domains.map((d) => d.domain)).toEqual([null, 'flask']);
    expect(event.changes.domains.map((d) => d.channels.material.runs)).toEqual([
      [[21, 1]],
      [[22, 1]],
    ]);
    expect(event.changes.accountingChanged).toBe(false);
    expect(event.action).toMatchObject({
      kind: 'transfer',
      receipt: { sources: [21], destinations: [22], externalEnergyQ: '0' },
    });
  });
  test('tick events include all domains and the resulting game-policy change', async () => {
    const { s } = fixture({
      source: { ...initial(), reservoirs: [{ id: 'flask', terrain: world().snapshot() }] },
      policy: { reduceTick: ({ game }) => ({ ap: game.ap - 1 }) },
    });
    const b = s.branch({ horizonTicks: 2, captureJournal: true });
    await b.advance(2);
    const journal = b.journal();
    expect(journal.recordsObserved).toBe(2);
    expect(journal.domainTicksObserved).toBe(4);
    for (const event of journal.events) {
      expect(event.motion.map((f) => f.domain)).toEqual([null, 'flask']);
      expect(event.changes.gameChanged).toBe(true);
    }
    expect(b.inspect().game.ap).toBe(0);
  });
  test('temporary hold expiry and its distant support consequence belong to the expiring tick', async () => {
    const { s } = fixture({
      observe: (state) => {
        const result = emptySupport(state);
        result.reactions[63] = Number(Boolean(state.structure[21] & mechanics.ANCHOR_3D));
        return result;
      },
    });
    const b = s.branch({ horizonTicks: 1, captureJournal: true });
    b.hold({ id: 'lift', cells: [[1, 1, 1]], expiresAtTick: 1 });
    await b.advance(1);
    const event = b.journal().events[1];
    expect(event.action.kind).toBe('tick');
    expect(event.changes.domains[0].channels.constraints.runs).toEqual([[21, 1]]);
    expect(event.changes.domains[0].channels.support.runs).toEqual([[63, 1]]);
    expect(b.inspect().holds).toEqual([]);
  });
  test('net-zero two-tick motion retains each observed correspondence', async () => {
    const { s } = fixture({
      tick: (state) => {
        for (const key of ['packedCells', 'energyQ', 'structure'] as const)
          [state[key][21], state[key][22]] = [state[key][22], state[key][21]];
      },
      motion: (state) => ({
        ...trace(state),
        movedCells: 2,
        touchedCells: 2,
        moves: [
          [21, 22, 1],
          [22, 21, 1],
        ],
        touched: [[21, 2]],
      }),
    });
    const original = s.snapshot(),
      b = s.branch({ horizonTicks: 2, captureJournal: true });
    await b.advance(2);
    expect(b.inspect().terrain.packedCells).toEqual(original.terrain.packedCells);
    for (const event of b.journal().events) {
      expect(event.changes.domains[0].channels.material.count).toBe(2);
      expect(event.motion[0].trace.movedCells).toBe(2);
    }
  });
  test('sparse overflow preserves complete counts/bounds and is explicitly coarse', () => {
    const { s } = fixture(),
      b = s.branch({ horizonTicks: 0, captureJournal: true, journalMaxRuns: 0 });
    b.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 1 }]);
    const journal = b.journal(),
      energy = journal.events[0].changes.domains[0].channels.energy;
    expect(journal).toMatchObject({
      status: 'coarse',
      requiresFullRead: true,
      requiresReexecution: false,
    });
    expect(energy).toEqual({
      mode: 'bounds',
      count: 1,
      bounds: { min: [1, 1, 1], max: [2, 2, 2] },
      runs: [],
      requiresFullRead: true,
    });
  });
  test('incomplete motion clears the entire action history rather than retaining a misleading prefix', async () => {
    const { s } = fixture({
      motion: (state) => ({
        ...trace(state),
        status: 'overflow',
        requiresReexecution: true,
        touchedCells: 1,
      }),
    });
    const b = s.branch({ horizonTicks: 1, captureJournal: true });
    b.setGame({ ap: 1 });
    await b.advance(1);
    expect(s.commit(b).journal()).toMatchObject({
      status: 'overflow',
      requiresReexecution: true,
      recordsObserved: 2,
      domainTicksObserved: 1,
      entries: 0,
      events: [],
    });
  });
  test('committed journals survive later restore and own report, hold and motion detail', async () => {
    const { s } = fixture(),
      saved = s.snapshot(),
      b = s.branch({ horizonTicks: 1, captureJournal: true });
    b.hold({ id: 'lift', cells: [[1, 1, 1]], expiresAtTick: 2 });
    await b.advance(1);
    const committed = s.commit(b),
      expected = committed.journal(),
      returned = committed.journal();
    returned.events[0].changes.domains[0].channels.constraints.runs[0][0] = 0;
    if (returned.events[0].action.kind === 'hold') returned.events[0].action.hold.cells[0] = 0;
    returned.events[1].motion[0].trace.fromTick = 99;
    s.restore(saved);
    expect(committed.journal()).toEqual(expected);
    expect('journal' in saved).toBe(false);
    expect('captureJournal' in saved).toBe(false);
  });
  test('observer failure after an edit leaves live state unchanged and kills the candidate', () => {
    const { s } = fixture({
        observe: () => {
          throw Error('fixture observation failed');
        },
      }),
      saved = s.snapshot(),
      b = s.branch({ horizonTicks: 0, captureJournal: true });
    expect(() => b.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 1 }])).toThrow(/observation/);
    expect(s.snapshot()).toEqual(saved);
    expect(() => b.journal()).toThrow(/failed/);
    expect(() => s.commit(b)).toThrow(/failed/);
  });
  test('an observer cannot reenter mutation or publication', () => {
    let reenter = () => {};
    const { s } = fixture({
        observe: (value) => {
          reenter();
          return emptySupport(value);
        },
      }),
      saved = s.snapshot();
    const b = s.branch({ horizonTicks: 0, captureJournal: true });
    reenter = () => b.setGame({ ap: 0 });
    expect(() => b.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 1 }])).toThrow(/in progress/);
    expect(s.snapshot()).toEqual(saved);
  });
  test('failure on a later game tick exposes neither earlier staged ticks nor journal records', async () => {
    const { s, closed } = fixture({
      policy: {
        reduceTick: ({ game, tick }) => {
          if (tick === 2) throw Error('fixture game failure');
          return game;
        },
      },
    });
    const saved = s.snapshot(),
      b = s.branch({ horizonTicks: 2, captureJournal: true });
    await expect(b.advance(2)).rejects.toThrow(/game failure/);
    expect(s.snapshot()).toEqual(saved);
    expect(() => b.journal()).toThrow(/failed/);
    expect(closed).toEqual([null]);
  });
  test('cleanup failure discards a complete but unpublished journal', async () => {
    const { s, closed } = fixture({ closeFails: true }),
      saved = s.snapshot(),
      b = s.branch({ horizonTicks: 1, captureJournal: true });
    await expect(b.advance(1)).rejects.toThrow(/cleanup/);
    expect(s.snapshot()).toEqual(saved);
    expect(closed).toEqual([null]);
    expect(() => b.journal()).toThrow(/failed/);
  });
  test('cancellation while awaiting a domain trace exposes no partial event', async () => {
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>((r) => {
        entered = r;
      }),
      wait = new Promise<void>((r) => {
        release = r;
      });
    const { s, closed } = fixture({
        motion: async (state) => {
          entered();
          await wait;
          return trace(state);
        },
      }),
      saved = s.snapshot(),
      controller = new AbortController();
    const b = s.branch({ horizonTicks: 1, captureJournal: true }),
      running = b.advance(1, { signal: controller.signal });
    await ready;
    expect(() => b.journal()).toThrow(/in flight/);
    controller.abort();
    release();
    await expect(running).rejects.toThrow(/discarded/);
    expect(s.snapshot()).toEqual(saved);
    expect(closed).toEqual([null]);
  });
  test('bad final-domain motion cannot publish a primary-only action event', async () => {
    const { s, closed } = fixture({
      source: { ...initial(), reservoirs: [{ id: 'flask', terrain: world().snapshot() }] },
      motion: (state, domain) => ({ ...trace(state), fromTick: domain ? 99 : state.tick - 1 }),
    });
    const saved = s.snapshot(),
      b = s.branch({ horizonTicks: 1, captureJournal: true });
    await expect(b.advance(1)).rejects.toThrow(/identity/);
    expect(s.snapshot()).toEqual(saved);
    expect(closed).toEqual(['flask', null]);
    expect(() => b.journal()).toThrow(/failed/);
  });
  test('stale and discarded journals reject while saved copies retain their identities', () => {
    const { s } = fixture(),
      a = s.branch({ horizonTicks: 0, captureJournal: true }),
      b = s.branch({ horizonTicks: 0, captureJournal: true });
    const retained = a.journal();
    s.commit(b);
    expect(() => a.journal()).toThrow(/stale/);
    expect(retained.from.revision).toBe(0);
    const c = s.branch({ horizonTicks: 0, captureJournal: true });
    c.discard();
    expect(() => c.journal()).toThrow(/discarded/);
  });
  test('invalid capture options fail before driver creation or any live mutation', () => {
    const { s, requested } = fixture(),
      before = s.snapshot();
    for (const options of [
      { captureJournal: null },
      { captureJournal: 1 },
      { journalMaxRuns: 0 },
      { captureJournal: true, captureMotion: false },
      { captureJournal: true, journalMaxRuns: -1 },
      { captureJournal: true, journalMaxRuns: 4097 },
    ]) {
      expect(() => s.branch({ horizonTicks: 1, ...options } as never)).toThrow();
    }
    expect(requested).toEqual([]);
    expect(s.snapshot()).toEqual(before);
  });
});

function reportFixture(): GameplayChangeReport3D {
  const { s } = fixture(),
    b = s.branch({ horizonTicks: 0 });
  const report = b.changes();
  b.discard();
  return report;
}
describe('whole-journal bounds using trusted synthetic events', () => {
  test('exact shared detail capacity fits and the next entry clears retained events', () => {
    const data = createActionJournal3D(true, 0),
      report = reportFixture();
    data.entries = ACTION_JOURNAL_LIMITS_3D.entries - 1;
    const input = {
      operation: 1,
      fromTick: 0,
      toTick: 0,
      completedTicks: 0,
      domainCount: 1,
      motion: [],
      changes: () => report,
      action: {
        kind: 'hold',
        hold: { id: 'fixture', cells: [21], expiresAtTick: 1 },
      } as RawAction3D,
    };
    appendActionEvent3D(data, input);
    expect(data.status).toBe('complete');
    expect(data.entries).toBe(65536);
    appendActionEvent3D(data, { ...input, operation: 2 });
    expect(data).toMatchObject({ status: 'overflow', recordsObserved: 2, entries: 0, events: [] });
  });
  test('the 257th boundary is overflow even when every event has zero sparse detail', () => {
    const data = createActionJournal3D(true, 0),
      report = reportFixture(),
      seed = initial().terrain;
    for (let i = 0; i < 257; i++) {
      const state = { ...seed, tick: i + 1 },
        current = {
          ...report,
          domains: report.domains.map((d) => ({ ...d, fromTick: i, toTick: i + 1 })),
        };
      appendActionEvent3D(data, {
        operation: 1,
        fromTick: i,
        toTick: i + 1,
        completedTicks: i + 1,
        domainCount: 1,
        action: { kind: 'tick' },
        changes: () => current,
        motion: [{ domain: null, trace: trace(state) }],
      });
      if (i === 255) expect(data.status).toBe('complete');
    }
    expect(data).toMatchObject({
      status: 'overflow',
      recordsObserved: 257,
      domainTicksObserved: 257,
      events: [],
    });
  });
  test('domain/tick retention is shared across reservoir domains', () => {
    const data = createActionJournal3D(true, 0),
      report = reportFixture();
    data.domainTicksObserved = 255;
    const t = trace({ ...initial().terrain, tick: 1 }),
      changes = vi.fn(() => report);
    appendActionEvent3D(data, {
      operation: 1,
      fromTick: 0,
      toTick: 1,
      completedTicks: 1,
      domainCount: 2,
      action: { kind: 'tick' },
      changes,
      motion: [
        { domain: null, trace: t },
        { domain: 'flask', trace: t },
      ],
    });
    expect(data.status).toBe('overflow');
    expect(changes).not.toHaveBeenCalled();
  });
  test('known overflow keeps boundary counters without additional global observations', () => {
    const data = createActionJournal3D(true, 0);
    data.status = 'overflow';
    const changes = vi.fn(() => {
      throw Error('Unexpected observation');
    });
    appendActionEvent3D(data, {
      operation: 1,
      fromTick: 0,
      toTick: 0,
      completedTicks: 0,
      domainCount: 1,
      action: { kind: 'game', externalEnergyQ: '0' },
      motion: [],
      changes,
    });
    expect(data.recordsObserved).toBe(1);
    expect(data.events).toEqual([]);
    expect(changes).not.toHaveBeenCalled();
  });
  test('inconsistent event boundaries reject before calling the report producer', () => {
    const changes = vi.fn(() => reportFixture()),
      data = createActionJournal3D(true, 0);
    expect(() =>
      appendActionEvent3D(data, {
        operation: 1,
        fromTick: 1,
        toTick: 2,
        completedTicks: 1,
        domainCount: 1,
        action: { kind: 'tick' },
        changes,
        motion: [],
      }),
    ).toThrow(/boundary/);
    expect(changes).not.toHaveBeenCalled();
    expect(data.recordsObserved).toBe(0);
  });
});
