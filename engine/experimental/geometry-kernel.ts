/** Shared fixed-point queries over already validated, privately owned cells. */
import { PHASE, PHASE_SHIFT } from '../generated/materials.js';

export const GEOMETRY_SCALE_3D = 1024;
export const GEOMETRY_LIMITS_3D = Object.freeze({coordinateQ: 524288, cells: 65536});
export const EXPOSURE_RULES_VERSION_3D = 'terrain-exposure-1';
export type GeometryVector3D = readonly [number, number, number];
export type GeometryBox3D = {minQ: GeometryVector3D; maxQ: GeometryVector3D};
export type GeometryTime3D = {numerator: number; denominator: number};
export type GeometryCell3D = {index: number; coordinate: GeometryVector3D; material: number; energyQ: number; structure: number};
export type GeometryContact3D = {time: GeometryTime3D; normal: GeometryVector3D; boundary: boolean; cell: GeometryCell3D | null; startedOverlapping: boolean};
export type GeometryFilter3D = {materials?: readonly number[]};
export type MaterialExposure3D = {
  material: number; cells: number; volumeQ3: string; minTemperatureQ: number; maxTemperatureQ: number;
  /** Exact volume-weighted temperature ratio; decimal integers, not floating means. */
  meanTemperatureQ: {numerator: string; denominator: string};
  /** Maximum contiguous liquid height touching the feet, limited to the queried box. */
  maxImmersionDepthQ: number;
};
export type KernelExposure3D<Stamp> = {
  rulesVersion: typeof EXPOSURE_RULES_VERSION_3D; stamp: Stamp;
  volumeQ3: string; inBoundsVolumeQ3: string; outsideVolumeQ3: string; materials: MaterialExposure3D[];
};
export interface GeometryKernel3D<Stamp> {
  readonly stamp: Stamp;
  fit(request: {box: GeometryBox3D} & GeometryFilter3D): {stamp: Stamp; fits: boolean; outside: boolean; blocker: GeometryCell3D | null};
  sweep(request: {box: GeometryBox3D; deltaQ: GeometryVector3D} & GeometryFilter3D): {stamp: Stamp; contact: GeometryContact3D | null};
  raycast(request: {fromQ: GeometryVector3D; toQ: GeometryVector3D} & GeometryFilter3D): {stamp: Stamp; contact: GeometryContact3D | null};
  exposure(request: {box: GeometryBox3D}): KernelExposure3D<Stamp>;
  support(request: {box: GeometryBox3D; maxDropQ: number} & GeometryFilter3D): {
    stamp: Stamp; bodyFits: boolean; distanceQ: number | null;
    surfaces: {cell: GeometryCell3D | null; boundary: boolean; areaQ2: number}[];
  };
}
type V = [number, number, number];
type Fraction = {n: number; d: number};
type Budget = {cells: number};
const ZERO = {n: 0, d: 1}, ONE = {n: 1, d: 1}, S = GEOMETRY_SCALE_3D;
function fields(value: object, required: string[], optional: string[] = []): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || required.some(k => !Object.hasOwn(value, k)) ||
      Reflect.ownKeys(value).some(k => typeof k !== 'string' || ![...required, ...optional].includes(k)) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d) || !d.enumerable)) throw Error('Invalid geometry query fields.');
}
function dense<T>(value: readonly T[], max: number): T[] {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) throw Error('Invalid geometry array.');
  const copy: T[] = [];
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !('value' in d) || !d.enumerable) throw Error('Geometry arrays must contain dense data.');
    copy.push(d.value);
  }
  return copy;
}
function vector(value: GeometryVector3D): V {
  const copy = dense(value, 3);
  if (copy.length !== 3 || copy.some(n => !Number.isSafeInteger(n) || Math.abs(n) > GEOMETRY_LIMITS_3D.coordinateQ)) throw Error('Invalid fixed-point coordinate.');
  return copy.map(v => v === 0 ? 0 : v) as V;
}
function box(value: GeometryBox3D): {minQ: V; maxQ: V} {
  fields(value, ['minQ', 'maxQ']); const minQ = vector(value.minQ), maxQ = vector(value.maxQ);
  if (minQ.some((v, i) => v >= maxQ[i])) throw Error('A body must have positive volume.');
  return {minQ, maxQ};
}
function filter(supported: ReadonlySet<number>, materials?: readonly number[]): (v: number) => boolean {
  if (materials === undefined) return v => {const phase = (v >>> PHASE_SHIFT) & 15; return phase === PHASE.SOLID || phase === PHASE.FROZEN || phase === PHASE.POWDER;};
  const copy = dense(materials, supported.size), ids = new Set<number>();
  for (const id of copy) {if (!Number.isInteger(id) || !supported.has(id) || ids.has(id)) throw Error('Invalid geometry material filter.'); ids.add(id);}
  return v => ids.has(v & 255);
}
function fraction(n: number, d: number): Fraction {return n === 0 ? ZERO : d < 0 ? {n: -n, d: -d} : {n, d};}
// Bounded inputs keep these integer products below 2^42, hence exact in JS.
function compare(a: Fraction, b: Fraction): number {return a.n * b.d - b.n * a.d;}
function time(t: Fraction): GeometryTime3D {
  let a = Math.abs(t.n), b = t.d; while (b) {[a, b] = [b, a % b];}
  return {numerator: t.n / a, denominator: t.d / a};
}
function normal(axis: number, sign: number): V {const v: V = [0, 0, 0]; v[axis] = sign; return v;}

