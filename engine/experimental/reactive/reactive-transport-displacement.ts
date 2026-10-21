/** Exact actor response to serial controlled parcels, not stationary controllers. */
import type { ReactiveGameplayGeometry3D } from './reactive-geometry.js';
import { DISPLACEMENT_CARRY_LIMITS_3D } from '../displacement-carry-options.js';
import {
  createReactiveControlledDisplacement3D,
  type ReactiveControlledDisplacement3D,
  type ReactiveControlledDisplacementResult3D,
} from './reactive-controlled-displacement.js';
import {
  reactiveTransportMovementSource3D,
  type ReactiveTransportMovement3D,
} from './reactive-transport-motion.js';
export const REACTIVE_TRANSPORT_DISPLACEMENT_RULES_3D = 'reactive-transport-displacement-1';
export const REACTIVE_TRANSPORT_DISPLACEMENT_LIMITS_3D = DISPLACEMENT_CARRY_LIMITS_3D;
export type ReactiveTransportDisplacementResult3D = ReactiveControlledDisplacementResult3D<
  typeof REACTIVE_TRANSPORT_DISPLACEMENT_RULES_3D
>;
export type ReactiveTransportDisplacement3D = ReactiveControlledDisplacement3D<
  typeof REACTIVE_TRANSPORT_DISPLACEMENT_RULES_3D
>;
export function createReactiveTransportDisplacement3D(
  before: ReactiveGameplayGeometry3D,
  after: ReactiveGameplayGeometry3D,
  movement: ReactiveTransportMovement3D,
): ReactiveTransportDisplacement3D {
  const source = reactiveTransportMovementSource3D(movement),
    controlled = source.paths.passes.map((p) => new Set(p.controlledSources));
  return createReactiveControlledDisplacement3D(
    before,
    after,
    source,
    REACTIVE_TRANSPORT_DISPLACEMENT_RULES_3D,
    (pass) => controlled[pass],
  );
}
