/** CPU backend for the versioned State Space field contract. */
export * from './generated/materials.js';
import {
  MAT, PHASE, MAT_PHASE, MAT_THERMAL, MATERIAL_NAMES, THERMAL_SHIFT,
  KINETIC_X_SHIFT, KINETIC_Y_SHIFT, PHASE_SHIFT, FLAGS_SHIFT,
  SCHEMA_VERSION, RULES_VERSION,
} from './generated/materials.js';
import { runCpuTick } from './cpu_physics.js';
import { seedState, temperatureQ, thermalView, validateEnergyState, MAX_ENERGY_Q, energyLedger as inspectEnergy } from './thermal.js';
import { ANCHOR, FRESH, INTEGRITY_MASK, BOND_BITS, createPhysicsState, normalizeBonds, rulesForRegistry, validateStructure, planStructure,
  type StructuralState, type StructuralPlan } from './structure.js';
import { DEFAULT_REGISTRY, requireRegistry, type MaterialRegistry } from './registry.js';
import { inspectPass, type PassReport, type StepOptions } from './inspection.js';

export type MaterialId = (typeof MAT)[keyof typeof MAT];
import { checkedInteger, validateDimensions, validateSnapshot, type PackedSnapshot } from './contracts.js';

export interface VoxelState {
  material: number;
  thermal: number;
  kineticX: number;
  kineticY: number;
  phase: number;
  flags: number;
}

export interface FieldSample {
  material: number;
  materialName: string;
  thermal: number;
  energyQ: number;
  temperatureQ: number;
  phase: number;
  flags: number;
  structure: number;
  integrity: number;
  anchored: boolean;
  bonds: number;
}

export interface StateSpaceFieldSnapshot {
  width: number;
  height: number;
  grid: Uint32Array;
  energyQ: Uint32Array;
  structure: Uint32Array;
  tick: number;
}

export interface StateSpaceField {
  readonly registry: MaterialRegistry;
  readonly width: number;
  readonly height: number;
  readonly tick: number;
  readonly grid: Uint32Array;
  readonly energyQ: Uint32Array;
  readonly structure: Uint32Array;
  energyLedger(): ReturnType<typeof inspectEnergy>;
  energyBalance(): { initialQ: bigint; externalQ: bigint; currentQ: bigint; driftQ: bigint };
  step(ticks?: number, options?: StepOptions): readonly PassReport[];
  close(): void;
  clear(material?: number): void;
  setCell(x: number, y: number, material: number, thermal?: number, flags?: number): void;
  setEnergy(x: number, y: number, energyQ: number): void;
  setAnchor(x: number, y: number, anchored?: boolean): void;
  setIntegrity(x: number, y: number, integrity: number, options?: { weld?: boolean }): void;
  inspectStructure(): StructuralPlan;
  paintCircle(x: number, y: number, radius: number, material: number, thermal?: number, flags?: number): void;
  sample(x: number, y: number): FieldSample;
  materialAt(x: number, y: number): number;
  thermalAt(x: number, y: number): number;
  snapshot(): StateSpaceFieldSnapshot;
  packedSnapshot(): PackedSnapshot;
  restore(snapshot: PackedSnapshot): void;
}

export function packVoxel(material: number, thermal = defaultThermal(material), kineticX = 0, kineticY = 0, phase = defaultPhase(material), flags = 0): number {
  checkedInteger(material, 0, 255, 'material');
  checkedInteger(thermal, 0, 255, 'thermal');
  checkedInteger(kineticX, -8, 7, 'kineticX');
  checkedInteger(kineticY, -8, 7, 'kineticY');
  checkedInteger(phase, 0, 15, 'phase');
  checkedInteger(flags, 0, 15, 'flags');
  return (
    (material & 0xff)
    | ((thermal & 0xff) << THERMAL_SHIFT)
    | ((kineticX & 0xf) << KINETIC_X_SHIFT)
    | ((kineticY & 0xf) << KINETIC_Y_SHIFT)
    | ((phase & 0xf) << PHASE_SHIFT)
    | ((flags & 0xf) << FLAGS_SHIFT)
  ) >>> 0;
}

