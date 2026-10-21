/** Tick adapter for the unchanged terrain-displacement-1 response contract. */
import type { GameplayGeometry3D, GeometryStamp3D } from '../gameplay-geometry.js';
import { tickMovementSource3D, type TickMovement3D } from '../path-journal.js';
import type { TerrainBodyState3D } from './terrain-body.js';
import {
  createDisplacementCore3D,
  DISPLACEMENT_LIMITS_3D,
  type DisplacementContact3D,
  type DisplacementOptions3D,
  type DisplacementResult3D,
} from './terrain-displacement-core.js';

export const TERRAIN_DISPLACEMENT_RULES_3D = 'terrain-displacement-1';
export const TERRAIN_DISPLACEMENT_LIMITS_3D = DISPLACEMENT_LIMITS_3D;
export type TerrainDisplacementContact3D = DisplacementContact3D;
export type TerrainDisplacementOptions3D = DisplacementOptions3D;
export type TerrainDisplacementResult3D = DisplacementResult3D<
  typeof TERRAIN_DISPLACEMENT_RULES_3D
>;
export interface TerrainDisplacement3D {
  readonly rulesVersion: typeof TERRAIN_DISPLACEMENT_RULES_3D;
  readonly from: Readonly<GeometryStamp3D>;
  readonly to: Readonly<GeometryStamp3D>;
  resolve(
    body: TerrainBodyState3D,
    options?: TerrainDisplacementOptions3D,
  ): TerrainDisplacementResult3D;
}
export function createTerrainDisplacement3D(
  before: GameplayGeometry3D,
  after: GameplayGeometry3D,
  movement: TickMovement3D,
): TerrainDisplacement3D {
  const observed = tickMovementSource3D(movement),
    frame = observed.frame;
  const complete =
    !!frame && frame.motion.status === 'complete' && frame.paths.status === 'complete';
  const members = new Map<number, number>();
  if (complete)
    for (const f of frame.motion.fragments)
      for (const [start, length] of f.sourceRuns)
        for (let i = start; i < start + length; i++) members.set(i, f.id);
  const solver = createDisplacementCore3D(before, after, {
    ...observed,
    rulesVersion: TERRAIN_DISPLACEMENT_RULES_3D,
    complete,
    members,
    passes: complete ? frame.paths.passes : [],
    lastPass: 27,
  });
  return Object.freeze<TerrainDisplacement3D>({
    rulesVersion: TERRAIN_DISPLACEMENT_RULES_3D,
    from: solver.from,
    to: solver.to,
    resolve(body, options) {
      return solver.resolve(body, options);
    },
  });
}
