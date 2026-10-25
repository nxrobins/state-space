/** Explicit, supervised coupled-fluid acceptance; excluded from the ordinary CPU suite. */
import { beforeAll, expect, test } from 'vitest';
import { createMultiphysicsProfiles3D, type MultiphysicsProfiles3D } from './profiles.js';
import { seedThermalParcel3D } from './thermal.js';
import { createMultiphysicsSnapshot3D, multiphysicsInventory3D } from './model.js';
import { createMultiphysicsTickJob3D } from './world-tick.js';
import type { Vec3 } from './math.js';
let profiles: MultiphysicsProfiles3D;
beforeAll(async () => {
  profiles = await createMultiphysicsProfiles3D();
});
function tank(material: string, dt: number) {
  const seed = (id: string, material: string, center: Vec3, halfExtents: Vec3 = [0.5, 0.5, 0.5]) =>
    seedThermalParcel3D(profiles, {
      id,
      material,
      owner: 'authored',
      center,
      halfExtents,
      temperature: 20,
    });
  const walls = [
    seed('floor', 'ceramic', [0, 0, 0], [2.5, 0.5, 2.5]),
    seed('left', 'ceramic', [-3, 2.5, 0], [0.5, 2, 2.5]),
    seed('right', 'ceramic', [3, 2.5, 0], [0.5, 2, 2.5]),
    seed('front', 'ceramic', [0, 2.5, -3], [3.5, 2, 0.5]),
    seed('back', 'ceramic', [0, 2.5, 3], [3.5, 2, 0.5]),
  ];
  const water = Array.from({ length: 100 }, (_, i) =>
    seed(`w${i}`, 'water', [(i % 5) - 2, 1 + Math.floor(i / 25), (Math.floor(i / 5) % 5) - 2]),
  ).filter((p) => !(p.center[0] === 0 && p.center[1] === 3 && p.center[2] === 0));
  return createMultiphysicsSnapshot3D(profiles, {
    parcels: [...walls, ...water, seed('body', material, [0, 3, 0])],
    anchors: walls.map((p) => p.id),
    settings: { dt },
  });
}
for (const [material, direction] of [
  ['wax', 1],
  ['copper', -1],
] as const) {
  test(`${material} ${direction > 0 ? 'rises' : 'sinks'} in a resolved tank with bounded momentum and improving energy error`, () => {
    const measured: { dt: number; height: number; speed: number; energy: number }[] = [];
    for (const dt of [1 / 120, 1 / 240, 1 / 480]) {
      let state = tank(material, dt);
      const mass = multiphysicsInventory3D(state).mass;
      for (let step = 0; step < Math.round(0.05 / dt); step++) {
        const job = createMultiphysicsTickJob3D(profiles, state);
        while (job.progress().status === 'running') job.advance(256);
        const result = job.result();
        state = result.snapshot;
        expect(Math.hypot(...result.report.numericalLinearMomentum)).toBeLessThan(1e-8);
        // Geometric correction has an explicit, nonzero angular residual in the rigid contract.
        expect(Math.hypot(...result.report.numericalAngularMomentum)).toBeLessThan(1e-6);
        expect(result.report.fluidPostProjection!.convergence.divergenceError).toBeLessThanOrEqual(
          1e-7,
        );
        expect(result.report.fluidPostProjection!.convergence.contactError).toBeLessThanOrEqual(
          1e-8,
        );
      }
      const body = state.parcels.find((p) => p.id === 'body')!;
      expect(direction * (body.center[1] - 3)).toBeGreaterThan(0.0005);
      expect(direction * body.velocity[1]).toBeGreaterThan(0.02);
      expect(multiphysicsInventory3D(state).mass).toBe(mass);
      expect(state.accounting.externalStoredSubQ).toBe('0');
      measured.push({
        dt,
        height: body.center[1],
        speed: body.velocity[1],
        energy: Math.abs(state.accounting.numericalEnergy),
      });
    }
    expect(measured[0].energy).toBeLessThan(0.006);
    expect(measured[1].energy).toBeLessThan(measured[0].energy);
    expect(measured[2].energy).toBeLessThan(measured[1].energy);
    expect(
      Math.max(...measured.map((r) => r.height)) - Math.min(...measured.map((r) => r.height)),
    ).toBeLessThan(2e-5);
    expect(
      Math.max(...measured.map((r) => r.speed)) - Math.min(...measured.map((r) => r.speed)),
    ).toBeLessThan(0.0005);
    console.log(JSON.stringify({ case: material, duration: 0.05, fluidSamples: 99, measured }));
  }, 30000);
}
