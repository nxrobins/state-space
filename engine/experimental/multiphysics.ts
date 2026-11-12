/** Opt-in multiphysics: reference calculations, the bounded world runtime and its module Worker.
 * See docs/MULTIPHYSICS.md for the qualified envelope and release gates. */
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
export {
  MULTIPHYSICS_PROFILE_VERSION_3D,
  createMultiphysicsProfiles3D,
  readMultiphysicsProfile3D,
  type MaterialPhase3D,
  type MaterialProfile3D,
  type MultiphysicsProfiles3D,
} from './multiphysics/profiles.js';
export {
  MULTIPHYSICS_RULES_3D,
  MULTIPHYSICS_LIMITS_3D,
  MULTIPHYSICS_SUBQ_PER_ENERGY_3D,
  createMultiphysicsSnapshot3D,
  readMultiphysicsSnapshot3D,
  multiphysicsInventory3D,
  inventoryEnergyDelta3D,
  type MultiphysicsSettings3D,
  type MultiphysicsInventory3D,
  type MultiphysicsAccounting3D,
  type MultiphysicsSnapshot3D,
  type MultiphysicsInitial3D,
} from './multiphysics/model.js';
export {
  THERMAL_LIMITS_3D as MULTIPHYSICS_THERMAL_LIMITS_3D,
  seedThermalParcel3D,
  parcelTemperature3D,
  type ThermalParcel3D,
  type ThermalSeed3D,
  type ThermalTransition3D,
  type ThermalBurn3D,
} from './multiphysics/thermal.js';
export {
  batteryStoredUnits3D,
  type PhysicalBattery3D,
  type BatteryCore3D,
} from './multiphysics/battery.js';
export {
  createMultiphysicsWorld3D,
  type MultiphysicsEdit3D,
  type MultiphysicsEditReceipt3D,
  type MultiphysicsPreviewResult3D,
  type MultiphysicsPreviewProgress3D,
  type MultiphysicsPreview3D,
  type MultiphysicsWorld3D,
} from './multiphysics/world.js';
export {
  MULTIPHYSICS_TICK_LIMITS_3D,
  createMultiphysicsTickJob3D,
  type MultiphysicsTickProgress3D,
  type MultiphysicsTickReport3D,
  type MultiphysicsTickResult3D,
  type MultiphysicsTickJob3D,
} from './multiphysics/world-tick.js';
export {
  createMultiphysicsDemonstration3D,
  createMultiphysicsTimedCup3D,
  createMultiphysicsResolvedTank3D,
  type MultiphysicsDemonstration3D,
} from './multiphysics/demonstrations.js';
export {
  MULTIPHYSICS_WORKER_PROTOCOL_3D,
  MULTIPHYSICS_WORKER_BOOTSTRAP_3D,
  createMultiphysicsTaskQueue3D,
  type MultiphysicsWorkerTransport3D,
  type MultiphysicsTaskScheduler3D,
} from './multiphysics/worker-wire.js';
export { createMultiphysicsWorkerHost3D } from './multiphysics/worker-host.js';
export {
  serveMultiphysicsWorker3D,
  type MultiphysicsWorkerEndpoint3D,
} from './multiphysics/worker-serve.js';
export {
  createMultiphysicsWorkerClient3D,
  multiphysicsBrowserWorkerTransport3D,
  startMultiphysicsWorker3D,
  type MultiphysicsWorkerClient3D,
  type MultiphysicsWorkerState3D,
  type MultiphysicsWorkerPreview3D,
} from './multiphysics/worker-client.js';
