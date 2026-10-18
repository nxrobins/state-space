/** Shared detail limits for observed carry; these never affect material physics. */
import { DISPLACEMENT_LIMITS_3D, type DisplacementOptions3D } from './displacement-kernel.js';
export const DISPLACEMENT_CARRY_LIMITS_3D = Object.freeze({...DISPLACEMENT_LIMITS_3D, defaultCarryEntries: 4096, carryEntries: 65536});
export type DisplacementCarryOptions3D = DisplacementOptions3D & {maxCarryEntries?: number};
export function readDisplacementCarryOptions3D(value: DisplacementCarryOptions3D) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(k => typeof k !== 'string' || !['maxContacts', 'maxEvents', 'maxWork', 'maxCarryEntries'].includes(k)) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d) || !d.enumerable)) throw Error('Invalid displacement carry options.');
  const {maxCarryEntries, ...common} = value, maximum = maxCarryEntries === undefined ? DISPLACEMENT_CARRY_LIMITS_3D.defaultCarryEntries : maxCarryEntries;
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > DISPLACEMENT_CARRY_LIMITS_3D.carryEntries) throw Error('Invalid displacement carry budget.');
  return {maximum, common};
}
