/** Catalog-aware data queries, one existing geometry operation per advancement. */
import { copyPortableValue } from '../portable-data.js';
import { reactiveArray3D, reactiveFields3D, reactiveRegistrySource3D, type ReactiveMaterialRegistry3D } from './reactive-registry.js';
import { reactiveDomain3D, reactiveDomainId3D, type ReactiveDomainId3D } from './reactive-domain-state.js';
import { reactiveGeometrySource3D, REACTIVE_GEOMETRY_RULES_3D, type ReactiveGameplayGeometry3D, type ReactiveGeometryStamp3D } from './reactive-geometry.js';
import { reactiveSessionRevision3D, type ReactiveGameValue3D, type ReactiveSessionSnapshot3D } from './reactive-session-state.js';
import type { ReactiveSessionPreview3D } from './reactive-session.js';
import { validateGeometryQueryResults3D } from './geometry-query-wire.js';
import { workerEqual } from './reactive-worker-wire.js';
export const REACTIVE_QUERY_RULES_3D = 'reactive-query-batches-1';
export const REACTIVE_QUERY_LIMITS_3D = Object.freeze({queries: 32});
type Kind = 'fit' | 'support' | 'raycast' | 'sweep' | 'exposure';
export type ReactiveWorkerQuery3D = {[K in Kind]: {kind: K; domain?: ReactiveDomainId3D; request: Parameters<ReactiveGameplayGeometry3D[K]>[0]}}[Kind];
export type ReactiveWorkerQueryResult3D = {[K in Kind]: {kind: K; domain: ReactiveDomainId3D; value: ReturnType<ReactiveGameplayGeometry3D[K]>}}[Kind];
export type ReactiveWorkerQueryBatch3D = {rulesVersion: typeof REACTIVE_QUERY_RULES_3D; results: ReactiveWorkerQueryResult3D[]};
export type ReactiveQueryProgress3D = {status: 'running' | 'complete' | 'cancelled'; completedQueries: number; totalQueries: number};
export interface ReactiveQueryJob3D {advance(): ReactiveQueryProgress3D; progress(): ReactiveQueryProgress3D; cancel(): boolean; result(): ReactiveWorkerQueryBatch3D;}
export const reactivePortable3D = <T>(raw: T): T => copyPortableValue(raw as unknown as ReactiveGameValue3D) as unknown as T;
export function readReactiveQueries3D(raw: unknown, snapshot: ReactiveSessionSnapshot3D<ReactiveGameValue3D>): ReactiveWorkerQuery3D[] {
  const rows = reactiveArray3D(raw, REACTIVE_QUERY_LIMITS_3D.queries); if (!rows.length) throw Error('A reactive query batch cannot be empty.');
  const owned = reactivePortable3D(rows);
  for (const row of owned) {
    reactiveFields3D(row, ['kind', 'request'], ['domain']);
    if (!['fit', 'support', 'raycast', 'sweep', 'exposure'].includes(row.kind as string)) throw Error('Unknown reactive geometry operation.');
    const id = Object.hasOwn(row, 'domain') ? reactiveDomainId3D(row.domain) : null; reactiveDomain3D(snapshot.domains, id);
  } return owned as ReactiveWorkerQuery3D[];
}
export function reactiveWorkerGeometryStamp3D(snapshot: ReactiveSessionSnapshot3D<ReactiveGameValue3D>, domain: ReactiveDomainId3D,
  preview?: ReactiveSessionPreview3D<ReactiveGameValue3D>): ReactiveGeometryStamp3D {
  const world = reactiveDomain3D(snapshot.domains, domain), common = {rulesVersion: REACTIVE_GEOMETRY_RULES_3D, worldRulesVersion: world.rulesVersion, domain, tick: world.tick} as const;
  return preview ? {...common, kind: 'preview', base: {...preview.base}, branchId: preview.branchId, completedCommands: preview.progress.completedCommands,
    completedTicks: preview.progress.completedTicks, horizonTicks: preview.progress.horizonTicks} : {...common, kind: 'committed', revision: reactiveSessionRevision3D(snapshot)};
}
/** Internal worker adapter; views are private session capabilities, never messages. */
export function createReactiveQueryJob3D(requests: readonly ReactiveWorkerQuery3D[], getView: (domain: ReactiveDomainId3D) => ReactiveGameplayGeometry3D): ReactiveQueryJob3D {
  const owned = reactivePortable3D(requests), views = new Map<ReactiveDomainId3D, ReactiveGameplayGeometry3D>();
  let results: ReactiveWorkerQueryResult3D[] = [], status: ReactiveQueryProgress3D['status'] = 'running', completedQueries = 0;
  const progress = (): ReactiveQueryProgress3D => ({status, completedQueries, totalQueries: owned.length});
  const cancel = () => {if (status !== 'running') return false; status = 'cancelled'; results = []; views.clear(); return true;};
  return Object.freeze({progress, cancel,
    advance() {
      if (status !== 'running') throw Error('Reactive query job is not running.');
      try {
        const q = owned[completedQueries], domain = q.domain ?? null; let view = views.get(domain);
        if (!view) {view = getView(domain); reactiveGeometrySource3D(view); views.set(domain, view);}
        let value;
        switch (q.kind) {
          case 'fit': value = view.fit(q.request); break;
          case 'support': value = view.support(q.request); break;
          case 'raycast': value = view.raycast(q.request); break;
          case 'sweep': value = view.sweep(q.request); break;
          case 'exposure': value = view.exposure(q.request); break;
        }
        results.push({kind: q.kind, domain, value} as ReactiveWorkerQueryResult3D); completedQueries++;
        if (completedQueries === owned.length) {results = reactivePortable3D(results); status = 'complete'; views.clear();}
      } catch (error) {cancel(); throw error;} return progress();
    },
    result(): ReactiveWorkerQueryBatch3D {if (status !== 'complete') throw Error('Reactive query batch is incomplete.'); return reactivePortable3D({rulesVersion: REACTIVE_QUERY_RULES_3D, results});},
  });
}
export function readReactiveQueryBatch3D(registry: ReactiveMaterialRegistry3D, raw: unknown, requests: readonly ReactiveWorkerQuery3D[],
  snapshot: ReactiveSessionSnapshot3D<ReactiveGameValue3D>, preview?: ReactiveSessionPreview3D<ReactiveGameValue3D>): ReactiveWorkerQueryBatch3D {
  const result = reactivePortable3D(raw); reactiveFields3D(result, ['rulesVersion', 'results']);
  const rows = reactiveArray3D(result.results, REACTIVE_QUERY_LIMITS_3D.queries);
  if (result.rulesVersion !== REACTIVE_QUERY_RULES_3D || rows.length !== requests.length) throw Error('Reactive query batch identity differs.');
  validateGeometryQueryResults3D(rows, requests, id => reactiveDomain3D(snapshot.domains, id).block, reactiveRegistrySource3D(registry).ids, (stamp, id) => {
    if (!workerEqual(stamp, reactiveWorkerGeometryStamp3D(snapshot, id, preview))) throw Error('Reactive query stamp differs.');
  }); return result as unknown as ReactiveWorkerQueryBatch3D;
}
