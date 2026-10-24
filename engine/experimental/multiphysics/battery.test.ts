import { expect, test } from 'vitest';
import {
  BATTERY_SUBQ_3D,
  batteryStoredUnits3D,
  readPhysicalBattery3D,
  stepBatteryEnergy3D,
  type PhysicalBattery3D,
} from './battery.js';
const initial = (): PhysicalBattery3D => ({
  id: 'battery',
  positive: 'positive',
  negative: 'negative',
  cores: [
    { id: 'core-b', energyQ: 4, energyFractionQ: 0 },
    { id: 'core-a', energyQ: 8, energyFractionQ: 0 },
  ],
  emf: 12,
  internalResistance: 2,
  failureRateQPerSecond: 3,
  failureTemperature: 180,
  failed: false,
  drawRemainderUnits: 0,
});
const heatTotal = (heat: { units: string }[]) => heat.reduce((sum, h) => sum + BigInt(h.units), 0n);
test('depletion bounds all external and internal Joule heat by existing finite core stores', () => {
  const battery = initial(),
    result = stepBatteryEnergy3D(
      battery,
      [
        { id: 'wire', power: 5 },
        { id: 'core-a', power: 2 },
      ],
      0.1,
    );
  expect(result.depleted).toBe(true);
  expect(BigInt(result.drawnUnits)).toBe(12n * BigInt(BATTERY_SUBQ_3D));
  expect(heatTotal(result.heat)).toBe(BigInt(batteryStoredUnits3D(battery)));
  expect(batteryStoredUnits3D(result.battery)).toBe('0');
  expect(result.activeSeconds).toBeCloseTo(12 / (7 * 256), 12);
  expect(battery.cores[0].energyQ).toBe(4);
});
test('failed core fragments retain their own energy and discharge at a bounded total rate', () => {
  const first = stepBatteryEnergy3D(initial(), [{ id: 'wire', power: 1e9 }], 1, true);
  expect(first.battery.failed).toBe(true);
  expect(first.heat.map((h) => h.id)).toEqual(['core-a', 'core-b']);
  expect(first.drawnUnits).toBe(String(3 * BATTERY_SUBQ_3D));
  expect(first.battery.cores.map((c) => c.energyQ)).toEqual([6, 3]);
  const next = stepBatteryEnergy3D(JSON.parse(JSON.stringify(first.battery)), [], 1, false);
  expect(next.battery.failed).toBe(true);
  expect(next.drawnUnits).toBe(first.drawnUnits);
  expect(
    BigInt(batteryStoredUnits3D(next.battery)) + heatTotal(first.heat) + heatTotal(next.heat),
  ).toBe(12n * BigInt(BATTERY_SUBQ_3D));
});
test('subquantum draw is retained across JSON continuation and heats once when it reaches a unit', () => {
  let battery = initial(),
    heat = 0n;
  for (let i = 0; i < 20; i++) {
    const result = stepBatteryEnergy3D(
      JSON.parse(JSON.stringify(battery)),
      [{ id: 'wire', power: 0.1 / (256 * BATTERY_SUBQ_3D) }],
      1,
    );
    battery = result.battery;
    heat += heatTotal(result.heat);
  }
  expect(heat).toBeGreaterThan(0n);
  expect(heat).toBeLessThanOrEqual(2n);
  expect(BigInt(batteryStoredUnits3D(battery)) + heat).toBe(12n * BigInt(BATTERY_SUBQ_3D));
});
test('open circuit spends no battery energy, ordering is stable, malformed ownership and stores reject', () => {
  expect(stepBatteryEnergy3D(initial(), [], 1).drawnUnits).toBe('0');
  const losses = [
    { id: 'b', power: 1 },
    { id: 'a', power: 1 },
  ];
  expect(stepBatteryEnergy3D(initial(), losses, 0.001)).toEqual(
    stepBatteryEnergy3D(initial(), [...losses].reverse(), 0.001),
  );
  expect(() =>
    readPhysicalBattery3D({ ...initial(), cores: [initial().cores[0], initial().cores[0]] }),
  ).toThrow(/Duplicate/);
  expect(() =>
    readPhysicalBattery3D({ ...initial(), cores: [{ id: 'a', energyQ: -1, energyFractionQ: 0 }] }),
  ).toThrow();
  expect(() =>
    readPhysicalBattery3D({ ...initial(), cores: [{ id: 'a', energyQ: 1, energyFractionQ: 0.1 }] }),
  ).toThrow(/lattice/);
});

test('mid-step depletion includes scheduled fractional work and ordinary steps stay active for the full duration', () => {
  const battery = {
    ...initial(),
    cores: [{ id: 'core', energyQ: 0, energyFractionQ: 1 / BATTERY_SUBQ_3D }],
    drawRemainderUnits: 0.9,
  };
  const loss = [{ id: 'wire', power: 0.2 / (256 * BATTERY_SUBQ_3D) }];
  const depleted = stepBatteryEnergy3D(battery, loss, 1);
  expect(depleted.activeSeconds).toBeCloseTo(0.5, 12);
  expect(depleted.drawnUnits).toBe('1');
  expect(stepBatteryEnergy3D(initial(), loss, 1).activeSeconds).toBe(1);
  expect(stepBatteryEnergy3D(depleted.battery, loss, 1).activeSeconds).toBe(0);
});
