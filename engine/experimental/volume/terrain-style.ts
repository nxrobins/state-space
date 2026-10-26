/** Presentation data only: no material law, simulation state or native handles. */
import { assertRecordFields } from '../../portable-data.js';

export type TerrainStyleProfile = 'classic' | 'geological';
export type TerrainStyleColor = readonly [number, number, number];
export type TerrainStyleSettings = {
  profile: TerrainStyleProfile;
  tone: { exposureEV: number; bloomStrength: number; bloomThreshold: number };
  lighting: {
    ambientIntensity: number;
    lampIntensity: number;
    emissiveIntensity: number;
    lampColor: TerrainStyleColor;
  };
  materials: {
    rockTint: TerrainStyleColor;
    rockTextureScale: number;
    rockNormalStrength: number;
    rockRoughness: number;
    wetDarkening: number;
    wetRoughness: number;
    macroVariation: number;
    sandTint: TerrainStyleColor;
    iceTint: TerrainStyleColor;
    frostStrength: number;
  };
};
/** Each call replaces the style: omitted values come from the selected profile. */
export type TerrainStyleOptions = {
  profile?: TerrainStyleProfile;
  tone?: Partial<TerrainStyleSettings['tone']>;
  lighting?: Partial<TerrainStyleSettings['lighting']>;
  materials?: Partial<TerrainStyleSettings['materials']>;
};

function defaults(profile: TerrainStyleProfile): TerrainStyleSettings {
  const geological = profile === 'geological';
  return {
    profile,
    tone: {
      exposureEV: geological ? -0.25 : 0,
      bloomStrength: geological ? 0.07 : 0.14,
      bloomThreshold: geological ? 1.5 : 1.2,
    },
    lighting: {
      ambientIntensity: geological ? 0.72 : 1,
      lampIntensity: geological ? 0.7 : 1,
      emissiveIntensity: 1,
      lampColor: geological ? [1, 0.92, 0.81] : [1, 0.87, 0.69],
    },
    materials: {
      rockTint: geological ? [0.36, 0.4, 0.43] : [0.44, 0.48, 0.51],
      rockTextureScale: 0.28,
      rockNormalStrength: geological ? 0.7 : 0.55,
      rockRoughness: geological ? 1.08 : 1,
      wetDarkening: geological ? 0.5 : 0.43,
      wetRoughness: geological ? 0.28 : 0.38,
      macroVariation: geological ? 0.45 : 0,
      sandTint: geological ? [0.38, 0.28, 0.17] : [0.43, 0.31, 0.16],
      iceTint: geological ? [0.34, 0.53, 0.61] : [0.4, 0.58, 0.64],
      frostStrength: geological ? 0.8 : 1,
    },
  };
}

const bounds = {
  exposureEV: [-4, 4],
  bloomStrength: [0, 1],
  bloomThreshold: [0.01, 16],
  ambientIntensity: [0, 4],
  lampIntensity: [0, 4],
  emissiveIntensity: [0, 4],
  rockTextureScale: [0.05, 4],
  rockNormalStrength: [0, 2],
  rockRoughness: [0.25, 2],
  wetDarkening: [0, 0.9],
  wetRoughness: [0.08, 1],
  macroVariation: [0, 1],
  frostStrength: [0, 2],
} as const;

/** Reject malformed values before publishing anything; returned data never aliases input. */
export function resolveTerrainStyle(value: unknown = {}): TerrainStyleSettings {
  const error = 'Invalid terrain style.';
  assertRecordFields(value, [], ['profile', 'tone', 'lighting', 'materials'], error);
  const profile = Object.hasOwn(value, 'profile') ? value.profile : 'classic';
  if (profile !== 'classic' && profile !== 'geological') throw Error(error);
  const result = defaults(profile);
  for (const group of ['tone', 'lighting', 'materials'] as const) {
    if (!Object.hasOwn(value, group)) continue;
    const input = value[group],
      target = result[group] as Record<string, unknown>;
    assertRecordFields(input, [], Object.keys(target), error);
    for (const [key, entry] of Object.entries(input)) {
      if (Array.isArray(target[key])) {
        if (!Array.isArray(entry) || entry.length !== 3 || Reflect.ownKeys(entry).length !== 4)
          throw Error(error);
        const descriptors = Object.getOwnPropertyDescriptors(entry);
        const color = [0, 1, 2].map((i) => {
          const d = descriptors[String(i)];
          if (
            !d ||
            !('value' in d) ||
            !d.enumerable ||
            typeof d.value !== 'number' ||
            !Number.isFinite(d.value) ||
            d.value < 0 ||
            d.value > 1
          )
            throw Error(error);
          return d.value === 0 ? 0 : d.value;
        });
        target[key] = color;
      } else {
        const [min, max] = bounds[key as keyof typeof bounds];
        if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < min || entry > max)
          throw Error(error);
        target[key] = entry === 0 ? 0 : entry;
      }
    }
  }
  return result;
}

/** Seven vec4s, shared by surface, optical, volume and post-processing passes. */
export const TERRAIN_STYLE_BYTES = 112;
export function packTerrainStyle(s: TerrainStyleSettings): Float32Array {
  const m = s.materials,
    l = s.lighting,
    t = s.tone;
  return new Float32Array([
    1.65 * 2 ** t.exposureEV,
    t.bloomStrength,
    t.bloomThreshold,
    s.profile === 'geological' ? 1 : 0,
    l.ambientIntensity,
    l.lampIntensity,
    l.emissiveIntensity,
    m.rockNormalStrength,
    ...m.rockTint,
    m.rockTextureScale,
    m.rockRoughness,
    m.wetDarkening,
    m.wetRoughness,
    m.macroVariation,
    ...m.sandTint,
    m.frostStrength,
    ...m.iceTint,
    0,
    ...l.lampColor,
    0,
  ]);
}
