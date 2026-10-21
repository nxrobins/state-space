/** Shared synthetic permutation fixtures. Never calls a material tick or support solve. */
import { volumeSchedule } from '../3d-core.js';
import type * as mechanics from '../structural-mechanics.js';
import {
  CpuStructuralWorld3D,
  type StructuralSnapshot3D,
} from '../structural/structural-world-core.js';
import { createMotionRecorder3D } from '../motion-trace.js';
import { createMotionPathRecorder3D } from '../motion-paths.js';
import type { TacticalSimulationFactory3D } from '../tactical/tactical-session-core.js';

export const index = (x: number, y: number, z: number) => x + 4 * (y + 4 * z);
export function seed(cells: [number, number, number, number][] = []): StructuralSnapshot3D {
  const w = new CpuStructuralWorld3D({ width: 4, height: 4, depth: 4, chunkSize: 4 });
  for (const [x, y, z, material] of cells) w.setCell(x, y, z, material);
  const result = w.snapshot();
  result.structure.fill(0);
  return result;
}
export type Spec = {
  falls?: number[][];
  swaps?: Map<number, [number, number][]>;
  overflow?: boolean;
  after?: StructuralSnapshot3D;
};
export function observe(before: StructuralSnapshot3D, spec: Spec = {}) {
  const n = before.packedCells.length;
  const plan: mechanics.StructuralPlan3D = {
    state: { grid: new Uint32Array(n), energyQ: new Uint32Array(n), structure: new Uint32Array(n) },
    sources: Uint32Array.from({ length: n }, (_, i) => i),
    distances: new Int32Array(n).fill(-1),
    loads: new Uint32Array(n),
    capacities: new Uint32Array(n),
    reactions: new Uint32Array(n),
    componentIds: new Int32Array(n).fill(-1),
    moving: new Uint8Array(n),
    supportedWeight: 0,
    brokenCells: 0,
    movedCells: 0,
  };
  for (const members of spec.falls ?? []) {
    for (const i of members) {
      plan.sources[i + 4] = i;
      plan.moving[i] = 1;
      plan.componentIds[i] = members[0];
    }
    plan.sources[members[0]] = members[members.length - 1] + 4;
  }
  const identity = {
    physicsRulesVersion: before.rulesVersion,
    materialCatalogHash: before.materialCatalogHash,
  };
  const net = createMotionRecorder3D(plan, before, before.tick, identity, 4096),
    paths = createMotionPathRecorder3D(
      plan,
      before,
      before.tick,
      identity,
      spec.overflow ? 0 : 4096,
    );
  const schedule = volumeSchedule(before.tick);
  for (let p = 0; p < schedule.length; p++) {
    const v = net.provenance;
    v.output.set(v.input);
    for (const [a, b] of spec.swaps?.get(p + 1) ?? []) {
      paths.swap(a, b, v.input[a], v.input[b]);
      v.output[a] = v.input[b];
      v.output[b] = v.input[a];
      v.touched[v.input[a]] = v.touched[v.input[b]] = 1;
    }
    paths.endPass(schedule[p]);
    net.endPass();
  }
  const motion = net.finish(),
    path = paths.finish(motion),
    after = spec.after ? structuredClone(spec.after) : structuredClone(before);
  after.tick = before.tick + 1;
  if (!spec.after)
    for (let i = 0; i < n; i++) {
      after.packedCells[i] = before.packedCells[net.provenance.input[i]];
      after.energyQ[i] = before.energyQ[net.provenance.input[i]];
      after.structure[i] = 0;
    }
  return { motion, paths: path, after };
}
export function factory(spec: Spec = {}, failClose = false): TacticalSimulationFactory3D {
  return (initial) => {
    let before = structuredClone(initial),
      result: ReturnType<typeof observe> | undefined;
    return {
      load(value) {
        before = structuredClone(value);
      },
      step() {
        result = observe(before, spec);
        before = structuredClone(result.after);
      },
      snapshot: () => result!.after,
      motion: () => result!.motion,
      paths: () => result!.paths,
      close() {
        if (failClose) throw Error('fixture close failure');
      },
    };
  };
}
