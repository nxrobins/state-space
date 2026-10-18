/** Bounded local reactive cycles. No movement, global support, Worker or GPU. */
import { MAT, PHASE, PHASE_SHIFT, COLD_STRIDE, COLD_COHESION, COLD_FUEL_ENERGY, COLD_FLASH_POINT,
  COLD_OXIDIZER, COLD_BURNS_INTO, COLD_SMOKE_PRODUCT } from '../generated/materials.js';
import { temperatureQ, exchangeEnergy, thermalView, phaseMaterial, rewriteMaterial, MAX_ENERGY_Q, ENERGY_SCALE } from '../thermal.js';
import { INTEGRITY_3D, BONDS_3D, structuralNeighbor } from './structural-mechanics.js';
import { readReactiveMaterialBlock3D, type ReactiveMaterialBlock3D } from './reactive-block.js';
import { reactiveRegistrySource3D, reactiveFields3D, reactiveInteger3D, type ReactiveMaterialRegistry3D } from './reactive-registry.js';

export const REACTIVE_REACTION_RULES_3D = 'reactive-reactions-1';
export const REACTIVE_REACTION_SCHEMA_3D = 1;
export const REACTIVE_REACTION_PASSES_3D = Object.freeze(['heat-x-even', 'heat-x-odd', 'heat-y-even', 'heat-y-odd', 'heat-z-even', 'heat-z-odd', 'phase', 'combustion'] as const);
export type ReactiveReactionState3D = {schemaVersion: 1; rulesVersion: typeof REACTIVE_REACTION_RULES_3D; cycle: number; block: ReactiveMaterialBlock3D};
export type ReactiveReactionReport3D = {
  rulesVersion: typeof REACTIVE_REACTION_RULES_3D; materialCatalogHash: string; fromCycle: number; toCycle: number;
  changedCells: number[]; phaseChangedCells: number[]; extinguishedCells: number[];
  reactedPairs: {fuel: number; oxidizer: number; transferredEnergyQ: number}[];
  energy: {beforeQ: string; afterQ: string; externalQ: '0'; driftQ: '0'; chemicalBeforeQ: string; chemicalAfterQ: string};
};
export type ReactiveReactionResult3D = {state: ReactiveReactionState3D; report: ReactiveReactionReport3D};
export type ReactiveReactionProgress3D = {status: 'running' | 'complete' | 'cancelled'; completedPasses: number; totalPasses: 8};
export interface ReactiveReactionJob3D {
  progress(): ReactiveReactionProgress3D;
  advance(): ReactiveReactionProgress3D;
  cancel(): boolean;
  result(): ReactiveReactionResult3D;
}

export function createReactiveReactionState3D(registry: ReactiveMaterialRegistry3D, block: ReactiveMaterialBlock3D, cycle: number = 0): ReactiveReactionState3D {
  reactiveInteger3D(cycle, 0, Number.MAX_SAFE_INTEGER);
  return {schemaVersion: 1, rulesVersion: REACTIVE_REACTION_RULES_3D, cycle: cycle === 0 ? 0 : cycle, block: readReactiveMaterialBlock3D(registry, block)};
}
export function readReactiveReactionState3D(registry: ReactiveMaterialRegistry3D, raw: unknown): ReactiveReactionState3D {
  reactiveFields3D(raw, ['schemaVersion', 'rulesVersion', 'cycle', 'block']);
  if (raw.schemaVersion !== REACTIVE_REACTION_SCHEMA_3D || raw.rulesVersion !== REACTIVE_REACTION_RULES_3D) throw Error('Incompatible reactive reaction state.');
  const cycle = reactiveInteger3D(raw.cycle, 0, Number.MAX_SAFE_INTEGER);
  return {schemaVersion: 1, rulesVersion: REACTIVE_REACTION_RULES_3D, cycle, block: readReactiveMaterialBlock3D(registry, raw.block)};
}

