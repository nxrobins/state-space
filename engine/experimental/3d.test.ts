import { describe, it, expect } from 'vitest';
import {
  createStateSpaceField3D as create,
  MAT,
  MAX_ENERGY_Q,
  volumeSchedule,
  runVolumePass,
} from './3d.js';

describe('experimental 3D contract and cellular laws', () => {
  it('bounds geometry, rejects unsupported materials and preserves complete geometry', () => {
    for (const dims of [
      [0, 1, 1],
      [32, 32, 33],
      [1.5, 2, 2],
      [Infinity, 1, 1],
    ])
      expect(() => create(...(dims as [number, number, number]))).toThrow();
    expect(() => create(1, 1, 1, MAT.FIRE)).toThrow();
    const f = create(3, 5, 7),
      saved = f.snapshot();
    expect(() => f.restore({ ...saved, width: 5, height: 3 })).toThrow();
    expect(f.snapshot()).toEqual(saved);
    expect(() => {
      (f as unknown as { width: number }).width = 4;
    }).toThrow();
    expect(() => Object.defineProperty(f, 'width', { value: 4 })).toThrow();
  });
  it('falls and rises in hand-checkable single-column worlds', () => {
    const sand = create(1, 3, 1);
    sand.setCell(0, 0, 0, MAT.SAND);
    sand.step();
    expect(sand.sample(0, 2, 0).material).toBe(MAT.SAND);
    const steam = create(1, 3, 1);
    steam.setCell(0, 2, 0, MAT.STEAM, 180);
    steam.step();
    expect(steam.grid.map((v) => v & 255)).toEqual(Uint32Array.of(MAT.AIR, MAT.STEAM, MAT.AIR));
    const solid = create(1, 3, 1);
    solid.setCell(0, 0, 0, MAT.STONE);
    solid.step();
    expect(solid.sample(0, 0, 0).material).toBe(MAT.STONE);
  });
  it('spreads blocked water along X and Z and descends diagonally without entering solids', () => {
    for (const axis of [0, 2]) {
      const f = create(axis === 0 ? 3 : 1, 2, axis === 2 ? 3 : 1);
      for (let x = 0; x < f.width; x++)
        for (let z = 0; z < f.depth; z++) f.setCell(x, 1, z, MAT.STONE);
      f.setCell(0, 0, 0, MAT.WATER);
      const state = { grid: f.grid, energyQ: f.energyQ };
      const idx = volumeSchedule(0).findIndex(
        (p) => p.kind === 'liquid' && p.axis === axis && p.parity === 0,
      );
      const result = runVolumePass(state, f.width, f.height, f.depth, 0, idx);
      expect(result.grid[axis === 0 ? 1 : f.width * f.height] & 255).toBe(MAT.WATER);
      expect(state.grid).toEqual(f.grid);
    }
    for (const axis of [0, 2])
      for (const direction of [-1, 1]) {
        const f = create(3, 2, 3);
        f.setCell(1, 0, 1, MAT.SAND);
        f.setCell(1, 1, 1, MAT.STONE);
        const idx = volumeSchedule(0).findIndex(
          (p) =>
            p.kind === 'diagonal' && p.axis === axis && p.direction === direction && p.parity === 0,
        );
        const result = runVolumePass({ grid: f.grid, energyQ: f.energyQ }, 3, 2, 3, 0, idx);
        const x = 1 + (axis === 0 ? direction : 0),
          z = 1 + (axis === 2 ? direction : 0);
        expect(result.grid[x + 3 * (1 + 2 * z)] & 255).toBe(MAT.SAND);
        expect(result.grid[1 + 3 * (1 + 2)] & 255).toBe(MAT.STONE);
      }
  });
  it('conserves exact integer heat on every axis, including at maximum energy', () => {
    for (const axis of [0, 1, 2]) {
      const shape: [number, number, number] = [1, 1, 1];
      shape[axis] = 2;
      const f = create(...shape, MAT.STONE);
      f.setEnergy(0, 0, 0, MAX_ENERGY_Q);
      const idx = volumeSchedule(0).findIndex(
        (p) => p.kind === 'heat' && p.axis === axis && p.parity === 0,
      );
      const result = runVolumePass({ grid: f.grid, energyQ: f.energyQ }, ...shape, 0, idx);
      expect(result.energyQ[0] + result.energyQ[1]).toBe(MAX_ENERGY_Q + 20 * 256);
      expect(result.energyQ[1]).toBeGreaterThan(20 * 256);
    }
  });
  it('routes blocked steam along either horizontal axis and respects solid walls', () => {
    for (const axis of [0, 2])
      for (const source of [0, 1]) {
        const shape: [number, number, number] = axis === 0 ? [2, 1, 1] : [1, 1, 2];
        const f = create(...shape);
        f.setCell(axis === 0 ? source : 0, 0, axis === 2 ? source : 0, MAT.STEAM, 180);
        const moved = [0, 1, 2, 3, 4, 5, 6, 7].some((tick) => {
          const p = volumeSchedule(tick).findIndex(
            (pass) => pass.kind === 'gas' && pass.axis === axis && pass.parity === 0,
          );
          return (
            (runVolumePass({ grid: f.grid, energyQ: f.energyQ }, ...shape, tick, p).grid[
              1 - source
            ] &
              255) ===
            MAT.STEAM
          );
        });
        expect(moved).toBe(true);
        f.setCell(axis === 0 ? 1 - source : 0, 0, axis === 2 ? 1 - source : 0, MAT.STONE);
        const initial = [...f.grid].map((v) => v & 255);
        f.step(8);
        expect([...f.grid].map((v) => v & 255)).toEqual(initial);
      }
  });
  it('uses the existing latent boundaries for every supported transition', () => {
    const cases = [
      [MAT.WATER, 155, MAT.STEAM],
      [MAT.STEAM, 105, MAT.WATER],
      [MAT.WATER, 15, MAT.ICE],
      [MAT.ICE, 45, MAT.WATER],
      [MAT.STONE, 250, MAT.LAVA],
      [MAT.LAVA, 210, MAT.STONE],
      [MAT.SAND, 225, MAT.GLASS],
      [MAT.GLASS, 295, MAT.MOLTEN_GLASS],
      [MAT.MOLTEN_GLASS, 260, MAT.GLASS],
    ];
    for (const [source, boundary, target] of cases) {
      const f = create(1, 1, 1, source);
      f.setEnergy(0, 0, 0, boundary * 256);
      const q = f.energyBalance().currentQ;
      f.step();
      expect(f.sample(0, 0, 0).material, `${source} at ${boundary}`).toBe(target);
      expect(f.energyBalance().currentQ).toBe(q);
      expect(f.energyBalance().driftQ).toBe(0n);
    }
    const latent = create(1, 1, 1, MAT.WATER);
    latent.setEnergy(0, 0, 0, 154 * 256);
    latent.step();
    expect(latent.sample(0, 0, 0).material).toBe(MAT.WATER);
    expect(latent.sample(0, 0, 0).temperatureQ).toBe(100 * 256);
  });
  it('isolates public reads and makes invalid edits, copies and restores atomic', () => {
    const f = create(3, 1, 1),
      saved = f.snapshot(),
      before = f.energyBalance();
    f.grid.fill(42);
    f.energyQ.fill(42);
    saved.packedCells.fill(42);
    expect(f.sample(0, 0, 0).material).toBe(MAT.AIR);
    const original = f.snapshot();
    for (const action of [
      () => f.setCell(0, 0, 0, MAT.WOOD),
      () => f.setEnergy(0, 0, 0, -1),
      () => f.setCell(3, 0, 0, MAT.SAND),
      () => f.restore({ ...original, rulesVersion: 'ca-v4' }),
      () => f.restore({ ...original, tick: -1 }),
      () => f.restore({ ...original, energyQ: [1, 2, 3] }),
      () => f.restore({ ...original, packedCells: [65536, ...original.packedCells.slice(1)] }),
    ]) {
      expect(action).toThrow();
      expect(f.snapshot()).toEqual(original);
      expect(f.energyBalance()).toEqual(before);
    }
    const same = new Uint32Array(3);
    same.fill(123);
    expect(() => f.copyStateInto({ grid: same, energyQ: same })).toThrow();
    expect([...same]).toEqual([123, 123, 123]);
    const short = new Uint32Array(1),
      good = new Uint32Array(3).fill(456);
    Object.defineProperty(short, 'length', { value: 3 });
    expect(() => f.copyStateInto({ grid: good, energyQ: short })).toThrow();
    expect([...good]).toEqual([456, 456, 456]);
    f.setEnergy(0, 0, 0, 12345);
    expect(f.energyBalance().externalQ).toBe(12345n - 20n * 256n);
    f.setCell(1, 0, 0, MAT.WATER);
    f.step();
    expect(f.energyBalance().driftQ).toBe(0n);
    f.restore(f.snapshot());
    expect(f.energyBalance().externalQ).toBe(0n);
    f.restore({ ...f.snapshot(), tick: Number.MAX_SAFE_INTEGER });
    const terminal = f.snapshot();
    expect(() => f.step()).toThrow();
    expect(f.snapshot()).toEqual(terminal);
  });
  it('preserves movement permutations and exact odd-tick continuation on rectangular worlds', () => {
    const f = create(7, 5, 3);
    for (let z = 0; z < 3; z++)
      for (let x = 0; x < 7; x++) {
        f.setCell(x, 4, z, MAT.STONE);
        f.setCell(x, 0, z, (x + z) % 2 ? MAT.SAND : MAT.WATER);
      }
    let state = { grid: f.grid, energyQ: f.energyQ };
    const pairs = (s: typeof state) => [...s.grid].map((v, i) => `${v}:${s.energyQ[i]}`).sort();
    const initial = pairs(state);
    for (let p = 0; p < 20; p++) {
      state = runVolumePass(state, 7, 5, 3, 3, p);
      expect(pairs(state)).toEqual(initial);
    }
    f.step(3);
    const saved = f.snapshot(),
      restored = create(7, 5, 3);
    restored.restore(saved);
    f.step(17);
    restored.step(17);
    expect(restored.snapshot()).toEqual(f.snapshot());
    expect(f.energyBalance().driftQ).toBe(0n);
    expect(volumeSchedule(0)).toHaveLength(27);
    expect(volumeSchedule(0)).not.toEqual(volumeSchedule(3));
  });
});
