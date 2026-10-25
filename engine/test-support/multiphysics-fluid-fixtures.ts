/** Shared frozen CPU study inputs; not world trajectories. */
import type {
  FluidReferenceInput3D,
  FluidParticle3D,
} from '../experimental/multiphysics/fluids.js';
import type { Vec3 } from '../experimental/multiphysics/math.js';

export function createFluidStudyParticle3D(
  id: string,
  center: Vec3,
  velocity: Vec3,
): FluidParticle3D {
  return {
    parcel: {
      id,
      center,
      velocity,
      owner: 'study-fluid',
      material: 'water',
      mass: 1,
      referenceAmount: 1,
      heatCapacity: 1,
      thermalQ: 256,
      latentQ: 0,
      chemicalQ: 0,
      orientation: [0, 0, 0, 1],
      principalInertia: [1 / 6, 1 / 6, 1 / 6],
      intrinsicAngularMomentum: [0, 0, 0],
    },
    thermalEnergy: 1,
    phase: 'liquid',
    restDensity: 1,
    volume: null,
    thermalCurve: null,
    viscosity: 0,
  };
}

/** One frozen liquid block and a translating/rotating shared floor. This is a
 * local kernel case: it does not integrate geometry or qualify resting support.
 */
export function createFluidStudyBlock3D(side: number): FluidReferenceInput3D {
  const particles = Array.from({ length: side ** 3 }, (_, i) => {
    const center: Vec3 = [
      (i % side) - (side - 1) / 2,
      1 + Math.floor(i / side ** 2),
      (Math.floor(i / side) % side) - (side - 1) / 2,
    ];
    return createFluidStudyParticle3D(`p${String(i).padStart(3, '0')}`, center, [
      -0.2 * center[0],
      -0.4 - 0.2 * center[1],
      -0.2 * center[2],
    ]);
  });
  const boundaries = Array.from({ length: side ** 2 }, (_, i) => ({
    id: `s${String(i).padStart(3, '0')}`,
    bodyId: 'floor',
    position: [(i % side) - (side - 1) / 2, 0, Math.floor(i / side) - (side - 1) / 2] as Vec3,
    volume: 1,
  }));
  return {
    particles,
    boundaries,
    bodies: [
      {
        id: 'floor',
        center: [0, -0.5, 0],
        velocity: [0, 0.05, 0],
        angularVelocity: [0.1, 0, 0.05],
        inverseMass: 0.05,
        inverseInertia: [0.05, 0, 0, 0, 0.04, 0, 0, 0, 0.05],
      },
    ],
    contacts: boundaries.map((s, i) => ({
      id: `c${String(i).padStart(3, '0')}`,
      particleId: particles[i].parcel.id,
      boundaryId: s.id,
      point: [s.position[0], 0.5, s.position[2]] as Vec3,
      normal: [0, 1, 0] as Vec3,
      impact: false,
    })),
    dt: 0.001,
    smoothingRadius: 1.5,
  };
}

/** Existing closest-point regression's narrow, duplicated contact face. */
export function createFluidStudyWedge3D(): FluidReferenceInput3D {
  const normal: Vec3 = [Math.cos(Math.PI - 0.001), Math.sin(Math.PI - 0.001), 0];
  const p: FluidParticle3D = {
    ...createFluidStudyParticle3D('a', [0, 0, 0], [-1, -1, 0]),
    phase: 'gas',
    volume: 1,
    thermalCurve: { enthalpy: 1, lowOffset: 0, highOffset: 0, plateauEnergy: 0 },
  };
  return {
    particles: [p],
    dt: 0.01,
    smoothingRadius: 2,
    projectionOnly: true,
    bodies: [
      {
        id: 'fixed',
        center: [0, 0, 0],
        velocity: [0, 0, 0],
        angularVelocity: [0, 0, 0],
        inverseMass: 0,
        inverseInertia: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
    boundaries: [
      { id: 'angled', bodyId: 'fixed', position: [-normal[0], -normal[1], -normal[2]], volume: 1 },
      { id: 'flat', bodyId: 'fixed', position: [-1, 0, 0], volume: 1 },
    ],
    contacts: [
      {
        id: 'a',
        particleId: 'a',
        boundaryId: 'angled',
        point: [0, 0, 0] as Vec3,
        normal,
        impact: false,
      },
      {
        id: 'b',
        particleId: 'a',
        boundaryId: 'flat',
        point: [0, 0, 0] as Vec3,
        normal: [1, 0, 0] as Vec3,
        impact: false,
      },
    ].flatMap((c) => [c, { ...c, id: `${c.id}-duplicate` }]),
  };
}
