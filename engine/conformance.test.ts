import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createStateSpaceField, packVoxel } from './browser_state_space.js';
import { runCpuPass, runCpuTick } from './cpu_physics.js';
import { MAT, buildColdTable } from './generated/materials.js';
import { seedState, energyLedger } from './thermal.js';
import { KERNEL_SPECS } from './generated/schedule.js';
import { seedStructureState } from './structure.js';
import { DEFAULT_REGISTRY } from './registry.js';

interface Case {
  name: string; width: number; height: number; tick: number; ticks: number; cells: number[]; energyQ: number[]; structure: number[];
  passes: { tick: number; id: string; cells: number[]; energyQ: number[]; structure: number[] }[];
}

let cases: Case[] = [];
beforeAll(async () => {
  const python = process.env.STATE_SPACE_PYTHON ?? (existsSync('.venv/Scripts/python.exe') ? resolve('.venv/Scripts/python.exe') : 'python');
  const { stdout } = await promisify(execFile)(python, ['-m', 'engine.conformance'], {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 20 * 1024 * 1024,
  });
  cases = JSON.parse(stdout);
}, 120_000);

describe('native GPU and browser CPU conformance', () => {
  it('matches the entire packed state after every pass, across shapes and salts', () => {
    expect(cases.length).toBeGreaterThanOrEqual(24);
    const observed = new Set<string>();
    for (const fixture of cases) {
      let state = { grid: Uint32Array.from(fixture.cells), energyQ: Uint32Array.from(fixture.energyQ), structure: Uint32Array.from(fixture.structure) };
      const budget = energyLedger(state).totalQ;
      const cold = buildColdTable();
      for (const expected of fixture.passes) {
        state = runCpuPass(state, fixture.width, fixture.height, cold, expected.id);
        expect([...state.grid], `${fixture.name} tick=${expected.tick} pass=${expected.id}`).toEqual(expected.cells);
        expect([...state.energyQ], `${fixture.name} energy after ${expected.id}`).toEqual(expected.energyQ);
        expect([...state.structure], `${fixture.name} structure after ${expected.id}`).toEqual(expected.structure);
        expect(energyLedger(state).totalQ).toBe(budget);
        observed.add(expected.id);
      }
    }
    expect([...observed].sort()).toEqual(KERNEL_SPECS.map(spec => spec.id).sort());
    console.info(`Conformance: ${cases.length} scenes, ${cases.reduce((sum, fixture) => sum + fixture.passes.length, 0)} pass comparisons, ${observed.size} pipeline variants.`);
  });

  it('public CPU stepping and snapshot restoration preserve the same results', () => {
    for (const fixture of cases) {
      const field = createStateSpaceField(fixture.width, fixture.height);
      field.restore({ ...field.packedSnapshot(), tick: fixture.tick, packedCells: fixture.cells, energyQ: fixture.energyQ, structure: fixture.structure });
      field.step(1);
      const saved = field.packedSnapshot();
      const restored = createStateSpaceField(fixture.width, fixture.height);
      restored.restore(saved);
      restored.step(fixture.ticks - 1);
      expect([...restored.grid], fixture.name).toEqual(fixture.passes.at(-1)!.cells);
      expect([...restored.energyQ], fixture.name).toEqual(fixture.passes.at(-1)!.energyQ);
      expect([...restored.structure], fixture.name).toEqual(fixture.passes.at(-1)!.structure);
      expect(restored.energyBalance().driftQ).toBe(0n);
      expect(restored.tick).toBe(fixture.tick + fixture.ticks);
    }
  });

  it('requires coherent collapse, retained support, consumed pins, and new solidification bonds', () => {
    const fixture = (name: string) => cases.find(value => value.name === name)!;
    const indices = (cells: number[], material: number) => cells.flatMap((value, index) => (value & 255) === material ? [index] : []);
    const beam = fixture('supported-metal-span');
    for (const pass of beam.passes) expect(indices(pass.cells, MAT.METAL)).toEqual(indices(beam.cells, MAT.METAL));
    const plate = fixture('coherent-metal-plate');
    for (const pass of plate.passes.filter(value => value.id === 'normalize')) {
      expect(indices(pass.cells, MAT.METAL)).toEqual(indices(plate.cells, MAT.METAL).map(index => index + (pass.tick + 1) * plate.width));
      expect(indices(pass.cells, MAT.METAL).map(index => pass.structure[index])).toEqual(indices(plate.cells, MAT.METAL).map(index => plate.structure[index]));
    }
    const pin = fixture('consumed-pinned-support');
    expect(indices(pin.passes[0].cells, MAT.METAL)).toEqual(indices(pin.cells, MAT.METAL));
    const burned = pin.passes.find(pass => pass.id === 'combustion')!;
    expect(burned.cells[17] & 255).toBe(MAT.ASH);
    expect(burned.structure[17]).toBe(0);
    const fallen = pin.passes.find(pass => pass.id === 'structure' && pass.tick === 1)!;
    expect(indices(fallen.cells, MAT.METAL)).toEqual(indices(pin.cells, MAT.METAL).map(index => index + pin.width));
    const freeze = fixture('solidification-bonds').passes.find(pass => pass.id === 'normalize')!;
    expect(freeze.cells.slice(3, 6).map(value => value & 255)).toEqual([MAT.ICE, MAT.ICE, MAT.ICE]);
    expect(freeze.structure[3] & 512).toBe(512);
    expect(freeze.structure[4] & 256).toBe(256);
    const melted = fixture('melting-fragment').passes.find(pass => pass.id === 'phase')!;
    expect(indices(melted.cells, MAT.MOLTEN_METAL)).toHaveLength(2);
    expect(indices(melted.cells, MAT.MOLTEN_METAL).every(index => melted.structure[index] === 0)).toBe(true);
  });

  it('requires mutually exclusive oxygen claims and actual hot-gas buoyancy', () => {
    const field = createStateSpaceField(3, 1);
    field.setCell(0, 0, MAT.WOOD, 255);
    field.setCell(2, 0, MAT.WOOD, 255);
    field.step();
    const materials = [...field.grid].map(v => v & 255);
    expect(materials.filter(m => m === MAT.WOOD)).toHaveLength(1);
    expect(materials.filter(m => m === MAT.AIR)).toHaveLength(0);
    const smoke = createStateSpaceField(3, 5);
    smoke.setCell(1, 3, MAT.SMOKE, 200);
    smoke.step(4);
    expect([...smoke.grid].findIndex(v => (v & 255) === MAT.SMOKE)).toBeLessThan(9);
  });

  it('preserves immutable pass inputs and prevents observers changing the simulation', () => {
    const cells = Uint32Array.of(packVoxel(MAT.WOOD, 255), packVoxel(MAT.AIR), packVoxel(MAT.WOOD, 255));
    const original = cells.slice();
    const cold = buildColdTable();
    const expected = runCpuTick(seedStructureState(seedState(cells), 3, 1, DEFAULT_REGISTRY), 3, 1, cold, 0);
    const result = runCpuTick(seedStructureState(seedState(cells), 3, 1, DEFAULT_REGISTRY), 3, 1, cold, 0, (_id, observed) => { observed.grid.fill(0); observed.energyQ.fill(0); observed.structure.fill(0); });
    expect([...cells]).toEqual([...original]);
    expect(result).toEqual(expected);
  });
});
