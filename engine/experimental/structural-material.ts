/** M5 local material schedule. Frozen M1 ordering, with mechanical ownership. ca-3d-m6 adds one combustion pass. */
import {
  MAT,
  PHASE,
  PHASE_SHIFT,
  COLD_STRIDE,
  COLD_DENSITY,
  COLD_FUEL_ENERGY,
  COLD_FLASH_POINT,
  COLD_OXIDIZER,
  COLD_BURNS_INTO,
  COLD_SMOKE_PRODUCT,
} from '../generated/materials.js';
import {
  temperatureQ,
  exchangeEnergy,
  thermalView,
  phaseMaterial,
  rewriteMaterial,
  ENERGY_SCALE,
  MAX_ENERGY_Q,
} from '../thermal.js';
import type { VolumePass } from './3d-core.js';
import type { ProvenancePass3D } from './motion-trace.js';
import {
  structuralEligible,
  DEFAULT_STRUCTURAL_COLD_3D,
  INTEGRITY_3D,
  ANCHOR_3D,
  FRESH_3D,
  type StructuralState3D,
} from './structural-mechanics.js';
import type { StructuralPass3D } from './structural/structural-law.js';
const material = (v: number) => v & 255;
const phase = (v: number) => (v >>> PHASE_SHIFT) & 15;
const liquid = (v: number) =>
  phase(v) === PHASE.LIQUID || phase(v) === PHASE.VISCOUS || phase(v) === PHASE.MOLTEN;
const gas = (v: number) => phase(v) === PHASE.GAS;
function choice(index: number, axis: number, tick: number): boolean {
  let h =
    (Math.imul(index, 374761393) +
      Math.imul(axis, 668265263) +
      Math.imul(tick >>> 0, 1442695041)) >>>
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) & 1) === 0;
}
/** Six neighbors of i in -X,+X,-Y,+Y,-Z,+Z order, -1 at a closed boundary; returns x + 2y + 3z. */
function neighborsOf(around: Int32Array, i: number, w: number, h: number, d: number): number {
  const layer = w * h,
    x = i % w,
    y = Math.floor(i / w) % h,
    z = Math.floor(i / layer);
  around[0] = x ? i - 1 : -1;
  around[1] = x + 1 < w ? i + 1 : -1;
  around[2] = y ? i - w : -1;
  around[3] = y + 1 < h ? i + w : -1;
  around[4] = z ? i - layer : -1;
  around[5] = z + 1 < d ? i + layer : -1;
  return x + 2 * y + 3 * z;
}

/** ca-3d-m6 combustion: deterministic mutual fuel/oxidizer pairing over six neighbors.
 * At cell (x,y,z) the direction order starts at (x + 2y + 3z + u32(tick) % 6) % 6, the tick word
 * every backend sees. A fuel above its
 * flash temperature proposes to its first oxidizer; an oxidizer accepts its first proposer. Only
 * mutual pairs react: the fuel becomes burns_into, the oxidizer smoke_product, and
 * min(floor(fuel_energy * 256 / 2), MAX_ENERGY_Q - oxidizer energy) moves to the oxidizer. Builtin
 * fire without adjacent fuel, next to builtin water, or below 80 temperature units becomes smoke.
 * Each cell's result depends only on its own role, so every backend evaluates it independently.
 * Products that are cohesive solids seed integrity 255 with the fresh marker, as M5 solidification does.
 */
