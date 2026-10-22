/** Reaction passes over the per-registry thermal tables, against the previous passes kept here as the oracle. */
import { beforeAll, describe, expect, test } from 'vitest';
import {
  PHASE_SHIFT,
  COLD_STRIDE,
  COLD_COHESION,
  COLD_FUEL_ENERGY,
  COLD_FLASH_POINT,
  COLD_OXIDIZER,
  COLD_BURNS_INTO,
  COLD_SMOKE_PRODUCT,
  COLD_MELTS_INTO,
  COLD_BOILS_INTO,
  COLD_FREEZES_INTO,
  COLD_CONDENSES_INTO,
} from '../../generated/materials.js';
import {
  temperatureQ,
  exchangeEnergy,
  thermalView,
  phaseMaterial,
  rewriteMaterial,
} from '../../thermal.js';
import { INTEGRITY_3D, BONDS_3D, structuralNeighbor } from '../structural-mechanics.js';
import {
  createReactiveMaterialRegistry3D,
  createThermalMaterialRegistry3D,
  defaultReactiveMaterialCatalog3D,
  createReactiveMaterialBlock3D,
  editReactiveMaterialBlock3D,
  MAT,
  PHASE,
  ENERGY_SCALE,
  MAX_ENERGY_Q,
  type ReactiveMaterialBlock3D,
  type ReactiveMaterialEdit3D,
  type ReactiveMaterialRegistry3D,
} from '../reactive-materials.js';
import { reactiveRegistrySource3D } from './reactive-registry.js';
import { checkReactiveMaterialBlock3D } from './reactive-block.js';
import {
  reactiveThermalTables3D,
  reactivePhaseMaterial3D,
  reactiveRewriteMaterial3D,
} from './reactive-thermal-tables.js';
import {
  startReactiveReactionJob3D,
  REACTIVE_REACTION_RULES_3D,
  type ReactiveReactionState3D,
  type ReactiveReactionReport3D,
} from './reactive-reactions.js';

let registries: [string, ReactiveMaterialRegistry3D][];
beforeAll(async () => {
  const base = await createReactiveMaterialRegistry3D();
  const custom = await base.extend([
    { ...structuredClone(base.material(MAT.WOOD)), id: 200, name: 'resin' },
    {
      ...structuredClone(base.material(MAT.ASH)),
      id: 201,
      name: 'soft_solid',
      properties: { ...base.material(MAT.ASH).properties, default_phase: PHASE.SOLID, cohesion: 0 },
    },
  ]);
  registries = [
    ['default', base],
    ['thermal', await createThermalMaterialRegistry3D()],
    ['custom', custom],
  ];
});
function random(seed: number) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
const clamp = (e: number, low = 0) => Math.min(MAX_ENERGY_Q, Math.max(low, e));
type Block = ReactiveMaterialBlock3D;

// The passes as they stood before the tables, verbatim apart from types.
const prop = (word: number, cold: Uint32Array, key: number) =>
  cold[(word & 255) * COLD_STRIDE + key];
