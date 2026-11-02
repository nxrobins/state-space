import { beforeAll, expect, test } from 'vitest';
import {
  DEFAULT_MATERIAL_PRESENTATION_3D,
  materialPresentation3D,
  materialPredicates,
  paletteConstant,
  PRESENTATION_CUTOUT,
  PRESENTATION_FLAME,
  PRESENTATION_HAZE,
  PRESENTATION_MELT,
  PRESENTATION_SEE_THROUGH,
  PRESENTATION_SURFACE,
  type MaterialPresentation3D,
} from './material-presentation.js';
import { DRAW, MESH, drawShader, meshShader } from './3d-renderer.js';
import { cavernShaders } from './cavern-appearance.js';
import { MAT, MATERIALS_3D } from '../3d.js';
import { reactiveStructuralLaw3D, structuralMaterials3D } from '../structural/structural-law.js';
import { createThermalMaterialRegistry3D, THERMAL_MAT_3D } from '../reactive/thermal-materials.js';

const ids = (p: MaterialPresentation3D, bit: number) =>
  Array.from(p.classes, (c, id) => (c & bit ? id : -1)).filter((id) => id >= 0);
let thermal: MaterialPresentation3D;
beforeAll(async () => {
  const law = reactiveStructuralLaw3D(await createThermalMaterialRegistry3D());
  thermal = materialPresentation3D({
    cold: law.cold,
    materials: structuralMaterials3D(law),
    reactive: true,
  });
});

test('the frozen catalog derives exactly the legacy roles and keeps its nine colors', () => {
  const p = DEFAULT_MATERIAL_PRESENTATION_3D;
  expect(p.reactive).toBe(false);
  expect(ids(p, PRESENTATION_SEE_THROUGH)).toEqual([MAT.AIR, MAT.STEAM]);
  expect(ids(p, PRESENTATION_CUTOUT)).toEqual([MAT.STEAM]);
  expect(ids(p, PRESENTATION_HAZE)).toEqual([MAT.STEAM]);
  expect(ids(p, PRESENTATION_FLAME)).toEqual([]);
  expect(ids(p, PRESENTATION_MELT)).toEqual([MAT.LAVA, MAT.MOLTEN_GLASS]);
  expect(ids(p, PRESENTATION_SURFACE)).toEqual([]);
  // The legacy lava ramp: floor 170, full glow 85 units higher.
  expect([p.glowFloor[MAT.LAVA], p.glowSpan[MAT.LAVA]]).toEqual([170, 85]);
  for (const m of MATERIALS_3D)
    expect(Array.from(p.colors.subarray(m.id * 3, m.id * 3 + 3))).toEqual(
      Array.from(
        new Float32Array([1, 3, 5].map((k) => parseInt(m.color.slice(k, k + 2), 16) / 255)),
      ),
    );
  const colored = Array.from({ length: 256 }, (_, id) =>
    p.colors.subarray(id * 3, id * 3 + 3).some((v) => v > 0),
  );
  expect(colored.filter(Boolean)).toHaveLength(MATERIALS_3D.length); // air is near black, not black
  expect(colored.filter((v, id) => v && !MATERIALS_3D.some((m) => m.id === id))).toHaveLength(0);
  const palette = paletteConstant(p);
  expect(palette.startsWith('const colors=array<vec3f,256>(')).toBe(true);
  expect(palette.split('vec3f(')).toHaveLength(257);
  // Legacy literal roles, so the frozen catalog's shaders do not read any table.
  const predicates = materialPredicates(p);
  expect(predicates).toContain('fn seeThrough(m:u32)->bool{return m==0u||m==9u;}');
  expect(predicates).toContain('fn melt(m:u32)->bool{return m==10u||m==17u;}');
  expect(predicates).not.toContain('classes');
  expect(DRAW).toBe(drawShader());
  expect(MESH).toBe(meshShader());
  expect(DRAW).toContain(palette);
  expect(DRAW).not.toContain('emitter(m)');
});