function combustion(
  input: StructuralState3D,
  output: StructuralState3D,
  w: number,
  h: number,
  d: number,
  tick: number,
  cold: Uint32Array,
): void {
  const aGrid = input.grid,
    aEnergy = input.energyQ,
    bGrid = output.grid,
    bEnergy = output.energyQ,
    n = aGrid.length;
  const at = (v: number) => (v & 255) * COLD_STRIDE;
  const fuelQ = (v: number) => cold[at(v) + COLD_FUEL_ENERGY] * ENERGY_SCALE;
  const oxidizer = (v: number) => cold[at(v) + COLD_OXIDIZER] === 1;
  const burning = (i: number) =>
    fuelQ(aGrid[i]) > 0 &&
    temperatureQ(aGrid[i], aEnergy[i], cold) > cold[at(aGrid[i]) + COLD_FLASH_POINT] * ENERGY_SCALE;
  const rotation = (tick >>> 0) % 6,
    around = new Int32Array(6);
  // proposed[i] = j + 1 and chosen[j] = i + 1; zero means none. Only proposed oxidizers choose.
  const proposed = new Int32Array(n),
    chosen = new Int32Array(n),
    wanted: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!burning(i)) continue;
    const offset = (neighborsOf(around, i, w, h, d) + rotation) % 6;
    for (let k = 0; k < 6; k++) {
      const j = around[(offset + k) % 6];
      if (j >= 0 && oxidizer(aGrid[j])) {
        proposed[i] = j + 1;
        if (chosen[j] === 0) {
          chosen[j] = -1;
          wanted.push(j);
        }
        break;
      }
    }
  }
  for (const j of wanted) {
    const offset = (neighborsOf(around, j, w, h, d) + rotation) % 6;
    chosen[j] = 0;
    for (let k = 0; k < 6; k++) {
      const i = around[(offset + k) % 6];
      if (i >= 0 && proposed[i] === j + 1) {
        chosen[j] = i + 1;
        break;
      }
    }
  }
  const product = (i: number, next: number, energyQ: number) => {
    bEnergy[i] = energyQ;
    bGrid[i] = rewriteMaterial(aGrid[i], next, energyQ, cold);
    output.structure[i] = structuralEligible(bGrid[i], cold) ? INTEGRITY_3D | FRESH_3D : 0;
  };
  for (let i = 0; i < n; i++) {
    const v = aGrid[i],
      j = proposed[i] - 1;
    if (j >= 0 && chosen[j] === i + 1) {
      const transfer = Math.min(Math.floor(fuelQ(v) / 2), MAX_ENERGY_Q - aEnergy[j]);
      product(i, cold[at(v) + COLD_BURNS_INTO], aEnergy[i] - transfer);
    } else if (chosen[i] > 0) {
      const fuel = aGrid[chosen[i] - 1],
        transfer = Math.min(Math.floor(fuelQ(fuel) / 2), MAX_ENERGY_Q - aEnergy[i]);
      product(i, cold[at(fuel) + COLD_SMOKE_PRODUCT], aEnergy[i] + transfer);
    } else if (material(v) === MAT.FIRE) {
      neighborsOf(around, i, w, h, d);
      let nearFuel = false,
        nearWater = false;
      for (let dir = 0; dir < 6; dir++) {
        const k = around[dir];
        if (k < 0) continue;
        if (fuelQ(aGrid[k]) > 0) nearFuel = true;
        if (material(aGrid[k]) === MAT.WATER) nearWater = true;
      }
      if (!nearFuel || nearWater || temperatureQ(v, aEnergy[i], cold) < 80 * ENERGY_SCALE)
        product(i, MAT.SMOKE, aEnergy[i]);
    }
  }
}

