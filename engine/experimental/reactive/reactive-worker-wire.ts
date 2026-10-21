/** Data-only reactive transport. No browser, worker or physical work starts here. */
import { copyPortableValue } from '../../portable-data.js';
import {
  reactiveArray3D,
  reactiveFields3D as fields,
  reactiveInteger3D as integer,
  type ReactiveMaterialRegistry3D,
} from './reactive-registry.js';
import { compatibleReactiveDomains3D } from './reactive-domain-state.js';
import { readReactiveTickOptions3D } from './reactive-motion-capture.js';
import { readReactiveTranslationCapture3D } from './reactive-translation-motion.js';
import { readReactiveTransportCapture3D } from './reactive-transport-motion.js';
import {
  REACTIVE_SESSION_LIMITS_3D,
  readReactiveSessionSnapshot3D,
  type ReactiveGameValue3D,
  type ReactiveSessionSnapshot3D,
  type ReactiveSessionRevision3D,
} from './reactive-session-state.js';
import type {
  ReactiveSession3D,
  ReactiveSessionCommand3D,
  ReactiveBranchProgress3D,
} from './reactive-session.js';
export const REACTIVE_WORKER_PROTOCOL_3D = 'reactive-worker-2';
export const REACTIVE_WORKER_LIMITS_3D = Object.freeze({
  inFlight: 1,
  waiting: 1,
  work: 256,
  defaultWork: 64,
  slices: 262144,
  defaultSlices: 65536,
  timeoutMs: 10000,
  maxTimeoutMs: 60000,
});
/** Own this endpoint; send must use structured-clone isolation and ordered delivery. */
export interface ReactiveWorkerTransport3D {
  send(value: unknown): void;
  subscribe(receive: (value: unknown) => void, failed: (error: Error) => void): () => void;
  close(): void;
}
export type ReactiveWorkerPreviewOptions3D = Parameters<
  ReactiveSession3D<ReactiveGameValue3D>['branch']
>[0] & { maxSlices?: number };
export type ReactiveWorkerWire3D = {
  protocol: typeof REACTIVE_WORKER_PROTOCOL_3D;
  channel: string;
  seq: number;
  kind: string;
  payload: unknown;
};
export { fields, integer };
export function workerName(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value))
    throw Error('Invalid reactive worker identity.');
  return value;
}
export function workerMessage(
  channel: string,
  seq: number,
  kind: string,
  payload: unknown,
): ReactiveWorkerWire3D {
  return { protocol: REACTIVE_WORKER_PROTOCOL_3D, channel, seq, kind, payload };
}
export function workerEnvelope(value: unknown, channel: string): ReactiveWorkerWire3D {
  fields(value, ['protocol', 'channel', 'seq', 'kind', 'payload']);
  if (
    value.protocol !== REACTIVE_WORKER_PROTOCOL_3D ||
    value.channel !== channel ||
    typeof value.kind !== 'string'
  )
    throw Error('Incompatible reactive worker message.');
  integer(value.seq, 1, Number.MAX_SAFE_INTEGER);
  return value as ReactiveWorkerWire3D;
}
export function workerSameRevision(
  value: unknown,
  expected: Readonly<ReactiveSessionRevision3D>,
): boolean {
  fields(value, Object.keys(expected));
  return Object.entries(expected).every(([k, v]) => value[k] === v);
}
export function workerRequest<T extends ReactiveGameValue3D>(
  commands: readonly ReactiveSessionCommand3D<T>[],
  options: ReactiveWorkerPreviewOptions3D,
) {
  const list = reactiveArray3D(commands, REACTIVE_SESSION_LIMITS_3D.operations);
  const copied = copyPortableValue(
    list as ReactiveGameValue3D,
  ) as unknown as ReactiveSessionCommand3D<T>[];
  fields(options, ['horizonTicks'], ['motion', 'translation', 'transport', 'maxSlices']);
  const horizonTicks = integer(options.horizonTicks, 0, REACTIVE_SESSION_LIMITS_3D.horizonTicks);
  const maxSlices = Object.hasOwn(options, 'maxSlices')
    ? integer(options.maxSlices, 1, REACTIVE_WORKER_LIMITS_3D.slices)
    : REACTIVE_WORKER_LIMITS_3D.defaultSlices;
  const branch: Parameters<ReactiveSession3D<T>['branch']>[0] = { horizonTicks };
  if (Object.hasOwn(options, 'motion')) {
    const o = readReactiveTickOptions3D({ motion: options.motion });
    branch.motion = { maxEntries: o.maxEntries };
  }
  if (Object.hasOwn(options, 'translation'))
    branch.translation = readReactiveTranslationCapture3D(options.translation!);
  if (Object.hasOwn(options, 'transport'))
    branch.transport = readReactiveTransportCapture3D(options.transport!);
  return { commands: copied, options: { ...branch, maxSlices }, branch, maxSlices };
}
export function workerSnapshot<T extends ReactiveGameValue3D>(
  registry: ReactiveMaterialRegistry3D,
  raw: unknown,
  expected?: ReactiveSessionSnapshot3D<T>,
) {
  const s = readReactiveSessionSnapshot3D<T>(registry, raw);
  if (expected) {
    if (s.worldId !== expected.worldId || s.gameRulesVersion !== expected.gameRulesVersion)
      throw Error('Reactive worker session identity differs.');
    compatibleReactiveDomains3D(expected.domains, s.domains);
  }
  return s;
}
export function workerProgress(
  raw: unknown,
  commands: number,
  horizon: number,
  previous?: ReactiveBranchProgress3D,
): ReactiveBranchProgress3D {
  fields(raw, [
    'status',
    'phase',
    'completedCommands',
    'totalCommands',
    'completedTicks',
    'horizonTicks',
  ]);
  if (
    !['preparing', 'running', 'ready'].includes(raw.status as string) ||
    !['preparing', 'commands', 'ticks', 'finalize', 'terminal'].includes(raw.phase as string) ||
    raw.totalCommands !== commands ||
    raw.horizonTicks !== horizon
  )
    throw Error('Reactive worker progress differs.');
  const c = integer(raw.completedCommands, 0, commands),
    t = integer(raw.completedTicks, 0, horizon);
  if (
    (t > 0 && c !== commands) ||
    (raw.status === 'ready' && (c !== commands || t !== horizon || raw.phase !== 'terminal')) ||
    (raw.status === 'preparing' && (c !== 0 || t !== 0 || raw.phase !== 'preparing')) ||
    (raw.status === 'running' &&
      raw.phase !== (c < commands ? 'commands' : t < horizon ? 'ticks' : 'finalize')) ||
    (previous &&
      (c < previous.completedCommands ||
        t < previous.completedTicks ||
        previous.status === 'ready'))
  )
    throw Error('Reactive worker progress regressed.');
  return { ...raw } as ReactiveBranchProgress3D;
}
/** Canonical validators own object field ordering; game object ordering is not semantic. */
export function workerEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const x = Object.keys(a),
    y = Object.keys(b);
  return (
    x.length === y.length &&
    x.every(
      (k) =>
        Object.hasOwn(b, k) &&
        workerEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  );
}
export const workerError = (error: unknown) =>
  (error instanceof Error ? error.message : 'Reactive worker failed.').slice(0, 4096);
