/** Bounded local reactive cycles. No movement, global support, Worker or GPU. */
import { MAT, PHASE, PHASE_SHIFT } from '../../generated/materials.js';
import { MAX_ENERGY_Q, ENERGY_SCALE } from '../../thermal.js';
import { INTEGRITY_3D, BONDS_3D } from '../structural-mechanics.js';
import {
  readReactiveMaterialBlock3D,
  checkReactiveMaterialBlock3D,
  type ReactiveMaterialBlock3D,
} from './reactive-block.js';
import {
  reactiveFields3D,
  reactiveInteger3D,
  cloneReactiveData3D,
  type ReactiveMaterialRegistry3D,
} from './reactive-registry.js';
import {
  reactiveThermalTables3D,
  reactiveTemperatureQ3D,
  reactiveThermalView3D,
  reactivePhaseMaterial3D,
  reactiveRewriteMaterial3D,
  type ReactiveThermalTables3D,
} from './reactive-thermal-tables.js';

export const REACTIVE_REACTION_RULES_3D = 'reactive-reactions-1';
export const REACTIVE_REACTION_SCHEMA_3D = 1;
export const REACTIVE_REACTION_PASSES_3D = Object.freeze([
  'heat-x-even',
  'heat-x-odd',
  'heat-y-even',
  'heat-y-odd',
  'heat-z-even',
  'heat-z-odd',
  'phase',
  'combustion',
] as const);
export type ReactiveReactionState3D = {
  schemaVersion: 1;
  rulesVersion: typeof REACTIVE_REACTION_RULES_3D;
  cycle: number;
  block: ReactiveMaterialBlock3D;
};
export type ReactiveReactionReport3D = {
  rulesVersion: typeof REACTIVE_REACTION_RULES_3D;
  materialCatalogHash: string;
  fromCycle: number;
  toCycle: number;
  changedCells: number[];
  phaseChangedCells: number[];
  extinguishedCells: number[];
  reactedPairs: { fuel: number; oxidizer: number; transferredEnergyQ: number }[];
  energy: {
    beforeQ: string;
    afterQ: string;
    externalQ: '0';
    driftQ: '0';
    chemicalBeforeQ: string;
    chemicalAfterQ: string;
  };
};
export type ReactiveReactionResult3D = {
  state: ReactiveReactionState3D;
  report: ReactiveReactionReport3D;
};
export type ReactiveReactionProgress3D = {
  status: 'running' | 'complete' | 'cancelled';
  completedPasses: number;
  totalPasses: 8;
};
export interface ReactiveReactionJob3D {
  progress(): ReactiveReactionProgress3D;
  advance(): ReactiveReactionProgress3D;
  cancel(): boolean;
  result(): ReactiveReactionResult3D;
}

export function createReactiveReactionState3D(
  registry: ReactiveMaterialRegistry3D,
  block: ReactiveMaterialBlock3D,
  cycle: number = 0,
): ReactiveReactionState3D {
  reactiveInteger3D(cycle, 0, Number.MAX_SAFE_INTEGER);
  return {
    schemaVersion: 1,
    rulesVersion: REACTIVE_REACTION_RULES_3D,
    cycle: cycle === 0 ? 0 : cycle,
    block: readReactiveMaterialBlock3D(registry, block),
  };
}
export function readReactiveReactionState3D(
  registry: ReactiveMaterialRegistry3D,
  raw: unknown,
): ReactiveReactionState3D {
  reactiveFields3D(raw, ['schemaVersion', 'rulesVersion', 'cycle', 'block']);
  if (
    raw.schemaVersion !== REACTIVE_REACTION_SCHEMA_3D ||
    raw.rulesVersion !== REACTIVE_REACTION_RULES_3D
  )
    throw Error('Incompatible reactive reaction state.');
  const cycle = reactiveInteger3D(raw.cycle, 0, Number.MAX_SAFE_INTEGER);
  return {
    schemaVersion: 1,
    rulesVersion: REACTIVE_REACTION_RULES_3D,
    cycle,
    block: readReactiveMaterialBlock3D(registry, raw.block),
  };
}

