import { holdPhysics } from '../../test-support/hold-physics.js';
import { describe, expect, test, vi } from 'vitest';
import { MAT, buildColdTable, PHASE_SHIFT } from '../../generated/materials.js';
import { DEFAULT_REGISTRY } from '../../registry.js';
import { MAX_ENERGY_Q, thermalView } from '../../thermal.js';
import { ANCHOR_3D } from '../structural-mechanics.js';
import {
  CpuStructuralWorld3D,
  type StructuralSnapshot3D,
} from '../structural/structural-world-core.js';
import { createTacticalSession3D } from '../tactical-session.js';
import {
  createTacticalSessionCore3D,
  type TacticalSimulationFactory3D,
} from './tactical-session-core.js';
import type { TacticalSessionInitial3D, TacticalSessionPolicy3D } from './tactical-session-view.js';

holdPhysics('step');
type Game = { ap: number; turns: number };
function initial(tick = 0): TacticalSessionInitial3D<Game> {
  const world = new CpuStructuralWorld3D({ width: 4, height: 4, depth: 4, chunkSize: 4 });
  world.setCell(1, 1, 1, MAT.STONE, 160);
  world.setIntegrity(1, 1, 1, 73);
  world.setCell(2, 1, 1, MAT.STONE, 100);
  world.setIntegrity(2, 1, 1, 91);
  world.setAnchor(2, 1, 1, true);
  const terrain = world.snapshot();
  terrain.tick = tick;
  return {
    worldId: 'hold-world',
    gameRulesVersion: 'hold-game-1',
    terrain,
    game: { ap: 2, turns: 0 },
  };
}
function mock(
  source = initial(),
  policy: TacticalSessionPolicy3D<Game> = {},
  step?: (s: StructuralSnapshot3D) => void | Promise<void>,
  failLoad = false,
) {
  const inputs: StructuralSnapshot3D[] = [],
    closed = vi.fn(),
    loaded = vi.fn();
  const factory: TacticalSimulationFactory3D = (snapshot) => {
    let state = structuredClone(snapshot);
    return {
      load(s) {
        loaded();
        if (failLoad) throw Error('mock load failure');
        state = structuredClone(s);
      },
      async step() {
        inputs.push(structuredClone(state));
        if (step) await step(state);
        else state.tick++;
      },
      snapshot: () => structuredClone(state),
      close: () => {
        closed();
      },
    };
  };
  return {
    session: createTacticalSessionCore3D(source, factory, policy, async () => {}),
    inputs,
    loaded,
    closed,
  };
}
const slab = [
  [1, 1, 1],
  [2, 1, 1],
] as const;

