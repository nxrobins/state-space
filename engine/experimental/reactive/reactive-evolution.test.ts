import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Tiny composed CPU trajectories. No existing world stepping or global graph work. */
import { beforeAll, describe, expect, test } from 'vitest';

import {
  createReactiveMaterialRegistry3D,
  defaultReactiveMaterialCatalog3D,
  createReactiveMaterialBlock3D as block,
  editReactiveMaterialBlock3D as edit,
  createReactiveReactionState3D,
  advanceReactiveReactions3D,
  MAT,
  type ReactiveMaterialRegistry3D,
  type ReactiveMaterialEdit3D,
  type ReactiveMaterialBlock3D,
} from '../reactive-materials.js';
import { runReactiveMovementPass3D } from './reactive-movement.js';
import {
  createReactiveEvolutionState3D as state,
  readReactiveEvolutionState3D as read,
  createReactiveEvolutionJob3D as job,
  advanceReactiveEvolution3D as advance,
  startReactiveEvolutionJob3D as start,
  type ReactiveEvolutionState3D,
} from './reactive-evolution.js';
holdPhysics('volumeStep', 'solveStructure3D', ...STRUCTURAL_CALLS);
let r: ReactiveMaterialRegistry3D, conductive: ReactiveMaterialRegistry3D;
beforeAll(async () => {
  const c = defaultReactiveMaterialCatalog3D();
  for (const m of c.propertiesCatalog.materials) m.properties.conductivity = 0;
  r = await createReactiveMaterialRegistry3D(c);
  conductive = await createReactiveMaterialRegistry3D();
});
const at = { x: 0, y: 0, z: 0 };
function fixture(
  edits: ReactiveMaterialEdit3D[] = [],
  size = { width: 3, height: 3, depth: 3 },
  tick = 0,
  registry = r,
) {
  return state(registry, edit(registry, block(registry, size), edits).block, tick);
}
function seed(tick = 0) {
  return fixture(
    [
      { ...at, x: 1, kind: 'place', material: MAT.SAND, thermal: 70 },
      { ...at, y: 1, z: 1, kind: 'place', material: MAT.WATER, thermal: 20 },
      { ...at, x: 2, y: 2, z: 2, kind: 'place', material: MAT.SMOKE, thermal: 100 },
    ],
    undefined,
    tick,
  );
}
function burning() {
  return fixture([{ ...at, y: 2, kind: 'place', material: MAT.WOOD, thermal: 181 }], {
    width: 1,
    height: 3,
    depth: 1,
  });
}

