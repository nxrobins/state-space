/** Material law binding for structural worlds: the frozen ca-3d-m5 catalog or a validated reactive catalog (ca-3d-m6). */
import {
  MAT,
  PHASE,
  COLD_STRIDE,
  COLD_FUEL_ENERGY,
  COLD_OXIDIZER,
  COLD_DEFAULT_PHASE,
  COLD_BURNS_INTO,
  COLD_SMOKE_PRODUCT,
} from '../../generated/materials.js';
import { DEFAULT_REGISTRY } from '../../registry.js';
import { checkedInteger } from '../../validation.js';
import {
  MATERIALS_3D,
  MATERIAL_CATALOG_HASH_3D,
  volumeSchedule,
  type VolumePass,
} from '../3d-core.js';
import { DEFAULT_STRUCTURAL_COLD_3D } from '../structural-mechanics.js';
import type { ReactiveMaterialRegistry3D } from '../reactive/reactive-registry.js';

export const STRUCTURAL_RULES_VERSION_3D = 'ca-3d-m5';
export const STRUCTURAL_REACTIVE_RULES_VERSION_3D = 'ca-3d-m6';
/** The reactive catalog contract a ca-3d-m6 world binds. Other catalog versions are rejected. */
export const STRUCTURAL_REACTIVE_CATALOG_RULES_3D = 'reactive-materials-1';
export type StructuralPass3D =
  VolumePass | { kind: 'combustion'; axis: number; parity: number; direction: number };
/** The one ca-3d-m6 pass added after the 27 ca-3d-m1 material passes. */
export const STRUCTURAL_COMBUSTION_PASS_3D: Readonly<StructuralPass3D> = Object.freeze({
  kind: 'combustion',
  axis: 0,
  parity: 0,
  direction: 1,
});
export type StructuralMaterialRecord3D = Readonly<{
  name: string;
  defaultThermal: number;
  defaultPhase: number;
}>;
export type StructuralLaw3D = Readonly<{
  rulesVersion: typeof STRUCTURAL_RULES_VERSION_3D | typeof STRUCTURAL_REACTIVE_RULES_VERSION_3D;
  materialCatalogHash: string;
  /** Whether the combustion pass and its activity terms are part of this world's law. */
  reactive: boolean;
  /** 256 rows of COLD_STRIDE properties. Inactive rows of a reactive catalog are zero. */
  cold: Uint32Array;
  materialIds: readonly number[];
  has(id: number): boolean;
  record(id: number): StructuralMaterialRecord3D;
}>;

const M1_PHASES: readonly number[] = [
  PHASE.SOLID,
  PHASE.POWDER,
  PHASE.LIQUID,
  PHASE.VISCOUS,
  PHASE.GAS,
  PHASE.FROZEN,
  PHASE.MOLTEN,
];
const m5Ids = Object.freeze(MATERIALS_3D.map((m) => m.id)),
  m5Supported = new Set<number>(m5Ids);
const M5_LAW: StructuralLaw3D = Object.freeze({
  rulesVersion: STRUCTURAL_RULES_VERSION_3D,
  materialCatalogHash: MATERIAL_CATALOG_HASH_3D,
  reactive: false,
  cold: DEFAULT_STRUCTURAL_COLD_3D,
  materialIds: m5Ids,
  has: (id: number) => m5Supported.has(id),
  record(id: number) {
    if (!m5Supported.has(id)) throw Error('Material is not supported by ca-3d-m5.');
    const m = DEFAULT_REGISTRY.material(id);
    return {
      name: m.name,
      defaultThermal: m.default_thermal,
      defaultPhase: m.properties.default_phase,
    };
  },
});