describe('saved temporary holds: edit-only and mock boundary checks', () => {
  test('a hold preserves every terrain coordinate and is owned portable state', () => {
    const session = createTacticalSession3D(initial()),
      before = session.snapshot(),
      branch = session.branch({ horizonTicks: 0 });
    const cells: [number, number, number][] = [
      [2, 1, 1],
      [1, 1, 1],
    ];
    branch.hold({ id: 'slab', cells, expiresAtTick: 4 });
    cells[0][0] = 0;
    const inspected = branch.inspect();
    expect(inspected.terrain).toEqual(before.terrain);
    expect(inspected.holds).toEqual([{ id: 'slab', cells: [21, 22], expiresAtTick: 4 }]);
    inspected.holds[0].cells[0] = 0;
    branch.setGame({ ap: 1, turns: 0 });
    const result = session.commit(branch);
    expect(result.snapshot.holds[0].cells).toEqual([21, 22]);
    expect(result.receipt.externalEnergyQ).toBe('0');
    expect(result.snapshot.terrain).toEqual(before.terrain);
    expect(result.snapshot.schemaVersion).toBe(3);
    expect(result.snapshot.constraintRulesVersion).toBe('temporary-holds-1');
    result.snapshot.holds.length = 0;
    expect(session.snapshot().holds).toHaveLength(1);
    const restored = session.restore(JSON.parse(JSON.stringify(session.snapshot())));
    expect(restored.holds[0].cells).toEqual([21, 22]);
    expect(restored.revision).toBe(2);
  });

  test('release preserves permanent anchors, damage, bonds and energy', () => {
    const session = createTacticalSession3D(initial()),
      before = session.snapshot(),
      branch = session.branch({ horizonTicks: 0 });
    branch.hold({ id: 'slab', cells: slab, expiresAtTick: 2 });
    branch.releaseHold('slab');
    const result = session.commit(branch);
    expect(result.snapshot.holds).toEqual([]);
    expect(result.snapshot.terrain).toEqual(before.terrain);
  });

  test('invalid requests make only their candidate terminal', () => {
    const source = initial(),
      cases = [
        null,
        {},
        { id: '', cells: slab, expiresAtTick: 2 },
        { id: 'a', cells: [], expiresAtTick: 2 },
        { id: 'a', cells: new Array(1), expiresAtTick: 2 },
        { id: 'a', cells: new Array(65537), expiresAtTick: 2 },
        { id: 'a', cells: [[1, 1]], expiresAtTick: 2 },
        { id: 'a', cells: [[4, 1, 1]], expiresAtTick: 2 },
        { id: 'a', cells: [[1.5, 1, 1]], expiresAtTick: 2 },
        { id: 'a', cells: [[0, 0, 0]], expiresAtTick: 2 },
        { id: 'a', cells: [slab[0], slab[0]], expiresAtTick: 2 },
        { id: 'a', cells: slab, expiresAtTick: 0 },
        { id: 'a', cells: slab, expiresAtTick: 1025 },
        { id: 'a', cells: slab, expiresAtTick: NaN },
        { id: 'a', cells: slab, expiresAtTick: 2, extra: true },
      ];
    for (const request of cases) {
      const session = createTacticalSession3D(source),
        before = session.snapshot(),
        branch = session.branch({ horizonTicks: 0 });
      branch.setGame({ ap: 0, turns: 0 });
      expect(() => branch.hold(request as never)).toThrow();
      expect(branch.status).toBe('failed');
      expect(session.snapshot()).toEqual(before);
    }
  });

  test('duplicate IDs, overlapping holds and unknown release are rejected atomically', () => {
    for (const mode of ['id', 'cell', 'release']) {
      const session = createTacticalSession3D(initial()),
        before = session.snapshot(),
        branch = session.branch({ horizonTicks: 0 });
      branch.hold({ id: 'a', cells: [slab[0]], expiresAtTick: 2 });
      expect(() =>
        mode === 'release'
          ? branch.releaseHold('unknown')
          : branch.hold({
              id: mode === 'id' ? 'a' : 'b',
              cells: [slab[mode === 'id' ? 1 : 0]],
              expiresAtTick: 2,
            }),
      ).toThrow();
      expect(branch.status).toBe('failed');
      expect(session.snapshot()).toEqual(before);
    }
  });

  test('malformed hold saves and old envelopes cannot change committed state', () => {
    const session = createTacticalSession3D(initial()),
      before = session.snapshot(),
      valid = { id: 'slab', cells: [21], expiresAtTick: 2 };
    const broken = [
      { ...before, schemaVersion: 1 },
      { ...before, rulesVersion: 'tactical-session-1' },
      { ...before, constraintRulesVersion: 'unknown' },
      { ...before, holds: null },
      { ...before, holds: [valid, valid] },
      { ...before, holds: [{ ...valid, cells: [0] }] },
      { ...before, holds: [{ ...valid, expiresAtTick: 0 }] },
      { ...before, holds: [{ ...valid, cells: [21, 21] }] },
      { ...before, holds: [{ ...valid, extra: true }] },
      { ...before, holds: Array(65).fill(valid) },
    ];
    for (const save of broken) {
      expect(() => session.restore(save as never)).toThrow();
      expect(session.snapshot()).toEqual(before);
    }
    const getter = vi.fn(() => [valid]),
      save = Object.defineProperty({ ...before }, 'holds', { get: getter, enumerable: true });
    expect(() => session.restore(save)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  test('held sources require explicit release even when anchor release was requested', () => {
    const session = createTacticalSession3D(initial()),
      before = session.snapshot(),
      branch = session.branch({ horizonTicks: 0 });
    branch.hold({ id: 'slab', cells: slab, expiresAtTick: 2 });
    expect(() => branch.translate({ cells: slab, path: [[0, 0, 1]], anchors: 'release' })).toThrow(
      /Release held matter/,
    );
    expect(session.snapshot()).toEqual(before);
    const free = session.branch({ horizonTicks: 0 });
    free.hold({ id: 'slab', cells: slab, expiresAtTick: 2 });
    free.releaseHold('slab');
    free.translate({ cells: slab, path: [[0, 0, 1]], anchors: 'release' });
    expect(session.commit(free).snapshot.terrain.structure[37] & 255).toBe(73);
  });

  test('held broken matter blocks mobile displacement by an unheld source', () => {
    const session = createTacticalSession3D(initial()),
      before = session.snapshot(),
      branch = session.branch({ horizonTicks: 0 });
    branch.edit([
      { kind: 'integrity', x: 2, y: 1, z: 1, integrity: 0 },
      { kind: 'anchor', x: 2, y: 1, z: 1, anchored: false },
    ]);
    branch.hold({ id: 'broken', cells: [slab[1]], expiresAtTick: 2 });
    expect(() =>
      branch.translate({ cells: [slab[0]], path: [[1, 0, 0]], displacement: 'mobile' }),
    ).toThrow();
    expect(session.snapshot()).toEqual(before);
  });

  test('same-material replacement releases only replaced targets and removes empty holds', () => {
    const session = createTacticalSession3D(initial()),
      branch = session.branch({ horizonTicks: 0 });
    branch.hold({ id: 'slab', cells: slab, expiresAtTick: 2 });
    branch.edit([{ kind: 'material', x: 1, y: 1, z: 1, material: MAT.STONE, thermal: 160 }]);
    expect(branch.inspect().holds[0].cells).toEqual([22]);
    branch.edit([{ kind: 'material', x: 2, y: 1, z: 1, material: MAT.STONE }]);
    expect(session.commit(branch).snapshot.holds).toEqual([]);
  });

  test('energy, damage, cuts and explicit permanent anchors preserve hold ownership', () => {
    const session = createTacticalSession3D(initial()),
      branch = session.branch({ horizonTicks: 0 });
    branch.hold({ id: 'slab', cells: slab, expiresAtTick: 2 });
    branch.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 1 }]);
    branch.edit([
      { kind: 'integrity', x: 1, y: 1, z: 1, integrity: 20 },
      { kind: 'bond', x: 1, y: 1, z: 1, direction: 1, bonded: false },
      { kind: 'anchor', x: 1, y: 1, z: 1, anchored: true },
    ]);
    expect(branch.inspect().holds[0].cells).toEqual([21, 22]);
    branch.releaseHold('slab');
    expect(session.commit(branch).snapshot.terrain.structure[21]).toBe(20 | ANCHOR_3D);
  });

  test('absolute expiry overlays exactly the intended mock transitions, including odd ticks', async () => {
    const observed: { tick: number; holds: number; anchor: number }[] = [];
    const { session, inputs, loaded } = mock(initial(7), {
      reduceTick: ({ game, terrain, tick, holds }) => {
        observed.push({ tick, holds: holds.length, anchor: terrain.structure[21] & ANCHOR_3D });
        return { ...game, turns: game.turns + 1 };
      },
    });
    const before = session.snapshot(),
      branch = session.branch({ horizonTicks: 3 });
    branch.hold({ id: 'slab', cells: slab, expiresAtTick: 9 });
    await branch.advance(3);
    expect(
      inputs.map((s) => [
        s.tick,
        Boolean(s.structure[21] & ANCHOR_3D),
        Boolean(s.structure[22] & ANCHOR_3D),
      ]),
    ).toEqual([
      [7, true, true],
      [8, true, true],
      [9, false, true],
    ]);
    expect(observed).toEqual([
      { tick: 8, holds: 1, anchor: 0 },
      { tick: 9, holds: 0, anchor: 0 },
      { tick: 10, holds: 0, anchor: 0 },
    ]);
    expect(loaded).toHaveBeenCalledTimes(2);
    const result = session.commit(branch);
    expect(result.snapshot.holds).toEqual([]);
    expect(result.snapshot.terrain.structure).toEqual(before.terrain.structure);
    expect(result.snapshot.accounting).toEqual(before.accounting);
  });

  test('staggered expirations do not drop another hold or leave an expired pin', async () => {
    const { session, inputs } = mock(initial(7)),
      branch = session.branch({ horizonTicks: 3 });
    branch.edit([{ kind: 'anchor', x: 2, y: 1, z: 1, anchored: false }]);
    branch.hold({ id: 'first', cells: [slab[0]], expiresAtTick: 8 });
    branch.hold({ id: 'second', cells: [slab[1]], expiresAtTick: 10 });
    await branch.advance(3);
    expect(
      inputs.map((s) => [
        Boolean(s.structure[21] & ANCHOR_3D),
        Boolean(s.structure[22] & ANCHOR_3D),
      ]),
    ).toEqual([
      [true, true],
      [false, true],
      [false, true],
    ]);
    expect(session.commit(branch).snapshot.holds).toEqual([]);
  });

  test('a mocked phase transition releases its target without rebinding or altering energy', async () => {
    const source = initial();
    source.terrain.structure[21] = 73;
    source.terrain.structure[22] = 91 | ANCHOR_3D;
    const cold = buildColdTable();
    const { session, inputs } = mock(source, {}, (s) => {
      if (s.tick === 0) {
        s.packedCells[21] = thermalView(
          MAT.LAVA | (DEFAULT_REGISTRY.material(MAT.LAVA).properties.default_phase << PHASE_SHIFT),
          s.energyQ[21],
          cold,
        );
        s.structure[21] = 0;
      }
      s.tick++;
    });
    const before = session.snapshot(),
      branch = session.branch({ horizonTicks: 2 });
    branch.hold({ id: 'slab', cells: slab, expiresAtTick: 3 });
    await branch.advance(2);
    expect(inputs[1].structure[21]).toBe(0);
    const result = session.commit(branch);
    expect(result.snapshot.holds[0].cells).toEqual([22]);
    expect(result.snapshot.accounting).toEqual(before.accounting);
  });

  test('mock continuation agrees across save/restore and split advancement at expiry', async () => {
    const a = mock(initial(7)),
      b = mock(initial(7));
    for (const { session } of [a, b]) {
      const h = session.branch({ horizonTicks: 0 });
      h.hold({ id: 'slab', cells: slab, expiresAtTick: 9 });
      session.commit(h);
    }
    const uninterrupted = a.session.branch({ horizonTicks: 3 });
    await uninterrupted.advance(3);
    const expected = a.session.commit(uninterrupted).snapshot;
    const first = b.session.branch({ horizonTicks: 1 });
    await first.advance(1);
    const saved = b.session.commit(first).snapshot;
    b.session.restore(JSON.parse(JSON.stringify(saved)));
    const second = b.session.branch({ horizonTicks: 2 });
    await second.advance(1);
    await second.advance(1);
    const actual = b.session.commit(second).snapshot;
    expect({ ...actual, revision: expected.revision }).toEqual(expected);
    expect(b.inputs).toEqual(a.inputs);
  });

  test('driver reload failure discards all private changes and cleans up', async () => {
    const { session, closed, inputs } = mock(initial(), {}, undefined, true),
      before = session.snapshot(),
      branch = session.branch({ horizonTicks: 2 });
    branch.hold({ id: 'slab', cells: slab, expiresAtTick: 1 });
    branch.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 1 }]);
    branch.setGame({ ap: 0, turns: 0 });
    await expect(branch.advance(2)).rejects.toThrow(/load failure/);
    expect(inputs).toHaveLength(1);
    expect(closed).toHaveBeenCalledOnce();
    expect(session.snapshot()).toEqual(before);
    expect(branch.status).toBe('failed');
  });

  test('discard during a held mock tick retains the live hold lifetime and ledger', async () => {
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>((r) => {
        entered = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    const { session, closed } = mock(initial(), {}, async (s) => {
      entered();
      await gate;
      s.tick++;
    });
    const held = session.branch({ horizonTicks: 0 });
    held.hold({ id: 'slab', cells: slab, expiresAtTick: 2 });
    session.commit(held);
    const before = session.snapshot(),
      branch = session.branch({ horizonTicks: 2 }),
      pending = branch.advance(2);
    await waiting;
    branch.discard();
    release();
    await expect(pending).rejects.toThrow(/discarded/);
    expect(closed).toHaveBeenCalledOnce();
    expect(session.snapshot()).toEqual(before);
  });
});

