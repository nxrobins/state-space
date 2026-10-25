import { assertRecordFields } from '../../portable-data.js';
/** Shared bounded group orchestration over trusted body-response adapters. */
import type { KinematicBody3D } from './body-kernel.js';
import type { GeometryKernel3D } from './geometry-kernel.js';
import { DISPLACEMENT_CARRY_LIMITS_3D } from './displacement-carry-options.js';
export const BODY_GROUP_LIMITS_3D = Object.freeze({ ...DISPLACEMENT_CARRY_LIMITS_3D, bodies: 64 });
export type NamedBody3D<B extends KinematicBody3D> = { id: string; body: B };
export type BodyGroupOptions3D = {
  maxWork?: number;
  maxEvents?: number;
  maxContacts?: number;
  maxCarryEntries?: number;
};
export type GroupBodyResponse3D<B extends KinematicBody3D> = {
  status: string;
  body: B;
  work: number;
  events: number;
  contacts: readonly unknown[];
  carries?: readonly { origins: readonly number[] }[];
};
export type BodyGroupResult3D<
  R extends string,
  S,
  B extends KinematicBody3D,
  T extends GroupBodyResponse3D<B>,
  C extends string,
> = {
  rulesVersion: R;
  scope: C;
  from: S;
  to: S;
  status: 'resolved' | 'unresolved' | 'incomplete';
  requiresReexecution: boolean;
  bodies: NamedBody3D<B>[];
  responses: { id: string; response: T }[];
  failure: { id: string; response: T } | null;
  evaluatedBodies: number;
  work: number;
  events: number;
};
export interface BodyGroupKernel3D<
  R extends string,
  S,
  B extends KinematicBody3D,
  T extends GroupBodyResponse3D<B>,
  C extends string,
> {
  readonly rulesVersion: R;
  readonly scope: C;
  readonly from: S;
  readonly to: S;
  resolve(
    bodies: readonly NamedBody3D<B>[],
    options?: BodyGroupOptions3D,
  ): BodyGroupResult3D<R, S, B, T, C>;
}
function fields(value: object, required: readonly string[], optional: readonly string[] = []) {
  assertRecordFields(value, required, optional, 'Invalid actor group fields.');
}
function options(value: BodyGroupOptions3D) {
  fields(value, [], ['maxWork', 'maxEvents', 'maxContacts', 'maxCarryEntries']);
  const l = BODY_GROUP_LIMITS_3D;
  const read = (key: keyof BodyGroupOptions3D, fallback: number, maximum: number) => {
    const n = Object.hasOwn(value, key) && value[key] !== undefined ? value[key]! : fallback;
    if (!Number.isSafeInteger(n) || n < 0 || n > maximum)
      throw Error('Invalid actor group budget.');
    return n;
  };
  return {
    maxWork: read('maxWork', l.defaultWork, l.work),
    maxEvents: read('maxEvents', l.defaultEvents, l.events),
    maxContacts: read('maxContacts', l.defaultContacts, l.contacts),
    maxCarryEntries: read('maxCarryEntries', l.defaultCarryEntries, l.carryEntries),
  };
}
function bodies<S, B extends KinematicBody3D>(
  before: GeometryKernel3D<S>,
  after: GeometryKernel3D<S>,
  value: readonly NamedBody3D<B>[],
  readBody: (view: GeometryKernel3D<S>, body: B) => B,
): NamedBody3D<B>[] {
  if (
    !Array.isArray(value) ||
    value.length > BODY_GROUP_LIMITS_3D.bodies ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    throw Error('Invalid actor group array.');
  const ids = new Set<string>(),
    out: NamedBody3D<B>[] = [];
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      throw Error('Actor groups require dense data.');
    const row: NamedBody3D<B> = descriptor.value;
    fields(row, ['id', 'body']);
    if (
      typeof row.id !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/.test(row.id) ||
      ids.has(row.id)
    )
      throw Error('Actor group IDs must be unique portable identifiers.');
    const body = readBody(before, row.body);
    readBody(after, body);
    ids.add(row.id);
    out.push({ id: row.id, body });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : Number(a.id > b.id)));
  return out;
}
export function createBodyGroupKernel3D<
  R extends string,
  S,
  B extends KinematicBody3D,
  T extends GroupBodyResponse3D<B>,
  C extends string,
>(
  before: GeometryKernel3D<S>,
  after: GeometryKernel3D<S>,
  scope: C,
  rulesVersion: R,
  source: { from: S; to: S; resolve(body: B, options: Required<BodyGroupOptions3D>): T },
  readBody: (view: GeometryKernel3D<S>, body: B) => B,
): BodyGroupKernel3D<R, S, B, T, C> {
  return Object.freeze<BodyGroupKernel3D<R, S, B, T, C>>({
    rulesVersion,
    scope,
    from: source.from,
    to: source.to,
    resolve(input, request = {}) {
      const limit = options(request),
        original = bodies(before, after, input, readBody),
        responses: BodyGroupResult3D<R, S, B, T, C>['responses'] = [];
      let work = 0,
        events = 0,
        contacts = 0,
        carryEntries = 0;
      const finish = (
        failure: BodyGroupResult3D<R, S, B, T, C>['failure'],
      ): BodyGroupResult3D<R, S, B, T, C> => {
        const status =
          failure === null
            ? 'resolved'
            : failure.response.status === 'incomplete'
              ? 'incomplete'
              : 'unresolved';
        const selected =
          failure === null ? responses.map((r) => ({ id: r.id, body: r.response.body })) : original;
        return {
          rulesVersion,
          scope,
          from: source.from,
          to: source.to,
          status,
          requiresReexecution: status === 'incomplete',
          bodies: selected.map((row) => ({ id: row.id, body: readBody(before, row.body) })),
          responses: failure === null ? responses : [],
          failure,
          evaluatedBodies: responses.length + Number(failure !== null),
          work,
          events,
        };
      };
      for (const row of original) {
        const response = source.resolve(row.body, {
          maxWork: limit.maxWork - work,
          maxEvents: limit.maxEvents - events,
          maxContacts: limit.maxContacts - contacts,
          maxCarryEntries: limit.maxCarryEntries - carryEntries,
        });
        // Trusted adapters must still respect their declared aggregate allowance.
        if (
          !Number.isSafeInteger(response.work) ||
          response.work < 0 ||
          work + response.work > limit.maxWork ||
          !Number.isSafeInteger(response.events) ||
          response.events < 0 ||
          events + response.events > limit.maxEvents
        )
          throw Error('Actor response exceeded its group allowance.');
        work += response.work;
        events += response.events;
        if (response.status !== 'resolved') return finish({ id: row.id, response });
        contacts += response.contacts.length;
        if (response.carries)
          carryEntries += response.carries.reduce((n, c) => n + 1 + c.origins.length, 0);
        if (contacts > limit.maxContacts || carryEntries > limit.maxCarryEntries)
          throw Error('Actor detail exceeded its group allowance.');
        responses.push({ id: row.id, response });
      }
      return finish(null);
    },
  });
}
