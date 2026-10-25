/** One-way body reconciliation from observed material paths; no physical stepping. */
import { PHASE, PHASE_SHIFT } from '../../generated/materials.js';
import {
  gameplayGeometrySource3D,
  GEOMETRY_SCALE_3D as Q,
  GEOMETRY_LIMITS_3D,
  type GameplayGeometry3D,
  type GeometryBox3D,
  type GeometryStamp3D,
  type GeometryTime3D,
} from '../gameplay/gameplay-geometry.js';
import { tickMovementSource3D, type TickMovement3D } from '../gameplay/path-journal.js';
import { readTerrainBody3D, type TerrainBodyState3D, type BodySupport3D } from './terrain-body.js';
import type { MotionPathSegment3D } from '../gameplay/motion-paths.js';

export const TERRAIN_MOTION_RULES_3D = 'terrain-body-motion-1';
export const TERRAIN_MOTION_LIMITS_3D = Object.freeze({
  defaultContacts: 256,
  contacts: 4096,
  cells: 65536,
});
type V = [number, number, number];
type Fraction = { numerator: number; denominator: number };
export type TerrainMotionContact3D = {
  kind: 'linear' | 'relocation' | 'stationary' | 'phase-overlap';
  pass: number | null;
  time: GeometryTime3D;
  normal: V;
  origin: number;
  from: number;
  to: number;
  fragment: number | null;
  material: number;
  energyQ: number;
};
export type TerrainMotionOptions3D = { maxContacts?: number };
export type TerrainMotionResolution3D = {
  rulesVersion: typeof TERRAIN_MOTION_RULES_3D;
  from: Readonly<GeometryStamp3D>;
  to: Readonly<GeometryStamp3D>;
  status: 'resolved' | 'blocked' | 'embedded' | 'outside' | 'incomplete';
  coverage: 'complete' | 'through-contact' | 'unavailable';
  throughPass: number | null;
  requiresReexecution: boolean;
  body: TerrainBodyState3D;
  proposedCarryQ: V;
  carriedQ: V;
  supportFragments: number[];
  contacts: TerrainMotionContact3D[];
  lostFooting: boolean;
  landed: boolean;
  supportBefore: BodySupport3D;
  supportAfter: BodySupport3D;
  fitsAfter: boolean;
  exposure: ReturnType<GameplayGeometry3D['exposure']>;
};
export interface TerrainMotion3D {
  readonly rulesVersion: typeof TERRAIN_MOTION_RULES_3D;
  readonly from: Readonly<GeometryStamp3D>;
  readonly to: Readonly<GeometryStamp3D>;
  reconcile(body: TerrainBodyState3D, options?: TerrainMotionOptions3D): TerrainMotionResolution3D;
}
const ZERO: Fraction = { numerator: 0, denominator: 1 },
  ONE: Fraction = { numerator: 1, denominator: 1 };
const compare = (a: Fraction, b: Fraction) =>
  a.numerator * b.denominator - b.numerator * a.denominator;
function reduce(t: Fraction): Fraction {
  let a = Math.abs(t.numerator),
    b = t.denominator;
  while (b) {
    [a, b] = [b, a % b];
  }
  return { numerator: t.numerator / a, denominator: t.denominator / a };
}
function blocks(packed: number): boolean {
  const phase = (packed >>> PHASE_SHIFT) & 15;
  return phase === PHASE.SOLID || phase === PHASE.FROZEN || phase === PHASE.POWDER;
}
function bodyBox(body: TerrainBodyState3D): GeometryBox3D {
  return { minQ: [...body.minQ], maxQ: body.minQ.map((v, i) => v + body.sizeQ[i]) as V };
}
function intersects(a: GeometryBox3D, b: GeometryBox3D): boolean {
  return a.minQ.every((v, i) => v < b.maxQ[i] && a.maxQ[i] > b.minQ[i]);
}
/** The relative sweep keeps cells fixed and translates the body. Axis ties X/Y/Z. */
function sweep(
  body: GeometryBox3D,
  delta: V,
  cell: GeometryBox3D,
): { time: Fraction; normal: V } | null {
  let enter = ZERO,
    exit: Fraction | null = null,
    normal: V = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    const d = delta[axis];
    if (!d) {
      if (body.maxQ[axis] <= cell.minQ[axis] || body.minQ[axis] >= cell.maxQ[axis]) return null;
      continue;
    }
    const near = {
      numerator: d > 0 ? cell.minQ[axis] - body.maxQ[axis] : body.minQ[axis] - cell.maxQ[axis],
      denominator: Math.abs(d),
    };
    const far = {
      numerator: d > 0 ? cell.maxQ[axis] - body.minQ[axis] : body.maxQ[axis] - cell.minQ[axis],
      denominator: Math.abs(d),
    };
    const order = compare(near, enter);
    if (order > 0 || (order === 0 && normal.every((n) => n === 0))) {
      enter = near;
      normal = [0, 0, 0];
      normal[axis] = d > 0 ? -1 : 1;
    }
    if (!exit || compare(far, exit) < 0) exit = far;
  }
  if (!exit) return intersects(body, cell) ? { time: { ...ZERO }, normal } : null;
  if (compare(exit, ZERO) <= 0 || compare(enter, exit) >= 0 || compare(enter, ONE) > 0) return null;
  return { time: reduce(enter), normal };
}
function contactLimit(options: TerrainMotionOptions3D): number {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some((k) => k !== 'maxContacts') ||
    Object.values(Object.getOwnPropertyDescriptors(options)).some(
      (d) => !('value' in d) || !d.enumerable,
    )
  )
    throw Error('Invalid terrain motion options.');
  const n =
    Object.hasOwn(options, 'maxContacts') && options.maxContacts !== undefined
      ? options.maxContacts
      : TERRAIN_MOTION_LIMITS_3D.defaultContacts;
  if (!Number.isSafeInteger(n) || n < 0 || n > TERRAIN_MOTION_LIMITS_3D.contacts)
    throw Error('Invalid terrain motion contact budget.');
  return n;
}

