/** Finite battery energy bookkeeping. Geometry and network construction belong to the world. */
import { assertRecordFields, copyPortableValue, type PortableValue } from '../../portable-data.js';
export const BATTERY_ENERGY_SCALE_3D = 256;
export const BATTERY_SUBQ_3D = 1048576;
export type BatteryCore3D = { id: string; energyQ: number; energyFractionQ: number };
export type PhysicalBattery3D = {
  id: string;
  positive: string;
  negative: string;
  cores: BatteryCore3D[];
  emf: number;
  internalResistance: number;
  failureRateQPerSecond: number;
  failureTemperature: number;
  failed: boolean;
  /** Fractional scheduled draw, below one sub-Q unit; not energy already withdrawn. */
  drawRemainderUnits: number;
};
export type BatteryHeat3D = { id: string; units: string };
export type BatteryStep3D = {
  battery: PhysicalBattery3D;
  heat: BatteryHeat3D[];
  drawnUnits: string;
  activeSeconds: number;
  depleted: boolean;
};
const id = (v: unknown): string => {
  if (typeof v !== 'string' || !v.length || v.length > 128)
    throw Error('Invalid battery parcel identity.');
  return v;
};
function number(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw Error('Invalid battery quantity.');
  return v;
}
function units(core: BatteryCore3D): bigint {
  return (
    BigInt(core.energyQ) * BigInt(BATTERY_SUBQ_3D) + BigInt(core.energyFractionQ * BATTERY_SUBQ_3D)
  );
}
export function readPhysicalBattery3D(raw: unknown): PhysicalBattery3D {
  const value = copyPortableValue(raw as PortableValue) as unknown as PhysicalBattery3D;
  assertRecordFields(
    value,
    [
      'id',
      'positive',
      'negative',
      'cores',
      'emf',
      'internalResistance',
      'failureRateQPerSecond',
      'failureTemperature',
      'failed',
      'drawRemainderUnits',
    ],
    [],
    'Invalid battery fields.',
  );
  id(value.id);
  id(value.positive);
  id(value.negative);
  if (value.positive === value.negative) throw Error('Battery terminals must differ.');
  number(value.emf, 0, 1000);
  number(value.internalResistance, 1e-6, 1e6);
  number(value.failureRateQPerSecond, 1, 1e9);
  number(value.failureTemperature, 0, 1e6);
  number(value.drawRemainderUnits, 0, 1 - Number.EPSILON / 2);
  if (typeof value.failed !== 'boolean') throw Error('Invalid battery failure state.');
  if (!Array.isArray(value.cores) || !value.cores.length || value.cores.length > 32)
    throw Error('Invalid battery cores.');
  for (const core of value.cores) {
    assertRecordFields(
      core,
      ['id', 'energyQ', 'energyFractionQ'],
      [],
      'Invalid battery core fields.',
    );
    id(core.id);
    number(core.energyQ, 0, 1e9);
    number(core.energyFractionQ, 0, 1 - 1 / BATTERY_SUBQ_3D);
    if (
      !Number.isSafeInteger(core.energyQ) ||
      !Number.isSafeInteger(core.energyFractionQ * BATTERY_SUBQ_3D)
    )
      throw Error('Battery stores must use the energy lattice.');
  }
  value.cores.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (new Set(value.cores.map((c) => c.id)).size !== value.cores.length)
    throw Error('Duplicate battery core.');
  if (value.cores.reduce((s, c) => s + units(c), 0n) > 1000000000n * BigInt(BATTERY_SUBQ_3D))
    throw Error('Battery capacity exceeds limit.');
  return value;
}
/** Exact proportional integer allocation, stable lexical identities break remainder ties. */
function allocate(total: bigint, weights: { id: string; weight: bigint }[]): Map<string, bigint> {
  const denominator = weights.reduce((sum, row) => sum + row.weight, 0n);
  if (denominator === 0n) {
    if (total !== 0n) throw Error('Positive energy requires a destination.');
    return new Map(weights.map((row) => [row.id, 0n]));
  }
  const parts = weights.map((row) => ({
    id: row.id,
    amount: (total * row.weight) / denominator,
    remainder: (total * row.weight) % denominator,
  }));
  let left = total - parts.reduce((s, row) => s + row.amount, 0n);
  const order = [...parts].sort((a, b) =>
    a.remainder === b.remainder
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const row of order)
    if (left > 0n) {
      row.amount++;
      left--;
    }
  if (left !== 0n) throw Error('Energy allocation failed.');
  return new Map(parts.map((row) => [row.id, row.amount]));
}
export function batteryStoredUnits3D(raw: PhysicalBattery3D): string {
  return String(readPhysicalBattery3D(raw).cores.reduce((s, c) => s + units(c), 0n));
}
/**
 * Deposits paid electrical losses, or failed-core discharge. The caller supplies
 * all branch and internal losses in mechanical energy/time units. Network/source
 * consistency is checked by the circuit solver before this function is called.
 * Failure is sticky and overrides electrical output; core IDs survive fracture.
 */
