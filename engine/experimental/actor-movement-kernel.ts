/** Shared serial fixed-point movement against terrain and named actor volumes. */
import { BODY_LIMITS_3D, type KinematicBody3D } from './body-kernel.js';
import type { GeometryKernel3D, GeometryContact3D, GeometryTime3D, KernelExposure3D } from './geometry-kernel.js';
import type { NamedBody3D } from './body-group-kernel.js';
export const ACTOR_MOVEMENT_KERNEL_LIMITS_3D = Object.freeze({bodies: 64, commands: 64});
type V = [number, number, number];
export type ActorCommand3D = {id: string; impulseQ?: readonly number[]; accelerationQ?: readonly number[]};
export type ActorFootingKernel3D<S> = {grounded: boolean; terrain: ReturnType<GeometryKernel3D<S>['support']>; actors: {id: string; areaQ2: number}[]};
export type ActorContactKernel3D = {axis: 0 | 1 | 2; requestedQ: number; travelledQ: number; obstacle: {kind: 'terrain'; contact: GeometryContact3D} | {kind: 'actor'; id: string; time: GeometryTime3D; normal: V}};
export type ActorMovementKernelResponse3D<S, B extends KinematicBody3D> = {id: string; body: B; movedQ: V;
  segments: {axis: 0 | 1 | 2; fromMinQ: V; toMinQ: V; requestedQ: number; travelledQ: number}[];
  contacts: ActorContactKernel3D[]; footingBefore: ActorFootingKernel3D<S>; footingAfter: ActorFootingKernel3D<S>;
  lostFooting: boolean; landed: boolean; exposure: KernelExposure3D<S>;
};
export type ActorMovementKernelResult3D<R extends string, S, B extends KinematicBody3D> = {rulesVersion: R; stamp: S;
  status: 'resolved' | 'unresolved'; bodyStep: number | null; bodies: NamedBody3D<B>[]; responses: ActorMovementKernelResponse3D<S, B>[];
  failure: {id: string; kind: 'outside' | 'embedded' | 'actor-overlap'; actor: string | null} | null;
};
function fields(value: object, required: readonly string[], optional: readonly string[] = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      required.some(k => !Object.hasOwn(value, k)) || Reflect.ownKeys(value).some(k => typeof k !== 'string' || ![...required, ...optional].includes(k)) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d) || !d.enumerable)) throw Error('Invalid actor movement fields.');
}
function dense<T>(value: readonly T[], maximum: number): T[] {
  if (!Array.isArray(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) throw Error('Invalid actor movement array.');
  return Array.from({length: value.length}, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !('value' in d) || !d.enumerable) throw Error('Actor movement arrays require dense data.'); return d.value;
  });
}
function integer(value: number, lo: number, hi: number): number {
  if (!Number.isSafeInteger(value) || value < lo || value > hi) throw Error('Invalid actor movement integer.'); return value === 0 ? 0 : value;
}
function speed(value: readonly number[]): V {
  const v = dense(value, 3); if (v.length !== 3) throw Error('Expected three actor movement coordinates.');
  return v.map(n => integer(n, -BODY_LIMITS_3D.velocityQ, BODY_LIMITS_3D.velocityQ)) as V;
}
function identity(id: string): string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/.test(id)) throw Error('Invalid actor movement identity.'); return id;
}
const box = (b: KinematicBody3D) => ({minQ: b.minQ, maxQ: b.minQ.map((v, a) => v + b.sizeQ[a]) as V});
const overlap = (a: KinematicBody3D, b: KinematicBody3D, axis: number) => a.minQ[axis] < b.minQ[axis] + b.sizeQ[axis] && b.minQ[axis] < a.minQ[axis] + a.sizeQ[axis];
function footing<S, B extends KinematicBody3D>(view: GeometryKernel3D<S>, row: NamedBody3D<B>, peers: readonly NamedBody3D<B>[]): ActorFootingKernel3D<S> {
  const terrain = view.support({box: box(row.body), maxDropQ: 0}), b = row.body;
  const actors = peers.filter(p => p.id !== row.id && b.minQ[1] + b.sizeQ[1] === p.body.minQ[1] && overlap(b, p.body, 0) && overlap(b, p.body, 2)).map(p => ({id: p.id,
    areaQ2: [0, 2].reduce((area, a) => area * (Math.min(b.minQ[a] + b.sizeQ[a], p.body.minQ[a] + p.body.sizeQ[a]) - Math.max(b.minQ[a], p.body.minQ[a])), 1)}));
  return {terrain, actors, grounded: terrain.distanceQ === 0 || actors.length > 0};
}
function ratio(n: number, d: number): GeometryTime3D {let a = n, b = d; while (b) {[a, b] = [b, a % b];} return {numerator: n / a, denominator: d / a};}

/**
 * Ascending actor ID, then X/Z/Y. Earlier actors occupy their completed poses;
 * later actors occupy their starting poses. No actor pushing or implicit carry.
 * Commands and all results are owned; callers publish the whole result atomically.
 */