/** Copy-on-write pass output: each immutable input array is shared until its first write. */
function draft(input: ReactiveMaterialBlock3D) {
  const cells = input.packedCells,
    energy = input.energyQ,
    structure = input.structure;
  const out = {
    cells,
    energy,
    structure,
    ownCells() {
      if (out.cells === cells) out.cells = cells.slice();
    },
    ownStructure() {
      if (out.structure === structure) out.structure = structure.slice();
    },
    own() {
      out.ownCells();
      if (out.energy === energy) out.energy = energy.slice();
      out.ownStructure();
    },
    block: (): ReactiveMaterialBlock3D => ({
      ...input,
      packedCells: out.cells,
      energyQ: out.energy,
      structure: out.structure,
    }),
  };
  return out;
}
type Tables = ReactiveThermalTables3D;
const eligible = (word: number, T: Tables) => {
  const p = (word >>> PHASE_SHIFT) & 15;
  return (p === PHASE.SOLID || p === PHASE.FROZEN) && T.cohesion[word & 255] > 0;
};
const BOND_MASK_3D = BONDS_3D.reduce((mask, bit) => mask | bit, 0);
/** Exact under REACTIVE_BLOCK_LIMITS_3D: chemical energy never exceeds a cell's conserved energy. */
function exactTotals(energyQ: number, chemicalQ: number) {
  if (!Number.isSafeInteger(energyQ) || !Number.isSafeInteger(chemicalQ))
    throw Error('Reactive energy total exceeds exact integer range.');
  return { energyQ: BigInt(energyQ), chemicalQ: BigInt(chemicalQ) };
}
function totals(block: ReactiveMaterialBlock3D, T: Tables) {
  const cells = block.packedCells,
    energy = block.energyQ,
    { fuelQ } = T;
  let energyQ = 0,
    chemicalQ = 0;
  for (let i = 0; i < energy.length; i++) {
    energyQ += energy[i];
    chemicalQ += fuelQ[cells[i] & 255];
  }
  return exactTotals(energyQ, chemicalQ);
}
/** totals of a completed block, collecting on the way the cells that differ from the cycle input. */
function finalTotals(
  before: ReactiveMaterialBlock3D,
  block: ReactiveMaterialBlock3D,
  T: Tables,
  changedCells: number[],
) {
  const cells = block.packedCells,
    energy = block.energyQ,
    structure = block.structure,
    oldCells = before.packedCells,
    oldEnergy = before.energyQ,
    oldStructure = before.structure,
    { fuelQ } = T;
  let energyQ = 0,
    chemicalQ = 0;
  for (let i = 0; i < energy.length; i++) {
    const c = cells[i],
      e = energy[i];
    energyQ += e;
    chemicalQ += fuelQ[c & 255];
    if (c !== oldCells[i] || e !== oldEnergy[i] || structure[i] !== oldStructure[i])
      changedCells.push(i);
  }
  return exactTotals(energyQ, chemicalQ);
}
/** Disjoint parity pairs along one axis, visited in ascending index order. A pair whose energies do
 * not change is skipped exactly: its packed words already equal their thermal views.
 * Heat never writes structure, so the output shares it.
 */
