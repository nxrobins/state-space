/** One-way actor response to the canonical material translation contract. */
import { PHASE, PHASE_SHIFT } from '../generated/materials.js';
import { gameplayGeometrySource3D, GEOMETRY_SCALE_3D as Q, type GameplayGeometry3D, type GeometryStamp3D } from './gameplay-geometry.js';
import { translationMovementSource3D, type TranslationMovement3D } from './translation-paths.js';
import { createDisplacementCore3D, forwardDisplacementTrace3D, DISPLACEMENT_LIMITS_3D, type DisplacementOptions3D, type DisplacementResult3D } from './terrain-displacement-core.js';
import type { TerrainBodyState3D } from './terrain-body.js';

export const TRANSLATION_DISPLACEMENT_RULES_3D = 'translation-displacement-1';
export const TRANSLATION_DISPLACEMENT_LIMITS_3D = Object.freeze({...DISPLACEMENT_LIMITS_3D, defaultCarryEntries: 4096, carryEntries: 65536});
type V = [number, number, number];
export type TranslationCarry3D = {pass: number; requestedQ: V; origins: number[]};
export type TranslationDisplacementOptions3D = DisplacementOptions3D & {maxCarryEntries?: number};
export type TranslationDisplacementResult3D = Omit<DisplacementResult3D<typeof TRANSLATION_DISPLACEMENT_RULES_3D>, 'supportFragments'> & {
  /** Eligible support motion, not realized travel. Only movedQ reports final displacement. */
  carries: TranslationCarry3D[];
};
export interface TranslationDisplacement3D {
  readonly rulesVersion: typeof TRANSLATION_DISPLACEMENT_RULES_3D;
  readonly from: Readonly<GeometryStamp3D>; readonly to: Readonly<GeometryStamp3D>;
  resolve(body: TerrainBodyState3D, options?: TranslationDisplacementOptions3D): TranslationDisplacementResult3D;
}
function options(value: TranslationDisplacementOptions3D) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(k => typeof k !== 'string' || !['maxContacts', 'maxEvents', 'maxWork', 'maxCarryEntries'].includes(k)) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d) || !d.enumerable)) throw Error('Invalid translation displacement options.');
  const {maxCarryEntries, ...common} = value, maximum = maxCarryEntries === undefined ? TRANSLATION_DISPLACEMENT_LIMITS_3D.defaultCarryEntries : maxCarryEntries;
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > TRANSLATION_DISPLACEMENT_LIMITS_3D.carryEntries) throw Error('Invalid translation carry budget.');
  return {maximum, common};
}
function solid(packed: number) {const phase = (packed >>> PHASE_SHIFT) & 15; return phase === PHASE.SOLID || phase === PHASE.FROZEN || phase === PHASE.POWDER;}

export function createTranslationDisplacement3D(before: GameplayGeometry3D, after: GameplayGeometry3D, movement: TranslationMovement3D): TranslationDisplacement3D {
  const observed = translationMovementSource3D(movement), paths = observed.paths, source = gameplayGeometrySource3D(before);
  const complete = paths.status === 'complete', controlled = new Set(paths.controlledSources);
  const solver = createDisplacementCore3D(before, after, {...observed, rulesVersion: TRANSLATION_DISPLACEMENT_RULES_3D,
    complete, members: new Map<number, number>(), passes: paths.passes, lastPass: paths.stepsObserved - 1});
  const [width, height, depth] = source.shape;
  return Object.freeze<TranslationDisplacement3D>({rulesVersion: TRANSLATION_DISPLACEMENT_RULES_3D, from: solver.from, to: solver.to,
    resolve(input, request = {}) {
      const {maximum, common} = options(request), carries: TranslationCarry3D[] = []; let entries = 0;
      const result = solver.resolve(input, common, (pass, body, positions, spend): V | null => {
        if (pass.index === 0 && !body.grounded) return [0, 0, 0];
        const feet = body.minQ[1] + body.sizeQ[1];
        // Only exact upper faces support a body at a completed voxel boundary.
        if (feet % Q !== 0 || feet >= height * Q || feet < 0) return [0, 0, 0];
        const y = feet / Q, origins: number[] = []; let fixed = false;
        const loX = Math.max(0, Math.floor(body.minQ[0] / Q)), hiX = Math.min(width - 1, Math.ceil((body.minQ[0] + body.sizeQ[0]) / Q) - 1);
        const loZ = Math.max(0, Math.floor(body.minQ[2] / Q)), hiZ = Math.min(depth - 1, Math.ceil((body.minQ[2] + body.sizeQ[2]) / Q) - 1);
        for (let z = loZ; z <= hiZ; z++) for (let x = loX; x <= hiX; x++) {
          if (!spend()) return null;
          const i = x + width * (y + height * z), origin = positions.get(i) ?? i;
          if (!solid(source.at(origin).packed)) continue;
          if (!controlled.has(origin)) fixed = true; else origins.push(origin);
        }
        if (fixed || !origins.length) return [0, 0, 0];
        if (entries + 1 + origins.length > maximum || !spend()) return null;
        const delta = paths.passes[pass.index].delta.map(v => v * Q) as V;
        origins.sort((a, b) => a - b); entries += 1 + origins.length;
        carries.push({pass: pass.index, requestedQ: [...delta], origins}); return delta;
      });
      const {supportFragments: _fragments, ...response} = result;
      const translated = {...response, carries: result.status === 'incomplete' ? [] : carries};
      forwardDisplacementTrace3D(result, translated); return translated;
    },
  });
}
