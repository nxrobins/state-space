import { assertRecordFields } from '../../portable-data.js';
import { stepBodyKernel3D } from '../body-kernel.js';
/** Fixed-point kinematic body resolution against one immutable terrain boundary. */
import { assertGameplayGeometry3D, GEOMETRY_RULES_VERSION_3D, GEOMETRY_LIMITS_3D, GEOMETRY_SCALE_3D,
  type GameplayGeometry3D, type GeometryBox3D, type GeometryContact3D, type GeometryExposure3D, type GeometryStamp3D } from '../gameplay-geometry.js';

export const TERRAIN_BODY_RULES_VERSION_3D = 'terrain-body-1';
export const TERRAIN_BODY_LIMITS_3D = Object.freeze({sizeQ: 8 * GEOMETRY_SCALE_3D, velocityQ: 32 * GEOMETRY_SCALE_3D, gravityQ: GEOMETRY_SCALE_3D, defaultGravityQ: 64});
type Vector = [number, number, number];
export type TerrainBodyState3D = {
  rulesVersion: typeof TERRAIN_BODY_RULES_VERSION_3D; geometryRulesVersion: typeof GEOMETRY_RULES_VERSION_3D;
  worldId: string; domain: string | null; physicsRulesVersion: string; materialCatalogHash: string;
  step: number; minQ: Vector; sizeQ: Vector; velocityQ: Vector; gravityQ: number; grounded: boolean;
};
export type TerrainBodyInitial3D = {minQ: readonly number[]; sizeQ: readonly number[]; velocityQ?: readonly number[]; gravityQ?: number};
export type TerrainBodyCommand3D = {impulseQ?: readonly number[]; accelerationQ?: readonly number[]};
export type BodySupport3D = ReturnType<GameplayGeometry3D['support']>;
export type TerrainBodyResolution3D = {
  rulesVersion: typeof TERRAIN_BODY_RULES_VERSION_3D; stamp: Readonly<GeometryStamp3D>;
  status: 'resolved' | 'embedded' | 'outside'; body: TerrainBodyState3D; movedQ: Vector;
  lostFooting: boolean; landed: boolean;
  initialBlocker: ReturnType<GameplayGeometry3D['fit']>['blocker'];
  contacts: {axis: 0 | 1 | 2; requestedQ: number; travelledQ: number; contact: GeometryContact3D}[];
  supportBefore: BodySupport3D | null; supportAfter: BodySupport3D | null; exposure: GeometryExposure3D;
};
function fields(value: object, required: readonly string[], optional: readonly string[] = []): void {
  assertRecordFields(value, required, optional, 'Invalid terrain body fields.');
}
function integer(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Error('Invalid terrain body integer.'); return value === 0 ? 0 : value;
}
function vector(value: readonly number[], min: number, max: number): Vector {
  if (!Array.isArray(value) || value.length !== 3 || Reflect.ownKeys(value).length !== 4) throw Error('Expected three body coordinates.');
  const result: Vector = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !('value' in d) || !d.enumerable) throw Error('Body coordinates must be dense data.');
    result[i] = integer(d.value, min, max);
  }
  return result;
}
function speed(value: readonly number[]): Vector {return vector(value, -TERRAIN_BODY_LIMITS_3D.velocityQ, TERRAIN_BODY_LIMITS_3D.velocityQ);}
function binding(view: GameplayGeometry3D) {
  assertGameplayGeometry3D(view);
  const revision = view.stamp.kind === 'committed' ? view.stamp.revision : view.stamp.base;
  return {worldId: revision.worldId, domain: view.stamp.domain, physicsRulesVersion: revision.physicsRulesVersion, materialCatalogHash: revision.materialCatalogHash};
}
function bodyBox(body: Pick<TerrainBodyState3D, 'minQ' | 'sizeQ'>): GeometryBox3D {
  return {minQ: [...body.minQ], maxQ: body.minQ.map((v, axis) => integer(v + body.sizeQ[axis], -GEOMETRY_LIMITS_3D.coordinateQ, GEOMETRY_LIMITS_3D.coordinateQ)) as Vector};
}
/** Validate/copy a portable save; geometry collision is evaluated by resolution. */
export function readTerrainBody3D(view: GameplayGeometry3D, value: TerrainBodyState3D): TerrainBodyState3D {
  const identity = binding(view);
  fields(value, ['rulesVersion', 'geometryRulesVersion', 'worldId', 'domain', 'physicsRulesVersion', 'materialCatalogHash', 'step', 'minQ', 'sizeQ', 'velocityQ', 'gravityQ', 'grounded']);
  if (value.rulesVersion !== TERRAIN_BODY_RULES_VERSION_3D || value.geometryRulesVersion !== GEOMETRY_RULES_VERSION_3D ||
      Object.entries(identity).some(([key, expected]) => value[key as keyof typeof identity] !== expected) || typeof value.grounded !== 'boolean') throw Error('Incompatible terrain body state.');
  const result: TerrainBodyState3D = {...identity, rulesVersion: TERRAIN_BODY_RULES_VERSION_3D, geometryRulesVersion: GEOMETRY_RULES_VERSION_3D,
    step: integer(value.step, 0, Number.MAX_SAFE_INTEGER), minQ: vector(value.minQ, -GEOMETRY_LIMITS_3D.coordinateQ, GEOMETRY_LIMITS_3D.coordinateQ),
    sizeQ: vector(value.sizeQ, 1, TERRAIN_BODY_LIMITS_3D.sizeQ), velocityQ: speed(value.velocityQ), gravityQ: integer(value.gravityQ, 0, TERRAIN_BODY_LIMITS_3D.gravityQ), grounded: value.grounded};
  bodyBox(result); return result;
}
export function createTerrainBody3D(view: GameplayGeometry3D, input: TerrainBodyInitial3D): TerrainBodyState3D {
  const identity = binding(view); fields(input, ['minQ', 'sizeQ'], ['velocityQ', 'gravityQ']);
  const body = readTerrainBody3D(view, {...identity, rulesVersion: TERRAIN_BODY_RULES_VERSION_3D, geometryRulesVersion: GEOMETRY_RULES_VERSION_3D, step: 0,
    minQ: vector(input.minQ, -GEOMETRY_LIMITS_3D.coordinateQ, GEOMETRY_LIMITS_3D.coordinateQ), sizeQ: vector(input.sizeQ, 1, TERRAIN_BODY_LIMITS_3D.sizeQ),
    velocityQ: Object.hasOwn(input, 'velocityQ') && input.velocityQ !== undefined ? speed(input.velocityQ) : [0, 0, 0],
    gravityQ: Object.hasOwn(input, 'gravityQ') && input.gravityQ !== undefined ? input.gravityQ : TERRAIN_BODY_LIMITS_3D.defaultGravityQ, grounded: false});
  const support = view.support({box: bodyBox(body), maxDropQ: 0});
  if (!support.bodyFits) throw Error('Cannot create an overlapping or outside terrain body.');
  body.grounded = support.distanceQ === 0; return body;
}

/** One actor step. The caller chooses when it occurs relative to material ticks. */
export function stepTerrainBody3D(view: GameplayGeometry3D, input: TerrainBodyState3D, command: TerrainBodyCommand3D = {}): TerrainBodyResolution3D {
  return stepBodyKernel3D(view, input, command, TERRAIN_BODY_RULES_VERSION_3D, readTerrainBody3D);
}
