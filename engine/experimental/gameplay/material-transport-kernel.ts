/** Shared arithmetic on owned, validated state. No world validation or publication. */
import { structuralNeighbor } from '../structural-mechanics.js';
import type { MaterialParcel3D, MaterialTransportReceipt3D } from './material-transport.js';
export const MATERIAL_TRANSPORT_KERNEL_LIMITS_3D = Object.freeze({
  parcels: 256,
  scale: 1024,
  speedQ: 2048,
  swaps: 1536,
});
type Cells = {
  width: number;
  height: number;
  depth: number;
  packedCells: number[];
  energyQ: number[];
  structure: number[];
};
export function createMaterialTransportKernel3D(
  s: Cells,
  parcels: MaterialParcel3D[],
  targetAllowed: (index: number) => boolean,
) {
  const occupied = new Map(parcels.map((p) => [p.cell, p.id])),
    Q = MATERIAL_TRANSPORT_KERNEL_LIMITS_3D.scale;
  const receipt: Pick<MaterialTransportReceipt3D, 'swaps' | 'parcels' | 'contacts'> = {
    swaps: [],
    parcels: [],
    contacts: [],
  };
  let completed = 0;
  return {
    complete: () => completed === parcels.length,
    receipt,
    advance() {
      if (completed >= parcels.length) throw Error('Transport arithmetic is complete.');
      const p = parcels[completed];
      const source = p.cell;
      for (const axis of [0, 2, 1]) {
        const distanceQ = p.remainderQ[axis] + p.velocityQ[axis],
          steps = Math.trunc(distanceQ / Q);
        p.remainderQ[axis] = distanceQ - steps * Q || 0;
        const sign = steps < 0 ? -1 : 1,
          direction = axis * 2 + Number(sign > 0);
        for (let k = 0; k < Math.abs(steps); k++) {
          const target = structuralNeighbor(p.cell, direction, s),
            peer = occupied.get(target);
          if (target < 0 || peer !== undefined || !targetAllowed(target)) {
            receipt.contacts.push({
              id: p.id,
              axis,
              source: p.cell,
              target: target < 0 ? null : target,
              normal: -sign,
              kind: target < 0 ? 'boundary' : peer !== undefined ? 'parcel' : 'material',
              parcelId: peer ?? null,
            });
            p.velocityQ[axis] = 0;
            p.remainderQ[axis] = 0;
            break;
          }
          for (const key of ['packedCells', 'energyQ', 'structure'] as const)
            [s[key][p.cell], s[key][target]] = [s[key][target], s[key][p.cell]];
          receipt.swaps.push([p.cell, target]);
          occupied.delete(p.cell);
          occupied.set(target, p.id);
          p.cell = target;
        }
      }
      receipt.parcels.push({ id: p.id, source, destination: p.cell });
      completed++;
      if (receipt.swaps.length > MATERIAL_TRANSPORT_KERNEL_LIMITS_3D.swaps)
        throw Error('Material transport swap budget exceeded.');
    },
  };
}

export function transportMaterialKernel3D(
  s: Cells,
  parcels: MaterialParcel3D[],
  targetAllowed: (index: number) => boolean,
) {
  const job = createMaterialTransportKernel3D(s, parcels, targetAllowed);
  while (!job.complete()) job.advance();
  return job.receipt;
}
