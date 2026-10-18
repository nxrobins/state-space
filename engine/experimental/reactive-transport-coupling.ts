/** Follow actual material provenance without applying another transport cycle. */
import { MAT } from '../generated/materials.js';
import type { ReactiveMaterialRegistry3D } from './reactive-registry.js';
import { reactiveGeometrySource3D, type ReactiveGameplayGeometry3D } from './reactive-geometry.js';
import { reactiveTickMovementSource3D, type ReactiveTickMovement3D } from './reactive-motion.js';
import { reactiveTranslationMovementSource3D, type ReactiveTranslationMovement3D } from './reactive-translation-motion.js';
import { reactiveTransportMovementSource3D, type ReactiveTransportMovement3D } from './reactive-transport-motion.js';
import { reactiveTransportBoundary3D, reactiveTransportEligibility3D, captureReactiveMaterialTransportMemory3D, restoreReactiveMaterialTransportMemory3D,
  type ReactiveMaterialTransportMemory3D } from './reactive-transport.js';

/** A disabled/overflowed or foreign observation cannot advance authoritative control. */
export function followReactiveMaterialTransport3D(registry: ReactiveMaterialRegistry3D, before: ReactiveGameplayGeometry3D, after: ReactiveGameplayGeometry3D,
  movement: ReactiveTickMovement3D | ReactiveTranslationMovement3D | ReactiveTransportMovement3D, memory: ReactiveMaterialTransportMemory3D) {
  const a = reactiveGeometrySource3D(before), b = reactiveGeometrySource3D(after);
  const source = movement.scope === 'reactive-tick-domain' ? reactiveTickMovementSource3D(movement)
    : movement.scope === 'reactive-transport-domain' ? reactiveTransportMovementSource3D(movement) : reactiveTranslationMovementSource3D(movement);
  if (source.before !== a.token || source.after !== b.token || JSON.stringify(source.from) !== JSON.stringify(before.stamp) ||
    JSON.stringify(source.to) !== JSON.stringify(after.stamp)) throw Error('Reactive transport needs the exact executed boundaries.');
  const paths = 'trace' in source ? source.trace : source.paths;
  if (!paths || paths.status !== 'complete') throw Error('Reactive transport requires complete executed movement; recompute with capture.');
  const previous = restoreReactiveMaterialTransportMemory3D(registry, before, memory), boundary = reactiveTransportBoundary3D(registry, after);
  const next = {...previous, ...boundary, parcels: [] as typeof previous.parcels}, destinations = new Map<number, number>();
  for (const pass of paths.passes) for (const s of pass.segments) destinations.set(s.origin, s.to);
  const eligible = reactiveTransportEligibility3D(registry, next.world), moved: {id: string; from: number; to: number}[] = [];
  const retired: {id: string; cell: number; reason: 'air' | 'immobile'}[] = [];
  for (const p of previous.parcels) {
    const cell = destinations.get(p.cell) ?? p.cell; moved.push({id: p.id, from: p.cell, to: cell});
    if (eligible(cell)) next.parcels.push({...p, cell});
    else retired.push({id: p.id, cell, reason: (next.world.block.packedCells[cell] & 255) === MAT.AIR ? 'air' : 'immobile'});
  }
  return {memory: captureReactiveMaterialTransportMemory3D(registry, next), moved, retired, from: structuredClone(source.from), to: structuredClone(source.to)};
}