export function unpackVoxel(packed: number): VoxelState {
  const kx = (packed >> KINETIC_X_SHIFT) & 0xf;
  const ky = (packed >> KINETIC_Y_SHIFT) & 0xf;
  return {
    material: packed & 0xff,
    thermal: (packed >> THERMAL_SHIFT) & 0xff,
    kineticX: ((kx ^ 0x8) - 0x8) | 0,
    kineticY: ((ky ^ 0x8) - 0x8) | 0,
    phase: (packed >> PHASE_SHIFT) & 0xf,
    flags: (packed >> FLAGS_SHIFT) & 0xf,
  };
}

export function defaultPhase(material: number): number {
  return MAT_PHASE[material] ?? PHASE.SOLID;
}

export function defaultThermal(material: number): number {
  return MAT_THERMAL[material] ?? 20;
}

export function materialName(material: number): string {
  return MATERIAL_NAMES[material] ?? `material-${material}`;
}

export function createStateSpaceField(width: number, height: number, fillMaterial: number = MAT.AIR, registry: MaterialRegistry = DEFAULT_REGISTRY): StateSpaceField {
  return new CpuStateSpaceField(width, height, fillMaterial, registry);
}

/** Internal shared state/edit implementation for CPU and asynchronous GPU fields. */
export class FieldState {
  readonly width: number;
  readonly height: number;
  readonly registry: MaterialRegistry;
  protected cells: Uint32Array;
  protected energies: Uint32Array;
  protected bonds: Uint32Array;
  private initialEnergyQ = 0n;
  private editEnergyQ = 0n;
  protected coldTable: Uint32Array;
  protected tickCount = 0;
  protected busy = false;
  protected closed = false;

  constructor(width: number, height: number, fillMaterial: number, registry: MaterialRegistry) {
    validateDimensions(width, height);
    requireRegistry(registry);
    registry.material(fillMaterial);
    this.width = width;
    this.height = height;
    this.registry = registry;
    Object.defineProperties(this, { width: { writable: false }, height: { writable: false }, registry: { writable: false } });
    this.coldTable = registry.coldTable();
    this.cells = new Uint32Array(width * height);
    this.energies = new Uint32Array(width * height);
    this.bonds = new Uint32Array(width * height);
    this.clear(fillMaterial);
  }

  protected ensureAvailable(mutation = true): void {
    if (this.busy) throw new Error('A step is in progress; await it before accessing the field.');
    if (mutation && this.closed) throw new Error('Field is closed.');
  }

  close(): void {
    if (this.closed) return;
    this.ensureAvailable();
    this.closed = true;
  }

  get grid(): Uint32Array { this.ensureAvailable(false); return this.cells.slice(); }
  get energyQ(): Uint32Array { this.ensureAvailable(false); return this.energies.slice(); }
  get structure(): Uint32Array { this.ensureAvailable(false); return this.bonds.slice(); }

  energyLedger(): ReturnType<typeof inspectEnergy> {
    this.ensureAvailable(false);
    return inspectEnergy({ grid: this.cells, energyQ: this.energies }, this.coldTable);
  }

  energyBalance() {
    const currentQ = this.energyLedger().totalQ;
    return { initialQ: this.initialEnergyQ, externalQ: this.editEnergyQ, currentQ,
      driftQ: currentQ - this.initialEnergyQ - this.editEnergyQ };
  }

  get tick(): number {
    this.ensureAvailable(false);
    return this.tickCount;
  }

  clear(material: number = MAT.AIR): void {
    this.ensureAvailable();
    const record = this.registry.material(material);
    const state = createPhysicsState(new Uint32Array(this.width * this.height).fill(packVoxel(material, record.default_thermal, 0, 0, record.properties.default_phase)), this.width, this.height, this.registry);
    this.cells = state.grid;
    this.energies = state.energyQ;
    this.bonds = state.structure;
    this.tickCount = 0;
    this.initialEnergyQ = this.energyLedger().totalQ;
    this.editEnergyQ = 0n;
  }

  setCell(x: number, y: number, material: number, thermal?: number, flags = 0): void {
    this.ensureAvailable();
    checkedInteger(x, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'x');
    checkedInteger(y, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'y');
    const record = this.registry.material(material);
    const dose = thermal === undefined ? record.default_thermal : thermal;
    checkedInteger(dose, 0, 255, 'thermal');
    checkedInteger(flags, 0, 15, 'flags');
    if (!this.inside(x, y)) return;
    const state = seedState(Uint32Array.of(packVoxel(material, dose, 0, 0, record.properties.default_phase, flags)), this.coldTable, this.registry);
    const index = this.index(x, y);
    this.editEnergyQ += BigInt(state.energyQ[0]) - BigInt(this.energies[index]);
    this.cells[index] = state.grid[0];
    this.energies[index] = state.energyQ[0];
    this.bonds[index] = rulesForRegistry(this.registry).eligible(this.cells[index]) ? INTEGRITY_MASK | FRESH : 0;
    this.normalizeStructure();
  }

