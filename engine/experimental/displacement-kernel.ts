/** Shared exact one-way contact solver. Internal adapters supply trusted paths. */
import { PHASE, PHASE_SHIFT } from '../generated/materials.js';
import { GEOMETRY_SCALE_3D as Q, type GeometryKernel3D, type GeometryTime3D } from './geometry-kernel.js';
import type { KinematicBody3D } from './body-kernel.js';
type MotionPathSegment3D = {origin: number; from: number; to: number; mode: 'linear' | 'relocation'};
type CellState = {packed: number; energyQ: number; structure: number};
export type DisplacementCellSource3D = {token: object; shape: [number, number, number]; at(index: number): CellState};

export const DISPLACEMENT_LIMITS_3D = Object.freeze({defaultContacts: 256, contacts: 4096, defaultEvents: 128, events: 512, defaultWork: 262144, work: 1048576});
type V = [number, number, number];
type F = GeometryTime3D;
export type DisplacementTraceSegment3D = {pass: number; start: F; end: F; offsetQ: V; velocityQ: V};
// Private to engine adapters. Public response copies cannot forge a trajectory.
const traces = new WeakMap<object, readonly DisplacementTraceSegment3D[]>();
export function displacementTrace3D(response: object): readonly DisplacementTraceSegment3D[] {
  const trace = traces.get(response); if (!trace) throw Error('Expected a complete bound body trajectory.'); return trace;
}
export function forwardDisplacementTrace3D(from: object, to: object): void {
  const trace = traces.get(from); if (trace) traces.set(to, trace);
}
type Collider = {origin: number | null; from: number | null; to: number | null; material: number | null; energyQ: number | null;
  fragment: number | null; boundary: number | null; min: V; max: V; velocity: V};
