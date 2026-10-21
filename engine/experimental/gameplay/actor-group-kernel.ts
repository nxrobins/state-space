/** Exact peer intersections over privately recorded piecewise body trajectories. */
import { displacementTrace3D, type DisplacementTraceSegment3D } from './displacement-kernel.js';
import type { KinematicBody3D } from './body-kernel.js';
import type { GeometryKernel3D, GeometryTime3D } from './geometry-kernel.js';
import {
  BODY_GROUP_LIMITS_3D,
  type NamedBody3D,
  type GroupBodyResponse3D,
  type BodyGroupOptions3D,
  type BodyGroupResult3D,
  type BodyGroupKernel3D,
} from './body-group-kernel.js';
type V = [number, number, number];
type F = GeometryTime3D;
export type ActorPeerContact3D = {
  first: string;
  second: string;
  kind: 'initial-overlap' | 'swept-overlap';
  pass: number | null;
  time: F;
  normal: V;
};
export type ActorGroupResult3D<
  R extends string,
  S,
  B extends KinematicBody3D,
  T extends GroupBodyResponse3D<B>,
  C extends string,
> = BodyGroupResult3D<R, S, B, T, C> & {
  reason: 'terrain-response' | 'peer-contact' | 'peer-budget' | null;
  peerContact: ActorPeerContact3D | null;
  peerWork: number;
};
export interface ActorGroupKernel3D<
  R extends string,
  S,
  B extends KinematicBody3D,
  T extends GroupBodyResponse3D<B>,
  C extends string,
> extends Omit<BodyGroupKernel3D<R, S, B, T, C>, 'resolve'> {
  resolve(
    bodies: readonly NamedBody3D<B>[],
    options?: BodyGroupOptions3D,
  ): ActorGroupResult3D<R, S, B, T, C>;
}
const cmp = (a: F, b: F) => {
  const delta =
    BigInt(a.numerator) * BigInt(b.denominator) - BigInt(b.numerator) * BigInt(a.denominator);
  return delta < 0n ? -1 : Number(delta > 0n);
};
function fraction(numerator: number, denominator: number): F {
  let a = Math.abs(numerator),
    b = denominator;
  while (b) {
    [a, b] = [b, a % b];
  }
  return { numerator: numerator / a, denominator: denominator / a };
}
function overlap<B extends KinematicBody3D>(a: NamedBody3D<B>, b: NamedBody3D<B>) {
  return a.body.minQ.every(
    (v, i) => v < b.body.minQ[i] + b.body.sizeQ[i] && v + a.body.sizeQ[i] > b.body.minQ[i],
  );
}
/** Strict positive interior overlap; tangential or end-only contact is allowed. */
function contact(a: DisplacementTraceSegment3D, b: DisplacementTraceSegment3D, sizeA: V, sizeB: V) {
  let start = cmp(a.start, b.start) >= 0 ? a.start : b.start,
    end = cmp(a.end, b.end) <= 0 ? a.end : b.end;
  if (cmp(start, end) >= 0) return null;
  let axis = -1,
    sign = 0;
  for (let i = 0; i < 3; i++) {
    const relative = a.velocityQ[i] - b.velocityQ[i],
      offset = a.offsetQ[i] - b.offsetQ[i];
    if (relative === 0) {
      if (offset + sizeA[i] <= 0 || offset >= sizeB[i]) return null;
      continue;
    }
    const near = fraction(
      relative > 0 ? -offset - sizeA[i] : offset - sizeB[i],
      Math.abs(relative),
    );
    const far = fraction(relative > 0 ? sizeB[i] - offset : offset + sizeA[i], Math.abs(relative));
    if (cmp(near, start) > 0 || (cmp(near, start) === 0 && axis < 0)) {
      start = near;
      axis = i;
      sign = relative > 0 ? -1 : 1;
    }
    if (cmp(far, end) < 0) end = far;
    if (cmp(start, end) >= 0) return null;
  }
  const normal: V = [0, 0, 0];
  if (axis >= 0) normal[axis] = sign;
  return { time: { ...start }, normal };
}
function earlier(a: ActorPeerContact3D, b: ActorPeerContact3D) {
  return (
    (a.pass ?? -1) - (b.pass ?? -1) ||
    cmp(a.time, b.time) ||
    (a.first < b.first ? -1 : Number(a.first > b.first)) ||
    (a.second < b.second ? -1 : Number(a.second > b.second))
  );
}
export function createActorGroupKernel3D<
  R extends string,
  S,
  B extends KinematicBody3D,
  T extends GroupBodyResponse3D<B>,
  C extends string,
