/** Catalog-aware observations of complete reactive boundaries; never executes physics. */
import { temperatureQ } from '../../thermal.js';
import {
  createGeometryKernel3D,
  type GeometryKernel3D,
  type KernelExposure3D,
} from '../gameplay/geometry-kernel.js';
import {
  reactiveRegistrySource3D,
  reactiveInteger3D,
  type ReactiveMaterialRegistry3D,
} from './reactive-registry.js';
import { reactiveDomainId3D, type ReactiveDomainId3D } from './reactive-domain-state.js';
import {
  readReactiveWorldSnapshot3D,
  type ReactiveWorldSnapshot3D,
} from './reactive-world-tick.js';
import type { ReactiveSessionRevision3D } from './reactive-session-state.js';

export const REACTIVE_GEOMETRY_RULES_3D = 'reactive-geometry-1';
export type ReactiveGeometryIdentity3D = { domain: ReactiveDomainId3D } & (
  | { kind: 'committed'; revision: Readonly<ReactiveSessionRevision3D> }
  | {
      kind: 'preview';
      base: Readonly<ReactiveSessionRevision3D>;
      branchId: number;
      completedCommands: number;
      completedTicks: number;
      horizonTicks: number;
    }
);
export type ReactiveGeometryStamp3D = ReactiveGeometryIdentity3D & {
  rulesVersion: typeof REACTIVE_GEOMETRY_RULES_3D;
  worldRulesVersion: ReactiveWorldSnapshot3D['rulesVersion'];
  tick: number;
};
export type ReactiveGameplayGeometry3D = GeometryKernel3D<Readonly<ReactiveGeometryStamp3D>>;
export type ReactiveGeometryExposure3D = KernelExposure3D<Readonly<ReactiveGeometryStamp3D>>;
const sources = new WeakMap<
  ReactiveGameplayGeometry3D,
  {
    token: object;
    shape: [number, number, number];
    at(index: number): { packed: number; energyQ: number; structure: number };
  }
>();
/** Internal provenance for actor adapters; public observation copies cannot obtain it. */
export function reactiveGeometrySource3D(view: ReactiveGameplayGeometry3D) {
  const source = sources.get(view);
  if (!source) throw Error('Expected an isolated reactive geometry view.');
  return { ...source, shape: source.shape.slice() as [number, number, number] };
}

/** Internal factory. Sessions supply the boundary identity; no M5 geometry brand is issued. */
export function createReactiveGeometry3D(
  registry: ReactiveMaterialRegistry3D,
  raw: ReactiveWorldSnapshot3D,
  identity: ReactiveGeometryIdentity3D,
): ReactiveGameplayGeometry3D {
  const world = readReactiveWorldSnapshot3D(registry, raw),
    b = world.block,
    source = reactiveRegistrySource3D(registry);
  reactiveDomainId3D(identity.domain);
  const revision = identity.kind === 'committed' ? identity.revision : identity.base;
  if (
    revision.materialCatalogHash !== registry.hash ||
    revision.sessionRulesVersion !== 'reactive-session-1'
  )
    throw Error('Reactive geometry identity differs from its catalog or session.');
  if (identity.kind === 'preview') {
    reactiveInteger3D(identity.branchId, 1, Number.MAX_SAFE_INTEGER);
    reactiveInteger3D(identity.completedCommands, 0, 256);
    reactiveInteger3D(identity.horizonTicks, 0, 64);
    reactiveInteger3D(identity.completedTicks, 0, identity.horizonTicks);
  }
  if (world.tick !== revision.tick + (identity.kind === 'preview' ? identity.completedTicks : 0))
    throw Error('Reactive geometry tick differs from its boundary.');
  const value = {
    ...identity,
    rulesVersion: REACTIVE_GEOMETRY_RULES_3D,
    worldRulesVersion: world.rulesVersion,
    tick: world.tick,
  } as const;
  const stamp: Readonly<ReactiveGeometryStamp3D> =
    value.kind === 'committed'
      ? Object.freeze({ ...value, revision: Object.freeze({ ...value.revision }) })
      : Object.freeze({ ...value, base: Object.freeze({ ...value.base }) });
  const view = createGeometryKernel3D(
    {
      state: { grid: b.packedCells, energyQ: b.energyQ, structure: b.structure },
      shape: [b.width, b.height, b.depth],
      supported: source.ids,
      temperature: (packed, energyQ) => temperatureQ(packed, energyQ, source.cold),
    },
    stamp,
  );
  sources.set(view, {
    token: raw,
    shape: [b.width, b.height, b.depth],
    at(index) {
      reactiveInteger3D(index, 0, b.packedCells.length - 1);
      return {
        packed: b.packedCells[index],
        energyQ: b.energyQ[index],
        structure: b.structure[index],
      };
    },
  });
  return view;
}
