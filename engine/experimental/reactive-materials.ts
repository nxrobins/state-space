/** Public reactive material data and bounded local reaction kernels. */
export {
  createReactiveMaterialRegistry3D,
  defaultReactiveMaterialCatalog3D,
  REACTIVE_MATERIAL_RULES_3D,
  REACTIVE_MATERIAL_SCHEMA_3D,
  REACTIVE_MATERIAL_LIMITS_3D,
  type ReactiveMaterialRegistry3D,
  type ReactiveMaterialCatalog3D,
} from './reactive/reactive-registry.js';
export { MAT, PHASE } from '../generated/materials.js';
export { ENERGY_SCALE, MAX_ENERGY_Q } from '../thermal.js';
export { INTEGRITY_3D, ANCHOR_3D, BONDS_3D } from './structural-mechanics.js';
export {
  createReactiveMaterialBlock3D,
  readReactiveMaterialBlock3D,
  editReactiveMaterialBlock3D,
  reactiveMaterialEnergyLedger3D,
  REACTIVE_BLOCK_RULES_3D,
  REACTIVE_BLOCK_SCHEMA_3D,
  REACTIVE_BLOCK_LIMITS_3D,
  type ReactiveMaterialBlock3D,
  type ReactiveMaterialEdit3D,
} from './reactive/reactive-block.js';
export {
  createReactiveReactionState3D,
  readReactiveReactionState3D,
  createReactiveReactionJob3D,
  advanceReactiveReactions3D,
  REACTIVE_REACTION_RULES_3D,
  REACTIVE_REACTION_SCHEMA_3D,
  REACTIVE_REACTION_PASSES_3D,
  type ReactiveReactionState3D,
  type ReactiveReactionReport3D,
  type ReactiveReactionResult3D,
  type ReactiveReactionProgress3D,
  type ReactiveReactionJob3D,
} from './reactive/reactive-reactions.js';
export {
  reactiveMovementSchedule3D,
  runReactiveMovementPass3D,
  REACTIVE_MOVEMENT_RULES_3D,
  type ReactiveMovementPass3D,
} from './reactive/reactive-movement.js';
export {
  createReactiveEvolutionState3D,
  readReactiveEvolutionState3D,
  createReactiveEvolutionJob3D,
  advanceReactiveEvolution3D,
  REACTIVE_EVOLUTION_RULES_3D,
  REACTIVE_EVOLUTION_SCHEMA_3D,
  type ReactiveEvolutionState3D,
  type ReactiveEvolutionReport3D,
  type ReactiveEvolutionResult3D,
  type ReactiveEvolutionProgress3D,
  type ReactiveEvolutionJob3D,
} from './reactive/reactive-evolution.js';
export {
  createReactiveStructureJob3D,
  REACTIVE_STRUCTURE_RULES_3D,
  REACTIVE_STRUCTURE_MAX_WORK_3D,
  type ReactiveStructureStage3D,
  type ReactiveStructureReport3D,
  type ReactiveStructureResult3D,
  type ReactiveStructureProgress3D,
  type ReactiveStructureJob3D,
} from './reactive/reactive-structure.js';
export {
  createReactiveWorldSnapshot3D,
  createConstrainedReactiveWorldSnapshot3D,
  readReactiveWorldSnapshot3D,
  createReactiveWorldTickJob3D,
  REACTIVE_WORLD_RULES_3D,
  REACTIVE_WORLD_SCHEMA_3D,
  REACTIVE_WORLD_COMPONENTS_3D,
  REACTIVE_CONSTRAINED_WORLD_RULES_3D,
  REACTIVE_CONSTRAINED_WORLD_SCHEMA_3D,
  type ReactiveUnconstrainedWorldSnapshot3D,
  type ReactiveConstrainedWorldSnapshot3D,
  type ReactiveWorldSnapshot3D,
  type ReactiveWorldTickReport3D,
  type ReactiveWorldTickResult3D,
  type ReactiveWorldTickPhase3D,
  type ReactiveWorldTickProgress3D,
  type ReactiveWorldTickJob3D,
} from './reactive/reactive-world-tick.js';
export {
  createReactiveWorld3D,
  type ReactiveWorld3D,
  type ReactiveWorldTickCommit3D,
  type ReactiveWorldEditCommit3D,
  type ReactiveWorldTranslationCommit3D,
  type ReactiveWorldHoldCommit3D,
} from './reactive/reactive-world.js';
export {
  REACTIVE_HOLD_RULES_3D,
  REACTIVE_HOLD_LIMITS_3D,
  type ReactiveHold3D,
  type ReactiveHoldRequest3D,
  type ReactiveHoldTickReport3D,
} from './reactive/reactive-holds.js';
export {
  REACTIVE_SESSION_RULES_3D,
  REACTIVE_SESSION_SCHEMA_3D,
  REACTIVE_SESSION_LIMITS_3D,
  createReactiveSessionSnapshot3D,
  readReactiveSessionSnapshot3D,
  type ReactiveGameValue3D,
  type ReactiveSessionInitial3D,
  type ReactiveSessionSnapshot3D,
  type ReactiveSessionRevision3D,
} from './reactive/reactive-session-state.js';
export {
  createReactiveSession3D,
  type ReactiveSession3D,
  type ReactiveSessionCommand3D,
  type ReactiveSessionPolicy3D,
  type ReactiveSessionQueryAccess3D,
  type ReactiveSessionMovementAccess3D,
  type ReactiveBranchStatus3D,
  type ReactiveBranchProgress3D,
  type ReactiveSessionBoundary3D,
  type ReactiveSessionPreview3D,
  type ReactiveBranch3D,
  type ReactiveSessionCommit3D,
} from './reactive/reactive-session.js';
export {
  REACTIVE_GEOMETRY_RULES_3D,
  type ReactiveGeometryStamp3D,
  type ReactiveGameplayGeometry3D,
  type ReactiveGeometryExposure3D,
} from './reactive/reactive-geometry.js';
export {
  REACTIVE_MOTION_RULES_3D,
  REACTIVE_MOTION_LIMITS_3D,
  type ReactiveMotionCaptureOptions3D,
  type ReactiveTickOptions3D,
  type ReactiveMotionSegment3D,
  type ReactiveMotionChange3D,
  type ReactiveMotionPass3D,
  type ReactiveMotionReport3D,
} from './reactive/reactive-motion-capture.js';
export type { ReactiveTickMovement3D } from './reactive/reactive-motion.js';
export {
  REACTIVE_TRANSLATION_MOTION_RULES_3D,
  REACTIVE_TRANSLATION_MOTION_LIMITS_3D,
  type ReactiveTranslationCaptureOptions3D,
  type ReactiveTranslationPaths3D,
  type ReactiveTranslationMovement3D,
} from './reactive/reactive-translation-motion.js';
export {
  REACTIVE_TRANSLATION_DISPLACEMENT_RULES_3D,
  REACTIVE_TRANSLATION_DISPLACEMENT_LIMITS_3D,
  createReactiveTranslationDisplacement3D,
  type ReactiveTranslationCarry3D,
  type ReactiveTranslationDisplacementOptions3D,
  type ReactiveTranslationDisplacementResult3D,
  type ReactiveTranslationDisplacement3D,
} from './reactive/reactive-translation-displacement.js';
export type { ReactiveSessionTranslationAccess3D } from './reactive/reactive-session.js';
export {
  REACTIVE_ACTOR_GROUP_RULES_3D,
  REACTIVE_ACTOR_GROUP_LIMITS_3D,
  REACTIVE_ACTOR_MOVEMENT_RULES_3D,
  REACTIVE_ACTOR_MOVEMENT_LIMITS_3D,
  createReactiveActorGroup3D,
  createReactiveTranslatedActorGroup3D,
  moveReactiveActors3D,
  type NamedReactiveBody3D,
  type ReactiveActorGroupOptions3D,
  type ReactiveActorPeerContact3D,
  type ReactiveActorGroupResult3D,
  type ReactiveActorGroup3D,
  type ReactiveActorMovementCommand3D,
  type ReactiveActorMovementContact3D,
  type ReactiveActorFooting3D,
  type ReactiveActorMovementResponse3D,
  type ReactiveActorMovementResult3D,
} from './reactive/reactive-actor-group.js';
export {
  REACTIVE_BODY_RULES_3D,
  REACTIVE_BODY_LIMITS_3D,
  createReactiveBody3D,
  readReactiveBody3D,
  stepReactiveBody3D,
  type ReactiveBody3D,
  type ReactiveBodyInitial3D,
  type ReactiveBodyCommand3D,
  type ReactiveBodyResolution3D,
} from './reactive/reactive-body.js';
export {
  REACTIVE_DISPLACEMENT_RULES_3D,
  REACTIVE_DISPLACEMENT_LIMITS_3D,
  createReactiveDisplacement3D,
  type ReactiveDisplacement3D,
  type ReactiveDisplacementOptions3D,
  type ReactiveDisplacementContact3D,
  type ReactiveDisplacementResult3D,
  type ReactiveCarry3D,
} from './reactive/reactive-displacement.js';
export {
  GEOMETRY_SCALE_3D,
  GEOMETRY_LIMITS_3D,
  EXPOSURE_RULES_VERSION_3D,
  type GeometryVector3D,
  type GeometryBox3D,
  type GeometryTime3D,
  type GeometryCell3D,
  type GeometryContact3D,
  type GeometryFilter3D,
  type MaterialExposure3D,
} from './geometry-kernel.js';
export {
  REACTIVE_DOMAINS_RULES_3D,
  REACTIVE_DOMAINS_SCHEMA_3D,
  REACTIVE_DOMAINS_LIMITS_3D,
  createReactiveDomainsSnapshot3D,
  readReactiveDomainsSnapshot3D,
  type ReactiveDomainId3D,
  type ReactiveReservoir3D,
  type ReactiveDomainsSnapshot3D,
} from './reactive/reactive-domain-state.js';
export {
  createReactiveDomainSet3D,
  createReactiveDomainsTickJob3D,
  type ReactiveDomainSet3D,
  type ReactiveDomainCommit3D,
  type ReactiveDomainsTickReport3D,
  type ReactiveDomainsTickResult3D,
  type ReactiveDomainsTickProgress3D,
  type ReactiveDomainsTickJob3D,
  type ReactiveDomainsMotion3D,
} from './reactive/reactive-domains.js';
export {
  REACTIVE_TRANSFER_RULES_3D,
  REACTIVE_TRANSFER_LIMITS_3D,
  createReactiveTransferJob3D,
  type ReactiveTransferRequest3D,
  type ReactiveTransferReceipt3D,
  type ReactiveTransferResult3D,
  type ReactiveTransferProgress3D,
  type ReactiveTransferJob3D,
} from './reactive/reactive-transfer.js';
export {
  createReactiveTranslationJob3D,
  REACTIVE_TRANSLATION_RULES_3D,
  REACTIVE_TRANSLATION_LIMITS_3D,
  type ReactiveTranslationCoordinate3D,
  type ReactiveTranslationRequest3D,
  type ReactiveTranslationStep3D,
  type ReactiveTranslationReceipt3D,
  type ReactiveTranslationResult3D,
  type ReactiveTranslationProgress3D,
  type ReactiveTranslationJob3D,
} from './reactive/reactive-translation.js';
export {
  REACTIVE_TRANSPORT_RULES_3D,
  REACTIVE_TRANSPORT_SCHEMA_3D,
  REACTIVE_TRANSPORT_MEMORY_RULES_3D,
  REACTIVE_TRANSPORT_LIMITS_3D,
  createReactiveMaterialTransport3D,
  readReactiveMaterialTransport3D,
  applyReactiveMaterialTransport3D,
  captureReactiveMaterialTransportMemory3D,
  restoreReactiveMaterialTransportMemory3D,
  type ReactiveMaterialParcel3D,
  type ReactiveMaterialParcelSeed3D,
  type ReactiveMaterialImpulse3D,
  type ReactiveTransportIdentity3D,
  type ReactiveMaterialTransport3D,
  type ReactiveMaterialTransportReceipt3D,
  type ReactiveMaterialTransportMemory3D,
} from './reactive/reactive-transport.js';
export { followReactiveMaterialTransport3D } from './reactive/reactive-transport-coupling.js';
export {
  createReactiveMaterialTransportJob3D,
  type ReactiveMaterialTransportJob3D,
  type ReactiveTransportProgress3D,
  type ReactiveTransportResult3D,
} from './reactive/reactive-transport.js';
export {
  REACTIVE_TRANSPORT_MOTION_RULES_3D,
  REACTIVE_TRANSPORT_MOTION_LIMITS_3D,
  type ReactiveTransportCaptureOptions3D,
  type ReactiveTransportPaths3D,
  type ReactiveTransportMovement3D,
} from './reactive/reactive-transport-motion.js';
export {
  REACTIVE_TRANSPORT_DISPLACEMENT_RULES_3D,
  REACTIVE_TRANSPORT_DISPLACEMENT_LIMITS_3D,
  createReactiveTransportDisplacement3D,
  type ReactiveTransportDisplacement3D,
  type ReactiveTransportDisplacementResult3D,
} from './reactive/reactive-transport-displacement.js';
export { createReactiveTransportedActorGroup3D } from './reactive/reactive-actor-group.js';
export type {
  ReactiveTransportCommand3D,
  ReactiveTransportCommandResult3D,
  ReactiveSessionTransportAccess3D,
} from './reactive/reactive-session.js';
export {
  REACTIVE_WORKER_PROTOCOL_3D,
  REACTIVE_WORKER_LIMITS_3D,
  type ReactiveWorkerTransport3D,
  type ReactiveWorkerPreviewOptions3D,
} from './reactive/reactive-worker-wire.js';
export { createReactiveWorkerHost3D } from './reactive/reactive-worker-host.js';
export {
  createReactiveWorkerClient3D,
  reactiveBrowserWorkerTransport3D,
  type ReactiveWorkerClient3D,
  type ReactiveWorkerState3D,
  type ReactiveWorkerClientOptions3D,
  type ReactiveWorkerTicket3D,
  type ReactiveWorkerOutcome3D,
  type ReactiveWorkerInspectionProgress3D,
} from './reactive/reactive-worker-client.js';
export {
  REACTIVE_CHANGE_RULES_3D,
  REACTIVE_CHANGE_LIMITS_3D,
  REACTIVE_CHANGE_CHANNELS_3D,
  createReactiveChangeJob3D,
  type ReactiveChangeOptions3D,
  type ReactiveChangeReport3D,
  type ReactiveChangeChannel3D,
  type ReactiveChangedCells3D,
  type ReactiveChangeJob3D,
  type ReactiveChangeProgress3D,
} from './reactive/reactive-changes.js';
export {
  REACTIVE_QUERY_RULES_3D,
  REACTIVE_QUERY_LIMITS_3D,
  type ReactiveWorkerQuery3D,
  type ReactiveWorkerQueryResult3D,
  type ReactiveWorkerQueryBatch3D,
  type ReactiveQueryProgress3D,
} from './reactive/reactive-worker-queries.js';
export {
  createThermalMaterialRegistry3D,
  THERMAL_MATERIAL_PACK_3D,
  THERMAL_MAT_3D,
} from './reactive/thermal-materials.js';
