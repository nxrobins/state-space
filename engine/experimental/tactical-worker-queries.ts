/** Data-only batches of existing geometry queries; no physical advancement. */
import { copyTacticalValue } from './tactical-session-core.js';
import { validateGeometryQueryResults3D } from './geometry-query-wire.js';
import { MATERIALS_3D } from './3d.js';
import { GEOMETRY_RULES_VERSION_3D, GEOMETRY_LIMITS_3D, type GameplayGeometry3D } from './gameplay-geometry.js';
import { fields, sameRevision } from './tactical-worker-wire.js';
import type { StructuralSnapshot3D } from './structural-world-core.js';
import type { TacticalPreview3D, TacticalRevision3D, TacticalSession3D, TacticalSessionSnapshot3D, TacticalValue } from './tactical-session-view.js';

export const TACTICAL_QUERY_BATCH_RULES_3D = 'tactical-query-batches-1';
export const TACTICAL_PREVIEW_QUERY_BATCH_RULES_3D = 'tactical-preview-query-batches-1';
export const TACTICAL_QUERY_BATCH_LIMITS_3D = Object.freeze({queries: 32, cellsPerQuery: GEOMETRY_LIMITS_3D.cells});
type Kind = 'fit' | 'support' | 'raycast' | 'sweep' | 'exposure';
export type TacticalWorkerQuery3D = {[K in Kind]: {kind: K; domain?: string | null; request: Parameters<GameplayGeometry3D[K]>[0]}}[Kind];
export type TacticalWorkerQueryResult3D = {[K in Kind]: {kind: K; domain: string | null; value: ReturnType<GameplayGeometry3D[K]>}}[Kind];
export type TacticalWorkerQueryBatch3D = {rulesVersion: typeof TACTICAL_QUERY_BATCH_RULES_3D; base: Readonly<TacticalRevision3D>; results: TacticalWorkerQueryResult3D[]};
export type TacticalWorkerPreviewQueryBatch3D = {rulesVersion: typeof TACTICAL_PREVIEW_QUERY_BATCH_RULES_3D;
  target: number; preview: TacticalPreview3D<TacticalValue>['preview']; results: TacticalWorkerQueryResult3D[]};
