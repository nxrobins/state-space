/** Disposable rendering data. No stepping, structural solve or authority. */
import { checkedInteger } from '../../validation.js';
import { fields, revisionOf, sameRevision, snapshotData } from './tactical-worker-wire.js';
import {
  GEOMETRY_RULES_VERSION_3D,
  GEOMETRY_SCALE_3D,
  type GeometryBox3D,
  type GeometryStamp3D,
  type GeometryVector3D,
} from '../gameplay/gameplay-geometry.js';
import type {
  TacticalPreview3D,
  TacticalSessionSnapshot3D,
  TacticalValue,
} from './tactical-session-view.js';

export const TACTICAL_RENDER_CONTRACT_3D = 'tactical-render-1';
export const TACTICAL_RENDER_LIMITS_3D = Object.freeze({
  cells: 128 ** 3,
  actors: 64,
  overlays: 256,
  targetSize: 8192,
});
export const TACTICAL_RENDER_COORDINATES_3D = Object.freeze({
  voxelSize: 1,
  fixedPointScale: GEOMETRY_SCALE_3D,
  gravityAxis: '+Y',
  depthRange: '0..1',
});
export type TacticalDecoration3D = {
  id: string;
  box: GeometryBox3D;
  color: readonly [number, number, number, number];
};
export type TacticalDecorations3D = {
  stamp: Readonly<GeometryStamp3D>;
  actors: readonly TacticalDecoration3D[];
  overlays: readonly TacticalDecoration3D[];
};
export interface TacticalScene3D {
  readonly contract: typeof TACTICAL_RENDER_CONTRACT_3D;
  readonly stamp: Readonly<GeometryStamp3D>;
  readonly shape: readonly [number, number, number];
  readonly actors: number;
  readonly overlays: number;
}
type Data = { grid: Uint32Array; actors: Float32Array; overlays: Float32Array };
const scenes = new WeakMap<TacticalScene3D, Data>();
export function sceneData(scene: TacticalScene3D): Data {
  const data = scenes.get(scene);
  if (!data) throw Error('Expected a prepared tactical scene.');
  return data;
}
export function copyStamp(s: Readonly<GeometryStamp3D>): Readonly<GeometryStamp3D> {
  return s.kind === 'committed'
    ? Object.freeze({ ...s, revision: Object.freeze({ ...s.revision }) })
    : Object.freeze({ ...s, base: Object.freeze({ ...s.base }) });
}
function sameStamp(raw: unknown, expected: Readonly<GeometryStamp3D>) {
  fields(raw, Object.keys(expected));
  const revision = expected.kind === 'committed' ? expected.revision : expected.base;
  return Object.entries(expected).every(([k, v]) =>
    k === 'revision' || k === 'base' ? sameRevision(raw[k], revision) : raw[k] === v,
  );
}
export function denseData<T>(raw: readonly T[], max: number): T[] {
  if (!Array.isArray(raw) || raw.length > max || Reflect.ownKeys(raw).length !== raw.length + 1)
    throw Error('Expected a bounded dense data array.');
  return Array.from({ length: raw.length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(raw, String(i));
    if (!d || !('value' in d) || !d.enumerable) throw Error('Expected dense data elements.');
    return d.value;
  });
}
function decorations(
  raw: readonly TacticalDecoration3D[],
  shape: readonly number[],
  actor: boolean,
): Float32Array {
  const values = denseData(
    raw,
    actor ? TACTICAL_RENDER_LIMITS_3D.actors : TACTICAL_RENDER_LIMITS_3D.overlays,
  );
  const ids = new Set<string>(),
    result = new Float32Array(values.length * 12);
  values.forEach((value, i) => {
    fields(value, ['id', 'box', 'color']);
    fields(value.box, ['minQ', 'maxQ']);
    if (
      typeof value.id !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value.id) ||
      ids.has(value.id)
    )
      throw Error('Invalid or duplicate decoration identity.');
    ids.add(value.id);
    const min = denseData(value.box.minQ, 3),
      max = denseData(value.box.maxQ, 3),
      color = denseData(value.color, 4);
    if (
      min.length !== 3 ||
      max.length !== 3 ||
      color.length !== 4 ||
      color.some((v) => !Number.isFinite(v) || v < 0 || v > 1) ||
      (actor && color[3] !== 1)
    )
      throw Error('Invalid decoration color or shape.');
    min.forEach((v, axis) => {
      checkedInteger(v, 0, shape[axis] * GEOMETRY_SCALE_3D, 'decoration minimum');
      checkedInteger(max[axis], v + 1, shape[axis] * GEOMETRY_SCALE_3D, 'decoration maximum');
    });
    result.set(
      [
        ...min.map((v) => v / GEOMETRY_SCALE_3D),
        0,
        ...max.map((v, axis) => (v - min[axis]) / GEOMETRY_SCALE_3D),
        0,
        ...color,
      ],
      i * 12,
    );
  });
  return result;
}

