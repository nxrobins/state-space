/** Read-only M5 geometry adapter. Does not advance or predict structural physics. */
import { buildColdTable } from '../generated/materials.js';
import { temperatureQ } from '../thermal.js';
import { MATERIALS_3D } from './3d.js';
import {
  validateStructuralSnapshot3D,
  type StructuralSnapshot3D,
} from './structural/structural-world-core.js';
import type { TacticalRevision3D } from './tactical/tactical-session-view.js';
import {
  createGeometryKernel3D,
  type GeometryKernel3D,
  type KernelExposure3D,
} from './geometry-kernel.js';
export {
  GEOMETRY_SCALE_3D,
  GEOMETRY_LIMITS_3D,
  EXPOSURE_RULES_VERSION_3D,
} from './geometry-kernel.js';
export type {
  GeometryVector3D,
  GeometryBox3D,
  GeometryTime3D,
  GeometryCell3D,
  GeometryContact3D,
  GeometryFilter3D,
  MaterialExposure3D,
} from './geometry-kernel.js';
export const GEOMETRY_RULES_VERSION_3D = 'gameplay-geometry-1';
export type GeometryStamp3D = {
  rulesVersion: typeof GEOMETRY_RULES_VERSION_3D;
  domain: string | null;
  tick: number;
} & (
  | { kind: 'committed'; revision: Readonly<TacticalRevision3D> }
  | {
      kind: 'preview';
      base: Readonly<TacticalRevision3D>;
      branchId: number;
      operation: number;
      horizonTicks: number;
      completedTicks: number;
    }
);
export type GeometryExposure3D = KernelExposure3D<Readonly<GeometryStamp3D>>;
export type GameplayGeometry3D = GeometryKernel3D<Readonly<GeometryStamp3D>>;

type V = [number, number, number];
const supported = new Set(MATERIALS_3D.map((m) => m.id));
const cold = buildColdTable(),
  views = new WeakSet<object>();
const sources = new WeakMap<
  GameplayGeometry3D,
  {
    token: object;
    shape: V;
    at: (index: number) => { packed: number; energyQ: number; structure: number };
  }
>();
/** Internal boundary identity and owned cell reads for derived motion queries. */
export function gameplayGeometrySource3D(view: GameplayGeometry3D) {
  assertGameplayGeometry3D(view);
  const source = sources.get(view)!;
  return { token: source.token, shape: source.shape.slice() as V, at: source.at };
}
/** Internal brand: body resolution accepts only isolated session geometry views. */
export function assertGameplayGeometry3D(view: GameplayGeometry3D): void {
  if (!view || !views.has(view)) throw Error('Expected an isolated gameplay geometry view.');
}
function freezeStamp(stamp: GeometryStamp3D): Readonly<GeometryStamp3D> {
  return stamp.kind === 'committed'
    ? Object.freeze({ ...stamp, revision: Object.freeze({ ...stamp.revision }) })
    : Object.freeze({ ...stamp, base: Object.freeze({ ...stamp.base }) });
}

/** Internal factory: sessions stamp committed or preview state before calling. */
export function createGameplayGeometry3D(
  snapshot: StructuralSnapshot3D,
  identity: GeometryStamp3D,
): GameplayGeometry3D {
  const state = validateStructuralSnapshot3D(snapshot),
    shape: V = [snapshot.width, snapshot.height, snapshot.depth],
    stamp = freezeStamp(identity);
  if (stamp.tick !== snapshot.tick || stamp.rulesVersion !== GEOMETRY_RULES_VERSION_3D)
    throw Error('Geometry identity differs from its snapshot.');
  const view = createGeometryKernel3D(
    {
      state,
      shape,
      supported,
      temperature: (packed, energyQ) => temperatureQ(packed, energyQ, cold),
    },
    stamp,
  );
  views.add(view);
  sources.set(view, {
    token: snapshot,
    shape,
    at: (i) => {
      if (!Number.isSafeInteger(i) || i < 0 || i >= state.grid.length)
        throw Error('Motion cell outside geometry.');
      return { packed: state.grid[i], energyQ: state.energyQ[i], structure: state.structure[i] };
    },
  });
  return view;
}
