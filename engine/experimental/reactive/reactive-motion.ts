/** Live provenance for disposable executed tick observations. Never imported as a save. */
import {
  reactiveGeometrySource3D,
  type ReactiveGameplayGeometry3D,
  type ReactiveGeometryStamp3D,
} from './reactive-geometry.js';
import {
  REACTIVE_MOTION_RULES_3D,
  type ReactiveMotionReport3D,
} from './reactive-motion-capture.js';
export type ReactiveTickMovement3D = {
  rulesVersion: typeof REACTIVE_MOTION_RULES_3D;
  scope: 'reactive-tick-domain';
  from: Readonly<ReactiveGeometryStamp3D>;
  to: Readonly<ReactiveGeometryStamp3D>;
  status: 'disabled' | 'complete' | 'overflow';
  requiresReexecution: boolean;
  trace: ReactiveMotionReport3D | null;
};
const sources = new WeakMap<
  ReactiveTickMovement3D,
  {
    before: object;
    after: object;
    from: Readonly<ReactiveGeometryStamp3D>;
    to: Readonly<ReactiveGeometryStamp3D>;
    trace: ReactiveMotionReport3D | null;
  }
>();
export function reactiveTickMovementSource3D(value: ReactiveTickMovement3D) {
  const source = sources.get(value);
  if (!source) throw Error('Expected a live reactive tick movement observation.');
  return source;
}
/** Internal coordinator boundary: no public records can supply observation provenance. */
export function bindReactiveTickMovement3D(
  before: ReactiveGameplayGeometry3D,
  after: ReactiveGameplayGeometry3D,
  status: ReactiveTickMovement3D['status'],
  trace: ReactiveMotionReport3D | null,
): ReactiveTickMovement3D {
  const a = reactiveGeometrySource3D(before),
    b = reactiveGeometrySource3D(after),
    from = before.stamp,
    to = after.stamp;
  if (
    from.kind !== 'preview' ||
    to.kind !== 'preview' ||
    from.domain !== to.domain ||
    from.tick + 1 !== to.tick ||
    from.branchId !== to.branchId ||
    from.completedCommands !== to.completedCommands ||
    from.completedTicks + 1 !== to.completedTicks ||
    from.horizonTicks !== to.horizonTicks ||
    JSON.stringify(from.base) !== JSON.stringify(to.base) ||
    from.worldRulesVersion !== to.worldRulesVersion ||
    a.shape.some((v, i) => v !== b.shape[i])
  )
    throw Error('Reactive movement boundaries differ.');
  if (
    status === 'complete' &&
    (!trace ||
      trace.status !== 'complete' ||
      trace.fromTick !== from.tick ||
      trace.toTick !== to.tick ||
      trace.materialCatalogHash !== from.base.materialCatalogHash ||
      trace.worldRulesVersion !== from.worldRulesVersion ||
      a.shape.some((v, i) => v !== [trace.width, trace.height, trace.depth][i]))
  )
    throw Error('Reactive movement trace differs from its boundaries.');
  const owned = status === 'complete' ? structuredClone(trace) : null;
  const value: ReactiveTickMovement3D = {
    rulesVersion: REACTIVE_MOTION_RULES_3D,
    scope: 'reactive-tick-domain',
    from,
    to,
    status,
    requiresReexecution: status !== 'complete',
    trace: structuredClone(owned),
  };
  sources.set(value, { before: a.token, after: b.token, from, to, trace: owned });
  return value;
}