/** Full validation and copies can be expensive. Prepare only on a published state change. */
export function prepareTacticalScene3D<T extends TacticalValue>(
  raw: TacticalSessionSnapshot3D<T> | TacticalPreview3D<T>,
  objects?: TacticalDecorations3D,
): TacticalScene3D {
  if (!raw || typeof raw !== 'object') throw Error('Expected a tactical snapshot.');
  const hasPreview = Object.hasOwn(raw, 'preview');
  let stamp: Readonly<GeometryStamp3D>, snapshot: TacticalSessionSnapshot3D<T>;
  if (hasPreview) {
    fields(raw, [
      'schemaVersion',
      'rulesVersion',
      'interventionRulesVersion',
      'constraintRulesVersion',
      'holds',
      'storageRulesVersion',
      'reservoirs',
      'worldId',
      'gameRulesVersion',
      'revision',
      'terrain',
      'game',
      'accounting',
      'preview',
    ]);
    const { preview, ...state } = raw as TacticalPreview3D<T>;
    fields(preview, ['base', 'branchId', 'operation', 'horizonTicks', 'completedTicks']);
    snapshot = snapshotData<T>(state);
    const horizon = checkedInteger(preview.horizonTicks, 0, 1024, 'preview horizon');
    checkedInteger(preview.branchId, 1, Number.MAX_SAFE_INTEGER, 'preview branch');
    checkedInteger(preview.operation, 1, 256, 'preview operation');
    const base = { ...revisionOf(snapshot), tick: snapshot.terrain.tick - horizon };
    if (base.tick < 0 || preview.completedTicks !== horizon || !sameRevision(preview.base, base))
      throw Error('Presentation requires a complete matching preview.');
    stamp = copyStamp({
      rulesVersion: GEOMETRY_RULES_VERSION_3D,
      domain: null,
      tick: snapshot.terrain.tick,
      kind: 'preview',
      ...preview,
      base,
    });
  } else {
    snapshot = snapshotData<T>(raw);
    stamp = copyStamp({
      rulesVersion: GEOMETRY_RULES_VERSION_3D,
      domain: null,
      tick: snapshot.terrain.tick,
      kind: 'committed',
      revision: revisionOf(snapshot),
    });
  }
  const shape = Object.freeze([
    snapshot.terrain.width,
    snapshot.terrain.height,
    snapshot.terrain.depth,
  ] as const);
  if (
    shape.some((v) => v > 128) ||
    shape.reduce((a, b) => a * b, 1) > TACTICAL_RENDER_LIMITS_3D.cells
  )
    throw Error('Presentation exceeds the finite volume bound.');
  let actors = new Float32Array(0),
    overlays = new Float32Array(0);
  if (objects !== undefined) {
    fields(objects, ['stamp', 'actors', 'overlays']);
    if (!sameStamp(objects.stamp, stamp))
      throw Error('Decorations belong to a different physical state.');
    actors = decorations(objects.actors, shape, true);
    overlays = decorations(objects.overlays, shape, false);
  }
  const scene: TacticalScene3D = Object.freeze({
    contract: TACTICAL_RENDER_CONTRACT_3D,
    stamp,
    shape,
    actors: actors.length / 12,
    overlays: overlays.length / 12,
  });
  scenes.set(scene, { grid: Uint32Array.from(snapshot.terrain.packedCells), actors, overlays });
  return scene;
}