  setEnergy(x: number, y: number, energyQ: number): void {
    this.ensureAvailable();
    checkedInteger(x, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'x');
    checkedInteger(y, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'y');
    checkedInteger(energyQ, 0, MAX_ENERGY_Q, 'energyQ');
    if (!this.inside(x, y)) return;
    const index = this.index(x, y);
    const value = thermalView(this.cells[index], energyQ, this.coldTable);
    validateEnergyState([value], [energyQ], 1, this.coldTable, this.registry);
    this.editEnergyQ += BigInt(energyQ) - BigInt(this.energies[index]);
    this.cells[index] = value;
    this.energies[index] = energyQ;
  }

  private normalizeStructure(): void {
    this.bonds = normalizeBonds(this.cells, this.bonds, this.width, this.height, rulesForRegistry(this.registry));
  }

  setAnchor(x: number, y: number, anchored = true): void {
    this.ensureAvailable();
    checkedInteger(x, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'x');
    checkedInteger(y, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'y');
    if (typeof anchored !== 'boolean') throw new Error('anchored must be a boolean.');
    if (!this.inside(x, y)) return;
    const index = this.index(x, y);
    if (!rulesForRegistry(this.registry).eligible(this.cells[index])) throw new Error('Only cohesive solid/frozen cells can be anchored.');
    this.bonds[index] = (this.bonds[index] & ~ANCHOR) | (anchored ? ANCHOR : 0);
  }

  setIntegrity(x: number, y: number, integrity: number, options: { weld?: boolean } = {}): void {
    this.ensureAvailable();
    checkedInteger(x, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'x');
    checkedInteger(y, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'y');
    checkedInteger(integrity, 0, INTEGRITY_MASK, 'integrity');
    if (options.weld !== undefined && typeof options.weld !== 'boolean') throw new Error('weld must be a boolean.');
    if (!this.inside(x, y)) return;
    const index = this.index(x, y);
    if (!rulesForRegistry(this.registry).eligible(this.cells[index])) throw new Error('Only cohesive solid/frozen cells can have integrity.');
    this.bonds[index] = (this.bonds[index] & ~INTEGRITY_MASK) | integrity | (options.weld && integrity ? FRESH : 0);
    this.normalizeStructure();
  }

  inspectStructure(): StructuralPlan {
    this.ensureAvailable(false);
    return planStructure({ grid: this.cells, energyQ: this.energies, structure: this.bonds }, this.width, this.height, rulesForRegistry(this.registry));
  }

  paintCircle(x: number, y: number, radius: number, material: number, thermal?: number, flags = 0): void {
    this.ensureAvailable();
    for (const value of [x, y, radius]) {
      if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error('Invalid paint geometry.');
    }
    if (radius < 0) throw new Error('Paint radius must be nonnegative.');
    const record = this.registry.material(material);
    const state = seedState(Uint32Array.of(packVoxel(material, thermal === undefined ? record.default_thermal : thermal, 0, 0, record.properties.default_phase, flags)), this.coldTable, this.registry);
    const r2 = radius * radius;
    for (let py = Math.max(0, Math.floor(y - radius)); py <= Math.min(this.height - 1, Math.ceil(y + radius)); py += 1) {
      for (let px = Math.max(0, Math.floor(x - radius)); px <= Math.min(this.width - 1, Math.ceil(x + radius)); px += 1) {
        const dx = px - x;
        const dy = py - y;
        if (dx * dx + dy * dy <= r2) {
          const index = this.index(px, py);
          this.editEnergyQ += BigInt(state.energyQ[0]) - BigInt(this.energies[index]);
          this.cells[index] = state.grid[0];
          this.energies[index] = state.energyQ[0];
          this.bonds[index] = rulesForRegistry(this.registry).eligible(this.cells[index]) ? INTEGRITY_MASK | FRESH : 0;
        }
      }
    }
    this.normalizeStructure();
  }

