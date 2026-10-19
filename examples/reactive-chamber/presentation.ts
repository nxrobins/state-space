/** Catalog-aware reactive presentation. Never casts a reactive save to an M5 snapshot. */
import {MAT, PHASE, GEOMETRY_SCALE_3D as Q, type ReactiveMaterialRegistry3D, type ReactiveSessionPreview3D} from 'state-space-engine/experimental/3d/reactive-materials';
import {projectTacticalPoint3D, type TacticalCamera3D} from 'state-space-engine/experimental/3d/tactical-renderer';
import {readChamberSnapshot, coordinate, index, fields, integer, type ChamberSnapshot, type ChamberGame, type Cell} from './scenario.js';
export type ChamberScene = Readonly<{identity: string; kind: 'committed' | 'preview'; tick: number; count: number; selected: Cell | null}>;
type Data = {boxes: Float32Array; selection: Float32Array; snapshot: ChamberSnapshot};
const scenes = new WeakMap<ChamberScene, Data>();
export function sceneData(scene: ChamberScene): Data {const data = scenes.get(scene); if (!data) throw Error('Expected a prepared reactive chamber scene.'); return data;}
export function inspectScene(scene: ChamberScene, cell: Cell) {
  const {snapshot: s} = sceneData(scene), i = index(cell), b = s.domains.world.block;
  if (cell.some(v => !Number.isInteger(v) || v < 0 || v > 7)) throw Error('Cell is outside the chamber.');
  return {identity: scene.identity, tick: scene.tick, material: b.packedCells[i] & 255, thermal: b.packedCells[i] >>> 8 & 255,
    energyQ: b.energyQ[i], integrity: b.structure[i] & 255};
}
export function prepareScene(registry: ReactiveMaterialRegistry3D, input: ChamberSnapshot | ReactiveSessionPreview3D<ChamberGame>, selected: Cell | null = null): ChamberScene {
  const isPreview = Object.hasOwn(input, 'progress');
  const p = isPreview ? input as ReactiveSessionPreview3D<ChamberGame> : null;
  const snapshot = readChamberSnapshot(registry, p ? p.state : input);
  if (p) {
    fields(p, ['base', 'branchId', 'progress', 'state']); integer(p.branchId, 1, Number.MAX_SAFE_INTEGER);
    if (p.progress.status !== 'ready' || p.progress.phase !== 'terminal' || p.progress.completedCommands !== p.progress.totalCommands ||
      p.progress.completedTicks !== p.progress.horizonTicks || p.state.revision !== p.base.revision ||
      p.base.tick + p.progress.horizonTicks !== snapshot.domains.tick || p.base.worldId !== snapshot.worldId ||
      p.base.gameRulesVersion !== snapshot.gameRulesVersion || p.base.materialCatalogHash !== registry.hash || p.base.sessionRulesVersion !== snapshot.rulesVersion) throw Error('Presentation requires a complete matching reactive preview.');
  }
  if (selected && (selected.length !== 3 || selected.some(v => !Number.isInteger(v) || v < 0 || v > 7))) throw Error('Selection is outside the chamber.');
  const b = snapshot.domains.world.block, values: number[] = [];
  for (let i = 0; i < b.packedCells.length; i++) {
    const word = b.packedCells[i], id = word & 255; if (id === MAT.AIR) continue;
    const color = registry.material(id).color, rgb = [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16) / 255);
    const pos = coordinate(i), gas = (word >>> 24 & 15) === PHASE.GAS, size = gas ? .45 : 1, offset = (1 - size) / 2;
    values.push(...pos.map(v => v + offset), 0, size, size, size, 0, ...rgb, 1);
  }
  const actor = snapshot.game.actor;
  values.push(...actor.minQ.map(v => v / Q), 0, ...actor.sizeQ.map(v => v / Q), 0, .2, .9, .96, 1);
  const selection = selected ? new Float32Array([...selected.map(v => v - .006), 0, 1.012, 1.012, 1.012, 0, 1, .78, .3, 1]) : new Float32Array(0);
  const identity = JSON.stringify([snapshot.worldId, snapshot.gameRulesVersion, registry.hash, snapshot.rulesVersion,
    snapshot.revision, snapshot.domains.tick, p ? ['preview', p.branchId, p.base.tick, p.progress.completedCommands] : 'committed']);
  const scene: ChamberScene = Object.freeze({identity, kind: p ? 'preview' : 'committed', tick: snapshot.domains.tick,
    count: values.length / 12, selected: selected ? Object.freeze([...selected]) as unknown as Cell : null});
  scenes.set(scene, {boxes: new Float32Array(values), selection, snapshot}); return scene;
}
const normalize = (v: number[]): Cell => {const length = Math.hypot(...v); return v.map(n => n / length) as Cell;};
const cross = (a: Cell, b: Cell): Cell => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function orbitCamera(yaw = -.65, pitch = .42): TacticalCamera3D {
  const center = [4, 4.3, 4], radius = 13, eye: Cell = [center[0] + radius * Math.cos(pitch) * Math.sin(yaw), center[1] - radius * Math.sin(pitch), center[2] + radius * Math.cos(pitch) * Math.cos(yaw)];
  const forward = normalize(center.map((v, i) => v - eye[i])), right = normalize(cross(forward, [0, -1, 0])), up = cross(right, forward);
  return {eye, right, up, forward, fovY: .8, near: .1, far: 64};
}
export function pickCell(scene: ChamberScene, camera: TacticalCamera3D, x: number, y: number, width: number, height: number): Cell | null {
  // Ray/AABB picking, nearest visible material cell. Same scene and camera as the rendered view.
  const tan = Math.tan(camera.fovY / 2), dx = (2 * x / width - 1) * tan * width / height, dy = (1 - 2 * y / height) * tan;
  const direction = camera.forward.map((v, i) => v + dx * camera.right[i] + dy * camera.up[i]);
  let nearest = Infinity, hit: Cell | null = null;
  for (const [i, word] of sceneData(scene).snapshot.domains.world.block.packedCells.entries()) {
    if ((word & 255) === MAT.AIR) continue; const cell = coordinate(i); let lo = 0, hi = Infinity;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(direction[a]) < 1e-10) {if (camera.eye[a] < cell[a] || camera.eye[a] > cell[a] + 1) hi = -1;}
      else {const first = (cell[a] - camera.eye[a]) / direction[a], last = (cell[a] + 1 - camera.eye[a]) / direction[a]; lo = Math.max(lo, Math.min(first, last)); hi = Math.min(hi, Math.max(first, last));}
    }
    if (hi >= lo && lo < nearest) {nearest = lo; hit = cell;}
  }
  return hit;
}
export {projectTacticalPoint3D as projectPoint};
export type {TacticalCamera3D as ChamberCamera};

/** Preserve the CSS aspect ratio when applying the finite Retina backing-store cap. */
export function canvasSize(cssWidth: number, cssHeight: number, pixelRatio: number) {
  if (![cssWidth, cssHeight, pixelRatio].every(Number.isFinite) || cssWidth < 0 || cssHeight < 0 || pixelRatio <= 0) throw Error('Invalid viewport dimensions.');
  const w = Math.max(1, cssWidth), h = Math.max(1, cssHeight), scale = Math.min(pixelRatio, 2, 1600 / w, 900 / h);
  return {width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale))};
}
/** Pick in the actual backing-store projection, including fractional CSS/DPR rounding. */
export function pickElementCell(scene: ChamberScene, camera: TacticalCamera3D, x: number, y: number,
  cssWidth: number, cssHeight: number, targetWidth: number, targetHeight: number): Cell | null {
  if (cssWidth <= 0 || cssHeight <= 0) return null;
  return pickCell(scene, camera, x * targetWidth / cssWidth, y * targetHeight / cssHeight, targetWidth, targetHeight);
}
