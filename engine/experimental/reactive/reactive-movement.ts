/** Conservative local movement with profile-owned materials and mechanical boundaries. */
import { MAT, PHASE, PHASE_SHIFT, COLD_STRIDE, COLD_COHESION, COLD_DENSITY } from '../../generated/materials.js';
import { temperatureQ } from '../../thermal.js';
import { INTEGRITY_3D, ANCHOR_3D } from '../structural-mechanics.js';
import { readReactiveMaterialBlock3D, type ReactiveMaterialBlock3D } from './reactive-block.js';
import { reactiveRegistrySource3D, reactiveInteger3D, type ReactiveMaterialRegistry3D } from './reactive-registry.js';

export const REACTIVE_MOVEMENT_RULES_3D = 'reactive-movement-1';
export type ReactiveMovementPass3D = {kind: 'gravity' | 'diagonal' | 'liquid' | 'buoyancy' | 'gas'; axis: number; parity: number; direction: number};
export function reactiveMovementSchedule3D(tick: number): readonly Readonly<ReactiveMovementPass3D>[] {
  reactiveInteger3D(tick, 0, Number.MAX_SAFE_INTEGER);
  const passes: ReactiveMovementPass3D[] = [];
  const pairs = (kind: ReactiveMovementPass3D['kind'], axis: number, direction = 1) => {
    for (const parity of [0, 1]) passes.push({kind, axis, parity, direction});
  };
  pairs('gravity', 1);
  const directions = [[0, 1], [0, -1], [2, 1], [2, -1]];
  for (let k = 0; k < 4; k++) {const [axis, direction] = directions[(k + tick % 4) % 4]; pairs('diagonal', axis, direction);}
  const axes = tick % 2 ? [2, 0] : [0, 2];
  for (const axis of axes) pairs('liquid', axis);
  pairs('buoyancy', 1);
  for (const axis of axes) pairs('gas', axis);
  return Object.freeze(passes.map(p => Object.freeze(p)));
}
function choice(index: number, axis: number, tick: number): boolean {
  let h = (Math.imul(index, 374761393) + Math.imul(axis, 668265263) + Math.imul(tick >>> 0, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) & 1) === 0;
}
const phase = (word: number) => word >>> PHASE_SHIFT & 15;
const liquid = (word: number) => [PHASE.LIQUID, PHASE.VISCOUS, PHASE.MOLTEN].some(p => p === phase(word));
const gas = (word: number) => phase(word) === PHASE.GAS;

