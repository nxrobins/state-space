import { describe, expect, it } from 'vitest';
import { MaterialType } from './constants';
import { createBattleState } from './battle';
import { createMaterialGrid, consumeDirtyMaterialIndices, getCell, gridIndex, setTemporaryRect, tickMaterialLifetimes } from './grid';
import { resolveMaterialCombos } from './materialCombos';

function materialSnapshotAt(state: ReturnType<typeof createBattleState>, cells: Array<[number, number]>): MaterialType[] {
  return cells.map(([x, y]) => getCell(state.materialGrid, x, y).material);
}

describe('material combo grammar', () => {
  it('turns adjacent temporary water and fire into steam with preserved lifetimes', () => {
    const state = createBattleState('water');
    consumeDirtyMaterialIndices(state);
    state.tick = 7;
    setTemporaryRect(state, 'p1', 40, 40, 1, 1, MaterialType.Water, 120);
    setTemporaryRect(state, 'cpu', 41, 40, 1, 1, MaterialType.Fire, 80);
    consumeDirtyMaterialIndices(state);

    resolveMaterialCombos(state);

    expect(getCell(state.materialGrid, 40, 40)).toMatchObject({
      material: MaterialType.Steam,
      expiresAtTick: 127,
      provenance: 'temporary',
    });
    expect(getCell(state.materialGrid, 41, 40)).toMatchObject({
      material: MaterialType.Steam,
      expiresAtTick: 87,
      provenance: 'temporary',
    });
    expect(state.temporaryCellCount).toBe(2);
    expect(consumeDirtyMaterialIndices(state).sort((a, b) => a - b)).toEqual([
      gridIndex(40, 40),
      gridIndex(41, 40),
    ]);
    expect(state.eventLog.filter((event) => event.type === 'material-combo')).toHaveLength(1);
    expect(state.eventLog.at(-1)?.message).toBe('Steam burst formed');
  });

  it('applies the V1 transform rules for lava quench, ice melt, and sand vitrification', () => {
    const lava = createBattleState('water');
    setTemporaryRect(lava, 'p1', 46, 41, 1, 1, MaterialType.Water, 120);
    setTemporaryRect(lava, 'cpu', 47, 41, 1, 1, MaterialType.Lava, 120);
    resolveMaterialCombos(lava);
    expect(materialSnapshotAt(lava, [[46, 41], [47, 41]])).toEqual([MaterialType.Steam, MaterialType.Stone]);

    const ice = createBattleState('earth');
    setTemporaryRect(ice, 'p1', 52, 38, 1, 1, MaterialType.Ice, 120);
    setTemporaryRect(ice, 'cpu', 53, 38, 1, 1, MaterialType.Fire, 120);
    resolveMaterialCombos(ice);
    expect(materialSnapshotAt(ice, [[52, 38], [53, 38]])).toEqual([MaterialType.Water, MaterialType.Fire]);

    const sand = createBattleState('fire');
    setTemporaryRect(sand, 'p1', 61, 42, 1, 1, MaterialType.Sand, 120);
    setTemporaryRect(sand, 'cpu', 62, 42, 1, 1, MaterialType.Lava, 120);
    resolveMaterialCombos(sand);
    expect(materialSnapshotAt(sand, [[61, 42], [62, 42]])).toEqual([MaterialType.Glass, MaterialType.Lava]);
  });

  it('lets each cell participate in only one priority-sorted combo per tick', () => {
    const state = createBattleState('water');
    setTemporaryRect(state, 'p1', 10, 10, 1, 1, MaterialType.Water, 120);
    setTemporaryRect(state, 'cpu', 11, 10, 1, 1, MaterialType.Lava, 120);
    setTemporaryRect(state, 'p1', 12, 10, 1, 1, MaterialType.Ice, 120);

    resolveMaterialCombos(state);

    expect(materialSnapshotAt(state, [[10, 10], [11, 10], [12, 10]])).toEqual([
      MaterialType.Steam,
      MaterialType.Stone,
      MaterialType.Ice,
    ]);
  });

  it('does not transform permanent arena cells or imported snapshot seed cells', () => {
    const permanent = createBattleState('fire');
    setTemporaryRect(permanent, 'p1', 18, 82, 1, 1, MaterialType.Fire, 120);
    resolveMaterialCombos(permanent);
    expect(getCell(permanent.materialGrid, 17, 82).material).toBe(MaterialType.Sand);
    expect(getCell(permanent.materialGrid, 18, 82).material).toBe(MaterialType.Fire);

    const importedGrid = createMaterialGrid();
    importedGrid[gridIndex(30, 30)] = { material: MaterialType.Water, expiresAtTick: null };
    importedGrid[gridIndex(31, 30)] = { material: MaterialType.Fire, expiresAtTick: null };
    const imported = createBattleState('water', 123, { initialMaterialGrid: importedGrid });

    resolveMaterialCombos(imported);

    expect(materialSnapshotAt(imported, [[30, 30], [31, 30]])).toEqual([MaterialType.Water, MaterialType.Fire]);
    expect(getCell(imported.materialGrid, 30, 30).provenance).toBe('snapshot');
  });

  it('refreshes gas lifetime to a fixed max age without creating immortal hazards', () => {
    const state = createBattleState('fire');
    consumeDirtyMaterialIndices(state);
    setTemporaryRect(state, 'p1', 70, 36, 1, 1, MaterialType.Smoke, 120);
    setTemporaryRect(state, 'cpu', 71, 36, 1, 1, MaterialType.Fire, 100);
    consumeDirtyMaterialIndices(state);

    resolveMaterialCombos(state);

    expect(getCell(state.materialGrid, 70, 36).expiresAtTick).toBe(180);
    expect(state.temporaryCellCount).toBe(2);
    expect(consumeDirtyMaterialIndices(state)).toEqual([gridIndex(70, 36)]);
    expect(state.eventLog.filter((event) => event.type === 'material-combo')).toHaveLength(1);

    resolveMaterialCombos(state);
    expect(state.eventLog.filter((event) => event.type === 'material-combo')).toHaveLength(1);

    state.tick = 181;
    tickMaterialLifetimes(state);
    expect(materialSnapshotAt(state, [[70, 36], [71, 36]])).toEqual([MaterialType.Air, MaterialType.Air]);
    expect(state.temporaryCellCount).toBe(0);
  });

  it('emits one readable event per combo rule per tick even when many cells react', () => {
    const state = createBattleState('water');
    for (let pair = 0; pair < 4; pair++) {
      setTemporaryRect(state, 'p1', 20 + pair * 3, 30, 1, 1, MaterialType.Water, 120);
      setTemporaryRect(state, 'cpu', 21 + pair * 3, 30, 1, 1, MaterialType.Fire, 120);
    }

    resolveMaterialCombos(state);

    expect(state.eventLog.filter((event) => event.type === 'material-combo' && event.message === 'Steam burst formed')).toHaveLength(1);
  });

  it('resolves dense combo candidates deterministically', () => {
    const a = createBattleState('earth', 999);
    const b = createBattleState('earth', 999);
    const setup = (state: ReturnType<typeof createBattleState>): void => {
      setTemporaryRect(state, 'p1', 80, 40, 2, 1, MaterialType.Water, 120);
      setTemporaryRect(state, 'cpu', 82, 40, 1, 2, MaterialType.Fire, 120);
      setTemporaryRect(state, 'p1', 81, 41, 2, 1, MaterialType.Sand, 120);
      setTemporaryRect(state, 'cpu', 83, 41, 1, 1, MaterialType.Lava, 120);
    };
    setup(a);
    setup(b);

    resolveMaterialCombos(a);
    resolveMaterialCombos(b);

    expect(a.materialGrid.map((cell) => cell.material)).toEqual(b.materialGrid.map((cell) => cell.material));
    expect(a.eventLog).toEqual(b.eventLog);
  });
});
