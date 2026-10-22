/** Per-registry material constants for the reactive thermal and structural kernels. */
import {
  PHASE,
  COLD_STRIDE,
  COLD_DENSITY,
  COLD_CONDUCTIVITY,
  COLD_MELT_POINT,
  COLD_BOIL_POINT,
  COLD_FLASH_POINT,
  COLD_FREEZE_POINT,
  COLD_CONDENSE_POINT,
  COLD_MELTS_INTO,
  COLD_BOILS_INTO,
  COLD_FREEZES_INTO,
  COLD_CONDENSES_INTO,
  COLD_FUEL_ENERGY,
  COLD_BURNS_INTO,
  COLD_SMOKE_PRODUCT,
  COLD_PHASE_ENERGY,
  COLD_DEFAULT_PHASE,
  COLD_OXIDIZER,
  COLD_COHESION,
} from '../../generated/materials.js';
import { ENERGY_SCALE } from '../../thermal.js';
import { reactiveRegistrySource3D, type ReactiveMaterialRegistry3D } from './reactive-registry.js';

/** 256 entries per field, indexed by material id. Internal only: consumers never write them.
 * Every *Q field is the same float64 product thermal.ts forms inline (property * ENERGY_SCALE),
 * so each is an exact integer and sums of three stay exact.
 */
export type ReactiveThermalTables3D = Readonly<{
  /** Membership in the source MaterialRegistry, which validateEnergyState consults. */
  sourceKnown: Uint8Array;
  /** Membership in the reactive registry. */
  known: Uint8Array;
  defaultPhase: Uint8Array;
  cohesion: Uint8Array;
  density: Uint8Array;
  conductivity: Uint8Array;
  fuelQ: Float64Array;
  phaseQ: Float64Array;
  flashQ: Float64Array;
  oxidizer: Uint8Array;
  burnsInto: Uint8Array;
  smokeProduct: Uint8Array;
  up: Uint8Array;
  upQ: Float64Array;
  upPhaseQ: Float64Array;
  down: Uint8Array;
  downQ: Float64Array;
  downPhaseQ: Float64Array;
  upBoundary: Float64Array;
  downBoundary: Float64Array;
  transitions: Uint8Array;
  /** Structural eligibility of a cell whose phase nibble equals defaultPhase. */
  eligibleById: Uint8Array;
}>;
const thermalTables = new WeakMap<ReactiveMaterialRegistry3D, ReactiveThermalTables3D>();
/** Registries are frozen and their zeroed-inactive cold copy never changes: one build each. */
export function reactiveThermalTables3D(
  registry: ReactiveMaterialRegistry3D,
): ReactiveThermalTables3D {
  let tables = thermalTables.get(registry);
  if (tables) return tables;
  const { cold, registry: sourceRegistry } = reactiveRegistrySource3D(registry);
  const bytes = () => new Uint8Array(256),
    quanta = () => new Float64Array(256);
  const sourceKnown = bytes(),
    known = bytes(),
    defaultPhase = bytes(),
    cohesion = bytes(),
    density = bytes(),
    conductivity = bytes(),
    fuelQ = quanta(),
    phaseQ = quanta(),
    flashQ = quanta(),
    oxidizer = bytes(),
    burnsInto = bytes(),
    smokeProduct = bytes(),
    up = bytes(),
    upQ = quanta(),
    upPhaseQ = quanta(),
    down = bytes(),
    downQ = quanta(),
    downPhaseQ = quanta(),
    upBoundary = quanta(),
    downBoundary = quanta(),
    transitions = bytes(),
    eligibleById = bytes();
  for (let id = 0; id < 256; id++) {
    const at = id * COLD_STRIDE;
    sourceKnown[id] = sourceRegistry.has(id) ? 1 : 0;
    known[id] = registry.has(id) ? 1 : 0;
    defaultPhase[id] = cold[at + COLD_DEFAULT_PHASE];
    cohesion[id] = cold[at + COLD_COHESION];
    density[id] = cold[at + COLD_DENSITY];
    conductivity[id] = cold[at + COLD_CONDUCTIVITY];
    fuelQ[id] = cold[at + COLD_FUEL_ENERGY] * ENERGY_SCALE;
    phaseQ[id] = cold[at + COLD_PHASE_ENERGY] * ENERGY_SCALE;
    flashQ[id] = cold[at + COLD_FLASH_POINT] * ENERGY_SCALE;
    oxidizer[id] = cold[at + COLD_OXIDIZER];
    burnsInto[id] = cold[at + COLD_BURNS_INTO];
    smokeProduct[id] = cold[at + COLD_SMOKE_PRODUCT];
    const boil = cold[at + COLD_BOILS_INTO];
    up[id] = boil || cold[at + COLD_MELTS_INTO];
    upQ[id] = cold[at + (boil ? COLD_BOIL_POINT : COLD_MELT_POINT)] * ENERGY_SCALE;
    upPhaseQ[id] = cold[up[id] * COLD_STRIDE + COLD_PHASE_ENERGY] * ENERGY_SCALE;
    const freeze = cold[at + COLD_FREEZES_INTO];
    down[id] = freeze || cold[at + COLD_CONDENSES_INTO];
    downQ[id] = cold[at + (freeze ? COLD_FREEZE_POINT : COLD_CONDENSE_POINT)] * ENERGY_SCALE;
    downPhaseQ[id] = cold[down[id] * COLD_STRIDE + COLD_PHASE_ENERGY] * ENERGY_SCALE;
    upBoundary[id] = fuelQ[id] + upPhaseQ[id] + upQ[id];
    downBoundary[id] = fuelQ[id] + downPhaseQ[id] + downQ[id];
    transitions[id] = up[id] || down[id] ? 1 : 0;
    eligibleById[id] =
      known[id] &&
      (defaultPhase[id] === PHASE.SOLID || defaultPhase[id] === PHASE.FROZEN) &&
      cohesion[id] > 0
        ? 1
        : 0;
  }
  tables = Object.freeze({
    sourceKnown,
    known,
    defaultPhase,
    cohesion,
    density,
    conductivity,
    fuelQ,
    phaseQ,
    flashQ,
    oxidizer,
    burnsInto,
    smokeProduct,
    up,
    upQ,
    upPhaseQ,
    down,
    downQ,
    downPhaseQ,
    upBoundary,
    downBoundary,
    transitions,
    eligibleById,
  });
  thermalTables.set(registry, tables);
  return tables;
}
/** thermal.ts temperatureQ with its per-material loads read from the tables; same operations. */
export function reactiveTemperatureQ3D(
  T: ReactiveThermalTables3D,
  word: number,
  energy: number,
): number {
  const m = word & 255,
    heat = energy - T.fuelQ[m],
    phase = T.phaseQ[m];
  let temperature = Math.max(0, heat - phase);
  const up = T.up[m],
    upTemperature = T.upQ[m];
  if (up && heat >= phase + upTemperature)
    temperature = Math.max(upTemperature, heat - T.upPhaseQ[m]);
  else {
    const down = T.down[m],
      downTemperature = T.downQ[m];
    if (down && heat <= phase + downTemperature)
      temperature = Math.min(downTemperature, Math.max(0, heat - T.downPhaseQ[m]));
  }
  return temperature;
}
/** thermal.ts thermalView over the tables. */
export function reactiveThermalView3D(
  T: ReactiveThermalTables3D,
  word: number,
  energy: number,
): number {
  return (
    ((word & 0xffff00ff) |
      (Math.min(255, Math.floor(reactiveTemperatureQ3D(T, word, energy) / ENERGY_SCALE)) << 8)) >>>
    0
  );
}
