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
    ticks = 48;
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
  } else if (name === 'sealed' || name === 'vented') {
    initial = [...shell(size, name === 'vented'), ...fuelFill(size)];
    cells.pocket = [2, 2, 2];
    ticks = 40;
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
  }
  return { name, size, chunkSize, initial, scripted, ticks, cells };
}
