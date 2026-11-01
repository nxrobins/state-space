/** Presentation tables derived from a world's material catalog. No physics reads these. */
import {
  MAT,
  PHASE,
  COLD_STRIDE,
  COLD_DEFAULT_PHASE,
  COLD_FUEL_ENERGY,
  COLD_SMOKE_PRODUCT,
  COLD_FREEZES_INTO,
  COLD_COHESION,
  COLD_FREEZE_POINT,
  buildColdTable,
} from '../../generated/materials.js';
import { MATERIALS_3D } from '../3d-core.js';

/** Rays and face exposure pass through the cell: air and every gas. */
export const PRESENTATION_SEE_THROUGH = 1;
/** Drawn as a small inner cube, never an opaque brick: every gas except air. */
export const PRESENTATION_CUTOUT = 2;
/** A participating medium in the volume pass only: gases that are not flames. */
export const PRESENTATION_HAZE = 4;
/** The oxidizer-side product of some fuel's combustion: emissive by temperature. */
export const PRESENTATION_FLAME = 8;
/** A melt that freezes back into a cohesive solid: thermal glow above its glow floor. */
export const PRESENTATION_MELT = 16;
/** A catalog-colored surface without one of the nine bespoke M1 treatments. */
export const PRESENTATION_SURFACE = 32;
export const PRESENTATION_EMITTER = PRESENTATION_FLAME | PRESENTATION_MELT;

export type MaterialPresentationSource3D = {
  /** 256 rows of COLD_STRIDE properties: the law the world binds. */
  cold: Uint32Array;
  /** The active materials and their catalog colors (`#rrggbb`). */
  materials: readonly { id: number; color: string }[];
  /** False for the frozen ca-3d-m1 catalog, whose shaders keep their legacy literal roles. */
  reactive: boolean;
};
export type MaterialPresentation3D = Readonly<{
  /** 256 RGB triples in [0, 1]; inactive IDs are black. */
  colors: Float32Array;
  /** PRESENTATION_* bits per ID. */
  classes: Uint8Array;
  /** Thermal-byte floor and span of the glow ramp per emitter ID; zero elsewhere. */
  glowFloor: Uint8Array;
  glowSpan: Uint8Array;
  reactive: boolean;
}>;

/** The legacy lava/molten-glass ramp: full glow 85 units above a floor 40 units under freezing. */
const GLOW_SPAN = 85,
  GLOW_FLOOR_BELOW_FREEZING = 40,
  /** Builtin fire extinguishes below 80 temperature units and starts at 255. */
  FLAME_FLOOR = 80,
  FLAME_SPAN = 175;
/** Materials with a bespoke naturalistic treatment that the catalog color never replaces. */
const BESPOKE = new Set<number>([MAT.STONE, MAT.WATER, MAT.SAND, MAT.ICE, MAT.GLASS]);

