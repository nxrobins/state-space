/** Private mechanism fixtures for executable acceptance and the future builder.
 * The combined-failure trajectory remains an unpassed extended release gate. */
import { createMultiphysicsSnapshot3D, type MultiphysicsSnapshot3D } from './model.js';
import { seedThermalParcel3D, type ThermalSeed3D } from './thermal.js';
import type { MultiphysicsProfiles3D } from './profiles.js';
import type { PhysicalBattery3D } from './battery.js';
import type { Vec3 } from './math.js';
export type MultiphysicsDemonstration3D =
  'wax-valve' | 'rotating-contact' | 'fluid-switch' | 'falling-battery' | 'combined-failure';
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
  if (name === 'falling-battery') {
    const angle = 0.25,
      orientation = [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)] as const;
    return createMultiphysicsSnapshot3D(profiles, {
      parcels: [
        ...(['positive', 'core', 'negative'] as const).map((id, i) =>
          parcel(
            id,
            id === 'core' ? 'ceramic' : 'copper',
            [(i - 1) * Math.cos(angle), 2 + (i - 1) * Math.sin(angle), 0],
            { orientation },
          ),
        ),
        parcel('floor', 'ceramic', [0, 0, 0], { halfExtents: [4, 0.5, 4] }),
      ],
      anchors: ['floor'],
      settings: { dt: 1 / 240 },
      bonds: [
        { a: 'positive', b: 'core', strength: 0.001, restLength: 1 },
        { a: 'core', b: 'negative', strength: 0.001, restLength: 1 },
      ],
      battery: battery(1000, 12),
    });
  }
  if (name === 'combined-failure') {
    const valve = createMultiphysicsDemonstration3D(profiles, 'wax-valve');
    return createMultiphysicsSnapshot3D(profiles, {
      parcels: [
        ...valve.parcels,
        parcel('water', 'water', [0, 3, 1], { temperature: 40 }),
        parcel('plate', 'copper', [0, 0.75, 1], { temperature: 40, halfExtents: [0.4, 0.5, 0.5] }),
      ],
      anchors: valve.anchors,
      bonds: [
        ...valve.bonds,
        { a: 'core', b: 'plate', strength: 80, restLength: Math.hypot(1, 0.25) },
      ],
      battery: valve.battery,
      settings: valve.settings,
    });
  }
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
  if (name === 'fluid-switch')
    parcels.push(parcel('water', 'water', [-1, -0.5, 0.4], { velocity: [2, 0, 0] }));
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