export type TacticalCamera3D = {
  eye: GeometryVector3D;
  right: GeometryVector3D;
  up: GeometryVector3D;
  forward: GeometryVector3D;
  fovY: number;
  near: number;
  far: number;
};
const dot = (a: readonly number[], b: ArrayLike<number>) =>
  a.reduce((sum, v, i) => sum + v * b[i], 0);
export function cameraData(
  raw: TacticalCamera3D,
  width: number,
  height: number,
  shape: readonly number[],
): ArrayBuffer {
  fields(raw, ['eye', 'right', 'up', 'forward', 'fovY', 'near', 'far']);
  checkedInteger(width, 1, TACTICAL_RENDER_LIMITS_3D.targetSize, 'target width');
  checkedInteger(height, 1, TACTICAL_RENDER_LIMITS_3D.targetSize, 'target height');
  const vectors = [raw.eye, raw.right, raw.up, raw.forward].map((v) => {
    const a = denseData(v, 3);
    if (a.length !== 3 || a.some((n) => !Number.isFinite(n) || Math.abs(n) > 4096))
      throw Error('Invalid camera vector.');
    return a;
  });
  for (let i = 1; i < 4; i++) {
    if (Math.abs(dot(vectors[i], vectors[i]) - 1) > 0.0001)
      throw Error('Camera axes must be unit length.');
    for (let j = i + 1; j < 4; j++)
      if (Math.abs(dot(vectors[i], vectors[j])) > 0.0001)
        throw Error('Camera axes must be orthogonal.');
  }
  if (
    ![raw.fovY, raw.near, raw.far].every(Number.isFinite) ||
    raw.fovY < 0.1 ||
    raw.fovY > 3 ||
    raw.near < 0.01 ||
    raw.far <= raw.near ||
    raw.far > 8192
  )
    throw Error('Invalid camera projection.');
  const tan = Math.tan(raw.fovY / 2),
    data = new ArrayBuffer(96);
  new Float32Array(data).set([
    ...vectors.flatMap((v) => [...v, 0]),
    (tan * width) / height,
    tan,
    raw.far / (raw.far - raw.near),
    (-raw.near * raw.far) / (raw.far - raw.near),
  ]);
  new Uint32Array(data).set([...shape, 0xffffffff], 20);
  return data;
}
/** Pixel projection for host labels; visual floating-point math is not physics state. */
export function projectTacticalPoint3D(
  camera: TacticalCamera3D,
  pointQ: GeometryVector3D,
  width: number,
  height: number,
) {
  const uniform = new Float32Array(cameraData(camera, width, height, [1, 1, 1])),
    point = denseData(pointQ, 3);
  if (point.length !== 3 || point.some((n) => !Number.isSafeInteger(n) || Math.abs(n) > 524288))
    throw Error('Invalid fixed-point point.');
  const p = point.map((v, i) => v / GEOMETRY_SCALE_3D - uniform[i]),
    z = dot(p, uniform.slice(12, 15));
  if (z <= 0) return null;
  const x = dot(p, uniform.slice(4, 7)) / uniform[16] / z,
    y = dot(p, uniform.slice(8, 11)) / uniform[17] / z,
    depth = uniform[18] + uniform[19] / z;
  return {
    x: ((x + 1) * width) / 2,
    y: ((1 - y) * height) / 2,
    depth,
    visible: Math.abs(x) <= 1 && Math.abs(y) <= 1 && depth >= 0 && depth <= 1,
  };
}
