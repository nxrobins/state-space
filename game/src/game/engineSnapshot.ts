import { GRID_HEIGHT, GRID_WIDTH, MaterialType } from './simulation/constants';
import { createAirCell, gridIndex } from './simulation/grid';
import type { MaterialCell } from './simulation/types';

export const ENGINE_MATERIAL_MASK = 0xff;

export enum EngineMaterialId {
  Air = 0,
  Stone = 1,
  Water = 2,
  Sand = 3,
  Fire = 4,
  Metal = 5,
  Oil = 6,
  Wood = 7,
  Ice = 8,
  Steam = 9,
  Lava = 10,
  Glass = 11,
  Player = 12,
  Ash = 13,
  Smoke = 14,
}

export interface EngineMaterialSnapshot {
  width: number;
  height: number;
  packedCells: ArrayLike<number>;
  tick?: number;
  schemaVersion?: number;
}

export interface EngineSnapshotImportOptions {
  unknownMaterial?: MaterialType;
  playerMaterial?: MaterialType;
}

export interface EngineSnapshotImportReport {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  targetCells: number;
  unknownMaterialCells: number;
  remappedPlayerCells: number;
  materialCounts: Partial<Record<MaterialType, number>>;
}

export interface CombatGridImport {
  materialGrid: MaterialCell[];
  report: EngineSnapshotImportReport;
}

const ENGINE_TO_COMBAT_MATERIAL: Partial<Record<EngineMaterialId, MaterialType>> = {
  [EngineMaterialId.Air]: MaterialType.Air,
  [EngineMaterialId.Stone]: MaterialType.Stone,
  [EngineMaterialId.Water]: MaterialType.Water,
  [EngineMaterialId.Sand]: MaterialType.Sand,
  [EngineMaterialId.Fire]: MaterialType.Fire,
  [EngineMaterialId.Metal]: MaterialType.Metal,
  [EngineMaterialId.Oil]: MaterialType.Oil,
  [EngineMaterialId.Wood]: MaterialType.Wood,
  [EngineMaterialId.Ice]: MaterialType.Ice,
  [EngineMaterialId.Steam]: MaterialType.Steam,
  [EngineMaterialId.Lava]: MaterialType.Lava,
  [EngineMaterialId.Glass]: MaterialType.Glass,
  [EngineMaterialId.Ash]: MaterialType.Ash,
  [EngineMaterialId.Smoke]: MaterialType.Smoke,
};

export function decodeEngineMaterialId(packedCell: number): number {
  return (packedCell >>> 0) & ENGINE_MATERIAL_MASK;
}

export function mapEngineMaterialIdToCombatMaterial(
  materialId: number,
  options: EngineSnapshotImportOptions = {},
): MaterialType {
  if (materialId === EngineMaterialId.Player) {
    return options.playerMaterial ?? MaterialType.Air;
  }
  return ENGINE_TO_COMBAT_MATERIAL[materialId as EngineMaterialId] ?? options.unknownMaterial ?? MaterialType.Air;
}

export function buildCombatGridFromEngineSnapshot(
  snapshot: EngineMaterialSnapshot,
  options: EngineSnapshotImportOptions = {},
): CombatGridImport {
  validateSnapshot(snapshot);

  const materialGrid = Array.from({ length: GRID_WIDTH * GRID_HEIGHT }, createAirCell);
  const report: EngineSnapshotImportReport = {
    sourceWidth: snapshot.width,
    sourceHeight: snapshot.height,
    targetWidth: GRID_WIDTH,
    targetHeight: GRID_HEIGHT,
    targetCells: GRID_WIDTH * GRID_HEIGHT,
    unknownMaterialCells: 0,
    remappedPlayerCells: 0,
    materialCounts: {},
  };

  for (let y = 0; y < GRID_HEIGHT; y++) {
    const sourceY = sampleSourceCoordinate(y, GRID_HEIGHT, snapshot.height);
    for (let x = 0; x < GRID_WIDTH; x++) {
      const sourceX = sampleSourceCoordinate(x, GRID_WIDTH, snapshot.width);
      const packedCell = snapshot.packedCells[sourceY * snapshot.width + sourceX];
      const engineMaterial = decodeEngineMaterialId(packedCell);
      if (engineMaterial === EngineMaterialId.Player) {
        report.remappedPlayerCells++;
      } else if (ENGINE_TO_COMBAT_MATERIAL[engineMaterial as EngineMaterialId] === undefined) {
        report.unknownMaterialCells++;
      }

      const material = mapEngineMaterialIdToCombatMaterial(engineMaterial, options);
      materialGrid[gridIndex(x, y)] = { material, expiresAtTick: null };
      report.materialCounts[material] = (report.materialCounts[material] ?? 0) + 1;
    }
  }

  return { materialGrid, report };
}

function sampleSourceCoordinate(targetCoordinate: number, targetSize: number, sourceSize: number): number {
  return Math.min(sourceSize - 1, Math.floor(((targetCoordinate + 0.5) * sourceSize) / targetSize));
}

function validateSnapshot(snapshot: EngineMaterialSnapshot): void {
  if (!Number.isInteger(snapshot.width) || !Number.isInteger(snapshot.height) || snapshot.width <= 0 || snapshot.height <= 0) {
    throw new Error(`Invalid engine snapshot dimensions: ${snapshot.width}x${snapshot.height}.`);
  }

  const expectedCells = snapshot.width * snapshot.height;
  if (snapshot.packedCells.length !== expectedCells) {
    throw new Error(`Engine snapshot cell length mismatch: expected ${expectedCells}, received ${snapshot.packedCells.length}.`);
  }
}
