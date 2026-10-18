/** Expand the executed v1 translation receipt; do not advance material physics. */
import { translateStructuralRegion3D, INTERVENTION_RULES_VERSION_3D, type TranslationRequest3D, type TranslationReceipt3D, type TranslationResult3D, type CellCoordinate3D } from './interventions.js';
import { validateStructuralSnapshot3D, type StructuralSnapshot3D } from './structural-world-core.js';
import { structuralNeighbor, ANCHOR_3D, BONDS_3D } from './structural-mechanics.js';
import type { MotionPathSegment3D } from './motion-paths.js';
import type { GameplayGeometry3D, GeometryStamp3D } from './gameplay-geometry.js';

export const TRANSLATION_PATH_RULES_3D = 'translation-paths-1';
export const TRANSLATION_PATH_LIMITS_3D = Object.freeze({defaultEntries: 4096, entries: 65536});
export type TranslationPathOptions3D = {maxEntries?: number};
export type TranslationPaths3D = {
  rulesVersion: typeof TRANSLATION_PATH_RULES_3D; interventionRulesVersion: typeof INTERVENTION_RULES_VERSION_3D;
  derivation: 'canonical-receipt-expansion'; physicsRulesVersion: string; materialCatalogHash: string;
  width: number; height: number; depth: number; tick: number;
  status: 'complete' | 'overflow'; requiresReexecution: boolean;
  controlledCells: number; stepsObserved: number; cellTransfers: number;
  controlledSources: number[]; passes: {index: number; delta: CellCoordinate3D; segments: MotionPathSegment3D[]}[];
};
export type TranslationPathsResult3D = TranslationResult3D & {paths: TranslationPaths3D};
export type TranslationMovement3D = {
  rulesVersion: typeof TRANSLATION_PATH_RULES_3D; scope: 'translation';
  from: Readonly<GeometryStamp3D>; to: Readonly<GeometryStamp3D>;
  status: 'complete' | 'overflow'; requiresReexecution: boolean; paths: TranslationPaths3D;
};
export type TranslationAction3D = {
  receipt: TranslationReceipt3D;
  beforeQueries(): GameplayGeometry3D; queries(): GameplayGeometry3D; movement(): TranslationMovement3D;
};
function limit(options: TranslationPathOptions3D): number {
  if (!options || typeof options !== 'object' || Array.isArray(options) || ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
      Reflect.ownKeys(options).some(k => k !== 'maxEntries') || Object.values(Object.getOwnPropertyDescriptors(options)).some(d => !('value' in d) || !d.enumerable)) throw Error('Invalid translation path options.');
  const n = Object.hasOwn(options, 'maxEntries') && options.maxEntries !== undefined ? options.maxEntries : TRANSLATION_PATH_LIMITS_3D.defaultEntries;
  if (!Number.isSafeInteger(n) || n < 0 || n > TRANSLATION_PATH_LIMITS_3D.entries) throw Error('Invalid translation path budget.'); return n;
}
export function copyTranslationReceipt3D(r: TranslationReceipt3D): TranslationReceipt3D {
  return {...r, sources: r.sources.slice(), destinations: r.destinations.slice(), releasedAnchors: r.releasedAnchors.slice(), editedCells: r.editedCells.slice(),
    path: r.path.map(p => [...p] as CellCoordinate3D), cutBonds: r.cutBonds.map(p => [...p])};
}
export function copyTranslationPaths3D(p: TranslationPaths3D): TranslationPaths3D {
  return {...p, controlledSources: p.controlledSources.slice(), passes: p.passes.map(s => ({index: s.index, delta: [...s.delta] as CellCoordinate3D, segments: s.segments.map(v => ({...v}))}))};
}

