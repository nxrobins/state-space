import { describe, expect, it } from 'vitest';
import { createStateSpaceField, createPhysicsState, packVoxel, MAT, DEFAULT_REGISTRY } from './index.js';
import { ANCHOR, FRESH } from './structure.js';
import { runCpuPass } from './cpu_physics.js';

describe('public ca-v3 structural state and edits', () => {
  it('preserves fractures through cooling and repair until explicit welding', () => {
    const world = createStateSpaceField(3, 1, MAT.METAL);
    world.setAnchor(1, 0); world.setIntegrity(1, 0, 0);
    expect([...world.structure]).toEqual([255, ANCHOR, 255]);
    world.setEnergy(1, 0, 0); world.step(4);
    expect(world.sample(1, 0).integrity).toBe(0);
    world.setIntegrity(1, 0, 255); world.step(4);
    expect([...world.structure]).toEqual([255, ANCHOR | 255, 255]);
    world.setIntegrity(1, 0, 255, { weld: true });
    expect([...world.structure]).toEqual([767, ANCHOR | 1023, 511]);
    world.setAnchor(1, 0, false);
    expect(world.sample(1, 0).anchored).toBe(false);
    expect(world.energyBalance().driftQ).toBe(0n);
  });

  it('discards pins on melting and creates reciprocal bonds on solidification', () => {
    const world = createStateSpaceField(3, 1, MAT.METAL);
    world.setAnchor(1, 0);
    for (let x = 0; x < 3; x += 1) world.setEnergy(x, 0, 800 * 256);
    world.step();
    expect([...world.grid].map(value => value & 255)).toEqual([MAT.MOLTEN_METAL, MAT.MOLTEN_METAL, MAT.MOLTEN_METAL]);
    expect([...world.structure]).toEqual([0, 0, 0]);
    for (let x = 0; x < 3; x += 1) world.setEnergy(x, 0, 35 * 256);
    const reports = world.step(1, { inspect: true });
    expect([...world.structure]).toEqual([767, 1023, 511]);
    expect(reports.at(-1)?.passId).toBe('normalize');
    expect(reports.at(-1)?.changes.length).toBe(3);
    expect(world.energyBalance().driftQ).toBe(0n);
  });

  it('inspects structure-only damage and retains it through exact restart', () => {
    const world = createStateSpaceField(1, 1, MAT.WOOD);
    world.setAnchor(0, 0); world.setIntegrity(0, 0, 1);
    const before = world.packedSnapshot();
    const prediction = world.inspectStructure();
    expect(prediction.loads).toEqual([2]); expect(prediction.capacities).toEqual([1]);
    expect(world.packedSnapshot()).toEqual(before);
    const report = world.step(1, { inspect: true })[0];
    expect(report.changes).toHaveLength(1);
    const change = report.changes[0];
    expect(change.beforePacked).toBe(change.afterPacked);
    expect(change.beforeEnergyQ).toBe(change.afterEnergyQ);
    expect([change.beforeStructure, change.afterStructure]).toEqual([ANCHOR | 1, ANCHOR]);
    const after = world.packedSnapshot();
    world.structure.fill(0); world.snapshot().structure.fill(0);
    expect(world.packedSnapshot()).toEqual(after);
    world.restore(before); world.step();
    expect(world.packedSnapshot()).toEqual(after);
  });

  it('rejects incomplete or invalid structural snapshots and edits atomically', () => {
    const world = createStateSpaceField(2, 1, MAT.METAL), before = world.packedSnapshot();
    const { structure: _words, ...missing } = before;
    const invalid = [missing, { ...before, schemaVersion: 2, rulesVersion: 'ca-v2' },
      ...[[], [255, 511], [FRESH | 767, 511], [-1, 511], [0xffffffff, 511], [767.5, 511]].map(structure => ({ ...before, structure }))];
    for (const snapshot of invalid) {
      expect(() => world.restore(snapshot as typeof before)).toThrow();
      expect(world.packedSnapshot()).toEqual(before);
    }
    for (const edit of [() => world.setIntegrity(0, 0, 300), () => world.setIntegrity(0, 0, 10, { weld: 1 as unknown as boolean }),
      () => world.setAnchor(0, 0, 1 as unknown as boolean)]) {
      expect(edit).toThrow(); expect(world.packedSnapshot()).toEqual(before);
    }
  });

  it('validates explicit bulk creation and rejects a cold table mutated after use', () => {
    const cells = Uint32Array.of(packVoxel(MAT.METAL), packVoxel(MAT.METAL));
    const state = createPhysicsState(cells, 2, 1, DEFAULT_REGISTRY);
    expect([...state.structure]).toEqual([767, 511]);
    cells.fill(0); expect(state.grid[0] & 255).toBe(MAT.METAL);
    expect(() => createPhysicsState(cells, 1, 1, DEFAULT_REGISTRY)).toThrow();
    const cold = DEFAULT_REGISTRY.coldTable();
    runCpuPass(state, 2, 1, cold, 'structure');
    cold[MAT.METAL * 24 + 22] = 0;
    expect(() => runCpuPass(state, 2, 1, cold, 'structure')).toThrow(/Cold table/);
  });
});