type Hit = {cell: Collider; time: F; axis: number; sign: number};
export type DisplacementContact3D = {
  pass: number; time: GeometryTime3D; normal: V; origin: number | null; from: number | null; to: number | null;
  material: number | null; energyQ: number | null; fragment: number | null; boundary: number | null;
};
export type DisplacementOptions3D = {maxContacts?: number; maxEvents?: number; maxWork?: number};
export type DisplacementResult3D<R extends string, S, B extends KinematicBody3D> = {
  rulesVersion: R; from: S; to: S;
  status: 'resolved' | 'crushed' | 'embedded' | 'outside' | 'incomplete';
  reason: 'opposed-constraints' | 'relocation-overlap' | 'phase-overlap' | 'initial-overlap' | 'initial-outside' | 'pass-overlap' | 'budget' | 'missing-paths' | null;
  throughPass: number | null; requiresReexecution: boolean; body: B; movedQ: V; supportFragments: number[];
  contacts: DisplacementContact3D[]; crush: {axis: number; lowerVelocityQ: number; upperVelocityQ: number} | null;
  work: number; events: number; supportBefore: ReturnType<GeometryKernel3D<S>['support']>; supportAfter: ReturnType<GeometryKernel3D<S>['support']>; lostFooting: boolean; landed: boolean;
  exposure: ReturnType<GeometryKernel3D<S>['exposure']>;
};
export interface DisplacementCore3D<R extends string, S, B extends KinematicBody3D> {
  readonly rulesVersion: R;
  readonly from: S; readonly to: S;
  resolve(body: B, options?: DisplacementOptions3D, carry?: DisplacementCarry3D<B>): DisplacementResult3D<R, S, B>;
}
export type DisplacementPass3D = {index: number; segments: readonly MotionPathSegment3D[]; changes?: readonly (CellState & {index: number})[]};
export type DisplacementCarry3D<B extends KinematicBody3D> = (pass: DisplacementPass3D, body: B, positions: ReadonlyMap<number, number>, spend: () => boolean, at: (origin: number) => CellState) => V | null;
export type DisplacementSource3D<R extends string, S> = {
  rulesVersion: R; from: S; to: S;
  before: object; after: object; complete: boolean; passes: readonly DisplacementPass3D[];
  members: ReadonlyMap<number, number>; lastPass: number; fragmentPass?: number;
};
const ZERO: F = {numerator: 0, denominator: 1}, ONE: F = {numerator: 1, denominator: 1};
const cmp = (a: F, b: F) => a.numerator * b.denominator - b.numerator * a.denominator;
function rational(numerator: number, denominator: number): F {
  let a = Math.abs(numerator), b = denominator; while (b) {[a, b] = [b, a % b];}
  return {numerator: numerator / a, denominator: denominator / a};
}
function solid(packed: number): boolean {const p = (packed >>> PHASE_SHIFT) & 15; return p === PHASE.SOLID || p === PHASE.FROZEN || p === PHASE.POWDER;}
function box(body: KinematicBody3D) {return {minQ: body.minQ, maxQ: body.minQ.map((v, i) => v + body.sizeQ[i]) as V};}
function options(value: DisplacementOptions3D) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(k => !['maxContacts', 'maxEvents', 'maxWork'].includes(String(k)) || typeof k !== 'string') ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d) || !d.enumerable)) throw Error('Invalid displacement options.');
  const read = (key: keyof DisplacementOptions3D, fallback: number, maximum: number) => {
    const n = Object.hasOwn(value, key) && value[key] !== undefined ? value[key]! : fallback;
    if (!Number.isSafeInteger(n) || n < 0 || n > maximum) throw Error('Invalid displacement budget.'); return n;
  };
  const l = DISPLACEMENT_LIMITS_3D;
  return {contacts: read('maxContacts', l.defaultContacts, l.contacts), events: read('maxEvents', l.defaultEvents, l.events), work: read('maxWork', l.defaultWork, l.work)};
}
function hit(offset: V, velocity: V, size: V, cell: Collider, start: F): Hit | null {
  let enter = start, exit: F | null = null, axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    const d = velocity[i] - cell.velocity[i];
    if (!d) {if (offset[i] + size[i] <= cell.min[i] || offset[i] >= cell.max[i]) return null; continue;}
    const near = rational(d > 0 ? cell.min[i] - offset[i] - size[i] : offset[i] - cell.max[i], Math.abs(d));
    const far = rational(d > 0 ? cell.max[i] - offset[i] : offset[i] + size[i] - cell.min[i], Math.abs(d));
    if (cmp(near, enter) > 0 || (cmp(near, enter) === 0 && axis < 0)) {enter = near; axis = i; sign = d > 0 ? -1 : 1;}
    if (!exit || cmp(far, exit) < 0) exit = far;
  }
  if (exit && (cmp(exit, start) <= 0 || cmp(enter, exit) >= 0)) return null;
  if (cmp(enter, ONE) > 0) return null;
  // axis -1 means positive overlap already existed at this event boundary.
  return {cell, time: {...enter}, axis, sign};
}
function touches(offset: V, velocity: V, size: V, cell: Collider, time: F): Hit[] {
  const d = time.denominator, n = time.numerator;
  const low = offset.map((v, i) => (v - cell.min[i]) * d + (velocity[i] - cell.velocity[i]) * n);
  const high = offset.map((v, i) => (v + size[i] - cell.max[i]) * d + (velocity[i] - cell.velocity[i]) * n);
  const overlap = low.map((v, i) => v < (cell.max[i] - cell.min[i]) * d && high[i] > -(cell.max[i] - cell.min[i]) * d);
  const result: Hit[] = [];
  for (let axis = 0; axis < 3; axis++) if (overlap.every((v, i) => i === axis || v)) {
    const left = low[axis] + size[axis] * d === 0, right = high[axis] - size[axis] * d === 0;
    if (left || right) result.push({cell, time: {...time}, axis, sign: left ? -1 : 1});
  }
  return result;
}
const hitOrder = (a: Hit, b: Hit) => (a.cell.boundary === null ? 1 : 0) - (b.cell.boundary === null ? 1 : 0) ||
  (a.cell.boundary ?? a.cell.origin!) - (b.cell.boundary ?? b.cell.origin!) || a.axis - b.axis || a.sign - b.sign;

