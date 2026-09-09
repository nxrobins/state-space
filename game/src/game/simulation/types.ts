import type { MaterialType } from './constants';

export type FighterId = 'p1' | 'cpu';
export type FighterSpecId = 'water' | 'earth' | 'fire';
export type MoveDirection = 'neutral' | 'side' | 'up' | 'down' | 'forward' | 'back';
export type MoveCategory = 'attack' | 'special' | 'grab' | 'throw';
export type HitType = 'strike' | 'grab';
export type InputCommand =
  | 'basic'
  | 'special1'
  | 'special2'
  | 'special3'
  | 'attack-neutral'
  | 'attack-side'
  | 'attack-up'
  | 'attack-down'
  | 'air-neutral'
  | 'air-forward'
  | 'air-back'
  | 'air-up'
  | 'air-down'
  | 'special-neutral'
  | 'special-side'
  | 'special-up'
  | 'special-down'
  | 'grab-neutral'
  | 'grab-forward'
  | 'grab-back'
  | 'grab-up'
  | 'grab-down';
export type MatchPhase = 'running' | 'suddenDeath' | 'finished';
export type MatchEndReason = 'stocks' | 'timer' | 'sudden-death';
export type BoostStat = 'size' | 'duration' | 'knockback';
export type MoveDenialReason = 'finished' | 'active-move' | 'hitstun' | 'shield-stun' | 'landing-lag' | 'cooldown' | 'meter' | 'recovery';
export type MaterialCellProvenance = 'temporary' | 'permanent' | 'snapshot';
export type MaterialComboAdjacency = 'orthogonal';
export type MaterialComboOutput = MaterialType | 'preserve' | 'refresh';
export type CombatImpactKind = 'hit' | 'blocked' | 'hazard';
export type MoveFeelWeight = 'light' | 'medium' | 'heavy';
export type CombatSoundCue = 'hit-light' | 'hit-medium' | 'hit-heavy' | 'block' | 'startup-heavy' | 'ring-danger' | 'hazard';
export type TelegraphStyle = 'light' | 'medium' | 'heavy';

export interface ActionState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  dash: boolean;
  block: boolean;
  attack: boolean;
  special: boolean;
  shield: boolean;
  grab: boolean;
  basic: boolean;
  special1: boolean;
  special2: boolean;
  special3: boolean;
}

export interface BufferedInput {
  command: InputCommand;
  requestedTick: number;
  expiresAtTick: number;
  direction: MoveDirection;
  facing: 1 | -1;
  airborne: boolean;
}

export interface MaterialCell {
  material: MaterialType;
  expiresAtTick: number | null;
  ownerId?: FighterId;
  provenance?: MaterialCellProvenance;
  createdAtTick?: number;
}

export interface TemporaryCellRef {
  index: number;
  expiresAtTick: number;
}

export interface MaterialComboRule {
  id: string;
  inputs: readonly [readonly MaterialType[], readonly MaterialType[]];
  outputs: readonly [MaterialComboOutput, MaterialComboOutput];
  priority: number;
  adjacency: MaterialComboAdjacency;
  allowedProvenance: readonly MaterialCellProvenance[];
  maxRefreshTicks?: number;
  eventMessage?: string;
}

export interface RuntimeStats {
  lastFrameMs: number;
  simStepsLastFrame: number;
  catchupClamps: number;
  dirtyCellsLastFrame: number;
  temporaryCellsLength: number;
  temporaryCellCount: number;
  activeHitboxCount: number;
  moveDenials: Partial<Record<MoveDenialReason, number>>;
  lastMoveDenial: MoveActivationResult | null;
  combatImpactSeq: number;
  lastCombatImpact: CombatImpact | null;
  lastCpuDecision: CpuDecisionTelemetry | null;
}

export interface CombatImpact {
  tick: number;
  sourceId: FighterId | null;
  targetId: FighterId;
  moveId?: string;
  impactKind: CombatImpactKind;
  damage: number;
  blocked: boolean;
  boosted: boolean;
  contactX: number;
  contactY: number;
}

export interface MoveFeelSpec {
  weight: MoveFeelWeight;
  hitstopTicks: number;
  blockedHitstopTicks: number;
  soundCue: CombatSoundCue;
  telegraphStyle: TelegraphStyle;
  shakeOnHit: boolean;
  startupCue?: CombatSoundCue;
}

export interface CpuLaneTelemetry {
  score: number;
  boostCells: number;
  fireCells: number;
  lavaCells: number;
  tempStoneCells: number;
  quenchRiskCells: number;
}

