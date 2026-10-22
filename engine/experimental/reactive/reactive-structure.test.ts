import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Tiny new CPU graph kernel only. Existing M5/global-world execution stays trapped. */
import { beforeAll, describe, expect, test } from 'vitest';

import {
  createReactiveMaterialRegistry3D,
  defaultReactiveMaterialCatalog3D,
  createReactiveMaterialBlock3D as block,
  editReactiveMaterialBlock3D as edit,
  readReactiveMaterialBlock3D as read,
  createReactiveReactionState3D,
  advanceReactiveReactions3D,
  MAT,
  PHASE,
  BONDS_3D,
  ANCHOR_3D,
  INTEGRITY_3D,
  type ReactiveMaterialRegistry3D,
  type ReactiveMaterialBlock3D,
  type ReactiveMaterialEdit3D,
} from '../reactive-materials.js';
import {
  createReactiveStructureJob3D as job,
  startReactiveStructureJob3D,
  type ReactiveStructureProgress3D,
} from './reactive-structure.js';
import { startStepBaselineStructureJob3D } from './reactive-structure.per-step-oracle.js';
holdPhysics('volumeStep', 'solveStructure3D', ...STRUCTURAL_CALLS);
let r: ReactiveMaterialRegistry3D, custom: ReactiveMaterialRegistry3D;
beforeAll(async () => {
  const catalog = defaultReactiveMaterialCatalog3D();
  for (const m of catalog.propertiesCatalog.materials) m.properties.conductivity = 0;
  r = await createReactiveMaterialRegistry3D(catalog);
  const stone = structuredClone(r.material(MAT.STONE));
  // Mechanical-only custom fixtures must not inherit stone's paired lava edge.
  Object.assign(stone.properties, {
    melt_point: 0,
    melts_into: 0,
    latent_heat_melt: 0,
    freeze_point: 0,
    boil_point: 0,
  });
  custom = await r.extend([
    {
      ...stone,
      id: 200,
      name: 'light_stone',
      properties: { ...stone.properties, density: 64, cohesion: 1, softening: 0 },
    },
    {
      ...stone,
      id: 201,
      name: 'fixed_shell',
      properties: { ...stone.properties, density: 1, cohesion: 0, softening: 0 },
    },
    {
      ...stone,
      id: 202,
      name: 'fixed_ice',
      properties: {
        ...stone.properties,
        density: 1,
        cohesion: 0,
        softening: 0,
        default_phase: PHASE.FROZEN,
      },
    },
  ]);
});
const at = { x: 0, y: 0, z: 0 };
const place = (
  x: number,
  y = 0,
  z = 0,
  material: number = MAT.STONE,
  thermal = 20,
): ReactiveMaterialEdit3D => ({ kind: 'place', x, y, z, material, thermal });
const bond = (x: number, y = 0, z = 0, direction = 1): ReactiveMaterialEdit3D => ({
  kind: 'bond',
  x,
  y,
  z,
  direction,
  bonded: true,
});
function fixture(
  edits: ReactiveMaterialEdit3D[],
  dimensions = { width: 3, height: 3, depth: 3 },
  registry = r,
) {
  expect(dimensions.width * dimensions.height * dimensions.depth).toBeLessThanOrEqual(125);
  return edit(registry, block(registry, dimensions), edits).block;
}
function settle(input: ReactiveMaterialBlock3D, budget = 64, registry = r) {
  const j = job(registry, input);
  let calls = 0;
  while (j.progress().status === 'running') {
    expect(++calls).toBeLessThanOrEqual(j.progress().maxTotalWork);
    j.advance(budget);
  }
  const out = j.result();
  expect(read(registry, out.block)).toEqual(out.block);
  return out;
}
function bridge(support: number = MAT.WOOD, thermal = 20) {
  return fixture(
    [
      ...Array.from({ length: 5 }, (_, x) => place(x)),
      ...Array.from({ length: 4 }, (_, x) => bond(x)),
      place(0, 1, 0, support, thermal),
      { ...at, y: 1, kind: 'anchor', anchored: true },
    ],
    { width: 5, height: 3, depth: 1 },
  );
}
describe('reactive structural support and conservative fragments', () => {
  test('a one-cell solid rests on the closed floor with balanced load', () => {
    const b = fixture([place(0)], { width: 1, height: 1, depth: 1 }),
      out = settle(b);
    expect(out.block).toEqual(b);
    expect(out.report.distances).toEqual([0]);
    expect(out.report.loads).toEqual([4]);
    expect(out.report.reactions).toEqual([4]);
    expect(out.report.supportedWeight).toBe(4);
    expect(out.report.changedCells).toEqual([]);
  });
  test('air, powder and liquid alone have no structural members or loads', () => {
    const b = fixture([place(0, 0, 0, MAT.SAND), place(1, 0, 0, MAT.WATER)]),
      out = settle(b);
    expect(out.block).toEqual(b);
    expect(out.report.distances.every((d) => d === -1)).toBe(true);
    expect(out.report.supportedWeight).toBe(0);
  });
  test('unsupported solid falls exactly one cell with its damage and energy', () => {
    const b = fixture(
      [place(0, 0, 0, MAT.STONE, 70), { ...at, kind: 'integrity', integrity: 73 }],
      { width: 1, height: 3, depth: 1 },
    );
    const out = settle(b);
    expect(out.block.packedCells[1]).toBe(b.packedCells[0]);
    expect(out.block.energyQ[1]).toBe(b.energyQ[0]);
    expect(out.block.structure).toEqual([0, 73, 0]);
    expect(out.report.movingCells).toEqual([0]);
    expect(out.report.moves).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 0 },
    ]);
    expect(out.report.distances).toEqual([-1, -1, -1]);
  });
  test('an anchor prevents unsupported motion without repairing integrity', () => {
    const b = fixture([
      place(0),
      { ...at, kind: 'integrity', integrity: 11 },
      { ...at, kind: 'anchor', anchored: true },
    ]);
    expect(settle(b).block).toEqual(b);
  });
  test('unbonded vertical contacts carry weight without creating bonds', () => {
    const b = fixture([place(0), place(0, 1), place(0, 2)], { width: 1, height: 3, depth: 1 }),
      out = settle(b);
    expect(out.block).toEqual(b);
    expect(out.report.distances).toEqual([2, 1, 0]);
    expect(out.report.loads).toEqual([4, 8, 12]);
    expect(out.report.componentIds).toEqual([0, 1, 2]);
    expect(out.report.reactions).toEqual([0, 0, 12]);
  });
  test('touching horizontal cells do not gain implicit support or bonds', () => {
    const b = fixture([place(0), place(1), { ...at, kind: 'anchor', anchored: true }], {
        width: 2,
        height: 2,
        depth: 1,
      }),
      out = settle(b);
    expect(out.report.distances).toEqual([0, -1, -1, -1]);
    expect(out.report.movingCells).toEqual([1]);
    expect(out.block.structure).toEqual([255 | ANCHOR_3D, 0, 0, 255]);
  });
  test('X bonds transmit distant support across the complete bridge', () => {
    const out = settle(bridge());
    expect(out.report.distances.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(out.report.loads.slice(0, 5)).toEqual([20, 16, 12, 8, 4]);
    expect(out.report.reactions[5]).toBe(22);
    expect(out.report.movingCells).toEqual([]);
    expect(out.report.componentIds.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
  });
  test('Z bonds carry support in an odd rectangular volume', () => {
    const b = fixture(
        [
          place(0),
          place(0, 0, 1),
          place(0, 0, 2),
          bond(0, 0, 0, 5),
          bond(0, 0, 1, 5),
          { ...at, kind: 'anchor', anchored: true },
        ],
        { width: 1, height: 3, depth: 3 },
      ),
      out = settle(b);
    expect([0, 3, 6].map((i) => out.report.distances[i])).toEqual([0, 1, 2]);
    expect(out.block).toEqual(b);
  });
  test('Y bonds let an anchored upper cell suspend a lower cell', () => {
    const b = fixture(
      [place(0), place(0, 1), bond(0, 0, 0, 3), { ...at, kind: 'anchor', anchored: true }],
      { width: 1, height: 3, depth: 1 },
    );
    const out = settle(b);
    expect(out.block).toEqual(b);
    expect(out.report.distances).toEqual([0, 1, -1]);
  });
  test('integer remainders go to the smallest global support index', () => {
    const b = fixture(
      [
        place(0, 0, 0, 200),
        place(1, 0, 0, 200),
        place(2, 0, 0, 200),
        bond(0),
        bond(1),
        { ...at, kind: 'anchor', anchored: true },
        { ...at, x: 2, kind: 'anchor', anchored: true },
      ],
      { width: 3, height: 2, depth: 1 },
      custom,
    );
    const out = settle(b, 64, custom);
    expect(out.report.loads.slice(0, 3)).toEqual([2, 1, 1]);
    expect(out.report.reactions.slice(0, 3)).toEqual([2, 0, 1]);
    expect(out.report.supportedWeight).toBe(3);
  });
  test('custom density and cohesion determine exact supported weight and capacity', () => {
    const out = settle(
      fixture([place(0, 0, 0, 200)], { width: 1, height: 1, depth: 1 }, custom),
      1,
      custom,
    );
    expect(out.report.loads).toEqual([1]);
    expect(out.report.capacities).toEqual([16]);
  });
  test('thermal weakening uses two-stage integer rounding and preserves energy', () => {
    const b = fixture(
      [place(0, 0, 0, MAT.STONE, 212), { ...at, kind: 'integrity', integrity: 73 }],
      { width: 1, height: 1, depth: 1 },
    );
    const out = settle(b);
    expect(out.report.capacities).toEqual([458]);
    expect(out.block).toEqual(b);
  });
  test('zero thermal capacity fails integrity and retains the explicit anchor', () => {
    const b = fixture([place(0, 0, 0, MAT.WOOD, 184), { ...at, kind: 'anchor', anchored: true }], {
      width: 1,
      height: 2,
      depth: 1,
    });
    const out = settle(b);
    expect(out.block.structure[0]).toBe(ANCHOR_3D);
    expect(out.report.brokenCells).toEqual([0]);
    expect(out.report.moves).toEqual([]);
    expect(out.block.energyQ).toEqual(b.energyQ);
  });
  test('overload applies exactly one integer damage increment per solve', () => {
    const b = fixture(
      [
        place(0, 0, 0, 200),
        place(0, 1, 0, 200),
        place(0, 2, 0, 200),
        ...[0, 1, 2].map((y) => ({ ...at, y, kind: 'integrity' as const, integrity: 16 })),
      ],
      { width: 1, height: 3, depth: 1 },
      custom,
    );
    const out = settle(b, 64, custom);
    expect(out.report.loads).toEqual([1, 2, 3]);
    expect(out.report.capacities).toEqual([1, 1, 1]);
    expect(out.block.structure).toEqual([16, 1, 0]);
    expect(out.report.brokenCells).toEqual([2]);
  });
  test('a failed bonded cell prunes both ends without welding surviving neighbors', () => {
    const b = fixture([place(0, 0, 0, MAT.WOOD, 184), place(1), place(2), bond(0), bond(1)], {
      width: 3,
      height: 1,
      depth: 1,
    });
    const out = settle(b);
    expect(out.block.structure).toEqual([0, 255 | BONDS_3D[1], 255 | BONDS_3D[0]]);
    expect(out.report.changedCells).toEqual([0, 1]);
    expect(out.report.componentIds).toEqual([-1, 1, 1]);
  });
  test('a floating bonded fragment retains its internal bonds and damage', () => {
    const b = fixture(
      [
        place(0),
        place(1, 0, 0, MAT.STONE, 90),
        bond(0),
        { ...at, x: 1, kind: 'integrity', integrity: 40 },
      ],
      { width: 2, height: 3, depth: 1 },
    );
    const out = settle(b);
    expect(out.block.structure.slice(2, 4)).toEqual(b.structure.slice(0, 2));
    expect(out.block.energyQ.slice(2, 4)).toEqual(b.energyQ.slice(0, 2));
    expect(out.report.componentIds.slice(0, 2)).toEqual([0, 0]);
  });
  test('unbonded falling vertical stacks form a conservative cycle, not overlapping swaps', () => {
    const b = fixture([place(0, 0, 0, MAT.STONE, 30), place(0, 1, 0, MAT.STONE, 60)], {
        width: 1,
        height: 3,
        depth: 1,
      }),
      out = settle(b);
    expect(out.report.moves).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 0 },
    ]);
    expect(out.block.energyQ).toEqual([b.energyQ[2], b.energyQ[0], b.energyQ[1]]);
  });
  test('falling stone displaces lower-density water and transports both energy values', () => {
    const b = fixture([place(0, 0, 0, MAT.STONE, 100), place(0, 1, 0, MAT.WATER, 40)], {
        width: 1,
        height: 2,
        depth: 1,
      }),
      out = settle(b);
    expect(out.block.packedCells).toEqual([b.packedCells[1], b.packedCells[0]]);
    expect(out.block.energyQ).toEqual([...b.energyQ].reverse());
  });
  test('lighter structures rest on denser liquid without artificial structural members', () => {
    const b = fixture(
      [place(0, 0, 0, 200), place(0, 1, 0, MAT.WATER, 40)],
      { width: 1, height: 2, depth: 1 },
      custom,
    );
    const out = settle(b, 64, custom);
    expect(out.block).toEqual(b);
    expect(out.report.distances).toEqual([0, -1]);
  });
  test('noncohesive solid obstacles remain fixed despite their zero structural word', () => {
    const b = fixture([place(0), place(0, 1, 0, 201)], { width: 1, height: 2, depth: 1 }, custom);
    expect(b.structure[1]).toBe(0);
    expect(settle(b, 64, custom).block).toEqual(b);
  });
  test('noncohesive frozen obstacles remain fixed despite low density', () => {
    const b = fixture([place(0), place(0, 1, 0, 202)], { width: 1, height: 2, depth: 1 }, custom);
    expect(settle(b, 64, custom).block).toEqual(b);
  });
  test('blocking propagates across multiple touching components and distant bonds', () => {
    const b = fixture(
      [place(0), place(1), bond(0), place(1, 1), place(2, 1), bond(1, 1), place(2, 2)],
      { width: 3, height: 3, depth: 1 },
    );
    const out = settle(b);
    expect(out.block).toEqual(b);
    expect(out.report.movingCells).toEqual([]);
    expect(out.report.componentIds).toEqual([0, 0, -1, -1, 4, 4, -1, -1, 8]);
  });
  test('cutting the sole anchor moves the entire distant bridge', () => {
    const b = bridge(),
      cut = edit(r, b, [{ ...at, y: 1, kind: 'place', material: MAT.AIR }]).block,
      out = settle(cut);
    expect(out.report.movingCells).toEqual([0, 1, 2, 3, 4]);
    expect(out.report.changedCells).toContain(9);
    expect(out.report.moves).toContainEqual({ from: 4, to: 9 });
    expect(out.block.structure.slice(5, 10)).toEqual(cut.structure.slice(0, 5));
  });
  test('burning a support releases its distant bridge without losing conserved energy', () => {
    const b = bridge(MAT.WOOD, 181),
      reacted = advanceReactiveReactions3D(r, createReactiveReactionState3D(r, b)),
      out = settle(reacted.state.block);
    expect(reacted.state.block.packedCells[5] & 255).toBe(MAT.ASH);
    expect(out.report.movingCells).toEqual([0, 1, 2, 3, 4]);
    expect(out.report.moves).toContainEqual({ from: 4, to: 9 });
    expect(out.report.energy.beforeQ).toBe(reacted.report.energy.beforeQ);
    expect(out.report.energy.afterQ).toBe(reacted.report.energy.beforeQ);
  });
  test('melting an ice support releases its bridge and conservatively displaces the water', () => {
    const b = bridge(MAT.ICE, 80),
      reacted = advanceReactiveReactions3D(r, createReactiveReactionState3D(r, b)),
      out = settle(reacted.state.block);
    expect(reacted.state.block.packedCells[5] & 255).toBe(MAT.WATER);
    expect(out.report.movingCells).toEqual([0, 1, 2, 3, 4]);
    expect(out.block.packedCells[0] & 255).toBe(MAT.WATER);
    expect(out.report.energy.afterQ).toBe(reacted.report.energy.beforeQ);
  });
  test('complete state and report are independent of work-budget size', () => {
    const b = bridge(),
      expected = settle(b, 256);
    for (const size of [1, 2, 7, 31, 64, 255]) expect(settle(b, size)).toEqual(expected);
  });
  test('input validation rejects malformed bonds and incompatible catalogs before work', () => {
    const b = bridge(),
      bad = structuredClone(b);
    bad.structure[0] &= ~BONDS_3D[1];
    expect(() => job(r, bad)).toThrow();
    expect(() => job(custom, b)).toThrow();
    expect(b).toEqual(bridge());
  });
  test('complete blocks restart exactly after JSON serialization and a fresh registry', async () => {
    const b = fixture([place(0)], { width: 1, height: 4, depth: 1 }),
      first = settle(b);
    const registry = await createReactiveMaterialRegistry3D(
      JSON.parse(JSON.stringify(r.toCatalog())),
    );
    expect(settle(JSON.parse(JSON.stringify(first.block)), 3, registry)).toEqual(
      settle(first.block),
    );
  });
  test('each advance stays within its work budget and exposes no partial result', () => {
    const j = job(r, bridge());
    let completed = 0;
    while (j.progress().status === 'running') {
      expect(() => j.result()).toThrow();
      const p = j.advance(3);
      expect(p.lastAdvanceWork).toBeGreaterThan(0);
      expect(p.lastAdvanceWork).toBeLessThanOrEqual(3);
      expect(p.completedWork - completed).toBe(p.lastAdvanceWork);
      expect(p.completedWork).toBeLessThanOrEqual(p.maxTotalWork);
      completed = p.completedWork;
    }
    expect(j.progress().stage).toBe('complete');
    expect(j.result()).toEqual(settle(bridge()));
  });
  test('invalid budgets fail without advancing or cancelling the job', () => {
    const j = job(r, bridge()),
      before = j.progress();
    for (const v of [0, -1, 257, 1.5, NaN, Infinity, null, '1']) {
      expect(() => j.advance(v as number)).toThrow();
      expect(j.progress()).toEqual(before);
    }
    expect(j.advance().lastAdvanceWork).toBe(64);
  });
  test('cancelling at every incomplete work boundary leaves committed input untouched', () => {
    const b = fixture([place(0)], { width: 1, height: 2, depth: 1 }),
      before = structuredClone(b),
      full = job(r, b);
    while (full.progress().status === 'running') full.advance(1);
    for (let stop = 0; stop < full.progress().completedWork; stop++) {
      const j = job(r, b);
      for (let i = 0; i < stop; i++) j.advance(1);
      expect(j.cancel()).toBe(true);
      expect(j.cancel()).toBe(false);
      expect(() => j.advance()).toThrow();
      expect(() => j.result()).toThrow();
      expect(b).toEqual(before);
    }
  });
  test('caller mutations cannot affect a job after its validated snapshot is captured', () => {
    const b = bridge(),
      expected = settle(b),
      j = job(r, b);
    j.advance(2);
    b.structure.fill(0);
    b.energyQ.fill(0);
    b.packedCells.fill(0);
    while (j.progress().status === 'running') j.advance();
    expect(j.result()).toEqual(expected);
  });
  test('completed results and progress values are isolated and terminal jobs stay terminal', () => {
    const j = job(r, bridge());
    const p = j.progress();
    p.status = 'complete';
    p.completedWork = 99999;
    while (j.progress().status === 'running') j.advance();
    const before = j.result(),
      out = j.result();
    out.block.structure.fill(0);
    out.report.loads.fill(0);
    out.report.moves.push({ from: 0, to: 0 });
    out.report.energy.afterQ = '0';
    expect(j.result()).toEqual(before);
    expect(j.cancel()).toBe(false);
    expect(() => j.advance()).toThrow();
  });
  test('a dense 5 cubed fixture stays inside the linear work bound', () => {
    const b = block(r, { width: 5, height: 5, depth: 5 }, MAT.STONE),
      j = job(r, b);
    while (j.progress().status === 'running') j.advance(7);
    expect(j.progress().completedWork).toBeLessThanOrEqual(20 * 125 + 16);
    expect(j.result().block).toEqual(b);
    expect(j.result().report.supportedWeight).toBe(500);
  });
  test('all three coordinates follow the reported permutation in an odd mixed block', () => {
    const b = fixture(
      [place(0), place(1), bond(0), place(2, 0, 2), place(2, 1, 2, MAT.WATER, 50)],
      { width: 3, height: 3, depth: 3 },
    );
    const out = settle(b),
      destination = b.packedCells.map((_, i) => i);
    for (const move of out.report.moves) destination[move.from] = move.to;
    expect(new Set(destination).size).toBe(b.packedCells.length);
    for (let i = 0; i < destination.length; i++) {
      expect(out.block.packedCells[destination[i]]).toBe(b.packedCells[i]);
      expect(out.block.energyQ[destination[i]]).toBe(b.energyQ[i]);
      expect(out.block.structure[destination[i]]).toBe(b.structure[i]);
    }
    expect(out.report.energy.beforeQ).toBe(out.report.energy.afterQ);
    expect(out.report.energy.driftQ).toBe('0');
  });
});
describe('batched structure work replays the per-step oracle', () => {
  type Start = typeof startReactiveStructureJob3D;
  const schedules = [[1], [3], [64], [255, 1], [256], [1, 3, 2, 256, 5]];
  const progress = (p: ReactiveStructureProgress3D) =>
    `${p.status} ${p.stage} ${p.completedWork} ${p.lastAdvanceWork} ${p.maxTotalWork}`;
  const message = (run: () => unknown) => {
    try {
      run();
      return 'ok';
    } catch (error) {
      return (error as Error).message;
    }
  };
  function random(seed: number) {
    return (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return Math.floor((seed / 4294967296) * n);
    };
  }
  function randomBlock(next: (n: number) => number, registry: ReactiveMaterialRegistry3D) {
    const size = { width: 1 + next(6), height: 1 + next(6), depth: 1 + next(6) },
      count = size.width * size.height * size.depth,
      ids = registry.materialIds,
      solids: number[] = [MAT.STONE, MAT.WOOD, MAT.ICE, MAT.METAL, MAT.GLASS],
      fill = next(101);
    if (registry === custom) solids.push(200, 201, 202);
    const cell = (i: number) => ({
      x: i % size.width,
      y: Math.floor(i / size.width) % size.height,
      z: Math.floor(i / (size.width * size.height)),
    });
    let b = block(registry, size);
    const apply = (change: ReactiveMaterialEdit3D) => {
      try {
        b = edit(registry, b, [change]).block;
      } catch {
        // Ineligible edits are skipped.
      }
    };
    for (let i = 0; i < count; i++)
      if (next(100) < fill)
        apply({
          ...cell(i),
          kind: 'place',
          material: next(10) < 7 ? solids[next(solids.length)] : ids[next(ids.length)],
          thermal: next(10) < 3 ? next(256) : 20,
        });
    for (let i = 0; i < count; i++) {
      const p = cell(i);
      if (next(5) === 0) apply({ ...p, kind: 'integrity', integrity: next(3) ? 1 + next(255) : 0 });
      if (next(4) === 0) apply({ ...p, kind: 'anchor', anchored: true });
      for (const direction of [1, 3, 5])
        if (next(2)) apply({ ...p, kind: 'bond', direction, bonded: true });
      if (next(7) === 0) apply({ ...p, kind: 'energy', energyQ: b.energyQ[i] + next(300 * 256) });
    }
    return read(registry, b);
  }
  /** Progress after every advance, then the result, or the error and the cancelled job's answers. */
  function replay(
    start: Start,
    registry: ReactiveMaterialRegistry3D,
    input: ReactiveMaterialBlock3D,
    budgets: number[],
  ) {
    const { job: j, output } = start(registry, input),
      steps = [progress(j.progress())];
    try {
      for (let q = 0; j.progress().status === 'running'; q++)
        steps.push(progress(j.advance(budgets[q % budgets.length])));
    } catch (error) {
      return {
        steps,
        error: (error as Error).message,
        after: [progress(j.progress()), message(() => j.advance()), message(() => j.result())],
      };
    }
    const result = j.result();
    return {
      steps,
      result,
      keys: [Object.keys(result.block), Object.keys(result.report)],
      output: output(),
    };
  }
  function expectReplay(registry: ReactiveMaterialRegistry3D, input: ReactiveMaterialBlock3D) {
    let last: ReturnType<typeof replay> | undefined;
    for (const budgets of schedules) {
      const expected = replay(startStepBaselineStructureJob3D, registry, input, budgets);
      expect(replay(startReactiveStructureJob3D, registry, input, budgets)).toStrictEqual(expected);
      last = expected;
    }
    return last!;
  }
  test('random blocks match unit for unit under every budget schedule', () => {
    const next = random(20261022);
    let moved = 0,
      broken = 0;
    for (let c = 0; c < 72; c++) {
      const registry = c % 4 === 3 ? custom : r,
        out = expectReplay(registry, randomBlock(next, registry)).result!;
      if (out.report.moves.length) moved++;
      if (out.report.brokenCells.length) broken++;
    }
    expect(moved).toBeGreaterThan(20);
    expect(broken).toBeGreaterThan(5);
  });
  test('malformed owned blocks throw the same error after the same work', () => {
    const next = random(77),
      errors = new Set<string>();
    for (let c = 0; c < 60; c++) {
      const registry = c % 4 === 3 ? custom : r,
        bad = structuredClone(randomBlock(next, registry)),
        n = bad.structure.length;
      // Non-reciprocal or boundary bonds, bonded cells without integrity, toggled anchors.
      for (let m = 1 + next(4); m > 0; m--) {
        const i = next(n),
          kind = next(4);
        if (kind === 0) bad.structure[i] |= BONDS_3D[next(6)];
        else if (kind === 1) bad.structure[i] &= ~BONDS_3D[next(6)];
        else if (kind === 2) bad.structure[i] &= ~INTEGRITY_3D;
        else bad.structure[i] ^= ANCHOR_3D;
      }
      const out = expectReplay(registry, bad);
      if (out.error) errors.add(out.error);
    }
    expect(errors).toContain('Incomplete reactive support graph.');
  });
  test('cancelling at every work boundary matches the per-step job', () => {
    const next = random(5);
    const cancelAt = (start: Start, input: ReactiveMaterialBlock3D, stop: number) => {
      const { job: j } = start(r, input);
      for (let s = 0; s < stop; s++) j.advance(1);
      const before = progress(j.progress()),
        first = j.cancel(),
        second = j.cancel();
      return [before, first, second, message(() => j.advance()), message(() => j.result())];
    };
    for (let c = 0; c < 8; c++) {
      let input = randomBlock(next, r);
      while (input.packedCells.length > 48) input = randomBlock(next, r);
      expectReplay(r, input);
      const full = startReactiveStructureJob3D(r, input).job;
      while (full.progress().status === 'running') full.advance(256);
      for (let stop = 0; stop <= full.progress().completedWork; stop++)
        expect(cancelAt(startReactiveStructureJob3D, input, stop)).toStrictEqual(
          cancelAt(startStepBaselineStructureJob3D, input, stop),
        );
    }
  });
  test('a 12 cubed scene with bridges, liquid and falling ice matches every schedule', () => {
    const size = 12,
      deck = size >> 1,
      edits: ReactiveMaterialEdit3D[] = [];
    const anchor = (x: number, y: number, z: number): ReactiveMaterialEdit3D => ({
      kind: 'anchor',
      x,
      y,
      z,
      anchored: true,
    });
    for (let z = 0; z < size; z++)
      for (let x = 0; x < size; x++) edits.push(place(x, size - 1, z), anchor(x, size - 1, z));
    for (let z = 1; z < size - 1; z += 4)
      for (let sx = 2; sx + 3 < size; sx += 4) {
        for (let y = deck; y < size - 1; y++) edits.push(place(sx - 1, y, z), anchor(sx - 1, y, z));
        edits.push(place(sx, deck, z, MAT.WOOD), place(sx + 1, deck, z), place(sx + 2, deck, z));
        for (let x = sx - 1; x < sx + 2; x++) edits.push(bond(x, deck, z));
      }
    for (let z = 0; z < size; z += 2)
      for (let x = 0; x < size; x += 2) edits.push(place(x, size - 2, z, MAT.WATER, 25));
    for (let z = 2; z < size; z += 5)
      for (let x = 2; x < size; x += 5) edits.push(place(x, 1, z, MAT.ICE, 5));
    const scene = edit(r, block(r, { width: size, height: size, depth: size }), edits).block,
      out = expectReplay(r, read(r, scene)).result!;
    expect(out.report.moves.length).toBeGreaterThan(0);
    expect(out.report.supportedWeight).toBeGreaterThan(0);
  });
});
