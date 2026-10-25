/** New constitutive profiles; the legacy catalog remains unchanged. Model units, not SI calibration. */
import { PHASE } from '../../generated/materials.js';
import { createThermalMaterialRegistry3D } from '../reactive/thermal-materials.js';

export const MULTIPHYSICS_PROFILE_VERSION_3D = 'multiphysics-profiles-1';
export const MULTIPHYSICS_ENERGY_SCALE_3D = 256;
export type MaterialPhase3D = 'solid' | 'granular' | 'liquid' | 'gas';
export type MaterialProfile3D = Readonly<{
  id: number;
  name: string;
  color: string;
  phase: MaterialPhase3D;
  massPerReference: number;
  restDensity: number;
  heatCapacityPerReference: 1;
  conductivity: number;
  electricalConductivity: number;
  cohesion: number;
  softening: number;
  friction: number;
  restitution: number;
  viscosity: number;
  defaultTemperature: number;
  phaseEnergyQ: number;
  fuelEnergyQ: number;
  meltPoint: number;
  boilPoint: number;
  freezePoint: number;
  condensePoint: number;
  flashPoint: number;
  meltsInto: string | null;
  boilsInto: string | null;
  freezesInto: string | null;
  condensesInto: string | null;
  oxidizer: boolean;
  burnsInto: string | null;
  smokeProduct: string | null;
}>;
export type MultiphysicsProfiles3D = Readonly<{
  version: typeof MULTIPHYSICS_PROFILE_VERSION_3D;
  catalogHash: string;
  byName: Readonly<Record<string, MaterialProfile3D>>;
}>;
const admitted = new WeakSet<object>();
export function readMultiphysicsProfile3D(
  profiles: MultiphysicsProfiles3D,
  material: string,
): MaterialProfile3D {
  if (
    !profiles ||
    !admitted.has(profiles) ||
    typeof material !== 'string' ||
    !Object.hasOwn(profiles.byName, material)
  )
    throw Error('Unknown multiphysics profile or material.');
  return profiles.byName[material];
}
/** Fixed 22-material v1 definition; changes require a new profile version. */
export async function createMultiphysicsProfiles3D(): Promise<MultiphysicsProfiles3D> {
  const registry = await createThermalMaterialRegistry3D(),
    byName: Record<string, MaterialProfile3D> = Object.create(null);
  const electrical: Record<string, number> = {
    copper: 1,
    molten_copper: 1,
    metal: 0.1,
    molten_metal: 0.1,
    water: 0.001,
  };
  const viscosity: Record<string, number> = { water: 0.02, oil: 0.4, molten_wax: 0.3, lava: 0.8 };
  for (const id of registry.materialIds) {
    const row = registry.material(id),
      p = row.properties;
    const phase: MaterialPhase3D =
      p.default_phase === PHASE.GAS
        ? 'gas'
        : p.default_phase === PHASE.POWDER
          ? 'granular'
          : p.default_phase === PHASE.SOLID || p.default_phase === PHASE.FROZEN
            ? 'solid'
            : 'liquid';
    // Legacy density is not conserved mass. It supplies initialization defaults only;
    // fire explicitly receives positive mass and every transition retains existing mass.
    const density = Math.max(1, p.density) / 100;
    const target = (id: number) => (id ? registry.material(id).name : null);
    byName[row.name] = Object.freeze({
      id,
      name: row.name,
      color: row.color,
      phase,
      massPerReference: density,
      restDensity: density,
      heatCapacityPerReference: 1,
      conductivity: p.conductivity / 255,
      electricalConductivity: electrical[row.name] ?? 0,
      cohesion: p.cohesion / 255,
      softening: p.softening,
      friction: 0.5,
      restitution: 0.1,
      viscosity: viscosity[row.name] ?? 0.02,
      defaultTemperature: row.default_thermal,
      phaseEnergyQ: p.phase_energy * MULTIPHYSICS_ENERGY_SCALE_3D,
      fuelEnergyQ: p.fuel_energy * MULTIPHYSICS_ENERGY_SCALE_3D,
      meltPoint: p.melt_point,
      boilPoint: p.boil_point,
      freezePoint: p.freeze_point,
      condensePoint: p.condense_point,
      flashPoint: p.flash_point,
      meltsInto: target(p.melts_into),
      boilsInto: target(p.boils_into),
      freezesInto: target(p.freezes_into),
      condensesInto: target(p.condenses_into),
      oxidizer: p.oxidizer === 1,
      burnsInto: target(p.burns_into),
      smokeProduct: target(p.smoke_product),
    });
  }
  const profiles: MultiphysicsProfiles3D = Object.freeze({
    version: MULTIPHYSICS_PROFILE_VERSION_3D,
    catalogHash: registry.hash,
    byName: Object.freeze(byName),
  });
  admitted.add(profiles);
  return profiles;
}