describe('complete conservative reactive evolution', () => {
  test('a burned fuel cell produces fire then transports its heat upward as smoke', () => {
    const s = burning(),
      first = advance(r, s),
      second = advance(r, first.state);
    expect(first.state.block.packedCells.map((v) => v & 255)).toEqual([MAT.AIR, MAT.FIRE, MAT.ASH]);
    expect(second.state.block.packedCells.map((v) => v & 255)).toEqual([
      MAT.SMOKE,
      MAT.AIR,
      MAT.ASH,
    ]);
    expect(second.state.block.energyQ[0]).toBe(first.state.block.energyQ[1]);
    expect(second.report.movement.moves).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 0 },
    ]);
    expect(second.report.reactions.extinguishedCells).toEqual([0]);
    expect(second.report.reactions.energy.afterQ).toBe(first.report.reactions.energy.beforeQ);
    expect(s.block.packedCells[2] & 255).toBe(MAT.WOOD);
  });
  test('water moves before freezing and the fresh ice acquires no implicit bonds', () => {
    const s = fixture(
      [
        { ...at, kind: 'place', material: MAT.WATER },
        { ...at, kind: 'energy', energyQ: 0 },
      ],
      { width: 2, height: 1, depth: 1 },
    );
    const out = advance(r, s);
    expect(out.state.block.packedCells.map((v) => v & 255)).toEqual([MAT.AIR, MAT.ICE]);
    expect(out.state.block.structure).toEqual([0, 255]);
    expect(out.report.reactions.phaseChangedCells).toEqual([1]);
    expect(out.report.movement.moves).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 0 },
    ]);
  });
  test('executed provenance retains an original cell that returns to its start', () => {
    const s = fixture(
      [
        { ...at, kind: 'place', material: MAT.WATER, thermal: 20 },
        { ...at, x: 1, y: 1, kind: 'place', material: MAT.SMOKE, thermal: 100 },
      ],
      { width: 2, height: 2, depth: 1 },
    );
    const out = advance(r, s);
    expect(out.report.movement).toEqual({
      rulesVersion: 'reactive-movement-1',
      swapCount: 4,
      moves: [
        { from: 0, to: 3 },
        { from: 1, to: 0 },
        { from: 3, to: 1 },
      ],
      touchedOrigins: [0, 1, 2, 3],
    });
    expect(out.report.touchedCells).toEqual([0, 1, 2, 3]);
    expect(out.report.changedCells).toEqual([0, 1, 3]);
    expect(out.state.block.packedCells[2]).toBe(s.block.packedCells[2]);
    expect(out.state.block.energyQ[2]).toBe(s.block.energyQ[2]);
  });
  test('each of twenty-eight advances performs one stage and publishes no prefix', () => {
    const s = seed(),
      original = structuredClone(s),
      j = job(r, s);
    for (let i = 0; i < 28; i++) {
      expect(j.progress()).toEqual({ status: 'running', completedPasses: i, totalPasses: 28 });
      expect(() => j.result()).toThrow();
      expect(j.advance().completedPasses).toBe(i + 1);
      expect(s).toEqual(original);
    }
    expect(j.progress().status).toBe('complete');
    expect(j.result()).toEqual(advance(r, original));
  });
  test('cancellation at every incomplete boundary preserves committed coordinates', () => {
    const s = seed(),
      original = structuredClone(s);
    for (let stop = 0; stop < 28; stop++) {
      const j = job(r, s);
      for (let i = 0; i < stop; i++) j.advance();
      expect(j.cancel()).toBe(true);
      expect(j.cancel()).toBe(false);
      expect(() => j.result()).toThrow();
      expect(() => j.advance()).toThrow();
      expect(j.progress()).toEqual({ status: 'cancelled', completedPasses: stop, totalPasses: 28 });
      expect(s).toEqual(original);
    }
  });
  test('terminal jobs cannot advance or revoke an already committed result', () => {
    const j = job(r, seed());
    for (let i = 0; i < 28; i++) j.advance();
    const out = j.result();
    expect(() => j.advance()).toThrow();
    expect(j.cancel()).toBe(false);
    expect(j.result()).toEqual(out);
  });
  test('source mutations after construction cannot change later stages', () => {
    const s = seed(),
      original = structuredClone(s),
      j = job(r, s);
    for (let i = 0; i < 20; i++) j.advance();
    s.tick = 77;
    s.block.packedCells.fill(0);
    s.block.energyQ.fill(0);
    s.block.structure.fill(0);
    for (let i = 20; i < 28; i++) j.advance();
    expect(j.result()).toEqual(advance(r, original));
  });
  test('an owned job never writes its input while later passes reuse one working copy', () => {
    let s = seed(),
      moving = 0;
    for (let t = 0; t < 6; t++) {
      const original = structuredClone(s),
        blocks: ReactiveMaterialBlock3D[] = [],
        stage = start(r, s, {
          swap() {},
          pass(_index, b) {
            expect(s).toEqual(original);
            blocks.push(b);
          },
        });
      for (let i = 0; i < 28; i++) stage.job.advance();
      expect(s).toEqual(original);
      const out = stage.output();
      expect(out).toEqual(advance(r, original));
      const copies = new Set(
        blocks
          .slice(0, 20)
          .map((b) => b.packedCells)
          .filter((cells) => cells !== s.block.packedCells),
      );
      expect(copies.size).toBeLessThanOrEqual(1);
      moving += copies.size;
      s = out.state;
    }
    expect(moving).toBeGreaterThan(0);
  });
  test('result state, movement, reaction reports and progress values are isolated', () => {
    const j = job(r, seed());
    const p = j.progress();
    p.status = 'cancelled';
    p.completedPasses = 28;
    for (let i = 0; i < 28; i++) j.advance();
    const expected = j.result(),
      out = j.result();
    out.state.block.energyQ.fill(0);
    out.report.movement.moves.length = 0;
    out.report.movement.touchedOrigins.length = 0;
    out.report.reactions.changedCells.length = 0;
    out.report.reactions.energy.afterQ = '0';
    expect(j.result()).toEqual(expected);
    expect(Object.isFrozen(j)).toBe(true);
  });
  test('composed stages equal public movement passes followed by the unchanged reaction API', () => {
    const s = seed(3);
    let b = s.block;
    for (let p = 0; p < 20; p++) b = runReactiveMovementPass3D(r, b, s.tick, p).block;
    const reaction = advanceReactiveReactions3D(r, createReactiveReactionState3D(r, b, s.tick)),
      out = advance(r, s);
    expect(out.state.block).toEqual(reaction.state.block);
    expect(out.report.reactions).toEqual(reaction.report);
    expect(out.state.tick).toBe(4);
  });
  test('eight-tick trajectories reproduce complete state and provenance exactly', () => {
    let a = seed(),
      b = seed();
    const initial = a.block.energyQ.reduce((sum, q) => sum + BigInt(q), 0n).toString();
    for (let i = 0; i < 8; i++) {
      const x = advance(r, a),
        y = advance(r, b);
      expect(x).toEqual(y);
      expect(x.report.reactions.energy.afterQ).toBe(initial);
      a = x.state;
      b = y.state;
    }
    expect(a.tick).toBe(8);
  });
  test('JSON restart before each direction and axis rotation retains exact continuation', () => {
    let s = seed();
    for (let i = 0; i < 8; i++) {
      const expected = advance(r, s);
      expect(advance(r, read(r, JSON.parse(JSON.stringify(s))))).toEqual(expected);
      s = expected.state;
    }
  });
  test('odd-tick burning and smoke restart equals uninterrupted execution', () => {
    for (const tick of [1, 3, 5, 7]) {
      const s = { ...burning(), tick },
        first = advance(r, s),
        next = advance(r, first.state);
      expect(advance(r, read(r, JSON.parse(JSON.stringify(first.state))))).toEqual(next);
      expect(next.state.tick).toBe(tick + 2);
    }
  });
  test('odd rectangular five-cubed fixtures conserve energy through eight moving reactive ticks', () => {
    let s = fixture(
      [
        { ...at, x: 1, y: 1, z: 1, kind: 'place', material: MAT.WOOD, thermal: 230 },
        { ...at, x: 1, y: 2, z: 1, kind: 'place', material: MAT.WATER, thermal: 120 },
        { ...at, x: 2, kind: 'place', material: MAT.SAND, thermal: 80 },
        { ...at, x: 4, y: 4, z: 4, kind: 'place', material: MAT.ICE, thermal: 0 },
      ],
      { width: 5, height: 5, depth: 5 },
      0,
      conductive,
    );
    const beforeQ = s.block.energyQ.reduce((sum, q) => sum + BigInt(q), 0n).toString();
    for (let i = 0; i < 8; i++) {
      const out = advance(conductive, s);
      expect(out.report.reactions.energy.afterQ).toBe(beforeQ);
      expect(out.report.reactions.energy.driftQ).toBe('0');
      s = read(conductive, out.state);
    }
  });
  test('custom fuel combustion and smoke movement compose under one catalog identity', async () => {
    const source = r.material(MAT.WOOD),
      custom = await r.extend([
        { ...source, id: 200, name: 'resin', properties: { ...source.properties } },
      ]);
    let s = fixture(
      [{ ...at, y: 2, kind: 'place', material: 200, thermal: 181 }],
      { width: 1, height: 3, depth: 1 },
      0,
      custom,
    );
    const first = advance(custom, s);
    s = first.state;
    const second = advance(custom, s);
    expect(second.state.block.packedCells[0] & 255).toBe(MAT.SMOKE);
    expect(second.report.materialCatalogHash).toBe(custom.hash);
    expect(second.report.reactions.energy.afterQ).toBe(first.report.reactions.energy.beforeQ);
  });
  test('an untouched bonded damaged region preserves integrity anchors and connections', () => {
    const s = fixture(
      [
        { ...at, kind: 'place', material: MAT.WOOD, thermal: 20 },
        { ...at, x: 1, kind: 'place', material: MAT.WOOD, thermal: 20 },
        { ...at, kind: 'integrity', integrity: 73 },
        { ...at, kind: 'anchor', anchored: true },
        { ...at, kind: 'bond', direction: 1, bonded: true },
      ],
      { width: 2, height: 2, depth: 1 },
    );
    expect(advance(r, s).state.block).toEqual(s.block);
  });
  test('singleton state advances its clock without inventing motion or drift', () => {
    const s = fixture([], { width: 1, height: 1, depth: 1 }),
      out = advance(r, s);
    expect(out.state.block).toEqual(s.block);
    expect(out.state.tick).toBe(1);
    expect(out.report.movement).toEqual({
      rulesVersion: 'reactive-movement-1',
      swapCount: 0,
      moves: [],
      touchedOrigins: [],
    });
    expect(out.report.changedCells).toEqual([]);
    expect(out.report.touchedCells).toEqual([]);
  });
  test('movement maps are bijections and canonical even for displaced gas', () => {
    const s = seed(),
      out = advance(r, s),
      destinations = s.block.packedCells.map((_, i) => i);
    for (const m of out.report.movement.moves) destinations[m.from] = m.to;
    expect(new Set(destinations).size).toBe(destinations.length);
    expect(out.report.movement.moves.map((m) => m.from)).toEqual(
      [...out.report.movement.moves.map((m) => m.from)].sort((a, b) => a - b),
    );
    for (const m of out.report.movement.moves)
      expect(out.report.movement.touchedOrigins).toContain(m.from);
  });
  test('state readers own inputs and never silently import reaction-only saves', () => {
    const s = seed(),
      out = read(r, s);
    out.block.energyQ.fill(0);
    expect(read(r, s)).toEqual(s);
    expect(() => read(r, createReactiveReactionState3D(r, s.block))).toThrow();
    expect(() => read(r, s.block)).toThrow();
  });
  test('maximum exact tick can be saved but cannot overflow during advancement', () => {
    const s = { ...seed(), tick: Number.MAX_SAFE_INTEGER - 1 },
      out = advance(r, s);
    expect(out.state.tick).toBe(Number.MAX_SAFE_INTEGER);
    expect(read(r, JSON.parse(JSON.stringify(out.state)))).toEqual(out.state);
    expect(() => job(r, out.state)).toThrow(/overflow/);
  });
  test('malformed wrappers and coordinates reject before creating a candidate', () => {
    const s = seed();
    for (const patch of [
      { schemaVersion: 2 },
      { rulesVersion: 'ca-3d-m5' },
      { tick: -1 },
      { tick: NaN },
      { tick: 0.5 },
      { extra: 1 },
      { block: { ...s.block, materialCatalogHash: 'foreign' } },
    ]) {
      const bad = { ...s, ...patch },
        before = structuredClone(bad);
      expect(() => read(r, bad)).toThrow();
      expect(bad).toEqual(before);
    }
    expect(() => job(r, null as unknown as ReactiveEvolutionState3D)).toThrow();
    expect(() => job({ ...r }, s)).toThrow();
  });
  test('getters symbols and inherited fields cannot enter the evolution state', () => {
    const s = seed();
    let calls = 0;
    Object.defineProperty(s, 'tick', {
      get() {
        calls++;
        return 0;
      },
      enumerable: true,
    });
    expect(() => read(r, s)).toThrow();
    expect(calls).toBe(0);
    expect(() => read(r, Object.create(seed()))).toThrow();
    expect(() => read(r, { ...seed(), [Symbol('x')]: 0 })).toThrow();
  });
});
