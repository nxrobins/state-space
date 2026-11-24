import { REPLAY_SCHEMA_VERSION } from './simulation/constants';
import type { MatchResult, ReplayLog } from './simulation/types';

const RUNNING_REPLAY_KEY = 'element-fighter:running-replay';
let storageAvailable = true;
export const replayStorageAvailable = () => storageAvailable;

function withStorage<T>(fallback: T, operation: (storage: Storage) => T): T {
  try {
    const storage = typeof window === 'undefined' ? undefined : window.sessionStorage;
    if (!storage) throw Error('Session storage unavailable');
    const result = operation(storage);
    storageAvailable = true;
    return result;
  } catch {
    storageAvailable = false;
    return fallback;
  }
}

const COMPLETED_REPLAY_PREFIX = 'element-fighter:completed:';

export function loadRunningReplay(): ReplayLog | null {
  const raw = withStorage<string | null>(null, (storage) => storage.getItem(RUNNING_REPLAY_KEY));
  if (!raw) return null;
  try {
    const log = JSON.parse(raw) as ReplayLog;
    if (log.schemaVersion !== REPLAY_SCHEMA_VERSION || !Array.isArray(log.frames)) {
      clearRunningReplay();
      return null;
    }
    return log;
  } catch {
    clearRunningReplay();
    return null;
  }
}

export function saveRunningReplay(log: ReplayLog): boolean {
  return withStorage(false, (storage) => {
    storage.setItem(RUNNING_REPLAY_KEY, JSON.stringify(log));
    return true;
  });
}

export function clearRunningReplay(): void {
  withStorage(undefined, (storage) => storage.removeItem(RUNNING_REPLAY_KEY));
}

export function saveCompletedReplay(log: ReplayLog, result: MatchResult): boolean {
  return withStorage(false, (storage) => {
    storage.setItem(`${COMPLETED_REPLAY_PREFIX}${log.matchId}`, JSON.stringify({ ...log, completedResult: result }));
    storage.removeItem(RUNNING_REPLAY_KEY);
    return true;
  });
}