function heat(
  input: ReactiveMaterialBlock3D,
  T: Tables,
  axis: number,
  parity: number,
): ReactiveMaterialBlock3D {
  const w = input.width,
    h = input.height,
    d = input.depth,
    cells = input.packedCells,
    energy = input.energyQ,
    { conductivity, fuelQ } = T;
  const step = axis === 0 ? 1 : axis === 1 ? w : w * h;
  // A coordinate has this parity and a successor exactly when it is parity, parity + 2, ... < extent - 1.
  const x0 = axis === 0 ? parity : 0,
    xEnd = axis === 0 ? w - 1 : w,
    xStep = axis === 0 ? 2 : 1;
  const y0 = axis === 1 ? parity : 0,
    yEnd = axis === 1 ? h - 1 : h,
    yStep = axis === 1 ? 2 : 1;
  const z0 = axis === 2 ? parity : 0,
    zEnd = axis === 2 ? d - 1 : d,
    zStep = axis === 2 ? 2 : 1;
  let outCells = cells,
    outEnergy = energy;
  for (let z = z0; z < zEnd; z += zStep)
    for (let y = y0; y < yEnd; y += yStep)
      for (let x = x0, i = x0 + w * (y + h * z); x < xEnd; x += xStep, i += xStep) {
        const j = i + step,
          a = cells[i],
          b = cells[j],
          ea = energy[i],
          eb = energy[j];
        if (a === b && ea === eb) continue;
        // thermal.ts exchangeEnergy, unchanged apart from the table reads.
        const ma = a & 255,
          mb = b & 255,
          ta = reactiveTemperatureQ3D(T, a, ea),
          tb = reactiveTemperatureQ3D(T, b, eb),
          ca = conductivity[ma],
          cb = conductivity[mb];
        const k = ca + cb ? Math.floor((2 * ca * cb) / (ca + cb)) : 0;
        const difference = Math.abs(ta - tb);
        let flux =
          Math.floor(difference / 512) * k + Math.floor(((difference % 512) * k + 511) / 512);
        flux = Math.min(flux, Math.floor(difference / 2));
        let ei: number, ej: number;
        if (ta > tb) {
          flux = Math.min(flux, ea - fuelQ[ma], MAX_ENERGY_Q - eb);
          ei = ea - flux;
          ej = eb + flux;
        } else {
          flux = Math.min(flux, eb - fuelQ[mb], MAX_ENERGY_Q - ea);
          ei = ea + flux;
          ej = eb - flux;
        }
        if (ei === ea && ej === eb) continue;
        if (outCells === cells) {
          outCells = cells.slice();
          outEnergy = energy.slice();
        }
        outEnergy[i] = ei;
        outEnergy[j] = ej;
        outCells[i] = reactiveThermalView3D(T, a, ei);
        outCells[j] = reactiveThermalView3D(T, b, ej);
      }
  return outCells === cells
    ? { ...input }
    : { ...input, packedCells: outCells, energyQ: outEnergy };
}
/** structuralNeighbor of i in each direction -X,+X,-Y,+Y,-Z,+Z into around, -1 at a closed
 * boundary. Returns x + 2y + 3z, where the cell's rotated combustion order starts.
 */
function neighborsOf(around: number[], i: number, geometry: ReactiveMaterialBlock3D): number {
  const w = geometry.width,
    h = geometry.height,
    layer = w * h,
    x = i % w,
    y = Math.floor(i / w) % h,
    z = Math.floor(i / layer);
  around[0] = x ? i - 1 : -1;
  around[1] = x + 1 < w ? i + 1 : -1;
  around[2] = y ? i - w : -1;
  around[3] = y + 1 < h ? i + w : -1;
  around[4] = z ? i - layer : -1;
  around[5] = z + 1 < geometry.depth ? i + layer : -1;
  return x + 2 * y + 3 * z;
}
/** Clear invalid links only. Transformations never silently join neighboring solids.
 * Reads follow the words already cleared in this sweep; the draft copies structure on the first clear.
 */
function clearInvalidBonds(
  output: ReturnType<typeof draft>,
  geometry: ReactiveMaterialBlock3D,
): void {
  const around = [-1, -1, -1, -1, -1, -1];
  for (let i = 0; i < output.structure.length; i++) {
    if ((output.structure[i] & BOND_MASK_3D) === 0) continue;
    neighborsOf(around, i, geometry);
    for (let dir = 0; dir < 6; dir++)
      if (output.structure[i] & BONDS_3D[dir]) {
        const j = around[dir];
        if (
          !(output.structure[i] & INTEGRITY_3D) ||
          j < 0 ||
          !(output.structure[j] & INTEGRITY_3D) ||
          !(output.structure[j] & BONDS_3D[dir ^ 1])
        ) {
          output.ownStructure();
          output.structure[i] &= ~BONDS_3D[dir];
        }
      }
  }
}
/** Phase never writes energy, so the output shares it. */
function phase(
  input: ReactiveMaterialBlock3D,
  T: Tables,
  changed: number[],
): ReactiveMaterialBlock3D {
  const output = draft(input),
    cells = input.packedCells,
    energy = input.energyQ,
    { transitions } = T;
  for (let i = 0; i < cells.length; i++) {
    const old = cells[i];
    if (!transitions[old & 255]) continue;
    const next = reactivePhaseMaterial3D(T, old, energy[i]);
    if (next === (old & 255)) continue;
    changed.push(i);
    output.ownCells();
    output.ownStructure();
    output.cells[i] = reactiveRewriteMaterial3D(T, old, next, energy[i]);
    output.structure[i] = eligible(output.cells[i], T)
      ? eligible(old, T)
        ? input.structure[i]
        : INTEGRITY_3D
      : 0;
  }
  clearInvalidBonds(output, input);
  return output.block();
}
/** Each burning cell proposes to its first oxidizer neighbor in a rotated direction order and each
 * proposed oxidizer accepts its first proposer in its own order. Only burning and fire cells can act,
 * so one scan lists them in ascending order and the products follow that list.
 */
