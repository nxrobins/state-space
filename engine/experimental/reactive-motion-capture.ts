/** Bounded disposable observations of executed reactive passes. No physical decisions. */
import { reactiveFields3D, reactiveInteger3D } from './reactive-registry.js';
import type { ReactiveMaterialBlock3D } from './reactive-block.js';
import type { ReactiveWorldSnapshot3D } from './reactive-world-tick.js';
import type { ReactiveStructureReport3D } from './reactive-structure.js';
export const REACTIVE_MOTION_RULES_3D = 'reactive-motion-1';
export const REACTIVE_MOTION_LIMITS_3D = Object.freeze({entries: 65536, defaultEntries: 8192, passes: 29});
export type ReactiveMotionCaptureOptions3D = {maxEntries?: number};
export type ReactiveTickOptions3D = {motion?: ReactiveMotionCaptureOptions3D};
export type ReactiveMotionSegment3D = {origin: number; from: number; to: number; mode: 'linear' | 'relocation'; component: number | null};
export type ReactiveMotionChange3D = {index: number; packed: number; energyQ: number; structure: number};
export type ReactiveMotionPass3D = {index: number; kind: 'movement' | 'heat' | 'phase' | 'combustion' | 'structure';
  segments: ReactiveMotionSegment3D[]; changes: ReactiveMotionChange3D[]};
export type ReactiveMotionReport3D = {rulesVersion: typeof REACTIVE_MOTION_RULES_3D;
  worldRulesVersion: ReactiveWorldSnapshot3D['rulesVersion']; materialCatalogHash: string;
  width: number; height: number; depth: number; fromTick: number; toTick: number;
  status: 'disabled' | 'complete' | 'overflow'; requiresReexecution: boolean; maxEntries: number;
  entries: number; passesObserved: number; overflowAtPass: number | null; passes: ReactiveMotionPass3D[]};
export function readReactiveTickOptions3D(raw: ReactiveTickOptions3D = {}) {
  reactiveFields3D(raw, [], ['motion']);
  if (!Object.hasOwn(raw, 'motion')) return {enabled: false, maxEntries: 0};
  reactiveFields3D(raw.motion, [], ['maxEntries']);
  return {enabled: true, maxEntries: Object.hasOwn(raw.motion, 'maxEntries')
    ? reactiveInteger3D(raw.motion.maxEntries, 0, REACTIVE_MOTION_LIMITS_3D.entries) : REACTIVE_MOTION_LIMITS_3D.defaultEntries};
}
/** Trusted internal observer. Input blocks belong to the running job and are immutable per pass. */
export function createReactiveMotionCapture3D(before: ReactiveWorldSnapshot3D, options: ReturnType<typeof readReactiveTickOptions3D>) {
  const b = before.block;
  const data: ReactiveMotionReport3D = {rulesVersion: REACTIVE_MOTION_RULES_3D, worldRulesVersion: before.rulesVersion, materialCatalogHash: b.materialCatalogHash,
    width: b.width, height: b.height, depth: b.depth, fromTick: before.tick, toTick: before.tick + 1,
    status: options.enabled ? 'complete' : 'disabled', requiresReexecution: !options.enabled, maxEntries: options.maxEntries,
    entries: 0, passesObserved: 0, overflowAtPass: null, passes: []};
  let previous: ReactiveMaterialBlock3D | null = options.enabled ? b : null;
  let origins: Int32Array | null = options.enabled ? Int32Array.from({length: b.packedCells.length}, (_, i) => i) : null;
  let pending: ReactiveMotionPass3D | null = null;
  const overflow = (index: number) => {data.status = 'overflow'; data.requiresReexecution = true; data.overflowAtPass = index;
    data.entries = 0; data.passes = []; pending = null; previous = null; origins = null;};
  const spend = (index: number) => {if (data.status !== 'complete') return false; if (data.entries >= data.maxEntries) {overflow(index); return false;} data.entries++; return true;};
  const begin = (index: number) => {
    if (index !== data.passesObserved) throw Error('Reactive motion observed passes out of order.');
    if (!pending && spend(index)) pending = {index, kind: index < 20 ? 'movement' : index < 26 ? 'heat' : index === 26 ? 'phase' : index === 27 ? 'combustion' : 'structure', segments: [], changes: []};
  };
  const add = (index: number, segment: ReactiveMotionSegment3D) => {if (spend(index)) pending!.segments.push(segment);};
  return {
    recording: () => data.status === 'complete',
    swap(index: number, a: number, z: number) {
      if (data.status !== 'complete') return; begin(index); if (!origins) return;
      const first = origins[a], second = origins[z];
      add(index, {origin: first, from: a, to: z, mode: 'linear', component: null});
      add(index, {origin: second, from: z, to: a, mode: 'linear', component: null});
      if (origins) {origins[a] = second; origins[z] = first;}
    },
    pass(index: number, block: ReactiveMaterialBlock3D) {
      if (!options.enabled) return; begin(index);
      if (data.status === 'complete' && previous && pending) {
        for (let i = 0; i < block.packedCells.length; i++) if (block.packedCells[i] !== previous.packedCells[i] || block.energyQ[i] !== previous.energyQ[i] || block.structure[i] !== previous.structure[i]) {
          if (!spend(index)) break;
          pending!.changes.push({index: i, packed: block.packedCells[i], energyQ: block.energyQ[i], structure: block.structure[i]});
        }
        if (pending) {pending.segments.sort((a, z) => a.from - z.from); data.passes.push(pending); previous = block; pending = null;}
      }
      data.passesObserved++;
    },
    structure(report: ReactiveStructureReport3D) {
      if (data.status !== 'complete') return; begin(28); if (!origins) return;
      const next = origins.slice(), falling = new Set(report.movingCells);
      for (const move of report.moves) {
        if (!origins) break; const linear = falling.has(move.from);
        add(28, {origin: origins[move.from], from: move.from, to: move.to, mode: linear ? 'linear' : 'relocation', component: linear ? report.componentIds[move.from] : null});
        if (origins) next[move.to] = origins[move.from];
      }
      if (origins) origins = next;
    },
    release() {previous = null; origins = null; pending = null; data.passes = []; data.entries = 0;},
    result() {
      if (options.enabled && data.passesObserved !== 29) throw Error('Reactive motion capture is incomplete.');
      return structuredClone(data);
    },
  };
}
