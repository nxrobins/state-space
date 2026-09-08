import { describe, expect, it } from 'vitest';
import { PROFILE_STORAGE_KEY, createDefaultProfile, loadProfile, resetProfile, saveProfile, type StorageLike } from './profile';

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('profile persistence', () => {
  it('creates and saves a durable profile with starter unlocks', () => {
    const storage = new MemoryStorage();
    const profile = loadProfile(storage);

    expect(profile.unlockedCards).toContain('build_frost');
    expect(profile.unlockedRelics).toContain('emberLens');
    expect(profile.unlockedHeroes).toContain('kiteRanger');
    expect(profile.unlockedMaps).toContain('woodlandRelay');
    expect(profile.coreAxes.archive).toBe(0);
    expect(storage.getItem(PROFILE_STORAGE_KEY)).toContain('Relay Keeper');
  });

  it('normalizes older saved profiles without losing progress', () => {
    const storage = new MemoryStorage();
    const profile = createDefaultProfile(new Date('2026-05-30T00:00:00Z'));
    profile.bestWave = 4;
    profile.unlockedCards = [];
    saveProfile(profile, storage);

    const loaded = loadProfile(storage);

    expect(loaded.bestWave).toBe(4);
    expect(loaded.unlockedCards).toContain('build_frost');
    expect(loaded.unlockedMaps).toContain('woodlandRelay');
    expect(loaded.coreAxes.engineering).toBe(0);
  });

  it('resets profile progress intentionally', () => {
    const storage = new MemoryStorage();
    const profile = loadProfile(storage);
    profile.memoryShards = 99;
    saveProfile(profile, storage);

    const reset = resetProfile(storage);

    expect(reset.memoryShards).toBe(0);
    expect(loadProfile(storage).memoryShards).toBe(0);
  });
});