const copy = (block: ReactiveMaterialBlock3D): ReactiveMaterialBlock3D => ({...block, packedCells: block.packedCells.slice(), energyQ: block.energyQ.slice(), structure: block.structure.slice()});
const prop = (word: number, cold: Uint32Array, key: number) => cold[(word & 255) * COLD_STRIDE + key];
const eligible = (word: number, cold: Uint32Array) => [PHASE.SOLID, PHASE.FROZEN].some(p => p === (word >>> PHASE_SHIFT & 15)) && prop(word, cold, COLD_COHESION) > 0;
function totals(block: ReactiveMaterialBlock3D, cold: Uint32Array) {
  let energyQ = 0n, chemicalQ = 0n;
  for (let i = 0; i < block.energyQ.length; i++) {energyQ += BigInt(block.energyQ[i]); chemicalQ += BigInt(prop(block.packedCells[i], cold, COLD_FUEL_ENERGY) * ENERGY_SCALE);}
  return {energyQ, chemicalQ};
}
function heat(input: ReactiveMaterialBlock3D, cold: Uint32Array, axis: number, parity: number): ReactiveMaterialBlock3D {
  const output = copy(input), w = input.width, h = input.height;
  for (let i = 0; i < input.packedCells.length; i++) {
    const coordinate = axis === 0 ? i % w : axis === 1 ? Math.floor(i / w) % h : Math.floor(i / (w * h));
    if (coordinate % 2 !== parity) continue;
    const j = structuralNeighbor(i, axis * 2 + 1, input); if (j < 0) continue;
    [output.energyQ[i], output.energyQ[j]] = exchangeEnergy(input.packedCells[i], input.packedCells[j], input.energyQ[i], input.energyQ[j], cold);
    output.packedCells[i] = thermalView(input.packedCells[i], output.energyQ[i], cold);
    output.packedCells[j] = thermalView(input.packedCells[j], output.energyQ[j], cold);
  }
  return output;
}
/** Clear invalid links only. Transformations never silently join neighboring solids. */
function clearInvalidBonds(block: ReactiveMaterialBlock3D): void {
  for (let i = 0; i < block.structure.length; i++) for (let dir = 0; dir < 6; dir++) if (block.structure[i] & BONDS_3D[dir]) {
    const j = structuralNeighbor(i, dir, block);
    if (!(block.structure[i] & INTEGRITY_3D) || j < 0 || !(block.structure[j] & INTEGRITY_3D) || !(block.structure[j] & BONDS_3D[dir ^ 1])) block.structure[i] &= ~BONDS_3D[dir];
  }
}
function phase(input: ReactiveMaterialBlock3D, cold: Uint32Array, changed: number[]): ReactiveMaterialBlock3D {
  const output = copy(input);
  for (let i = 0; i < input.packedCells.length; i++) {
    const old = input.packedCells[i], next = phaseMaterial(old, input.energyQ[i], cold);
    if (next === (old & 255)) continue;
    changed.push(i); output.packedCells[i] = rewriteMaterial(old, next, input.energyQ[i], cold);
    output.structure[i] = eligible(output.packedCells[i], cold) ? (eligible(old, cold) ? input.structure[i] : INTEGRITY_3D) : 0;
  }
  clearInvalidBonds(output); return output;
}
function combustion(input: ReactiveMaterialBlock3D, cold: Uint32Array, cycle: number, report: ReactiveReactionReport3D): ReactiveMaterialBlock3D {
  const output = copy(input), n = input.packedCells.length, proposed = new Int32Array(n).fill(-1), chosen = new Int32Array(n).fill(-1);
  const burning = (i: number) => prop(input.packedCells[i], cold, COLD_FUEL_ENERGY) > 0 &&
    temperatureQ(input.packedCells[i], input.energyQ[i], cold) > prop(input.packedCells[i], cold, COLD_FLASH_POINT) * ENERGY_SCALE;
  const neighbors = (i: number): number[] => {
    const x = i % input.width, y = Math.floor(i / input.width) % input.height, z = Math.floor(i / (input.width * input.height));
    const offset = (x + 2 * y + 3 * z + cycle % 6) % 6, result: number[] = [];
    for (let k = 0; k < 6; k++) {const j = structuralNeighbor(i, (offset + k) % 6, input); if (j >= 0) result.push(j);}
    return result;
  };
  for (let i = 0; i < n; i++) if (burning(i)) proposed[i] = neighbors(i).find(j => prop(input.packedCells[j], cold, COLD_OXIDIZER) === 1) ?? -1;
  for (let i = 0; i < n; i++) if (prop(input.packedCells[i], cold, COLD_OXIDIZER) === 1) chosen[i] = neighbors(i).find(j => proposed[j] === i) ?? -1;
  const product = (i: number, material: number, energyQ: number) => {
    output.energyQ[i] = energyQ; output.packedCells[i] = rewriteMaterial(input.packedCells[i], material, energyQ, cold);
    output.structure[i] = eligible(output.packedCells[i], cold) ? INTEGRITY_3D : 0;
  };
  for (let i = 0; i < n; i++) {
    const j = proposed[i];
    if (j >= 0 && chosen[j] === i) {
      const fuel = input.packedCells[i], transfer = Math.min(Math.floor(prop(fuel, cold, COLD_FUEL_ENERGY) * ENERGY_SCALE / 2), MAX_ENERGY_Q - input.energyQ[j]);
      product(i, prop(fuel, cold, COLD_BURNS_INTO), input.energyQ[i] - transfer);
      product(j, prop(fuel, cold, COLD_SMOKE_PRODUCT), input.energyQ[j] + transfer);
      report.reactedPairs.push({fuel: i, oxidizer: j, transferredEnergyQ: transfer});
    } else if ((input.packedCells[i] & 255) === MAT.FIRE) {
      const adjacent = neighbors(i);
      if (!adjacent.some(k => prop(input.packedCells[k], cold, COLD_FUEL_ENERGY) > 0) ||
          adjacent.some(k => (input.packedCells[k] & 255) === MAT.WATER) || temperatureQ(input.packedCells[i], input.energyQ[i], cold) < 80 * ENERGY_SCALE) {
        product(i, MAT.SMOKE, input.energyQ[i]); report.extinguishedCells.push(i);
      }
    }
  }
  clearInvalidBonds(output); return output;
}

