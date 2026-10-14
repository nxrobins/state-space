/** Experimental, bounded 3D cellular rules. Independent of ca-v4 stepping. */
import { MAT, PHASE, PHASE_SHIFT, buildColdTable, COLD_STRIDE, COLD_DENSITY } from '../generated/materials.js';
import { DEFAULT_REGISTRY } from '../registry.js';
import { checkedInteger } from '../validation.js';
import { seedState, validateEnergyState, temperatureQ, thermalView, exchangeEnergy, phaseMaterial,
  rewriteMaterial, energyLedger, MAX_ENERGY_Q, type PhysicsState } from '../thermal.js';

export { MAT, PHASE } from '../generated/materials.js';
export { ENERGY_SCALE, MAX_ENERGY_Q } from '../thermal.js';
export const SCHEMA_VERSION_3D = 1;
export const RULES_VERSION_3D = 'ca-3d-m1';
export const MAX_CELLS_3D = 32768;
export const MATERIAL_CATALOG_HASH_3D = DEFAULT_REGISTRY.hash;
const cold = buildColdTable();
const arrayPrototype = Object.getPrototypeOf(Uint32Array.prototype);
const arrayLength = Object.getOwnPropertyDescriptor(arrayPrototype, 'length')!.get!;
const arrayBuffer = Object.getOwnPropertyDescriptor(arrayPrototype, 'buffer')!.get!;
const arrayOffset = Object.getOwnPropertyDescriptor(arrayPrototype, 'byteOffset')!.get!;
const arrayName = Object.getOwnPropertyDescriptor(arrayPrototype, Symbol.toStringTag)!.get!;
export const MATERIALS_3D = Object.freeze([
  MAT.AIR, MAT.STONE, MAT.SAND, MAT.WATER, MAT.ICE, MAT.STEAM, MAT.LAVA, MAT.GLASS, MAT.MOLTEN_GLASS,
].map(id => DEFAULT_REGISTRY.material(id)));
const supported = new Set<number>(MATERIALS_3D.map(m => m.id));
const material = (v: number) => v & 255;
const phase = (v: number) => (v >>> PHASE_SHIFT) & 15;
const fixed = (v: number) => phase(v) === PHASE.SOLID || phase(v) === PHASE.FROZEN;
const liquid = (v: number) => phase(v) === PHASE.LIQUID || phase(v) === PHASE.VISCOUS || phase(v) === PHASE.MOLTEN;
const falling = (v: number) => phase(v) === PHASE.POWDER || liquid(v);
const gas = (v: number) => phase(v) === PHASE.GAS;
const density = (v: number) => cold[material(v) * COLD_STRIDE + COLD_DENSITY];

export interface VolumeState { grid: Uint32Array; energyQ: Uint32Array }
export interface VolumeSnapshot {
  schemaVersion: number; rulesVersion: string; materialCatalogHash: string;
  width: number; height: number; depth: number; tick: number;
  packedCells: number[]; energyQ: number[];
}
export interface VolumeSample {
  material: number; materialName: string; phase: number; thermal: number; temperatureQ: number; energyQ: number;
}
export interface StateSpaceField3D {
  readonly width: number; readonly height: number; readonly depth: number; readonly tick: number;
  readonly grid: Uint32Array; readonly energyQ: Uint32Array;
  step(ticks?: number): void;
  sample(x: number, y: number, z: number): VolumeSample;
  setCell(x: number, y: number, z: number, material: number, thermal?: number): void;
  setEnergy(x: number, y: number, z: number, energyQ: number): void;
  copyStateInto(target: VolumeState): number;
  snapshot(): VolumeSnapshot;
  restore(snapshot: VolumeSnapshot): void;
  energyLedger(): ReturnType<typeof energyLedger>;
  energyBalance(): { initialQ: bigint; externalQ: bigint; currentQ: bigint; driftQ: bigint };
}

function dimensions(w: number, h: number, d: number, maximum = MAX_CELLS_3D): number {
  for (const [key, value] of [['width', w], ['height', h], ['depth', d]] as const) checkedInteger(value, 1, maximum, key);
  return checkedInteger(w * h * d, 1, maximum, 'volume cell count');
}
function requireMaterial(id: number): void {
  checkedInteger(id, 0, 255, 'material');
  if (!supported.has(id)) throw new Error('Material is not supported by ca-3d-m1.');
}
function placement(id: number, thermal?: number): PhysicsState {
  requireMaterial(id);
  const record = DEFAULT_REGISTRY.material(id);
  checkedInteger(thermal ?? record.default_thermal, 0, 255, 'thermal');
  return seedState([id | ((thermal ?? record.default_thermal) << 8) | (record.properties.default_phase << PHASE_SHIFT)]);
}
function validateState(cells: ArrayLike<number>, energies: ArrayLike<number>, count: number): VolumeState {
  const state = validateEnergyState(cells, energies, count);
  for (const v of state.grid) {
    requireMaterial(material(v));
    if ((v & 0xf0ff0000) !== 0 || phase(v) !== DEFAULT_REGISTRY.material(material(v)).properties.default_phase) {
      throw new Error('3D M1 requires the material default phase and zero velocity/flags.');
    }
  }
  return state;
}