  sample(x: number, y: number): FieldSample {
    this.ensureAvailable(false);
    const index = this.index(this.clampX(x), this.clampY(y));
    const voxel = unpackVoxel(this.cells[index]);
    return {
      material: voxel.material,
      materialName: this.registry.material(voxel.material).name,
      thermal: voxel.thermal,
      energyQ: this.energies[index],
      temperatureQ: temperatureQ(this.cells[index], this.energies[index], this.coldTable),
      phase: voxel.phase,
      flags: voxel.flags,
      structure: this.bonds[index], integrity: this.bonds[index] & INTEGRITY_MASK,
      anchored: (this.bonds[index] & ANCHOR) !== 0, bonds: this.bonds[index] & BOND_BITS.reduce((a, b) => a | b, 0),
    };
  }

  materialAt(x: number, y: number): number {
    this.ensureAvailable(false);
    return this.cells[this.index(this.clampX(x), this.clampY(y))] & 0xff;
  }

  thermalAt(x: number, y: number): number {
    this.ensureAvailable(false);
    return (this.cells[this.index(this.clampX(x), this.clampY(y))] >> THERMAL_SHIFT) & 0xff;
  }

  snapshot(): StateSpaceFieldSnapshot {
    this.ensureAvailable(false);
    return {
      width: this.width,
      height: this.height,
      grid: new Uint32Array(this.cells),
      energyQ: this.energies.slice(),
      structure: this.bonds.slice(),
      tick: this.tickCount,
    };
  }

  packedSnapshot(): PackedSnapshot {
    this.ensureAvailable(false);
    return { schemaVersion: SCHEMA_VERSION, rulesVersion: RULES_VERSION, materialCatalogHash: this.registry.hash,
      width: this.width, height: this.height, tick: this.tickCount, packedCells: Array.from(this.cells), energyQ: Array.from(this.energies), structure: Array.from(this.bonds) };
  }

  restore(snapshot: PackedSnapshot): void {
    this.ensureAvailable();
    const state = validateSnapshot(snapshot, this.registry);
    if (snapshot.width !== this.width || snapshot.height !== this.height) throw new Error('Snapshot dimensions differ from the field.');
    this.cells = state.grid;
    this.energies = state.energyQ;
    this.bonds = state.structure;
    this.initialEnergyQ = this.energyLedger().totalQ;
    this.editEnergyQ = 0n;
    this.tickCount = snapshot.tick;
  }

  protected commitState(state: StructuralState, tick: number): void {
    const validated = validateStructure(state, this.width, this.height, rulesForRegistry(this.registry));
    this.cells = validated.grid;
    this.energies = validated.energyQ;
    this.bonds = validated.structure;
    this.tickCount = tick;
  }

  private index(x: number, y: number): number {
    return y * this.width + x;
  }

  private inside(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  private clampX(x: number): number {
    if (!Number.isFinite(x) || Math.abs(x) > Number.MAX_SAFE_INTEGER) throw new Error('Sample x must be finite and within the safe numeric range.');
    return Math.max(0, Math.min(this.width - 1, Math.floor(x)));
  }

  private clampY(y: number): number {
    if (!Number.isFinite(y) || Math.abs(y) > Number.MAX_SAFE_INTEGER) throw new Error('Sample y must be finite and within the safe numeric range.');
    return Math.max(0, Math.min(this.height - 1, Math.floor(y)));
  }

}

class CpuStateSpaceField extends FieldState implements StateSpaceField {
  step(ticks = 1, options: StepOptions = {}): readonly PassReport[] {
    this.ensureAvailable();
    checkedInteger(ticks, 0, Number.MAX_SAFE_INTEGER - this.tickCount, 'ticks');
    if (options.inspect !== undefined && typeof options.inspect !== 'boolean') throw new Error('inspect must be a boolean.');
    let state = { grid: this.cells, energyQ: this.energies, structure: this.bonds };
    const reports: PassReport[] = [];
    for (let index = 0; index < ticks; index += 1) {
      let before = state;
      const observer = options.inspect ? (passId: string, after: StructuralState, plan?: StructuralPlan) => {
        reports.push(inspectPass(before, after, this.coldTable, this.tickCount + index, passId, plan));
        before = after;
      } : undefined;
      state = runCpuTick(state, this.width, this.height, this.coldTable, this.tickCount + index, observer, this.registry);
    }
    this.commitState(state, this.tickCount + ticks);
    return Object.freeze(reports);
  }
}