test('a reactive catalog derives flames, haze gases, melts and colored surfaces from the law', () => {
  const p = thermal;
  expect(p.reactive).toBe(true);
  expect(ids(p, PRESENTATION_FLAME)).toEqual([MAT.FIRE]);
  expect(ids(p, PRESENTATION_HAZE)).toEqual([MAT.STEAM, MAT.SMOKE, MAT.OIL_VAPOR]);
  expect(ids(p, PRESENTATION_CUTOUT)).toEqual([MAT.FIRE, MAT.STEAM, MAT.SMOKE, MAT.OIL_VAPOR]);
  expect(ids(p, PRESENTATION_SEE_THROUGH)).toEqual([
    MAT.AIR,
    MAT.FIRE,
    MAT.STEAM,
    MAT.SMOKE,
    MAT.OIL_VAPOR,
  ]);
  expect(ids(p, PRESENTATION_MELT)).toEqual([
    MAT.LAVA,
    MAT.MOLTEN_METAL,
    MAT.MOLTEN_GLASS,
    THERMAL_MAT_3D.MOLTEN_COPPER,
    THERMAL_MAT_3D.MOLTEN_WAX,
  ]);
  // Oil is viscous but freezes into nothing cohesive; water is a liquid: neither glows.
  expect(p.classes[MAT.OIL] & PRESENTATION_MELT).toBe(0);
  expect(p.classes[MAT.WATER]).toBe(0);
  expect(ids(p, PRESENTATION_SURFACE)).toEqual([
    MAT.METAL,
    MAT.OIL,
    MAT.WOOD,
    MAT.ASH,
    THERMAL_MAT_3D.COPPER,
    THERMAL_MAT_3D.CERAMIC,
    THERMAL_MAT_3D.WAX,
  ]);
  // Glow ramps start 40 units under freezing; flames follow the extinction threshold.
  expect([p.glowFloor[MAT.LAVA], p.glowSpan[MAT.LAVA]]).toEqual([170, 85]);
  expect([p.glowFloor[THERMAL_MAT_3D.MOLTEN_COPPER], p.glowSpan[33]]).toEqual([60, 85]);
  expect([p.glowFloor[THERMAL_MAT_3D.MOLTEN_WAX], p.glowSpan[36]]).toEqual([0, 85]);
  expect([p.glowFloor[MAT.FIRE], p.glowSpan[MAT.FIRE]]).toEqual([80, 175]);
  expect(Array.from(p.colors.subarray(32 * 3, 32 * 3 + 3))).toEqual(
    Array.from(new Float32Array([0xbb / 255, 0x77 / 255, 0x33 / 255])),
  );
  const predicates = materialPredicates(p);
  expect(predicates).toContain('const classes=array<u32,256>(');
  expect(predicates).toContain('fn glowFloor(m:u32)->f32{return glow[m].x;}');
  expect(drawShader(p)).toContain('if(emitter(m)){color+=colors[m]');
  const shaders = cavernShaders([8, 8, 8], 4, 384, false, p);
  expect(shaders.draw).toContain('if(surface(m)){albedo=colors[m]');
  expect(shaders.draw).toContain('if(flame(m))');
  expect(shaders.haze).toContain('radiance*=albedo(p);');
  const legacy = cavernShaders([8, 8, 8], 4, 384);
  expect(legacy.draw).not.toContain('if(surface(m)){albedo=colors[m]*(');
  expect(legacy.haze).not.toContain('albedo(p)');
});

test('presentation sources are validated', () => {
  const cold = new Uint32Array(256 * 24);
  expect(() =>
    materialPresentation3D({ cold, materials: [{ id: 0, color: 'red' }], reactive: true }),
  ).toThrow('#rrggbb');
  expect(() =>
    materialPresentation3D({
      cold,
      materials: [
        { id: 3, color: '#000000' },
        { id: 3, color: '#000000' },
      ],
      reactive: true,
    }),
  ).toThrow('unique');
  expect(() =>
    materialPresentation3D({ cold: new Uint32Array(24), materials: [], reactive: true }),
  ).toThrow('cold table');
});
