import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BOOST_RADIUS_CELLS,
  BOOST_REQUIRED_CELLS,
  CELL_SIZE,
  GRID_HEIGHT,
  GRID_WIDTH,
  MaterialType,
  SOLID_MATERIALS,
  TEMPORARY_CELL_CAP,
} from './constants';
import type { BattleState, FighterState, MaterialCell } from './types';

export function createAirCell(): MaterialCell {
  return { material: MaterialType.Air, expiresAtTick: null };
}

export function createMaterialGrid(): MaterialCell[] {
  return Array.from({ length: GRID_WIDTH * GRID_HEIGHT }, createAirCell);
}

export function markDirty(state: BattleState, index: number): void {
  state.dirtyMaterialIndices.add(index);
}

export function markNonAirCellsDirty(state: BattleState): void {
  for (let index = 0; index < state.materialGrid.length; index++) {
    if (state.materialGrid[index].material !== MaterialType.Air) {
      state.dirtyMaterialIndices.add(index);
    }
  }
}

export function consumeDirtyMaterialIndices(state: BattleState): number[] {
  const dirty = Array.from(state.dirtyMaterialIndices);
  state.dirtyMaterialIndices.clear();
  return dirty;
}

export function gridIndex(x: number, y: number): number {
  return y * GRID_WIDTH + x;
}

export function inGrid(x: number, y: number): boolean {
  return x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT;
}

export function worldToCell(value: number): number {
  return Math.floor(value / CELL_SIZE);
}

export function cellToWorld(value: number): number {
  return value * CELL_SIZE;
}

export function clampCellX(x: number): number {
  return Math.max(0, Math.min(GRID_WIDTH - 1, x));
}

export function clampCellY(y: number): number {
  return Math.max(0, Math.min(GRID_HEIGHT - 1, y));
}

export function getCell(grid: MaterialCell[], x: number, y: number): MaterialCell {
  if (!inGrid(x, y)) return { material: MaterialType.Air, expiresAtTick: null };
  return grid[gridIndex(x, y)];
}

export function isTemporaryCell(cell: MaterialCell): boolean {
  return cell.material !== MaterialType.Air && cell.expiresAtTick !== null;
}

export function isPermanentCell(cell: MaterialCell): boolean {
  return cell.material !== MaterialType.Air && cell.expiresAtTick === null;
}

export function isSolidMaterial(material: MaterialType): boolean {
  return SOLID_MATERIALS.has(material);
}

export function setPermanentRect(
  grid: MaterialCell[],
  x: number,
  y: number,
  width: number,
  height: number,
  material: MaterialType,
): void {
  for (let cy = y; cy < y + height; cy++) {
    for (let cx = x; cx < x + width; cx++) {
      if (!inGrid(cx, cy)) continue;
      grid[gridIndex(cx, cy)] = { material, expiresAtTick: null, provenance: 'permanent' };
    }
  }
}

export function buildArenaGrid(): MaterialCell[] {
  const grid = createMaterialGrid();
  setPermanentRect(grid, 0, 84, GRID_WIDTH, 6, MaterialType.Stone);
  setPermanentRect(grid, 25, 62, 34, 2, MaterialType.Stone);
  setPermanentRect(grid, 101, 62, 34, 2, MaterialType.Stone);
  setPermanentRect(grid, 67, 47, 26, 2, MaterialType.Stone);
  setPermanentRect(grid, 0, 82, 18, 2, MaterialType.Sand);
  setPermanentRect(grid, 142, 82, 18, 2, MaterialType.Sand);
  return grid;
}

export function setTemporaryRect(
  state: BattleState,
  ownerId: FighterState['id'],
  x: number,
  y: number,
  width: number,
  height: number,
  material: MaterialType,
  lifetimeTicks: number,
): void {
  const expiresAtTick = state.tick + lifetimeTicks;
  let refsNeedSort = false;
  for (let cy = y; cy < y + height; cy++) {
    for (let cx = x; cx < x + width; cx++) {
      if (!inGrid(cx, cy)) continue;
      const index = gridIndex(cx, cy);
      const existing = state.materialGrid[index];
      if (isPermanentCell(existing)) continue;
      if (!isTemporaryCell(existing)) {
        state.temporaryCellCount++;
      }
      state.materialGrid[index] = { material, expiresAtTick, ownerId, provenance: 'temporary', createdAtTick: state.tick };
      refsNeedSort = appendTemporaryRef(state, { index, expiresAtTick }) || refsNeedSort;
      markDirty(state, index);
    }
  }
  if (refsNeedSort) sortActiveTemporaryRefs(state);
  enforceTemporaryCellCap(state);
}

export function refreshTemporaryCellLifetime(
  state: BattleState,
  index: number,
  maxLifetimeTicks: number,
): boolean {
  const cell = state.materialGrid[index];
  if (!isTemporaryCell(cell) || cell.expiresAtTick === null) return false;

  const createdAtTick = cell.createdAtTick ?? state.tick;
  const refreshedExpiresAtTick = Math.max(cell.expiresAtTick, createdAtTick + maxLifetimeTicks);
  if (refreshedExpiresAtTick === cell.expiresAtTick) return false;

  state.materialGrid[index] = {
    ...cell,
    expiresAtTick: refreshedExpiresAtTick,
    provenance: 'temporary',
    createdAtTick,
  };
  const refsNeedSort = appendTemporaryRef(state, { index, expiresAtTick: refreshedExpiresAtTick });
  if (refsNeedSort) sortActiveTemporaryRefs(state);
  markDirty(state, index);
  return true;
}

