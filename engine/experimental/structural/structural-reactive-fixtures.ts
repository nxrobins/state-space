/** Bounded ca-3d-m6 fixtures shared by the CPU tests and the GPU parity probes. */
import { MAT } from '../../generated/materials.js';
import { THERMAL_MAT_3D } from '../reactive/thermal-materials.js';
import type { StructuralEdit3D } from './structural-world-core.js';

export const REACTIVE_FIXTURE_NAMES_3D = [
  'bridge',
  'sealed',
  'vented',
  'valve',
  'barrier',
  'uniform',
  'dormant',
] as const;
export type ReactiveFixtureName3D = (typeof REACTIVE_FIXTURE_NAMES_3D)[number];
/** Deterministic tick windows each fixture must meet, like the M5 chamber failure windows. */
export type ReactiveExpectation3D = {
  /** The exact tick after which ash first exists. */
  firstReactionTick?: number;
  /** From this tick on, every wood cell except the pinned one rests on the closed floor row. */
  spanOnFloorFrom?: number;
  /** The plug is still solid wax after this tick and no longer wax by plugMeltsBy. */
  plugSolidThrough?: number;
  plugMeltsBy?: number;
  /** Water fills exactly its two column cells through this tick and reaches y >= 4 by waterReleasedBy. */
  waterHeldThrough?: number;
  waterReleasedBy?: number;
  /** All three coordinates equal the initial state after every tick through this one. */
  unchangedThrough?: number;
};
export type ReactiveFixture3D = {
  name: ReactiveFixtureName3D;
  size: number;
  chunkSize: number;
  /** Applied before tick 0 as one transaction. */
  initial: StructuralEdit3D[];
  /** Edits supplied with the step that starts the given absolute tick. */
  scripted: ReadonlyMap<number, StructuralEdit3D[]>;
  /** Ticks each fixture is scripted to run. */
  ticks: number;
  /** Named cells the tests and probes inspect. */
  cells: Record<string, [number, number, number]>;
  expected: ReactiveExpectation3D;
};
const place = (
  x: number,
  y: number,
  z: number,
  material: number,
  thermal?: number,
): StructuralEdit3D => ({
  kind: 'material',
  x,
  y,
  z,
  material,
  ...(thermal === undefined ? {} : { thermal }),
});
const anchor = (x: number, y: number, z: number): StructuralEdit3D => ({
  kind: 'anchor',
  x,
  y,
  z,
  anchored: true,
});
/** Stone shell with its bottom on the closed floor, every wall cell pinned. */
function shell(size: number, open: boolean): StructuralEdit3D[] {
  const edits: StructuralEdit3D[] = [],
    lo = 1,
    hi = size - 2,
    top = 1,
    bottom = size - 1;
  for (let z = lo; z <= hi; z++)
    for (let y = top; y <= bottom; y++)
      for (let x = lo; x <= hi; x++) {
        const wall =
          x === lo || x === hi || z === lo || z === hi || y === bottom || (y === top && !open);
        if (!wall) continue;
        edits.push(place(x, y, z, MAT.STONE), anchor(x, y, z));
      }
  return edits;
}
/** Interior wood above its flash temperature, with sparse air pockets in the top interior layer. */
function fuelFill(size: number): StructuralEdit3D[] {
  const edits: StructuralEdit3D[] = [];
  for (let z = 2; z <= size - 3; z++)
    for (let y = 2; y <= size - 2; y++)
      for (let x = 2; x <= size - 3; x++) {
        if (y === 2 && (x + z) % 2 === 0) continue;
        edits.push(place(x, y, z, MAT.WOOD, 230));
      }
  return edits;
}
/** Oxidizer cells a sealed shell starts with: the only air its fuel can ever reach. */
export function sealedAirCells3D(size: number): number {
  let count = 0;
  for (let z = 2; z <= size - 3; z++)
    for (let x = 2; x <= size - 3; x++) if ((x + z) % 2 === 0) count++;
  return count;
}