function checkedColor(color: unknown): [number, number, number] {
  if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color))
    throw Error('Material presentation requires #rrggbb catalog colors.');
  return [1, 3, 5].map((k) => parseInt(color.slice(k, k + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

/** Roles follow phase and transitions, never pack-specific IDs; colors follow the catalog. */
export function materialPresentation3D(
  source: MaterialPresentationSource3D,
): MaterialPresentation3D {
  const { cold, materials, reactive } = source;
  if (!(cold instanceof Uint32Array) || cold.length !== 256 * COLD_STRIDE)
    throw Error('Material presentation requires a 256-row cold table.');
  const colors = new Float32Array(768),
    classes = new Uint8Array(256),
    glowFloor = new Uint8Array(256),
    glowSpan = new Uint8Array(256),
    active = new Set<number>();
  for (const m of materials) {
    if (!Number.isInteger(m.id) || m.id < 0 || m.id > 255 || active.has(m.id))
      throw Error('Material presentation requires unique IDs in 0..255.');
    active.add(m.id);
    colors.set(checkedColor(m.color), m.id * 3);
  }
  const field = (id: number, f: number) => cold[id * COLD_STRIDE + f];
  const flames = new Set<number>();
  for (const id of active)
    if (field(id, COLD_FUEL_ENERGY) > 0) flames.add(field(id, COLD_SMOKE_PRODUCT));
  for (const id of active) {
    const phase = field(id, COLD_DEFAULT_PHASE);
    let bits = 0;
    if (id === MAT.AIR) bits = PRESENTATION_SEE_THROUGH;
    else if (phase === PHASE.GAS) {
      bits = PRESENTATION_SEE_THROUGH | PRESENTATION_CUTOUT;
      bits |= flames.has(id) ? PRESENTATION_FLAME : PRESENTATION_HAZE;
    } else {
      const solidifies = field(id, COLD_FREEZES_INTO),
        melt =
          phase === PHASE.MOLTEN ||
          (phase === PHASE.VISCOUS &&
            active.has(solidifies) &&
            field(solidifies, COLD_COHESION) > 0);
      if (melt) bits = PRESENTATION_MELT;
      else if (!BESPOKE.has(id)) bits = PRESENTATION_SURFACE;
    }
    if (bits & PRESENTATION_MELT) {
      glowFloor[id] = Math.max(0, field(id, COLD_FREEZE_POINT) - GLOW_FLOOR_BELOW_FREEZING);
      glowSpan[id] = GLOW_SPAN;
    } else if (bits & PRESENTATION_FLAME) {
      glowFloor[id] = FLAME_FLOOR;
      glowSpan[id] = FLAME_SPAN;
    }
    classes[id] = bits;
  }
  return Object.freeze({ colors, classes, glowFloor, glowSpan, reactive });
}

/** The frozen ca-3d-m1 catalog: nine colored materials, legacy shader roles. */
export const DEFAULT_MATERIAL_PRESENTATION_3D: MaterialPresentation3D = materialPresentation3D({
  cold: buildColdTable(),
  materials: MATERIALS_3D.map((m) => ({ id: m.id, color: m.color })),
  reactive: false,
});

/** The shortest round-trip text of the stored float32, so WGSL parses the identical value. */
const f = (v: number) => String(v);
/** `const colors=array<vec3f,256>(...)`: every shader palette is this one line. */
export function paletteConstant(p: MaterialPresentation3D): string {
  const entries: string[] = [];
  for (let id = 0; id < 256; id++)
    entries.push(
      `vec3f(${[0, 1, 2].map((k) => (p.colors[id * 3 + k] ? f(p.colors[id * 3 + k]) : '0')).join(',')})`,
    );
  return `const colors=array<vec3f,256>(${entries.join(',')});`;
}
/** Role predicates without palette references, safe in every pass. Legacy literals for ca-3d-m1. */
export function materialPredicates(p: MaterialPresentation3D): string {
  if (!p.reactive)
    return `
fn seeThrough(m:u32)->bool{return m==0u||m==9u;}
fn cutout(m:u32)->bool{return m==9u;}
fn hazeOnly(m:u32)->bool{return m==9u;}
fn flame(m:u32)->bool{return false;}
fn melt(m:u32)->bool{return m==10u||m==17u;}
fn emitter(m:u32)->bool{return m==10u||m==17u;}
fn surface(m:u32)->bool{return false;}
fn glowFloor(m:u32)->f32{return 170.;}
fn glowSpan(m:u32)->f32{return 85.;}
fn glowFloorU(m:u32)->u32{return 170u;}
`;
  const classes = Array.from(p.classes, (c) => `${c}u`).join(','),
    glow = Array.from(p.glowFloor, (floor, id) => `vec2f(${floor}.,${p.glowSpan[id] || 1}.)`).join(
      ',',
    );
  return `
const classes=array<u32,256>(${classes});
const glow=array<vec2f,256>(${glow});
fn seeThrough(m:u32)->bool{return (classes[m]&${PRESENTATION_SEE_THROUGH}u)!=0u;}
fn cutout(m:u32)->bool{return (classes[m]&${PRESENTATION_CUTOUT}u)!=0u;}
fn hazeOnly(m:u32)->bool{return (classes[m]&${PRESENTATION_HAZE}u)!=0u;}
fn flame(m:u32)->bool{return (classes[m]&${PRESENTATION_FLAME}u)!=0u;}
fn melt(m:u32)->bool{return (classes[m]&${PRESENTATION_MELT}u)!=0u;}
fn emitter(m:u32)->bool{return (classes[m]&${PRESENTATION_EMITTER}u)!=0u;}
fn surface(m:u32)->bool{return (classes[m]&${PRESENTATION_SURFACE}u)!=0u;}
fn glowFloor(m:u32)->f32{return glow[m].x;}
fn glowSpan(m:u32)->f32{return glow[m].y;}
fn glowFloorU(m:u32)->u32{return u32(glow[m].x);}
`;
}
/** Palette-dependent shading helpers for the naturalistic passes; follow the palette constant. */
export function materialShading(p: MaterialPresentation3D): string {
  if (!p.reactive)
    return `
fn emissionColor(m:u32)->vec3f{return vec3f(2.8,.18,.008);}
fn lightTint(m:u32,hot:f32)->vec3f{return vec3f(1.,.22+.22*hot,.035);}
`;
  return `
fn emissionColor(m:u32)->vec3f{return colors[m]*2.8;}
fn lightTint(m:u32,hot:f32)->vec3f{return colors[m]*(.8+.4*hot);}
`;
}
