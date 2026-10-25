import { createBodyGroupKernel3D } from '../gameplay/body-group-kernel.js';
/** Bounded group queries. Terrain and game publication remain session operations. */
import { readTerrainBody3D, type TerrainBodyState3D } from './terrain-body.js';
import {
  createTerrainDisplacement3D,
  type TerrainDisplacementResult3D,
} from './terrain-displacement.js';
import {
  createTranslationDisplacement3D,
  TRANSLATION_DISPLACEMENT_LIMITS_3D,
  type TranslationDisplacementResult3D,
} from '../gameplay/translation-displacement.js';
import type { GameplayGeometry3D, GeometryStamp3D } from '../gameplay/gameplay-geometry.js';
import type { TickMovement3D } from '../gameplay/path-journal.js';
import type { TranslationMovement3D } from '../gameplay/translation-paths.js';

export const TERRAIN_BODY_GROUP_RULES_3D = 'terrain-body-group-1';
export const TERRAIN_BODY_GROUP_LIMITS_3D = Object.freeze({
  ...TRANSLATION_DISPLACEMENT_LIMITS_3D,
  bodies: 64,
});
export type NamedTerrainBody3D = { id: string; body: TerrainBodyState3D };
export type TerrainBodyGroupOptions3D = {
  maxWork?: number;
  maxEvents?: number;
  maxContacts?: number;
  maxCarryEntries?: number;
};
export type BodyDisplacementResponse3D =
  TerrainDisplacementResult3D | TranslationDisplacementResult3D;
export type TerrainBodyGroupResult3D = {
  rulesVersion: typeof TERRAIN_BODY_GROUP_RULES_3D;
  scope: 'logical-tick-domain' | 'translation';
  from: Readonly<GeometryStamp3D>;
  to: Readonly<GeometryStamp3D>;
  status: 'resolved' | 'unresolved' | 'incomplete';
  requiresReexecution: boolean;
  bodies: NamedTerrainBody3D[];
  responses: { id: string; response: BodyDisplacementResponse3D }[];
  failure: { id: string; response: BodyDisplacementResponse3D } | null;
  evaluatedBodies: number;
  work: number;
  events: number;
};
export interface TerrainBodyGroup3D {
  readonly rulesVersion: typeof TERRAIN_BODY_GROUP_RULES_3D;
  readonly scope: TerrainBodyGroupResult3D['scope'];
  readonly from: Readonly<GeometryStamp3D>;
  readonly to: Readonly<GeometryStamp3D>;
  resolve(
    bodies: readonly NamedTerrainBody3D[],
    options?: TerrainBodyGroupOptions3D,
  ): TerrainBodyGroupResult3D;
}
export function createTerrainBodyGroup3D(
  before: GameplayGeometry3D,
  after: GameplayGeometry3D,
  movement: TickMovement3D,
): TerrainBodyGroup3D {
  const source = createTerrainDisplacement3D(before, after, movement);
  return createBodyGroupKernel3D(
    before,
    after,
    'logical-tick-domain',
    TERRAIN_BODY_GROUP_RULES_3D,
    {
      from: source.from,
      to: source.to,
      resolve(body, limits) {
        return source.resolve(body, {
          maxWork: limits.maxWork,
          maxEvents: limits.maxEvents,
          maxContacts: limits.maxContacts,
        });
      },
    },
    readTerrainBody3D,
  );
}
export function createTranslationBodyGroup3D(
  before: GameplayGeometry3D,
  after: GameplayGeometry3D,
  movement: TranslationMovement3D,
): TerrainBodyGroup3D {
  const source = createTranslationDisplacement3D(before, after, movement);
  return createBodyGroupKernel3D(
    before,
    after,
    'translation',
    TERRAIN_BODY_GROUP_RULES_3D,
    source,
    readTerrainBody3D,
  );
}
