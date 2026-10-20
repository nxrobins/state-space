/** One-way actor response to the canonical material translation contract. */
import type { ReactiveGameplayGeometry3D, ReactiveGeometryStamp3D } from './reactive-geometry.js';
import { reactiveTranslationMovementSource3D, type ReactiveTranslationMovement3D } from './reactive-translation-motion.js';
import { DISPLACEMENT_CARRY_LIMITS_3D } from '../displacement-carry-options.js';
import type { DisplacementOptions3D, DisplacementResult3D } from '../displacement-kernel.js';
import type { ReactiveBody3D } from './reactive-body.js';

import { createReactiveControlledDisplacement3D } from './reactive-controlled-displacement.js';

export const REACTIVE_TRANSLATION_DISPLACEMENT_RULES_3D = 'reactive-translation-displacement-1';
export const REACTIVE_TRANSLATION_DISPLACEMENT_LIMITS_3D = DISPLACEMENT_CARRY_LIMITS_3D;
type V = [number, number, number];
export type ReactiveTranslationCarry3D = {pass: number; requestedQ: V; origins: number[]};
export type ReactiveTranslationDisplacementOptions3D = DisplacementOptions3D & {maxCarryEntries?: number};
export type ReactiveTranslationDisplacementResult3D = Omit<DisplacementResult3D<typeof REACTIVE_TRANSLATION_DISPLACEMENT_RULES_3D, Readonly<ReactiveGeometryStamp3D>, ReactiveBody3D>, 'supportFragments'> & {
  /** Eligible support motion, not realized travel. Only movedQ reports final displacement. */
  carries: ReactiveTranslationCarry3D[];
};
export interface ReactiveTranslationDisplacement3D {
  readonly rulesVersion: typeof REACTIVE_TRANSLATION_DISPLACEMENT_RULES_3D;
  readonly from: Readonly<ReactiveGeometryStamp3D>; readonly to: Readonly<ReactiveGeometryStamp3D>;
  resolve(body: ReactiveBody3D, options?: ReactiveTranslationDisplacementOptions3D): ReactiveTranslationDisplacementResult3D;
}

export function createReactiveTranslationDisplacement3D(before: ReactiveGameplayGeometry3D, after: ReactiveGameplayGeometry3D, movement: ReactiveTranslationMovement3D): ReactiveTranslationDisplacement3D {
  const observed = reactiveTranslationMovementSource3D(movement), controlled = new Set(observed.paths.controlledSources);
  return createReactiveControlledDisplacement3D(before, after, observed, REACTIVE_TRANSLATION_DISPLACEMENT_RULES_3D, () => controlled);
}