export function createDisplacementKernel3D<R extends string, S, B extends KinematicBody3D>(before: GeometryKernel3D<S>, after: GeometryKernel3D<S>, observed: DisplacementSource3D<R, S>,
  source: DisplacementCellSource3D, targetToken: object, read: (view: GeometryKernel3D<S>, body: B) => B): DisplacementCore3D<R, S, B> {
  if (source.token !== observed.before || targetToken !== observed.after || JSON.stringify(before.stamp) !== JSON.stringify(observed.from) || JSON.stringify(after.stamp) !== JSON.stringify(observed.to)) throw Error('Displacement geometry differs from its observed boundaries.');
  const {complete, members} = observed;
  const [width, height] = source.shape, extent = source.shape.map(v => v * Q) as V;
  const coord = (i: number): V => [i % width * Q, Math.floor(i / width) % height * Q, Math.floor(i / (width * height)) * Q];
  const walls: Collider[] = [];
  for (let axis = 0; axis < 3; axis++) for (const side of [0, 1]) {
    const min: V = [-Q, -Q, -Q], max = extent.map(v => v + Q) as V;
    if (side) min[axis] = extent[axis]; else max[axis] = 0;
    walls.push({origin: null, from: null, to: null, material: null, energyQ: null, fragment: null, boundary: axis * 2 + side, min, max, velocity: [0, 0, 0]});
  }
  return Object.freeze<DisplacementCore3D<R, S, B>>({rulesVersion: observed.rulesVersion, from: observed.from, to: observed.to,
    resolve(input, request = {}, carry) {
      const limit = options(request), original = read(before, input), body = read(after, original);
      const updated = new Map<number, CellState>();
      const at = (origin: number) => updated.get(origin) ?? source.at(origin); let currentPass = -1;
  const cell = (origin: number, from: number, to = from): Collider => {
    const state = at(origin), min = coord(from), end = coord(to);
    return {origin, from, to, material: state.packed & 255, energyQ: state.energyQ, fragment: observed.fragmentPass === undefined || observed.fragmentPass === currentPass ? members.get(origin) ?? null : null,
      boundary: null, min, max: min.map(v => v + Q) as V, velocity: end.map((v, i) => v - min[i]) as V};
  };
      const supportBefore = before.support({box: box(original), maxDropQ: 0});
      let work = 0, events = 0, contacts: DisplacementContact3D[] = [], crush: DisplacementResult3D<R, S, B>['crush'] = null;
      const trace: DisplacementTraceSegment3D[] = [];
      const tracePart = (pass: number, start: F, end: F, offsetQ: V, velocityQ: V) => {
        if (cmp(start, end) < 0) trace.push({pass, start: {...start}, end: {...end}, offsetQ: [...offsetQ], velocityQ: [...velocityQ]});
      };
      const fragments = original.grounded && supportBefore.distanceQ === 0 && supportBefore.surfaces.length && supportBefore.surfaces.every(s => s.cell && members.has(s.cell.index)) ?
        [...new Set(supportBefore.surfaces.map(s => members.get(s.cell!.index)!))].sort((a, b) => a - b) : [];
      const finish = (status: DisplacementResult3D<R, S, B>['status'], reason: DisplacementResult3D<R, S, B>['reason'], throughPass: number | null): DisplacementResult3D<R, S, B> => {
        const result = status === 'resolved' ? body : original, b = box(result), supportAfter = after.support({box: b, maxDropQ: 0}), grounded = supportAfter.bodyFits && supportAfter.distanceQ === 0;
        if (status === 'resolved') result.grounded = grounded;
        contacts.sort((a, b) => a.pass - b.pass || cmp(a.time, b.time) || (a.boundary === null ? 1 : 0) - (b.boundary === null ? 1 : 0) ||
          (a.boundary ?? a.origin!) - (b.boundary ?? b.origin!) || a.normal.findIndex(v => v !== 0) - b.normal.findIndex(v => v !== 0));
        const response: DisplacementResult3D<R, S, B> = {rulesVersion: observed.rulesVersion, from: observed.from, to: observed.to, status, reason, throughPass, requiresReexecution: status === 'incomplete',
          body: result, movedQ: status === 'resolved' ? result.minQ.map((v, i) => v - original.minQ[i]) as V : [0, 0, 0], supportFragments: [...fragments],
          contacts: status === 'incomplete' ? [] : contacts, crush: status === 'incomplete' ? null : crush, work, events, supportBefore, supportAfter,
          lostFooting: status === 'resolved' && original.grounded && (!grounded || supportBefore.distanceQ !== 0),
          landed: status === 'resolved' && grounded && (!original.grounded || supportBefore.distanceQ !== 0), exposure: after.exposure({box: b})};
        if (status === 'resolved') traces.set(response, trace); return response;
      };
      if (!complete) return finish('incomplete', 'missing-paths', null);
      const initial = before.fit({box: box(original)});
      if (!initial.fits) return finish(initial.outside ? 'outside' : 'embedded', initial.outside ? 'initial-outside' : 'initial-overlap', null);
      const spend = () => {if (work === limit.work) return false; work++; return true;};
      const detail = new Set<string>();
      const add = (h: Hit, pass: number) => {
        const key = `${pass}:${h.time.numerator}/${h.time.denominator}:${h.cell.boundary === null ? 'c' + h.cell.origin : 'b' + h.cell.boundary}:${h.axis}:${h.sign}`;
        if (detail.has(key)) return true; if (contacts.length === limit.contacts) return false;
        const normal: V = [0, 0, 0]; if (h.axis >= 0) normal[h.axis] = h.sign;
        const {origin, from, to, material, energyQ, fragment, boundary} = h.cell;
        contacts.push({pass, time: {...h.time}, normal, origin, from, to, material, energyQ, fragment, boundary}); detail.add(key); return true;
      };
      // Sparse original-identity lookup tracks all previous simultaneous passes.
      const positions = new Map<number, number>();
      for (const pass of observed.passes) {
        currentPass = pass.index;
        const moved = new Set<number>(), dynamic: Collider[] = [], relocations: MotionPathSegment3D[] = [];
        const reachMin = body.minQ.map(v => v - Q) as V, reachMax = body.minQ.map((v, i) => v + body.sizeQ[i] + Q) as V;
        const nearby = (c: Collider) => c.min.every((v, i) => Math.min(v, v + c.velocity[i]) <= reachMax[i] && Math.max(c.max[i], c.max[i] + c.velocity[i]) >= reachMin[i]);
        for (const s of pass.segments) {
          if (!spend()) return finish('incomplete', 'budget', null);
          moved.add(s.from); if (!solid(at(s.origin).packed)) continue;
          if (s.mode === 'relocation') relocations.push(s); else {const c = cell(s.origin, s.from, s.to); if (nearby(c)) dynamic.push(c);}
        }
        const candidates = walls.slice(); candidates.push(...dynamic);
        const lo = reachMin.map(v => Math.max(0, Math.floor(v / Q) - 1)) as V;
        const hi = reachMax.map((v, i) => Math.min(source.shape[i] - 1, Math.floor(v / Q))) as V;
        for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
          if (!spend()) return finish('incomplete', 'budget', null);
          const i = x + width * (y + height * z); if (moved.has(i)) continue;
          const origin = positions.get(i) ?? i; if (solid(at(origin).packed)) candidates.push(cell(origin, i));
        }
        const carried = carry ? carry(pass, body, positions, spend, at) : pass.index === 0 && fragments.length ? [0, Q, 0] as V : [0, 0, 0] as V;
        if (carried === null) return finish('incomplete', 'budget', null);
        let offset: V = [...body.minQ], velocity: V = carried, time: F = {...ZERO};
        while (cmp(time, ONE) < 0) {
          let earliest: F | null = null; let hits: Hit[] = [];
          for (const c of candidates) {
            if (!spend()) return finish('incomplete', 'budget', null);
            const h = hit(offset, velocity, body.sizeQ, c, time); if (!h) continue;
            if (!earliest || cmp(h.time, earliest) < 0) {earliest = h.time; hits = [h];} else if (cmp(h.time, earliest) === 0) hits.push(h);
          }
          if (!earliest) break;
          if (events === limit.events) return finish('incomplete', 'budget', null); events++;
          hits.sort(hitOrder);
          for (const h of hits) if (!add(h, pass.index)) return finish('incomplete', 'budget', null);
          if (hits.some(h => h.axis < 0)) return finish('embedded', 'pass-overlap', pass.index);
          tracePart(pass.index, time, earliest, offset, velocity);
          time = earliest; if (cmp(time, ONE) === 0) break;
          const constraints = hits.slice();
          for (const c of candidates) {if (!spend()) return finish('incomplete', 'budget', null); constraints.push(...touches(offset, velocity, body.sizeQ, c, time));}
          constraints.sort(hitOrder);
          let changed = false;
          for (let axis = 0; axis < 3; axis++) {
            let low: Hit | null = null, high: Hit | null = null;
            for (const h of constraints) if (h.axis === axis) {
              if (h.sign > 0 && (!low || h.cell.velocity[axis] > low.cell.velocity[axis])) low = h;
              if (h.sign < 0 && (!high || h.cell.velocity[axis] < high.cell.velocity[axis])) high = h;
            }
            const lower = low?.cell.velocity[axis] ?? -Q, upper = high?.cell.velocity[axis] ?? Q;
            if (lower > upper) {
              if (!add(low!, pass.index) || !add(high!, pass.index)) return finish('incomplete', 'budget', null);
              crush = {axis, lowerVelocityQ: lower, upperVelocityQ: upper}; return finish('crushed', 'opposed-constraints', pass.index);
            }
            const next = Math.max(lower, Math.min(upper, velocity[axis]));
            if (next !== velocity[axis]) {
              const boundary = next > velocity[axis] ? low! : high!;
              if (!add(boundary, pass.index)) return finish('incomplete', 'budget', null);
              // Matching the face makes this intercept integral and preserves continuity.
              offset[axis] = boundary.sign > 0 ? boundary.cell.max[axis] : boundary.cell.min[axis] - body.sizeQ[axis]; velocity[axis] = next; changed = true;
            }
          }
          if (!changed) throw Error('Displacement contact failed to advance or constrain motion.');
        }
        tracePart(pass.index, time, ONE, offset, velocity);
        body.minQ = offset.map((v, i) => v + velocity[i]) as V;
        for (const s of relocations) {
          if (!spend()) return finish('incomplete', 'budget', null);
          const c = cell(s.origin, s.to), b = box(body);
          if (b.minQ.every((v, i) => v < c.max[i] && b.maxQ[i] > c.min[i])) {
            c.from = s.from; c.to = s.to;
            if (!add({cell: c, time: {...ONE}, axis: -1, sign: 0}, pass.index)) return finish('incomplete', 'budget', null);
            return finish('embedded', 'relocation-overlap', pass.index);
          }
        }
        for (const {origin, to} of pass.segments) {if (origin === to) positions.delete(to); else positions.set(to, origin);}
        if (pass.changes) {
          for (const change of pass.changes) {
            if (!spend()) return finish('incomplete', 'budget', null);
            updated.set(positions.get(change.index) ?? change.index, {packed: change.packed, energyQ: change.energyQ, structure: change.structure});
          }
          // Material changes occur at this boundary, before any later motion can clear an overlap.
          const lo = body.minQ.map(v => Math.max(0, Math.floor(v / Q)));
          const hi = body.minQ.map((v, i) => Math.min(source.shape[i] - 1, Math.ceil((v + body.sizeQ[i]) / Q) - 1));
          for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
            if (!spend()) return finish('incomplete', 'budget', null);
            const i = x + width * (y + height * z), origin = positions.get(i) ?? i;
            if (solid(at(origin).packed)) {
              if (!add({cell: cell(origin, i), time: {...ONE}, axis: -1, sign: 0}, pass.index)) return finish('incomplete', 'budget', null);
              return finish('embedded', 'phase-overlap', pass.index);
            }
          }
        }
      }
      const final = after.fit({box: box(body)});
      if (!final.fits) return finish(final.outside ? 'outside' : 'embedded', final.outside ? 'initial-outside' : 'phase-overlap', observed.lastPass);
      return finish('resolved', null, observed.lastPass);
    },
  });
}
