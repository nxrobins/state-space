/** Private canonical nodes are replace-only. Never expose them through the public SDK. */
import type { TacticalSessionSnapshot3D, TacticalValue } from './tactical-session-view.js';

/** Internal verification seam only; the public factory uses shared storage. */
export type TacticalSnapshotReuseOptions3D = {
  mode?: 'shared' | 'copy';
  freezeForVerification?: boolean;
  measureForVerification?: boolean;
};
export type TacticalSnapshotReuseStats3D = {
  mode: 'shared' | 'copy';
  forks: number;
  copiedCellCoordinates: number;
  sharedCellCoordinates: number;
  saturated: boolean;
};
const measurements = new WeakMap<object, () => TacticalSnapshotReuseStats3D | null>();
function freezeTree(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeTree(child);
  Object.freeze(value);
}
export function createTacticalSnapshotReuse3D<T extends TacticalValue>(
  copy: (s: TacticalSessionSnapshot3D<T>) => TacticalSessionSnapshot3D<T>,
  options: TacticalSnapshotReuseOptions3D = {},
) {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some(
      (k) => !['mode', 'freezeForVerification', 'measureForVerification'].includes(k as string),
    ) ||
    Object.values(Object.getOwnPropertyDescriptors(options)).some(
      (d) => !('value' in d) || !d.enumerable,
    )
  )
    throw Error('Invalid private snapshot reuse options.');
  const mode = options.mode ?? 'shared',
    freeze = options.freezeForVerification ?? false,
    measure = options.measureForVerification ?? false;
  if (
    !['shared', 'copy'].includes(mode) ||
    typeof freeze !== 'boolean' ||
    typeof measure !== 'boolean'
  )
    throw Error('Invalid private snapshot reuse mode.');
  const counts: TacticalSnapshotReuseStats3D = {
    mode,
    forks: 0,
    copiedCellCoordinates: 0,
    sharedCellCoordinates: 0,
    saturated: false,
  };
  const add = (key: 'forks' | 'copiedCellCoordinates' | 'sharedCellCoordinates', value: number) => {
    const next = counts[key] + value;
    if (!Number.isSafeInteger(next)) {
      counts[key] = Number.MAX_SAFE_INTEGER;
      counts.saturated = true;
    } else counts[key] = next;
  };
  return Object.freeze({
    /** Called only on owned validated state; production does not scan or freeze it. */
    retain(s: TacticalSessionSnapshot3D<T>) {
      if (freeze) freezeTree(s);
      return s;
    },
    fork(s: TacticalSessionSnapshot3D<T>) {
      if (measure) {
        const cells =
          s.terrain.packedCells.length +
          s.reservoirs.reduce((n, r) => n + r.terrain.packedCells.length, 0);
        add('forks', 1);
        add(mode === 'copy' ? 'copiedCellCoordinates' : 'sharedCellCoordinates', cells * 3);
      }
      const result = mode === 'copy' ? copy(s) : s;
      if (freeze) freezeTree(result);
      return result;
    },
    stats: () => (measure ? { ...counts } : null),
  });
}
export function attachTacticalSnapshotReuse3D(
  session: object,
  read: () => TacticalSnapshotReuseStats3D | null,
) {
  if (read() !== null) measurements.set(session, read);
}
/** Test-only counters, not persisted state or wall-clock/heap performance evidence. */
export function inspectTacticalSnapshotReuse3D(session: object): TacticalSnapshotReuseStats3D {
  const value = measurements.get(session)?.();
  if (!value) throw Error('Snapshot reuse measurement was not enabled.');
  return value;
}