export interface CpuDecisionTelemetry {
  tick: number;
  mode:
    | 'hazard-escape'
    | 'boost-lane'
    | 'incoming-block'
    | 'terrain-unstick'
    | 'approach'
    | 'space'
    | 'engage-basic'
    | 'engage-special'
    | 'neutral';
  reason: string;
  laneChoice: 'left' | 'right' | 'none';
  laneDelta: number;
  leftLane?: CpuLaneTelemetry;
  rightLane?: CpuLaneTelemetry;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HitboxSpec {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export interface MaterialSpawnSpec {
  offsetCellsX: number;
  offsetCellsY: number;
  widthCells: number;
  heightCells: number;
  material: MaterialType;
  lifetimeTicks: number;
}

export interface MoveSpec {
  id: string;
  name: string;
  command: InputCommand;
  category?: MoveCategory;
  direction?: MoveDirection;
  airborne?: boolean;
  hitType?: HitType;
  animationId?: string;
  landingLagTicks?: number;
  bufferable?: boolean;
  oncePerAirtime?: boolean;
  meterCost: number;
  boostedMeterCost: number;
  cooldownTicks: number;
  startupTicks: number;
  activeTicks: number;
  recoveryTicks: number;
  damage: number;
  knockbackX: number;
  knockbackY: number;
  hitbox: HitboxSpec;
  materialSpawns: MaterialSpawnSpec[];
  boost: {
    stat: BoostStat;
    amount: number;
  };
  selfImpulseX?: number;
  selfImpulseY?: number;
}

export interface MoveActivationResult {
  ok: boolean;
  moveId: string;
  boosted: boolean;
  cost: number;
  deniedReason?: MoveDenialReason;
}

export interface ActiveMove {
  moveId: string;
  startedTick: number;
  boosted: boolean;
  spawned: boolean;
  command?: InputCommand;
  direction?: MoveDirection;
  facing?: 1 | -1;
  airborne?: boolean;
}

export interface ActiveHitbox {
  id: number;
  ownerId: FighterId;
  moveId: string;
  boosted: boolean;
  hitType: HitType;
  rect: Rect;
  damage: number;
  knockbackX: number;
  knockbackY: number;
  expiresAtTick: number;
  hitFighterIds: FighterId[];
}

export interface FighterSpec {
  id: FighterSpecId;
  name: string;
  element: FighterSpecId;
  styleName: string;
  difficulty: string;
  summary: string;
  portraitUrl: string;
  color: number;
  accentColor: number;
  spawn: { x: number; y: number };
  width: number;
  height: number;
  moveSpeed: number;
  jumpVelocity: number;
  dashVelocity: number;
  moves: MoveSpec[];
}

export interface FighterState {
  id: FighterId;
  specId: FighterSpecId;
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  width: number;
  height: number;
  health: number;
  stocks: number;
  meter: number;
  onGround: boolean;
  blockedTicks: number;
  invulnTicks: number;
  hitstunTicks: number;
  blockTicks: number;
  shieldPoints: number;
  shieldStunTicks: number;
  shieldReleaseTicks: number;
  landingLagTicks: number;
  jumpHeldTicks: number;
  airRecoveryUsed: boolean;
  inputBuffer: BufferedInput | null;
  slowTicks: number;
  activeMove: ActiveMove | null;
  moveCooldowns: Record<string, number>;
  boosted: boolean;
  lastDamageTakenTick: number;
}

export interface BattleEvent {
  tick: number;
  type: string;
  message: string;
}

export interface MatchResult {
  winner: FighterId | null;
  reason: MatchEndReason;
  finalStocks: Record<FighterId, number>;
  finalHealth: Record<FighterId, number>;
  elapsedTicks: number;
}

export interface ReplayFrame {
  tick: number;
  input: number;
}

export interface ReplayLog {
  schemaVersion: number;
  matchId: string;
  selectedFighter: FighterSpecId;
  seed: number;
  frames: ReplayFrame[];
  completedResult?: MatchResult;
}

export interface OperationalEvent {
  matchId?: string;
  tick?: number;
  type: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface BattleState {
  matchId: string;
  schemaVersion: number;
  tick: number;
  timerTicks: number;
  initialSeed: number;
  rngSeed: number;
  materialGrid: MaterialCell[];
  temporaryCells: TemporaryCellRef[];
  temporaryCellHead: number;
  temporaryCellCount: number;
  dirtyMaterialIndices: Set<number>;
  fighters: Record<FighterId, FighterState>;
  activeHitboxes: ActiveHitbox[];
  nextHitboxId: number;
  matchPhase: MatchPhase;
  result: MatchResult | null;
  eventLog: BattleEvent[];
  runtimeStats: RuntimeStats;
}
