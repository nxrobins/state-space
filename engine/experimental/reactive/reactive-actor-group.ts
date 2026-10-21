/** Reactive adapters for exact terrain/peer contacts and explicit group movement. */
import {
  BODY_GROUP_LIMITS_3D,
  createBodyGroupKernel3D,
  type NamedBody3D,
  type BodyGroupOptions3D,
} from '../body-group-kernel.js';
import {
  createActorGroupKernel3D,
  type ActorPeerContact3D,
  type ActorGroupKernel3D,
  type ActorGroupResult3D,
} from '../actor-group-kernel.js';
import {
  moveActorsKernel3D,
  ACTOR_MOVEMENT_KERNEL_LIMITS_3D,
  type ActorCommand3D,
  type ActorContactKernel3D,
  type ActorFootingKernel3D,
  type ActorMovementKernelResponse3D,
  type ActorMovementKernelResult3D,
} from '../actor-movement-kernel.js';
import {
  reactiveGeometrySource3D,
  type ReactiveGameplayGeometry3D,
  type ReactiveGeometryStamp3D,
} from './reactive-geometry.js';
import { readReactiveBody3D, type ReactiveBody3D } from './reactive-body.js';
import {
  createReactiveDisplacement3D,
  type ReactiveDisplacementResult3D,
} from './reactive-displacement.js';
import {
  createReactiveTranslationDisplacement3D,
  type ReactiveTranslationDisplacementResult3D,
} from './reactive-translation-displacement.js';
import type { ReactiveTickMovement3D } from './reactive-motion.js';
import type { ReactiveTranslationMovement3D } from './reactive-translation-motion.js';
import {
  createReactiveTransportDisplacement3D,
  type ReactiveTransportDisplacementResult3D,
} from './reactive-transport-displacement.js';
import type { ReactiveTransportMovement3D } from './reactive-transport-motion.js';
export const REACTIVE_ACTOR_GROUP_RULES_3D = 'reactive-actor-group-1';
export const REACTIVE_ACTOR_GROUP_LIMITS_3D = BODY_GROUP_LIMITS_3D;
export const REACTIVE_ACTOR_MOVEMENT_RULES_3D = 'reactive-actor-movement-1';
export const REACTIVE_ACTOR_MOVEMENT_LIMITS_3D = ACTOR_MOVEMENT_KERNEL_LIMITS_3D;
type S = Readonly<ReactiveGeometryStamp3D>;
type Response =
  | ReactiveDisplacementResult3D
  | ReactiveTranslationDisplacementResult3D
  | ReactiveTransportDisplacementResult3D;
type Scope = 'reactive-tick-domain' | 'reactive-translation-domain' | 'reactive-transport-domain';
export type NamedReactiveBody3D = NamedBody3D<ReactiveBody3D>;
export type ReactiveActorGroupOptions3D = BodyGroupOptions3D;
export type ReactiveActorPeerContact3D = ActorPeerContact3D;
export type ReactiveActorGroupResult3D = ActorGroupResult3D<
  typeof REACTIVE_ACTOR_GROUP_RULES_3D,
  S,
  ReactiveBody3D,
  Response,
  Scope
>;
export type ReactiveActorGroup3D = ActorGroupKernel3D<
  typeof REACTIVE_ACTOR_GROUP_RULES_3D,
  S,
  ReactiveBody3D,
  Response,
  Scope
>;
export function createReactiveActorGroup3D(
  before: ReactiveGameplayGeometry3D,
  after: ReactiveGameplayGeometry3D,
  movement: ReactiveTickMovement3D,
): ReactiveActorGroup3D {
  const source = createReactiveDisplacement3D(before, after, movement);
  const group = createBodyGroupKernel3D(
    before,
    after,
    'reactive-tick-domain',
    REACTIVE_ACTOR_GROUP_RULES_3D,
    source,
    readReactiveBody3D,
  );
  return createActorGroupKernel3D(before, group, REACTIVE_ACTOR_GROUP_RULES_3D, readReactiveBody3D);
}
export function createReactiveTranslatedActorGroup3D(
  before: ReactiveGameplayGeometry3D,
  after: ReactiveGameplayGeometry3D,
  movement: ReactiveTranslationMovement3D,
): ReactiveActorGroup3D {
  const source = createReactiveTranslationDisplacement3D(before, after, movement);
  const group = createBodyGroupKernel3D(
    before,
    after,
    'reactive-translation-domain',
    REACTIVE_ACTOR_GROUP_RULES_3D,
    source,
    readReactiveBody3D,
  );
  return createActorGroupKernel3D(before, group, REACTIVE_ACTOR_GROUP_RULES_3D, readReactiveBody3D);
}
export type ReactiveActorMovementCommand3D = ActorCommand3D;
export function createReactiveTransportedActorGroup3D(
  before: ReactiveGameplayGeometry3D,
  after: ReactiveGameplayGeometry3D,
  movement: ReactiveTransportMovement3D,
): ReactiveActorGroup3D {
  const source = createReactiveTransportDisplacement3D(before, after, movement);
  const group = createBodyGroupKernel3D(
    before,
    after,
    'reactive-transport-domain',
    REACTIVE_ACTOR_GROUP_RULES_3D,
    source,
    readReactiveBody3D,
  );
  return createActorGroupKernel3D(before, group, REACTIVE_ACTOR_GROUP_RULES_3D, readReactiveBody3D);
}
export type ReactiveActorMovementContact3D = ActorContactKernel3D;
export type ReactiveActorFooting3D = ActorFootingKernel3D<S>;
export type ReactiveActorMovementResponse3D = ActorMovementKernelResponse3D<S, ReactiveBody3D>;
export type ReactiveActorMovementResult3D = ActorMovementKernelResult3D<
  typeof REACTIVE_ACTOR_MOVEMENT_RULES_3D,
  S,
  ReactiveBody3D
>;
export function moveReactiveActors3D(
  view: ReactiveGameplayGeometry3D,
  bodies: readonly NamedReactiveBody3D[],
  commands: readonly ReactiveActorMovementCommand3D[] = [],
): ReactiveActorMovementResult3D {
  reactiveGeometrySource3D(view);
  return moveActorsKernel3D(
    view,
    bodies,
    commands,
    REACTIVE_ACTOR_MOVEMENT_RULES_3D,
    readReactiveBody3D,
  );
}
