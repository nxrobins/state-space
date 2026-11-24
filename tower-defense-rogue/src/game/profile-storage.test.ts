import { afterEach, expect, test, vi } from 'vitest';
import { loadProfile, profileStorageAvailable, saveProfile, resetProfile, type StorageLike } from './profile';
import { GameModel } from './simulation';

const denied = () => { throw Error('Storage denied'); };
afterEach(() => vi.unstubAllGlobals());

test('a failed profile read preserves existing storage and starts with an in-memory profile', () => {
  const storage: StorageLike = { getItem: denied, setItem: vi.fn(), removeItem: denied };
  const profile = loadProfile(storage);
  expect(profile.name).toBe('Relay Keeper');
  expect(storage.setItem).not.toHaveBeenCalled();
  expect(profileStorageAvailable()).toBe(false);
});
test('quota errors allow first launch, saving and reset without interrupting the model', () => {
  const storage: StorageLike = { getItem: () => null, setItem: denied, removeItem: denied };
  const model = new GameModel(storage);
  model.profile.memoryShards = 12;
  expect(() => model.save()).not.toThrow();
  expect(model.snapshot().profile.memoryShards).toBe(12);
  expect(saveProfile(model.profile, storage)).toBe(false);
  expect(() => resetProfile(storage)).not.toThrow();
  expect(profileStorageAvailable()).toBe(false);
});
test('denied localStorage access permits construction through the default entry point', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: denied });
  try {
    expect(() => new GameModel()).not.toThrow();
    expect(profileStorageAvailable()).toBe(false);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
test('a working store restores progress and recovers save availability', () => {
  const data = new Map<string, string>();
  const storage: StorageLike = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); },
  };
  const profile = loadProfile(storage);
  profile.memoryShards = 13;
  expect(saveProfile(profile, storage)).toBe(true);
  expect(loadProfile(storage).memoryShards).toBe(13);
  expect(profileStorageAvailable()).toBe(true);
});
