import { MAT, SCHEMA_VERSION } from '../../../engine/generated/materials';
import { checkedInteger, validateDimensions, validatePackedCells } from '../../../engine/contracts';
import { GRID_HEIGHT, GRID_WIDTH, MaterialType } from './simulation/constants';
import { createAirCell, gridIndex } from './simulation/grid';
import type { MaterialCell } from './simulation/types';

export const ENGINE_MATERIAL_MASK = 0xff;

export enum EngineMaterialId {
  Air = MAT.AIR,
  Stone = MAT.STONE,
  Water = MAT.WATER,
  Sand = MAT.SAND,
  Fire = MAT.FIRE,
  Metal = MAT.METAL,
  Oil = MAT.OIL,
  Wood = MAT.WOOD,
  Ice = MAT.ICE,
  Steam = MAT.STEAM,
  Lava = MAT.LAVA,
  Glass = MAT.GLASS,
  Player = MAT.PLAYER,
  Ash = MAT.ASH,
  Smoke = MAT.SMOKE,
  OilVapor = MAT.OIL_VAPOR,
  MoltenMetal = MAT.MOLTEN_METAL,
  MoltenGlass = MAT.MOLTEN_GLASS,
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

type MappedEngineMaterial = Exclude<typeof MAT[keyof typeof MAT], typeof MAT.PLAYER>;

const ENGINE_TO_COMBAT_MATERIAL: Readonly<Partial<Record<number, MaterialType>>> = {
  [MAT.AIR]: MaterialType.Air,
  [MAT.STONE]: MaterialType.Stone,
  [MAT.WATER]: MaterialType.Water,
  [MAT.SAND]: MaterialType.Sand,
  [MAT.FIRE]: MaterialType.Fire,
  [MAT.METAL]: MaterialType.Metal,
  [MAT.OIL]: MaterialType.Oil,
  [MAT.WOOD]: MaterialType.Wood,
  [MAT.ICE]: MaterialType.Ice,
  [MAT.STEAM]: MaterialType.Steam,
  [MAT.LAVA]: MaterialType.Lava,
  [MAT.GLASS]: MaterialType.Glass,
  [MAT.ASH]: MaterialType.Ash,
  [MAT.SMOKE]: MaterialType.Smoke,
  // This is a lossy material import; phase, energy and structure are discarded.
  [MAT.OIL_VAPOR]: MaterialType.Oil,
  [MAT.MOLTEN_METAL]: MaterialType.Metal,
  [MAT.MOLTEN_GLASS]: MaterialType.Glass,
} satisfies Record<MappedEngineMaterial, MaterialType>;

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
      materialGrid[gridIndex(x, y)] = { material, expiresAtTick: null, provenance: 'snapshot' };
      report.materialCounts[material] = (report.materialCounts[material] ?? 0) + 1;
    }
  }

  return { materialGrid, report };
}

function sampleSourceCoordinate(targetCoordinate: number, targetSize: number, sourceSize: number): number {
  return Math.min(sourceSize - 1, Math.floor(((targetCoordinate + 0.5) * sourceSize) / targetSize));
}

function validateSnapshot(snapshot: EngineMaterialSnapshot): void {
  if (snapshot.schemaVersion !== undefined && ![1, 2, SCHEMA_VERSION].includes(snapshot.schemaVersion)) {
    throw new Error('Unsupported engine snapshot schema version.');
  }
  if (snapshot.tick !== undefined) checkedInteger(snapshot.tick, 0, Number.MAX_SAFE_INTEGER, 'tick');
  const expectedCells = validateDimensions(snapshot.width, snapshot.height);
  validatePackedCells(snapshot.packedCells, expectedCells);
}