/**
 * Use the three accessors from the same reduceTick callback. Public observation
 * fields are reports; this context uses the coordinator's private validated data.
 * Cloned observations cannot reconstruct that provenance. Recreate after restart.
 */
export function createTerrainMotion3D(
  before: GameplayGeometry3D,
  after: GameplayGeometry3D,
  movement: TickMovement3D,
): TerrainMotion3D {
  const source = gameplayGeometrySource3D(before),
    target = gameplayGeometrySource3D(after),
    observed = tickMovementSource3D(movement);
  if (
    source.token !== observed.before ||
    target.token !== observed.after ||
    JSON.stringify(before.stamp) !== JSON.stringify(observed.from) ||
    JSON.stringify(after.stamp) !== JSON.stringify(observed.to)
  )
    throw Error('Terrain motion geometry differs from its observed boundaries.');
  const { frame } = observed,
    complete = !!frame && frame.motion.status === 'complete' && frame.paths.status === 'complete';
  const [width, height] = source.shape;
  const coordinate = (i: number): V => [
    i % width,
    Math.floor(i / width) % height,
    Math.floor(i / (width * height)),
  ];
  const cellBox = (i: number): GeometryBox3D => {
    const p = coordinate(i).map((v) => v * Q) as V;
    return { minQ: p, maxQ: p.map((v) => v + Q) as V };
  };
  const delta = (s: MotionPathSegment3D): V => {
    const a = coordinate(s.from),
      b = coordinate(s.to);
    return b.map((v, i) => (v - a[i]) * Q) as V;
  };
  const members = new Map<number, number>();
  if (complete)
    for (const fragment of frame.motion.fragments)
      for (const [start, length] of fragment.sourceRuns)
        for (let i = start; i < start + length; i++) members.set(i, fragment.id);
  // A single reusable context does not revalidate/copy whole worlds for each actor.
  const originCells = new Map<number, ReturnType<typeof source.at>>();
  if (complete)
    for (const pass of frame.paths.passes)
      for (const s of pass.segments)
        if (!originCells.has(s.origin)) originCells.set(s.origin, source.at(s.origin));
  const makeContact = (
    s: MotionPathSegment3D,
    pass: number,
    kind: TerrainMotionContact3D['kind'],
    hit: { time: Fraction; normal: V },
  ): TerrainMotionContact3D => {
    const cell = originCells.get(s.origin) ?? source.at(s.origin);
    return {
      kind,
      pass,
      ...hit,
      origin: s.origin,
      from: s.from,
      to: s.to,
      fragment: members.get(s.origin) ?? null,
      material: cell.packed & 255,
      energyQ: cell.energyQ,
    };
  };
  return Object.freeze<TerrainMotion3D>({
    rulesVersion: TERRAIN_MOTION_RULES_3D,
    from: observed.from,
    to: observed.to,
    reconcile(input, options = {}) {
      const maximum = contactLimit(options),
        original = readTerrainBody3D(before, input),
        body = readTerrainBody3D(after, original),
        initialBox = bodyBox(body);
      const supportBefore = before.support({ box: initialBox, maxDropQ: 0 });
      let contacts: TerrainMotionContact3D[] = [],
        proposed: V = [0, 0, 0],
        supportFragments: number[] = [];
      const finish = (
        status: TerrainMotionResolution3D['status'],
        throughPass: number | null,
      ): TerrainMotionResolution3D => {
        const resolved = status === 'resolved',
          output = resolved ? body : original,
          box = bodyBox(output),
          supportAfter = after.support({ box, maxDropQ: 0 });
        const grounded = supportAfter.bodyFits && supportAfter.distanceQ === 0;
        if (resolved) output.grounded = grounded;
        return {
          rulesVersion: TERRAIN_MOTION_RULES_3D,
          from: observed.from,
          to: observed.to,
          status,
          coverage:
            status === 'incomplete' ||
            status === 'outside' ||
            (status === 'embedded' && throughPass === null)
              ? 'unavailable'
              : status === 'resolved' || throughPass === 27
                ? 'complete'
                : 'through-contact',
          throughPass,
          requiresReexecution: status === 'incomplete',
          body: output,
          proposedCarryQ: [...proposed],
          carriedQ: resolved ? [...proposed] : [0, 0, 0],
          supportFragments: [...supportFragments],
          contacts: status === 'incomplete' ? [] : contacts,
          lostFooting:
            resolved && original.grounded && (!grounded || supportBefore.distanceQ !== 0),
          landed: resolved && grounded && (!original.grounded || supportBefore.distanceQ !== 0),
          supportBefore,
          supportAfter,
          fitsAfter: supportAfter.bodyFits,
          exposure: after.exposure({ box }),
        };
      };
      if (!complete) return finish('incomplete', null);
      const fit = before.fit({ box: initialBox });
      if (!fit.fits) return finish(fit.outside ? 'outside' : 'embedded', null);
      const structural = frame.paths.passes.find((p) => p.index === 0);
      if (
        original.grounded &&
        supportBefore.distanceQ === 0 &&
        supportBefore.surfaces.length &&
        supportBefore.surfaces.every((s) => s.cell && members.has(s.cell.index))
      ) {
        proposed = [0, Q, 0];
        supportFragments = [
          ...new Set(supportBefore.surfaces.map((s) => members.get(s.cell!.index)!)),
        ].sort((a, b) => a - b);
      }
      if (proposed[1] && !structural) throw Error('Moving supports have no structural path.');
      const add = (contact: TerrainMotionContact3D) => {
        if (contacts.length === maximum) return false;
        contacts.push(contact);
        return true;
      };
      for (const pass of frame.paths.passes) {
        const carry: V = pass.index === 0 ? proposed : [0, 0, 0],
          box = bodyBox(body),
          nextBox: GeometryBox3D = {
            minQ: box.minQ.map((v, i) => v + carry[i]) as V,
            maxQ: box.maxQ.map((v, i) => v + carry[i]) as V,
          };
        let blocking = false;
        const passStart = contacts.length;
        // Only structural carry moves the body here; other actor movement uses stepTerrainBody3D.
        if (carry.some((v) => v !== 0)) {
          const moved = new Set(pass.segments.map((s) => s.from));
          const lo = box.minQ.map((v, i) =>
            Math.max(0, Math.floor(Math.min(v, nextBox.minQ[i]) / Q) - 1),
          ) as V;
          const hi = box.maxQ.map((v, i) =>
            Math.min(source.shape[i] - 1, Math.floor(Math.max(v, nextBox.maxQ[i]) / Q)),
          ) as V;
          const visits = lo.reduce((n, v, i) => n * Math.max(0, hi[i] - v + 1), 1);
          if (visits > TERRAIN_MOTION_LIMITS_3D.cells || visits > GEOMETRY_LIMITS_3D.cells)
            return finish('incomplete', null);
          for (let z = lo[2]; z <= hi[2]; z++)
            for (let y = lo[1]; y <= hi[1]; y++)
              for (let x = lo[0]; x <= hi[0]; x++) {
                const index = x + width * (y + height * z);
                if (moved.has(index) || !blocks(source.at(index).packed)) continue;
                const hit = sweep(box, carry, cellBox(index));
                if (!hit) continue;
                if (
                  !add(
                    makeContact(
                      { origin: index, from: index, to: index, mode: 'linear' },
                      pass.index,
                      'stationary',
                      hit,
                    ),
                  )
                )
                  return finish('incomplete', null);
                blocking ||= compare(hit.time, ONE) < 0;
              }
        }
        for (const s of pass.segments) {
          if (!blocks(originCells.get(s.origin)!.packed)) continue;
          if (s.mode === 'relocation') {
            if (!intersects(nextBox, cellBox(s.to))) continue;
            if (
              !add(
                makeContact(s, pass.index, 'relocation', { time: { ...ONE }, normal: [0, 0, 0] }),
              )
            )
              return finish('incomplete', null);
            blocking = true;
          } else {
            const cellDelta = delta(s),
              hit = sweep(box, carry.map((v, i) => v - cellDelta[i]) as V, cellBox(s.from));
            if (!hit) continue;
            if (!add(makeContact(s, pass.index, 'linear', hit))) return finish('incomplete', null);
            blocking ||= compare(hit.time, ONE) < 0;
          }
        }
        const order = contacts
          .slice(passStart)
          .sort(
            (a, b) =>
              compare(a.time, b.time) || a.origin - b.origin || a.from - b.from || a.to - b.to,
          );
        contacts.splice(passStart, order.length, ...order);
        if (blocking) return finish('blocked', pass.index);
        body.minQ = nextBox.minQ.slice() as V;
      }
      const finalFit = after.fit({ box: bodyBox(body) });
      if (!finalFit.fits) {
        if (finalFit.blocker) {
          const cell = finalFit.blocker;
          if (
            !add({
              kind: 'phase-overlap',
              pass: null,
              time: { ...ONE },
              normal: [0, 0, 0],
              origin: cell.index,
              from: cell.index,
              to: cell.index,
              fragment: null,
              material: cell.material,
              energyQ: cell.energyQ,
            })
          )
            return finish('incomplete', null);
        }
        return finish(finalFit.outside ? 'outside' : 'embedded', 27);
      }
      return finish('resolved', 27);
    },
  });
}
