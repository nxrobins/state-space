import { moveActorsKernel3D } from './actor-movement-kernel.js';
/** Serial fixed-point actor movement. Does not step or modify material physics. */
import {
  assertGameplayGeometry3D,
  type GameplayGeometry3D,
  type GeometryStamp3D,
  type GeometryContact3D,
  type GeometryTime3D,
  type GeometryExposure3D,
} from './gameplay-geometry.js';
import {
  readTerrainBody3D,
  type TerrainBodyState3D,
  type BodySupport3D,
} from './terrain/terrain-body.js';
import type { NamedTerrainBody3D } from './terrain/terrain-body-group.js';

export const ACTOR_MOVEMENT_RULES_3D = 'actor-movement-1';
export const ACTOR_MOVEMENT_LIMITS_3D = Object.freeze({ bodies: 64, commands: 64 });
type V = [number, number, number];
export type ActorMovementCommand3D = {
  id: string;
  impulseQ?: readonly number[];
  accelerationQ?: readonly number[];
};
export type ActorFooting3D = {
  grounded: boolean;
  terrain: BodySupport3D;
  actors: { id: string; areaQ2: number }[];
};
export type ActorMovementContact3D = {
  axis: 0 | 1 | 2;
  requestedQ: number;
  travelledQ: number;
  obstacle:
    | { kind: 'terrain'; contact: GeometryContact3D }
    | { kind: 'actor'; id: string; time: GeometryTime3D; normal: V };
};
export type ActorMovementResponse3D = {
  id: string;
  body: TerrainBodyState3D;
  movedQ: V;
  segments: { axis: 0 | 1 | 2; fromMinQ: V; toMinQ: V; requestedQ: number; travelledQ: number }[];
  contacts: ActorMovementContact3D[];
  footingBefore: ActorFooting3D;
  footingAfter: ActorFooting3D;
  lostFooting: boolean;
  landed: boolean;
  exposure: GeometryExposure3D;
};
export type ActorMovementResult3D = {
  rulesVersion: typeof ACTOR_MOVEMENT_RULES_3D;
  stamp: Readonly<GeometryStamp3D>;
  status: 'resolved' | 'unresolved';
  bodyStep: number | null;
  bodies: NamedTerrainBody3D[];
  responses: ActorMovementResponse3D[];
  failure: {
    id: string;
    kind: 'outside' | 'embedded' | 'actor-overlap';
    actor: string | null;
  } | null;
};
export function moveTerrainActors3D(
  view: GameplayGeometry3D,
  input: readonly NamedTerrainBody3D[],
  commands: readonly ActorMovementCommand3D[] = [],
): ActorMovementResult3D {
  assertGameplayGeometry3D(view);
  return moveActorsKernel3D(view, input, commands, ACTOR_MOVEMENT_RULES_3D, readTerrainBody3D);
}