export function clearRectAroundWorldPoint(
  state: BattleState,
  worldX: number,
  worldY: number,
  widthCells: number,
  heightCells: number,
): void {
  const centerX = worldToCell(worldX);
  const centerY = worldToCell(worldY);
  const x0 = centerX - Math.floor(widthCells / 2);
  const y0 = centerY - Math.floor(heightCells / 2);
  for (let y = y0; y < y0 + heightCells; y++) {
    for (let x = x0; x < x0 + widthCells; x++) {
      if (!inGrid(x, y)) continue;
      const index = gridIndex(x, y);
      if (isTemporaryCell(state.materialGrid[index])) {
        state.temporaryCellCount--;
      }
      state.materialGrid[index] = createAirCell();
      markDirty(state, index);
    }
  }
}

export function tickMaterialLifetimes(state: BattleState): void {
  while (state.temporaryCellHead < state.temporaryCells.length) {
    const ref = state.temporaryCells[state.temporaryCellHead];
    if (ref.expiresAtTick > state.tick) break;
    state.temporaryCellHead++;
    const cell = state.materialGrid[ref.index];
    if (cell.expiresAtTick === ref.expiresAtTick) {
      state.materialGrid[ref.index] = createAirCell();
      state.temporaryCellCount = Math.max(0, state.temporaryCellCount - 1);
      markDirty(state, ref.index);
    }
  }
  compactTemporaryRefs(state);
}

function enforceTemporaryCellCap(state: BattleState): void {
  while (state.temporaryCellCount > TEMPORARY_CELL_CAP && state.temporaryCellHead < state.temporaryCells.length) {
    const ref = state.temporaryCells[state.temporaryCellHead++];
    const cell = state.materialGrid[ref.index];
    if (cell.expiresAtTick === ref.expiresAtTick) {
      state.materialGrid[ref.index] = createAirCell();
      state.temporaryCellCount--;
      markDirty(state, ref.index);
    }
  }
  compactTemporaryRefs(state);
}

function appendTemporaryRef(state: BattleState, ref: { index: number; expiresAtTick: number }): boolean {
  const last = state.temporaryCells[state.temporaryCells.length - 1];
  const refsNeedSort = state.temporaryCells.length > state.temporaryCellHead && last !== undefined && ref.expiresAtTick < last.expiresAtTick;
  state.temporaryCells.push(ref);
  return refsNeedSort;
}

function compactTemporaryRefs(state: BattleState): void {
  if (state.temporaryCellHead < 256 || state.temporaryCellHead < state.temporaryCells.length / 2) return;
  state.temporaryCells = state.temporaryCells.slice(state.temporaryCellHead);
  state.temporaryCellHead = 0;
}

function sortActiveTemporaryRefs(state: BattleState): void {
  if (state.temporaryCellHead > 0) {
    state.temporaryCells = state.temporaryCells.slice(state.temporaryCellHead);
    state.temporaryCellHead = 0;
  }
  state.temporaryCells.sort((a, b) => a.expiresAtTick - b.expiresAtTick || a.index - b.index);
}

export function rectIntersectsSolid(
  grid: MaterialCell[],
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const left = clampCellX(worldToCell(x));
  const right = clampCellX(worldToCell(x + width - 1));
  const top = clampCellY(worldToCell(y));
  const bottom = clampCellY(worldToCell(y + height - 1));
  for (let cy = top; cy <= bottom; cy++) {
    for (let cx = left; cx <= right; cx++) {
      if (isSolidMaterial(getCell(grid, cx, cy).material)) return true;
    }
  }
  return false;
}

export function materialsInFighterRect(
  grid: MaterialCell[],
  fighter: FighterState,
): Set<MaterialType> {
  const materials = new Set<MaterialType>();
  const left = clampCellX(worldToCell(fighter.x - fighter.width / 2));
  const right = clampCellX(worldToCell(fighter.x + fighter.width / 2));
  const top = clampCellY(worldToCell(fighter.y - fighter.height / 2));
  const bottom = clampCellY(worldToCell(fighter.y + fighter.height / 2));
  for (let cy = top; cy <= bottom; cy++) {
    for (let cx = left; cx <= right; cx++) {
      const material = getCell(grid, cx, cy).material;
      if (material !== MaterialType.Air) materials.add(material);
    }
  }
  return materials;
}

export function countMatchingCellsNearFighter(
  grid: MaterialCell[],
  fighter: FighterState,
  matching: Set<MaterialType>,
): number {
  const centerX = clampCellX(worldToCell(fighter.x));
  const centerY = clampCellY(worldToCell(fighter.y));
  let count = 0;
  for (let cy = centerY - BOOST_RADIUS_CELLS; cy <= centerY + BOOST_RADIUS_CELLS; cy++) {
    if (cy < 0 || cy >= GRID_HEIGHT) continue;
    for (let cx = centerX - BOOST_RADIUS_CELLS; cx <= centerX + BOOST_RADIUS_CELLS; cx++) {
      if (cx < 0 || cx >= GRID_WIDTH) continue;
      if (matching.has(grid[gridIndex(cx, cy)].material)) {
        count++;
        if (count >= BOOST_REQUIRED_CELLS) return count;
      }
    }
  }
  return count;
}

export function worldBoundsExceeded(fighter: FighterState): boolean {
  return (
    fighter.x < -80 ||
    fighter.x > ARENA_WIDTH + 80 ||
    fighter.y > ARENA_HEIGHT + 96 ||
    fighter.y < -220
  );
}