describe('accounted thermal deltas: zero physical ticks', () => {
  test('opposing heat costs remain visible with zero net energy and unchanged material history', () => {
    const session = createTacticalSession3D(initial()),
      before = session.snapshot(),
      branch = session.branch({ horizonTicks: 0 });
    const receipt = branch.addEnergy([
      { x: 2, y: 1, z: 1, deltaQ: -7 },
      { x: 1, y: 1, z: 1, deltaQ: 7 },
    ]);
    expect(receipt).toMatchObject({ suppliedQ: '7', removedQ: '7', externalQ: '0', tick: 0 });
    expect(receipt.changes.map((c) => c.index)).toEqual([21, 22]);
    receipt.changes[0].afterQ = 0;
    const result = session.commit(branch);
    expect(result.snapshot.terrain.energyQ[21]).toBe(before.terrain.energyQ[21] + 7);
    expect(result.snapshot.terrain.energyQ[22]).toBe(before.terrain.energyQ[22] - 7);
    expect(result.snapshot.terrain.structure).toEqual(before.terrain.structure);
    expect(result.snapshot.terrain.packedCells.map((v) => v & 0xffff00ff)).toEqual(
      before.terrain.packedCells.map((v) => v & 0xffff00ff),
    );
    expect(result.snapshot.accounting).toEqual(before.accounting);
  });

  test('positive and negative deltas retain an exact ledger across commit and restore', () => {
    const session = createTacticalSession3D(initial()),
      before = session.snapshot(),
      branch = session.branch({ horizonTicks: 0 });
    branch.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 1 }]);
    branch.addEnergy([{ x: 2, y: 1, z: 1, deltaQ: -3 }]);
    const result = session.commit(branch);
    expect(result.receipt.externalEnergyQ).toBe('-2');
    expect(BigInt(result.snapshot.accounting.externalQ)).toBe(
      BigInt(before.accounting.externalQ) - 2n,
    );
    expect(session.restore(JSON.parse(JSON.stringify(result.snapshot))).accounting).toEqual(
      result.snapshot.accounting,
    );
  });

  test('energy limits reject the whole candidate without clamping or partial costs', () => {
    for (const deltaQ of [
      MAX_ENERGY_Q,
      -MAX_ENERGY_Q,
      0.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER,
    ]) {
      const session = createTacticalSession3D(initial()),
        before = session.snapshot(),
        branch = session.branch({ horizonTicks: 0 });
      branch.setGame({ ap: 0, turns: 0 });
      expect(() =>
        branch.addEnergy([
          { x: 1, y: 1, z: 1, deltaQ: 1 },
          { x: 2, y: 1, z: 1, deltaQ },
        ]),
      ).toThrow();
      expect(session.snapshot()).toEqual(before);
      expect(branch.status).toBe('failed');
    }
  });

  test('duplicate targets, holes, malformed records and accessors are rejected', () => {
    const d = { x: 1, y: 1, z: 1, deltaQ: 1 },
      getter = vi.fn(() => 1);
    const accessor = Object.defineProperty({ ...d }, 'deltaQ', { get: getter, enumerable: true });
    for (const deltas of [
      null,
      new Array(1),
      new Array(65537),
      [null],
      [d, d],
      [{ ...d, x: 4 }],
      [{ ...d, extra: 1 }],
      [accessor],
    ]) {
      const session = createTacticalSession3D(initial()),
        before = session.snapshot(),
        branch = session.branch({ horizonTicks: 0 });
      expect(() => branch.addEnergy(deltas as never)).toThrow();
      expect(session.snapshot()).toEqual(before);
    }
    expect(getter).not.toHaveBeenCalled();
  });

  test('empty and zero deltas are explicit no-ops without changing history', () => {
    const session = createTacticalSession3D(initial()),
      before = session.snapshot(),
      branch = session.branch({ horizonTicks: 0 });
    expect(branch.addEnergy([])).toMatchObject({
      externalQ: '0',
      suppliedQ: '0',
      removedQ: '0',
      changes: [],
    });
    branch.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 0 }]);
    expect(session.commit(branch).snapshot.terrain).toEqual(before.terrain);
  });

  test('game policy rejects a combined hold and thermal transaction atomically', () => {
    const session = createTacticalSession3D(initial(), {
        validateGame: ({ game }) => game.ap >= 0,
      }),
      before = session.snapshot();
    const branch = session.branch({ horizonTicks: 0 });
    branch.hold({ id: 'slab', cells: slab, expiresAtTick: 2 });
    branch.addEnergy([{ x: 1, y: 1, z: 1, deltaQ: 1 }]);
    branch.setGame({ ap: -1, turns: 0 });
    expect(() => session.commit(branch)).toThrow(/policy/);
    expect(session.snapshot()).toEqual(before);
  });
});