>(
  before: GeometryKernel3D<S>,
  source: BodyGroupKernel3D<string, S, B, T, C>,
  rulesVersion: R,
  readBody: (view: GeometryKernel3D<S>, body: B) => B,
): ActorGroupKernel3D<R, S, B, T, C> {
  return Object.freeze({
    rulesVersion,
    scope: source.scope,
    from: source.from,
    to: source.to,
    resolve(
      input: readonly NamedBody3D<B>[],
      options: BodyGroupOptions3D = {},
    ): ActorGroupResult3D<R, S, B, T, C> {
      // The body group validates the entire request and budgets before doing
      // any work, and retains the unchanged individual terrain response rules.
      const terrain = source.resolve(input, options),
        base = { ...terrain, rulesVersion, peerWork: 0, peerContact: null } as ActorGroupResult3D<
          R,
          S,
          B,
          T,
          C
        >;
      if (terrain.status !== 'resolved') return { ...base, reason: 'terrain-response' };
      const original = input
        .map((row) => ({ id: row.id, body: readBody(before, row.body) }))
        .sort((a, b) => (a.id < b.id ? -1 : Number(a.id > b.id)));
      const traces = terrain.responses.map((row) => displacementTrace3D(row.response));
      const maxWork = options.maxWork ?? BODY_GROUP_LIMITS_3D.defaultWork;
      let peerWork = 0,
        earliest: ActorPeerContact3D | null = null;
      const spend = () => {
        if (terrain.work + peerWork >= maxWork) return false;
        peerWork++;
        return true;
      };
      const finish = (
        reason: 'peer-contact' | 'peer-budget' | null,
      ): ActorGroupResult3D<R, S, B, T, C> => ({
        ...base,
        reason,
        status: reason === 'peer-budget' ? 'incomplete' : reason ? 'unresolved' : 'resolved',
        requiresReexecution: reason === 'peer-budget',
        bodies: reason ? original : terrain.bodies,
        responses: reason ? [] : terrain.responses,
        peerContact: reason === 'peer-contact' ? earliest : null,
        peerWork,
        work: terrain.work + peerWork,
      });
      for (let i = 0; i < original.length; i++)
        for (let j = i + 1; j < original.length; j++) {
          if (!spend()) return finish('peer-budget');
          const a = original[i],
            b = original[j];
          let found: ActorPeerContact3D | null = overlap(a, b)
            ? {
                first: a.id,
                second: b.id,
                kind: 'initial-overlap',
                pass: null,
                time: { numerator: 0, denominator: 1 },
                normal: [0, 0, 0],
              }
            : null;
          let left = 0,
            right = 0;
          while (!found && left < traces[i].length && right < traces[j].length) {
            if (!spend()) return finish('peer-budget');
            const x = traces[i][left],
              y = traces[j][right];
            if (x.pass < y.pass) {
              left++;
              continue;
            }
            if (y.pass < x.pass) {
              right++;
              continue;
            }
            const hit = contact(x, y, a.body.sizeQ, b.body.sizeQ);
            if (hit)
              found = { first: a.id, second: b.id, kind: 'swept-overlap', pass: x.pass, ...hit };
            const end = cmp(x.end, y.end);
            if (end <= 0) left++;
            if (end >= 0) right++;
          }
          if (found && (!earliest || earlier(found, earliest) < 0)) earliest = found;
        }
      return finish(earliest ? 'peer-contact' : null);
    },
  });
}
