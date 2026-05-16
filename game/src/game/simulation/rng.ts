export function nextSeed(seed: number): number {
  return (seed * 1664525 + 1013904223) >>> 0;
}

export function randomFloat(seed: number): { seed: number; value: number } {
  const next = nextSeed(seed);
  return { seed: next, value: next / 0xffffffff };
}

export function randomInt(seed: number, maxExclusive: number): { seed: number; value: number } {
  const result = randomFloat(seed);
  return {
    seed: result.seed,
    value: Math.floor(result.value * maxExclusive),
  };
}
