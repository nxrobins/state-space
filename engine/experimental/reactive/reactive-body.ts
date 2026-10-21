/** Game-owned kinematic bodies for catalog-aware reactive boundaries. */
import { GEOMETRY_LIMITS_3D } from '../geometry-kernel.js';
import {
  reactiveGeometrySource3D,
  REACTIVE_GEOMETRY_RULES_3D,
  type ReactiveGameplayGeometry3D,
  type ReactiveGeometryStamp3D,
} from './reactive-geometry.js';
import { REACTIVE_WORLD_COMPONENTS_3D } from './reactive-world-tick.js';
import {
  BODY_LIMITS_3D,
  bodyFields3D,
  bodyVector3D,
  readKinematicBody3D,
  stepBodyKernel3D,
  type KinematicBody3D,
  type BodyCommand3D,
  type BodyKernelResult3D,
} from '../body-kernel.js';
export const REACTIVE_BODY_RULES_3D = 'reactive-body-1';
export const REACTIVE_BODY_LIMITS_3D = BODY_LIMITS_3D;
export type ReactiveBody3D = KinematicBody3D & {
  rulesVersion: typeof REACTIVE_BODY_RULES_3D;
  geometryRulesVersion: typeof REACTIVE_GEOMETRY_RULES_3D;
  worldId: string;
  domain: string | null;
  materialCatalogHash: string;
  evolutionRulesVersion: string;
  structureRulesVersion: string;
};
export type ReactiveBodyInitial3D = {
  minQ: readonly number[];
  sizeQ: readonly number[];
  velocityQ?: readonly number[];
  gravityQ?: number;
};
export type ReactiveBodyCommand3D = BodyCommand3D;
export type ReactiveBodyResolution3D = BodyKernelResult3D<
  typeof REACTIVE_BODY_RULES_3D,
  Readonly<ReactiveGeometryStamp3D>,
  ReactiveBody3D
>;
function binding(view: ReactiveGameplayGeometry3D) {
  reactiveGeometrySource3D(view);
  const revision = view.stamp.kind === 'committed' ? view.stamp.revision : view.stamp.base;
  return {
    worldId: revision.worldId,
    domain: view.stamp.domain,
    materialCatalogHash: revision.materialCatalogHash,
    evolutionRulesVersion: REACTIVE_WORLD_COMPONENTS_3D.evolution,
    structureRulesVersion: REACTIVE_WORLD_COMPONENTS_3D.structure,
  };
}
export function readReactiveBody3D(
  view: ReactiveGameplayGeometry3D,
  input: ReactiveBody3D,
): ReactiveBody3D {
  const identity = binding(view);
  bodyFields3D(input, [
    'rulesVersion',
    'geometryRulesVersion',
    'worldId',
    'domain',
    'materialCatalogHash',
    'evolutionRulesVersion',
    'structureRulesVersion',
    'step',
    'minQ',
    'sizeQ',
    'velocityQ',
    'gravityQ',
    'grounded',
  ]);
  if (
    input.rulesVersion !== REACTIVE_BODY_RULES_3D ||
    input.geometryRulesVersion !== REACTIVE_GEOMETRY_RULES_3D ||
    Object.entries(identity).some(([k, value]) => input[k as keyof typeof identity] !== value)
  )
    throw Error('Incompatible reactive body state.');
  return {
    ...identity,
    rulesVersion: REACTIVE_BODY_RULES_3D,
    geometryRulesVersion: REACTIVE_GEOMETRY_RULES_3D,
    ...readKinematicBody3D(input),
  };
}
export function createReactiveBody3D(
  view: ReactiveGameplayGeometry3D,
  input: ReactiveBodyInitial3D,
): ReactiveBody3D {
  const identity = binding(view);
  bodyFields3D(input, ['minQ', 'sizeQ'], ['velocityQ', 'gravityQ']);
  const limit = GEOMETRY_LIMITS_3D.coordinateQ,
    body = readReactiveBody3D(view, {
      ...identity,
      rulesVersion: REACTIVE_BODY_RULES_3D,
      geometryRulesVersion: REACTIVE_GEOMETRY_RULES_3D,
      step: 0,
      minQ: bodyVector3D(input.minQ, -limit, limit),
      sizeQ: bodyVector3D(input.sizeQ, 1, BODY_LIMITS_3D.sizeQ),
      velocityQ:
        input.velocityQ === undefined
          ? [0, 0, 0]
          : bodyVector3D(input.velocityQ, -BODY_LIMITS_3D.velocityQ, BODY_LIMITS_3D.velocityQ),
      gravityQ: input.gravityQ === undefined ? BODY_LIMITS_3D.defaultGravityQ : input.gravityQ,
      grounded: false,
    });
  const support = view.support({
    box: {
      minQ: body.minQ,
      maxQ: body.minQ.map((v, i) => v + body.sizeQ[i]) as [number, number, number],
    },
    maxDropQ: 0,
  });
  if (!support.bodyFits) throw Error('Cannot create an overlapping or outside reactive body.');
  body.grounded = support.distanceQ === 0;
  return body;
}
export function stepReactiveBody3D(
  view: ReactiveGameplayGeometry3D,
  body: ReactiveBody3D,
  command: ReactiveBodyCommand3D = {},
): ReactiveBodyResolution3D {
  return stepBodyKernel3D(view, body, command, REACTIVE_BODY_RULES_3D, readReactiveBody3D);
}
