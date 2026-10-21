import { assertRecordFields } from '../portable-data.js';
/** Shared fixed-point body arithmetic. Adapters own identity and geometry provenance. */
import {
  GEOMETRY_LIMITS_3D,
  GEOMETRY_SCALE_3D,
  type GeometryKernel3D,
  type GeometryContact3D,
  type KernelExposure3D,
} from './geometry-kernel.js';
export const BODY_LIMITS_3D = Object.freeze({
  sizeQ: 8 * GEOMETRY_SCALE_3D,
  velocityQ: 32 * GEOMETRY_SCALE_3D,
  gravityQ: GEOMETRY_SCALE_3D,
  defaultGravityQ: 64,
});
export type BodyVector3D = [number, number, number];
export type KinematicBody3D = {
  step: number;
  minQ: BodyVector3D;
  sizeQ: BodyVector3D;
  velocityQ: BodyVector3D;
  gravityQ: number;
  grounded: boolean;
};
export type BodyCommand3D = { impulseQ?: readonly number[]; accelerationQ?: readonly number[] };
export type BodyKernelResult3D<R extends string, S, B extends KinematicBody3D> = {
  rulesVersion: R;
  stamp: S;
  status: 'resolved' | 'embedded' | 'outside';
  body: B;
  movedQ: BodyVector3D;
  lostFooting: boolean;
  landed: boolean;
  initialBlocker: ReturnType<GeometryKernel3D<S>['fit']>['blocker'];
  contacts: {
    axis: 0 | 1 | 2;
    requestedQ: number;
    travelledQ: number;
    contact: GeometryContact3D;
  }[];
  supportBefore: ReturnType<GeometryKernel3D<S>['support']> | null;
  supportAfter: ReturnType<GeometryKernel3D<S>['support']> | null;
  exposure: KernelExposure3D<S>;
};
type Vector = BodyVector3D;
export function bodyFields3D(
  value: object,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  assertRecordFields(value, required, optional, 'Invalid terrain body fields.');
}
export function bodyInteger3D(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw Error('Invalid terrain body integer.');
  return value === 0 ? 0 : value;
}
export function bodyVector3D(value: readonly number[], min: number, max: number): Vector {
  if (!Array.isArray(value) || value.length !== 3 || Reflect.ownKeys(value).length !== 4)
    throw Error('Expected three body coordinates.');
  const result: Vector = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d) || !d.enumerable) throw Error('Body coordinates must be dense data.');
    result[i] = bodyInteger3D(d.value, min, max);
  }
  return result;
}
function speed(value: readonly number[]): Vector {
  return bodyVector3D(value, -BODY_LIMITS_3D.velocityQ, BODY_LIMITS_3D.velocityQ);
}
function bodyBox(body: Pick<KinematicBody3D, 'minQ' | 'sizeQ'>) {
  return {
    minQ: [...body.minQ] as Vector,
    maxQ: body.minQ.map((v, axis) =>
      bodyInteger3D(
        v + body.sizeQ[axis],
        -GEOMETRY_LIMITS_3D.coordinateQ,
        GEOMETRY_LIMITS_3D.coordinateQ,
      ),
    ) as Vector,
  };
}
export function readKinematicBody3D(value: KinematicBody3D): KinematicBody3D {
  if (typeof value.grounded !== 'boolean') throw Error('Invalid grounded body state.');
  const body = {
    step: bodyInteger3D(value.step, 0, Number.MAX_SAFE_INTEGER),
    minQ: bodyVector3D(value.minQ, -GEOMETRY_LIMITS_3D.coordinateQ, GEOMETRY_LIMITS_3D.coordinateQ),
    sizeQ: bodyVector3D(value.sizeQ, 1, BODY_LIMITS_3D.sizeQ),
    velocityQ: speed(value.velocityQ),
    gravityQ: bodyInteger3D(value.gravityQ, 0, BODY_LIMITS_3D.gravityQ),
    grounded: value.grounded,
  };
  bodyBox(body);
  return body;
}
export function stepBodyKernel3D<R extends string, S, B extends KinematicBody3D>(
  view: GeometryKernel3D<S>,
  input: B,
  command: BodyCommand3D,
  rulesVersion: R,
  read: (view: GeometryKernel3D<S>, input: B) => B,
): BodyKernelResult3D<R, S, B> {
  const body = read(view, input);
  bodyFields3D(command, [], ['impulseQ', 'accelerationQ']);
  const impulse =
    Object.hasOwn(command, 'impulseQ') && command.impulseQ !== undefined
      ? speed(command.impulseQ)
      : [0, 0, 0];
  const acceleration =
    Object.hasOwn(command, 'accelerationQ') && command.accelerationQ !== undefined
      ? speed(command.accelerationQ)
      : [0, 0, 0];
  const velocity = speed(
    body.velocityQ.map(
      (v, axis) => v + impulse[axis] + acceleration[axis] + (axis === 1 ? body.gravityQ : 0),
    ),
  );
  const nextStep = bodyInteger3D(body.step + 1, 0, Number.MAX_SAFE_INTEGER),
    initial = view.fit({ box: bodyBox(body) });
  const result: BodyKernelResult3D<R, S, B> = {
    rulesVersion,
    stamp: view.stamp,
    status: 'resolved',
    body,
    movedQ: [0, 0, 0],
    lostFooting: false,
    landed: false,
    initialBlocker: initial.blocker,
    contacts: [],
    supportBefore: null,
    supportAfter: null,
    exposure: view.exposure({ box: bodyBox(body) }),
  };
  if (!initial.fits) {
    result.status = initial.outside ? 'outside' : 'embedded';
    return result;
  }
  const before = view.support({ box: bodyBox(body), maxDropQ: 0 });
  result.supportBefore = before;
  const origin = body.minQ.slice() as Vector;
  for (const axis of [0, 2, 1] as const) {
    const delta: Vector = [0, 0, 0];
    delta[axis] = velocity[axis];
    if (!delta[axis]) continue;
    const contact = view.sweep({ box: bodyBox(body), deltaQ: delta }).contact;
    if (contact?.startedOverlapping) throw Error('Body sweep encountered an unexpected overlap.');
    // Axis-only sweeps between integer planes must produce integer travel exactly.
    const travelled = bodyInteger3D(
      contact ? (delta[axis] * contact.time.numerator) / contact.time.denominator : delta[axis],
      -BODY_LIMITS_3D.velocityQ,
      BODY_LIMITS_3D.velocityQ,
    );
    body.minQ[axis] += travelled;
    if (contact) {
      result.contacts.push({ axis, requestedQ: delta[axis], travelledQ: travelled, contact });
      velocity[axis] = 0;
    }
  }
  const after = view.support({ box: bodyBox(body), maxDropQ: 0 });
  if (!after.bodyFits) throw Error('Resolved body does not fit its geometry boundary.');
  const grounded = after.distanceQ === 0;
  result.lostFooting = body.grounded && (before.distanceQ !== 0 || !grounded);
  result.landed = grounded && (before.distanceQ !== 0 || !body.grounded);
  body.velocityQ = velocity;
  body.grounded = grounded;
  body.step = nextStep;
  result.movedQ = body.minQ.map((v, axis) => v - origin[axis]) as Vector;
  result.supportAfter = after;
  result.exposure = view.exposure({ box: bodyBox(body) });
  return result;
}
