/** Portable application transactions around the unchanged M5 CPU rules. */
import { CpuStructuralWorld3D } from './structural-world-core.js';
export {
  captureMaterialTransportMemory3D,
  restoreMaterialTransportMemory3D,
  followMaterialTransport3D,
  followTranslatedMaterialTransport3D,
  prepareMaterialTransport3D,
  MATERIAL_TRANSPORT_MEMORY_RULES_3D,
  type MaterialTransportMemory3D,
} from './material-transport-coupling.js';
export {
  createTerrainActorGroup3D,
  createTranslatedActorGroup3D,
  TERRAIN_ACTOR_GROUP_RULES_3D,
  TERRAIN_ACTOR_GROUP_LIMITS_3D,
  type TerrainActorPeerContact3D,
  type TerrainActorGroupResult3D,
  type TerrainActorGroup3D,
} from './terrain/terrain-actor-group.js';
export {
  createMaterialTransport3D,
  readMaterialTransport3D,
  applyMaterialTransport3D,
  MATERIAL_TRANSPORT_RULES_3D,
  MATERIAL_TRANSPORT_SCHEMA_3D,
  MATERIAL_TRANSPORT_LIMITS_3D,
  type MaterialParcelSeed3D,
  type MaterialParcel3D,
  type MaterialTransportState3D,
  type MaterialImpulse3D,
  type MaterialTransportReceipt3D,
} from './material-transport.js';
export { createTacticalWorkerHost3D } from './tactical/tactical-worker-host.js';
export {
  createTacticalWorkerClient3D,
  tacticalBrowserWorkerTransport3D,
} from './tactical/tactical-worker-client.js';
export {
  TACTICAL_WORKER_PROTOCOL_3D,
  TACTICAL_WORKER_LIMITS_3D,
} from './tactical/tactical-worker-wire.js';
export type { TacticalTransport3D } from './tactical/tactical-worker-wire.js';
export type {
  TacticalWorkerClient3D,
  TacticalWorkerOptions3D,
  TacticalWorkerCommit3D,
} from './tactical/tactical-worker-client.js';
export {
  TACTICAL_QUERY_BATCH_RULES_3D,
  TACTICAL_PREVIEW_QUERY_BATCH_RULES_3D,
  TACTICAL_QUERY_BATCH_LIMITS_3D,
} from './tactical/tactical-worker-queries.js';
export type {
  TacticalWorkerQuery3D,
  TacticalWorkerQueryResult3D,
  TacticalWorkerQueryBatch3D,
  TacticalWorkerPreviewQueryBatch3D,
} from './tactical/tactical-worker-queries.js';
export {
  createTacticalPreviewQueue3D,
  TACTICAL_PREVIEW_RULES_3D,
  TACTICAL_PREVIEW_LIMITS_3D,
} from './tactical/tactical-previews.js';
export type {
  TacticalPreviewQueue3D,
  TacticalPreviewTicket3D,
  TacticalPreviewOutcome3D,
  TacticalPreviewEditor3D,
  TacticalPreviewCapture3D,
} from './tactical/tactical-previews.js';
import type { MaterialMotionTrace3D } from './motion-trace.js';
import type { MaterialMotionPaths3D } from './motion-paths.js';
export { PATH_JOURNAL_RULES_3D, PATH_JOURNAL_LIMITS_3D } from './path-journal.js';
export type { PathJournal3D, PathJournalFrame3D, TickMovement3D } from './path-journal.js';
export { MOTION_PATH_RULES_3D, MOTION_PATH_LIMITS_3D, readMotionPaths3D } from './motion-paths.js';
export type {
  MaterialMotionPaths3D,
  MotionPathPass3D,
  MotionPathSegment3D,
} from './motion-paths.js';
export {
  MOTION_TRACE_RULES_3D,
  MOTION_JOURNAL_RULES_3D,
  MOTION_TRACE_LIMITS_3D,
} from './motion-trace.js';
export type {
  MaterialMotionTrace3D,
  MotionTraceOptions3D,
  MotionFragment3D,
  MotionJournal3D,
  MotionJournalFrame3D,
} from './motion-trace.js';
export { ACTION_JOURNAL_RULES_3D, ACTION_JOURNAL_LIMITS_3D } from './action-journal.js';
export type {
  ActionJournal3D,
  ActionJournalEvent3D,
  ActionBoundary3D,
  ActionBoundaryChanges3D,
  ActionIntervention3D,
  PortableTranslationReceipt3D,
} from './action-journal.js';
import { createTacticalSessionCore3D } from './tactical/tactical-session-core.js';
import type {
  TacticalValue,
  TacticalSessionInitial3D,
  TacticalSessionPolicy3D,
  TacticalSession3D,
} from './tactical/tactical-session-view.js';
export { CHANGE_REPORT_RULES_VERSION_3D, CHANGE_REPORT_LIMITS_3D } from './change-reports.js';
export type {
  GameplayChangeReport3D,
  DomainChangeReport3D,
  ChangedCells3D,
  ChangeChannel3D,
  ChangeReportOptions3D,
  ChangeTarget3D,
} from './change-reports.js';
export {
  GEOMETRY_RULES_VERSION_3D,
  GEOMETRY_SCALE_3D,
  GEOMETRY_LIMITS_3D,
  EXPOSURE_RULES_VERSION_3D,
} from './gameplay-geometry.js';
export type {
  GameplayGeometry3D,
  GeometryVector3D,
  GeometryBox3D,
  GeometryTime3D,
  GeometryStamp3D,
  GeometryCell3D,
  GeometryContact3D,
  GeometryFilter3D,
  GeometryExposure3D,
  MaterialExposure3D,
} from './gameplay-geometry.js';
export {
  createTerrainBody3D,
  readTerrainBody3D,
  stepTerrainBody3D,
  TERRAIN_BODY_RULES_VERSION_3D,
  TERRAIN_BODY_LIMITS_3D,
} from './terrain/terrain-body.js';
export type {
  TerrainBodyState3D,
  TerrainBodyInitial3D,
  TerrainBodyCommand3D,
  TerrainBodyResolution3D,
  BodySupport3D,
} from './terrain/terrain-body.js';
export {
  createTerrainMotion3D,
  TERRAIN_MOTION_RULES_3D,
  TERRAIN_MOTION_LIMITS_3D,
} from './terrain/terrain-motion.js';
export type {
  TerrainMotion3D,
  TerrainMotionOptions3D,
  TerrainMotionContact3D,
  TerrainMotionResolution3D,
} from './terrain/terrain-motion.js';
export {
  createTerrainDisplacement3D,
  TERRAIN_DISPLACEMENT_RULES_3D,
  TERRAIN_DISPLACEMENT_LIMITS_3D,
} from './terrain/terrain-displacement.js';
export type {
  TerrainDisplacement3D,
  TerrainDisplacementOptions3D,
  TerrainDisplacementContact3D,
  TerrainDisplacementResult3D,
} from './terrain/terrain-displacement.js';
export {
  translateStructuralRegionWithPaths3D,
  TRANSLATION_PATH_RULES_3D,
  TRANSLATION_PATH_LIMITS_3D,
} from './translation-paths.js';
export type {
  TranslationPaths3D,
  TranslationPathsResult3D,
  TranslationPathOptions3D,
  TranslationMovement3D,
  TranslationAction3D,
} from './translation-paths.js';
export {
  createTranslationDisplacement3D,
  TRANSLATION_DISPLACEMENT_RULES_3D,
  TRANSLATION_DISPLACEMENT_LIMITS_3D,
} from './translation-displacement.js';
export type {
  TranslationCarry3D,
  TranslationDisplacementOptions3D,
  TranslationDisplacementResult3D,
  TranslationDisplacement3D,
} from './translation-displacement.js';
export {
  createTerrainBodyGroup3D,
  createTranslationBodyGroup3D,
  TERRAIN_BODY_GROUP_RULES_3D,
  TERRAIN_BODY_GROUP_LIMITS_3D,
} from './terrain/terrain-body-group.js';
export type {
  NamedTerrainBody3D,
  BodyDisplacementResponse3D,
  TerrainBodyGroupOptions3D,
  TerrainBodyGroupResult3D,
  TerrainBodyGroup3D,
} from './terrain/terrain-body-group.js';
export {
  moveTerrainActors3D,
  ACTOR_MOVEMENT_RULES_3D,
  ACTOR_MOVEMENT_LIMITS_3D,
} from './actor-movement.js';
export type {
  ActorMovementCommand3D,
  ActorMovementResult3D,
  ActorMovementResponse3D,
  ActorMovementContact3D,
  ActorFooting3D,
} from './actor-movement.js';
export {
  MATERIAL_RESERVOIR_RULES_VERSION_3D,
  MATERIAL_RESERVOIR_LIMITS_3D,
} from './material-reservoirs.js';
export type {
  MaterialReservoir3D,
  MaterialTransferRequest3D,
  MaterialTransferReceipt3D,
} from './material-reservoirs.js';
export {
  TEMPORARY_HOLD_RULES_VERSION_3D,
  THERMAL_INTERVENTION_RULES_VERSION_3D,
  TACTICAL_ACTION_LIMITS_3D,
} from './tactical/tactical-actions.js';
export type {
  TemporaryHold3D,
  TemporaryHoldRequest3D,
  ThermalDelta3D,
  ThermalInterventionReceipt3D,
} from './tactical/tactical-actions.js';
export {
  TACTICAL_SESSION_RULES_VERSION_3D,
  TACTICAL_SESSION_LIMITS_3D,
} from './tactical/tactical-session-core.js';
export type {
  TacticalQueryOptions3D,
  TacticalBranchOptions3D,
  TacticalValue,
  ThermalAccounting3D,
  TacticalSessionInitial3D,
  TacticalSessionSnapshot3D,
  TacticalRevision3D,
  TacticalBranch3D,
  TacticalBranchStatus3D,
  TacticalPreview3D,
  TacticalSessionPolicy3D,
  TacticalSession3D,
  TacticalCommit3D,
} from './tactical/tactical-session-view.js';

