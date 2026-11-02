/** Pure snapshot-to-instance conversion and camera math. No DOM, GPU or physics authority. */
import type {
  MultiphysicsProfiles3D,
  MultiphysicsSnapshot3D,
  MultiphysicsTickReport3D,
  Vec3,
  Quat,
} from 'state-space-engine/experimental/3d/multiphysics';
/** Per instance: center.xyz + shape, quaternion, halfExtents.xyz + pad, rgba. */
export const INSTANCE_FLOATS = 16;
export const MAX_INSTANCES = 2048;
export const SHAPE = { box: 0, sphere: 1 } as const;
export type BuilderScene = {
  /** Changes whenever the instance data does; renderers upload only on change. */
  identity: string;
  count: number;
  instances: Float32Array;
  bounds: { center: Vec3; radius: number };
};
export type BuilderCamera = {
  eye: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  fovY: number;
  near: number;
  far: number;
};
const IDENTITY: Quat = [0, 0, 0, 1];
function rgb(hex: string): Vec3 {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!value) return [0.6, 0.6, 0.6];
  const n = parseInt(value, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
/** Lift dark catalog colors so every material stays visible on the dark background. */
function visible([r, g, b]: Vec3): Vec3 {
  const light = Math.max(r, g, b);
  if (light >= 0.35) return [r, g, b];
  const lift = 0.35 - light;
  return [r + lift, g + lift, b + lift];
}
/** Shortest rotation taking +x to `direction` (unit or not); identity for degenerate input. */
function alignX(direction: Vec3): Quat {
  const length = Math.hypot(...direction);
  if (!(length > 1e-12)) return IDENTITY;
  const d = direction.map((v) => v / length) as unknown as Vec3,
    dot = d[0];
  if (dot < -1 + 1e-9) return [0, 0, 1, 0];
  const axis: Vec3 = [0, -d[2], d[1]],
    w = 1 + dot,
    norm = Math.hypot(axis[0], axis[1], axis[2], w);
  return [axis[0] / norm, axis[1] / norm, axis[2] / norm, w / norm];
}
/** Diverging blue-to-red ramp for potential or current magnitude in [0, 1]. */
function ramp(t: number): Vec3 {
  const x = Math.min(1, Math.max(0, t));
  return [0.25 + 0.75 * x, 0.55 + 0.35 * (1 - Math.abs(2 * x - 1)), 1 - 0.75 * x];
}
export type SceneOverlays = { bonds: boolean; circuit: boolean };
export function prepareScene(
  profiles: MultiphysicsProfiles3D,
  snapshot: MultiphysicsSnapshot3D,
  report: MultiphysicsTickReport3D | null,
  selected: string | null,
  overlays: SceneOverlays = { bonds: true, circuit: true },
  label = 'committed',
): BuilderScene {
  const instances = new Float32Array(MAX_INSTANCES * INSTANCE_FLOATS);
  let count = 0;
  const push = (
    center: Vec3,
    shape: number,
    rotation: Quat,
    half: Vec3,
    color: Vec3,
    alpha = 1,
  ) => {
    if (count >= MAX_INSTANCES) throw Error('Builder scene exceeds its instance bound.');
    instances.set(
      [...center, shape, ...rotation, ...half, 0, ...color, alpha],
      count++ * INSTANCE_FLOATS,
    );
  };
  const segment = (a: Vec3, b: Vec3, thickness: number, color: Vec3) => {
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    push(
      [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
      SHAPE.box,
      alignX(d),
      [Math.hypot(...d) / 2, thickness, thickness],
      color,
    );
  };
  const byId = new Map(snapshot.parcels.map((p) => [p.id, p]));
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (const p of snapshot.parcels) {
    const profile = profiles.byName[p.material],
      solid = profile?.phase === 'solid' || profile?.phase === 'granular';
    for (let k = 0; k < 3; k++) {
      const extent = Math.hypot(...p.halfExtents);
      lo[k] = Math.min(lo[k], p.center[k] - extent);
      hi[k] = Math.max(hi[k], p.center[k] + extent);
    }
    const color = visible(rgb(profile?.color ?? '#999999')),
      highlight: Vec3 = p.id === selected ? [1, 0.82, 0.35] : color;
    if (solid) push(p.center, SHAPE.box, p.orientation, p.halfExtents, highlight);
    // Fluid and gas samples are drawn at their solid-exclusion radius.
    else
      push(
        p.center,
        SHAPE.sphere,
        IDENTITY,
        [Math.min(...p.halfExtents), 0, 0],
        highlight,
        profile?.phase === 'gas' ? 0.55 : 0.9,
      );
  }
  if (overlays.bonds)
    for (const bond of snapshot.bonds) {
      const a = byId.get(bond.a),
        b = byId.get(bond.b);
      if (a && b) segment(a.center, b.center, 0.045, [0.95, 0.95, 0.95]);
    }
  if (overlays.circuit && snapshot.battery) {
    for (const [id, color] of [
      [snapshot.battery.positive, [1, 0.3, 0.25]],
      [snapshot.battery.negative, [0.25, 0.45, 1]],
    ] as const) {
      const terminal = byId.get(id);
      if (terminal)
        push(
          [
            terminal.center[0],
            terminal.center[1] + Math.max(...terminal.halfExtents) + 0.18,
            terminal.center[2],
          ],
          SHAPE.sphere,
          IDENTITY,
          [0.14, 0, 0],
          [...color] as Vec3,
        );
    }
    const network = report?.battery?.network;
    if (network) {
      const potentials = network.nodes.flatMap((n) => (n.potential === null ? [] : [n.potential])),
        top = Math.max(1e-12, ...potentials.map(Math.abs)),
        current = Math.max(1e-12, ...network.edges.map((e) => Math.abs(e.current)));
      for (const edge of network.edges) {
        const a = byId.get(edge.a),
          b = byId.get(edge.b);
        if (a && b)
          segment(
            a.center,
            b.center,
            0.025 + (0.06 * Math.abs(edge.current)) / current,
            ramp(Math.abs(edge.current) / current),
          );
      }
      for (const node of network.nodes) {
        const p = byId.get(node.id);
        if (p && node.potential !== null)
          push(
            p.center,
            SHAPE.sphere,
            IDENTITY,
            [0.11, 0, 0],
            ramp(0.5 + node.potential / (2 * top)),
          );
      }
    }
  }
  const finiteBounds = lo.every(Number.isFinite);
  const center: Vec3 = finiteBounds
    ? [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
    : [0, 0, 0];
  const radius = finiteBounds
    ? Math.max(1, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2)
    : 4;
  return {
    identity: `${label}:${snapshot.tick}:${selected ?? ''}:${overlays.bonds}:${overlays.circuit}:${count}:${report ? 'r' : ''}`,
    count,
    instances: instances.subarray(0, count * INSTANCE_FLOATS),
    bounds: { center, radius },
  };
}
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** Orbit about the scene's bounds; presentation only, never part of a simulation tick. */
export function orbitCamera(
  yaw: number,
  pitch: number,
  zoom: number,
  bounds: BuilderScene['bounds'],
): BuilderCamera {
  const clampedPitch = Math.max(-1.35, Math.min(1.35, pitch)),
    distance = (bounds.radius * 2.6) / Math.max(0.25, Math.min(4, zoom));
  const offset: Vec3 = [
    Math.cos(clampedPitch) * Math.sin(yaw) * distance,
    Math.sin(clampedPitch) * distance,
    Math.cos(clampedPitch) * Math.cos(yaw) * distance,
  ];
  const eye: Vec3 = [
    bounds.center[0] + offset[0],
    bounds.center[1] + offset[1],
    bounds.center[2] + offset[2],
  ];
  const forward = unit([-offset[0], -offset[1], -offset[2]]),
    right = unit(cross(forward, [0, 1, 0])),
    up = cross(right, forward);
  return { eye, right, up, forward, fovY: 0.85, near: 0.05, far: distance * 4 + 40 };
}
export function canvasSize(cssWidth: number, cssHeight: number, pixelRatio: number) {
  const w = Math.max(1, cssWidth),
    h = Math.max(1, cssHeight),
    scale = Math.min(pixelRatio, 2, 1600 / w, 900 / h);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}
