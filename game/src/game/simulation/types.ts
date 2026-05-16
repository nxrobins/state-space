import type { MaterialType } from './constants';

export type FighterId = 'p1' | 'cpu';
export type FighterSpecId = 'water' | 'earth' | 'fire';
export type InputCommand = 'basic' | 'special1' | 'special2' | 'special3';
export type MatchPhase = 'running' | 'suddenDeath' | 'finished';
export type MatchEndReason = 'stocks' | 'timer' | 'sudden-death';
export type BoostStat = 'size' | 'duration' | 'knockback';
export type MoveDenialReason = 'finished' | 'active-move' | 'hitstun' | 'cooldown' | 'meter';

export interface ActionState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  dash: boolean;
  block: boolean;
  basic: boolean;
  special1: boolean;
  special2: boolean;
  special3: boolean;
}

export interface MaterialCell {
  material: MaterialType;
  expiresAtTick: number | null;
  ownerId?: FighterId;
}

export interface TemporaryCellRef {
  index: number;
  expiresAtTick: number;
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
  sourceId: FighterId;
  targetId: FighterId;
  damage: number;
  blocked: boolean;
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
}

export interface ActiveHitbox {
  id: number;
  ownerId: FighterId;
  moveId: string;
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
