export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  fork(label: string): Rng;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRng(seed: string | number): Rng {
  let state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  if (state === 0) {
    state = 0x9e3779b9;
  }

  const rng: Rng = {
    next() {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    },
    int(maxExclusive: number) {
      if (maxExclusive <= 0) {
        return 0;
      }
      return Math.floor(rng.next() * maxExclusive);
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new Error('Cannot pick from an empty list.');
      }
      return items[rng.int(items.length)];
    },
    shuffle<T>(items: readonly T[]): T[] {
      const copy = [...items];
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swapIndex = rng.int(index + 1);
        [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
      }
      return copy;
    },
    fork(label: string) {
      return createRng(`${state}:${label}`);
    },
  };

  return rng;
}
