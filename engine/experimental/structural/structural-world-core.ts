/** M5/M6 CPU reference and public validation. Older 3D contracts remain unchanged. */
import {
  MAT,
  PHASE_SHIFT,
  COLD_STRIDE,
  COLD_FUEL_ENERGY,
  COLD_PHASE_ENERGY,
} from '../../generated/materials.js';
import { checkedInteger, validatePackedCells, stateCopyTargets } from '../../validation.js';
import {
  thermalView,
  temperatureQ,
  MAX_ENERGY_Q,
  ENERGY_SCALE,
  energyLedger,
} from '../../thermal.js';
import { activeWorldGeometry, type ActiveWorldOptions3D } from '../volume/active-world-core.js';
import {
  SCHEMA_VERSION_3D,
  RULES_VERSION_3D,
  MATERIAL_CATALOG_HASH_3D,
  validateVolumeSnapshot,
} from '../3d-core.js';
import {
  structuralLaw3D,
  structuralSchedule3D,
  STRUCTURAL_RULES_VERSION_3D,
  STRUCTURAL_REACTIVE_RULES_VERSION_3D,
  type StructuralLaw3D,
} from './structural-law.js';
import type { ReactiveMaterialRegistry3D } from '../reactive/reactive-registry.js';
import {
  ANCHOR_3D,
  BONDS_3D,
  COMPLETE_STRUCTURE_3D,
  FRESH_3D,
  INTEGRITY_3D,
  normalizeStructure3D,
  solveStructure3D,
  structuralEligible,
  structuralNeighbor,
  type StructuralGeometry,
  type StructuralState3D,
} from '../structural-mechanics.js';
import { executeStructuralMaterialPass } from '../structural-material.js';
import {
  createMotionRecorder3D,
  motionEntryLimit3D,
  type MaterialMotionTrace3D,
  type MotionTraceOptions3D,
} from '../motion-trace.js';
import {
  createMotionPathRecorder3D,
  motionPathLimits3D,
  type MaterialMotionPaths3D,
  type MaterialMotionPathsResult3D,
  type MotionPathOptions3D,
} from '../gameplay/motion-paths.js';

export { STRUCTURAL_RULES_VERSION_3D, STRUCTURAL_REACTIVE_RULES_VERSION_3D };
export const STRUCTURAL_SCHEMA_VERSION_3D = 2;
export const STRUCTURAL_WORLD_VERSION_3D = 'finite-structural-1';
/** A validated reactive registry selects the ca-3d-m6 law; without one the world runs ca-3d-m5. */
export type StructuralWorldOptions3D = ActiveWorldOptions3D & {
  registry?: ReactiveMaterialRegistry3D;
};
export type StructuralSnapshot3D = StructuralGeometry & {
  schemaVersion: number;
  rulesVersion: string;
  worldVersion: string;
  materialCatalogHash: string;
  chunkSize: number;
  tick: number;
  packedCells: number[];
  energyQ: number[];
  structure: number[];
};
type CellPosition = { x: number; y: number; z: number };
export type StructuralEdit3D = CellPosition &
  (
    | { kind: 'material'; material: number; thermal?: number }
    | { kind: 'energy'; energyQ: number }
    | { kind: 'integrity'; integrity: number }
    | { kind: 'anchor'; anchored: boolean }
    | { kind: 'bond'; direction: number; bonded: boolean }
  );
