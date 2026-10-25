/** Private mechanism fixtures for executable acceptance and the future builder. */
import { createMultiphysicsSnapshot3D, type MultiphysicsSnapshot3D } from './model.js';
import { seedThermalParcel3D, type ThermalSeed3D } from './thermal.js';
import type { MultiphysicsProfiles3D } from './profiles.js';
import type { PhysicalBattery3D } from './battery.js';
import type { Vec3 } from './math.js';
export type MultiphysicsDemonstration3D = 'wax-valve' | 'rotating-contact' | 'fluid-switch';
const battery = (energyQ: number, emf: number): PhysicalBattery3D => ({
  id: 'source',
  positive: 'positive',
  negative: 'negative',
  cores: [{ id: 'core', energyQ, energyFractionQ: 0 }],
  emf,
  internalResistance: 2,
  failureRateQPerSecond: 3,
  failureTemperature: 180,
  failed: false,
  drawRemainderUnits: 0,
});
export function createMultiphysicsDemonstration3D(
  profiles: MultiphysicsProfiles3D,
  name: MultiphysicsDemonstration3D,
): MultiphysicsSnapshot3D {
  const parcel = (
    id: string,
    material: string,
    center: Vec3,
    options: Partial<ThermalSeed3D> = {},
  ) =>
    seedThermalParcel3D(profiles, {
      id,
      material,
      center,
      owner: 'authored',
      temperature: 20,
      ...options,
    });
  if (name === 'wax-valve') {
    // The valve begins near the end of its latent plateau, at the same actual
    // temperature as the unpowered heater. Only source-paid heat can release it.
    return createMultiphysicsSnapshot3D(profiles, {
      parcels: [
        parcel('positive', 'copper', [-1, 1, 0], { temperature: 40 }),
        parcel('core', 'ceramic', [0, 1, 0], { temperature: 40 }),
        parcel('negative', 'copper', [1, 1, 0], { temperature: 40 }),
        parcel('left', 'copper', [-1, 2, 0], { temperature: 40 }),
        parcel('heater', 'copper', [0, 2, 0], { temperature: 40 }),
        parcel('right', 'copper', [1, 2, 0], { temperature: 40 }),
        parcel('valve', 'wax', [0, 2, 1], { temperature: 49.99 }),
        parcel('support', 'ceramic', [1, 2, 1], { temperature: 40 }),
      ],
      bonds: [
        { a: 'positive', b: 'core', strength: 1e6, restLength: 1 },
        { a: 'core', b: 'negative', strength: 1e6, restLength: 1 },
        { a: 'valve', b: 'support', strength: 1e6, restLength: 1 },
      ],
      anchors: ['core', 'left', 'heater', 'right', 'support'],
      battery: battery(100000, 120),
    });
  }
  if (name !== 'rotating-contact' && name !== 'fluid-switch')
    throw Error('Unknown multiphysics demonstration.');
  const halfExtents: Vec3 = [0.5, 0.1, 0.1],
    z = name === 'fluid-switch' ? -0.4 : 0;
  const positive: Vec3 = [1, 0.4, z],
    negative: Vec3 = [-1, -0.4, z],
    core: Vec3 = [0, 0, -2];
  const parcels = [
    parcel('positive', 'copper', positive, { halfExtents }),
    parcel('negative', 'copper', negative, { halfExtents }),
    parcel('core', 'ceramic', core),
    parcel('bridge', 'copper', [0, 0, 0], {
      angularVelocity: name === 'rotating-contact' ? [0, 0, 1] : [0, 0, 0],
    }),
  ];
  // This bounded mechanism uses slow flow. At speed 2, the current pressure
  // projection exceeds the unchanged 0.01 world-energy error budget.
  if (name === 'fluid-switch')
    parcels.push(parcel('water', 'water', [-1, -0.5, 0.4], { velocity: [0.2, 0, 0] }));
  return createMultiphysicsSnapshot3D(profiles, {
    parcels,
    anchors: ['core'],
    settings: { gravity: [0, 0, 0], dt: 0.001 },
    battery: battery(1000, 12),
    // The private graph model permits rigid struts between nonadjacent parcels.
    bonds: [
      {
        a: 'positive',
        b: 'core',
        strength: 1e6,
        restLength: Math.hypot(...positive.map((v, i) => v - core[i])),
      },
      {
        a: 'core',
        b: 'negative',
        strength: 1e6,
        restLength: Math.hypot(...negative.map((v, i) => v - core[i])),
      },
    ],
  });
}
