import { afterEach, expect, test, vi } from 'vitest';
import { createReplayLog } from './replay';
import { clearRunningReplay, loadRunningReplay, replayStorageAvailable, saveCompletedReplay, saveRunningReplay } from './replayStorage';
import type { MatchResult } from './simulation/types';

afterEach(() => vi.unstubAllGlobals());
const log = () => createReplayLog('fire', 7, 'storage');
const denied = () => { throw Error('Storage denied'); };

test('denied reads, writes and removals allow in-memory play and expose save status', () => {
  vi.stubGlobal('window', { sessionStorage: { getItem: denied, setItem: denied, removeItem: denied } });
  expect(loadRunningReplay()).toBeNull();
  expect(saveRunningReplay(log())).toBe(false);
  expect(() => clearRunningReplay()).not.toThrow();
  expect(saveCompletedReplay(log(), {} as MatchResult)).toBe(false);
  expect(replayStorageAvailable()).toBe(false);
});
test('a denied storage getter is contained', () => {
  vi.stubGlobal('window', Object.defineProperty({}, 'sessionStorage', { get: denied }));
  expect(saveRunningReplay(log())).toBe(false);
  expect(loadRunningReplay()).toBeNull();
});
test('working storage round-trips and keeps a running save when completion cannot be written', () => {
  const records = new Map<string, string>();
  const storage = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { records.set(key, value); },
    removeItem: (key: string) => { records.delete(key); },
  };
  vi.stubGlobal('window', { sessionStorage: storage });
  expect(saveRunningReplay(log())).toBe(true);
  expect(loadRunningReplay()).toEqual(log());
  expect(replayStorageAvailable()).toBe(true);
  expect(saveCompletedReplay(log(), {} as MatchResult)).toBe(true);
  expect(loadRunningReplay()).toBeNull();
  expect(records.has('element-fighter:completed:storage')).toBe(true);
  expect(saveRunningReplay(log())).toBe(true);
  const beforeFailedWrite = new Map(records);
  storage.setItem = denied;
  expect(saveCompletedReplay(log(), {} as MatchResult)).toBe(false);
  expect(records).toEqual(beforeFailedWrite);
});
