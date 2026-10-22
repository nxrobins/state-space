/** Conservative local movement with profile-owned materials and mechanical boundaries. */
import {
  MAT,
  PHASE,
  PHASE_SHIFT,
  COLD_STRIDE,
  COLD_COHESION,
  COLD_DENSITY,
} from '../../generated/materials.js';
import { temperatureQ } from '../../thermal.js';
import { INTEGRITY_3D, ANCHOR_3D } from '../structural-mechanics.js';
import { readReactiveMaterialBlock3D, type ReactiveMaterialBlock3D } from './reactive-block.js';
import {
  reactiveRegistrySource3D,
  reactiveInteger3D,
  type ReactiveMaterialRegistry3D,
} from './reactive-registry.js';

export const REACTIVE_MOVEMENT_RULES_3D = 'reactive-movement-1';
export type ReactiveMovementPass3D = {
  kind: 'gravity' | 'diagonal' | 'liquid' | 'buoyancy' | 'gas';
  axis: number;
  parity: number;
  direction: number;
};
export function reactiveMovementSchedule3D(
  tick: number,
): readonly Readonly<ReactiveMovementPass3D>[] {
  reactiveInteger3D(tick, 0, Number.MAX_SAFE_INTEGER);
  const passes: ReactiveMovementPass3D[] = [];
  const pairs = (kind: ReactiveMovementPass3D['kind'], axis: number, direction = 1) => {
    for (const parity of [0, 1]) passes.push({ kind, axis, parity, direction });
  };
  pairs('gravity', 1);
  const directions = [
    [0, 1],
    [0, -1],
    [2, 1],
    [2, -1],
  ];
  for (let k = 0; k < 4; k++) {
    const [axis, direction] = directions[(k + (tick % 4)) % 4];
    pairs('diagonal', axis, direction);
  }
  const axes = tick % 2 ? [2, 0] : [0, 2];
  for (const axis of axes) pairs('liquid', axis);
  pairs('buoyancy', 1);
  for (const axis of axes) pairs('gas', axis);
  return Object.freeze(passes.map((p) => Object.freeze(p)));
}
function choice(index: number, axis: number, tick: number): boolean {
  let h =
    (Math.imul(index, 374761393) +
      Math.imul(axis, 668265263) +
      Math.imul(tick >>> 0, 1442695041)) >>>
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) & 1) === 0;
}
/** Per-cell movement classes of one immutable block. A swap carries a cell's class with it. */
const FALLING = 1,
  BOUND = 2,
  GASEOUS = 4,
  FLUID = 8,
  AIRY = 16;
/** Per-cell classes plus, per x-row (fixed y and z), how many cells can start a fall, spread as a fluid,
 * or move as a non-air gas. A pass skips every row pair that these counts prove no rule can swap.
 */
export type ReactiveMovementClasses3D = {
  classes: Uint8Array;
  rowFalling: Uint16Array;
  rowFluid: Uint16Array;
  rowGas: Uint16Array;
};
export function classifyReactiveMovement3D(
  cells: readonly number[],
  structure: readonly number[],
  cold: Uint32Array,
  width: number,
): ReactiveMovementClasses3D {
  const classes = new Uint8Array(cells.length),
    rows = Math.ceil(cells.length / width);
  const rowFalling = new Uint16Array(rows),
    rowFluid = new Uint16Array(rows),
    rowGas = new Uint16Array(rows);
  for (let i = 0, x = 0, row = 0; i < cells.length; i++) {
    const word = cells[i],
      p = (word >>> PHASE_SHIFT) & 15;
    let c = 0;
    if (p === PHASE.SOLID || p === PHASE.FROZEN) {
      const cohesive = cold[(word & 255) * COLD_STRIDE + COLD_COHESION] > 0;
      c =
        (cohesive ? FALLING : 0) |
        (!cohesive || (structure[i] & (INTEGRITY_3D | ANCHOR_3D)) !== 0 ? BOUND : 0);
    } else if (p === PHASE.POWDER) c = FALLING;
    else if (p === PHASE.LIQUID || p === PHASE.VISCOUS || p === PHASE.MOLTEN) c = FALLING | FLUID;
    else if (p === PHASE.GAS) c = (word & 255) === MAT.AIR ? GASEOUS | AIRY : GASEOUS;
    classes[i] = c;
    if (c & FALLING) rowFalling[row]++;
    if (c & FLUID) rowFluid[row]++;
    if ((c & (GASEOUS | AIRY)) === GASEOUS) rowGas[row]++;
    if (++x === width) {
      x = 0;
      row++;
    }
  }
  return { classes, rowFalling, rowFluid, rowGas };
}
const KIND = Object.freeze({ gravity: 0, diagonal: 1, buoyancy: 2, liquid: 3, gas: 4 });
export type ReactiveMovementOutput3D = {
  block: ReactiveMaterialBlock3D;
  classes: ReactiveMovementClasses3D;
};

