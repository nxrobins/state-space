/** Disposable command paths, bound only after a complete transport job commits. */
import { PHASE, PHASE_SHIFT } from '../../generated/materials.js';
import { reactiveFields3D, reactiveInteger3D } from './reactive-registry.js';
import {
  reactiveGeometrySource3D,
  type ReactiveGameplayGeometry3D,
  type ReactiveGeometryStamp3D,
} from './reactive-geometry.js';
import type { ReactiveMotionSegment3D } from './reactive-motion-capture.js';
import {
  REACTIVE_TRANSPORT_RULES_3D,
  type ReactiveMaterialTransportReceipt3D,
} from './reactive-transport.js';
export const REACTIVE_TRANSPORT_MOTION_RULES_3D = 'reactive-transport-motion-1';
export const REACTIVE_TRANSPORT_MOTION_LIMITS_3D = Object.freeze({
  defaultEntries: 8192,
  entries: 65536,
});
export type ReactiveTransportCaptureOptions3D = { maxEntries?: number };
export type ReactiveTransportPaths3D = {
  rulesVersion: typeof REACTIVE_TRANSPORT_MOTION_RULES_3D;
  transportRulesVersion: typeof REACTIVE_TRANSPORT_RULES_3D;
  status: 'disabled' | 'complete' | 'overflow';
  requiresReexecution: boolean;
  maxEntries: number;
  entries: number;
  stepsObserved: number;
  passes: {
    index: number;
    delta: [number, number, number];
    controlledSources: number[];
    segments: ReactiveMotionSegment3D[];
  }[];
};
export type ReactiveTransportMovement3D = {
  rulesVersion: typeof REACTIVE_TRANSPORT_MOTION_RULES_3D;
  scope: 'reactive-transport-domain';
  from: Readonly<ReactiveGeometryStamp3D>;
  to: Readonly<ReactiveGeometryStamp3D>;
  paths: ReactiveTransportPaths3D;
};
const sources = new WeakMap<
  ReactiveTransportMovement3D,
  {
    before: object;
    after: object;
    from: Readonly<ReactiveGeometryStamp3D>;
    to: Readonly<ReactiveGeometryStamp3D>;
    paths: ReactiveTransportPaths3D;
  }
>();
export function reactiveTransportMovementSource3D(value: ReactiveTransportMovement3D) {
  const source = sources.get(value);
  if (!source) throw Error('Expected a live reactive transport observation.');
  return source;
}
export function readReactiveTransportCapture3D(raw: ReactiveTransportCaptureOptions3D) {
  reactiveFields3D(raw, [], ['maxEntries']);
  return {
    maxEntries: Object.hasOwn(raw, 'maxEntries')
      ? reactiveInteger3D(raw.maxEntries, 0, REACTIVE_TRANSPORT_MOTION_LIMITS_3D.entries)
      : REACTIVE_TRANSPORT_MOTION_LIMITS_3D.defaultEntries,
  };
}
/** Internal coordinator: the receipt is a completed job result, not a proposed path. */
export function createReactiveTransportMovementAccess3D(
  before: ReactiveGameplayGeometry3D,
  after: ReactiveGameplayGeometry3D,
  receipt: ReactiveMaterialTransportReceipt3D,
  options: { maxEntries: number } | null,
): () => ReactiveTransportMovement3D {
  const a = reactiveGeometrySource3D(before),
    b = reactiveGeometrySource3D(after),
    from = before.stamp,
    to = after.stamp;
  if (
    from.kind !== 'preview' ||
    to.kind !== 'preview' ||
    from.domain !== to.domain ||
    from.tick !== to.tick ||
    from.branchId !== to.branchId ||
    from.completedCommands + 1 !== to.completedCommands ||
    from.completedTicks !== to.completedTicks ||
    from.horizonTicks !== to.horizonTicks ||
    JSON.stringify(from.base) !== JSON.stringify(to.base) ||
    from.worldRulesVersion !== to.worldRulesVersion ||
    a.shape.some((v, i) => v !== b.shape[i]) ||
    receipt.rulesVersion !== REACTIVE_TRANSPORT_RULES_3D ||
    receipt.materialTick !== from.tick ||
    receipt.externalEnergyQ !== '0' ||
    receipt.toCycle !== receipt.fromCycle + 1
  )
    throw Error('Reactive transport boundaries differ.');
  const entries = receipt.swaps.length * 4,
    status = !options ? 'disabled' : entries > options.maxEntries ? 'overflow' : 'complete';
  const paths: ReactiveTransportPaths3D = {
    rulesVersion: REACTIVE_TRANSPORT_MOTION_RULES_3D,
    transportRulesVersion: REACTIVE_TRANSPORT_RULES_3D,
    status,
    requiresReexecution: status !== 'complete',
    maxEntries: options?.maxEntries ?? 0,
    entries: status === 'complete' ? entries : 0,
    stepsObserved: receipt.swaps.length,
    passes: [],
  };
  const [w, h] = a.shape,
    n = a.shape.reduce((p, v) => p * v, 1),
    origins = Int32Array.from({ length: n }, (_, i) => i);
  const coordinate = (i: number): [number, number, number] => [
    i % w,
    Math.floor(i / w) % h,
    Math.floor(i / (w * h)),
  ];
  let cursor = 0;
  for (const parcel of receipt.parcels) {
    let cell = parcel.source;
    while (cell !== parcel.destination) {
      const swap = receipt.swaps[cursor];
      if (
        !swap ||
        swap[0] !== cell ||
        swap[1] < 0 ||
        swap[1] >= n ||
        origins[cell] !== parcel.source
      )
        throw Error('Reactive transport parcel correspondence differs.');
      const target = swap[1],
        start = coordinate(cell),
        end = coordinate(target),
        delta = end.map((v, i) => v - start[i]) as [number, number, number];
      const origin = origins[cell],
        displaced = origins[target],
        occupant = a.at(displaced);
      if (
        delta.reduce((sum, v) => sum + Math.abs(v), 0) !== 1 ||
        occupant.structure !== 0 ||
        ((occupant.packed >>> PHASE_SHIFT) & 15) !== PHASE.GAS
      )
        throw Error('Reactive transport swap differs from its rules.');
      if (status === 'complete')
        paths.passes.push({
          index: cursor,
          delta,
          controlledSources: [origin],
          segments: [
            { origin, from: cell, to: target, mode: 'linear', component: null },
            { origin: displaced, from: target, to: cell, mode: 'relocation', component: null },
          ].sort((x, y) => x.from - y.from) as ReactiveMotionSegment3D[],
        });
      origins[target] = origin;
      origins[cell] = displaced;
      cell = target;
      cursor++;
    }
  }
  if (cursor !== receipt.swaps.length) throw Error('Reactive transport has unaccounted swaps.');
  for (let i = 0; i < n; i++) {
    const initial = a.at(origins[i]),
      final = b.at(i);
    if (
      initial.packed !== final.packed ||
      initial.energyQ !== final.energyQ ||
      initial.structure !== final.structure
    )
      throw Error('Reactive transport paths differ from committed material history.');
  }
  const source = { before: a.token, after: b.token, from, to, paths };
  return () => {
    const value: ReactiveTransportMovement3D = {
      rulesVersion: REACTIVE_TRANSPORT_MOTION_RULES_3D,
      scope: 'reactive-transport-domain',
      from,
      to,
      paths: structuredClone(paths),
    };
    sources.set(value, source);
    return value;
  };
}