export function validateVolumeSnapshot(value: VolumeSnapshot, maximum = MAX_CELLS_3D): VolumeState {
  const keys = ['schemaVersion', 'rulesVersion', 'materialCatalogHash', 'width', 'height', 'depth', 'tick', 'packedCells', 'energyQ'];
  if (!value || typeof value !== 'object' || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) {
    throw new Error('3D snapshot contains missing or unexpected fields.');
  }
  if (value.schemaVersion !== SCHEMA_VERSION_3D || value.rulesVersion !== RULES_VERSION_3D || value.materialCatalogHash !== MATERIAL_CATALOG_HASH_3D) {
    throw new Error('Incompatible 3D snapshot version or catalog.');
  }
  checkedInteger(value.tick, 0, Number.MAX_SAFE_INTEGER, 'tick');
  return validateState(value.packedCells, value.energyQ, dimensions(value.width, value.height, value.depth, maximum));
}

/** Integer hash: all operations have the same u32 interpretation in JS and WGSL. */
function choice(index: number, axis: number, tick: number): boolean {
  let h = (Math.imul(index, 374761393) + Math.imul(axis, 668265263) + Math.imul(tick >>> 0, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) & 1) === 0;
}

export type VolumePass = { kind: 'gravity' | 'diagonal' | 'liquid' | 'buoyancy' | 'gas' | 'heat' | 'phase'; axis: number; parity: number; direction: number };
/** All 27 passes, including their order, are part of ca-3d-m1. */
export function volumeSchedule(tick: number): readonly VolumePass[] {
  checkedInteger(tick, 0, Number.MAX_SAFE_INTEGER, 'tick');
  const passes: VolumePass[] = [];
  const pairs = (kind: VolumePass['kind'], axis: number, direction = 1) => {
    for (const parity of [0, 1]) passes.push({ kind, axis, parity, direction });
  };
  pairs('gravity', 1);
  const directions = [[0, 1], [0, -1], [2, 1], [2, -1]];
  for (let k = 0; k < 4; k++) { const [axis, direction] = directions[(k + tick % 4) % 4]; pairs('diagonal', axis, direction); }
  const axes = tick % 2 ? [2, 0] : [0, 2];
  for (const axis of axes) pairs('liquid', axis);
  pairs('buoyancy', 1);
  for (const axis of axes) pairs('gas', axis);
  for (const axis of [0, 1, 2]) pairs('heat', axis);
  passes.push({ kind: 'phase', axis: 0, parity: 0, direction: 1 });
  return passes;
}

