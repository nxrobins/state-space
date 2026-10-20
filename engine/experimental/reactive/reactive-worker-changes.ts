/** Defensive compact report validation. Does not rerun support or physics. */
import { PHASE_SHIFT } from '../../generated/materials.js';
import { temperatureQ } from '../../thermal.js';
import { reactiveArray3D, reactiveFields3D as fields, reactiveInteger3D as integer, reactiveRegistrySource3D, type ReactiveMaterialRegistry3D } from './reactive-registry.js';
import { reactiveDomain3D } from './reactive-domain-state.js';
import { reactiveSnapshotHolds3D } from './reactive-world-tick.js';
import type { ReactiveGeometryStamp3D } from './reactive-geometry.js';
import type { ReactiveGameValue3D, ReactiveSessionSnapshot3D } from './reactive-session-state.js';
import { REACTIVE_CHANGE_RULES_3D, REACTIVE_CHANGE_CHANNELS_3D, type ReactiveChangeReport3D } from './reactive-changes.js';
import { reactivePortable3D } from './reactive-worker-queries.js';
import { workerEqual } from './reactive-worker-wire.js';
export function readReactiveChangeReport3D(registry: ReactiveMaterialRegistry3D, raw: unknown,
  before: ReactiveSessionSnapshot3D<ReactiveGameValue3D>, after: ReactiveSessionSnapshot3D<ReactiveGameValue3D>,
  from: ReactiveGeometryStamp3D, to: ReactiveGeometryStamp3D, maximum: number): ReactiveChangeReport3D {
  const value = reactivePortable3D(raw), left = reactiveDomain3D(before.domains, from.domain), right = reactiveDomain3D(after.domains, to.domain), a = left.block, b = right.block;
  fields(value, ['rulesVersion', 'scope', 'from', 'to', 'width', 'height', 'depth', 'channels', 'runBudget', 'supportMeaning', 'motion']);
  if (value.rulesVersion !== REACTIVE_CHANGE_RULES_3D || value.scope !== 'endpoints' || !workerEqual(value.from, from) || !workerEqual(value.to, to) ||
      value.width !== a.width || value.height !== a.height || value.depth !== a.depth || value.runBudget !== maximum ||
      value.supportMeaning !== 'global-endpoint-assessment' || !workerEqual(value.motion, {status: 'not-observed', requiresExecutionTrace: true})) throw Error('Reactive change report identity differs.');
  fields(value.channels, REACTIVE_CHANGE_CHANNELS_3D);
  const n = a.packedCells.length, dims = [a.width, a.height, a.depth], cold = reactiveRegistrySource3D(registry).cold;
  const holds = (s: typeof left) => {const m = new Map<number, string>(); for (const h of reactiveSnapshotHolds3D(s)) for (const i of h.cells) m.set(i, h.id + ':' + h.expiresAtTick); return m;};
  const ha = holds(left), hb = holds(right); let runs = 0;
  for (const name of REACTIVE_CHANGE_CHANNELS_3D) {
    const c = value.channels[name]; fields(c, ['mode', 'count', 'bounds', 'runs', 'requiresFullRead']);
    const count = integer(c.count, 0, n), rows = reactiveArray3D(c.runs, maximum);
    if (count === 0) {if (c.mode !== 'unchanged' || c.bounds !== null || rows.length || c.requiresFullRead !== false) throw Error('Invalid unchanged channel.'); continue;}
    fields(c.bounds, ['min', 'max']); const min = reactiveArray3D(c.bounds.min, 3), max = reactiveArray3D(c.bounds.max, 3);
    if (min.length !== 3 || max.length !== 3) throw Error('Invalid change bounds.');
    for (let axis = 0; axis < 3; axis++) {integer(min[axis], 0, dims[axis] - 1); integer(max[axis], (min[axis] as number) + 1, dims[axis]);}
    if (count > dims.reduce((v, _, axis) => v * ((max[axis] as number) - (min[axis] as number)), 1)) throw Error('Change count exceeds bounds.');
    if (c.mode === 'bounds') {if (rows.length || c.requiresFullRead !== true) throw Error('Partial change ranges cannot be accepted.'); continue;}
    if (c.mode !== 'runs' || c.requiresFullRead !== false || !rows.length) throw Error('Invalid change channel mode.');
    let previousEnd = -1, total = 0; const lo = [...dims], hi = [0, 0, 0];
    for (const row of rows) {
      const r = reactiveArray3D(row, 2); if (r.length !== 2) throw Error('Invalid change run.');
      const start = integer(r[0], 0, n - 1), length = integer(r[1], 1, n - start);
      if (start <= previousEnd) throw Error('Change runs are not canonical.'); previousEnd = start + length; total += length;
      for (let i = start; i < start + length; i++) {
        const xyz = [i % a.width, Math.floor(i / a.width) % a.height, Math.floor(i / (a.width * a.height))];
        for (let axis = 0; axis < 3; axis++) {lo[axis] = Math.min(lo[axis], xyz[axis]); hi[axis] = Math.max(hi[axis], xyz[axis] + 1);}
        const pa = a.packedCells[i], pb = b.packedCells[i], qa = a.energyQ[i], qb = b.energyQ[i];
        const changed = name === 'packed' ? pa !== pb : name === 'material' ? (pa & 255) !== (pb & 255) : name === 'phase' ? (pa >>> PHASE_SHIFT & 15) !== (pb >>> PHASE_SHIFT & 15) :
          name === 'energy' ? qa !== qb : name === 'temperature' ? temperatureQ(pa, qa, cold) !== temperatureQ(pb, qb, cold) :
          name === 'structure' ? a.structure[i] !== b.structure[i] : name === 'constraints' ? ha.get(i) !== hb.get(i) : true;
        if (!changed) throw Error('Reported cell did not change in its channel.');
      }
    }
    runs += rows.length;
    if (total !== count || !workerEqual(lo, min) || !workerEqual(hi, max) || runs > maximum) throw Error('Change counts, bounds or shared budget differ.');
  }
  return value as unknown as ReactiveChangeReport3D;
}
