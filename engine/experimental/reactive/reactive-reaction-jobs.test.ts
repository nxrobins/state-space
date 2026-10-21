import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Bounded local reaction jobs; no real world steps, support or native execution. */
import { beforeAll, describe, expect, test } from 'vitest';

import {
  createReactiveMaterialRegistry3D,
  createReactiveMaterialBlock3D,
  editReactiveMaterialBlock3D,
  MAT,
  type ReactiveMaterialRegistry3D,
} from '../reactive-materials.js';
import {
  createReactiveReactionState3D as state,
  readReactiveReactionState3D as read,
  createReactiveReactionJob3D as job,
  advanceReactiveReactions3D as advance,
  REACTIVE_REACTION_PASSES_3D,
  type ReactiveReactionState3D,
} from './reactive-reactions.js';
holdPhysics('volumeStep', 'solveStructure3D', ...STRUCTURAL_CALLS);
let r: ReactiveMaterialRegistry3D;
beforeAll(async () => {
  r = await createReactiveMaterialRegistry3D();
});
const at = { x: 1, y: 1, z: 1 };
function seed(cycle = 0) {
  const b = createReactiveMaterialBlock3D(r, { width: 3, height: 3, depth: 3 });
  return state(
    r,
    editReactiveMaterialBlock3D(r, b, [
      { ...at, kind: 'place', material: MAT.WOOD, thermal: 230 },
      { ...at, x: 2, kind: 'place', material: MAT.WATER, thermal: 40 },
    ]).block,
    cycle,
  );
}
describe('complete local-cycle publication and continuation', () => {
  test('the eight-pass order is explicit and immutable', () => {
    expect(REACTIVE_REACTION_PASSES_3D).toEqual([
      'heat-x-even',
      'heat-x-odd',
      'heat-y-even',
      'heat-y-odd',
      'heat-z-even',
      'heat-z-odd',
      'phase',
      'combustion',
    ]);
    expect(Object.isFrozen(REACTIVE_REACTION_PASSES_3D)).toBe(true);
  });
  test('each advance completes one pass and no intermediate state is readable', () => {
    const s = seed(),
      original = structuredClone(s),
      j = job(r, s);
    expect(j.progress()).toEqual({ status: 'running', completedPasses: 0, totalPasses: 8 });
    for (let i = 1; i <= 8; i++) {
      expect(() => j.result()).toThrow(/complete/);
      expect(j.advance()).toEqual({
        status: i === 8 ? 'complete' : 'running',
        completedPasses: i,
        totalPasses: 8,
      });
      expect(s).toEqual(original);
    }
    expect(j.result()).toEqual(advance(r, original));
  });
  test('cancellation at every incomplete boundary discards the entire result', () => {
    for (let stop = 0; stop < 8; stop++) {
      const s = seed(),
        original = structuredClone(s),
        j = job(r, s);
      for (let i = 0; i < stop; i++) j.advance();
      expect(j.cancel()).toBe(true);
      expect(j.cancel()).toBe(false);
      expect(j.progress()).toEqual({ status: 'cancelled', completedPasses: stop, totalPasses: 8 });
      expect(() => j.result()).toThrow();
      expect(() => j.advance()).toThrow();
      expect(s).toEqual(original);
    }
  });
  test('a completed job cannot execute twice or be cancelled retroactively', () => {
    const j = job(r, seed());
    for (let i = 0; i < 8; i++) j.advance();
    const result = j.result();
    expect(() => j.advance()).toThrow();
    expect(j.cancel()).toBe(false);
    expect(j.result()).toEqual(result);
  });
  test('input mutation between passes cannot alter the owned candidate', () => {
    const s = seed(),
      original = structuredClone(s),
      j = job(r, s);
    j.advance();
    s.cycle = 90;
    s.block.packedCells.fill(0);
    s.block.energyQ.fill(0);
    s.block.structure.fill(0);
    for (let i = 1; i < 8; i++) j.advance();
    expect(j.result()).toEqual(advance(r, original));
  });
  test('published state reports and progress values cannot mutate subsequent reads', () => {
    const j = job(r, seed());
    const progress = j.progress();
    progress.completedPasses = 99;
    progress.status = 'cancelled';
    for (let i = 0; i < 8; i++) j.advance();
    const original = j.result(),
      leaked = j.result();
    leaked.state.block.packedCells.fill(0);
    leaked.state.block.energyQ.fill(0);
    leaked.report.changedCells.length = 0;
    leaked.report.energy.afterQ = '0';
    expect(j.result()).toEqual(original);
    expect(Object.isFrozen(j)).toBe(true);
  });
  test('state factories and readers detach all caller coordinates', () => {
    const initial = seed(),
      restored = read(r, initial);
    restored.block.energyQ.fill(0);
    expect(read(r, initial)).toEqual(initial);
    const b = initial.block,
      made = state(r, b, 3);
    b.structure.fill(0);
    b.energyQ.fill(0);
    expect(made.block.energyQ.some((q) => q > 0)).toBe(true);
  });
  test('repeat eight-cycle trajectories match every full state and report', () => {
    let a = seed(),
      b = seed();
    const original = structuredClone(a);
    for (let i = 0; i < 8; i++) {
      const x = advance(r, a),
        y = advance(r, b);
      expect(x).toEqual(y);
      expect(x.report.energy.afterQ).toBe(x.report.energy.beforeQ);
      a = x.state;
      b = y.state;
    }
    expect(a.cycle).toBe(8);
    expect(seed()).toEqual(original);
  });
  test('save and restart at every direction rotation equals uninterrupted execution', () => {
    let live = seed();
    for (let i = 0; i < 8; i++) {
      const restored = read(r, JSON.parse(JSON.stringify(live)));
      const next = advance(r, live);
      expect(advance(r, restored)).toEqual(next);
      live = next.state;
    }
  });
  test('restart at odd absolute cycles preserves selection and final state', () => {
    for (const start of [1, 3, 5, 7]) {
      const s = seed(start),
        uninterrupted = advance(r, advance(r, s).state),
        restored = read(r, JSON.parse(JSON.stringify(advance(r, s).state)));
      expect(advance(r, restored)).toEqual(uninterrupted);
      expect(uninterrupted.report.toCycle).toBe(start + 2);
    }
  });
  test('the largest exact cycle is serializable but cannot advance past the limit', () => {
    const s = seed(Number.MAX_SAFE_INTEGER - 1),
      out = advance(r, s);
    expect(out.state.cycle).toBe(Number.MAX_SAFE_INTEGER);
    expect(read(r, JSON.parse(JSON.stringify(out.state)))).toEqual(out.state);
    expect(() => job(r, out.state)).toThrow(/overflow/);
    expect(s.cycle).toBe(Number.MAX_SAFE_INTEGER - 1);
  });
  test('malformed wrapper identities and cycles fail without touching inputs', () => {
    const s = seed();
    for (const patch of [
      { schemaVersion: 2 },
      { rulesVersion: 'ca-3d-m5' },
      { cycle: -1 },
      { cycle: 0.1 },
      { cycle: NaN },
      { cycle: Number.MAX_SAFE_INTEGER + 1 },
      { extra: 1 },
    ]) {
      const bad = { ...s, ...patch },
        original = structuredClone(bad);
      expect(() => read(r, bad)).toThrow();
      expect(bad).toEqual(original);
    }
  });
  test('accessors prototypes and symbols are rejected before evaluating values', () => {
    const s = seed();
    let calls = 0;
    Object.defineProperty(s, 'cycle', {
      get() {
        calls++;
        return 0;
      },
      enumerable: true,
    });
    expect(() => read(r, s)).toThrow();
    expect(calls).toBe(0);
    expect(() => read(r, Object.create(seed()))).toThrow();
    expect(() => read(r, { ...seed(), [Symbol('x')]: 1 })).toThrow();
  });
  test('foreign catalog blocks and forged registries cannot authorize a job', async () => {
    const row = r.material(MAT.WOOD),
      other = await r.extend([
        { ...row, properties: { ...row.properties }, id: 200, name: 'resin' },
      ]);
    expect(() => job(other, seed())).toThrow();
    expect(() => job({ ...r }, seed())).toThrow(/validated/);
  });
  test('invalid packed or structural coordinates cannot enter staged execution', () => {
    for (const field of ['packedCells', 'energyQ', 'structure'] as const) {
      const s = seed();
      s.block[field][0] = 2 ** 32;
      const original = structuredClone(s);
      expect(() => job(r, s)).toThrow();
      expect(s).toEqual(original);
    }
  });
  test('odd line heat uses both parity passes with exact closed-boundary arithmetic', () => {
    for (const size of [
      { width: 3, height: 1, depth: 1 },
      { width: 1, height: 3, depth: 1 },
      { width: 1, height: 1, depth: 3 },
    ]) {
      const b = createReactiveMaterialBlock3D(r, size, MAT.STONE);
      const edited = editReactiveMaterialBlock3D(r, b, [
        { x: 0, y: 0, z: 0, kind: 'energy', energyQ: 25600 },
      ]).block;
      const out = advance(r, state(r, edited));
      expect(out.state.block.energyQ).toEqual([24400, 6249, 5191]);
      expect(out.report.changedCells).toEqual([0, 1, 2]);
      expect(out.report.energy.afterQ).toBe(out.report.energy.beforeQ);
    }
  });
  test('a small odd rectangular chamber conserves energy for eight local cycles', () => {
    const b = createReactiveMaterialBlock3D(r, { width: 5, height: 5, depth: 5 });
    let s = state(
      r,
      editReactiveMaterialBlock3D(r, b, [
        { ...at, kind: 'place', material: MAT.WOOD, thermal: 230 },
        { ...at, y: 2, kind: 'place', material: MAT.WATER, thermal: 120 },
        { ...at, x: 2, kind: 'place', material: MAT.ICE, thermal: 0 },
      ]).block,
    );
    const initialQ = s.block.energyQ.reduce((a, b) => a + BigInt(b), 0n);
    for (let i = 0; i < 8; i++) {
      const result = advance(r, s);
      expect(BigInt(result.report.energy.afterQ)).toBe(initialQ);
      s = read(r, result.state);
    }
  });
  test('inert air-only profiles require no fire smoke or phase destinations', async () => {
    const c = r.toCatalog();
    c.materialIds = [MAT.AIR];
    const minimal = await createReactiveMaterialRegistry3D(c);
    const s = state(
      minimal,
      createReactiveMaterialBlock3D(minimal, { width: 1, height: 1, depth: 1 }),
    );
    const out = advance(minimal, s);
    expect(out.state.block).toEqual(s.block);
    expect(out.report.changedCells).toEqual([]);
  });
  test('plain material blocks and M5-shaped saves do not masquerade as cycle states', () => {
    const s = seed();
    expect(() => read(r, s.block)).toThrow();
    expect(() => read(r, { ...s, tick: 0 })).toThrow();
    expect(() => job(r, null as unknown as ReactiveReactionState3D)).toThrow();
  });
});
