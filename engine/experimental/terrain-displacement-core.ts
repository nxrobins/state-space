/** M5 adapter for the shared exact one-way contact solver. */
import { gameplayGeometrySource3D, type GameplayGeometry3D, type GeometryStamp3D } from './gameplay-geometry.js';
import { readTerrainBody3D, type TerrainBodyState3D } from './terrain-body.js';
import { createDisplacementKernel3D, type DisplacementCore3D as Core, type DisplacementSource3D as Source,
  type DisplacementResult3D as Result, type DisplacementCarry3D as Carry } from './displacement-kernel.js';
export { DISPLACEMENT_LIMITS_3D, displacementTrace3D, forwardDisplacementTrace3D } from './displacement-kernel.js';
export type { DisplacementTraceSegment3D, DisplacementContact3D, DisplacementOptions3D, DisplacementPass3D } from './displacement-kernel.js';
export type DisplacementResult3D<R extends string> = Result<R, Readonly<GeometryStamp3D>, TerrainBodyState3D>;
export type DisplacementCore3D<R extends string> = Core<R, Readonly<GeometryStamp3D>, TerrainBodyState3D>;
export type DisplacementSource3D<R extends string> = Source<R, Readonly<GeometryStamp3D>>;
export type DisplacementCarry3D = Carry<TerrainBodyState3D>;
export function createDisplacementCore3D<R extends string>(before: GameplayGeometry3D, after: GameplayGeometry3D, observed: DisplacementSource3D<R>): DisplacementCore3D<R> {
  const source = gameplayGeometrySource3D(before), target = gameplayGeometrySource3D(after);
  return createDisplacementKernel3D(before, after, observed, source, target.token, readTerrainBody3D);
}