export function translateStructuralRegionWithPaths3D(snapshot: StructuralSnapshot3D, request: TranslationRequest3D, options: TranslationPathOptions3D = {}): TranslationPathsResult3D {
  const maximum = limit(options), result = translateStructuralRegion3D(snapshot, request), {receipt} = result;
  if (receipt.rulesVersion !== INTERVENTION_RULES_VERSION_3D || receipt.tick !== snapshot.tick || receipt.externalEnergyQ !== 0n) throw Error('Unsupported translation receipt contract.');
  for (const key of ['schemaVersion', 'rulesVersion', 'worldVersion', 'materialCatalogHash', 'width', 'height', 'depth', 'chunkSize', 'tick'] as const) {
    if (result.snapshot[key] !== snapshot[key]) throw Error('Translation changed the snapshot identity.');
  }
  if (receipt.sources.length !== receipt.destinations.length ||
      (['packedCells', 'energyQ', 'structure'] as const).some(key => result.snapshot[key].length !== snapshot.packedCells.length)) throw Error('Translation changed coordinate dimensions.');
  const state = validateStructuralSnapshot3D(snapshot);
  // Apply only the explicit history edits before checking transported coordinates.
  for (const i of receipt.releasedAnchors) state.structure[i] &= ~ANCHOR_3D;
  for (const [a, b] of receipt.cutBonds) {
    const direction = BONDS_3D.findIndex((_bit, dir) => structuralNeighbor(a, dir, snapshot) === b);
    if (direction < 0) throw Error('Translation cut is not an adjacent bond.');
    state.structure[a] &= ~BONDS_3D[direction]; state.structure[b] &= ~BONDS_3D[direction ^ 1];
  }
  let selected = Array.from(receipt.sources), entries = selected.length, transfers = 0, overflow = entries > maximum;
  let controlledSources = overflow ? [] : selected.slice();
  let passes: TranslationPaths3D['passes'] = [];
  const positions = new Map<number, number>();
  for (let index = 0; index < receipt.path.length; index++) {
    const delta = receipt.path[index], axis = delta.findIndex(v => v !== 0), direction = axis * 2 + Number(delta[axis] > 0), members = new Set(selected);
    const destinations = selected.map(i => structuralNeighbor(i, direction, snapshot));
    if (destinations.some(i => i < 0)) throw Error('Translation expansion crosses a closed boundary.');
    for (let k = 0; k < selected.length; k++) if ((positions.get(selected[k]) ?? selected[k]) !== receipt.sources[k]) throw Error('Controlled translation identity changed.');
    const relocations: MotionPathSegment3D[] = [];
    for (const head of selected) {
      if (members.has(structuralNeighbor(head, direction ^ 1, snapshot))) continue;
      let terminal = structuralNeighbor(head, direction, snapshot);
      while (members.has(terminal)) terminal = structuralNeighbor(terminal, direction, snapshot);
      if (terminal < 0) throw Error('Missing displaced translation occupant.');
      relocations.push({origin: positions.get(terminal) ?? terminal, from: terminal, to: head, mode: 'relocation'});
    }
    const count = selected.length + relocations.length; transfers += count;
    if (!overflow && entries + 1 + count > maximum) {overflow = true; controlledSources = []; passes = []; entries = 0;}
    if (!overflow) {
      const segments: MotionPathSegment3D[] = selected.map((from, k) => ({origin: receipt.sources[k], from, to: destinations[k], mode: 'linear'}));
      segments.push(...relocations); segments.sort((a, b) => a.from - b.from);
      passes.push({index, delta: [...delta] as CellCoordinate3D, segments}); entries += 1 + count;
    }
    // All origins were read before this simultaneous permutation is installed.
    for (let k = 0; k < destinations.length; k++) {
      const to = destinations[k], origin = receipt.sources[k]; if (origin === to) positions.delete(to); else positions.set(to, origin);
    }
    for (const {origin, to} of relocations) {if (origin === to) positions.delete(to); else positions.set(to, origin);}
    selected = destinations;
  }
  if (selected.some((v, i) => v !== receipt.destinations[i])) throw Error('Translation path endpoint differs from its receipt.');
  for (let i = 0; i < state.grid.length; i++) {
    const origin = positions.get(i) ?? i;
    if (state.grid[origin] !== result.snapshot.packedCells[i] || state.energyQ[origin] !== result.snapshot.energyQ[i] || state.structure[origin] !== result.snapshot.structure[i]) throw Error('Translation expansion differs from the executed complete state.');
  }
  return {...result, paths: {rulesVersion: TRANSLATION_PATH_RULES_3D, interventionRulesVersion: INTERVENTION_RULES_VERSION_3D,
    derivation: 'canonical-receipt-expansion', physicsRulesVersion: snapshot.rulesVersion, materialCatalogHash: snapshot.materialCatalogHash,
    width: snapshot.width, height: snapshot.height, depth: snapshot.depth, tick: snapshot.tick, status: overflow ? 'overflow' : 'complete', requiresReexecution: overflow,
    controlledCells: receipt.sources.length, stepsObserved: receipt.path.length, cellTransfers: transfers, controlledSources, passes}};
}

type Source = {from: Readonly<GeometryStamp3D>; to: Readonly<GeometryStamp3D>; paths: TranslationPaths3D; before: object; after: object};
const observations = new WeakMap<TranslationMovement3D, Source>();
function stamp(value: GeometryStamp3D): Readonly<GeometryStamp3D> {
  return value.kind === 'committed' ? Object.freeze({...value, revision: Object.freeze({...value.revision})}) : Object.freeze({...value, base: Object.freeze({...value.base})});
}
/** Trusted session producer. Public reports cannot mutate the private expansion. */
export function translationMovement3D(from: GeometryStamp3D, to: GeometryStamp3D, paths: TranslationPaths3D, before: object, after: object): TranslationMovement3D {
  const source: Source = {from: stamp(from), to: stamp(to), paths, before, after};
  const report: TranslationMovement3D = {rulesVersion: TRANSLATION_PATH_RULES_3D, scope: 'translation', from: source.from, to: source.to,
    status: paths.status, requiresReexecution: paths.requiresReexecution, paths: copyTranslationPaths3D(paths)};
  observations.set(report, source); return report;
}
export function translationMovementSource3D(value: TranslationMovement3D): Source {
  const source = observations.get(value); if (!source) throw Error('Expected a live translation observation.'); return source;
}
