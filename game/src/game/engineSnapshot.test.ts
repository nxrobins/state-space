import { describe, expect, it } from 'vitest';
import { MAT } from '../../../engine/generated/materials';
import {
  buildCombatGridFromEngineSnapshot,
  decodeEngineMaterialId,
  EngineMaterialId,
  mapEngineMaterialIdToCombatMaterial,
  type EngineMaterialSnapshot,
} from './engineSnapshot';
import { createBattleState } from './simulation/battle';
import { GRID_HEIGHT, GRID_WIDTH, MaterialType } from './simulation/constants';
import { getCell, worldToCell } from './simulation/grid';

function packEngineCell(material: number, thermal = 0, phase = 0, flags = 0): number {
  return (
    (material & 0xff) |
    ((thermal & 0xff) << 8) |
    ((phase & 0x0f) << 24) |
    (((flags & 0x0f) << 28) >>> 0)
  ) >>> 0;
}

function snapshot(width: number, height: number, materials: number[]): EngineMaterialSnapshot {
  return {
    width,
    height,
    packedCells: Uint32Array.from(materials.map((material) => packEngineCell(material, 200, 7, 12))),
  };
}

describe('engine material snapshot bridge', () => {
  it('decodes material id from the engine packed voxel low byte', () => {
    const packed = packEngineCell(EngineMaterialId.Lava, 255, 7, 15);

    expect(decodeEngineMaterialId(packed)).toBe(EngineMaterialId.Lava);
  });

  it('maps known engine material IDs to matching combat material IDs', () => {
    expect(mapEngineMaterialIdToCombatMaterial(EngineMaterialId.Stone)).toBe(MaterialType.Stone);
    expect(mapEngineMaterialIdToCombatMaterial(EngineMaterialId.Water)).toBe(MaterialType.Water);
    expect(mapEngineMaterialIdToCombatMaterial(EngineMaterialId.Fire)).toBe(MaterialType.Fire);
    expect(mapEngineMaterialIdToCombatMaterial(EngineMaterialId.Smoke)).toBe(MaterialType.Smoke);
  });

  it('imports every declared engine material and maps new phases to their combat family', () => {
    expect(mapEngineMaterialIdToCombatMaterial(MAT.OIL_VAPOR)).toBe(MaterialType.Oil);
    expect(mapEngineMaterialIdToCombatMaterial(MAT.MOLTEN_METAL)).toBe(MaterialType.Metal);
    expect(mapEngineMaterialIdToCombatMaterial(MAT.MOLTEN_GLASS)).toBe(MaterialType.Glass);
    for (const material of Object.values(MAT)) {
      const imported = buildCombatGridFromEngineSnapshot(snapshot(1, 1, [material]));
      expect(imported.report.unknownMaterialCells, `declared material ${material}`).toBe(0);
      if (material !== MAT.AIR && material !== MAT.PLAYER) {
        expect(imported.materialGrid.every(cell => cell.material !== MaterialType.Air)).toBe(true);
      }
    }
  });

  it('keeps engine player markers and unknown materials out of the combat arena by default', () => {
    expect(mapEngineMaterialIdToCombatMaterial(EngineMaterialId.Player)).toBe(MaterialType.Air);
    expect(mapEngineMaterialIdToCombatMaterial(219)).toBe(MaterialType.Air);
    expect(mapEngineMaterialIdToCombatMaterial(219, { unknownMaterial: MaterialType.Smoke })).toBe(MaterialType.Smoke);
  });

  it('resamples a row-major engine snapshot into the fixed combat grid', () => {
    const imported = buildCombatGridFromEngineSnapshot(snapshot(2, 2, [
      EngineMaterialId.Stone,
      EngineMaterialId.Water,
      EngineMaterialId.Fire,
      EngineMaterialId.Lava,
    ]));

    expect(getCell(imported.materialGrid, 0, 0).material).toBe(MaterialType.Stone);
    expect(getCell(imported.materialGrid, GRID_WIDTH - 1, 0).material).toBe(MaterialType.Water);
    expect(getCell(imported.materialGrid, 0, GRID_HEIGHT - 1).material).toBe(MaterialType.Fire);
    expect(getCell(imported.materialGrid, GRID_WIDTH - 1, GRID_HEIGHT - 1).material).toBe(MaterialType.Lava);
    expect(imported.report.materialCounts[MaterialType.Stone]).toBe((GRID_WIDTH / 2) * (GRID_HEIGHT / 2));
    expect(imported.report.targetCells).toBe(GRID_WIDTH * GRID_HEIGHT);
  });

  it('reports player and unknown material cells after resampling', () => {
    const imported = buildCombatGridFromEngineSnapshot(snapshot(2, 1, [
      EngineMaterialId.Player,
      222,
    ]));

    expect(imported.report.remappedPlayerCells).toBe((GRID_WIDTH / 2) * GRID_HEIGHT);
    expect(imported.report.unknownMaterialCells).toBe((GRID_WIDTH / 2) * GRID_HEIGHT);
    expect(imported.report.materialCounts[MaterialType.Air]).toBe(GRID_WIDTH * GRID_HEIGHT);
  });

  it('rejects malformed engine snapshots before creating a combat grid', () => {
    expect(() => buildCombatGridFromEngineSnapshot({ width: 0, height: 1, packedCells: [] })).toThrow(/dimensions/);
    expect(() => buildCombatGridFromEngineSnapshot({ width: 2, height: 2, packedCells: Uint32Array.of(1, 2, 3) })).toThrow(/length mismatch/);
  });

  it('rejects unsupported metadata and malformed packed values instead of coercing them', () => {
    for (const packed of [-1, 2 ** 32, 0.5, NaN]) {
      expect(() => buildCombatGridFromEngineSnapshot({ width: 1, height: 1, packedCells: [packed] })).toThrow();
    }
    expect(() => buildCombatGridFromEngineSnapshot({ width: 1, height: 1, packedCells: [0], schemaVersion: 4 })).toThrow();
    for (const schemaVersion of [1, 2, 3]) {
      expect(() => buildCombatGridFromEngineSnapshot({ width: 1, height: 1, packedCells: [0], schemaVersion })).not.toThrow();
    }
    expect(() => buildCombatGridFromEngineSnapshot({ width: 1, height: 1, packedCells: [0], tick: -1 })).toThrow();
  });

  it('can seed a battle with an imported snapshot while preserving spawn safety', () => {
    const imported = buildCombatGridFromEngineSnapshot(snapshot(1, 1, [EngineMaterialId.Stone]));
    const state = createBattleState('water', 1234, { initialMaterialGrid: imported.materialGrid });
    const p1CellX = worldToCell(state.fighters.p1.x);
    const p1CellY = worldToCell(state.fighters.p1.y);
    const cpuCellX = worldToCell(state.fighters.cpu.x);
    const cpuCellY = worldToCell(state.fighters.cpu.y);

    expect(getCell(state.materialGrid, 0, 0).material).toBe(MaterialType.Stone);
    expect(getCell(state.materialGrid, p1CellX, p1CellY).material).toBe(MaterialType.Air);
    expect(getCell(state.materialGrid, cpuCellX, cpuCellY).material).toBe(MaterialType.Air);
    expect(state.temporaryCellCount).toBe(0);
  });
});
