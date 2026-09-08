/** Immutable per-pass deltas. Collection is opt-in and has readback/memory costs. */
import { energyLedger } from './thermal.js';
import type { StructuralState, StructuralPlan } from './structure.js';

export interface CellChange {
  readonly index: number;
  readonly beforePacked: number;
  readonly afterPacked: number;
  readonly beforeEnergyQ: number;
  readonly afterEnergyQ: number;
  readonly beforeStructure: number;
  readonly afterStructure: number;
}
export interface PassReport {
  readonly tick: number;
  readonly passId: string;
  readonly changes: readonly CellChange[];
  readonly before: Readonly<ReturnType<typeof energyLedger>>;
  readonly after: Readonly<ReturnType<typeof energyLedger>>;
  readonly structure?: StructuralPlan;
}
export interface StepOptions { inspect?: boolean }

export function inspectPass(before: StructuralState, after: StructuralState, cold: Uint32Array, tick: number, passId: string, structure?: StructuralPlan): PassReport {
  const changes: CellChange[] = [];
  for (let i = 0; i < before.grid.length; i += 1) {
    if (before.grid[i] !== after.grid[i] || before.energyQ[i] !== after.energyQ[i] || before.structure[i] !== after.structure[i]) {
      changes.push(Object.freeze({ index: i, beforePacked: before.grid[i], afterPacked: after.grid[i], beforeEnergyQ: before.energyQ[i], afterEnergyQ: after.energyQ[i], beforeStructure: before.structure[i], afterStructure: after.structure[i] }));
    }
  }
  return Object.freeze({ tick, passId, changes: Object.freeze(changes), structure,
    before: Object.freeze(energyLedger(before, cold)), after: Object.freeze(energyLedger(after, cold)) });
}