export type StructuralStepOptions3D = { edits?: readonly StructuralEdit3D[] };
const M5_LAW = structuralLaw3D();
function splitOptions(options: StructuralWorldOptions3D): {
  geometry: ActiveWorldOptions3D;
  law: StructuralLaw3D;
} {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw Error('Invalid world options.');
  const { registry, ...geometry } = options;
  return { geometry, law: structuralLaw3D(registry) };
}
const clone = (s: StructuralState3D): StructuralState3D => ({
  grid: s.grid.slice(),
  energyQ: s.energyQ.slice(),
  structure: s.structure.slice(),
});
const total = (s: StructuralState3D) => {
  let q = 0;
  for (const value of s.energyQ) q += value;
  return BigInt(q);
};
function position(p: CellPosition, g: StructuralGeometry): number {
  checkedInteger(p.x, 0, g.width - 1, 'x');
  checkedInteger(p.y, 0, g.height - 1, 'y');
  checkedInteger(p.z, 0, g.depth - 1, 'z');
  return p.x + g.width * (p.y + g.height * p.z);
}
/** Fresh placement: thermal + phase + chemical energy, as seedState computes it, under the world's law. */
function placement(law: StructuralLaw3D, id: number, thermal?: number) {
  if (!Number.isInteger(id) || !law.has(id))
    throw Error(`Material is not supported by ${law.rulesVersion}.`);
  const record = law.record(id),
    t = thermal ?? record.defaultThermal;
  checkedInteger(t, 0, 255, 'thermal');
  const at = id * COLD_STRIDE,
    energyQ =
      (t + law.cold[at + COLD_PHASE_ENERGY] + law.cold[at + COLD_FUEL_ENERGY]) * ENERGY_SCALE,
    packed = (id | (t << 8) | (record.defaultPhase << PHASE_SHIFT)) >>> 0;
  return { grid: thermalView(packed, energyQ, law.cold), energyQ };
}
/** ca-3d-m6 state law: active material at its default phase, zero velocity/flags, chemical floor. */
function validateReactiveState3D(
  cells: ArrayLike<number>,
  energies: ArrayLike<number>,
  count: number,
  law: StructuralLaw3D,
) {
  const grid = validatePackedCells(cells, count),
    energyQ = validatePackedCells(energies, count);
  for (let i = 0; i < count; i++) {
    const v = grid[i],
      id = v & 255;
    if (
      !law.has(id) ||
      (v & 0xf0ff0000) !== 0 ||
      ((v >>> PHASE_SHIFT) & 15) !== law.record(id).defaultPhase
    )
      throw Error(
        'ca-3d-m6 requires active materials at their default phase with zero velocity/flags.',
      );
    const minimum = law.cold[id * COLD_STRIDE + COLD_FUEL_ENERGY] * ENERGY_SCALE;
    if (energyQ[i] < minimum || energyQ[i] > MAX_ENERGY_Q)
      checkedInteger(energyQ[i], minimum, MAX_ENERGY_Q, `energyQ[${i}]`);
    if (thermalView(v, energyQ[i], law.cold) !== v)
      throw Error('Packed thermal view disagrees with conserved energy.');
  }
  return { grid, energyQ };
}
/** State-independent validation and owned command encoding, shared by CPU/GPU. */
export function prepareStructuralEdits3D(
  edits: readonly StructuralEdit3D[],
  g: StructuralGeometry,
  law: StructuralLaw3D = M5_LAW,
): Uint32Array {
  if (!Array.isArray(edits) || edits.length > 65536)
    throw Error('Structural edits must be an array of at most 65536 entries.');
  const commands = new Uint32Array(edits.length * 4);
  const expected = {
    material: ['kind,material,x,y,z', 'kind,material,thermal,x,y,z'],
    energy: ['energyQ,kind,x,y,z'],
    integrity: ['integrity,kind,x,y,z'],
    anchor: ['anchored,kind,x,y,z'],
    bond: ['bonded,direction,kind,x,y,z'],
  };
  for (let k = 0; k < edits.length; k++) {
    const edit: StructuralEdit3D = edits[k];
    if (
      !edit ||
      typeof edit !== 'object' ||
      Array.isArray(edit) ||
      !Object.hasOwn(expected, edit.kind) ||
      !expected[edit.kind].includes(Object.keys(edit).sort().join(','))
    )
      throw Error('Invalid structural edit fields.');
    const i = position(edit, g);
    let kind = 0,
      a = 0,
      b = 0;
    if (edit.kind === 'material') {
      const seed = placement(law, edit.material, edit.thermal);
      a = seed.grid;
      b = seed.energyQ;
    } else if (edit.kind === 'energy') {
      kind = 1;
      a = checkedInteger(edit.energyQ, 0, MAX_ENERGY_Q, 'energyQ');
    } else if (edit.kind === 'integrity') {
      kind = 2;
      a = checkedInteger(edit.integrity, 0, 255, 'integrity');
    } else if (edit.kind === 'anchor') {
      kind = 3;
      if (typeof edit.anchored !== 'boolean') throw Error('Anchor state must be boolean.');
      a = Number(edit.anchored);
    } else {
      kind = 4;
      a = checkedInteger(edit.direction, 0, 5, 'bond direction');
      if (typeof edit.bonded !== 'boolean') throw Error('Bond state must be boolean.');
      b = Number(edit.bonded);
      if (structuralNeighbor(i, a, g) < 0) throw Error('Bond crosses the closed boundary.');
    }
    commands.set([i, kind, a, b], k * 4);
  }
  return commands;
}
export function validateStructuralState3D(
  grid: ArrayLike<number>,
  energyQ: ArrayLike<number>,
  structure: ArrayLike<number>,
  g: StructuralGeometry,
  law: StructuralLaw3D = M5_LAW,
): StructuralState3D {
  // ca-3d-m5 reuses the existing packed-cell/thermal validity law, not its stepping behavior.
  const state = law.reactive
    ? validateReactiveState3D(grid, energyQ, g.width * g.height * g.depth, law)
    : validateVolumeSnapshot(
        {
          schemaVersion: SCHEMA_VERSION_3D,
          rulesVersion: RULES_VERSION_3D,
          materialCatalogHash: MATERIAL_CATALOG_HASH_3D,
          width: g.width,
          height: g.height,
          depth: g.depth,
          tick: 0,
          packedCells: grid as number[],
          energyQ: energyQ as number[],
        },
        128 ** 3,
      );
  const words = validatePackedCells(structure, state.grid.length);
  if (words.some((v) => (v & ~COMPLETE_STRUCTURE_3D) !== 0))
    throw Error('Reserved or pending structural bits in completed state.');
  const normalized = normalizeStructure3D(state.grid, words, g, law.cold);
  if (words.some((v, i) => v !== normalized[i]))
    throw Error('Invalid structural phase, boundary or reciprocal bond.');
  return { ...state, structure: words };
}
/** Validation under an explicit law; the public entry derives the law from an optional registry. */
export function validateStructuralSnapshotFor3D(
  s: StructuralSnapshot3D,
  law: StructuralLaw3D,
): StructuralState3D {
  const keys =
    'chunkSize,depth,energyQ,height,materialCatalogHash,packedCells,rulesVersion,schemaVersion,structure,tick,width,worldVersion';
  if (!s || typeof s !== 'object' || Object.keys(s).sort().join(',') !== keys)
    throw Error('Invalid structural snapshot fields.');
  if (
    s.schemaVersion !== STRUCTURAL_SCHEMA_VERSION_3D ||
    s.rulesVersion !== law.rulesVersion ||
    s.worldVersion !== STRUCTURAL_WORLD_VERSION_3D ||
    s.materialCatalogHash !== law.materialCatalogHash
  )
    throw Error('Incompatible structural snapshot version or catalog.');
  const g = activeWorldGeometry({
    width: s.width,
    height: s.height,
    depth: s.depth,
    chunkSize: s.chunkSize,
  });
  checkedInteger(s.tick, 0, Number.MAX_SAFE_INTEGER, 'tick');
  return validateStructuralState3D(s.packedCells, s.energyQ, s.structure, g, law);
}
/** ca-3d-m5 snapshots validate without a registry; ca-3d-m6 snapshots need the registry they bind. */
export function validateStructuralSnapshot3D(
  s: StructuralSnapshot3D,
  registry?: ReactiveMaterialRegistry3D,
): StructuralState3D {
  return validateStructuralSnapshotFor3D(s, structuralLaw3D(registry));
}

