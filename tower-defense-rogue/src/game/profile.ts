import {
  CORE_AXIS_DEFS,
  CORE_AXIS_IDS,
  type CardId,
  type CoreAxisId,
  type HeroKind,
  type MapId,
  type RelicId,
  PROFILE_START_UNLOCKS,
} from './content';

export const PROFILE_STORAGE_KEY = 'state-space.relic-line.profile.v1';

export interface Profile {
  id: string;
  name: string;
  createdAt: string;
  runs: number;
  wins: number;
  bestWave: number;
  memoryShards: number;
  unlockedCards: CardId[];
  unlockedRelics: RelicId[];
  unlockedHeroes: HeroKind[];
  unlockedMaps: MapId[];
  coreAxes: Record<CoreAxisId, number>;
  seenCards: CardId[];
  seenRelics: RelicId[];
  seenHeroes: HeroKind[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createDefaultCoreAxes(): Record<CoreAxisId, number> {
  return CORE_AXIS_IDS.reduce(
    (axes, axis) => {
      axes[axis] = 0;
      return axes;
    },
    {} as Record<CoreAxisId, number>,
  );
}

function normalizeCoreAxes(coreAxes: Partial<Record<CoreAxisId, number>> | undefined): Record<CoreAxisId, number> {
  const defaults = createDefaultCoreAxes();
  for (const axis of CORE_AXIS_IDS) {
    const value = coreAxes?.[axis];
    defaults[axis] = Number.isFinite(value) ? Math.min(CORE_AXIS_DEFS[axis].cap, Math.max(0, Math.floor(value ?? 0))) : 0;
  }
  return defaults;
}

export function createDefaultProfile(now = new Date()): Profile {
  return {
    id: 'local-profile',
    name: 'Relay Keeper',
    createdAt: now.toISOString(),
    runs: 0,
    wins: 0,
    bestWave: 0,
    memoryShards: 0,
    unlockedCards: [...PROFILE_START_UNLOCKS.cards],
    unlockedRelics: [...PROFILE_START_UNLOCKS.relics],
    unlockedHeroes: [...PROFILE_START_UNLOCKS.heroes],
    unlockedMaps: [...PROFILE_START_UNLOCKS.maps],
    coreAxes: createDefaultCoreAxes(),
    seenCards: [],
    seenRelics: [],
    seenHeroes: [],
  };
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function normalizeProfile(profile: Profile): Profile {
  return {
    ...createDefaultProfile(),
    ...profile,
    unlockedCards: unique([...(profile.unlockedCards ?? []), ...PROFILE_START_UNLOCKS.cards]),
    unlockedRelics: unique([...(profile.unlockedRelics ?? []), ...PROFILE_START_UNLOCKS.relics]),
    unlockedHeroes: unique([...(profile.unlockedHeroes ?? []), ...PROFILE_START_UNLOCKS.heroes]),
    unlockedMaps: unique([...(profile.unlockedMaps ?? []), ...PROFILE_START_UNLOCKS.maps]),
    coreAxes: normalizeCoreAxes(profile.coreAxes),
    seenCards: unique(profile.seenCards ?? []),
    seenRelics: unique(profile.seenRelics ?? []),
    seenHeroes: unique(profile.seenHeroes ?? []),
  };
}

export function loadProfile(storage: StorageLike | undefined = globalThis.localStorage): Profile {
  if (!storage) {
    return createDefaultProfile();
  }

  const raw = storage.getItem(PROFILE_STORAGE_KEY);
  if (!raw) {
    const profile = createDefaultProfile();
    saveProfile(profile, storage);
    return profile;
  }

  try {
    return normalizeProfile(JSON.parse(raw) as Profile);
  } catch {
    const profile = createDefaultProfile();
    saveProfile(profile, storage);
    return profile;
  }
}

export function saveProfile(profile: Profile, storage: StorageLike | undefined = globalThis.localStorage): void {
  if (!storage) {
    return;
  }
  storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(normalizeProfile(profile)));
}

export function resetProfile(storage: StorageLike | undefined = globalThis.localStorage): Profile {
  const profile = createDefaultProfile();
  saveProfile(profile, storage);
  return profile;
}

export function addUnique<T>(list: T[], item: T): boolean {
  if (list.includes(item)) {
    return false;
  }
  list.push(item);
  return true;
}
