/** Private, versioned, bounded Worker transport. No browser or physics starts on import. */
import { assertRecordFields, copyPortableValue, type PortableValue } from '../../portable-data.js';
export const MULTIPHYSICS_WORKER_PROTOCOL_3D = 'multiphysics-worker-1';
export interface MultiphysicsWorkerTransport3D {
  /** Ordered, structured-clone isolated delivery; this endpoint is owned by the adapter. */
  send(value: unknown): void;
  subscribe(receive: (value: unknown) => void, failed: (error: Error) => void): () => void;
  close(): void;
}
export type MultiphysicsWorkerMessage3D = {
  protocol: typeof MULTIPHYSICS_WORKER_PROTOCOL_3D;
  seq: number;
  kind: string;
  payload: unknown;
};
export type MultiphysicsTaskScheduler3D = (task: () => void) => () => void;
export function fields(
  value: unknown,
  required: string[],
  optional: string[] = [],
): asserts value is Record<string, unknown> {
  assertRecordFields(value, required, optional, 'Invalid multiphysics Worker fields.');
}
export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw Error('Invalid multiphysics Worker integer.');
  return value;
}
export function owned<T>(value: T): T {
  return copyPortableValue(value as PortableValue) as T;
}
export function message(seq: number, kind: string, payload: unknown): MultiphysicsWorkerMessage3D {
  return { protocol: MULTIPHYSICS_WORKER_PROTOCOL_3D, seq, kind, payload };
}
export function envelope(raw: unknown): MultiphysicsWorkerMessage3D {
  assertRecordFields(
    raw,
    ['protocol', 'seq', 'kind', 'payload'],
    [],
    'Invalid multiphysics Worker envelope.',
  );
  if (
    raw.protocol !== MULTIPHYSICS_WORKER_PROTOCOL_3D ||
    typeof raw.kind !== 'string' ||
    raw.kind.length > 32
  )
    throw Error('Incompatible multiphysics Worker protocol.');
  integer(raw.seq, 1);
  return owned(raw) as MultiphysicsWorkerMessage3D;
}
export const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : 'Multiphysics Worker failed.').slice(0, 4096);
/** One pending macrotask, without the nested timer minimum delay. */
export function createMultiphysicsTaskQueue3D(): {
  schedule: MultiphysicsTaskScheduler3D;
  close(): void;
} {
  const channel = new MessageChannel();
  let task: (() => void) | undefined,
    closed = false;
  channel.port1.onmessage = () => {
    const next = task;
    task = undefined;
    next?.();
  };
  return {
    schedule(next) {
      if (closed || task) throw Error('Task queue is unavailable.');
      task = next;
      channel.port2.postMessage(null);
      return () => {
        if (task === next) task = undefined;
      };
    },
    close() {
      closed = true;
      task = undefined;
      channel.port1.close();
      channel.port2.close();
    },
  };
}
