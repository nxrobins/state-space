import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Tiny conservative passes only; old world stepping and global mechanics are trapped. */
import { beforeAll, describe, expect, test } from 'vitest';

import {
  createReactiveMaterialRegistry3D,
  createReactiveMaterialBlock3D as block,
  editReactiveMaterialBlock3D as edit,
  MAT,
  PHASE,
  type ReactiveMaterialRegistry3D,
  type ReactiveMaterialEdit3D,
} from '../reactive-materials.js';
import {
  reactiveMovementSchedule3D as schedule,
  runReactiveMovementPass3D as run,
  executeReactiveMovementPass3D,
  classifyReactiveMovement3D,
  type ReactiveMovementClasses3D,
  type ReactiveMovementPass3D,
} from './reactive-movement.js';
import { reactiveRegistrySource3D } from './reactive-registry.js';
holdPhysics('volumeStep', 'solveStructure3D', ...STRUCTURAL_CALLS);
let r: ReactiveMaterialRegistry3D;
beforeAll(async () => {
  r = await createReactiveMaterialRegistry3D();
});
const at = { x: 0, y: 0, z: 0 };
function fixture(
  edits: ReactiveMaterialEdit3D[],
  size = { width: 1, height: 2, depth: 1 },
  registry = r,
  fill: number = MAT.AIR,
) {
  return edit(registry, block(registry, size, fill), edits).block;
}
function pass(kind: ReactiveMovementPass3D['kind'], axis = 1, parity = 0, direction = 1, tick = 0) {
  return schedule(tick).findIndex(
    (p) => p.kind === kind && p.axis === axis && p.parity === parity && p.direction === direction,
  );
}
const place = (material: number, thermal = 20): ReactiveMaterialEdit3D => ({
  ...at,
  kind: 'place',
  material,
  thermal,
});
describe('profile-aware conservative reactive movement', () => {
  test('twenty-pass order and nested schedule records are immutable', () => {
    const s = schedule(0);
    expect(s).toHaveLength(20);
    expect(s.map((p) => p.kind)).toEqual([
      'gravity',
      'gravity',
      ...new Array(8).fill('diagonal'),
      ...new Array(4).fill('liquid'),
      'buoyancy',
      'buoyancy',
      ...new Array(4).fill('gas'),
    ]);
    expect(Object.isFrozen(s)).toBe(true);
    expect(s.every(Object.isFrozen)).toBe(true);
  });
  test('absolute tick rotates diagonal and horizontal axis priorities', () => {
    for (let tick = 0; tick < 4; tick++) {
      const s = schedule(tick);
      expect([s[2].axis, s[2].direction]).toEqual(
        [
          [0, 1],
          [0, -1],
          [2, 1],
          [2, -1],
        ][tick],
      );
      expect([s[10].axis, s[12].axis, s[16].axis, s[18].axis]).toEqual(
        tick % 2 ? [2, 0, 2, 0] : [0, 2, 0, 2],
      );
    }
  });
  test('gravity swaps all three coordinates and preserves input history', () => {
    const b = fixture([place(MAT.SAND, 177)]),
      before = structuredClone(b),
      out = run(r, b, 0, 0);
    expect(out.swaps).toEqual([[0, 1]]);
    expect(out.block.packedCells).toEqual([...b.packedCells].reverse());
    expect(out.block.energyQ).toEqual([...b.energyQ].reverse());
    expect(out.block.structure).toEqual([...b.structure].reverse());
    expect(b).toEqual(before);
  });
  test('odd gravity parity reaches the final cell of an odd axis', () => {
    const b = fixture([{ ...place(MAT.SAND), y: 1 }], { width: 1, height: 3, depth: 1 });
    expect(run(r, b, 0, 0).swaps).toEqual([]);
    expect(run(r, b, 0, 1).swaps).toEqual([[1, 2]]);
  });
  test('one pass cannot cascade a cell through multiple Y pairs', () => {
    const b = fixture([place(MAT.SAND), { ...place(MAT.WATER), x: 1 }], {
      width: 2,
      height: 3,
      depth: 1,
    });
    const even = run(r, b, 0, 0);
    expect(even.swaps).toEqual([
      [0, 2],
      [1, 3],
    ]);
    expect(even.block.packedCells.slice(4).map((v) => v & 255)).toEqual([MAT.AIR, MAT.AIR]);
    expect(run(r, even.block, 0, 1).swaps).toEqual([
      [2, 4],
      [3, 5],
    ]);
  });
  test('equal and higher-density occupants cannot be displaced by gravity', () => {
    for (const target of [MAT.WATER, MAT.SAND]) {
      const b = fixture([place(MAT.WATER), { ...place(target), y: 1 }]);
      expect(run(r, b, 0, 0).swaps).toEqual([]);
    }
  });
  test('powder descends along each signed X and Z diagonal when directly blocked', () => {
    for (const [axis, direction] of [
      [0, 1],
      [0, -1],
      [2, 1],
      [2, -1],
    ]) {
      const target = { x: axis === 0 ? 1 + direction : 1, y: 1, z: axis === 2 ? 1 + direction : 1 };
      const b = fixture(
        [
          { ...place(MAT.SAND, 150), x: 1, z: 1 },
          { ...target, kind: 'place', material: MAT.AIR },
        ],
        { width: 3, height: 2, depth: 3 },
        r,
        MAT.STONE,
      );
      const out = run(r, b, 0, pass('diagonal', axis, 0, direction)),
        to = target.x + 3 * (1 + 2 * target.z);
      expect(out.swaps).toEqual([[7, to]]);
      expect(out.block.energyQ[to]).toBe(b.energyQ[7]);
    }
  });
  test('diagonal motion waits while straight descent is available', () => {
    const b = fixture([place(MAT.SAND)], { width: 2, height: 2, depth: 1 });
    expect(run(r, b, 0, pass('diagonal', 0)).swaps).toEqual([]);
  });
  test('blocked diagonal targets and side boundaries cannot wrap into another row', () => {
    const b = fixture(
      [
        { ...place(MAT.SAND), x: 2 },
        { ...place(MAT.AIR), y: 1 },
      ],
      { width: 3, height: 2, depth: 1 },
      r,
      MAT.STONE,
    );
    expect(run(r, b, 0, pass('diagonal', 0, 0, 1)).swaps).toEqual([]);
    expect(run(r, b, 0, pass('diagonal', 0, 0, -1)).swaps).toEqual([]);
  });
  test('blocked liquid spreads along both horizontal axes and parities', () => {
    for (const axis of [0, 2])
      for (const parity of [0, 1]) {
        const size =
          axis === 0 ? { width: 3, height: 1, depth: 1 } : { width: 1, height: 1, depth: 3 };
        const b = fixture(
          [{ ...place(MAT.WATER, 50), x: axis === 0 ? parity : 0, z: axis === 2 ? parity : 0 }],
          size,
        );
        const out = run(r, b, 0, pass('liquid', axis, parity));
        expect(out.swaps).toEqual([[parity, parity + 1]]);
        expect(out.block.energyQ[parity + 1]).toBe(b.energyQ[parity]);
      }
  });
  test('liquid spreads from either endpoint of a disjoint pair', () => {
    const b = fixture([{ ...place(MAT.WATER), x: 1 }], { width: 2, height: 1, depth: 1 });
    expect(run(r, b, 0, pass('liquid', 0)).swaps).toEqual([[0, 1]]);
  });
  test('liquid does not spread while a straight downward route is open', () => {
    const b = fixture([place(MAT.WATER)], { width: 2, height: 2, depth: 1 });
    expect(run(r, b, 0, pass('liquid', 0)).swaps).toEqual([]);
  });
  test('a reachable downward diagonal also suppresses liquid spreading', () => {
    const b = fixture(
      [
        { ...place(MAT.WATER), x: 1 },
        { ...place(MAT.AIR), x: 2 },
        { ...place(MAT.AIR), y: 1 },
      ],
      { width: 3, height: 2, depth: 1 },
      r,
      MAT.STONE,
    );
    expect(run(r, b, 0, pass('liquid', 0, 1)).swaps).toEqual([]);
  });
  test('powder does not acquire the liquid lateral rule', () => {
    const b = fixture([place(MAT.SAND)], { width: 2, height: 1, depth: 1 });
    expect(run(r, b, 0, pass('liquid', 0)).swaps).toEqual([]);
  });
  test('hot smoke rises and carries its complete conserved energy', () => {
    const b = fixture([{ ...place(MAT.SMOKE, 100), y: 1 }]),
      out = run(r, b, 0, pass('buoyancy'));
    expect(out.swaps).toEqual([[0, 1]]);
    expect(out.block.packedCells[0]).toBe(b.packedCells[1]);
    expect(out.block.energyQ[0]).toBe(b.energyQ[1]);
  });
  test('gas rank threshold is strictly greater than sixteen', async () => {
    const c = r.toCatalog();
    c.propertiesCatalog.materials.find((m) => m.id === MAT.SMOKE)!.properties.density = r.material(
      MAT.AIR,
    ).properties.density;
    const custom = await createReactiveMaterialRegistry3D(c);
    for (const thermal of [28, 29]) {
      const b = fixture([{ ...place(MAT.SMOKE, thermal), y: 1 }], undefined, custom);
      expect(run(custom, b, 0, pass('buoyancy')).swaps.length).toBe(thermal === 28 ? 0 : 1);
    }
  });
  test('ordinary air does not act as the buoyant source even when hotter', () => {
    const b = fixture([place(MAT.SMOKE, 20), { ...place(MAT.AIR, 200), y: 1 }]);
    expect(run(r, b, 0, pass('buoyancy')).swaps).toEqual([]);
  });
  test('cold gas and solid ceilings block buoyancy', () => {
    for (const top of [MAT.AIR, MAT.STONE]) {
      const b = fixture([place(top, 20), { ...place(MAT.SMOKE, 0), y: 1 }]);
      expect(run(r, b, 0, pass('buoyancy')).swaps).toEqual([]);
    }
  });
  test('ceiling-blocked smoke spreads along X and Z using deterministic choice', () => {
    for (const axis of [0, 2]) {
      const b = fixture(
        [place(MAT.SMOKE, 100)],
        axis === 0 ? { width: 2, height: 1, depth: 1 } : { width: 1, height: 1, depth: 2 },
      );
      expect(run(r, b, 0, pass('gas', axis)).swaps).toEqual([[0, 1]]);
    }
  });
  test('gas spreading requires a gas destination', () => {
    const b = fixture([place(MAT.SMOKE, 100), { ...place(MAT.WATER), x: 1 }], {
      width: 2,
      height: 1,
      depth: 1,
    });
    expect(run(r, b, 0, pass('gas', 0)).swaps).toEqual([]);
  });
  test('an upward escape prevents lateral gas exchange when that source is selected', () => {
    const blocked = fixture(
      [
        { ...place(MAT.SMOKE, 100), y: 1 },
        { ...place(MAT.STONE), y: 0 },
      ],
      { width: 2, height: 2, depth: 1 },
    );
    const open = edit(r, blocked, [place(MAT.AIR)]).block;
    // A fixed verified tie choice selects the source at cell two for this tick.
    const tick = 1;
    expect(run(r, blocked, tick, pass('gas', 0, 0, 1, tick)).swaps).toEqual([[2, 3]]);
    expect(run(r, open, tick, pass('gas', 0, 0, 1, tick)).swaps).toEqual([]);
  });
  test('intact damaged and anchored solids remain mechanically owned', () => {
    for (const [integrity, anchored] of [
      [255, false],
      [73, false],
      [0, true],
    ] as const) {
      const b = fixture([
        place(MAT.WOOD, 200),
        { ...at, kind: 'integrity', integrity },
        { ...at, kind: 'anchor', anchored },
      ]);
      expect(run(r, b, 0, 0).block).toEqual(b);
    }
  });
  test('fully failed unanchored cohesive solid can fall as loose debris', () => {
    const b = fixture([place(MAT.STONE, 199), { ...at, kind: 'integrity', integrity: 0 }]),
      out = run(r, b, 0, 0);
    expect(out.swaps).toEqual([[0, 1]]);
    expect(out.block.packedCells[1]).toBe(b.packedCells[0]);
    expect(out.block.energyQ[1]).toBe(b.energyQ[0]);
    expect(out.block.structure).toEqual([0, 0]);
  });
  test('a bonded damaged region is never independently shuffled', () => {
    const b = fixture(
      [
        place(MAT.WOOD, 90),
        { ...place(MAT.WOOD, 80), x: 1 },
        { ...at, kind: 'bond', direction: 1, bonded: true },
        { ...at, kind: 'integrity', integrity: 73 },
      ],
      { width: 2, height: 2, depth: 1 },
    );
    expect(run(r, b, 0, 0).block).toEqual(b);
  });
  test('noncohesive solid and frozen cells remain obstacles despite zero structure', async () => {
    const source = r.material(MAT.ASH),
      custom = await r.extend(
        [PHASE.SOLID, PHASE.FROZEN].map((phase, i) => ({
          ...source,
          id: 200 + i,
          name: `fixed_${i}`,
          properties: {
            ...source.properties,
            default_phase: phase,
            density: 1,
            cohesion: 0,
            softening: 0,
          },
        })),
      );
    for (const id of [200, 201]) {
      const b = fixture([place(MAT.SAND), { ...place(id), y: 1 }], undefined, custom);
      expect(b.structure).toEqual([0, 0]);
      expect(run(custom, b, 0, 0).swaps).toEqual([]);
      expect(run(custom, fixture([place(id)], undefined, custom), 0, 0).swaps).toEqual([]);
    }
  });
  test('custom densities govern falling instead of the default cold table', async () => {
    const source = r.material(MAT.ASH),
      custom = await r.extend(
        [1, 2].map((density, i) => ({
          ...source,
          id: 200 + i,
          name: `powder_${i}`,
          properties: { ...source.properties, density },
        })),
      );
    expect(run(custom, fixture([place(200)], undefined, custom), 0, 0).swaps).toEqual([]);
    expect(run(custom, fixture([place(201)], undefined, custom), 0, 0).swaps).toEqual([[0, 1]]);
  });
  test('every pass conserves complete cell tuples and uses disjoint pairs', () => {
    let b = fixture(
      [
        { ...place(MAT.SAND, 100), x: 1 },
        { ...place(MAT.WATER, 50), z: 1 },
        { ...place(MAT.SMOKE, 110), y: 2, z: 2 },
        { ...place(MAT.STONE, 130), x: 2, y: 2, z: 1 },
      ],
      { width: 3, height: 3, depth: 3 },
    );
    const tuples = (v: typeof b) =>
      v.packedCells.map((c, i) => `${c}/${v.energyQ[i]}/${v.structure[i]}`).sort();
    const initial = tuples(b);
    for (let p = 0; p < 20; p++) {
      const saved = structuredClone(b),
        out = run(r, b, 3, p);
      expect(tuples(out.block)).toEqual(initial);
      expect(b).toEqual(saved);
      expect(new Set(out.swaps.flat()).size).toBe(out.swaps.length * 2);
      b = out.block;
    }
  });
  test('singleton volumes never exchange matter through a boundary', () => {
    const b = fixture([place(MAT.SMOKE, 100)], { width: 1, height: 1, depth: 1 });
    for (let p = 0; p < 20; p++) expect(run(r, b, 7, p).block).toEqual(b);
  });
  test('large absolute ticks retain the specified u32 tie-break period', () => {
    const b = fixture([place(MAT.SMOKE, 100)], { width: 2, height: 1, depth: 1 });
    for (const tick of [0, 1]) {
      const index = pass('gas', 0, 0, 1, tick);
      expect(run(r, b, tick + 2 ** 32, index).block).toEqual(run(r, b, tick, index).block);
    }
  });
  test('invalid schedule selectors and forged state leave input untouched', () => {
    const b = fixture([place(MAT.SAND)]),
      original = structuredClone(b);
    for (const [tick, index] of [
      [-1, 0],
      [0.5, 0],
      [0, -1],
      [0, 20],
      [0, 1.5],
    ])
      expect(() => run(r, b, tick, index)).toThrow();
    expect(() => run({ ...r }, b, 0, 0)).toThrow();
    expect(() => run(r, { ...b, materialCatalogHash: 'foreign' }, 0, 0)).toThrow();
    expect(b).toEqual(original);
  });
  test('every rule reads the pass input, never a swap made earlier in the same pass', () => {
    // The left sand takes the open cell below its neighbour, which still saw that cell open.
    const diagonal = fixture(
      [place(MAT.SAND), { ...place(MAT.SAND), x: 1 }, { ...place(MAT.STONE), y: 1 }],
      { width: 3, height: 2, depth: 1 },
    );
    const d = run(r, diagonal, 0, pass('diagonal', 0, 0, 1)),
      cells = diagonal.packedCells;
    expect(d.swaps).toEqual([[0, 4]]);
    expect(d.block.packedCells).toEqual([
      cells[4],
      cells[1],
      cells[2],
      cells[3],
      cells[0],
      cells[5],
    ]);
    // Bottom water spreads along Z into the cell whose open fall still holds the upper water back.
    const liquid = fixture(
      [
        { ...place(MAT.WATER), y: 1 },
        { ...place(MAT.WATER), z: 2 },
        { ...place(MAT.STONE), y: 1, z: 2 },
        { ...place(MAT.STONE), y: 1, z: 3 },
      ],
      { width: 1, height: 2, depth: 4 },
    );
    const l = run(r, liquid, 0, pass('liquid', 2, 0));
    expect(l.swaps).toEqual([[1, 3]]);
    expect(l.block.packedCells[4]).toBe(liquid.packedCells[4]);
  });
});
describe('owned movement working arrays', () => {
  function random(seed: number) {
    return (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return Math.floor((seed / 4294967296) * n);
    };
  }
  function randomBlock(next: (n: number) => number) {
    const size = { width: 1 + next(5), height: 1 + next(5), depth: 1 + next(5) },
      ids = r.materialIds;
    let b = block(r, size, next(3) ? MAT.AIR : ids[next(ids.length)]);
    for (let e = next(48); e > 0; e--) {
      const x = next(size.width),
        y = next(size.height),
        z = next(size.depth),
        k = next(10);
      const change: ReactiveMaterialEdit3D =
        k < 7
          ? { kind: 'place', x, y, z, material: ids[next(ids.length)], thermal: next(256) }
          : k < 8
            ? { kind: 'anchor', x, y, z, anchored: next(2) === 0 }
            : k < 9
              ? { kind: 'integrity', x, y, z, integrity: next(256) }
              : { kind: 'bond', x, y, z, direction: next(6), bonded: true };
      try {
        b = edit(r, b, [change]).block;
      } catch {
        // Ineligible edits are skipped.
      }
    }
    return b;
  }
  test('in-place passes with row skipping equal full scans and thread exact row counts', () => {
    const cold = reactiveRegistrySource3D(r).cold,
      next = random(20260601);
    let moving = 0;
    for (let k = 0; k < 20; k++) {
      const initial = randomBlock(next),
        tick = next(8),
        original = structuredClone(initial);
      let reference = initial,
        current = initial,
        classes: ReactiveMovementClasses3D | undefined,
        working = false;
      for (let p = 0; p < 20; p++) {
        const expected = run(r, reference, tick, p),
          swaps: [number, number][] = [],
          full: [number, number][] = [];
        // Counts of one in every row disable row skipping: the scan visits every pair.
        const ones = () => new Uint16Array(reference.height * reference.depth).fill(1),
          scanned = executeReactiveMovementPass3D(
            reference,
            cold,
            tick,
            schedule(tick)[p],
            (a, b) => full.push([a, b]),
            {
              classes: classifyReactiveMovement3D(
                reference.packedCells,
                reference.structure,
                cold,
                reference.width,
              ).classes,
              rowFalling: ones(),
              rowFluid: ones(),
              rowGas: ones(),
            },
          );
        expect(expected.swaps).toEqual(full);
        expect(expected.block).toEqual(scanned.block);
        const out = executeReactiveMovementPass3D(
          current,
          cold,
          tick,
          schedule(tick)[p],
          (a, b) => swaps.push([a, b]),
          classes,
          working,
        );
        expect(swaps).toEqual(expected.swaps);
        expect(out.block).toEqual(expected.block);
        expect(out.classes).toEqual(
          classifyReactiveMovement3D(
            out.block.packedCells,
            out.block.structure,
            cold,
            out.block.width,
          ),
        );
        if (out.block.packedCells !== current.packedCells) {
          expect(working).toBe(false);
          working = true;
        }
        if (swaps.length) moving++;
        reference = expected.block;
        current = out.block;
        classes = out.classes;
      }
      expect(initial).toEqual(original);
    }
    expect(moving).toBeGreaterThan(40);
  });
});