/** Trusted internal pass. The public wrappers validate input and select the frozen schedule. */
export function executeReactiveMovementPass3D(input: ReactiveMaterialBlock3D, cold: Uint32Array, tick: number, pass: Readonly<ReactiveMovementPass3D>, onSwap: (a: number, b: number) => void): ReactiveMaterialBlock3D {
  const {width: w, height: h, depth: d} = input, layer = w * h, cells = input.packedCells, energy = input.energyQ;
  const output = {...input, packedCells: cells.slice(), energyQ: energy.slice(), structure: input.structure.slice()};
  const cohesive = (i: number) => [PHASE.SOLID, PHASE.FROZEN].some(p => p === phase(cells[i])) && cold[(cells[i] & 255) * COLD_STRIDE + COLD_COHESION] > 0;
  const bound = (i: number) => [PHASE.SOLID, PHASE.FROZEN].some(p => p === phase(cells[i])) &&
    (!cohesive(i) || (input.structure[i] & (INTEGRITY_3D | ANCHOR_3D)) !== 0);
  const density = (i: number) => cold[(cells[i] & 255) * COLD_STRIDE + COLD_DENSITY];
  const falling = (i: number) => phase(cells[i]) === PHASE.POWDER || liquid(cells[i]) || cohesive(i);
  const canFall = (source: number, target: number) => falling(source) && !bound(source) && !bound(target) && density(source) > density(target);
  const rank = (i: number) => Math.floor(temperatureQ(cells[i], energy[i], cold) / 256) * 2 - density(i);
  const canRise = (a: number, b: number) => (cells[a] & 255) !== MAT.AIR && gas(cells[a]) && gas(cells[b]) && rank(a) > rank(b) + 16;
  const hasFall = (i: number, x: number, y: number, z: number) => y + 1 < h && (
    canFall(i, i + w) || (x > 0 && canFall(i, i + w - 1)) || (x + 1 < w && canFall(i, i + w + 1)) ||
    (z > 0 && canFall(i, i + w - layer)) || (z + 1 < d && canFall(i, i + w + layer)));
  const swap = (a: number, b: number) => {
    output.packedCells[a] = cells[b]; output.packedCells[b] = cells[a];
    output.energyQ[a] = energy[b]; output.energyQ[b] = energy[a];
    output.structure[a] = input.structure[b]; output.structure[b] = input.structure[a]; onSwap(a, b);
  };
  const pairAxis = ['gravity', 'diagonal', 'buoyancy'].includes(pass.kind) ? 1 : pass.axis;
  for (let z = pairAxis === 2 ? pass.parity : 0; z < d; z += pairAxis === 2 ? 2 : 1) {
    for (let y = pairAxis === 1 ? pass.parity : 0; y < h; y += pairAxis === 1 ? 2 : 1) {
      for (let x = pairAxis === 0 ? pass.parity : 0; x < w; x += pairAxis === 0 ? 2 : 1) {
        let tx = x + (pairAxis === 0 ? 1 : 0), ty = y + (pairAxis === 1 ? 1 : 0), tz = z + (pairAxis === 2 ? 1 : 0);
        if (pass.kind === 'diagonal') {tx += pass.axis === 0 ? pass.direction : 0; tz += pass.axis === 2 ? pass.direction : 0;}
        if (tx < 0 || tx >= w || ty >= h || tz < 0 || tz >= d) continue;
        const a = x + w * (y + h * z), b = tx + w * (ty + h * tz);
        if (pass.kind === 'gravity') {if (canFall(a, b)) swap(a, b);}
        else if (pass.kind === 'diagonal') {if (!canFall(a, a + w) && canFall(a, b)) swap(a, b);}
        else if (pass.kind === 'buoyancy') {if (canRise(b, a)) swap(a, b);}
        else if (pass.kind === 'liquid') {
          const spread = (s: number, t: number) => liquid(cells[s]) && gas(cells[t]) && density(s) > density(t);
          if ((spread(a, b) && !hasFall(a, x, y, z)) || (spread(b, a) && !hasFall(b, tx, ty, tz))) swap(a, b);
        } else {
          const [s, t, sy] = choice(a, pass.axis, tick) ? [a, b, y] : [b, a, ty];
          if ((cells[s] & 255) !== MAT.AIR && gas(cells[s]) && gas(cells[t]) && (sy === 0 || !canRise(s, s - w)) &&
              ((cells[t] & 255) === MAT.AIR || rank(s) > rank(t) + 16)) swap(s, t);
        }
      }
    }
  }
  return output;
}
/** Diagnostic single pass, selected by index; not a complete evolution tick. */
export function runReactiveMovementPass3D(registry: ReactiveMaterialRegistry3D, raw: ReactiveMaterialBlock3D, tick: number, passIndex: number) {
  const schedule = reactiveMovementSchedule3D(tick); reactiveInteger3D(passIndex, 0, schedule.length - 1);
  const input = readReactiveMaterialBlock3D(registry, raw), swaps: [number, number][] = [];
  const block = executeReactiveMovementPass3D(input, reactiveRegistrySource3D(registry).cold, tick, schedule[passIndex], (a, b) => swaps.push([a, b]));
  return {rulesVersion: REACTIVE_MOVEMENT_RULES_3D, tick, passIndex, pass: {...schedule[passIndex]}, swaps,
    block: readReactiveMaterialBlock3D(registry, block)};
}
