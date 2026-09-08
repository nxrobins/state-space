/** ca-v2 energy coordinate and integer thermodynamics. */
import * as C from './generated/materials.js';
import { checkedInteger, validatePackedCells } from './validation.js';
import { DEFAULT_REGISTRY, type MaterialRegistry } from './registry.js';

export const ENERGY_SCALE = 256;
export const MAX_ENERGY_Q = 0x3fffffff;
export interface PhysicsState { grid: Uint32Array; energyQ: Uint32Array }

const prop = (v: number, cold: Uint32Array, field: number) => cold[(v & 255) * C.COLD_STRIDE + field];

export function temperatureQ(voxel: number, energy: number, cold: Uint32Array): number {
  const heat = energy - prop(voxel, cold, C.COLD_FUEL_ENERGY) * ENERGY_SCALE;
  const phase = prop(voxel, cold, C.COLD_PHASE_ENERGY) * ENERGY_SCALE;
  let temperature = Math.max(0, heat - phase);
  const boil = prop(voxel, cold, C.COLD_BOILS_INTO);
  const up = boil || prop(voxel, cold, C.COLD_MELTS_INTO);
  const upTemperature = prop(voxel, cold, boil ? C.COLD_BOIL_POINT : C.COLD_MELT_POINT) * ENERGY_SCALE;
  const freeze = prop(voxel, cold, C.COLD_FREEZES_INTO);
  const down = freeze || prop(voxel, cold, C.COLD_CONDENSES_INTO);
  const downTemperature = prop(voxel, cold, freeze ? C.COLD_FREEZE_POINT : C.COLD_CONDENSE_POINT) * ENERGY_SCALE;
  if (up && heat >= phase + upTemperature) {
    temperature = Math.max(upTemperature, heat - prop(up, cold, C.COLD_PHASE_ENERGY) * ENERGY_SCALE);
  } else if (down && heat <= phase + downTemperature) {
    temperature = Math.min(downTemperature, Math.max(0, heat - prop(down, cold, C.COLD_PHASE_ENERGY) * ENERGY_SCALE));
  }
  return temperature;
}

export function thermalView(voxel: number, energy: number, cold: Uint32Array): number {
  return ((voxel & 0xffff00ff) | (Math.min(255, Math.floor(temperatureQ(voxel, energy, cold) / ENERGY_SCALE)) << 8)) >>> 0;
}

export function seedState(values: ArrayLike<number>, cold: Uint32Array = C.buildColdTable(), registry: MaterialRegistry = DEFAULT_REGISTRY): PhysicsState {
  const grid = validatePackedCells(values, values.length);
  const energyQ = new Uint32Array(grid.length);
  for (let i = 0; i < grid.length; i += 1) {
    const v = grid[i];
    if (!registry.has(v & 255)) throw new Error('Undefined material in initial state.');
    energyQ[i] = (((v >>> 8) & 255) + prop(v, cold, C.COLD_PHASE_ENERGY) + prop(v, cold, C.COLD_FUEL_ENERGY)) * ENERGY_SCALE;
    grid[i] = thermalView(v, energyQ[i], cold);
  }
  return { grid, energyQ };
}

export function validateEnergyState(cells: ArrayLike<number>, energies: ArrayLike<number>, length: number, cold: Uint32Array = C.buildColdTable(), registry: MaterialRegistry = DEFAULT_REGISTRY): PhysicsState {
  const grid = validatePackedCells(cells, length);
  const energyQ = validatePackedCells(energies, length);
  for (let i = 0; i < length; i += 1) {
    const v = grid[i];
    if (!registry.has(v & 255)) throw new Error('Undefined material in simulation state.');
    checkedInteger(energyQ[i], prop(v, cold, C.COLD_FUEL_ENERGY) * ENERGY_SCALE, MAX_ENERGY_Q, `energyQ[${i}]`);
    if (thermalView(v, energyQ[i], cold) !== v) throw new Error('Packed thermal view disagrees with conserved energy.');
  }
  return { grid, energyQ };
}

export function exchangeEnergy(a: number, b: number, ea: number, eb: number, cold: Uint32Array): [number, number] {
  const ta = temperatureQ(a, ea, cold), tb = temperatureQ(b, eb, cold);
  const ca = prop(a, cold, C.COLD_CONDUCTIVITY), cb = prop(b, cold, C.COLD_CONDUCTIVITY);
  const k = ca + cb ? Math.floor(2 * ca * cb / (ca + cb)) : 0;
  const difference = Math.abs(ta - tb);
  let flux = Math.floor(difference / 512) * k + Math.floor(((difference % 512) * k + 511) / 512);
  flux = Math.min(flux, Math.floor(difference / 2));
  if (ta > tb) {
    flux = Math.min(flux, ea - prop(a, cold, C.COLD_FUEL_ENERGY) * ENERGY_SCALE, MAX_ENERGY_Q - eb);
    return [ea - flux, eb + flux];
  }
  flux = Math.min(flux, eb - prop(b, cold, C.COLD_FUEL_ENERGY) * ENERGY_SCALE, MAX_ENERGY_Q - ea);
  return [ea + flux, eb - flux];
}

export function phaseMaterial(v: number, energy: number, cold: Uint32Array): number {
  const chemical = prop(v, cold, C.COLD_FUEL_ENERGY) * ENERGY_SCALE;
  const boil = prop(v, cold, C.COLD_BOILS_INTO);
  const up = boil || prop(v, cold, C.COLD_MELTS_INTO);
  if (up) {
    const boundary = chemical + (prop(up, cold, C.COLD_PHASE_ENERGY) + prop(v, cold, boil ? C.COLD_BOIL_POINT : C.COLD_MELT_POINT)) * ENERGY_SCALE;
    if (energy >= boundary) return up;
  }
  const freeze = prop(v, cold, C.COLD_FREEZES_INTO);
  const down = freeze || prop(v, cold, C.COLD_CONDENSES_INTO);
  if (down) {
    const boundary = chemical + (prop(down, cold, C.COLD_PHASE_ENERGY) + prop(v, cold, freeze ? C.COLD_FREEZE_POINT : C.COLD_CONDENSE_POINT)) * ENERGY_SCALE;
    if (energy <= boundary) return down;
  }
  return v & 255;
}

export function rewriteMaterial(voxel: number, material: number, energy: number, cold: Uint32Array): number {
  const packed = ((voxel & 0xf0ff0000) | material | (prop(material, cold, C.COLD_DEFAULT_PHASE) << C.PHASE_SHIFT)) >>> 0;
  return thermalView(packed, energy, cold);
}

export function energyLedger(state: PhysicsState, cold: Uint32Array = C.buildColdTable()) {
  let sensibleQ = 0n, latentQ = 0n, chemicalQ = 0n;
  for (let i = 0; i < state.grid.length; i += 1) {
    const chemical = prop(state.grid[i], cold, C.COLD_FUEL_ENERGY) * ENERGY_SCALE;
    const sensible = temperatureQ(state.grid[i], state.energyQ[i], cold);
    sensibleQ += BigInt(sensible);
    chemicalQ += BigInt(chemical);
    latentQ += BigInt(state.energyQ[i] - chemical - sensible);
  }
  return { sensibleQ, latentQ, chemicalQ, totalQ: sensibleQ + latentQ + chemicalQ };
}

export function cloneState(state: PhysicsState): PhysicsState {
  return { grid: state.grid.slice(), energyQ: state.energyQ.slice() };
}