/** Each advance executes one immutable-input pass; partial state never escapes. */
function reactionJob(registry: ReactiveMaterialRegistry3D, raw: ReactiveReactionState3D, observe?: (index: number, block: ReactiveMaterialBlock3D) => void): ReactiveReactionJob3D {
  const state = readReactiveReactionState3D(registry, raw), cycle = state.cycle, cold = reactiveRegistrySource3D(registry).cold;
  if (cycle === Number.MAX_SAFE_INTEGER) throw Error('Reactive cycle would overflow.');
  let before: ReactiveMaterialBlock3D | null = state.block, current: ReactiveMaterialBlock3D | null = copy(before), completedPasses = 0;
  let status: ReactiveReactionProgress3D['status'] = 'running', result: ReactiveReactionResult3D | null = null;
  const initial = totals(before, cold), report: ReactiveReactionReport3D = {
    rulesVersion: REACTIVE_REACTION_RULES_3D, materialCatalogHash: registry.hash, fromCycle: cycle, toCycle: cycle + 1,
    changedCells: [], phaseChangedCells: [], extinguishedCells: [], reactedPairs: [],
    energy: {beforeQ: initial.energyQ.toString(), afterQ: initial.energyQ.toString(), externalQ: '0', driftQ: '0',
      chemicalBeforeQ: initial.chemicalQ.toString(), chemicalAfterQ: initial.chemicalQ.toString()},
  };
  const progress = (): ReactiveReactionProgress3D => ({status, completedPasses, totalPasses: 8});
  return Object.freeze({
    progress,
    advance() {
      if (status !== 'running' || !current || !before) throw Error('Reactive job is no longer running.');
      try {
        if (completedPasses < 6) current = heat(current, cold, Math.floor(completedPasses / 2), completedPasses % 2);
        else if (completedPasses === 6) current = phase(current, cold, report.phaseChangedCells);
        else current = combustion(current, cold, cycle, report);
        observe?.(completedPasses, current);
        completedPasses++;
        if (completedPasses === 8) {
          // Validate before publication; source and internal state remain isolated on failure.
          const block = readReactiveMaterialBlock3D(registry, current), final = totals(block, cold);
          if (final.energyQ !== initial.energyQ) throw Error('Reactive cycle violated energy conservation.');
          report.energy.afterQ = final.energyQ.toString(); report.energy.chemicalAfterQ = final.chemicalQ.toString();
          for (let i = 0; i < block.packedCells.length; i++) if (block.packedCells[i] !== before.packedCells[i] || block.energyQ[i] !== before.energyQ[i] || block.structure[i] !== before.structure[i]) report.changedCells.push(i);
          result = {state: {schemaVersion: 1, rulesVersion: REACTIVE_REACTION_RULES_3D, cycle: cycle + 1, block}, report};
          current = before = null; status = 'complete';
        }
      } catch (error) {current = before = null; status = 'cancelled'; throw error;}
      return progress();
    },
    cancel() {if (status !== 'running') return false; current = before = null; status = 'cancelled'; return true;},
    result() {if (!result || status !== 'complete') throw Error('Reactive result is not complete.'); return structuredClone(result);},
  });
}
export function createReactiveReactionJob3D(registry: ReactiveMaterialRegistry3D, raw: ReactiveReactionState3D): ReactiveReactionJob3D {return reactionJob(registry, raw);}
/** Internal capture hook; callers cannot attach callbacks through the public SDK. */
export function createObservedReactiveReactionJob3D(registry: ReactiveMaterialRegistry3D, raw: ReactiveReactionState3D, observe: (index: number, block: ReactiveMaterialBlock3D) => void): ReactiveReactionJob3D {return reactionJob(registry, raw, observe);}
/** Convenience for a single bounded cycle; does not accept a tick count. */
export function advanceReactiveReactions3D(registry: ReactiveMaterialRegistry3D, state: ReactiveReactionState3D): ReactiveReactionResult3D {
  const job = createReactiveReactionJob3D(registry, state); for (let i = 0; i < 8; i++) job.advance(); return job.result();
}
