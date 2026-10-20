/** Three sparse 16³ experiments sharing the opt-in thermal catalog. */
import {
  ENERGY_SCALE,
  MAT,
  THERMAL_MAT_3D as M,
  THERMAL_MATERIAL_PACK_3D,
  type ReactiveMaterialEdit3D,
} from 'state-space-engine/experimental/3d/reactive-materials';

const thermal = {
  size: 16,
  pack: THERMAL_MATERIAL_PACK_3D,
  liquid: M.MOLTEN_WAX,
  liquidLabel: 'Melted wax',
} as const;
export const MATERIAL_SCENARIOS = {
  conduction: {
    ...thermal,
    worldId: 'reactive-material-conduction-1',
    pulseQ: 180 * ENERGY_SCALE,
    title: '16³ copper heat path',
    description:
      'Heat the copper inlet, commit, then wait to carry heat to the wax at the far end. Compare with the ceramic barrier scene. A second pulse can melt the copper itself.',
    primary: [5, 8, 6],
    secondary: [7, 8, 6],
    primaryLabel: 'Copper inlet',
    secondaryLabel: 'Wax target',
  },
  insulation: {
    ...thermal,
    worldId: 'reactive-material-insulation-1',
    pulseQ: 180 * ENERGY_SCALE,
    title: '16³ ceramic heat barrier',
    description:
      'Apply the same heat to the copper inlet. The ceramic middle section protects the wax while the trapped heat melts the inlet. Compare with the copper heat path.',
    primary: [5, 8, 6],
    secondary: [7, 8, 6],
    primaryLabel: 'Copper inlet',
    secondaryLabel: 'Wax target',
  },
  wax: {
    ...thermal,
    worldId: 'reactive-material-wax-1',
    pulseQ: 80 * ENERGY_SCALE,
    title: '16³ wax release valve',
    description:
      'Heat the wax plug, commit and wait for the water to escape. Select melted wax to cool it back to solid, or heat it further until it ignites next to air.',
    primary: [8, 6, 8],
    secondary: [8, 5, 8],
    primaryLabel: 'Wax plug',
    secondaryLabel: 'Water above',
  },
} as const;
export type MaterialScenario = keyof typeof MATERIAL_SCENARIOS;
export function isMaterialScenario(scenario: string): scenario is MaterialScenario {
  return Object.hasOwn(MATERIAL_SCENARIOS, scenario);
}
/** Floor and actor belong to the surrounding chamber; these edits only construct samples. */
export function materialSceneEdits(scenario: MaterialScenario): ReactiveMaterialEdit3D[] {
  const edits: ReactiveMaterialEdit3D[] = [];
  const place = (x: number, y: number, z: number, material: number, anchored = false) => {
    edits.push({ kind: 'place', x, y, z, material, thermal: 20 });
    if (anchored) edits.push({ kind: 'anchor', x, y, z, anchored: true });
  };
  if (scenario === 'wax') {
    // Closed sides keep the water trapped until the solid plug melts.
    for (let y = 5; y <= 8; y++)
      for (let z = 7; z <= 9; z++)
        for (let x = 7; x <= 9; x++) if (x !== 8 || z !== 8) place(x, y, z, M.CERAMIC, true);
    place(8, 6, 8, M.WAX, true);
    place(8, 5, 8, MAT.WATER);
  } else {
    place(5, 8, 6, M.COPPER, true);
    place(6, 8, 6, scenario === 'conduction' ? M.COPPER : M.CERAMIC, true);
    place(7, 8, 6, M.WAX);
    for (let x = 5; x <= 7; x++) place(x, 9, 6, M.CERAMIC, true);
  }
  return edits;
}
