import { createActorGroupKernel3D } from './actor-group-kernel.js';
/** Exact peer contact detection over the existing one-way terrain responses. */
import { createTerrainBodyGroup3D, createTranslationBodyGroup3D, TERRAIN_BODY_GROUP_LIMITS_3D,
  type TerrainBodyGroup3D, type TerrainBodyGroupOptions3D, type TerrainBodyGroupResult3D, type NamedTerrainBody3D } from './terrain-body-group.js';
import { readTerrainBody3D } from './terrain-body.js';
import type { GameplayGeometry3D, GeometryTime3D } from './gameplay-geometry.js';
import type { TickMovement3D } from './path-journal.js';
import type { TranslationMovement3D } from './translation-paths.js';

export const TERRAIN_ACTOR_GROUP_RULES_3D = 'terrain-actor-group-1';
export const TERRAIN_ACTOR_GROUP_LIMITS_3D = TERRAIN_BODY_GROUP_LIMITS_3D;
type V = [number, number, number];
type F = GeometryTime3D;
export type TerrainActorPeerContact3D = {
  first: string; second: string; kind: 'initial-overlap' | 'swept-overlap';
  pass: number | null; time: F; normal: V;
};
export type TerrainActorGroupResult3D = Omit<TerrainBodyGroupResult3D, 'rulesVersion'> & {
  rulesVersion: typeof TERRAIN_ACTOR_GROUP_RULES_3D;
  reason: 'terrain-response' | 'peer-contact' | 'peer-budget' | null;
  peerContact: TerrainActorPeerContact3D | null; peerWork: number;
};
export interface TerrainActorGroup3D extends Omit<TerrainBodyGroup3D, 'rulesVersion' | 'resolve'> {
  readonly rulesVersion: typeof TERRAIN_ACTOR_GROUP_RULES_3D;
  resolve(bodies: readonly NamedTerrainBody3D[], options?: TerrainBodyGroupOptions3D): TerrainActorGroupResult3D;
}
export function createTerrainActorGroup3D(before: GameplayGeometry3D, after: GameplayGeometry3D, movement: TickMovement3D): TerrainActorGroup3D {
  return createActorGroupKernel3D(before, createTerrainBodyGroup3D(before, after, movement), TERRAIN_ACTOR_GROUP_RULES_3D, readTerrainBody3D);
}
export function createTranslatedActorGroup3D(before: GameplayGeometry3D, after: GameplayGeometry3D, movement: TranslationMovement3D): TerrainActorGroup3D {
  return createActorGroupKernel3D(before, createTranslationBodyGroup3D(before, after, movement), TERRAIN_ACTOR_GROUP_RULES_3D, readTerrainBody3D);
}
