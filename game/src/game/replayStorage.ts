import { REPLAY_SCHEMA_VERSION } from './simulation/constants';
import type { MatchResult, ReplayLog } from './simulation/types';

const RUNNING_REPLAY_KEY = 'element-fighter:running-replay';
const COMPLETED_REPLAY_PREFIX = 'element-fighter:completed:';

export function loadRunningReplay(): ReplayLog | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(RUNNING_REPLAY_KEY);
    if (!raw) return null;
    const log = JSON.parse(raw) as ReplayLog;
    if (log.schemaVersion !== REPLAY_SCHEMA_VERSION || !Array.isArray(log.frames)) {
      storage.removeItem(RUNNING_REPLAY_KEY);
      return null;
    }
    return log;
  } catch {
    storage.removeItem(RUNNING_REPLAY_KEY);
    return null;
  }
}

export function saveRunningReplay(log: ReplayLog): void {
  getStorage()?.setItem(RUNNING_REPLAY_KEY, JSON.stringify(log));
}

export function clearRunningReplay(): void {
  getStorage()?.removeItem(RUNNING_REPLAY_KEY);
}

export function saveCompletedReplay(log: ReplayLog, result: MatchResult): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(
    `${COMPLETED_REPLAY_PREFIX}${log.matchId}`,
    JSON.stringify({ ...log, completedResult: result }),
  );
  storage.removeItem(RUNNING_REPLAY_KEY);
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
