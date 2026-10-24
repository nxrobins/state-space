/** Mechanical/internal conversion on the owned candidate. Sub-lattice energy stays explicit. */
import { depositParcelHeat3D, type ThermalParcel3D } from './thermal.js';
import type { MultiphysicsProfiles3D } from './profiles.js';
import { MULTIPHYSICS_SUBQ_PER_ENERGY_3D, type MultiphysicsSnapshot3D } from './model.js';

/**
 * Signed mechanical-energy transfer into parcel enthalpy. This is not an external
 * edit or a residual correction: callers must identify the matching physical work.
 * Validate both replacements before mutating the supplied private candidate.
 */
export function depositMechanicalHeat3D(
  profiles: MultiphysicsProfiles3D,
  state: MultiphysicsSnapshot3D,
  id: string,
  energy: number,
): void {
  if (typeof energy !== 'number' || !Number.isFinite(energy))
    throw Error('Mechanical heat must be finite.');
  const at = state.parcels.findIndex((p) => p.id === id),
    remainder = state.conversionRemainders.find((row) => row.id === id);
  if (
    at < 0 ||
    !remainder ||
    !Number.isFinite(remainder.subQ) ||
    remainder.subQ < 0 ||
    remainder.subQ >= 1
  )
    throw Error('Mechanical heat requires an owned parcel remainder.');
  const scaled = energy * MULTIPHYSICS_SUBQ_PER_ENERGY_3D,
    whole = Math.floor(scaled);
  if (!Number.isSafeInteger(whole))
    throw Error('Mechanical heat conversion exceeds its integer range.');
  // Add the old fraction separately: a large whole-unit transfer must not swallow it.
  const fraction = scaled - whole + remainder.subQ,
    carry = Math.floor(fraction);
  const nextRemainder = fraction - carry;
  if (!Number.isFinite(nextRemainder) || nextRemainder < 0 || nextRemainder >= 1)
    throw Error('Invalid mechanical heat remainder.');
  const parcel: ThermalParcel3D = depositParcelHeat3D(
    profiles,
    state.parcels[at],
    BigInt(whole) + BigInt(carry),
  );
  state.parcels[at] = parcel;
  remainder.subQ = nextRemainder;
}