/** Ordered transaction. Temporary arrays are published only after every edit succeeds. */
export function applyStructuralEdits3D(
  input: StructuralState3D,
  edits: readonly StructuralEdit3D[],
  g: StructuralGeometry,
  law: StructuralLaw3D = M5_LAW,
): { state: StructuralState3D; externalQ: bigint } {
  prepareStructuralEdits3D(edits, g, law);
  if (!edits.length) return { state: input, externalQ: 0n };
  const state = clone(input);
  let externalQ = 0n;
  const clearBonds = (i: number) => {
    for (let dir = 0; dir < 6; dir++) {
      const j = structuralNeighbor(i, dir, g);
      if (j >= 0) state.structure[j] &= ~BONDS_3D[dir ^ 1];
    }
    state.structure[i] &= INTEGRITY_3D | ANCHOR_3D;
  };
  for (let k = 0; k < edits.length; k++) {
    const edit: StructuralEdit3D = edits[k];
    if (!edit || typeof edit !== 'object' || Array.isArray(edit))
      throw Error('Invalid structural edit.');
    const keys = Object.keys(edit).sort().join(',');
    const expected = {
      material: ['kind,material,x,y,z', 'kind,material,thermal,x,y,z'],
      energy: ['energyQ,kind,x,y,z'],
      integrity: ['integrity,kind,x,y,z'],
      anchor: ['anchored,kind,x,y,z'],
      bond: ['bonded,direction,kind,x,y,z'],
    };
    if (!Object.hasOwn(expected, edit.kind) || !expected[edit.kind].includes(keys))
      throw Error('Invalid structural edit fields.');
    const i = position(edit, g);
    if (edit.kind === 'material') {
      const seed = placement(law, edit.material, edit.thermal);
      clearBonds(i);
      externalQ += BigInt(seed.energyQ) - BigInt(state.energyQ[i]);
      state.grid[i] = seed.grid;
      state.energyQ[i] = seed.energyQ;
      state.structure[i] = structuralEligible(state.grid[i], law.cold) ? INTEGRITY_3D : 0;
      if (state.structure[i])
        for (let dir = 0; dir < 6; dir++) {
          const j = structuralNeighbor(i, dir, g);
          if (j >= 0 && state.structure[j] & INTEGRITY_3D) {
            state.structure[i] |= BONDS_3D[dir];
            state.structure[j] |= BONDS_3D[dir ^ 1];
          }
        }
    } else if (edit.kind === 'energy') {
      checkedInteger(edit.energyQ, 0, MAX_ENERGY_Q, 'energyQ');
      externalQ += BigInt(edit.energyQ) - BigInt(state.energyQ[i]);
      state.energyQ[i] = edit.energyQ;
      state.grid[i] = thermalView(state.grid[i], edit.energyQ, law.cold);
    } else {
      if (!structuralEligible(state.grid[i], law.cold))
        throw Error('Mechanical edits require a cohesive solid/frozen cell.');
      if (edit.kind === 'integrity') {
        checkedInteger(edit.integrity, 0, 255, 'integrity');
        if (!edit.integrity) clearBonds(i);
        state.structure[i] = (state.structure[i] & ~INTEGRITY_3D) | edit.integrity;
      } else if (edit.kind === 'anchor') {
        if (typeof edit.anchored !== 'boolean') throw Error('Anchor state must be boolean.');
        state.structure[i] = edit.anchored
          ? state.structure[i] | ANCHOR_3D
          : state.structure[i] & ~ANCHOR_3D;
      } else {
        checkedInteger(edit.direction, 0, 5, 'bond direction');
        if (typeof edit.bonded !== 'boolean') throw Error('Bond state must be boolean.');
        const j = structuralNeighbor(i, edit.direction, g);
        if (j < 0) throw Error('Bond crosses the closed boundary.');
        if (edit.bonded) {
          if (!(state.structure[i] & INTEGRITY_3D) || !(state.structure[j] & INTEGRITY_3D))
            throw Error('Bond endpoints must both be intact.');
          state.structure[i] |= BONDS_3D[edit.direction];
          state.structure[j] |= BONDS_3D[edit.direction ^ 1];
        } else {
          state.structure[i] &= ~BONDS_3D[edit.direction];
          state.structure[j] &= ~BONDS_3D[edit.direction ^ 1];
        }
      }
    }
  }
  return { state, externalQ };
}

