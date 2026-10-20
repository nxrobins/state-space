/** Saved positional constraints; temporary anchor bits never become canonical state. */
import { PHASE, PHASE_SHIFT, COLD_STRIDE, COLD_COHESION } from '../../generated/materials.js';
import { ANCHOR_3D } from '../structural-mechanics.js';
import { reactiveArray3D, reactiveFields3D, reactiveInteger3D, reactiveRegistrySource3D, type ReactiveMaterialRegistry3D } from './reactive-registry.js';
import type { ReactiveMaterialBlock3D } from './reactive-block.js';

export const REACTIVE_HOLD_RULES_3D = 'reactive-holds-1';
export const REACTIVE_HOLD_LIMITS_3D = Object.freeze({holds: 64, cells: 32768, lifetimeTicks: 1024});
export type ReactiveHold3D = {id: string; expiresAtTick: number; cells: number[]};
export type ReactiveHoldRequest3D = {id: string; expiresAtTick: number; cells: readonly (readonly [number, number, number])[]};
export type ReactiveHoldTickReport3D = {rulesVersion: typeof REACTIVE_HOLD_RULES_3D; before: ReactiveHold3D[]; after: ReactiveHold3D[];
  expired: string[]; retired: {id: string; cells: number[]}[]; movementCells: number[]; structureCells: number[]};
const identity = (id: unknown): string => {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(id)) throw Error('Invalid reactive hold identity.'); return id;
};
export const copyReactiveHolds3D = (holds: readonly ReactiveHold3D[]): ReactiveHold3D[] => holds.map(h => ({...h, cells: h.cells.slice()}));
export const reactiveHeldCells3D = (holds: readonly ReactiveHold3D[]): number[] => holds.flatMap(h => h.cells).sort((a, b) => a - b);
const eligible = (word: number, cold: Uint32Array) => [PHASE.SOLID, PHASE.FROZEN].some(p => p === (word >>> PHASE_SHIFT & 15)) && cold[(word & 255) * COLD_STRIDE + COLD_COHESION] > 0;

/** Requires an already validated block and exact tick; owns all returned records. */
export function validateReactiveHolds3D(registry: ReactiveMaterialRegistry3D, raw: unknown, tick: number, block: ReactiveMaterialBlock3D): ReactiveHold3D[] {
  const rows = reactiveArray3D(raw, REACTIVE_HOLD_LIMITS_3D.holds), cold = reactiveRegistrySource3D(registry).cold;
  const ids = new Set<string>(), occupied = new Set<number>();
  const holds = rows.map(row => {
    reactiveFields3D(row, ['id', 'expiresAtTick', 'cells']); const id = identity(row.id);
    if (ids.has(id)) throw Error('Duplicate reactive hold identity.'); ids.add(id);
    const expiresAtTick = reactiveInteger3D(row.expiresAtTick, 0, Number.MAX_SAFE_INTEGER);
    if (expiresAtTick <= tick || expiresAtTick - tick > REACTIVE_HOLD_LIMITS_3D.lifetimeTicks) throw Error('Reactive hold expiry is outside its lifetime window.');
    const cells = reactiveArray3D(row.cells, REACTIVE_HOLD_LIMITS_3D.cells).map(value => {
      const i = reactiveInteger3D(value, 0, block.packedCells.length - 1);
      if (occupied.has(i)) throw Error('Reactive held cells must be disjoint.'); occupied.add(i);
      if (occupied.size > REACTIVE_HOLD_LIMITS_3D.cells || !eligible(block.packedCells[i], cold)) throw Error('Reactive hold requires bounded cohesive solid/frozen matter.');
      return i;
    }).sort((a, b) => a - b);
    if (!cells.length) throw Error('Reactive hold requires at least one cell.');
    return {id, expiresAtTick, cells};
  });
  return holds.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export function addReactiveHold3D(registry: ReactiveMaterialRegistry3D, block: ReactiveMaterialBlock3D, tick: number, holds: readonly ReactiveHold3D[], request: ReactiveHoldRequest3D): ReactiveHold3D[] {
  reactiveFields3D(request, ['id', 'expiresAtTick', 'cells']);
  const cells = reactiveArray3D(request.cells, REACTIVE_HOLD_LIMITS_3D.cells).map(value => {
    const c = reactiveArray3D(value, 3); if (c.length !== 3) throw Error('Reactive hold needs three coordinates.');
    const x = reactiveInteger3D(c[0], 0, block.width - 1), y = reactiveInteger3D(c[1], 0, block.height - 1), z = reactiveInteger3D(c[2], 0, block.depth - 1);
    return x + block.width * (y + block.height * z);
  });
  return validateReactiveHolds3D(registry, [...holds, {id: request.id, expiresAtTick: request.expiresAtTick, cells}], tick, block);
}
export function removeReactiveHold3D(holds: readonly ReactiveHold3D[], id: string): ReactiveHold3D[] {
  identity(id); if (!holds.some(h => h.id === id)) throw Error('Unknown reactive hold.'); return copyReactiveHolds3D(holds.filter(h => h.id !== id));
}
export function reactiveHoldsAfterReplacement3D(holds: readonly ReactiveHold3D[], replaced: readonly number[]): ReactiveHold3D[] {
  const removed = new Set(replaced); return holds.map(h => ({...h, cells: h.cells.filter(i => !removed.has(i))})).filter(h => h.cells.length > 0);
}
export function overlayReactiveHolds3D(block: ReactiveMaterialBlock3D, holds: readonly ReactiveHold3D[]): ReactiveMaterialBlock3D {
  const out = {...block, structure: block.structure.slice()}; for (const h of holds) for (const i of h.cells) out.structure[i] |= ANCHOR_3D; return out;
}
export function stripReactiveHoldAnchors3D(canonicalBefore: ReactiveMaterialBlock3D, after: ReactiveMaterialBlock3D, holds: readonly ReactiveHold3D[]): ReactiveMaterialBlock3D {
  const out = {...after, structure: after.structure.slice()};
  for (const h of holds) for (const i of h.cells) if (!(canonicalBefore.structure[i] & ANCHOR_3D)) out.structure[i] &= ~ANCHOR_3D;
  return out;
}
export function retireReactiveHolds3D(registry: ReactiveMaterialRegistry3D, before: ReactiveMaterialBlock3D, after: ReactiveMaterialBlock3D, holds: readonly ReactiveHold3D[], transformed: ReadonlySet<number>) {
  const cold = reactiveRegistrySource3D(registry).cold, retired: ReactiveHoldTickReport3D['retired'] = [];
  const survivors = holds.map(h => {
    const removed = h.cells.filter(i => transformed.has(i) || (before.packedCells[i] & 255) !== (after.packedCells[i] & 255) || !eligible(after.packedCells[i], cold));
    if (removed.length) retired.push({id: h.id, cells: removed}); const excluded = new Set(removed);
    return {...h, cells: h.cells.filter(i => !excluded.has(i))};
  }).filter(h => h.cells.length > 0);
  return {holds: survivors, retired};
}