/** Private, owned buffers. Every pass reads only input and writes only output. */
function executePass(input: VolumeState, output: VolumeState, w: number, h: number, d: number, tick: number, pass: VolumePass): void {
  const aGrid = input.grid, aEnergy = input.energyQ, bGrid = output.grid, bEnergy = output.energyQ;
  bGrid.set(aGrid); bEnergy.set(aEnergy);
  const layer = w * h;
  const bound = (index: number) => fixed(aGrid[index]);
  const canFall = (source: number, target: number) => falling(aGrid[source]) && !bound(source) && !bound(target) && density(aGrid[source]) > density(aGrid[target]);
  const gasRank = (i: number) => Math.floor(temperatureQ(aGrid[i], aEnergy[i], cold) / 256) * 2 - density(aGrid[i]);
  const canRise = (s: number, t: number) => material(aGrid[s]) !== MAT.AIR && gas(aGrid[s]) && gas(aGrid[t]) && gasRank(s) > gasRank(t) + 16;
  const swap = (s: number, t: number) => { bGrid[s] = aGrid[t]; bGrid[t] = aGrid[s]; bEnergy[s] = aEnergy[t]; bEnergy[t] = aEnergy[s]; };
  const hasFall = (i: number, x: number, y: number, z: number) => y + 1 < h && (
    canFall(i, i + w) || (x > 0 && canFall(i, i + w - 1)) || (x + 1 < w && canFall(i, i + w + 1)) ||
    (z > 0 && canFall(i, i + w - layer)) || (z + 1 < d && canFall(i, i + w + layer)));
  if (pass.kind === 'phase') {
    for (let i = 0; i < aGrid.length; i++) {
      const next = phaseMaterial(aGrid[i], aEnergy[i], cold);
      if (next !== material(aGrid[i])) bGrid[i] = rewriteMaterial(aGrid[i], next, aEnergy[i], cold);
    }
    return;
  }
  const vertical = ['gravity', 'diagonal', 'buoyancy'].includes(pass.kind);
  const pairAxis = vertical ? 1 : pass.axis;
  for (let z = pairAxis === 2 ? pass.parity : 0; z < d; z += pairAxis === 2 ? 2 : 1) {
    for (let y = pairAxis === 1 ? pass.parity : 0; y < h; y += pairAxis === 1 ? 2 : 1) {
      for (let x = pairAxis === 0 ? pass.parity : 0; x < w; x += pairAxis === 0 ? 2 : 1) {
        let tx = x + (pairAxis === 0 ? 1 : 0), ty = y + (pairAxis === 1 ? 1 : 0), tz = z + (pairAxis === 2 ? 1 : 0);
        if (pass.kind === 'diagonal') { tx += pass.axis === 0 ? pass.direction : 0; tz += pass.axis === 2 ? pass.direction : 0; }
        if (tx < 0 || tx >= w || ty >= h || tz < 0 || tz >= d) continue;
        const a = x + w * (y + h * z), b = tx + w * (ty + h * tz);
        if (pass.kind === 'gravity') { if (canFall(a, b)) swap(a, b); }
        else if (pass.kind === 'diagonal') { if (!canFall(a, a + w) && canFall(a, b)) swap(a, b); }
        else if (pass.kind === 'buoyancy') { if (canRise(b, a)) swap(a, b); }
        else if (pass.kind === 'liquid') {
          const spread = (s: number, t: number) => liquid(aGrid[s]) && gas(aGrid[t]) && density(aGrid[s]) > density(aGrid[t]);
          if ((spread(a, b) && !hasFall(a, x, y, z)) || (spread(b, a) && !hasFall(b, tx, ty, tz))) swap(a, b);
        } else if (pass.kind === 'gas') {
          const [s, t, sy] = choice(a, pass.axis, tick) ? [a, b, y] : [b, a, ty];
          if (material(aGrid[s]) !== MAT.AIR && gas(aGrid[s]) && gas(aGrid[t]) && (sy === 0 || !canRise(s, s - w)) &&
            (material(aGrid[t]) === MAT.AIR || gasRank(s) > gasRank(t) + 16)) swap(s, t);
        } else if (pass.kind === 'heat') {
          if (material(aGrid[a]) === material(aGrid[b]) && aEnergy[a] === aEnergy[b]) continue;
          [bEnergy[a], bEnergy[b]] = exchangeEnergy(aGrid[a], aGrid[b], aEnergy[a], aEnergy[b], cold);
          bGrid[a] = thermalView(aGrid[a], bEnergy[a], cold); bGrid[b] = thermalView(aGrid[b], bEnergy[b], cold);
        }
      }
    }
  }
}

/** Single-pass verification hook; validates and copies caller state. */
export function runVolumePass(state: VolumeState, w: number, h: number, d: number, tick: number, passIndex: number): VolumeState {
  const input = validateState(state.grid, state.energyQ, dimensions(w, h, d));
  const schedule = volumeSchedule(tick);
  checkedInteger(passIndex, 0, schedule.length - 1, 'pass index');
  const output = { grid: input.grid.slice(), energyQ: input.energyQ.slice() };
  executePass(input, output, w, h, d, tick, schedule[passIndex]);
  return output;
}