/** Reads only the registry's public contract; the reactive module is never loaded by structural worlds. */
function checkedReactiveRegistry(value: unknown): ReactiveMaterialRegistry3D {
  const reject = () => {
    throw Error('ca-3d-m6 requires a validated, frozen reactive-materials-1 registry.');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.isFrozen(value))
    reject();
  const r = value as ReactiveMaterialRegistry3D;
  if (
    r.rulesVersion !== STRUCTURAL_REACTIVE_CATALOG_RULES_3D ||
    typeof r.hash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(r.hash) ||
    typeof r.has !== 'function' ||
    typeof r.material !== 'function' ||
    typeof r.coldTable !== 'function' ||
    !Array.isArray(r.materialIds)
  )
    reject();
  return r;
}

/** ca-3d-m6 binding of a reactive catalog. Rejects catalogs the combustion law cannot execute exactly. */
export function reactiveStructuralLaw3D(registry: unknown): StructuralLaw3D {
  const r = checkedReactiveRegistry(registry),
    cold = r.coldTable();
  if (!(cold instanceof Uint32Array) || cold.length !== 256 * COLD_STRIDE)
    throw Error('Reactive registry cold table has the wrong shape.');
  const ids = Array.from(r.materialIds, (id) => checkedInteger(id, 0, 255, 'material id')),
    active = new Set(ids);
  if (!ids.length || active.size !== ids.length || !active.has(MAT.AIR))
    throw Error('ca-3d-m6 requires unique active material IDs including air.');
  const records = new Map<number, StructuralMaterialRecord3D>();
  for (let id = 0; id < 256; id++) {
    const at = id * COLD_STRIDE;
    if (!active.has(id)) {
      if (r.has(id)) throw Error('Reactive registry membership disagrees with its ID list.');
      for (let f = 0; f < COLD_STRIDE; f++)
        if (cold[at + f] !== 0)
          throw Error('Inactive reactive materials must have zero properties.');
      continue;
    }
    if (!r.has(id)) throw Error('Reactive registry membership disagrees with its ID list.');
    const m = r.material(id),
      phase = cold[at + COLD_DEFAULT_PHASE];
    if (
      !m ||
      typeof m.name !== 'string' ||
      m.properties.default_phase !== phase ||
      !M1_PHASES.includes(phase)
    )
      throw Error('Reactive material record does not match its cold table row.');
    checkedInteger(m.default_thermal, 0, 255, 'default thermal');
    if (cold[at + COLD_FUEL_ENERGY] > 0) {
      if (cold[at + COLD_OXIDIZER] === 1)
        throw Error('ca-3d-m6 requires each material to be a fuel or an oxidizer, not both.');
      for (const f of [COLD_BURNS_INTO, COLD_SMOKE_PRODUCT])
        if (!active.has(cold[at + f]))
          throw Error('Combustion products must belong to the active catalog.');
    }
    records.set(
      id,
      Object.freeze({ name: m.name, defaultThermal: m.default_thermal, defaultPhase: phase }),
    );
  }
  const frozenIds = Object.freeze(ids);
  return Object.freeze({
    rulesVersion: STRUCTURAL_REACTIVE_RULES_VERSION_3D,
    materialCatalogHash: r.hash,
    reactive: true,
    cold,
    materialIds: frozenIds,
    has: (id: number) => active.has(id),
    record(id: number) {
      const record = records.get(id);
      if (!record) throw Error('Material is not active in this ca-3d-m6 catalog.');
      return record;
    },
  });
}

/** The world's law: the frozen ca-3d-m5 catalog without a registry, ca-3d-m6 with one. */
export function structuralLaw3D(registry?: unknown): StructuralLaw3D {
  return registry === undefined ? M5_LAW : reactiveStructuralLaw3D(registry);
}

/** The 27 ca-3d-m1 passes, followed under ca-3d-m6 by one combustion pass. Order is part of the rules. */
export function structuralSchedule3D(tick: number, reactive: boolean): readonly StructuralPass3D[] {
  const passes: readonly StructuralPass3D[] = volumeSchedule(tick);
  return reactive ? [...passes, STRUCTURAL_COMBUSTION_PASS_3D] : passes;
}