const eligible = (word: number, cold: Uint32Array) => {
  const p = (word >>> PHASE_SHIFT) & 15;
  return (p === PHASE.SOLID || p === PHASE.FROZEN) && prop(word, cold, COLD_COHESION) > 0;
};
const BOND_MASK_3D = BONDS_3D.reduce((mask, bit) => mask | bit, 0);
function draft(input: Block) {
  const cells = input.packedCells,
    energy = input.energyQ,
    structure = input.structure;
  const out = {
    cells,
    energy,
    structure,
    own() {
      if (out.cells === cells) {
        out.cells = cells.slice();
        out.energy = energy.slice();
        out.structure = structure.slice();
      }
    },
    block: (): Block =>
      out.cells === cells
        ? { ...input }
        : { ...input, packedCells: out.cells, energyQ: out.energy, structure: out.structure },
  };
  return out;
}
function totals(block: Block, cold: Uint32Array) {
  let energyQ = 0,
    chemicalQ = 0;
  for (let i = 0; i < block.energyQ.length; i++) {
    energyQ += block.energyQ[i];
    chemicalQ += prop(block.packedCells[i], cold, COLD_FUEL_ENERGY) * ENERGY_SCALE;
  }
  if (!Number.isSafeInteger(energyQ) || !Number.isSafeInteger(chemicalQ))
    throw Error('Reactive energy total exceeds exact integer range.');
  return { energyQ: BigInt(energyQ), chemicalQ: BigInt(chemicalQ) };
}
function phaseTransitions(cold: Uint32Array): Uint8Array {
  const transitions = new Uint8Array(256);
  for (let m = 0; m < transitions.length && (m + 1) * COLD_STRIDE <= cold.length; m++) {
    const at = m * COLD_STRIDE;
    transitions[m] =
      cold[at + COLD_MELTS_INTO] ||
      cold[at + COLD_BOILS_INTO] ||
      cold[at + COLD_FREEZES_INTO] ||
      cold[at + COLD_CONDENSES_INTO]
        ? 1
        : 0;
  }
  return transitions;
}
function heat(input: Block, cold: Uint32Array, axis: number, parity: number): Block {
  const output = draft(input),
    w = input.width,
    h = input.height,
    d = input.depth,
    cells = input.packedCells,
    energy = input.energyQ;
  const step = axis === 0 ? 1 : axis === 1 ? w : w * h,
    extent = axis === 0 ? w : axis === 1 ? h : d;
  for (let z = 0; z < d; z++)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const coordinate = axis === 0 ? x : axis === 1 ? y : z;
        if (coordinate % 2 !== parity || coordinate + 1 >= extent) continue;
        const i = x + w * (y + h * z),
          j = i + step;
        if (cells[i] === cells[j] && energy[i] === energy[j]) continue;
        const [ei, ej] = exchangeEnergy(cells[i], cells[j], energy[i], energy[j], cold);
        if (ei === energy[i] && ej === energy[j]) continue;
        output.own();
        output.energy[i] = ei;
        output.energy[j] = ej;
        output.cells[i] = thermalView(cells[i], ei, cold);
        output.cells[j] = thermalView(cells[j], ej, cold);
      }
  return output.block();
}
function clearInvalidBonds(output: ReturnType<typeof draft>, geometry: Block): void {
  for (let i = 0; i < output.structure.length; i++) {
    if ((output.structure[i] & BOND_MASK_3D) === 0) continue;
    for (let dir = 0; dir < 6; dir++)
      if (output.structure[i] & BONDS_3D[dir]) {
        const j = structuralNeighbor(i, dir, geometry);
        if (
          !(output.structure[i] & INTEGRITY_3D) ||
          j < 0 ||
          !(output.structure[j] & INTEGRITY_3D) ||
          !(output.structure[j] & BONDS_3D[dir ^ 1])
        ) {
          output.own();
          output.structure[i] &= ~BONDS_3D[dir];
        }
      }
  }
}
function phase(input: Block, cold: Uint32Array, transitions: Uint8Array, changed: number[]): Block {
  const output = draft(input);
  for (let i = 0; i < input.packedCells.length; i++) {
    const old = input.packedCells[i];
    if (!transitions[old & 255]) continue;
    const next = phaseMaterial(old, input.energyQ[i], cold);
    if (next === (old & 255)) continue;
    changed.push(i);
    output.own();
    output.cells[i] = rewriteMaterial(old, next, input.energyQ[i], cold);
    output.structure[i] = eligible(output.cells[i], cold)
      ? eligible(old, cold)
        ? input.structure[i]
        : INTEGRITY_3D
      : 0;
  }
  clearInvalidBonds(output, input);
  return output.block();
}
function combustion(
  input: Block,
  cold: Uint32Array,
  cycle: number,
  report: ReactiveReactionReport3D,
): Block {
  const output = draft(input),
    n = input.packedCells.length,
    proposed = new Int32Array(n).fill(-1),
    chosen = new Int32Array(n).fill(-1),
    wanted = new Uint8Array(n);
  const burning = (i: number) =>
    prop(input.packedCells[i], cold, COLD_FUEL_ENERGY) > 0 &&
    temperatureQ(input.packedCells[i], input.energyQ[i], cold) >
      prop(input.packedCells[i], cold, COLD_FLASH_POINT) * ENERGY_SCALE;
  const neighbors = (i: number): number[] => {
    const x = i % input.width,
      y = Math.floor(i / input.width) % input.height,
      z = Math.floor(i / (input.width * input.height));
    const offset = (x + 2 * y + 3 * z + (cycle % 6)) % 6,
      result: number[] = [];
    for (let k = 0; k < 6; k++) {
      const j = structuralNeighbor(i, (offset + k) % 6, input);
      if (j >= 0) result.push(j);
    }
    return result;
  };
  for (let i = 0; i < n; i++)
    if (burning(i)) {
      const j =
        neighbors(i).find((k) => prop(input.packedCells[k], cold, COLD_OXIDIZER) === 1) ?? -1;
      proposed[i] = j;
      if (j >= 0) wanted[j] = 1;
    }
  for (let i = 0; i < n; i++)
    if (wanted[i] && prop(input.packedCells[i], cold, COLD_OXIDIZER) === 1)
      chosen[i] = neighbors(i).find((j) => proposed[j] === i) ?? -1;
  const product = (i: number, material: number, energyQ: number) => {
    output.own();
    output.energy[i] = energyQ;
    output.cells[i] = rewriteMaterial(input.packedCells[i], material, energyQ, cold);
    output.structure[i] = eligible(output.cells[i], cold) ? INTEGRITY_3D : 0;
  };
  for (let i = 0; i < n; i++) {
    const j = proposed[i];
    if (j >= 0 && chosen[j] === i) {
      const fuel = input.packedCells[i],
        transfer = Math.min(
          Math.floor((prop(fuel, cold, COLD_FUEL_ENERGY) * ENERGY_SCALE) / 2),
          MAX_ENERGY_Q - input.energyQ[j],
        );
      product(i, prop(fuel, cold, COLD_BURNS_INTO), input.energyQ[i] - transfer);
      product(j, prop(fuel, cold, COLD_SMOKE_PRODUCT), input.energyQ[j] + transfer);
      report.reactedPairs.push({ fuel: i, oxidizer: j, transferredEnergyQ: transfer });
    } else if ((input.packedCells[i] & 255) === MAT.FIRE) {
      const adjacent = neighbors(i);
      if (
        !adjacent.some((k) => prop(input.packedCells[k], cold, COLD_FUEL_ENERGY) > 0) ||
        adjacent.some((k) => (input.packedCells[k] & 255) === MAT.WATER) ||
        temperatureQ(input.packedCells[i], input.energyQ[i], cold) < 80 * ENERGY_SCALE
      ) {
        product(i, MAT.SMOKE, input.energyQ[i]);
        report.extinguishedCells.push(i);
      }
    }
  }
  clearInvalidBonds(output, input);
  return output.block();
}
function emptyReport(registry: ReactiveMaterialRegistry3D, cycle: number) {
  return {
    rulesVersion: REACTIVE_REACTION_RULES_3D,
    materialCatalogHash: registry.hash,
    fromCycle: cycle,
    toCycle: cycle + 1,
    changedCells: [],
    phaseChangedCells: [],
    extinguishedCells: [],
    reactedPairs: [],
    energy: {
      beforeQ: '',
      afterQ: '',
      externalQ: '0',
      driftQ: '0',
      chemicalBeforeQ: '',
      chemicalAfterQ: '',
    },
  } as ReactiveReactionReport3D;
}
function oraclePass(
  registry: ReactiveMaterialRegistry3D,
  index: number,
  input: Block,
  cycle: number,
  report: ReactiveReactionReport3D,
): Block {
  const cold = reactiveRegistrySource3D(registry).cold;
  if (index < 6) return heat(input, cold, Math.floor(index / 2), index % 2);
  if (index === 6) return phase(input, cold, phaseTransitions(cold), report.phaseChangedCells);
  return combustion(input, cold, cycle, report);
}
/** The previous job body: eight passes, the completion check, totals and the changed-cell diff. */
function oracleCycle(registry: ReactiveMaterialRegistry3D, state: ReactiveReactionState3D) {
  const cold = reactiveRegistrySource3D(registry).cold,
    cycle = state.cycle,
    before = state.block,
    initial = totals(before, cold),
    report = emptyReport(registry, cycle);
  report.energy.beforeQ = report.energy.afterQ = initial.energyQ.toString();
  report.energy.chemicalBeforeQ = report.energy.chemicalAfterQ = initial.chemicalQ.toString();
  let current = before;
  for (let k = 0; k < 8; k++) current = oraclePass(registry, k, current, cycle, report);
  const block = checkReactiveMaterialBlock3D(registry, current),
    final = totals(block, cold);
  if (final.energyQ !== initial.energyQ)
    throw Error('Reactive cycle violated energy conservation.');
  report.energy.afterQ = final.energyQ.toString();
  report.energy.chemicalAfterQ = final.chemicalQ.toString();
  for (let i = 0; i < block.packedCells.length; i++)
    if (
      block.packedCells[i] !== before.packedCells[i] ||
      block.energyQ[i] !== before.energyQ[i] ||
      block.structure[i] !== before.structure[i]
    )
      report.changedCells.push(i);
  return {
    state: { schemaVersion: 1, rulesVersion: REACTIVE_REACTION_RULES_3D, cycle: cycle + 1, block },
    report,
  };
}
const outcome = (f: () => unknown) => {
  try {
    return 'ok ' + JSON.stringify(f());
  } catch (error) {
    return 'throw ' + (error as Error).message;
  }
};
const state = (block: Block, cycle: number): ReactiveReactionState3D => ({
  schemaVersion: 1,
  rulesVersion: REACTIVE_REACTION_RULES_3D,
  cycle,
  block,
});
/** Energies that sit on every temperature and phase breakpoint of a material, or anywhere. */
function breakpoints(registry: ReactiveMaterialRegistry3D, id: number) {
  const T = reactiveThermalTables3D(registry),
    f = T.fuelQ[id],
    p = f + T.phaseQ[id];
  return [
    f,
    p,
    p + T.upQ[id],
    p + T.downQ[id],
    f + T.downPhaseQ[id],
    T.upBoundary[id],
    T.downBoundary[id],
    p + T.flashQ[id],
    MAX_ENERGY_Q,
  ];
}
function nearBreakpoint(registry: ReactiveMaterialRegistry3D, id: number, rnd: () => number) {
  const points = breakpoints(registry, id),
    deltas = [0, 1, -1, 255, -255, 256, -256, 511, -511, 512, -512];
  if (rnd() < 0.1) return Math.floor(rnd() * (MAX_ENERGY_Q + 1));
  const delta =
    rnd() < 0.7
      ? deltas[Math.floor(rnd() * deltas.length)]
      : Math.floor((rnd() - 0.5) * 8 * ENERGY_SCALE);
  return clamp(points[Math.floor(rnd() * points.length)] + delta);
}
function applyEdits(
  registry: ReactiveMaterialRegistry3D,
  block: Block,
  edits: ReactiveMaterialEdit3D[],
): Block {
  for (let k = 0; k < edits.length; k += 4096)
    block = editReactiveMaterialBlock3D(registry, block, edits.slice(k, k + 4096)).block;
  return block;
}
const xyz = (block: Block, i: number) => ({
  x: i % block.width,
  y: Math.floor(i / block.width) % block.height,
  z: Math.floor(i / (block.width * block.height)),
});
/** Random anchors and reciprocal bonds between intact cells. */
function join(registry: ReactiveMaterialRegistry3D, block: Block, rnd: () => number): Block {
  const joins: ReactiveMaterialEdit3D[] = [];
  for (let i = 0; i < block.packedCells.length; i++) {
    if (!(block.structure[i] & INTEGRITY_3D)) continue;
    if (rnd() < 0.2) joins.push({ kind: 'anchor', ...xyz(block, i), anchored: true });
    for (const direction of [1, 3, 5]) {
      const j = structuralNeighbor(i, direction, block);
      if (j >= 0 && block.structure[j] & INTEGRITY_3D && rnd() < 0.7)
        joins.push({ kind: 'bond', ...xyz(block, i), direction, bonded: true });
    }
  }
  return applyEdits(registry, block, joins);
}
/** A valid block of random materials near their breakpoints, with anchors and reciprocal bonds. */
function randomBlock(
  registry: ReactiveMaterialRegistry3D,
  shape: { width: number; height: number; depth: number },
  rnd: () => number,
): Block {
  const T = reactiveThermalTables3D(registry),
    ids = registry.materialIds;
  let block = createReactiveMaterialBlock3D(registry, shape);
  const n = block.packedCells.length,
    places: ReactiveMaterialEdit3D[] = [];
  for (let i = 0; i < n; i++)
    if (rnd() > 0.25)
      places.push({
        kind: 'place',
        ...xyz(block, i),
        material: ids[Math.floor(rnd() * ids.length)],
        thermal: Math.floor(rnd() * 256),
      });
  block = applyEdits(registry, block, places);
  const energies: ReactiveMaterialEdit3D[] = [];
  for (let i = 0; i < n; i++) {
    const id = block.packedCells[i] & 255;
    if (rnd() < 0.6)
      energies.push({
        kind: 'energy',
        ...xyz(block, i),
        energyQ: clamp(nearBreakpoint(registry, id, rnd), T.fuelQ[id]),
      });
  }
  return join(registry, applyEdits(registry, block, energies), rnd);
}
/** Fuels mostly just above their flash points among oxidizers, fires on both sides of the
 * extinguishing temperature next to water, fuel or nothing.
 */
