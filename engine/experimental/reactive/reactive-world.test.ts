import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Integrated tiny reactive worlds; old M5 runtime is explicitly trapped. */
import { beforeAll, describe, expect, test, vi } from 'vitest';

import {
  createReactiveMaterialRegistry3D,
  defaultReactiveMaterialCatalog3D,
  createReactiveMaterialBlock3D as block,
  editReactiveMaterialBlock3D as edit,
  createReactiveEvolutionState3D,
  advanceReactiveEvolution3D,
  createReactiveStructureJob3D,
  createReactiveWorld3D as world,
  createReactiveWorldSnapshot3D as state,
  readReactiveWorldSnapshot3D as read,
  createReactiveWorldTickJob3D as job,
  REACTIVE_WORLD_COMPONENTS_3D,
  MAT,
  BONDS_3D,
  type ReactiveMaterialRegistry3D,
  type ReactiveMaterialEdit3D,
  type ReactiveWorldSnapshot3D,
  type ReactiveWorldTickJob3D,
  type ReactiveWorld3D,
} from '../reactive-materials.js';
holdPhysics('volumeStep', 'solveStructure3D', ...STRUCTURAL_CALLS);
let r: ReactiveMaterialRegistry3D;
beforeAll(async () => {
  const catalog = defaultReactiveMaterialCatalog3D();
  for (const m of catalog.propertiesCatalog.materials) m.properties.conductivity = 0;
  r = await createReactiveMaterialRegistry3D(catalog);
});
const at = { x: 0, y: 0, z: 0 };
const place = (
  x: number,
  y = 0,
  z = 0,
  material: number = MAT.STONE,
  thermal = 20,
): ReactiveMaterialEdit3D => ({ kind: 'place', x, y, z, material, thermal });
function fixture(
  edits: ReactiveMaterialEdit3D[] = [],
  dimensions = { width: 2, height: 2, depth: 1 },
  tick = 0,
) {
  expect(dimensions.width * dimensions.height * dimensions.depth).toBeLessThanOrEqual(125);
  return state(r, edit(r, block(r, dimensions), edits).block, tick);
}
function finish(j: ReactiveWorldTickJob3D, budget = 64) {
  let calls = 0;
  while (j.progress().status === 'running') {
    if (++calls > 20 * 125 + 64) throw Error('Tiny fixture exceeded its work bound.');
    j.advance(budget);
  }
  return j.result();
}
function advance(s: ReactiveWorldSnapshot3D, budget = 64) {
  return finish(job(r, s), budget);
}
function commit(w: ReactiveWorld3D, budget = 64) {
  const j = w.prepareTick();
  finish(j, budget);
  return w.commitTick(j);
}
function bridge(material: number = MAT.WOOD, thermal = 181, tick = 0) {
  return fixture(
    [
      ...Array.from({ length: 5 }, (_, x) => place(x)),
      ...Array.from({ length: 4 }, (_, x) => ({
        ...at,
        x,
        kind: 'bond' as const,
        direction: 1,
        bonded: true,
      })),
      place(0, 1, 0, material, thermal),
      { ...at, y: 1, kind: 'anchor', anchored: true },
    ],
    { width: 5, height: 3, depth: 1 },
    tick,
  );
}
describe('complete reactive world tick', () => {
  test('freezes component identities and preserves the standalone evolution contract', () => {
    expect(Object.isFrozen(REACTIVE_WORLD_COMPONENTS_3D)).toBe(true);
    expect(REACTIVE_WORLD_COMPONENTS_3D).toEqual({
      evolution: 'reactive-evolution-1',
      structure: 'reactive-structure-1',
    });
    const s = fixture([place(0)]),
      evolution = advanceReactiveEvolution3D(r, createReactiveEvolutionState3D(r, s.block));
    expect(evolution.state.block).toEqual(s.block);
    expect(advance(s).state.block.packedCells[2] & 255).toBe(MAT.STONE);
  });
  test('a complete tick equals the frozen evolution-then-structure composition', () => {
    const s = bridge(MAT.WOOD, 181, 3),
      evolution = advanceReactiveEvolution3D(r, createReactiveEvolutionState3D(r, s.block, s.tick));
    const structural = createReactiveStructureJob3D(r, evolution.state.block);
    while (structural.progress().status === 'running') structural.advance(7);
    const out = advance(s);
    expect(out.state.block).toEqual(structural.result().block);
    expect(out.report.evolution).toEqual(evolution.report);
    expect(out.report.structure).toEqual(structural.result().report);
    expect(out.state.tick).toBe(4);
    expect(out.report.fromTick).toBe(3);
    expect(out.report.toTick).toBe(4);
  });
  test('burning the sole support collapses the distant bridge in the same completed tick', () => {
    const s = bridge(),
      out = advance(s);
    expect(out.report.evolution.reactions.reactedPairs).toHaveLength(1);
    expect(out.report.structure.movingCells).toEqual([0, 1, 2, 3, 4]);
    expect(out.report.moves).toContainEqual({ from: 4, to: 9 });
    expect(out.report.changedCells).toContain(9);
    expect(out.state.block.structure.slice(5, 10)).toEqual(s.block.structure.slice(0, 5));
    expect(out.report.energy.beforeQ).toBe(out.report.energy.afterQ);
  });
  test('melting the sole ice support displaces water and releases the bridge in one tick', () => {
    const out = advance(bridge(MAT.ICE, 80));
    expect(out.report.evolution.reactions.phaseChangedCells).toContain(5);
    expect(out.report.structure.movingCells).toEqual([0, 1, 2, 3, 4]);
    expect(out.state.block.packedCells[0] & 255).toBe(MAT.WATER);
  });
  test('movement followed by freezing publishes a supported ice cell without implicit bonds', () => {
    const out = advance(fixture([place(0, 0, 0, MAT.WATER, 0)], { width: 1, height: 2, depth: 1 }));
    expect(out.state.block.packedCells.map((v) => v & 255)).toEqual([MAT.AIR, MAT.ICE]);
    expect(out.state.block.structure).toEqual([0, 255]);
    expect(out.report.structure.distances).toEqual([-1, 0]);
    expect(out.report.moves).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 0 },
    ]);
  });
  test('smoke continues to move after combustion and structural settlement', () => {
    const first = advance(
        fixture([place(0, 2, 0, MAT.WOOD, 181)], { width: 1, height: 3, depth: 1 }),
      ),
      second = advance(first.state);
    expect(second.state.block.packedCells.map((v) => v & 255)).toEqual([
      MAT.SMOKE,
      MAT.AIR,
      MAT.ASH,
    ]);
    expect(second.state.block.energyQ[0]).toBe(first.state.block.energyQ[1]);
    expect(second.report.energy.beforeQ).toBe(second.report.energy.afterQ);
  });
  test('composes original matter identities through both nontrivial permutations', () => {
    const s = fixture([place(0), place(1, 0, 0, MAT.WATER, 40)]),
      out = advance(s);
    expect(out.report.evolution.movement.moves).toEqual([
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 1 },
    ]);
    expect(out.report.structure.moves).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 0 },
    ]);
    expect(out.report.moves).toEqual([
      { from: 0, to: 2 },
      { from: 1, to: 0 },
      { from: 2, to: 3 },
      { from: 3, to: 1 },
    ]);
    for (const move of out.report.moves)
      expect(out.state.block.energyQ[move.to]).toBe(s.block.energyQ[move.from]);
    expect(out.report.touchedCells).toEqual([0, 1, 2, 3]);
    expect(out.report.touchedOrigins).toEqual([0, 1, 2, 3]);
  });
  test('executed round trips retain touched origins despite unchanged endpoints', () => {
    const s = fixture([place(0, 0, 0, MAT.WATER, 20), place(1, 1, 0, MAT.SMOKE, 100)]),
      out = advance(s);
    expect(out.report.moves).toEqual([
      { from: 0, to: 3 },
      { from: 1, to: 0 },
      { from: 3, to: 1 },
    ]);
    expect(out.report.touchedOrigins).toContain(2);
    expect(out.report.changedCells).not.toContain(2);
  });
  test('falling bonded history survives repeated ticks until the closed floor', () => {
    const s = fixture(
      [
        place(0, 0, 0, MAT.STONE, 70),
        place(1),
        { ...at, kind: 'bond', direction: 1, bonded: true },
        { ...at, x: 1, kind: 'integrity', integrity: 73 },
      ],
      { width: 2, height: 3, depth: 1 },
    );
    const first = advance(s),
      second = advance(first.state),
      third = advance(second.state);
    expect(second.state.block.structure.slice(4)).toEqual([255 | BONDS_3D[1], 73 | BONDS_3D[0]]);
    expect(second.state.block.energyQ.slice(4)).toEqual(s.block.energyQ.slice(0, 2));
    expect(third.state.block).toEqual(second.state.block);
  });
  test('odd and singleton dimensions retain all coordinates and closed energy', () => {
    for (const dimensions of [
      { width: 1, height: 1, depth: 1 },
      { width: 1, height: 3, depth: 5 },
      { width: 5, height: 1, depth: 3 },
    ]) {
      const s = fixture([place(0)], dimensions),
        out = advance(s);
      expect(read(r, out.state)).toEqual(out.state);
      expect(out.report.energy.beforeQ).toBe(out.report.energy.afterQ);
      expect(out.state.block.packedCells.length).toBe(
        dimensions.width * dimensions.height * dimensions.depth,
      );
    }
  });
  test('eight-tick runs and odd/order-changing JSON restarts produce exact states and reports', async () => {
    const restoredRegistry = await createReactiveMaterialRegistry3D(
      JSON.parse(JSON.stringify(r.toCatalog())),
    );
    for (const initial of [
      bridge(),
      bridge(MAT.ICE, 80),
      fixture([place(0), place(1, 0, 0, MAT.WATER, 40)]),
    ]) {
      let uninterrupted = initial,
        repeated = structuredClone(initial);
      for (let tick = 0; tick < 8; tick++) {
        const a = advance(uninterrupted, 1),
          b = finish(
            job(restoredRegistry, read(restoredRegistry, JSON.parse(JSON.stringify(repeated)))),
            17,
          );
        expect(b).toEqual(a);
        uninterrupted = a.state;
        repeated = b.state;
      }
    }
  });
  test('structural work budgets cannot affect the combined report or completed state', () => {
    const s = bridge(),
      expected = advance(s, 256);
    for (const budget of [1, 2, 7, 64, 255]) expect(advance(s, budget)).toEqual(expected);
  });
  test('stages expose no result until evolution, structure and publication all finish', () => {
    const j = job(r, bridge());
    for (let i = 0; i < 28; i++) {
      expect(j.progress().phase).toBe('evolution');
      expect(() => j.result()).toThrow();
      j.advance();
    }
    expect(j.progress()).toEqual({
      status: 'running',
      phase: 'structure-prepare',
      evolutionPasses: 28,
      structure: null,
    });
    j.advance();
    expect(j.progress().phase).toBe('structure');
    expect(j.progress().structure!.completedWork).toBe(0);
    while (j.progress().phase === 'structure') {
      expect(() => j.result()).toThrow();
      expect(j.advance(3).structure!.lastAdvanceWork).toBeLessThanOrEqual(3);
    }
    expect(j.progress().phase).toBe('publish');
    expect(() => j.result()).toThrow();
    j.advance();
    expect(j.progress().status).toBe('complete');
  });
  test('cancel at every incomplete advance boundary preserves the entire input', () => {
    const s = fixture([place(0)], { width: 1, height: 1, depth: 1 }),
      before = structuredClone(s),
      full = job(r, s);
    let calls = 0;
    while (full.progress().status === 'running') {
      full.advance(1);
      calls++;
    }
    for (let stop = 0; stop < calls; stop++) {
      const j = job(r, s);
      for (let i = 0; i < stop; i++) j.advance(1);
      expect(j.cancel()).toBe(true);
      expect(j.cancel()).toBe(false);
      expect(j.progress().status).toBe('cancelled');
      expect(() => j.result()).toThrow();
      expect(() => j.advance()).toThrow();
      expect(s).toEqual(before);
    }
  });
  test('invalid budgets leave every phase untouched and allow a later valid advance', () => {
    const j = job(r, bridge());
    for (const phase of ['evolution', 'structure-prepare', 'structure', 'publish']) {
      while (j.progress().phase !== phase) j.advance(256);
      const before = j.progress();
      for (const value of [0, 257, -1, 1.5, NaN, null, '1']) {
        expect(() => j.advance(value as number)).toThrow();
        expect(j.progress()).toEqual(before);
      }
    }
    j.advance();
    expect(j.progress().status).toBe('complete');
  });
  test('snapshot decoder rejects wrong versions foreign state and extra fields', () => {
    const s = bridge();
    for (const bad of [
      { ...s, schemaVersion: 2 },
      { ...s, rulesVersion: 'reactive-evolution-1' },
      { ...s, tick: -1 },
      { ...s, x: 1 },
      { ...s, block: { ...s.block, materialCatalogHash: 'wrong' } },
      s.block,
      null,
    ])
      expect(() => read(r, bad)).toThrow();
    expect(read(r, s)).toEqual(s);
  });
  test('maximum safe tick can be saved but cannot advance or wrap', () => {
    const s = fixture([], undefined, Number.MAX_SAFE_INTEGER);
    expect(read(r, s).tick).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => job(r, s)).toThrow(/overflow/);
    expect(() => state(r, s.block, Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
  test('job input progress and complete result cannot alias retained state', () => {
    const s = bridge(),
      expected = advance(s),
      j = job(r, s);
    s.tick = 77;
    s.block.structure.fill(0);
    s.block.energyQ.fill(0);
    const p = j.progress();
    p.status = 'cancelled';
    p.evolutionPasses = 100;
    expect(finish(j)).toEqual(expected);
    const result = j.result();
    result.state.block.structure.fill(0);
    result.report.evolution.movement.moves.length = 0;
    result.report.structure.loads.fill(0);
    result.report.moves.length = 0;
    expect(j.result()).toEqual(expected);
    expect(j.cancel()).toBe(false);
    expect(() => j.advance()).toThrow();
  });
});
describe('owned world publication and accounting', () => {
  test('constructor owns input and public snapshots remain isolated', () => {
    const s = bridge(),
      w = world(r, s.block, 3),
      before = w.snapshot();
    s.block.energyQ.fill(0);
    const readback = w.snapshot();
    readback.block.structure.fill(0);
    readback.tick = 77;
    expect(w.snapshot()).toEqual(before);
    expect(w.tick).toBe(3);
    expect(w.revision).toBe(0);
    expect([w.width, w.height, w.depth]).toEqual([5, 3, 1]);
  });
  test('prepared work never changes committed terrain until an explicit complete commit', () => {
    const s = bridge(),
      w = world(r, s.block),
      before = w.snapshot(),
      j = w.prepareTick();
    while (j.progress().status === 'running') {
      j.advance(7);
      expect(w.snapshot()).toEqual(before);
      expect(w.revision).toBe(0);
    }
    const receipt = w.commitTick(j);
    expect(receipt.fromRevision).toBe(0);
    expect(receipt.toRevision).toBe(1);
    expect(w.tick).toBe(1);
    expect(w.snapshot()).toEqual(j.result().state);
    expect(receipt.report).toEqual(j.result().report);
  });
  test('incomplete commit preserves capability and state for later completion', () => {
    const w = world(r, bridge().block),
      before = w.snapshot(),
      j = w.prepareTick();
    j.advance();
    expect(() => w.commitTick(j)).toThrow(/complete/);
    expect(w.snapshot()).toEqual(before);
    expect(w.revision).toBe(0);
    finish(j);
    expect(w.commitTick(j).toRevision).toBe(1);
  });
  test('cancelled and consumed jobs cannot change the committed world', () => {
    const w = world(r, bridge().block),
      cancelled = w.prepareTick();
    cancelled.cancel();
    expect(() => w.commitTick(cancelled)).toThrow();
    const j = w.prepareTick();
    finish(j);
    w.commitTick(j);
    const before = w.snapshot();
    expect(() => w.commitTick(j)).toThrow(/consumed/);
    expect(w.snapshot()).toEqual(before);
    expect(w.revision).toBe(1);
  });
  test('a separately created or other-world job cannot commit even at identical revision and tick', () => {
    const s = bridge(),
      a = world(r, s.block),
      b = world(r, s.block),
      foreign = b.prepareTick(),
      independent = job(r, a.snapshot());
    finish(foreign);
    finish(independent);
    expect(() => a.commitTick(foreign)).toThrow(/foreign/);
    expect(() => a.commitTick(independent)).toThrow(/foreign/);
    expect(a.snapshot()).toEqual(s);
    expect(a.revision).toBe(0);
  });
  test('committing one prepared tick invalidates its sibling without consuming newer state', () => {
    const w = world(r, bridge().block),
      first = w.prepareTick(),
      second = w.prepareTick();
    finish(first);
    finish(second);
    w.commitTick(first);
    const before = w.snapshot();
    expect(() => w.commitTick(second)).toThrow(/stale/);
    expect(w.snapshot()).toEqual(before);
  });
  test('edits invalidate prepared ticks even when the edit is a no-op', () => {
    const w = world(r, bridge().block),
      j = w.prepareTick();
    finish(j);
    const receipt = w.edit([]);
    expect(receipt.fromRevision).toBe(0);
    expect(receipt.toRevision).toBe(1);
    expect(receipt.receipt.changedCells).toEqual([]);
    const before = w.snapshot();
    expect(() => w.commitTick(j)).toThrow(/stale/);
    expect(w.snapshot()).toEqual(before);
    expect(w.tick).toBe(0);
  });
  test('a restore to identical coordinates invalidates older jobs by live revision', () => {
    const w = world(r, bridge().block),
      saved = w.snapshot(),
      j = w.prepareTick();
    finish(j);
    w.restore(saved);
    expect(w.revision).toBe(1);
    expect(w.snapshot()).toEqual(saved);
    expect(() => w.commitTick(j)).toThrow(/stale/);
  });
  test('placement and thermal edits charge exact external energy including chemical fuel', () => {
    const w = world(r, fixture().block),
      initial = w.energyBalance(),
      placed = w.edit([place(0, 0, 0, MAT.WOOD, 181)]);
    expect(w.energyLedger().chemicalQ).toBe(80n * 256n);
    const afterPlace = w.energyBalance();
    expect(afterPlace.externalQ).toBe(BigInt(placed.receipt.externalEnergyQ));
    expect(afterPlace.currentQ - initial.currentQ).toBe(afterPlace.externalQ);
    expect(afterPlace.driftQ).toBe(0n);
    const q = w.snapshot().block.energyQ[0];
    const heated = w.edit([{ ...at, kind: 'energy', energyQ: q + 17 }]);
    expect(heated.receipt.externalEnergyQ).toBe('17');
    commit(w);
    expect(w.energyBalance().externalQ).toBe(afterPlace.externalQ + 17n);
    expect(w.energyBalance().driftQ).toBe(0n);
  });
  test('removing matter debits all conserved energy rather than silently discarding fuel', () => {
    const w = world(r, fixture().block),
      initial = w.energyBalance();
    w.edit([place(0, 0, 0, MAT.WOOD, 181)]);
    w.edit([place(0, 0, 0, MAT.AIR, 20)]);
    expect(w.energyBalance()).toEqual(initial);
    expect(w.revision).toBe(2);
  });
  test('late invalid edits leave coordinates revision ledger and an existing job usable', () => {
    const w = world(r, bridge().block),
      before = w.snapshot(),
      accounting = w.energyBalance(),
      j = w.prepareTick();
    expect(() =>
      w.edit([
        { ...at, kind: 'integrity', integrity: 0 },
        { ...at, x: 99, kind: 'place', material: MAT.AIR },
      ]),
    ).toThrow();
    expect(w.snapshot()).toEqual(before);
    expect(w.energyBalance()).toEqual(accounting);
    expect(w.revision).toBe(0);
    finish(j);
    w.commitTick(j);
  });
  test('restore establishes a new baseline without changing saved physical state', () => {
    const w = world(r, fixture().block);
    w.edit([place(0, 0, 0, MAT.WOOD, 181)]);
    commit(w);
    const saved = w.snapshot(),
      q = w.energyBalance().currentQ;
    w.restore(JSON.parse(JSON.stringify(saved)));
    expect(w.snapshot()).toEqual(saved);
    expect(w.revision).toBe(3);
    expect(w.energyBalance()).toEqual({ initialQ: q, externalQ: 0n, currentQ: q, driftQ: 0n });
  });
  test('malformed or dimension-mismatched restores cannot replace any live domain', () => {
    const w = world(r, bridge().block);
    w.edit([{ ...at, kind: 'integrity', integrity: 73 }]);
    const before = w.snapshot(),
      balance = w.energyBalance();
    for (const bad of [
      fixture(),
      { ...before, tick: -1 },
      { ...before, rulesVersion: 'ca-3d-m5' },
      { ...before, block: { ...before.block, structure: [0] } },
      null,
    ]) {
      expect(() => w.restore(bad)).toThrow();
      expect(w.snapshot()).toEqual(before);
      expect(w.energyBalance()).toEqual(balance);
      expect(w.revision).toBe(1);
    }
  });
  test('accessor edits and saves reject without invoking user getters', () => {
    const w = world(r, bridge().block),
      getter = vi.fn(() => MAT.AIR),
      command = { ...at, kind: 'place' };
    Object.defineProperty(command, 'material', { get: getter, enumerable: true });
    expect(() => w.edit([command as ReactiveMaterialEdit3D])).toThrow();
    const saved = w.snapshot();
    Object.defineProperty(saved, 'tick', { get: getter, enumerable: true });
    expect(() => w.restore(saved)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(w.revision).toBe(0);
  });
  test('swallowed reentrant edit attempts poison and roll back the outer operation', () => {
    const w = world(r, bridge().block),
      before = w.snapshot(),
      balance = w.energyBalance();
    let attempted = false;
    const command = new Proxy(place(0, 0, 0, MAT.AIR), {
      ownKeys(target) {
        if (!attempted) {
          attempted = true;
          try {
            w.edit([]);
          } catch {
            /* caller swallows the rejection */
          }
        }
        return Reflect.ownKeys(target);
      },
    });
    expect(() => w.edit([command])).toThrow(/reentry/);
    expect(attempted).toBe(true);
    expect(w.snapshot()).toEqual(before);
    expect(w.energyBalance()).toEqual(balance);
    expect(w.revision).toBe(0);
  });
  test('swallowed reentrant restore or prepare cannot alter or authorize a candidate', () => {
    const w = world(r, bridge().block),
      before = w.snapshot();
    let attempted = false;
    const saved = new Proxy(before, {
      ownKeys(target) {
        if (!attempted) {
          attempted = true;
          try {
            w.restore(before);
          } catch {}
          try {
            w.prepareTick();
          } catch {}
        }
        return Reflect.ownKeys(target);
      },
    });
    expect(() => w.restore(saved)).toThrow(/reentry/);
    expect(w.snapshot()).toEqual(before);
    expect(w.revision).toBe(0);
  });
  test('commit receipts and energy observations cannot mutate authoritative storage', () => {
    const w = world(r, bridge().block),
      receipt = commit(w),
      before = w.snapshot(),
      balance = w.energyBalance();
    receipt.report.structure.loads.fill(0);
    receipt.report.moves.length = 0;
    receipt.toRevision = 77;
    const observed = w.energyBalance();
    observed.currentQ = 0n;
    const ledger = w.energyLedger();
    ledger.totalQ = 0n;
    expect(w.snapshot()).toEqual(before);
    expect(w.energyBalance()).toEqual(balance);
    expect(w.revision).toBe(1);
  });
  test('an eight-tick owned-world restart preserves exact future snapshots and tick reports', () => {
    const seed = bridge(),
      a = world(r, seed.block),
      b = world(r, seed.block);
    for (let i = 0; i < 8; i++) {
      if (i === 3 || i === 5) b.restore(JSON.parse(JSON.stringify(a.snapshot())));
      const first = commit(a, 1),
        second = commit(b, 31);
      expect(second.report).toEqual(first.report);
      expect(b.snapshot()).toEqual(a.snapshot());
      expect(a.energyBalance().driftQ).toBe(0n);
      expect(b.energyBalance().driftQ).toBe(0n);
    }
    expect(a.tick).toBe(8);
    expect(b.tick).toBe(8);
    expect(b.revision).toBe(10);
  });
});