export function createTacticalSession3D<T extends TacticalValue>(
  initial: TacticalSessionInitial3D<T>,
  policy: TacticalSessionPolicy3D<T> = {},
): TacticalSession3D<T> {
  return createTacticalSessionCore3D(
    initial,
    (snapshot, _domain, captureMotion, motionMaxEntries, capturePaths, pathMaxEntries) => {
      let world: CpuStructuralWorld3D | undefined = new CpuStructuralWorld3D({
        width: snapshot.width,
        height: snapshot.height,
        depth: snapshot.depth,
        chunkSize: snapshot.chunkSize,
      });
      world.restore(snapshot);
      let motion: MaterialMotionTrace3D | undefined;
      let paths: MaterialMotionPaths3D | undefined;
      return {
        load(snapshot) {
          if (!world) throw Error('Simulation driver is closed.');
          world.restore(snapshot);
          motion = undefined;
          paths = undefined;
        },
        step() {
          if (!world) throw Error('Simulation driver is closed.');
          if (capturePaths) {
            const observed = world.stepWithMotionPaths({
              maxEntries: motionMaxEntries,
              maxPathEntries: pathMaxEntries,
            });
            motion = observed.motion;
            paths = observed.paths;
          } else if (captureMotion) motion = world.stepWithMotion({ maxEntries: motionMaxEntries });
          else world.step(1);
        },
        motion() {
          if (!world || !motion) throw Error('No completed motion capture.');
          return motion;
        },
        paths() {
          if (!world || !paths) throw Error('No completed path capture.');
          return paths;
        },
        snapshot() {
          if (!world) throw Error('Simulation driver is closed.');
          return world.snapshot();
        },
        close() {
          world = undefined;
          motion = undefined;
          paths = undefined;
        },
      };
    },
    policy,
  );
}