/** Internal: the adapter owns validation, copying, identity and branding. */
export function createGeometryKernel3D<Stamp>(input: {
  state: {grid: ArrayLike<number>; energyQ: ArrayLike<number>; structure: ArrayLike<number>}; shape: V;
  supported: ReadonlySet<number>; temperature: (packed: number, energyQ: number) => number;
}, stamp: Stamp): GeometryKernel3D<Stamp> {
  const {state, shape, supported, temperature} = input;
  const extent: V = [shape[0] * S, shape[1] * S, shape[2] * S];
  const index = (p: V) => p[0] + shape[0] * (p[1] + shape[1] * p[2]);
  const cell = (p: V): GeometryCell3D => {const i = index(p); return {index: i, coordinate: p.slice() as V, material: state.grid[i] & 255, energyQ: state.energyQ[i], structure: state.structure[i]};};
  const outside = (b: {minQ: V; maxQ: V}) => b.minQ.some((v, i) => v < 0 || b.maxQ[i] > extent[i]);
  const visit = (min: V, max: V, budget: Budget, callback: (p: V) => boolean | void) => {
    const lo = min.map((v, i) => Math.max(0, Math.min(shape[i], v))) as V;
    const hi = max.map((v, i) => Math.max(-1, Math.min(shape[i] - 1, v))) as V;
    const count = lo.reduce((n, v, i) => n * Math.max(0, hi[i] - v + 1), 1);
    if (budget.cells + count > GEOMETRY_LIMITS_3D.cells) throw Error('Geometry query exceeds its cell budget.'); budget.cells += count;
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) if (callback([x, y, z]) === false) return;
  };
  const fit = (b: {minQ: V; maxQ: V}, blocks: (v: number) => boolean, budget: Budget) => {
    if (outside(b)) return {fits: false, outside: true, blocker: null};
    let blocker: GeometryCell3D | null = null;
    visit(b.minQ.map(v => Math.floor(v / S)) as V, b.maxQ.map(v => Math.ceil(v / S) - 1) as V, budget, p => {
      if (blocks(state.grid[index(p)])) {blocker = cell(p); return false;}
    });
    return {fits: blocker === null, outside: false, blocker};
  };
  const contact = (t: Fraction, n: V, c: GeometryCell3D | null, overlap = false): GeometryContact3D => ({time: time(t), normal: n, cell: c, boundary: c === null, startedOverlapping: overlap});

  const view = Object.freeze<GeometryKernel3D<Stamp>>({
    stamp,
    fit(request) {
      fields(request, ['box'], ['materials']); const b = box(request.box), blocks = filter(supported, request.materials);
      return {stamp, ...fit(b, blocks, {cells: 0})};
    },
    exposure(request) {
      fields(request, ['box']); const b = box(request.box);
      type Accumulated = {material: number; cells: number; volume: bigint; temperatureVolume: bigint; min: number; max: number; depth: number};
      const byMaterial = new Map<number, Accumulated>(), columns = new Map<number, {material: number; height: number; liquid: boolean}>();
      let inside = 0n;
      visit(b.minQ.map(v => Math.floor(v / S)) as V, b.maxQ.map(v => Math.ceil(v / S) - 1) as V, {cells: 0}, p => {
        const i = index(p), packed = state.grid[i], material = packed & 255, phase = (packed >>> PHASE_SHIFT) & 15;
        const length = (axis: number) => Math.min(b.maxQ[axis], (p[axis] + 1) * S) - Math.max(b.minQ[axis], p[axis] * S);
        const height = length(1), volume = BigInt(length(0)) * BigInt(height) * BigInt(length(2));
        const temp = temperature(packed, state.energyQ[i]); inside += volume;
        let item = byMaterial.get(material);
        if (!item) {item = {material, cells: 0, volume: 0n, temperatureVolume: 0n, min: temp, max: temp, depth: 0}; byMaterial.set(material, item);}
        item.cells++; item.volume += volume; item.temperatureVolume += BigInt(temp) * volume; item.min = Math.min(item.min, temp); item.max = Math.max(item.max, temp);
        // visit orders Y increasingly within each Z; every footprint column is continuous.
        const key = p[0] + shape[0] * p[2], previous = columns.get(key);
        const liquid = phase === PHASE.LIQUID || phase === PHASE.VISCOUS || phase === PHASE.MOLTEN;
        if (previous?.material === material) previous.height += height;
        else columns.set(key, {material, height, liquid});
      });
      if (b.maxQ[1] > 0 && b.maxQ[1] <= extent[1]) for (const column of columns.values()) if (column.liquid) {
        const item = byMaterial.get(column.material)!; item.depth = Math.max(item.depth, column.height);
      }
      const volume = BigInt(b.maxQ[0] - b.minQ[0]) * BigInt(b.maxQ[1] - b.minQ[1]) * BigInt(b.maxQ[2] - b.minQ[2]);
      return {rulesVersion: EXPOSURE_RULES_VERSION_3D, stamp, volumeQ3: volume.toString(), inBoundsVolumeQ3: inside.toString(), outsideVolumeQ3: (volume - inside).toString(),
        materials: [...byMaterial.values()].sort((a, b) => a.material - b.material).map(item => ({material: item.material, cells: item.cells, volumeQ3: item.volume.toString(),
          minTemperatureQ: item.min, maxTemperatureQ: item.max, meanTemperatureQ: {numerator: item.temperatureVolume.toString(), denominator: item.volume.toString()}, maxImmersionDepthQ: item.depth}))};
    },
    sweep(request) {
      fields(request, ['box', 'deltaQ'], ['materials']);
      const b = box(request.box), delta = vector(request.deltaQ), blocks = filter(supported, request.materials), budget = {cells: 0};
      const start = fit(b, blocks, budget);
      if (!start.fits) return {stamp, contact: contact(ZERO, [0, 0, 0], start.blocker, true)};
      if (delta.every(v => v === 0)) return {stamp, contact: null};
      let earliest: Fraction | null = null, hit: GeometryContact3D | null = null;
      const offer = (t: Fraction, n: V, c: GeometryCell3D | null) => {
        if (compare(t, ZERO) < 0 || compare(t, ONE) > 0 || (earliest && compare(t, earliest) >= 0)) return;
        earliest = t; hit = contact(t, n, c);
      };
      // Boundary ties precede cell ties; axis and cell ties use X/Y/Z and x-major order.
      for (let axis = 0; axis < 3; axis++) {
        if (delta[axis] > 0 && b.maxQ[axis] + delta[axis] >= extent[axis]) offer(fraction(extent[axis] - b.maxQ[axis], delta[axis]), normal(axis, -1), null);
        if (delta[axis] < 0 && b.minQ[axis] + delta[axis] <= 0) offer(fraction(b.minQ[axis], -delta[axis]), normal(axis, 1), null);
      }
      const low = b.minQ.map((v, i) => Math.floor(Math.min(v, v + delta[i]) / S) - 1) as V;
      const high = b.maxQ.map((v, i) => Math.floor(Math.max(v, v + delta[i]) / S)) as V;
      visit(low, high, budget, p => {
        if (!blocks(state.grid[index(p)])) return;
        let enter = ZERO, exit: Fraction | null = null, n: V = [0, 0, 0];
        for (let axis = 0; axis < 3; axis++) {
          const lo = p[axis] * S, hi = lo + S, d = delta[axis];
          if (d === 0) {if (b.maxQ[axis] <= lo || b.minQ[axis] >= hi) return; continue;}
          const near = d > 0 ? fraction(lo - b.maxQ[axis], d) : fraction(b.minQ[axis] - hi, -d);
          const far = d > 0 ? fraction(hi - b.minQ[axis], d) : fraction(b.maxQ[axis] - lo, -d);
          const order = compare(near, enter);
          if (order > 0 || (order === 0 && n.every(v => v === 0))) {enter = near; n = normal(axis, d > 0 ? -1 : 1);}
          if (!exit || compare(far, exit) < 0) exit = far;
        }
        if (!exit || compare(exit, ZERO) <= 0 || compare(enter, exit) >= 0) return;
        offer(enter, n, cell(p));
      });
      return {stamp, contact: hit};
    },
    raycast(request) {
      fields(request, ['fromQ', 'toQ'], ['materials']);
      const from = vector(request.fromQ), to = vector(request.toQ), delta = to.map((v, i) => v - from[i]) as V, blocks = filter(supported, request.materials);
      let enter = ZERO, exit = ONE;
      for (let axis = 0; axis < 3; axis++) {
        const d = delta[axis];
        if (d === 0) {if (from[axis] < 0 || from[axis] >= extent[axis]) return {stamp, contact: null}; continue;}
        const near = d > 0 ? fraction(-from[axis], d) : fraction(from[axis] - extent[axis], -d);
        const far = d > 0 ? fraction(extent[axis] - from[axis], d) : fraction(from[axis], -d);
        if (compare(near, enter) > 0) enter = near;
        if (compare(far, exit) < 0) exit = far;
      }
      if (compare(enter, exit) > 0 || compare(enter, ONE) > 0 || compare(exit, ZERO) < 0) return {stamp, contact: null};
      const p = from.map((v, i) => {
        const numerator = v * enter.d + delta[i] * enter.n, denominator = enter.d * S;
        return Math.floor(numerator / denominator) - Number(delta[i] < 0 && numerator % denominator === 0);
      }) as V;
      // Recompute the first face at the clipped starting point: an internal
      // grid plane can tie a world-entry face. All such ties choose X/Y/Z.
      // Parallel/point rays retain half-open ownership, with no entry normal.
      let n: V = [0, 0, 0];
      for (let axis = 0; axis < 3; axis++) {
        const numerator = from[axis] * enter.d + delta[axis] * enter.n;
        if (delta[axis] !== 0 && numerator % (enter.d * S) === 0) {n = normal(axis, -Math.sign(delta[axis])); break;}
      }
      let t = enter;
      for (let visited = 0; visited < GEOMETRY_LIMITS_3D.cells; visited++) {
        if (p.some((v, i) => v < 0 || v >= shape[i])) return {stamp, contact: null};
        if (blocks(state.grid[index(p)])) return {stamp, contact: contact(t, n, cell(p), compare(t, ZERO) === 0 && n.every(v => v === 0))};
        const times = delta.map((d, i) => d === 0 ? null : fraction((p[i] + Number(d > 0)) * S - from[i], d));
        let next: Fraction | null = null;
        for (const value of times) if (value && (!next || compare(value, next) < 0)) next = value;
        if (!next || compare(next, exit) > 0) return {stamp, contact: null};
        n = [0, 0, 0];
        for (let axis = 0; axis < 3; axis++) if (times[axis] && compare(times[axis]!, next) === 0) {
          const sign = Math.sign(delta[axis]); p[axis] += sign; if (n.every(v => v === 0)) n = normal(axis, -sign);
        }
        t = next;
      }
      throw Error('Ray query exceeds its cell budget.');
    },
    support(request) {
      fields(request, ['box', 'maxDropQ'], ['materials']);
      const b = box(request.box), blocks = filter(supported, request.materials), budget = {cells: 0}, drop = request.maxDropQ;
      if (!Number.isSafeInteger(drop) || drop < 0 || drop > GEOMETRY_LIMITS_3D.coordinateQ) throw Error('Invalid support search distance.');
      if (!fit(b, blocks, budget).fits) return {stamp, bodyFits: false, distanceQ: null, surfaces: []};
      let nearest: number | null = extent[1] - b.maxQ[1] <= drop ? extent[1] - b.maxQ[1] : null;
      let surfaces: {cell: GeometryCell3D | null; boundary: boolean; areaQ2: number}[] = nearest === null ? [] : [{cell: null, boundary: true, areaQ2: (b.maxQ[0] - b.minQ[0]) * (b.maxQ[2] - b.minQ[2])}];
      visit([Math.floor(b.minQ[0] / S), Math.ceil(b.maxQ[1] / S), Math.floor(b.minQ[2] / S)],
        [Math.ceil(b.maxQ[0] / S) - 1, Math.floor((b.maxQ[1] + drop) / S), Math.ceil(b.maxQ[2] / S) - 1], budget, p => {
          const gap = p[1] * S - b.maxQ[1]; if (!blocks(state.grid[index(p)]) || gap < 0 || gap > drop || (nearest !== null && gap > nearest)) return;
          const overlap = (axis: number) => Math.max(0, Math.min(b.maxQ[axis], (p[axis] + 1) * S) - Math.max(b.minQ[axis], p[axis] * S));
          const surface = {cell: cell(p), boundary: false, areaQ2: overlap(0) * overlap(2)};
          if (nearest === null || gap < nearest) {nearest = gap; surfaces = [surface];} else surfaces.push(surface);
        });
      return {stamp, bodyFits: true, distanceQ: nearest, surfaces};
    },
  });
  return view;
}
