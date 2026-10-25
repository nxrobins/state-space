import { beforeAll, expect, test } from 'vitest';
import { createMultiphysicsProfiles3D, type MultiphysicsProfiles3D } from './profiles.js';
import { createMultiphysicsDemonstration3D } from './demonstrations.js';
import { createMultiphysicsTickJob3D } from './world-tick.js';
import {
  createMultiphysicsSnapshot3D,
  inventoryEnergyDelta3D,
  multiphysicsInventory3D,
  type MultiphysicsSnapshot3D,
} from './model.js';
import { batteryStoredUnits3D } from './battery.js';
import { createMultiphysicsWorld3D } from './world.js';
let profiles: MultiphysicsProfiles3D;
beforeAll(async () => {
  profiles = await createMultiphysicsProfiles3D();
});
function run(state: MultiphysicsSnapshot3D) {
  const job = createMultiphysicsTickJob3D(profiles, state);
  while (job.progress().status === 'running') job.advance(256);
  return job.result();
}
test('source-paid heater releases a near-melt wax valve while an unpowered control stays bonded', () => {
  const initial = createMultiphysicsDemonstration3D(profiles, 'wax-valve');
  let state = initial,
    broke = false;
  for (let i = 0; i < 16; i++) {
    const result = run(state);
    broke ||= result.report.brokenBonds.some((b) => b.a === 'valve' || b.b === 'valve');
    state = result.snapshot;
  }
  const valve = state.parcels.find((p) => p.id === 'valve')!;
  expect(valve.material).toBe('molten_wax');
  expect(broke).toBe(true);
  expect(valve.center[1]).toBeLessThan(1.99);
  expect(BigInt(batteryStoredUnits3D(state.battery!))).toBeLessThan(
    BigInt(batteryStoredUnits3D(initial.battery!)),
  );
  expect(multiphysicsInventory3D(state).mass).toBe(multiphysicsInventory3D(initial).mass);
  expect(state.accounting.externalStoredSubQ).toBe('0');
  const control = createMultiphysicsDemonstration3D(profiles, 'wax-valve');
  // Snapshot source replacement uses the real edit API so its energy debit is recorded.
  const world = createMultiphysicsWorld3D(profiles, control);
  world.edit([{ kind: 'battery', battery: null }]);
  let off = world.snapshot();
  for (let i = 0; i < 16; i++) off = run(off).snapshot;
  expect(off.parcels.find((p) => p.id === 'valve')!.material).toBe('wax');
  expect(off.bonds.some((b) => b.a === 'valve' || b.b === 'valve')).toBe(true);
});
test.each(['rotating-contact', 'fluid-switch'] as const)(
  '%s opens a real finite-area conductive path as matter moves',
  (name) => {
    const initial = createMultiphysicsDemonstration3D(profiles, name),
      first = run(initial),
      second = run(first.snapshot);
    expect(first.report.battery!.sourceCurrent).toBeGreaterThan(0);
    expect(second.report.battery!.sourceCurrent).toBe(0);
    expect(second.report.battery!.drawnUnits).toBe('0');
    expect(second.snapshot.battery!.failed).toBe(false);
    expect(run(JSON.parse(JSON.stringify(first.snapshot)))).toEqual(second);
    if (name === 'rotating-contact') {
      const world = createMultiphysicsWorld3D(profiles, second.snapshot),
        bridge = second.snapshot.parcels.find((p) => p.id === 'bridge')!,
        q = bridge.orientation;
      world.edit([
        {
          kind: 'transform',
          ids: ['bridge'],
          translation: [0, 0, 0],
          rotation: [-q[0], -q[1], -q[2], q[3]],
          pivot: bridge.center,
        },
      ]);
      expect(run(world.snapshot()).report.battery!.sourceCurrent).toBeGreaterThan(0);
    }
    expect(second.snapshot.parcels.find((p) => p.id === 'bridge')!.orientation).not.toEqual([
      0, 0, 0, 1,
    ]);
    if (name === 'fluid-switch')
      expect(first.snapshot.parcels.find((p) => p.id === 'bridge')!.velocity[0]).toBeGreaterThan(0);
    expect(multiphysicsInventory3D(second.snapshot).mass).toBe(
      multiphysicsInventory3D(initial).mass,
    );
  },
);

test('fast sparse flow keeps its mechanical energy through circuit interruption and timestep refinement', () => {
  const seed = createMultiphysicsDemonstration3D(profiles, 'fluid-switch');
  for (const speed of [0.2, 2, 8]) {
    const errors: number[] = [];
    for (const dt of [0.001, 0.0005, 0.00025]) {
      let state = createMultiphysicsSnapshot3D(profiles, {
        parcels: seed.parcels.map((p) =>
          p.id === 'water' ? { ...p, velocity: [speed, 0, 0] } : p,
        ),
        bonds: seed.bonds,
        anchors: seed.anchors,
        battery: seed.battery,
        settings: { ...seed.settings, dt },
      });
      const before = multiphysicsInventory3D(state);
      let worst = 0;
      for (let i = 0; i < Math.round(0.004 / dt); i++) {
        const result = run(state);
        state = result.snapshot;
        worst = Math.max(worst, Math.abs(result.report.numericalEnergy));
        expect(Math.hypot(...result.report.numericalLinearMomentum)).toBeLessThan(1e-8);
        // Reuse the geometric-contact angular budget from the tank acceptance.
        expect(Math.hypot(...result.report.numericalAngularMomentum)).toBeLessThan(1e-6);
        expect(result.report.fluid!.convergence.densityError).toBeLessThanOrEqual(1e-4);
      }
      expect(state.settings.numericalEnergyLimit).toBe(0.01);
      expect(worst).toBeLessThan(1e-5 * Math.max(1, (speed * speed) / 4));
      const after = multiphysicsInventory3D(state);
      expect(after.mass).toBe(before.mass);
      expect(state.accounting.externalStoredSubQ).toBe('0');
      expect(inventoryEnergyDelta3D(before, after)).toBeCloseTo(
        state.accounting.numericalEnergy,
        10,
      );
      errors.push(Math.abs(state.accounting.numericalEnergy));
      expect(run(JSON.parse(JSON.stringify(state)))).toEqual(run(state));
    }
    expect(errors[1]).toBeLessThanOrEqual(errors[0] + 1e-10);
    expect(errors[2]).toBeLessThanOrEqual(errors[1] + 1e-10);
    console.log(JSON.stringify({ speed, refinementEnergyErrors: errors }));
  }
});
