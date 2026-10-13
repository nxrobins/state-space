import { describe, expect, it } from 'vitest';
import { createStateSpaceField, packVoxel, MAT } from './browser_state_space.js';
import { createPhysicsState, rulesForRegistry, planStructure } from './structure.js';
import { runCpuPass } from './cpu_physics.js';
import { DEFAULT_REGISTRY } from './registry.js';
import { MOVED, updatePressure } from './pressure.js';

describe('pressure and velocity physical controls', () => {
  const cold = DEFAULT_REGISTRY.coldTable(), rules = rulesForRegistry(DEFAULT_REGISTRY);
  it('advects each coordinate at most one cell per axis and clears pending markers', () => {
    for (const source of [2, 3]) {
      let state = createPhysicsState(Uint32Array.from({ length: 7 }, () => packVoxel(MAT.AIR)), 7, 1, DEFAULT_REGISTRY);
      state.grid[source] = packVoxel(MAT.SMOKE, 20, 4, 0, undefined, 8);
      state.structure[source] = 1234 * 65536;
      const before = { ...state, grid: state.grid.slice(), energyQ: state.energyQ.slice(), structure: state.structure.slice() };
      for (const pass of ['velocity_x0_s0', 'velocity_x1_s0']) state = runCpuPass(state, 7, 1, cold, pass);
      expect(state.grid[source + 1]).toBe(before.grid[source]);
      expect(state.energyQ[source + 1]).toBe(before.energyQ[source]);
      expect(state.structure[source + 1]).toBe(before.structure[source]);
      expect([...state.structure].every(word => (word & MOVED) === 0)).toBe(true);
      expect([...state.grid].sort()).toEqual([...before.grid].sort());
    }
  });
  it('pressure gradients accelerate toward a breach; bound solids resist and balanced liquid rests', () => {
    let state = createPhysicsState(Uint32Array.from({ length: 3 }, () => packVoxel(MAT.AIR)), 3, 1, DEFAULT_REGISTRY);
    state.structure[0] = 1024 * 65536;
    const force = runCpuPass(state, 3, 1, cold, 'impulse');
    expect((force.grid[1] >>> 16) & 15).toBe(4);
    expect(force.energyQ).toEqual(state.energyQ);
    state = createPhysicsState(Uint32Array.from({ length: 4 }, () => packVoxel(MAT.WATER, 35)), 1, 4, DEFAULT_REGISTRY);
    for (let tick = 0; tick < 40; tick++) state.structure = updatePressure(state.grid, state.energyQ, state.structure, 1, 4, rules);
    expect([...runCpuPass(state, 1, 4, cold, 'impulse').grid].every(cell => (cell & 0xff0000) === 0)).toBe(true);
    state = createPhysicsState(Uint32Array.of(packVoxel(MAT.AIR), packVoxel(MAT.METAL), packVoxel(MAT.AIR)), 3, 1, DEFAULT_REGISTRY);
    state.structure[0] = 1024 * 65536;
    expect(runCpuPass(state, 3, 1, cold, 'impulse').grid[1] & 0xff0000).toBe(0);
  });
  it('old snapshots are rejected and high pressure/velocity resume exactly', () => {
    const field = createStateSpaceField(7, 3);
    try {
      const snapshot = field.packedSnapshot();
      const initial = { ...snapshot, structure: Array.from(snapshot.structure), packedCells: Array.from(snapshot.packedCells) };
      expect(() => field.restore({ ...initial, schemaVersion: 3, rulesVersion: 'ca-v3' })).toThrow();
      initial.structure[8] = 65535 * 65536;
      initial.packedCells[8] = packVoxel(MAT.AIR, 20, 4, -4);
      field.restore(initial);
      expect(field.sample(1, 1)).toMatchObject({ pressureQ: 65535, velocityX: 4, velocityY: -4 });
      field.step(3); const saved = field.packedSnapshot(); field.step(4); const end = field.packedSnapshot();
      field.restore(saved); field.step(4); expect(field.packedSnapshot()).toEqual(end);
      expect(field.energyBalance().driftQ).toBe(0n);
    } finally { field.close(); }
  });
  it('rejects a pressure no-op by requiring a loaded weak wall to lose integrity', () => {
    const state = createPhysicsState(Uint32Array.of(packVoxel(MAT.STEAM, 160), packVoxel(MAT.GLASS), packVoxel(MAT.AIR)), 3, 1, DEFAULT_REGISTRY);
    let words = state.structure;
    for (let tick = 0; tick < 12; tick++) words = Uint32Array.from(planStructure({ ...state, structure: words }, 3, 1, rules).structure);
    expect(words[1] & 255).toBe(0);
    const coldState = createPhysicsState(Uint32Array.of(packVoxel(MAT.AIR), packVoxel(MAT.GLASS), packVoxel(MAT.AIR)), 3, 1, DEFAULT_REGISTRY);
    expect(planStructure(coldState, 3, 1, rules).structure[1] & 255).toBe(255);
  });
});
