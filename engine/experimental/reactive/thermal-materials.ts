/** Opt-in thermal materials v1. Existing default catalogs and solver rules stay unchanged. */
import { MAT, PHASE } from '../../generated/materials.js';
import {
  createReactiveMaterialRegistry3D,
  type ReactiveMaterialRegistry3D,
} from './reactive-registry.js';

export const THERMAL_MATERIAL_PACK_3D = 'reactive-thermal-materials-1';
// A separate range leaves the SDK teaching examples (18–20 and 255) available.
export const THERMAL_MAT_3D = Object.freeze({
  COPPER: 32,
  MOLTEN_COPPER: 33,
  CERAMIC: 34,
  WAX: 35,
  MOLTEN_WAX: 36,
});

/** Fixed catalog version: save toCatalog() alongside worlds for portable restoration. */
export async function createThermalMaterialRegistry3D(): Promise<ReactiveMaterialRegistry3D> {
  const base = await createReactiveMaterialRegistry3D();
  const material = (
    source: number,
    id: number,
    name: string,
    color: string,
    thermal: number,
    properties: Record<string, number>,
  ) => ({
    ...base.material(source),
    id,
    name,
    color,
    default_thermal: thermal,
    properties: { ...base.material(source).properties, ...properties },
  });
  const m = THERMAL_MAT_3D;
  const wax = material(MAT.WOOD, m.WAX, 'wax', '#edd7a1', 20, {
    density: 90,
    conductivity: 35,
    porosity: 0,
    cohesion: 18,
    softening: 35,
    melt_point: 40,
    melts_into: m.MOLTEN_WAX,
    latent_heat_melt: 10,
    flash_point: 140,
    fuel_energy: 100,
  });
  return base.extend([
    material(MAT.METAL, m.COPPER, 'copper', '#bb7733', 20, {
      conductivity: 220,
      melt_point: 120,
      melts_into: m.MOLTEN_COPPER,
      latent_heat_melt: 20,
      cohesion: 100,
      softening: 0,
    }),
    material(MAT.MOLTEN_METAL, m.MOLTEN_COPPER, 'molten_copper', '#ffaa44', 140, {
      conductivity: 220,
      freeze_point: 100,
      freezes_into: m.COPPER,
      phase_energy: 20,
    }),
    material(MAT.STONE, m.CERAMIC, 'ceramic', '#c6c2b5', 20, {
      density: 170,
      conductivity: 1,
      melt_point: 0,
      melts_into: 0,
      latent_heat_melt: 0,
      cohesion: 240,
      softening: 0,
    }),
    wax,
    {
      ...wax,
      id: m.MOLTEN_WAX,
      name: 'molten_wax',
      color: '#e8aa42',
      default_thermal: 60,
      properties: {
        ...wax.properties,
        default_phase: PHASE.VISCOUS,
        cohesion: 0,
        softening: 0,
        melt_point: 0,
        melts_into: 0,
        latent_heat_melt: 0,
        freeze_point: 30,
        freezes_into: m.WAX,
        phase_energy: 10,
      },
    },
  ]);
}
