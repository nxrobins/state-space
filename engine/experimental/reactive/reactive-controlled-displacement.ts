/** Shared exact actor response to controlled material paths. Internal adapters supply provenance. */
import { PHASE, PHASE_SHIFT } from '../../generated/materials.js';
import { GEOMETRY_SCALE_3D as Q } from '../geometry-kernel.js';
import {
  reactiveGeometrySource3D,
  type ReactiveGameplayGeometry3D,
  type ReactiveGeometryStamp3D,
} from './reactive-geometry.js';
import { readDisplacementCarryOptions3D } from '../displacement-carry-options.js';
import {
  createDisplacementKernel3D,
  forwardDisplacementTrace3D,
  type DisplacementOptions3D,
  type DisplacementResult3D,
} from '../displacement-kernel.js';
import { readReactiveBody3D, type ReactiveBody3D } from './reactive-body.js';
import type { ReactiveMotionSegment3D } from './reactive-motion-capture.js';
type V = [number, number, number];
export type ReactiveControlledDisplacementResult3D<R extends string> = Omit<
  DisplacementResult3D<R, Readonly<ReactiveGeometryStamp3D>, ReactiveBody3D>,
  'supportFragments'
> & {
  carries: { pass: number; requestedQ: V; origins: number[] }[];
};
export interface ReactiveControlledDisplacement3D<R extends string> {
  readonly rulesVersion: R;
  readonly from: Readonly<ReactiveGeometryStamp3D>;
  readonly to: Readonly<ReactiveGeometryStamp3D>;
  resolve(
    body: ReactiveBody3D,
    options?: DisplacementOptions3D & { maxCarryEntries?: number },
  ): ReactiveControlledDisplacementResult3D<R>;
}
function solid(packed: number) {
  const phase = (packed >>> PHASE_SHIFT) & 15;
  return phase === PHASE.SOLID || phase === PHASE.FROZEN || phase === PHASE.POWDER;
}
export function createReactiveControlledDisplacement3D<R extends string>(
  before: ReactiveGameplayGeometry3D,
  after: ReactiveGameplayGeometry3D,
  observed: {
    before: object;
    after: object;
    from: Readonly<ReactiveGeometryStamp3D>;
    to: Readonly<ReactiveGeometryStamp3D>;
    paths: {
      status: string;
      stepsObserved: number;
      passes: { index: number; delta: V; segments: ReactiveMotionSegment3D[] }[];
    };
  },
  rulesVersion: R,
  controlledAt: (pass: number) => ReadonlySet<number>,
): ReactiveControlledDisplacement3D<R> {
  const paths = observed.paths,
    source = reactiveGeometrySource3D(before),
    complete = paths.status === 'complete';
  const solver = createDisplacementKernel3D(
    before,
    after,
    {
      ...observed,
      rulesVersion,
      complete,
      members: new Map<number, number>(),
      passes: paths.passes,
      lastPass: paths.stepsObserved - 1,
    },
    source,
    reactiveGeometrySource3D(after).token,
    readReactiveBody3D,
  );
  const [width, height, depth] = source.shape;
  return Object.freeze<ReactiveControlledDisplacement3D<R>>({
    rulesVersion,
    from: solver.from,
    to: solver.to,
    resolve(input, request = {}) {
      const { maximum, common } = readDisplacementCarryOptions3D(request),
        carries: { pass: number; requestedQ: V; origins: number[] }[] = [];
      let entries = 0;
      const result = solver.resolve(input, common, (pass, body, positions, spend): V | null => {
        if (pass.index === 0 && !body.grounded) return [0, 0, 0];
        const feet = body.minQ[1] + body.sizeQ[1];
        // Only exact upper faces support a body at a completed voxel boundary.
        if (feet % Q !== 0 || feet >= height * Q || feet < 0) return [0, 0, 0];
        const y = feet / Q,
          origins: number[] = [],
          controlled = controlledAt(pass.index);
        let fixed = false;
        const loX = Math.max(0, Math.floor(body.minQ[0] / Q)),
          hiX = Math.min(width - 1, Math.ceil((body.minQ[0] + body.sizeQ[0]) / Q) - 1);
        const loZ = Math.max(0, Math.floor(body.minQ[2] / Q)),
          hiZ = Math.min(depth - 1, Math.ceil((body.minQ[2] + body.sizeQ[2]) / Q) - 1);
        for (let z = loZ; z <= hiZ; z++)
          for (let x = loX; x <= hiX; x++) {
            if (!spend()) return null;
            const i = x + width * (y + height * z),
              origin = positions.get(i) ?? i;
            if (!solid(source.at(origin).packed)) continue;
            if (!controlled.has(origin)) fixed = true;
            else origins.push(origin);
          }
        if (fixed || !origins.length) return [0, 0, 0];
        if (entries + 1 + origins.length > maximum || !spend()) return null;
        const delta = paths.passes[pass.index].delta.map((v) => v * Q) as V;
        origins.sort((a, b) => a - b);
        entries += 1 + origins.length;
        carries.push({ pass: pass.index, requestedQ: [...delta], origins });
        return delta;
      });
      const { supportFragments: _fragments, ...response } = result;
      const translated = { ...response, carries: result.status === 'incomplete' ? [] : carries };
      forwardDisplacementTrace3D(result, translated);
      return translated;
    },
  });
}