export function executeStructuralMaterialPass(input: StructuralState3D, output: StructuralState3D, w: number, h: number, d: number, tick: number, pass: StructuralPass3D, provenance?: ProvenancePass3D, cold: Uint32Array = DEFAULT_STRUCTURAL_COLD_3D): void {
  const aGrid = input.grid, aEnergy = input.energyQ, bGrid = output.grid, bEnergy = output.energyQ;
  bGrid.set(aGrid); bEnergy.set(aEnergy); output.structure.set(input.structure);
  if (provenance) provenance.output.set(provenance.input);
  if (pass.kind === 'combustion') {
    combustion(input, output, w, h, d, tick, cold);
    return;
  }
  const layer = w * h;
  const density = (v: number) => cold[material(v) * COLD_STRIDE + COLD_DENSITY];
  const falling = (v: number) => phase(v) === PHASE.POWDER || liquid(v) || structuralEligible(v, cold);
  const bound = (index: number) => (input.structure[index] & (INTEGRITY_3D | ANCHOR_3D)) !== 0;
  const canFall = (source: number, target: number) => falling(aGrid[source]) && !bound(source) && !bound(target) && density(aGrid[source]) > density(aGrid[target]);
  const gasRank = (i: number) => Math.floor(temperatureQ(aGrid[i], aEnergy[i], cold) / 256) * 2 - density(aGrid[i]);
  const canRise = (s: number, t: number) => material(aGrid[s]) !== MAT.AIR && gas(aGrid[s]) && gas(aGrid[t]) && gasRank(s) > gasRank(t) + 16;
  const swap = (s: number, t: number) => { bGrid[s] = aGrid[t]; bGrid[t] = aGrid[s]; bEnergy[s] = aEnergy[t]; bEnergy[t] = aEnergy[s]; output.structure[s] = input.structure[t]; output.structure[t] = input.structure[s];
    if (provenance) {
      provenance.output[s] = provenance.input[t]; provenance.output[t] = provenance.input[s];
      provenance.touched[provenance.input[s]] = 1; provenance.touched[provenance.input[t]] = 1;
      provenance.pathSwap?.(s, t, provenance.input[s], provenance.input[t]);
    }
  };
  const hasFall = (i: number, x: number, y: number, z: number) => y + 1 < h && (
    canFall(i, i + w) || (x > 0 && canFall(i, i + w - 1)) || (x + 1 < w && canFall(i, i + w + 1)) ||
    (z > 0 && canFall(i, i + w - layer)) || (z + 1 < d && canFall(i, i + w + layer)));
  if (pass.kind === 'phase') {
    for (let i = 0; i < aGrid.length; i++) {
      const next = phaseMaterial(aGrid[i], aEnergy[i], cold);
      if (next !== material(aGrid[i])) {
        bGrid[i] = rewriteMaterial(aGrid[i], next, aEnergy[i], cold);
        output.structure[i] = structuralEligible(bGrid[i], cold) ? INTEGRITY_3D | FRESH_3D : 0;
      }
    }
    return;
  }
  const move: VolumePass = pass;
  const vertical = ['gravity', 'diagonal', 'buoyancy'].includes(move.kind);
  const pairAxis = vertical ? 1 : move.axis;
  for (let z = pairAxis === 2 ? move.parity : 0; z < d; z += pairAxis === 2 ? 2 : 1) {
    for (let y = pairAxis === 1 ? move.parity : 0; y < h; y += pairAxis === 1 ? 2 : 1) {
      for (let x = pairAxis === 0 ? move.parity : 0; x < w; x += pairAxis === 0 ? 2 : 1) {
        let tx = x + (pairAxis === 0 ? 1 : 0), ty = y + (pairAxis === 1 ? 1 : 0), tz = z + (pairAxis === 2 ? 1 : 0);
        if (move.kind === 'diagonal') { tx += move.axis === 0 ? move.direction : 0; tz += move.axis === 2 ? move.direction : 0; }
        if (tx < 0 || tx >= w || ty >= h || tz < 0 || tz >= d) continue;
        const a = x + w * (y + h * z), b = tx + w * (ty + h * tz);
        if (move.kind === 'gravity') { if (canFall(a, b)) swap(a, b); }
        else if (move.kind === 'diagonal') { if (!canFall(a, a + w) && canFall(a, b)) swap(a, b); }
        else if (move.kind === 'buoyancy') { if (canRise(b, a)) swap(a, b); }
        else if (move.kind === 'liquid') {
          const spread = (s: number, t: number) => liquid(aGrid[s]) && gas(aGrid[t]) && density(aGrid[s]) > density(aGrid[t]);
          if ((spread(a, b) && !hasFall(a, x, y, z)) || (spread(b, a) && !hasFall(b, tx, ty, tz))) swap(a, b);
        } else if (move.kind === 'gas') {
          const [s, t, sy] = choice(a, move.axis, tick) ? [a, b, y] : [b, a, ty];
          if (material(aGrid[s]) !== MAT.AIR && gas(aGrid[s]) && gas(aGrid[t]) && (sy === 0 || !canRise(s, s - w)) &&
            (material(aGrid[t]) === MAT.AIR || gasRank(s) > gasRank(t) + 16)) swap(s, t);
        } else if (move.kind === 'heat') {
          if (material(aGrid[a]) === material(aGrid[b]) && aEnergy[a] === aEnergy[b]) continue;
          [bEnergy[a], bEnergy[b]] = exchangeEnergy(aGrid[a], aGrid[b], aEnergy[a], aEnergy[b], cold);
          bGrid[a] = thermalView(aGrid[a], bEnergy[a], cold); bGrid[b] = thermalView(aGrid[b], bEnergy[b], cold);
        }
      }
    }
  }
}