function combustionBlock(
  registry: ReactiveMaterialRegistry3D,
  shape: { width: number; height: number; depth: number },
  rnd: () => number,
): Block {
  const T = reactiveThermalTables3D(registry),
    ids = registry.materialIds,
    fuels = ids.filter((id) => T.fuelQ[id] > 0),
    oxidizers = ids.filter((id) => T.oxidizer[id] === 1),
    pick = (list: readonly number[]) => list[Math.floor(rnd() * list.length)];
  let block = createReactiveMaterialBlock3D(registry, shape);
  const n = block.packedCells.length,
    places: ReactiveMaterialEdit3D[] = [];
  for (let i = 0; i < n; i++) {
    const r = rnd(),
      material =
        r < 0.3
          ? pick(fuels)
          : r < 0.6
            ? pick(oxidizers)
            : r < 0.75
              ? MAT.FIRE
              : r < 0.82
                ? MAT.WATER
                : pick(ids);
    places.push({ kind: 'place', ...xyz(block, i), material, thermal: Math.floor(rnd() * 256) });
  }
  block = applyEdits(registry, block, places);
  const energies: ReactiveMaterialEdit3D[] = [];
  for (let i = 0; i < n; i++) {
    const id = block.packedCells[i] & 255,
      p = T.fuelQ[id] + T.phaseQ[id],
      near =
        rnd() < 0.2 ? Math.floor(rnd() * 3) - 1 : Math.floor((rnd() - 0.3) * 30 * ENERGY_SCALE);
    const energyQ =
      T.fuelQ[id] > 0 && rnd() < 0.85
        ? p + T.flashQ[id] + near
        : id === MAT.FIRE
          ? p + 80 * ENERGY_SCALE + near
          : nearBreakpoint(registry, id, rnd);
    energies.push({ kind: 'energy', ...xyz(block, i), energyQ: clamp(energyQ, T.fuelQ[id]) });
  }
  return join(registry, applyEdits(registry, block, energies), rnd);
}