export class CpuVolume implements StateSpaceField3D {
  readonly width: number; readonly height: number; readonly depth: number;
  #state: VolumeState; #spare: VolumeState; #tick = 0; #initial = 0n; #external = 0n; #maximum:number;
  constructor(w: number, h: number, d: number, fill: number, maximum = MAX_CELLS_3D) {
    const count = dimensions(w, h, d, maximum), seed = placement(fill);
    this.#maximum=maximum; this.width = w; this.height = h; this.depth = d;
    for (const key of ['width', 'height', 'depth']) Object.defineProperty(this, key, { writable: false, configurable: false });
    this.#state = { grid: new Uint32Array(count).fill(seed.grid[0]), energyQ: new Uint32Array(count).fill(seed.energyQ[0]) };
    this.#spare = { grid: new Uint32Array(count), energyQ: new Uint32Array(count) };
    this.#initial = this.#total();
  }
  get tick(): number { return this.#tick; }
  get grid(): Uint32Array { return this.#state.grid.slice(); }
  get energyQ(): Uint32Array { return this.#state.energyQ.slice(); }
  #total(): bigint { let sum = 0; for (const q of this.#state.energyQ) sum += q; return BigInt(sum); }
  #index(x: number, y: number, z: number): number {
    checkedInteger(x, 0, this.width - 1, 'x'); checkedInteger(y, 0, this.height - 1, 'y'); checkedInteger(z, 0, this.depth - 1, 'z');
    return x + this.width * (y + this.height * z);
  }
  step(ticks = 1): void {
    checkedInteger(ticks, 0, 1024, 'ticks per request');
    checkedInteger(this.#tick + ticks, 0, Number.MAX_SAFE_INTEGER, 'end tick');
    for (let n = 0; n < ticks; n++) {
      for (const pass of volumeSchedule(this.#tick)) {
        executePass(this.#state, this.#spare, this.width, this.height, this.depth, this.#tick, pass);
        [this.#state, this.#spare] = [this.#spare, this.#state];
      }
      this.#tick++;
    }
  }
  sample(x: number, y: number, z: number): VolumeSample {
    const i = this.#index(x, y, z), v = this.#state.grid[i], energyQ = this.#state.energyQ[i];
    return { material: material(v), materialName: DEFAULT_REGISTRY.material(material(v)).name, phase: phase(v), thermal: (v >>> 8) & 255,
      temperatureQ: temperatureQ(v, energyQ, cold), energyQ };
  }
  setCell(x: number, y: number, z: number, id: number, thermal?: number): void {
    const i = this.#index(x, y, z), seed = placement(id, thermal);
    this.#external += BigInt(seed.energyQ[0]) - BigInt(this.#state.energyQ[i]);
    this.#state.grid[i] = seed.grid[0]; this.#state.energyQ[i] = seed.energyQ[0];
  }
  setEnergy(x: number, y: number, z: number, q: number): void {
    const i = this.#index(x, y, z);
    checkedInteger(q, 0, MAX_ENERGY_Q, 'energyQ');
    this.#external += BigInt(q) - BigInt(this.#state.energyQ[i]);
    this.#state.energyQ[i] = q; this.#state.grid[i] = thermalView(this.#state.grid[i], q, cold);
  }
  copyStateInto(target: VolumeState): number {
    const count = this.#state.grid.length;
    const values = ['grid', 'energyQ'].map(k => target && Object.getOwnPropertyDescriptor(target, k)?.value);
    if (values.some(v => !(v instanceof Uint32Array) || arrayName.call(v) !== 'Uint32Array' || arrayLength.call(v) !== count || !(arrayBuffer.call(v) instanceof ArrayBuffer))) throw new Error('State copy needs two owned Uint32Arrays of the volume cell count.');
    const [grid, energies] = values as Uint32Array[];
    if (arrayBuffer.call(grid) === arrayBuffer.call(energies) && Math.abs(arrayOffset.call(grid) - arrayOffset.call(energies)) < count * 4) throw new Error('State copy coordinates overlap.');
    Uint32Array.prototype.set.call(grid, this.#state.grid); Uint32Array.prototype.set.call(energies, this.#state.energyQ);
    return this.#tick;
  }
  snapshot(): VolumeSnapshot {
    return { schemaVersion: SCHEMA_VERSION_3D, rulesVersion: RULES_VERSION_3D, materialCatalogHash: MATERIAL_CATALOG_HASH_3D,
      width: this.width, height: this.height, depth: this.depth, tick: this.#tick, packedCells: Array.from(this.#state.grid), energyQ: Array.from(this.#state.energyQ) };
  }
  restore(snapshot: VolumeSnapshot): void {
    const next = validateVolumeSnapshot(snapshot, this.#maximum);
    if (snapshot.width !== this.width || snapshot.height !== this.height || snapshot.depth !== this.depth) throw new Error('3D snapshot geometry differs from the field.');
    this.#state = next; this.#tick = snapshot.tick; this.#initial = this.#total(); this.#external = 0n;
  }
  energyLedger(): ReturnType<typeof energyLedger> { return energyLedger(this.#state, cold); }
  energyBalance() { const currentQ = this.#total(); return { initialQ: this.#initial, externalQ: this.#external, currentQ, driftQ: currentQ - this.#initial - this.#external }; }
}

export function createStateSpaceField3D(width: number, height: number, depth: number, fillMaterial: number = MAT.AIR): StateSpaceField3D {
  return new CpuVolume(width, height, depth, fillMaterial);
}