export function reactiveFixture3D(name: ReactiveFixtureName3D, size: 8 | 16): ReactiveFixture3D {
  const chunkSize = size / 2,
    zc = size / 2,
    scripted = new Map<number, StructuralEdit3D[]>(),
    cells: ReactiveFixture3D['cells'] = {};
  let initial: StructuralEdit3D[] = [],
    ticks = 48,
    expected: ReactiveExpectation3D = {};
  if (name === 'bridge') {
    // A wooden cantilever pinned at x = 1. Igniting x = 2 and x = 3 consumes the supports of the
    // remaining span, which then falls as one bonded fragment toward the closed floor.
    for (let x = 1; x <= size - 2; x++) initial.push(place(x, 2, zc, MAT.WOOD));
    initial.push(anchor(1, 2, zc));
    scripted.set(
      3,
      [2, 3].map((x) => ({ kind: 'energy', x, y: 2, z: zc, energyQ: (80 + 300) * 256 })),
    );
    cells.anchor = [1, 2, zc];
    cells.ignition = [2, 2, zc];
    cells.spanEnd = [size - 2, 2, zc];
    ticks = size === 8 ? 40 : 64;
    // Heating breaks the two cells at the tick-4 solve, they burn in that tick's combustion
    // pass, and the span falls one cell per tick from y = 2 to the floor row y = size - 1.
    expected = { firstReactionTick: 4, spanOnFloorFrom: size };
  } else if (name === 'sealed' || name === 'vented') {
    initial = [...shell(size, name === 'vented'), ...fuelFill(size)];
    cells.pocket = [2, 2, 2];
    ticks = 40;
    expected = { firstReactionTick: 1 };
  } else if (name === 'uniform' || name === 'dormant') {
    // Every cell at one temperature: no heat flux, no movement, so every tile is locally quiet
    // under the M5 predicate. Above wood's flash point the fuel/oxidizer pair must still react on
    // the first tick, which only the reactive activity terms can keep awake; below it nothing
    // may happen and every tile must sleep.
    const thermal = name === 'uniform' ? 200 : 100;
    for (let z = 0; z < size; z++)
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) initial.push(place(x, y, z, MAT.AIR, thermal));
    initial.push(place(zc, zc, zc, MAT.WOOD, thermal), place(zc + 1, zc, zc, MAT.WOOD, thermal));
    initial.push(anchor(zc, zc, zc));
    cells.fuel = [zc, zc, zc];
    cells.fuelEnd = [zc + 1, zc, zc];
    ticks = 16;
    expected = name === 'uniform' ? { firstReactionTick: 1 } : { unchangedThrough: 16 };
  } else {
    // A water column held by a wax plug inside ceramic walls, so the copper rod is the only
    // effective heat path. A sustained source below copper's melting point melts the plug; a
    // ceramic segment in the same rod keeps the plug solid for the whole fixture.
    const walls: [number, number, number][] = [];
    for (let y = 1; y <= 3; y++)
      for (const [x, z] of [
        [3, zc],
        [5, zc],
        [4, zc - 1],
        [4, zc + 1],
      ])
        if (!(y === 3 && x === 3)) walls.push([x, y, z]);
    for (const [x, y, z] of walls)
      initial.push(place(x, y, z, THERMAL_MAT_3D.CERAMIC), anchor(x, y, z));
    initial.push(place(4, 1, zc, MAT.WATER), place(4, 2, zc, MAT.WATER));
    initial.push(place(4, 3, zc, THERMAL_MAT_3D.WAX));
    initial.push(place(1, 3, zc, THERMAL_MAT_3D.COPPER), anchor(1, 3, zc));
    initial.push(
      place(2, 3, zc, name === 'barrier' ? THERMAL_MAT_3D.CERAMIC : THERMAL_MAT_3D.COPPER),
      anchor(2, 3, zc),
    );
    initial.push(place(3, 3, zc, THERMAL_MAT_3D.COPPER), anchor(3, 3, zc));
    for (let t = 1; t <= 24; t++)
      scripted.set(t, [{ kind: 'energy', x: 1, y: 3, z: zc, energyQ: 115 * 256 }]);
    cells.source = [1, 3, zc];
    cells.plug = [4, 3, zc];
    cells.waterTop = [4, 1, zc];
    cells.waterBottom = [4, 2, zc];
    cells.cavity = [4, 4, zc];
    ticks = 48;
    expected =
      name === 'valve'
        ? { plugSolidThrough: 12, plugMeltsBy: 13, waterHeldThrough: 13, waterReleasedBy: 14 }
        : { plugSolidThrough: 48, waterHeldThrough: 48 };
  }
  return { name, size, chunkSize, initial, scripted, ticks, cells, expected };
}