function combustion(
  input: ReactiveMaterialBlock3D,
  T: Tables,
  cycle: number,
  report: ReactiveReactionReport3D,
): ReactiveMaterialBlock3D {
  const output = draft(input),
    cells = input.packedCells,
    energy = input.energyQ,
    n = cells.length,
    rotation = cycle % 6,
    around = [-1, -1, -1, -1, -1, -1],
    burning: number[] = [],
    acting: number[] = [],
    wanted: number[] = [],
    { fuelQ, flashQ, oxidizer } = T;
  for (let i = 0; i < n; i++) {
    const m = cells[i] & 255;
    if (fuelQ[m] > 0 && reactiveTemperatureQ3D(T, cells[i], energy[i]) > flashQ[m]) {
      burning.push(i);
      acting.push(i);
    } else if (m === MAT.FIRE) acting.push(i);
  }
  // proposed[i] = j + 1 and chosen[j] = i + 1, 0 for none; chosen -1 marks a queued oxidizer.
  // Both are read only when some cell burns, so they stay empty otherwise.
  const size = burning.length ? n : 0,
    proposed = new Int32Array(size),
    chosen = new Int32Array(size);
  for (const i of burning) {
    const offset = (neighborsOf(around, i, input) + rotation) % 6;
    for (let k = 0; k < 6; k++) {
      const j = around[(offset + k) % 6];
      if (j >= 0 && oxidizer[cells[j] & 255] === 1) {
        proposed[i] = j + 1;
        if (chosen[j] === 0) {
          chosen[j] = -1;
          wanted.push(j);
        }
        break;
      }
    }
  }
  // Only a proposed oxidizer can be chosen, so the neighbor order of every other cell is never needed.
  for (const j of wanted) {
    const offset = (neighborsOf(around, j, input) + rotation) % 6;
    chosen[j] = 0;
    for (let k = 0; k < 6; k++) {
      const i = around[(offset + k) % 6];
      if (i >= 0 && proposed[i] === j + 1) {
        chosen[j] = i + 1;
        break;
      }
    }
  }
  const product = (i: number, material: number, energyQ: number) => {
    output.own();
    output.energy[i] = energyQ;
    output.cells[i] = reactiveRewriteMaterial3D(T, cells[i], material, energyQ);
    output.structure[i] = eligible(output.cells[i], T) ? INTEGRITY_3D : 0;
  };
  for (const i of acting) {
    const j = size ? proposed[i] - 1 : -1;
    if (j >= 0 && chosen[j] === i + 1) {
      const fuel = cells[i] & 255,
        transfer = Math.min(Math.floor(fuelQ[fuel] / 2), MAX_ENERGY_Q - energy[j]);
      product(i, T.burnsInto[fuel], energy[i] - transfer);
      product(j, T.smokeProduct[fuel], energy[j] + transfer);
      report.reactedPairs.push({ fuel: i, oxidizer: j, transferredEnergyQ: transfer });
    } else if ((cells[i] & 255) === MAT.FIRE) {
      neighborsOf(around, i, input);
      let nearFuel = false,
        nearWater = false;
      for (let dir = 0; dir < 6; dir++) {
        const k = around[dir];
        if (k < 0) continue;
        if (fuelQ[cells[k] & 255] > 0) nearFuel = true;
        if ((cells[k] & 255) === MAT.WATER) nearWater = true;
      }
      if (
        !nearFuel ||
        nearWater ||
        reactiveTemperatureQ3D(T, cells[i], energy[i]) < 80 * ENERGY_SCALE
      ) {
        product(i, MAT.SMOKE, energy[i]);
        report.extinguishedCells.push(i);
      }
    }
  }
  clearInvalidBonds(output, input);
  return output.block();
}

type Observe = (index: number, block: ReactiveMaterialBlock3D) => void;
/** Each advance executes one immutable-input pass; partial state never escapes.
 * Owned validated state only. Public entries validate first and never hand over uncopied results.
 */
