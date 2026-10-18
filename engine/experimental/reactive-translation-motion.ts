/** Disposable executed-command paths. Only the session coordinator binds provenance. */
import { reactiveFields3D, reactiveInteger3D } from './reactive-registry.js';
import { reactiveGeometrySource3D, type ReactiveGameplayGeometry3D, type ReactiveGeometryStamp3D } from './reactive-geometry.js';
import { REACTIVE_TRANSLATION_RULES_3D, type ReactiveTranslationReceipt3D } from './reactive-translation.js';
import { ANCHOR_3D, BONDS_3D } from './structural-mechanics.js';
import type { ReactiveMotionSegment3D } from './reactive-motion-capture.js';
export const REACTIVE_TRANSLATION_MOTION_RULES_3D = 'reactive-translation-motion-1';
export const REACTIVE_TRANSLATION_MOTION_LIMITS_3D = Object.freeze({defaultEntries: 4096, entries: 65536});
export type ReactiveTranslationCaptureOptions3D = {maxEntries?: number};
export type ReactiveTranslationPaths3D = {rulesVersion: typeof REACTIVE_TRANSLATION_MOTION_RULES_3D; translationRulesVersion: typeof REACTIVE_TRANSLATION_RULES_3D;
  status: 'disabled' | 'complete' | 'overflow'; requiresReexecution: boolean; maxEntries: number; entries: number;
  stepsObserved: number; controlledSources: number[]; passes: {index: number; delta: [number, number, number]; segments: ReactiveMotionSegment3D[]}[]};
export type ReactiveTranslationMovement3D = {rulesVersion: typeof REACTIVE_TRANSLATION_MOTION_RULES_3D; scope: 'reactive-translation-domain';
  from: Readonly<ReactiveGeometryStamp3D>; to: Readonly<ReactiveGeometryStamp3D>; paths: ReactiveTranslationPaths3D};
type Bound = {before: object; after: object; from: Readonly<ReactiveGeometryStamp3D>; to: Readonly<ReactiveGeometryStamp3D>; paths: ReactiveTranslationPaths3D};
const observations = new WeakMap<ReactiveTranslationMovement3D, Bound>();
export function reactiveTranslationMovementSource3D(value: ReactiveTranslationMovement3D) {
  const source = observations.get(value); if (!source) throw Error('Expected a live reactive translation observation.'); return source;
}
export function readReactiveTranslationCapture3D(raw: ReactiveTranslationCaptureOptions3D) {
  reactiveFields3D(raw, [], ['maxEntries']);
  return {maxEntries: Object.hasOwn(raw, 'maxEntries') ? reactiveInteger3D(raw.maxEntries, 0, REACTIVE_TRANSLATION_MOTION_LIMITS_3D.entries) : REACTIVE_TRANSLATION_MOTION_LIMITS_3D.defaultEntries};
}
/** Internal expansion of an already executed, validated receipt, never a proposed route. */
export function createReactiveTranslationMovementAccess3D(before: ReactiveGameplayGeometry3D, after: ReactiveGameplayGeometry3D,
  receipt: ReactiveTranslationReceipt3D, options: {maxEntries: number} | null): () => ReactiveTranslationMovement3D {
  const a = reactiveGeometrySource3D(before), b = reactiveGeometrySource3D(after), from = before.stamp, to = after.stamp;
  if (from.kind !== 'preview' || to.kind !== 'preview' || from.domain !== to.domain || from.tick !== to.tick ||
      from.branchId !== to.branchId || from.completedCommands + 1 !== to.completedCommands || from.completedTicks !== to.completedTicks ||
      from.horizonTicks !== to.horizonTicks || JSON.stringify(from.base) !== JSON.stringify(to.base) || from.worldRulesVersion !== to.worldRulesVersion ||
      a.shape.some((v, i) => v !== b.shape[i]) || receipt.rulesVersion !== REACTIVE_TRANSLATION_RULES_3D ||
      receipt.materialCatalogHash !== from.base.materialCatalogHash || receipt.tick !== from.tick || receipt.externalEnergyQ !== '0') throw Error('Reactive translation boundaries differ.');
  const paths: ReactiveTranslationPaths3D = {rulesVersion: REACTIVE_TRANSLATION_MOTION_RULES_3D, translationRulesVersion: REACTIVE_TRANSLATION_RULES_3D,
    status: options ? 'complete' : 'disabled', requiresReexecution: !options, maxEntries: options?.maxEntries ?? 0, entries: 0, stepsObserved: receipt.steps.length, controlledSources: [], passes: []};
  if (options) {
    const count = receipt.sources.length + receipt.steps.reduce((n, s) => n + 1 + s.selectedSources.length + s.displaced.length, 0);
    if (count > options.maxEntries) {paths.status = 'overflow'; paths.requiresReexecution = true;}
    else {
      paths.entries = count; paths.controlledSources = receipt.sources.slice();
      const n = a.shape.reduce((p, v) => p * v, 1), positions = Int32Array.from({length: n}, (_, i) => i);
      const structure = Array.from({length: n}, (_, i) => a.at(i).structure);
      for (const i of receipt.releasedAnchors) structure[i] &= ~ANCHOR_3D;
      for (const [i, j] of receipt.cutBonds) {
        const diff = j - i, axis = diff === 1 && Math.floor(i / a.shape[0]) === Math.floor(j / a.shape[0]) ? 0 : diff === a.shape[0] && Math.floor(i / (a.shape[0] * a.shape[1])) === Math.floor(j / (a.shape[0] * a.shape[1])) ? 1 : diff === a.shape[0] * a.shape[1] ? 2 : -1;
        if (axis < 0) throw Error('Reactive translation cut is not adjacent.'); structure[i] &= ~BONDS_3D[axis * 2 + 1]; structure[j] &= ~BONDS_3D[axis * 2];
      }
      for (let index = 0; index < receipt.steps.length; index++) {
        const step = receipt.steps[index], segments: ReactiveMotionSegment3D[] = step.selectedSources.map((from, k) => {
          if (positions[from] !== receipt.sources[k]) throw Error('Reactive selected origin differs.');
          return {origin: receipt.sources[k], from, to: step.selectedDestinations[k], mode: 'linear', component: null};
        });
        for (const move of step.displaced) {if (positions[move.from] !== move.origin) throw Error('Reactive displaced origin differs.'); segments.push({...move, mode: 'relocation', component: null});}
        for (const s of segments) positions[s.to] = s.origin;
        paths.passes.push({index, delta: [...receipt.path[index]], segments: segments.sort((x, y) => x.from - y.from)});
      }
      const seen = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const origin = positions[i], initial = a.at(origin), final = b.at(i);
        if (seen[origin] || final.packed !== initial.packed || final.energyQ !== initial.energyQ || final.structure !== structure[origin]) throw Error('Reactive translation paths differ from executed state.'); seen[origin] = 1;
      }
    }
  }
  const source: Bound = {before: a.token, after: b.token, from, to, paths};
  return () => {const value: ReactiveTranslationMovement3D = {rulesVersion: REACTIVE_TRANSLATION_MOTION_RULES_3D, scope: 'reactive-translation-domain', from, to, paths: structuredClone(paths)};
    observations.set(value, source); return value;};
}
