import {
  MAT,
  createStateSpaceStructuralWorld3D,
} from 'state-space-engine/experimental/3d/structural-world';
import { rotateVector } from 'state-space-engine/experimental/3d/multiphysics';
import { sliceCount } from './slice.mjs';

export const geometry = { width: 64, height: 16, depth: 64, chunkSize: 8 };
export const framesPerSlice = 12;
const index = (x, y, z) => x + 64 * (y + 16 * z);
const squad = [
  [12, 18],
  [18, 19],
  [14, 24],
  [20, 27],
  [22, 39],
  [44, 18],
  [49, 23],
  [46, 38],
  [52, 41],
  [43, 45],
];

export function createTerrain() {
  const field = createStateSpaceStructuralWorld3D(geometry);
  const edits = [];
  function put(x, y, z, material) {
    edits.push({ kind: 'material', x, y, z, material, thermal: 20 });
  }
  for (let x = 0; x < 64; x++)
    for (let z = 0; z < 64; z++) {
      const channel = x >= 28 && x <= 36;
      const top = channel ? 14 : 7;
      for (let y = top; y < 16; y++) put(x, y, z, MAT.STONE);
      if (channel && Math.abs(z - 32) > 5) put(x, 13, z, MAT.WATER);
      if (!channel && (x % 15 === 5 || z % 17 === 6) && Math.abs(z - 32) > 9 && x % 9 < 5)
        put(x, 6, z, MAT.STONE);
    }
  // Ten background squad markers. The engineer and heavy are taken from the physics tape.
  for (const [x, z] of squad) {
    put(x, 5, z, MAT.ICE);
    put(x, 6, z, MAT.ICE);
  }
  field.step(0, { edits });
  return field.snapshot();
}

export function cameraAt(frame) {
  const phase = (2 * Math.PI * frame) / (framesPerSlice * sliceCount);
  const yaw = 0.28 + 0.5 * Math.sin(phase),
    pitch = 0.68 + 0.06 * Math.cos(phase);
  const c = Math.cos,
    s = Math.sin;
  const forward = [c(pitch) * s(yaw), s(pitch), c(pitch) * c(yaw)];
  const target = [32 + 5 * Math.sin(phase), 9, 32];
  return {
    eye: target.map((v, i) => v - 45 * forward[i]),
    forward,
    right: [c(yaw), 0, -s(yaw)],
    up: [s(pitch) * s(yaw), -c(pitch), s(pitch) * c(yaw)],
  };
}

// Rasterize the small active crossing into the terrain renderer's display lattice only.
export function crossingCells(view, prediction) {
  const cells = new Map();
  function put(center, material, dy = 0) {
    const [x, y, z] = [
      Math.round(32 + 4 * center[0]),
      Math.round(12 - 4 * center[1]) + dy,
      Math.floor(32.125 + 4 * center[2]),
    ];
    if (x < 0 || x >= 64 || y < 0 || y >= 16 || z < 0 || z >= 64)
      throw Error('Crossing outside the battlefield');
    cells.set(index(x, y, z), material);
  }
  for (const p of view.bodies) {
    if (p.id === 'deck') {
      for (let i = -4; i <= 4; i++)
        for (let k = -1; k <= 1; k++) {
          const off = rotateVector(p.orientation, [i / 4, 0, k / 4]);
          put(
            p.center.map((v, j) => v + off[j]),
            MAT.STONE,
          );
        }
    } else if (p.id.startsWith('water-')) put(p.center, MAT.WATER);
    else {
      put(p.center, MAT.ICE);
      put(p.center, MAT.ICE, -1);
    }
  }
  if (prediction) {
    const unit = prediction.bodies.find((p) => p.id === 'unit');
    put(unit.center, prediction.intact ? MAT.ICE : MAT.LAVA, -2);
  }
  return cells;
}

export function changedCells(previous, next, terrain) {
  const edits = [];
  for (const i of new Set([...previous.keys(), ...next.keys()])) {
    const x = i % 64,
      y = Math.floor(i / 64) % 16,
      z = Math.floor(i / 1024);
    const base = terrain.packedCells[i];
    const material = next.get(i) ?? base & 255;
    if (previous.get(i) === next.get(i)) continue;
    edits.push({
      kind: 'material',
      x,
      y,
      z,
      material,
      thermal: next.has(i) ? (material === MAT.LAVA ? 240 : 20) : (base >>> 8) & 255,
    });
  }
  return edits;
}