const kinds: readonly string[] = ['fit', 'support', 'raycast', 'sweep', 'exposure'];
const materials = new Set(MATERIALS_3D.map(m => m.id));
function portable<T>(value: T): T {return copyTacticalValue(value as unknown as TacticalValue) as unknown as T;}
function domain(snapshot: Pick<TacticalSessionSnapshot3D<TacticalValue>, 'terrain' | 'reservoirs'>, id: string | null): StructuralSnapshot3D {
  if (id === null) return snapshot.terrain;
  const found = snapshot.reservoirs.find(r => r.id === id); if (!found) throw Error('Unknown worker query domain.'); return found.terrain;
}
export function queryRequestsData(value: unknown, snapshot: Pick<TacticalSessionSnapshot3D<TacticalValue>, 'terrain' | 'reservoirs'>): TacticalWorkerQuery3D[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > TACTICAL_QUERY_BATCH_LIMITS_3D.queries) throw Error('Worker query batch requires 1 to 32 queries.');
  const owned = portable(value);
  for (const item of owned) {
    fields(item, ['kind', 'request'], ['domain']);
    if (!kinds.includes(item.kind as string)) throw Error('Unknown worker geometry operation.');
    if (Object.hasOwn(item, 'domain') && item.domain !== null && typeof item.domain !== 'string') throw Error('Invalid worker query domain.');
    domain(snapshot, (item.domain ?? null) as string | null);
  }
  return owned as TacticalWorkerQuery3D[];
}
function executeQueries(requests: readonly TacticalWorkerQuery3D[], getView: (id: string | null) => GameplayGeometry3D): TacticalWorkerQueryResult3D[] {
  const views = new Map<string | null, GameplayGeometry3D>();
  return requests.map(item => {
    const id = item.domain ?? null; let view = views.get(id);
    if (!view) {view = getView(id); views.set(id, view);}
    let value;
    switch (item.kind) {
      case 'fit': value = view.fit(item.request); break;
      case 'support': value = view.support(item.request); break;
      case 'raycast': value = view.raycast(item.request); break;
      case 'sweep': value = view.sweep(item.request); break;
      case 'exposure': value = view.exposure(item.request); break;
    }
    return {kind: item.kind, domain: id, value} as TacticalWorkerQueryResult3D;
  });
}
export function executeQueryBatch<T extends TacticalValue>(session: TacticalSession3D<T>, requests: readonly TacticalWorkerQuery3D[]): TacticalWorkerQueryBatch3D {
  const base = session.revision, results = executeQueries(requests, id => session.queries({domain: id}));
  // Enforce the same portable node/depth/character budget on the whole reply.
  return portable({rulesVersion: TACTICAL_QUERY_BATCH_RULES_3D, base, results}) as TacticalWorkerQueryBatch3D;
}
export function executePreviewQueryBatch(target: number, requests: readonly TacticalWorkerQuery3D[], getView: (id: string | null) => GameplayGeometry3D): TacticalWorkerPreviewQueryBatch3D {
  const results = executeQueries(requests, getView), stamp = results[0].value.stamp;
  if (stamp.kind !== 'preview') throw Error('Expected a preview query view.');
  const {base, branchId, operation, horizonTicks, completedTicks} = stamp;
  return portable({rulesVersion: TACTICAL_PREVIEW_QUERY_BATCH_RULES_3D, target,
    preview: {base, branchId, operation, horizonTicks, completedTicks}, results});
}
export function queryBatchData(value: unknown, requests: readonly TacticalWorkerQuery3D[], base: Readonly<TacticalRevision3D>, snapshot: TacticalSessionSnapshot3D<TacticalValue>): TacticalWorkerQueryBatch3D {
  const result = portable(value);
  fields(result, ['rulesVersion', 'base', 'results']);
  if (result.rulesVersion !== TACTICAL_QUERY_BATCH_RULES_3D || !sameRevision(result.base, base) || !Array.isArray(result.results) || result.results.length !== requests.length) throw Error('Worker query batch identity differs.');
  validateGeometryQueryResults3D(result.results, requests, id => domain(snapshot, id), materials, (stamp, id) => {
    fields(stamp, ['rulesVersion', 'domain', 'tick', 'kind', 'revision']);
    if (stamp.rulesVersion !== GEOMETRY_RULES_VERSION_3D || stamp.kind !== 'committed' || stamp.domain !== id || stamp.tick !== base.tick || !sameRevision(stamp.revision, base)) throw Error('Worker query result stamp differs.');
  });
  return result as unknown as TacticalWorkerQueryBatch3D;
}
export function previewQueryBatchData(value: unknown, requests: readonly TacticalWorkerQuery3D[], target: number, candidate: TacticalPreview3D<TacticalValue>): TacticalWorkerPreviewQueryBatch3D {
  const result = portable(value), expected = candidate.preview;
  fields(result, ['rulesVersion', 'target', 'preview', 'results']);
  if (result.rulesVersion !== TACTICAL_PREVIEW_QUERY_BATCH_RULES_3D || result.target !== target || !Array.isArray(result.results) || result.results.length !== requests.length) throw Error('Worker preview query identity differs.');
  function boundary(stamp: Record<string, unknown>) {
    if (!sameRevision(stamp.base, expected.base) || stamp.branchId !== expected.branchId || stamp.operation !== expected.operation ||
        stamp.horizonTicks !== expected.horizonTicks || stamp.completedTicks !== expected.completedTicks || expected.completedTicks !== expected.horizonTicks) throw Error('Worker preview query boundary differs.');
  }
  fields(result.preview, ['base', 'branchId', 'operation', 'horizonTicks', 'completedTicks']); boundary(result.preview);
  validateGeometryQueryResults3D(result.results, requests, id => domain(candidate, id), materials, (stamp, id) => {
    fields(stamp, ['rulesVersion', 'domain', 'tick', 'kind', 'base', 'branchId', 'operation', 'horizonTicks', 'completedTicks']);
    if (stamp.rulesVersion !== GEOMETRY_RULES_VERSION_3D || stamp.kind !== 'preview' || stamp.domain !== id ||
        stamp.tick !== expected.base.tick + expected.completedTicks || stamp.tick !== domain(candidate, id).tick) throw Error('Worker preview query stamp differs.');
    boundary(stamp);
  });
  return result as unknown as TacticalWorkerPreviewQueryBatch3D;
}
