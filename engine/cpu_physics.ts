/** Exact integer reference for ca-v3. Inputs remain immutable within each pass. */
import * as C from './generated/materials.js';
import { exchangeEnergy, phaseMaterial, rewriteMaterial, temperatureQ, thermalView, ENERGY_SCALE, MAX_ENERGY_Q } from './thermal.js';
import { ANCHOR, INTEGRITY_MASK, cloneStructure, planStructure, normalizeBonds, rewrittenStructure, rulesForRegistry, validateStructure,
  type StructuralState, type StructuralPlan } from './structure.js';
import { checkedInteger, validateDimensions } from './validation.js';
import { KERNEL_SPECS, movementScheduleForTick } from './generated/schedule.js';
import { DEFAULT_REGISTRY, type MaterialRegistry } from './registry.js';

const SPECS = new Map(KERNEL_SPECS.map(spec => [spec.id, spec]));
const coldReferences = new WeakMap<MaterialRegistry, Uint32Array>();
function validateCold(cold: Uint32Array, registry: MaterialRegistry): void {
  rulesForRegistry(registry);
  let expected = coldReferences.get(registry);
  if (!expected) { expected = registry.coldTable(); coldReferences.set(registry, expected); }
  if (!cold || cold.length !== expected.length || expected.some((value, i) => cold[i] !== value)) throw new Error('Cold table must match the supplied validated registry.');
}
const material = (v: number) => v & C.MATERIAL_MASK;
const phase = (v: number) => (v >>> C.PHASE_SHIFT) & C.PHASE_MASK;
const structural = (p: number) => p === C.PHASE.SOLID || p === C.PHASE.FROZEN;
const liquid = (p: number) => p === C.PHASE.LIQUID || p === C.PHASE.VISCOUS || p === C.PHASE.MOLTEN;
const falling = (p: number) => p === C.PHASE.POWDER || liquid(p);
const gas = (p: number) => p === C.PHASE.GAS || p === C.PHASE.PLASMA;
export function hashPair(x: number, y: number, salt: number): number {
  // Math.imul is required: ordinary JS multiplication loses low u32 bits.
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export type PassObserver = (passId: string, state: StructuralState, plan?: StructuralPlan) => void;

export function runCpuTick(state: StructuralState, width: number, height: number, cold: Uint32Array, tick: number, observer?: PassObserver, registry: MaterialRegistry = DEFAULT_REGISTRY): StructuralState {
  checkedInteger(tick, 0, Number.MAX_SAFE_INTEGER, 'tick');
  validateCold(cold, registry);
  let current = state;
  for (const passId of movementScheduleForTick(tick)) {
    const plan = passId === 'structure' ? planStructure(current, width, height, rulesForRegistry(registry)) : undefined;
    current = plan ? plan.apply(current, width, height) : runCpuPass(current, width, height, cold, passId, registry);
    observer?.(passId, cloneStructure(current), plan);
  }
  return current;
}

export function runCpuPass(state: StructuralState, width: number, height: number, cold: Uint32Array, passId: string, registry: MaterialRegistry = DEFAULT_REGISTRY): StructuralState {
  const spec = SPECS.get(passId);
  if (!spec) throw new Error(`Unknown engine pass: ${passId}`);
  validateCold(cold, registry);
  validateDimensions(width, height);
  const rules = rulesForRegistry(registry);
  if (passId === 'structure') return planStructure(state, width, height, rules).apply(state, width, height);
  const validated = validateStructure(state, width, height, rules, false);
  if (passId === 'normalize') return { ...validated, structure: normalizeBonds(validated.grid, validated.structure, width, height, rules) };
  const input = validated.grid;
  const inputEnergy = validated.energyQ;
  const inputStructure = validated.structure;
  const output = input.slice();
  const outputEnergy = inputEnergy.slice();
  const outputStructure = inputStructure.slice();
  const finish = (): StructuralState => ({ grid: output, energyQ: outputEnergy, structure: outputStructure });
  const prop = (voxel: number, field: number) => cold[material(voxel) * C.COLD_STRIDE + field];
  const density = (v: number) => prop(v, C.COLD_DENSITY);
  const bound = (index: number) => rules.eligible(input[index]) && (inputStructure[index] & (ANCHOR | INTEGRITY_MASK)) !== 0;
  const canFall = (source: number, target: number) =>
    (falling(phase(input[source])) || structural(phase(input[source]))) && !bound(source) && !bound(target) && density(input[source]) > density(input[target]);
  const swap = (a: number, b: number) => {
    output[a] = input[b]; output[b] = input[a];
    outputEnergy[a] = inputEnergy[b]; outputEnergy[b] = inputEnergy[a];
    outputStructure[a] = inputStructure[b]; outputStructure[b] = inputStructure[a];
  };
  const hasFall = (x: number, y: number) => y < height - 1 && (
    canFall(y * width + x, (y + 1) * width + x) ||
    (x > 0 && canFall(y * width + x, (y + 1) * width + x - 1)) ||
    (x < width - 1 && canFall(y * width + x, (y + 1) * width + x + 1)));
  const gasRank = (index: number) => Math.floor(temperatureQ(input[index], inputEnergy[index], cold) / ENERGY_SCALE) * 2 - density(input[index]);
  const canRise = (source: number, target: number) => {
    const v = input[source], other = input[target];
    return material(v) !== C.MAT.AIR && gas(phase(v)) && !structural(phase(other)) &&
      (material(other) === C.MAT.AIR || gas(phase(other))) && gasRank(source) > gasRank(target) + 16;
  };
  const pairPhase = spec.constants.MOVE_PHASE ?? spec.constants.GRAVITY_PHASE ?? 0;
  const salt = spec.constants.MOVE_SALT ?? 0;

  if (spec.source_file === 'phase_2b_winner.wgsl' || spec.source_file === 'phase_2b_gas_buoyancy_winner.wgsl') {
    for (let y = pairPhase; y < height - 1; y += 2) {
      for (let x = 0; x < width; x += 1) {
        const upper = y * width + x;
        const lower = upper + width;
        if (spec.source_file === 'phase_2b_winner.wgsl' ? canFall(upper, lower) : canRise(lower, upper)) swap(upper, lower);
      }
    }
    return finish();
  }
  if (spec.source_file === 'phase_2b_diagonal_winner.wgsl') {
    for (let y = pairPhase; y < height - 1; y += 2) {
      for (let left = 0; left < width - 1; left += 2) {
        const rightward = (hashPair(left, y, salt) & 1) === 0;
        const sx = rightward ? left : left + 1;
        const dx = rightward ? left + 1 : left;
        const source = y * width + sx;
        const target = (y + 1) * width + dx;
        if (!canFall(source, source + width) && canFall(source, target)) swap(source, target);
      }
    }
    return finish();
  }
  if (spec.source_file === 'phase_2b_liquid_winner.wgsl' || spec.source_file === 'phase_2b_gas_spread_winner.wgsl') {
    for (let y = 0; y < height; y += 1) {
      for (let x = pairPhase; x < width - 1; x += 2) {
        const left = y * width + x;
        const right = left + 1;
        if (spec.source_file === 'phase_2b_liquid_winner.wgsl') {
          const canSpread = (v: number, dst: number) => liquid(phase(v)) && !structural(phase(dst)) &&
            (phase(dst) === C.PHASE.GAS || material(dst) === C.MAT.AIR) && density(v) > density(dst);
          const leftCan = !hasFall(x, y) && canSpread(input[left], input[right]);
          const rightCan = !hasFall(x + 1, y) && canSpread(input[right], input[left]);
          if (leftCan || rightCan) swap(left, right);
        } else {
          const leftwardSource = (hashPair(x, y, salt) & 1) === 0;
          const source = leftwardSource ? left : right;
          const target = leftwardSource ? right : left;
          const v = input[source], dst = input[target];
          const blocked = y === 0 || !canRise(source, source - width);
          const canSpread = material(v) !== C.MAT.AIR && gas(phase(v)) && !structural(phase(dst)) &&
            (material(dst) === C.MAT.AIR || (gas(phase(dst)) && gasRank(source) > gasRank(target) + 16));
          if (blocked && canSpread) swap(source, target);
        }
      }
    }
    return finish();
  }

  const neighbors = (index: number): number[] => {
    const x = index % width, y = Math.floor(index / width);
    return [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1,
      y > 0 ? index - width : -1, y < height - 1 ? index + width : -1];
  };
  if (spec.source_file === 'phase_2a_winner.wgsl') {
    const axis = spec.constants.THERMAL_AXIS ?? 0, parity = spec.constants.THERMAL_PARITY ?? 0;
    for (let y = axis ? parity : 0; y < height; y += axis ? 2 : 1) {
      for (let x = axis ? 0 : parity; x < width; x += axis ? 1 : 2) {
        if ((!axis && x + 1 >= width) || (axis && y + 1 >= height)) continue;
        const a = y * width + x, b = a + (axis ? width : 1);
        [outputEnergy[a], outputEnergy[b]] = exchangeEnergy(input[a], input[b], inputEnergy[a], inputEnergy[b], cold);
        output[a] = thermalView(input[a], outputEnergy[a], cold);
        output[b] = thermalView(input[b], outputEnergy[b], cold);
      }
    }
    return finish();
  }
  if (spec.source_file === 'phase_2c_winner.wgsl') {
    for (let index = 0; index < input.length; index += 1) {
      const next = phaseMaterial(input[index], inputEnergy[index], cold);
      if (next !== material(input[index])) {
        output[index] = rewriteMaterial(input[index], next, inputEnergy[index], cold);
        outputStructure[index] = rewrittenStructure(input[index], output[index], inputStructure[index], rules);
      }
    }
    return finish();
  }
  if (spec.source_file !== 'phase_2d_winner.wgsl') throw new Error(`No CPU implementation for ${spec.source_file}`);
  const priorityNeighbors = (index: number) => {
    const all = neighbors(index);
    const order = ((index % width + Math.floor(index / width)) & 1) === 0 ? [2, 1, 3, 0] : [0, 2, 1, 3];
    return order.map(direction => all[direction]).filter(neighbor => neighbor >= 0);
  };
  const burningFuel = (index: number) => prop(input[index], C.COLD_FUEL_ENERGY) > 0 &&
    temperatureQ(input[index], inputEnergy[index], cold) > prop(input[index], C.COLD_FLASH_POINT) * ENERGY_SCALE;
  const chosenAir = (index: number) => priorityNeighbors(index).find(neighbor => prop(input[neighbor], C.COLD_OXIDIZER) === 1);
  const chosenFuel = (index: number) => priorityNeighbors(index).find(neighbor => burningFuel(neighbor) && chosenAir(neighbor) === index);
  const product = (index: number, nextMaterial: number, energy: number) => {
    outputEnergy[index] = energy;
    output[index] = rewriteMaterial(input[index], nextMaterial, energy, cold);
    outputStructure[index] = rewrittenStructure(input[index], output[index], inputStructure[index], rules);
  };
  for (let index = 0; index < input.length; index += 1) {
    const v = input[index], m = material(v);
    if (burningFuel(index)) {
      const air = chosenAir(index);
      if (air !== undefined && chosenFuel(air) === index) {
        const transfer = Math.min(Math.floor(prop(v, C.COLD_FUEL_ENERGY) * ENERGY_SCALE / 2), MAX_ENERGY_Q - inputEnergy[air]);
        product(index, prop(v, C.COLD_BURNS_INTO), inputEnergy[index] - transfer);
      }
    } else if (prop(v, C.COLD_OXIDIZER) === 1) {
      const chosen = chosenFuel(index);
      if (chosen !== undefined) {
        const transfer = Math.min(Math.floor(prop(input[chosen], C.COLD_FUEL_ENERGY) * ENERGY_SCALE / 2), MAX_ENERGY_Q - inputEnergy[index]);
        product(index, prop(input[chosen], C.COLD_SMOKE_PRODUCT), inputEnergy[index] + transfer);
      }
    } else if (m === C.MAT.FIRE) {
      const adjacent = neighbors(index).filter(neighbor => neighbor >= 0);
      if (!adjacent.some(neighbor => prop(input[neighbor], C.COLD_FUEL_ENERGY) > 0) ||
          adjacent.some(neighbor => material(input[neighbor]) === C.MAT.WATER) || temperatureQ(v, inputEnergy[index], cold) < 80 * ENERGY_SCALE) {
        product(index, C.MAT.SMOKE, inputEnergy[index]);
      }
    }
  }
  return finish();
}
