/** Opt-in multiphysics reference calculations. See docs/MULTIPHYSICS.md for runtime release gates. */
export {
  IDENTITY_QUATERNION,
  normalizeQuaternion,
  rotateVector,
  integrateOrientation,
  cuboidMassProperties,
  applyWorldInverseInertia,
  type Vec3,
  type Quat,
  type CuboidMassProperties,
} from './multiphysics/math.js';
export {
  orientedCuboidContact,
  cuboidBounds,
  boundsOverlap,
  sweptCuboidBounds,
  type OrientedCuboid,
  type AxisAlignedBounds,
  type CuboidContact,
} from './multiphysics/collision.js';
export {
  MAX_REFERENCE_PARCELS_3D,
  PARCEL_MOTION_TOLERANCE_3D,
  readMaterialParcel3D,
  transferMaterialParcel3D,
  partitionMaterialParcel3D,
  parcelConservation3D,
  releaseAssemblyParcels3D,
  type MaterialParcel3D,
  type ParcelPartition3D,
  type AssemblyMotion3D,
  type ParcelConservation3D,
} from './multiphysics/conservation.js';
export {
  CIRCUIT_REFERENCE_LIMITS_3D,
  solveReferenceCircuit3D,
  type ResistiveConnection3D,
  type CircuitReferenceInput3D,
  type CircuitReferenceResult3D,
} from './multiphysics/circuit-reference.js';