describe('reaction passes over thermal tables', () => {
  test('phase targets and material rewrites match engine/thermal.ts for every material', () => {
    const mismatches: unknown[] = [];
    let checked = 0;
    for (const [name, registry] of registries) {
      const T = reactiveThermalTables3D(registry),
        cold = reactiveRegistrySource3D(registry).cold,
        rnd = random(name.length * 31),
        deltas = [-512, -256, -255, -2, -1, 0, 1, 2, 255, 256, 512];
      const word = (id: number) =>
        (id |
          (Math.floor(rnd() * 256) << 8) |
          (Math.floor(rnd() * 16) << PHASE_SHIFT) |
          (rnd() < 0.5 ? 0 : Math.floor(rnd() * 256) << 16) |
          (rnd() < 0.5 ? 0 : Math.floor(rnd() * 16) << 28)) >>>
        0;
      for (let id = 0; id < 256; id++)
        for (const point of [T.upBoundary[id], T.downBoundary[id], T.fuelQ[id], MAX_ENERGY_Q])
          for (const delta of deltas) {
            const e = clamp(point + delta),
              v = word(id);
            checked++;
            if (reactivePhaseMaterial3D(T, v, e) !== phaseMaterial(v, e, cold))
              mismatches.push(['phase', name, v, e]);
          }
      for (let target = 0; target < 256; target++) {
        const f = T.fuelQ[target],
          p = f + T.phaseQ[target],
          energies = [
            0,
            f,
            f + 1,
            p,
            p + T.upQ[target],
            T.upBoundary[target] - 1,
            T.upBoundary[target],
            T.downBoundary[target],
            T.downBoundary[target] + 1,
            clamp(p + Math.floor(rnd() * 512 * ENERGY_SCALE)),
            MAX_ENERGY_Q,
          ];
        for (let id = 0; id < 256; id++) {
          const v = word(id);
          for (const e of energies) {
            checked++;
            if (reactiveRewriteMaterial3D(T, v, target, e) !== rewriteMaterial(v, target, e, cold))
              mismatches.push(['rewrite', name, v, target, e]);
          }
        }
      }
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
    expect(checked).toBe(3 * (256 * 4 * 11 + 256 * 256 * 11));
  });
  test('heat exchanges random pairs exactly as exchangeEnergy and thermalView', () => {
    const mismatches: unknown[] = [];
    let pairs = 0,
      moved = 0,
      held = 0;
    for (const [name, registry] of registries) {
      const T = reactiveThermalTables3D(registry),
        cold = reactiveRegistrySource3D(registry).cold,
        ids = registry.materialIds,
        rnd = random(name.length * 7 + 1);
      const word = (id: number) =>
        (id |
          (Math.floor(rnd() * 256) << 8) |
          (T.defaultPhase[id] << PHASE_SHIFT) |
          (rnd() < 0.1 ? Math.floor(rnd() * 16) << 28 : 0)) >>>
        0;
      for (let round = 0; round < 3; round++) {
        // Width 2: the x-even pass exchanges every (2k, 2k + 1) pair.
        const width = 2,
          height = 128,
          depth = 128,
          n = width * height * depth,
          packedCells: number[] = [],
          energyQ: number[] = [];
        for (let k = 0; k < n / 2; k++) {
          const a = rnd() < 0.9 ? ids[Math.floor(rnd() * ids.length)] : Math.floor(rnd() * 256),
            wa = word(a),
            ea = nearBreakpoint(registry, a, rnd);
          if (rnd() < 0.03) {
            packedCells.push(wa, wa);
            energyQ.push(ea, ea);
          } else {
            const b = rnd() < 0.5 ? a : ids[Math.floor(rnd() * ids.length)];
            packedCells.push(wa, word(b));
            // Nearby energies: small differences around every flux rounding.
            energyQ.push(
              ea,
              rnd() < 0.3
                ? clamp(ea + Math.floor((rnd() - 0.5) * 4 * ENERGY_SCALE))
                : nearBreakpoint(registry, b, rnd),
            );
          }
        }
        const input: Block = {
          ...createReactiveMaterialBlock3D(registry, { width: 1, height: 1, depth: 1 }),
          width,
          height,
          depth,
          packedCells,
          energyQ,
          structure: new Array<number>(n).fill(0),
        };
        let output: Block | null = null;
        const run = startReactiveReactionJob3D(registry, state(input, 0), (index, block) => {
          if (index === 0) output = block;
        });
        const source = structuredClone(input);
        run.job.advance();
        run.job.cancel();
        expect(input).toEqual(source);
        const out = output as unknown as Block;
        expect(Object.keys(out)).toEqual(Object.keys(input));
        expect(out.structure).toBe(input.structure);
        for (let i = 0; i < n; i += 2) {
          const a = packedCells[i],
            b = packedCells[i + 1],
            ea = energyQ[i],
            eb = energyQ[i + 1];
          let expected = [a, b, ea, eb];
          if (a !== b || ea !== eb) {
            const [ei, ej] = exchangeEnergy(a, b, ea, eb, cold);
            if (ei !== ea || ej !== eb)
              expected = [thermalView(a, ei, cold), thermalView(b, ej, cold), ei, ej];
          }
          const actual = [
            out.packedCells[i],
            out.packedCells[i + 1],
            out.energyQ[i],
            out.energyQ[i + 1],
          ];
          pairs++;
          if (expected[2] !== ea) moved++;
          else held++;
          if (actual.some((value, k) => value !== expected[k]))
            mismatches.push([name, a, b, ea, eb, actual, expected]);
        }
      }
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
    expect(pairs).toBe(3 * 3 * 16384);
    expect(moved).toBeGreaterThan(pairs / 4);
    expect(held).toBeGreaterThan(pairs / 20);
  });
  test('each pass and each cycle equal the previous implementation on random odd blocks', () => {
    const shapes = [
      { width: 5, height: 7, depth: 3 },
      { width: 31, height: 3, depth: 9 },
      { width: 1, height: 1, depth: 64 },
      { width: 2, height: 64, depth: 1 },
      { width: 9, height: 9, depth: 9 },
    ];
    let phaseChanges = 0,
      reacted = 0,
      extinguished = 0,
      clearedBonds = 0,
      cycles = 0;
    for (const [name, registry] of registries)
      for (const [s, shape] of shapes.entries()) {
        const rnd = random(name.length * 101 + s);
        let current = state(randomBlock(registry, shape, rnd), s + name.length);
        for (let round = 0; round < 3; round++) {
          const { actual, passes } = compareCycle(registry, current);
          expect(actual.startsWith('ok')).toBe(true);
          // Bonds lost by an unchanged cell were cleared because a neighbour changed.
          for (const [input, block] of passes.slice(6))
            for (let i = 0; i < block.structure.length; i++)
              if (
                block.packedCells[i] === input.packedCells[i] &&
                input.structure[i] & BOND_MASK_3D & ~block.structure[i]
              )
                clearedBonds++;
          const next = JSON.parse(actual.slice(3)) as ReturnType<typeof oracleCycle>;
          phaseChanges += next.report.phaseChangedCells.length;
          reacted += next.report.reactedPairs.length;
          extinguished += next.report.extinguishedCells.length;
          cycles++;
          current = next.state as ReactiveReactionState3D;
        }
      }
    expect(cycles).toBe(3 * 5 * 3);
    for (const count of [phaseChanges, reacted, extinguished, clearedBonds])
      expect(count).toBeGreaterThan(0);
  });
  test('combustion elects, burns and extinguishes as before on random small blocks', async () => {
    const catalogRegistry = async (custom: boolean, conductive: boolean) => {
      const catalog = defaultReactiveMaterialCatalog3D(),
        materials = catalog.propertiesCatalog.materials,
        source = (id: number) => structuredClone(materials.find((m) => m.id === id)!);
      if (custom) {
        // A bonded solid oxidizer, and a fuel that leaves solids on both sides.
        const oxide = source(MAT.STONE),
          resin = source(MAT.WOOD);
        materials.push(
          {
            ...oxide,
            id: 202,
            name: 'oxidizing_stone',
            properties: { ...oxide.properties, oxidizer: 1, melts_into: 0 },
          },
          {
            ...resin,
            id: 203,
            name: 'charring_resin',
            properties: { ...resin.properties, burns_into: MAT.STONE, smoke_product: MAT.METAL },
          },
        );
        catalog.materialIds.push(202, 203);
      }
      // Without conduction the combustion pass sees the energies as placed.
      if (!conductive) for (const m of materials) m.properties.conductivity = 0;
      return createReactiveMaterialRegistry3D(catalog);
    };
    const cases: [string, ReactiveMaterialRegistry3D][] = [
      ['still', await catalogRegistry(false, false)],
      ['still custom', await catalogRegistry(true, false)],
      ['custom', await catalogRegistry(true, true)],
      ['thermal', registries[1][1]],
    ];
    const seen = { pairs: 0, rejected: 0, cut: 0, extinguished: 0, quenched: 0, kept: 0 },
      rotations = new Set<number>();
    for (const [name, registry] of cases) {
      const cold = reactiveRegistrySource3D(registry).cold,
        rnd = random(name.length * 1009 + 7);
      for (let round = 0; round < 72; round++) {
        const shape = {
            width: 1 + Math.floor(rnd() * 6),
            height: 1 + Math.floor(rnd() * 6),
            depth: 1 + Math.floor(rnd() * 6),
          },
          cycle = (round % 12 < 6 ? 0 : 2 ** 40) + (round % 6),
          { actual, passes } = compareCycle(
            registry,
            state(combustionBlock(registry, shape, rnd), cycle),
          );
        expect(actual.startsWith('ok')).toBe(true);
        const { report } = JSON.parse(actual.slice(3)) as ReturnType<typeof oracleCycle>,
          [input, output] = passes[7],
          material = (i: number) => input.packedCells[i] & 255,
          adjacent = (i: number) =>
            [0, 1, 2, 3, 4, 5]
              .map((dir) => structuralNeighbor(i, dir, input))
              .filter((j) => j >= 0),
          fuels = new Set(report.reactedPairs.map((pair) => pair.fuel));
        if (fuels.size) rotations.add(cycle % 6);
        seen.pairs += report.reactedPairs.length;
        seen.extinguished += report.extinguishedCells.length;
        seen.quenched += report.extinguishedCells.filter((i) =>
          adjacent(i).some((j) => material(j) === MAT.WATER),
        ).length;
        for (let i = 0; i < input.packedCells.length; i++) {
          const word = input.packedCells[i];
          if (material(i) === MAT.FIRE && !report.extinguishedCells.includes(i)) seen.kept++;
          if (word === output.packedCells[i] && input.structure[i] & ~output.structure[i])
            seen.cut++;
          // A burning cell beside an oxidizer that did not react lost its oxidizer to another fuel.
          if (
            prop(word, cold, COLD_FUEL_ENERGY) > 0 &&
            temperatureQ(word, input.energyQ[i], cold) >
              prop(word, cold, COLD_FLASH_POINT) * ENERGY_SCALE &&
            !fuels.has(i) &&
            adjacent(i).some((j) => prop(input.packedCells[j], cold, COLD_OXIDIZER) === 1)
          )
            seen.rejected++;
        }
      }
    }
    expect(rotations.size).toBe(6);
    for (const count of Object.values(seen)) expect(count).toBeGreaterThan(0);
  });
  test('a one-sided link is cleared on a copy when nothing else changes', () => {
    for (const [, registry] of registries) {
      const block = editReactiveMaterialBlock3D(
        registry,
        createReactiveMaterialBlock3D(registry, { width: 3, height: 1, depth: 1 }, MAT.STONE),
        [
          { kind: 'bond', x: 0, y: 0, z: 0, direction: 1, bonded: true },
          { kind: 'bond', x: 1, y: 0, z: 0, direction: 1, bonded: true },
        ],
      ).block;
      // Internal callers trust their blocks; the passes still never write one in place.
      block.structure[2] &= ~BONDS_3D[0];
      const { passes } = compareCycle(registry, state(block, 0)),
        [input, output] = passes[6];
      expect(output.packedCells).toBe(input.packedCells);
      expect(output.structure).not.toBe(input.structure);
      expect(output.structure[1] & BONDS_3D[1]).toBe(0);
      expect(input.structure[1] & BONDS_3D[1]).toBe(BONDS_3D[1]);
    }
  });
});
/** Runs one cycle through the job, checking each pass against the oracle on the same input,
 * that no pass writes an array in place, and that the outcome equals the oracle cycle.
 */
function compareCycle(registry: ReactiveMaterialRegistry3D, current: ReactiveReactionState3D) {
  const observed: Block[] = [],
    copies: Block[] = [],
    source = structuredClone(current.block);
  const run = startReactiveReactionJob3D(registry, current, (_, block) => {
    observed.push(block);
    copies.push(structuredClone(block));
  });
  const actual = outcome(() => {
    for (let k = 0; k < 8; k++) run.job.advance();
    return run.output();
  });
  expect(current.block).toEqual(source);
  const scratch = emptyReport(registry, current.cycle),
    passes: [Block, Block][] = [];
  observed.forEach((block, k) => {
    expect(block).toEqual(copies[k]);
    const input = k ? observed[k - 1] : current.block,
      expected = oraclePass(registry, k, input, current.cycle, scratch);
    expect(Object.keys(block)).toEqual(Object.keys(expected));
    expect(block).toEqual(expected);
    // Heat never writes structure and phase never writes energy: the outputs share them.
    if (k < 6) expect(block.structure).toBe(input.structure);
    if (k === 6) expect(block.energyQ).toBe(input.energyQ);
    passes.push([input, block]);
  });
  expect(passes.length).toBe(8);
  expect(actual).toBe(outcome(() => oracleCycle(registry, current)));
  return { actual, passes };
}
