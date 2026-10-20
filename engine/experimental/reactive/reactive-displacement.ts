/** One-way body response to privately bound executed reactive tick boundaries. */
import { PHASE, PHASE_SHIFT } from '../../generated/materials.js';
import { GEOMETRY_SCALE_3D as Q } from '../geometry-kernel.js';
import { reactiveGeometrySource3D, type ReactiveGameplayGeometry3D, type ReactiveGeometryStamp3D } from './reactive-geometry.js';
import { reactiveTickMovementSource3D, type ReactiveTickMovement3D } from './reactive-motion.js';
import { readReactiveBody3D, type ReactiveBody3D } from './reactive-body.js';
import { createDisplacementKernel3D, forwardDisplacementTrace3D,
  type DisplacementResult3D, type DisplacementContact3D } from '../displacement-kernel.js';
import { DISPLACEMENT_CARRY_LIMITS_3D, readDisplacementCarryOptions3D, type DisplacementCarryOptions3D } from '../displacement-carry-options.js';
export const REACTIVE_DISPLACEMENT_RULES_3D = 'reactive-displacement-1';
export const REACTIVE_DISPLACEMENT_LIMITS_3D = DISPLACEMENT_CARRY_LIMITS_3D;
export type ReactiveDisplacementOptions3D = DisplacementCarryOptions3D;
export type ReactiveDisplacementContact3D = DisplacementContact3D;
type V = [number, number, number];
export type ReactiveCarry3D = {pass: number; requestedQ: V; origins: number[]; components: number[]};
export type ReactiveDisplacementResult3D = DisplacementResult3D<typeof REACTIVE_DISPLACEMENT_RULES_3D, Readonly<ReactiveGeometryStamp3D>, ReactiveBody3D> & {carries: ReactiveCarry3D[]};
export function createReactiveDisplacement3D(before: ReactiveGameplayGeometry3D, after: ReactiveGameplayGeometry3D, movement: ReactiveTickMovement3D) {
  const observed = reactiveTickMovementSource3D(movement), source = reactiveGeometrySource3D(before), target = reactiveGeometrySource3D(after);
  const trace = observed.trace, members = new Map<number, number>(), structural = trace?.passes[28];
  if (structural) for (const s of structural.segments) if (s.mode === 'linear' && s.component !== null) members.set(s.origin, s.component);
  const solver = createDisplacementKernel3D(before, after, {...observed, rulesVersion: REACTIVE_DISPLACEMENT_RULES_3D,
    complete: !!trace, passes: trace?.passes ?? [], members, lastPass: 28, fragmentPass: 28}, source, target.token, readReactiveBody3D);
  const [width, height, depth] = source.shape;
  const coordinate = (i: number): V => [i % width, Math.floor(i / width) % height, Math.floor(i / (width * height))];
  const structuralMoves = new Map(structural?.segments.map(s => [s.from, s]) ?? []);
  return Object.freeze({rulesVersion: REACTIVE_DISPLACEMENT_RULES_3D, from: solver.from, to: solver.to,
    resolve(input: ReactiveBody3D, options: ReactiveDisplacementOptions3D = {}): ReactiveDisplacementResult3D {
      const carries: ReactiveCarry3D[] = [], {maximum, common} = readDisplacementCarryOptions3D(options);
      const result = solver.resolve(input, common, (pass, body, positions, spend, at): V | null => {
        if (pass.index !== 28) return [0, 0, 0];
        const feet = body.minQ[1] + body.sizeQ[1];
        if (feet % Q !== 0 || feet < 0 || feet >= height * Q) return [0, 0, 0];
        const y = feet / Q, origins: number[] = [], components = new Set<number>(); let delta: V | null = null, fixed = false;
        const loX = Math.max(0, Math.floor(body.minQ[0] / Q)), hiX = Math.min(width - 1, Math.ceil((body.minQ[0] + body.sizeQ[0]) / Q) - 1);
        const loZ = Math.max(0, Math.floor(body.minQ[2] / Q)), hiZ = Math.min(depth - 1, Math.ceil((body.minQ[2] + body.sizeQ[2]) / Q) - 1);
        for (let z = loZ; z <= hiZ; z++) for (let x = loX; x <= hiX; x++) {
          if (!spend()) return null;
          const i = x + width * (y + height * z), origin = positions.get(i) ?? i, phase = (at(origin).packed >>> PHASE_SHIFT) & 15;
          if (phase !== PHASE.SOLID && phase !== PHASE.FROZEN && phase !== PHASE.POWDER) continue;
          const segment = structuralMoves.get(i);
          if (!segment || segment.mode !== 'linear' || segment.component === null || segment.origin !== origin) {fixed = true; continue;}
          const from = coordinate(i), to = coordinate(segment.to), next = to.map((v, a) => (v - from[a]) * Q) as V;
          if (delta && delta.some((v, a) => v !== next[a])) fixed = true;
          delta = next; origins.push(origin); components.add(segment.component);
        }
        if (fixed || !delta || !origins.length) return [0, 0, 0];
        if (1 + origins.length > maximum) return null;
        carries.push({pass: 28, requestedQ: [...delta], origins: origins.sort((a, b) => a - b), components: [...components].sort((a, b) => a - b)}); return delta;
      });
      const response = {...result, supportFragments: result.status === 'incomplete' ? [] : carries.flatMap(c => c.components), carries: result.status === 'incomplete' ? [] : carries};
      forwardDisplacementTrace3D(result, response); return response;
    },
  });
}
export type ReactiveDisplacement3D = ReturnType<typeof createReactiveDisplacement3D>;