export function moveActorsKernel3D<R extends string, S, B extends KinematicBody3D>(view: GeometryKernel3D<S>, input: readonly NamedBody3D<B>[],
  commands: readonly ActorCommand3D[], rulesVersion: R, readBody: (view: GeometryKernel3D<S>, body: B) => B): ActorMovementKernelResult3D<R, S, B> {
  const ids = new Set<string>();
  const original = dense(input, ACTOR_MOVEMENT_KERNEL_LIMITS_3D.bodies).map(row => {
    fields(row, ['id', 'body']); const id = identity(row.id); if (ids.has(id)) throw Error('Duplicate actor movement identity.'); ids.add(id);
    return {id, body: readBody(view, row.body)};
  }).sort((a, b) => a.id < b.id ? -1 : Number(a.id > b.id));
  const startStep = original.length ? original[0].body.step : null;
  if (original.some(row => row.body.step !== startStep)) throw Error('Actor movement requires a shared body-step boundary.');
  const bodyStep = startStep === null ? null : integer(startStep + 1, 0, Number.MAX_SAFE_INTEGER);
  const requested = new Map<string, {impulse: V; acceleration: V}>();
  for (const command of dense(commands, ACTOR_MOVEMENT_KERNEL_LIMITS_3D.commands)) {
    fields(command, ['id'], ['impulseQ', 'accelerationQ']); const id = identity(command.id);
    if (!ids.has(id) || requested.has(id)) throw Error('Unknown or duplicate actor command target.');
    requested.set(id, {impulse: command.impulseQ === undefined ? [0, 0, 0] : speed(command.impulseQ), acceleration: command.accelerationQ === undefined ? [0, 0, 0] : speed(command.accelerationQ)});
  }
  // Validate even the last actor's summed speed before making any geometry query.
  const velocities = original.map(row => speed(row.body.velocityQ.map((v, a) => v + (requested.get(row.id)?.impulse[a] ?? 0) +
    (requested.get(row.id)?.acceleration[a] ?? 0) + (a === 1 ? row.body.gravityQ : 0))));
  const base = {rulesVersion, stamp: view.stamp} as const;
  for (const row of original) {
    const fit = view.fit({box: box(row.body)});
    const peer = original.find(p => p.id !== row.id && [0, 1, 2].every(a => overlap(row.body, p.body, a)));
    if (!fit.fits || peer) return {...base, status: 'unresolved', bodyStep: startStep, bodies: original, responses: [],
      failure: {id: row.id, kind: !fit.fits ? fit.outside ? 'outside' : 'embedded' : 'actor-overlap', actor: !fit.fits ? null : peer!.id}};
  }
  const before = original.map(row => footing(view, row, original));
  const bodies = original.map(row => ({id: row.id, body: readBody(view, row.body)}));
  const partial: {segments: ActorMovementKernelResponse3D<S, B>['segments']; contacts: ActorContactKernel3D[]}[] = [];
  for (let k = 0; k < bodies.length; k++) {
    const row = bodies[k], b = row.body, velocity = velocities[k], segments: ActorMovementKernelResponse3D<S, B>['segments'] = [], contacts: ActorContactKernel3D[] = [];
    for (const axis of [0, 2, 1] as const) {
      const requestedQ = velocity[axis]; if (!requestedQ) continue;
      const delta: V = [0, 0, 0]; delta[axis] = requestedQ;
      const terrain = view.sweep({box: box(b), deltaQ: delta}).contact;
      if (terrain?.startedOverlapping) throw Error('Actor movement encountered unexpected terrain overlap.');
      let distance = terrain ? integer(Math.abs(requestedQ) * terrain.time.numerator / terrain.time.denominator, 0, Math.abs(requestedQ)) : Math.abs(requestedQ);
      let obstacle: ActorContactKernel3D['obstacle'] | null = terrain ? {kind: 'terrain', contact: terrain} : null;
      for (const peer of bodies) {
        if (peer.id === row.id || [0, 1, 2].some(a => a !== axis && !overlap(b, peer.body, a))) continue;
        const gap = requestedQ > 0 ? peer.body.minQ[axis] - b.minQ[axis] - b.sizeQ[axis] : b.minQ[axis] - peer.body.minQ[axis] - peer.body.sizeQ[axis];
        if (gap < 0 || gap > distance || (gap === distance && obstacle)) continue;
        const normal: V = [0, 0, 0]; normal[axis] = requestedQ > 0 ? -1 : 1;
        distance = gap; obstacle = {kind: 'actor', id: peer.id, time: ratio(gap, Math.abs(requestedQ)), normal};
      }
      const fromMinQ = [...b.minQ] as V, travelledQ = distance === 0 ? 0 : (requestedQ > 0 ? 1 : -1) * distance;
      b.minQ[axis] += travelledQ;
      segments.push({axis, fromMinQ, toMinQ: [...b.minQ], requestedQ, travelledQ});
      if (obstacle) {velocity[axis] = 0; contacts.push({axis, requestedQ, travelledQ, obstacle});}
    }
    b.velocityQ = velocity; b.step = bodyStep!; partial.push({segments, contacts});
  }
  // Re-evaluate footing at the final group boundary: a later peer may have left.
  const responses = bodies.map((row, k): ActorMovementKernelResponse3D<S, B> => {
    const after = footing(view, row, bodies), fit = view.fit({box: box(row.body)});
    if (!fit.fits || bodies.some(p => p.id !== row.id && [0, 1, 2].every(a => overlap(row.body, p.body, a)))) throw Error('Actor movement produced overlapping or outside bodies.');
    row.body.grounded = after.grounded;
    return {id: row.id, body: readBody(view, row.body), movedQ: row.body.minQ.map((v, a) => v - original[k].body.minQ[a]) as V,
      ...partial[k], footingBefore: before[k], footingAfter: after,
      lostFooting: original[k].body.grounded && (!before[k].grounded || !after.grounded), landed: after.grounded && (!original[k].body.grounded || !before[k].grounded),
      exposure: view.exposure({box: box(row.body)})};
  });
  return {...base, status: 'resolved', bodyStep, bodies, responses, failure: null};
}