function reactionJob(
  registry: ReactiveMaterialRegistry3D,
  state: ReactiveReactionState3D,
  observe?: Observe,
) {
  const cycle = state.cycle,
    T = reactiveThermalTables3D(registry);
  if (cycle === Number.MAX_SAFE_INTEGER) throw Error('Reactive cycle would overflow.');
  let before: ReactiveMaterialBlock3D | null = state.block,
    current: ReactiveMaterialBlock3D | null = before,
    completedPasses = 0;
  let status: ReactiveReactionProgress3D['status'] = 'running',
    result: ReactiveReactionResult3D | null = null;
  const initial = totals(before, T),
    report: ReactiveReactionReport3D = {
      rulesVersion: REACTIVE_REACTION_RULES_3D,
      materialCatalogHash: registry.hash,
      fromCycle: cycle,
      toCycle: cycle + 1,
      changedCells: [],
      phaseChangedCells: [],
      extinguishedCells: [],
      reactedPairs: [],
      energy: {
        beforeQ: initial.energyQ.toString(),
        afterQ: initial.energyQ.toString(),
        externalQ: '0',
        driftQ: '0',
        chemicalBeforeQ: initial.chemicalQ.toString(),
        chemicalAfterQ: initial.chemicalQ.toString(),
      },
    };
  const progress = (): ReactiveReactionProgress3D => ({ status, completedPasses, totalPasses: 8 });
  const job: ReactiveReactionJob3D = Object.freeze({
    progress,
    advance() {
      if (status !== 'running' || !current || !before)
        throw Error('Reactive job is no longer running.');
      try {
        if (completedPasses < 6)
          current = heat(current, T, Math.floor(completedPasses / 2), completedPasses % 2);
        else if (completedPasses === 6) current = phase(current, T, report.phaseChangedCells);
        else current = combustion(current, T, cycle, report);
        observe?.(completedPasses, current);
        completedPasses++;
        if (completedPasses === 8) {
          // Validate before publication; source and internal state remain isolated on failure,
          // and the report filled so far is never published.
          const block = checkReactiveMaterialBlock3D(registry, current),
            final = finalTotals(before, block, T, report.changedCells);
          if (final.energyQ !== initial.energyQ)
            throw Error('Reactive cycle violated energy conservation.');
          report.energy.afterQ = final.energyQ.toString();
          report.energy.chemicalAfterQ = final.chemicalQ.toString();
          result = {
            state: {
              schemaVersion: 1,
              rulesVersion: REACTIVE_REACTION_RULES_3D,
              cycle: cycle + 1,
              block,
            },
            report,
          };
          current = before = null;
          status = 'complete';
        }
      } catch (error) {
        current = before = null;
        status = 'cancelled';
        throw error;
      }
      return progress();
    },
    cancel() {
      if (status !== 'running') return false;
      current = before = null;
      status = 'cancelled';
      return true;
    },
    result() {
      if (!result || status !== 'complete') throw Error('Reactive result is not complete.');
      return cloneReactiveData3D(result);
    },
  });
  return {
    job,
    output() {
      if (!result || status !== 'complete') throw Error('Reactive result is not complete.');
      return result;
    },
  };
}
export function createReactiveReactionJob3D(
  registry: ReactiveMaterialRegistry3D,
  raw: ReactiveReactionState3D,
): ReactiveReactionJob3D {
  return reactionJob(registry, readReactiveReactionState3D(registry, raw)).job;
}
/** Internal only: owned validated state, an optional capture hook and an uncopied result hand-off.
 * Callers cannot attach callbacks through the public SDK.
 */
export function startReactiveReactionJob3D(
  registry: ReactiveMaterialRegistry3D,
  state: ReactiveReactionState3D,
  observe?: Observe,
) {
  return reactionJob(registry, state, observe);
}
/** Convenience for a single bounded cycle; does not accept a tick count. */
export function advanceReactiveReactions3D(
  registry: ReactiveMaterialRegistry3D,
  state: ReactiveReactionState3D,
): ReactiveReactionResult3D {
  const job = createReactiveReactionJob3D(registry, state);
  for (let i = 0; i < 8; i++) job.advance();
  return job.result();
}