/** Trusted internal pass. The public wrappers validate input and select the frozen schedule.
 * Pairs that no rule can swap are skipped before any rule runs; the visiting order never changes.
 * A pass that moves nothing shares the input arrays; otherwise they are copied once, after the scan.
 * `inputClasses`, when given, must describe `input`; the returned classes describe the returned block.
 * With `owned`, the input arrays and classes belong to the caller and are swapped in place after the scan.
 */
export function executeReactiveMovementPass3D(
  input: ReactiveMaterialBlock3D,
  cold: Uint32Array,
  tick: number,
  pass: Readonly<ReactiveMovementPass3D>,
  onSwap: (a: number, b: number) => void,
  inputClasses?: ReactiveMovementClasses3D,
  owned = false,
): ReactiveMovementOutput3D {
  const { width: w, height: h, depth: d } = input,
    layer = w * h,
    cells = input.packedCells,
    energy = input.energyQ,
    structure = input.structure;
  if (
    inputClasses &&
    (inputClasses.classes.length !== cells.length ||
      inputClasses.rowFalling.length !== h * d ||
      inputClasses.rowFluid.length !== h * d ||
      inputClasses.rowGas.length !== h * d)
  )
    throw Error('Reactive movement classes do not match the block.');
  const state = inputClasses ?? classifyReactiveMovement3D(cells, structure, cold, w),
    classes = state.classes,
    rowFalling = state.rowFalling,
    rowFluid = state.rowFluid,
    rowGas = state.rowGas;
  let outCells = cells,
    outEnergy = energy,
    outStructure = structure,
    outState = state;
  const falling = (i: number) => (classes[i] & FALLING) !== 0;
  const bound = (i: number) => (classes[i] & BOUND) !== 0;
  const density = (i: number) => cold[(cells[i] & 255) * COLD_STRIDE + COLD_DENSITY];
  const canFall = (source: number, target: number) =>
    falling(source) && !bound(source) && !bound(target) && density(source) > density(target);
  const rank = (i: number) =>
    Math.floor(temperatureQ(cells[i], energy[i], cold) / 256) * 2 - density(i);
  const canRise = (a: number, b: number) =>
    (classes[a] & (GASEOUS | AIRY)) === GASEOUS &&
    (classes[b] & GASEOUS) !== 0 &&
    rank(a) > rank(b) + 16;
  const hasFall = (i: number, x: number, y: number, z: number) =>
    y + 1 < h &&
    (canFall(i, i + w) ||
      (x > 0 && canFall(i, i + w - 1)) ||
      (x + 1 < w && canFall(i, i + w + 1)) ||
      (z > 0 && canFall(i, i + w - layer)) ||
      (z + 1 < d && canFall(i, i + w + layer)));
  const spread = (s: number, t: number) =>
    (classes[s] & FLUID) !== 0 && (classes[t] & GASEOUS) !== 0 && density(s) > density(t);
  // Every rule reads the pass input only, so the disjoint swaps of a pass are applied after the scan.
  // `onSwap` therefore always observes the intact input of the pass.
  const pairs: number[] = [];
  const swap = (a: number, b: number) => {
    pairs.push(a, b);
    onSwap(a, b);
  };
  // Pair geometry: vertical pairs for gravity, diagonal and buoyancy; axis pairs for liquid and gas. Bounds are hoisted into the ranges.
  const kind = KIND[pass.kind],
    pairAxis = kind <= KIND.buoyancy ? 1 : pass.axis;
  const dx = kind === KIND.diagonal && pass.axis === 0 ? pass.direction : 0,
    dz = kind === KIND.diagonal && pass.axis === 2 ? pass.direction : 0;
  const offset = (pairAxis === 0 ? 1 : pairAxis === 1 ? w : layer) + dx + dz * layer;
  const z0 = pairAxis === 2 ? pass.parity : dz < 0 ? 1 : 0,
    z1 = pairAxis === 2 || dz > 0 ? d - 1 : d,
    zStep = pairAxis === 2 ? 2 : 1;
  const y0 = pairAxis === 1 ? pass.parity : 0,
    y1 = pairAxis === 1 ? h - 1 : h,
    yStep = pairAxis === 1 ? 2 : 1;
  const x0 = pairAxis === 0 ? pass.parity : dx < 0 ? 1 : 0,
    x1 = pairAxis === 0 || dx > 0 ? w - 1 : w,
    xStep = pairAxis === 0 ? 2 : 1;
  // Row skipping: a row pair whose counts show no possible source or target is skipped as a whole,
  // which never changes the visiting order of the pairs that remain.
  const rowOffset = pairAxis === 1 ? 1 : pairAxis === 2 ? h : 0;
  for (let z = z0; z < z1; z += zStep)
    for (let y = y0; y < y1; y += yStep) {
      const row = y + h * z;
      if (kind <= KIND.diagonal) {
        if (rowFalling[row] === 0) continue;
      } else if (kind === KIND.buoyancy) {
        if (rowGas[row + 1] === 0) continue;
      } else if (kind === KIND.liquid) {
        if (rowFluid[row] === 0 && rowFluid[row + rowOffset] === 0) continue;
      } else if (rowGas[row] === 0 && rowGas[row + rowOffset] === 0) continue;
      for (let x = x0, a = x0 + w * (y + h * z); x < x1; x += xStep, a += xStep) {
        const b = a + offset,
          ca = classes[a],
          cb = classes[b];
        switch (kind) {
          case KIND.gravity:
            if ((ca & FALLING) !== 0 && canFall(a, b)) swap(a, b);
            break;
          case KIND.diagonal:
            if ((ca & FALLING) !== 0 && !canFall(a, a + w) && canFall(a, b)) swap(a, b);
            break;
          case KIND.buoyancy:
            if (canRise(b, a)) swap(a, b);
            break;
          case KIND.liquid: {
            if (((ca | cb) & FLUID) === 0) break;
            const tx = pairAxis === 0 ? x + 1 : x,
              tz = pairAxis === 2 ? z + 1 : z;
            if ((spread(a, b) && !hasFall(a, x, y, z)) || (spread(b, a) && !hasFall(b, tx, y, tz)))
              swap(a, b);
            break;
          }
          default: {
            if ((ca & cb & GASEOUS) === 0 || (ca & cb & AIRY) !== 0) break;
            const first = choice(a, pass.axis, tick),
              s = first ? a : b,
              t = first ? b : a;
            if (
              (classes[s] & AIRY) === 0 &&
              (y === 0 || !canRise(s, s - w)) &&
              ((classes[t] & AIRY) !== 0 || rank(s) > rank(t) + 16)
            )
              swap(s, t);
          }
        }
      }
    }
  if (pairs.length) {
    if (!owned) {
      outCells = cells.slice();
      outEnergy = energy.slice();
      outStructure = structure.slice();
      outState = {
        classes: classes.slice(),
        rowFalling: rowFalling.slice(),
        rowFluid: rowFluid.slice(),
        rowGas: rowGas.slice(),
      };
    }
    const outClasses = outState.classes;
    for (let k = 0; k < pairs.length; k += 2) {
      const a = pairs[k],
        b = pairs[k + 1];
      const c = outCells[a],
        e = outEnergy[a],
        s = outStructure[a],
        ma = outClasses[a],
        mb = outClasses[b];
      outCells[a] = outCells[b];
      outCells[b] = c;
      outEnergy[a] = outEnergy[b];
      outEnergy[b] = e;
      outStructure[a] = outStructure[b];
      outStructure[b] = s;
      outClasses[a] = mb;
      outClasses[b] = ma;
      const rowA = (a / w) | 0,
        rowB = (b / w) | 0;
      if (rowA !== rowB) {
        const fall = ((mb & FALLING) !== 0 ? 1 : 0) - ((ma & FALLING) !== 0 ? 1 : 0),
          fluid = ((mb & FLUID) !== 0 ? 1 : 0) - ((ma & FLUID) !== 0 ? 1 : 0),
          gas =
            ((mb & (GASEOUS | AIRY)) === GASEOUS ? 1 : 0) -
            ((ma & (GASEOUS | AIRY)) === GASEOUS ? 1 : 0);
        outState.rowFalling[rowA] += fall;
        outState.rowFalling[rowB] -= fall;
        outState.rowFluid[rowA] += fluid;
        outState.rowFluid[rowB] -= fluid;
        outState.rowGas[rowA] += gas;
        outState.rowGas[rowB] -= gas;
      }
    }
  }
  return {
    block:
      outCells === cells
        ? { ...input }
        : { ...input, packedCells: outCells, energyQ: outEnergy, structure: outStructure },
    classes: outState,
  };
}
/** Diagnostic single pass, selected by index; not a complete evolution tick. */
export function runReactiveMovementPass3D(
  registry: ReactiveMaterialRegistry3D,
  raw: ReactiveMaterialBlock3D,
  tick: number,
  passIndex: number,
) {
  const schedule = reactiveMovementSchedule3D(tick);
  reactiveInteger3D(passIndex, 0, schedule.length - 1);
  const input = readReactiveMaterialBlock3D(registry, raw),
    swaps: [number, number][] = [];
  const { block } = executeReactiveMovementPass3D(
    input,
    reactiveRegistrySource3D(registry).cold,
    tick,
    schedule[passIndex],
    (a, b) => swaps.push([a, b]),
  );
  return {
    rulesVersion: REACTIVE_MOVEMENT_RULES_3D,
    tick,
    passIndex,
    pass: { ...schedule[passIndex] },
    swaps,
    block: readReactiveMaterialBlock3D(registry, block),
  };
}