export function stepBatteryEnergy3D(
  raw: PhysicalBattery3D,
  losses: readonly { id: string; power: number }[],
  dt: number,
  damaged = false,
): BatteryStep3D {
  const battery = readPhysicalBattery3D(raw),
    rows = copyPortableValue(losses as unknown as PortableValue) as unknown as {
      id: string;
      power: number;
    }[];
  number(dt, 1e-6, 1);
  if (typeof damaged !== 'boolean') throw Error('Invalid battery damage.');
  if (!Array.isArray(rows) || rows.length > 16384) throw Error('Invalid battery loss list.');
  const powers = new Map<string, number>();
  for (const row of rows) {
    assertRecordFields(row, ['id', 'power'], [], 'Invalid battery loss fields.');
    id(row.id);
    number(row.power, 0, 1e15);
  }
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.power - b.power));
  for (const row of rows) powers.set(row.id, (powers.get(row.id) ?? 0) + row.power);
  battery.failed ||= damaged;
  const available = battery.cores.reduce((s, c) => s + units(c), 0n);
  const totalPower = battery.failed
    ? battery.failureRateQPerSecond / BATTERY_ENERGY_SCALE_3D
    : [...powers.values()].reduce((a, b) => a + b, 0);
  if (!Number.isFinite(totalPower)) throw Error('Battery power overflow.');
  const rate = totalPower * BATTERY_ENERGY_SCALE_3D * BATTERY_SUBQ_3D;
  const previousRemainder = battery.drawRemainderUnits;
  const scheduled = rate * dt + previousRemainder;
  const draw =
    available === 0n
      ? 0n
      : scheduled >= Number(available)
        ? available
        : BigInt(Math.floor(scheduled));
  battery.drawRemainderUnits = draw === available ? 0 : scheduled - Math.floor(scheduled);
  const debits = allocate(
    draw,
    battery.cores.map((c) => ({ id: c.id, weight: units(c) })),
  );
  let heat: BatteryHeat3D[];
  if (battery.failed) {
    heat = battery.cores.map((c) => ({ id: c.id, units: String(debits.get(c.id)!) }));
  } else {
    const maxPower = Math.max(0, ...powers.values());
    // Only weights are quantized; every withdrawn energy unit is allocated exactly.
    const weights = [...powers]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([identity, power]) => ({
        id: identity,
        weight: BigInt(maxPower === 0 ? 0 : Math.round((power / maxPower) * 1e12)),
      }));
    heat = [...allocate(draw, weights)].map(([identity, amount]) => ({
      id: identity,
      units: String(amount),
    }));
  }
  for (const core of battery.cores) {
    const remaining = units(core) - debits.get(core.id)!;
    core.energyQ = Number(remaining / BigInt(BATTERY_SUBQ_3D));
    core.energyFractionQ = Number(remaining % BigInt(BATTERY_SUBQ_3D)) / BATTERY_SUBQ_3D;
  }
  return {
    battery,
    heat,
    drawnUnits: String(draw),
    activeSeconds:
      rate === 0 || available === 0n
        ? 0
        : draw === available
          ? Math.min(dt, Math.max(0, (Number(available) - previousRemainder) / rate))
          : dt,
    depleted: draw === available,
  };
}
