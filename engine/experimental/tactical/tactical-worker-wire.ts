import { assertRecordFields } from '../../portable-data.js';
/** Data-only transport framing and complete-state validation; no physical steps. */
import {
  createTacticalSessionCore3D,
  TACTICAL_SESSION_LIMITS_3D,
} from './tactical-session-core.js';
import { compatibleReservoirs3D } from '../gameplay/material-reservoirs.js';
import { checkedInteger } from '../../validation.js';
import type { TacticalPreviewOutcome3D } from './tactical-previews.js';
import type {
  TacticalPreview3D,
  TacticalRevision3D,
  TacticalSessionSnapshot3D,
  TacticalValue,
} from './tactical-session-view.js';

export const TACTICAL_WORKER_PROTOCOL_3D = 'tactical-worker-7';
export const TACTICAL_WORKER_LIMITS_3D = Object.freeze({
  inFlight: 1,
  waiting: 1,
  cancellationMessages: 1,
  timeoutMs: 10000,
  maxTimeoutMs: 60000,
});
/** send must preserve structured-clone isolation. close disposes the owned endpoint. */
export interface TacticalTransport3D {
  send(value: unknown): void;
  subscribe(receive: (value: unknown) => void, failed: (error: Error) => void): () => void;
  close(): void;
}
export type Wire = {
  protocol: typeof TACTICAL_WORKER_PROTOCOL_3D;
  channel: string;
  seq: number;
  kind: string;
  payload: unknown;
};
export function fields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): asserts value is Record<string, unknown> {
  assertRecordFields(value, required, optional, 'Invalid worker message fields.');
}
export function channelName(value: string) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value))
    throw Error('Invalid worker channel.');
  return value;
}
export function envelope(raw: unknown, channel: string): Wire {
  fields(raw, ['protocol', 'channel', 'seq', 'kind', 'payload']);
  if (
    raw.protocol !== TACTICAL_WORKER_PROTOCOL_3D ||
    raw.channel !== channel ||
    typeof raw.kind !== 'string'
  )
    throw Error('Incompatible worker message.');
  checkedInteger(raw.seq as number, 1, Number.MAX_SAFE_INTEGER, 'message sequence');
  return raw as Wire;
}
export function wire(channel: string, seq: number, kind: string, payload: unknown): Wire {
  return { protocol: TACTICAL_WORKER_PROTOCOL_3D, channel, seq, kind, payload };
}
export function revisionOf(
  s: TacticalSessionSnapshot3D<TacticalValue>,
): Readonly<TacticalRevision3D> {
  return Object.freeze({
    worldId: s.worldId,
    revision: s.revision,
    tick: s.terrain.tick,
    gameRulesVersion: s.gameRulesVersion,
    physicsRulesVersion: s.terrain.rulesVersion,
    materialCatalogHash: s.terrain.materialCatalogHash,
    interventionRulesVersion: s.interventionRulesVersion,
    sessionRulesVersion: s.rulesVersion,
    constraintRulesVersion: s.constraintRulesVersion,
    storageRulesVersion: s.storageRulesVersion,
  });
}
export function sameRevision(value: unknown, expected: Readonly<TacticalRevision3D>) {
  fields(value, Object.keys(expected));
  return Object.entries(expected).every(([key, v]) => value[key] === v);
}
export function snapshotData<T extends TacticalValue>(
  value: unknown,
): TacticalSessionSnapshot3D<T> {
  fields(value, [
    'schemaVersion',
    'rulesVersion',
    'interventionRulesVersion',
    'constraintRulesVersion',
    'holds',
    'storageRulesVersion',
    'reservoirs',
    'worldId',
    'gameRulesVersion',
    'revision',
    'terrain',
    'game',
    'accounting',
  ]);
  const s = value as unknown as TacticalSessionSnapshot3D<T>;
  const revision = checkedInteger(s.revision, 0, Number.MAX_SAFE_INTEGER, 'committed revision');
  // Reuse the full session validator, including holds, domains and accounting.
  // This isolated validator can never advance physics or observe support.
  const validator = createTacticalSessionCore3D(
    {
      worldId: s.worldId,
      gameRulesVersion: s.gameRulesVersion,
      terrain: s.terrain,
      game: s.game,
      holds: s.holds,
      reservoirs: s.reservoirs,
      accounting: s.accounting,
    },
    () => {
      throw Error('Transport validation cannot advance physics.');
    },
  );
  return { ...validator.restore(s), revision };
}
export function compatibleSnapshot(
  a: TacticalSessionSnapshot3D<TacticalValue>,
  b: TacticalSessionSnapshot3D<TacticalValue>,
) {
  for (const key of [
    'worldId',
    'gameRulesVersion',
    'schemaVersion',
    'rulesVersion',
    'interventionRulesVersion',
    'constraintRulesVersion',
    'storageRulesVersion',
  ] as const) {
    if (a[key] !== b[key]) throw Error('Worker snapshot identity changed.');
  }
  for (const key of [
    'width',
    'height',
    'depth',
    'chunkSize',
    'schemaVersion',
    'rulesVersion',
    'worldVersion',
    'materialCatalogHash',
  ] as const) {
    if (a.terrain[key] !== b.terrain[key]) throw Error('Worker terrain identity changed.');
  }
  compatibleReservoirs3D(a.reservoirs, b.reservoirs);
}
export function outcomeData<T extends TacticalValue>(
  value: unknown,
  base: Readonly<TacticalRevision3D>,
  horizon: number,
  id: number,
): TacticalPreviewOutcome3D<T> {
  fields(value, ['id', 'base', 'horizonTicks', 'status'], ['preview', 'error']);
  if (!sameRevision(value.base, base) || value.horizonTicks !== horizon)
    throw Error('Worker preview stamp differs.');
  checkedInteger(value.id as number, 1, Number.MAX_SAFE_INTEGER, 'worker preview identity');
  if (value.status === 'ready') {
    fields(value, ['id', 'base', 'horizonTicks', 'status', 'preview']);
    fields(value.preview, [
      'schemaVersion',
      'rulesVersion',
      'interventionRulesVersion',
      'constraintRulesVersion',
      'holds',
      'storageRulesVersion',
      'reservoirs',
      'worldId',
      'gameRulesVersion',
      'revision',
      'terrain',
      'game',
      'accounting',
      'preview',
    ]);
    const { preview, ...snapshot } = value.preview;
    fields(preview, ['base', 'branchId', 'operation', 'horizonTicks', 'completedTicks']);
    const branchId = checkedInteger(
      preview.branchId as number,
      1,
      Number.MAX_SAFE_INTEGER,
      'preview branch',
    );
    const operation = checkedInteger(
      preview.operation as number,
      1,
      TACTICAL_SESSION_LIMITS_3D.operations,
      'completed preview operation',
    );
    if (
      !sameRevision(preview.base, base) ||
      preview.horizonTicks !== horizon ||
      preview.completedTicks !== horizon
    )
      throw Error('Worker horizon is incomplete.');
    const s = snapshotData<T>(snapshot),
      stamp = { ...revisionOf(s), tick: base.tick };
    if (!sameRevision(stamp, base) || s.terrain.tick !== base.tick + horizon)
      throw Error('Worker preview boundary differs.');
    return {
      id,
      base: Object.freeze({ ...base }),
      horizonTicks: horizon,
      status: 'ready',
      preview: {
        ...s,
        preview: {
          base: Object.freeze({ ...base }),
          branchId,
          operation,
          horizonTicks: horizon,
          completedTicks: horizon,
        },
      } as TacticalPreview3D<T>,
    };
  }
  fields(value, ['id', 'base', 'horizonTicks', 'status', 'error']);
  if (
    !['superseded', 'cancelled', 'stale', 'closed', 'failed'].includes(value.status as string) ||
    (value.error !== null && (typeof value.error !== 'string' || value.error.length > 4096))
  )
    throw Error('Invalid worker preview result.');
  return {
    id,
    base: Object.freeze({ ...base }),
    horizonTicks: horizon,
    status: value.status,
    error: value.error,
  } as TacticalPreviewOutcome3D<T>;
}
export const workerError = (error: unknown) =>
  (error instanceof Error ? error.message : 'Worker operation failed.').slice(0, 4096);