export class CpuStructuralWorld3D {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly chunkSize: number;
  readonly rulesVersion: string;
  readonly materialCatalogHash: string;
  #law: StructuralLaw3D;
  #state: StructuralState3D;
  #tick = 0;
  #initial = 0n;
  #external = 0n;
  constructor(options: StructuralWorldOptions3D = {}) {
    const { geometry, law } = splitOptions(options),
      g = activeWorldGeometry(geometry);
    this.width = g.width;
    this.height = g.height;
    this.depth = g.depth;
    this.chunkSize = g.chunkSize;
    this.#law = law;
    this.rulesVersion = law.rulesVersion;
    this.materialCatalogHash = law.materialCatalogHash;
    const seed = placement(law, geometry.fillMaterial ?? MAT.AIR),
      n = g.width * g.height * g.depth;
    const grid = new Uint32Array(n).fill(seed.grid),
      words = new Uint32Array(n).fill(
        structuralEligible(seed.grid, law.cold) ? INTEGRITY_3D | FRESH_3D : 0,
      );
    this.#state = {
      grid,
      energyQ: new Uint32Array(n).fill(seed.energyQ),
      structure: normalizeStructure3D(grid, words, g, law.cold),
    };
    this.#initial = total(this.#state);
    for (const key of [
      'width',
      'height',
      'depth',
      'chunkSize',
      'rulesVersion',
      'materialCatalogHash',
    ])
      Object.defineProperty(this, key, { writable: false, configurable: false });
  }
  get tick() {
    return this.#tick;
  }
  get grid() {
    return this.#state.grid.slice();
  }
  get energyQ() {
    return this.#state.energyQ.slice();
  }
  get structure() {
    return this.#state.structure.slice();
  }
  edit(edits: readonly StructuralEdit3D[]) {
    const next = applyStructuralEdits3D(this.#state, edits, this, this.#law);
    this.#state = next.state;
    this.#external += next.externalQ;
  }
  setCell(x: number, y: number, z: number, material: number, thermal?: number) {
    this.edit([
      { kind: 'material', x, y, z, material, ...(thermal === undefined ? {} : { thermal }) },
    ]);
  }
  setEnergy(x: number, y: number, z: number, energyQ: number) {
    this.edit([{ kind: 'energy', x, y, z, energyQ }]);
  }
  setAnchor(x: number, y: number, z: number, anchored: boolean) {
    this.edit([{ kind: 'anchor', x, y, z, anchored }]);
  }
  setIntegrity(x: number, y: number, z: number, integrity: number) {
    this.edit([{ kind: 'integrity', x, y, z, integrity }]);
  }
  setBond(x: number, y: number, z: number, direction: number, bonded: boolean) {
    this.edit([{ kind: 'bond', x, y, z, direction, bonded }]);
  }
  step(ticks = 1, options: StructuralStepOptions3D = {}) {
    this.#advance(ticks, options);
  }
  /** Optional provenance for one complete tick; it is never stored in snapshots. */
  stepWithMotion(options: MotionTraceOptions3D = {}): MaterialMotionTrace3D {
    return this.#advance(1, {}, motionEntryLimit3D(options))!;
  }
  /** Observed sub-pass transfers for one tick; capture overflow never changes physics. */
  stepWithMotionPaths(options: MotionPathOptions3D = {}): MaterialMotionPathsResult3D {
    const limits = motionPathLimits3D(options),
      capture: { limit: number; result?: MaterialMotionPaths3D } = { limit: limits.pathLimit };
    const motion = this.#advance(1, {}, limits.motionLimit, capture)!;
    return { motion, paths: capture.result! };
  }
  #advance(
    ticks: number,
    options: StructuralStepOptions3D,
    captureLimit?: number,
    pathCapture?: { limit: number; result?: MaterialMotionPaths3D },
  ): MaterialMotionTrace3D | undefined {
    checkedInteger(ticks, 0, 32, 'ticks per request');
    checkedInteger(this.#tick + ticks, 0, Number.MAX_SAFE_INTEGER, 'end tick');
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Object.keys(options).some((k) => k !== 'edits')
    )
      throw Error('Invalid structural step options.');
    const law = this.#law,
      edited = applyStructuralEdits3D(
        this.#state,
        options.edits === undefined ? [] : options.edits,
        this,
        law,
      );
    if (!ticks) {
      this.#state = edited.state;
      this.#external += edited.externalQ;
      return;
    }
    let input = edited.state,
      lastTrace: MaterialMotionTrace3D | undefined;
    for (let t = 0; t < ticks; t++) {
      // A complete tick is staged off-state. Failed solves cannot publish partial damage/motion.
      let state: StructuralState3D,
        recorder: ReturnType<typeof createMotionRecorder3D> | undefined,
        pathRecorder: ReturnType<typeof createMotionPathRecorder3D> | undefined;
      const identity = {
        physicsRulesVersion: law.rulesVersion,
        materialCatalogHash: law.materialCatalogHash,
      };
      if (captureLimit === undefined) state = solveStructure3D(input, this, law.cold).state;
      else {
        const plan = solveStructure3D(input, this, law.cold);
        state = plan.state;
        recorder = createMotionRecorder3D(plan, this, this.#tick, identity, captureLimit);
        if (pathCapture) {
          pathRecorder = createMotionPathRecorder3D(
            plan,
            this,
            this.#tick,
            identity,
            pathCapture.limit,
          );
          recorder.provenance.pathSwap = pathRecorder.swap;
        }
      }
      let spare = clone(state);
      for (const pass of structuralSchedule3D(this.#tick, law.reactive)) {
        if (pass.kind === 'combustion') {
          // Combustion rewrites cells in place: no motion, so the movement recorders are not advanced.
          executeStructuralMaterialPass(
            state,
            spare,
            this.width,
            this.height,
            this.depth,
            this.#tick,
            pass,
            undefined,
            law.cold,
          );
          [state, spare] = [spare, state];
          continue;
        }
        executeStructuralMaterialPass(
          state,
          spare,
          this.width,
          this.height,
          this.depth,
          this.#tick,
          pass,
          recorder?.provenance,
          law.cold,
        );
        [state, spare] = [spare, state];
        pathRecorder?.endPass(pass);
        recorder?.endPass();
      }
      state.structure = normalizeStructure3D(state.grid, state.structure, this, law.cold);
      lastTrace = recorder?.finish();
      if (pathCapture) pathCapture.result = pathRecorder!.finish(lastTrace!);
      this.#state = state;
      this.#tick++;
      if (t === 0) this.#external += edited.externalQ;
      input = state;
    }
    return lastTrace;
  }
  sample(x: number, y: number, z: number) {
    const i = position({ x, y, z }, this),
      v = this.#state.grid[i],
      q = this.#state.energyQ[i],
      s = this.#state.structure[i];
    return {
      material: v & 255,
      materialName: this.#law.record(v & 255).name,
      phase: (v >>> PHASE_SHIFT) & 15,
      thermal: (v >>> 8) & 255,
      energyQ: q,
      temperatureQ: temperatureQ(v, q, this.#law.cold),
      structure: s,
      integrity: s & INTEGRITY_3D,
      anchored: Boolean(s & ANCHOR_3D),
      bonds: BONDS_3D.map((b) => Boolean(s & b)),
    };
  }
  copyStateInto(target: StructuralState3D) {
    const arrays = stateCopyTargets(target, this.#state.grid.length);
    if (arrays.some((a) => !(a.buffer instanceof ArrayBuffer)))
      throw Error('State copy requires owned ArrayBuffers.');
    for (const [i, key] of (['grid', 'energyQ', 'structure'] as const).entries())
      Uint32Array.prototype.set.call(arrays[i], this.#state[key]);
    return this.#tick;
  }
  snapshot(): StructuralSnapshot3D {
    return {
      schemaVersion: STRUCTURAL_SCHEMA_VERSION_3D,
      rulesVersion: this.#law.rulesVersion,
      worldVersion: STRUCTURAL_WORLD_VERSION_3D,
      materialCatalogHash: this.#law.materialCatalogHash,
      width: this.width,
      height: this.height,
      depth: this.depth,
      chunkSize: this.chunkSize,
      tick: this.#tick,
      packedCells: Array.from(this.#state.grid),
      energyQ: Array.from(this.#state.energyQ),
      structure: Array.from(this.#state.structure),
    };
  }
  restore(snapshot: StructuralSnapshot3D) {
    const next = validateStructuralSnapshotFor3D(snapshot, this.#law);
    if (
      snapshot.width !== this.width ||
      snapshot.height !== this.height ||
      snapshot.depth !== this.depth
    )
      throw Error('Structural snapshot geometry differs.');
    this.#state = next;
    this.#tick = snapshot.tick;
    this.#initial = total(next);
    this.#external = 0n;
  }
  energyLedger() {
    return energyLedger(this.#state, this.#law.cold);
  }
  energyBalance() {
    const currentQ = total(this.#state);
    return {
      initialQ: this.#initial,
      externalQ: this.#external,
      currentQ,
      driftQ: currentQ - this.#initial - this.#external,
    };
  }
  inspectStructure() {
    return solveStructure3D(this.#state, this, this.#law.cold);
  }
}
export const createStateSpaceStructuralWorld3D = (options: StructuralWorldOptions3D = {}) =>
  new CpuStructuralWorld3D(options);