type Coordinates = { grid: Uint32Array; energyQ: Uint32Array; structure: Uint32Array };
/** Feeds one complete tick at a time; check() throws on the first violated window. */
export function observeReactiveFixture3D(f: ReactiveFixture3D, initial: Coordinates) {
  const size = f.size,
    at = (c: [number, number, number]) => c[0] + size * (c[1] + size * c[2]),
    yOf = (i: number) => Math.floor(i / size) % size,
    start = {
      grid: initial.grid.slice(),
      energyQ: initial.energyQ.slice(),
      structure: initial.structure.slice(),
    };
  let firstReaction = -1,
    spanOnFloorFrom = -1,
    plugSolidThrough = 0,
    plugMelted = -1,
    waterHeldThrough = 0,
    waterReleased = -1,
    unchangedThrough = 0,
    last = 0;
  return {
    tick(tick: number, s: Coordinates) {
      if (tick !== last + 1) throw Error(`${f.name} ${size}: ticks must be observed in order`);
      last = tick;
      let ash = 0,
        spanOnFloor = true,
        waterHeld = true,
        unchanged = true;
      const water: number[] = [];
      for (let i = 0; i < s.grid.length; i++) {
        const m = s.grid[i] & 255;
        if (m === MAT.ASH) ash++;
        if (m === MAT.WOOD && f.cells.anchor && i !== at(f.cells.anchor) && yOf(i) !== size - 1)
          spanOnFloor = false;
        if (m === MAT.WATER) water.push(i);
        if (
          s.grid[i] !== start.grid[i] ||
          s.energyQ[i] !== start.energyQ[i] ||
          s.structure[i] !== start.structure[i]
        )
          unchanged = false;
      }
      if (ash && firstReaction < 0) firstReaction = tick;
      if (f.cells.anchor)
        spanOnFloorFrom = spanOnFloor ? (spanOnFloorFrom < 0 ? tick : spanOnFloorFrom) : -1;
      if (f.cells.plug) {
        const solid = (s.grid[at(f.cells.plug)] & 255) === THERMAL_MAT_3D.WAX;
        if (solid && plugSolidThrough === tick - 1) plugSolidThrough = tick;
        if (!solid && plugMelted < 0) plugMelted = tick;
        const held = [at(f.cells.waterTop), at(f.cells.waterBottom)].sort((a, b) => a - b);
        waterHeld = water.length === 2 && water[0] === held[0] && water[1] === held[1];
        if (waterHeld && waterHeldThrough === tick - 1) waterHeldThrough = tick;
        if (waterReleased < 0 && water.some((i) => yOf(i) >= 4)) waterReleased = tick;
      }
      if (unchanged && unchangedThrough === tick - 1) unchangedThrough = tick;
    },
    check() {
      const e = f.expected,
        label = `${f.name} ${size}^3`,
        fail = (what: string) => {
          throw Error(`${label}: ${what}`);
        };
      if (e.firstReactionTick !== undefined && firstReaction !== e.firstReactionTick)
        fail(`first reaction at tick ${firstReaction}, expected ${e.firstReactionTick}`);
      if (e.spanOnFloorFrom !== undefined && spanOnFloorFrom !== e.spanOnFloorFrom)
        fail(`span rests on the floor from tick ${spanOnFloorFrom}, expected ${e.spanOnFloorFrom}`);
      if (e.plugSolidThrough !== undefined && plugSolidThrough < e.plugSolidThrough)
        fail(`plug solid only through tick ${plugSolidThrough}, expected ${e.plugSolidThrough}`);
      if (e.plugMeltsBy !== undefined && (plugMelted < 0 || plugMelted > e.plugMeltsBy))
        fail(`plug melted at tick ${plugMelted}, expected by ${e.plugMeltsBy}`);
      if (e.waterHeldThrough !== undefined && waterHeldThrough < e.waterHeldThrough)
        fail(`water held only through tick ${waterHeldThrough}, expected ${e.waterHeldThrough}`);
      if (
        e.waterReleasedBy !== undefined &&
        (waterReleased < 0 || waterReleased > e.waterReleasedBy)
      )
        fail(`water released at tick ${waterReleased}, expected by ${e.waterReleasedBy}`);
      if (e.unchangedThrough !== undefined && unchangedThrough < e.unchangedThrough)
        fail(
          `state changed after tick ${unchangedThrough}, expected unchanged through ${e.unchangedThrough}`,
        );
      return {
        firstReaction,
        spanOnFloorFrom,
        plugSolidThrough,
        plugMelted,
        waterHeldThrough,
        waterReleased,
        unchangedThrough,
      };
    },
  };
}
