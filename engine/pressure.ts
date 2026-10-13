/** Independent integer pressure reference. See docs/PRESSURE.md. */
import type { StructuralRules } from './structure.js';

export const PRESSURE_MASK = 0xffff0000;
export const MOVED = 0x4000;
export function fluidKind(packed: number): number {
  const phase = (packed >>> 24) & 15;
  return phase === 4 || phase === 5 ? 1 : phase === 2 || phase === 3 || phase === 7 ? 2 : 0;
}

export function updatePressure(grid: Uint32Array, energy: Uint32Array, words: Uint32Array, width: number, height: number, rules: StructuralRules): Uint32Array {
  const count = grid.length, kinds = Uint8Array.from(grid, fluidKind), seen = new Uint8Array(count);
  const result = words.slice(), queue = new Uint32Array(count);
  const adjacent = (i: number) => [i >= width ? i - width : -1, i % width ? i - 1 : -1,
    i % width + 1 < width ? i + 1 : -1, i + width < count ? i + width : -1];
  const relax = (i: number, target: number) => {
    const old = words[i] >>> 16, delta = Math.min(65535, target) - old;
    result[i] = (old + Math.sign(delta) * Math.ceil(Math.abs(delta) / 4)) * 65536;
  };
  for (const kind of [1, 2]) for (let root = 0; root < count; root += 1) {
    if (kinds[root] !== kind || seen[root]) continue;
    let tail = 1, sum = 0, top = height, headPressure = 0;
    queue[0] = root; seen[root] = 1;
    for (let cursor = 0; cursor < tail; cursor += 1) {
      const i = queue[cursor];
      if (kind === 1) sum += Math.min(66559, Math.floor((Math.floor(rules.temperature(grid[i], energy[i]) / 256) + 64) * 1024 / 84));
      else top = Math.min(top, Math.floor(i / width));
      for (const j of adjacent(i)) {
        if (j < 0) continue;
        if (kind === 2 && kinds[j] === 1) headPressure = Math.max(headPressure, result[j] >>> 16);
        if (kinds[j] === kind && !seen[j]) { seen[j] = 1; queue[tail++] = j; }
      }
    }
    const gasTarget = Math.max(0, Math.floor(sum / tail) - 1024);
    for (let cursor = 0; cursor < tail; cursor += 1) {
      const i = queue[cursor];
      relax(i, kind === 1 ? gasTarget : headPressure + (Math.floor(i / width) - top + 1) * Math.max(1, Math.ceil(rules.material(grid[i]).density / 64)) * 16);
    }
  }
  return result;
}

export function pressureLoad(words: Uint32Array, i: number, width: number): number {
  const p = (j: number) => words[j] >>> 16;
  return Math.abs((i % width ? p(i - 1) : 0) - (i % width + 1 < width ? p(i + 1) : 0))
    + Math.abs((i >= width ? p(i - width) : 0) - (i + width < words.length ? p(i + width) : 0));
}
