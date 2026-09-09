import {
  ARENA_WIDTH,
  BOOST_REQUIRED_CELLS,
  CELL_SIZE,
  GRID_HEIGHT,
  GRID_WIDTH,
  MATCH_TICKS,
  MAX_HEALTH,
  MAX_METER,
  MaterialType,
  REPLAY_SCHEMA_VERSION,
  RESPAWN_INVULN_TICKS,
  STARTING_STOCKS,
} from './constants';
import { activeMoveDamping, rectIntersectionCenter } from '../combatFeel';
import { createBufferedInput, resolveCommandCandidate } from '../input/commandResolver';
import { createRuntimeStats, noteMoveDenial } from '../ops';
import { BOOST_MATERIALS, cpuOpponentFor, FIGHTER_SPECS } from './fighters';
import {
  buildArenaGrid,
  cellToWorld,
  clearRectAroundWorldPoint,
  countMatchingCellsNearFighter,
  getCell,
  markNonAirCellsDirty,
  materialsInFighterRect,
  rectIntersectsSolid,
  setTemporaryRect,
  tickMaterialLifetimes,
  worldBoundsExceeded,
  worldToCell,
  gridIndex,
  inGrid,
} from './grid';
import { resolveMaterialCombos } from './materialCombos';
import { moveForCommand } from './moves';
import { randomInt } from './rng';
import type {
  ActionState,
  ActiveHitbox,
  BattleState,
  BufferedInput,
  CombatImpact,
  CpuDecisionTelemetry,
  CpuLaneTelemetry,
  FighterId,
  FighterSpec,
  FighterSpecId,
  FighterState,
  InputCommand,
  MatchEndReason,
  MatchResult,
  MaterialCell,
  MoveActivationResult,
  MoveDenialReason,
  MoveSpec,
  Rect,
} from './types';

interface DamageContext {
  moveId?: string;
  boosted?: boolean;
  contactX?: number;
  contactY?: number;
  hitType?: 'strike' | 'grab';
}

const GRAVITY = 0.78;
const MAX_FALL_SPEED = 17;
const FRICTION = 0.78;
const P1_SPAWN = { x: 310, y: 560 };
const CPU_SPAWN = { x: 970, y: 560 };
const WATER_HAZARD_DAMAGE_MULTIPLIER = 0.65;
const EARTH_DAMAGE_MULTIPLIER = 0.9;
const EARTH_KNOCKBACK_MULTIPLIER = 0.78;
const EARTH_HITSTUN_REDUCTION = 2;
const FIRE_BOOSTED_DAMAGE_MULTIPLIER = 1.14;
const MAX_SHIELD_POINTS = 100;
const SHIELD_REGEN_PER_TICK = 0.42;
const SHIELD_HOLD_DRAIN_PER_TICK = 0.08;
const SHIELD_BREAK_STUN_TICKS = 120;
const SHIELD_RELEASE_TICKS = 5;
const SHORT_HOP_RELEASE_TICKS = 7;
const CPU_BOOST_MATCH_WEIGHT = 2;
const CPU_LANE_FIRE_PENALTY = 2;
const CPU_LANE_LAVA_PENALTY = 4;
const CPU_LANE_TEMP_STONE_PENALTY = 3;
const CPU_LANE_WATER_LAVA_QUENCH_PENALTY = 5;
const REACTION_OFFSETS = [
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
];

interface CpuTemperament {
  approachDistance: number;
  spacingDistance: number;
  basicRange: number;
  basicVerticalRange: number;
  specialRange: number;
  jumpChaseVerticalDistance: number;
  approachReason: string;
  spacingReason: string;
}

const CPU_TEMPERAMENTS: Record<FighterSpecId, CpuTemperament> = {
  water: {
    approachDistance: 210,
    spacingDistance: 70,
    basicRange: 68,
    basicVerticalRange: 52,
    specialRange: 280,
    jumpChaseVerticalDistance: 40,
    approachReason: 'water keepout advance',
    spacingReason: 'water keepout spacing',
  },
  earth: {
    approachDistance: 176,
    spacingDistance: 52,
    basicRange: 84,
    basicVerticalRange: 64,
    specialRange: 235,
    jumpChaseVerticalDistance: 52,
    approachReason: 'earth pressure advance',
    spacingReason: 'earth reset spacing',
  },
  fire: {
    approachDistance: 152,
    spacingDistance: 42,
    basicRange: 90,
    basicVerticalRange: 58,
    specialRange: 265,
    jumpChaseVerticalDistance: 44,
    approachReason: 'fire rushdown advance',
    spacingReason: 'fire micro-reset spacing',
  },
};

export const EMPTY_ACTIONS: ActionState = {
  left: false,
  right: false,
  up: false,
  down: false,
  dash: false,
  block: false,
  attack: false,
  special: false,
  shield: false,
  grab: false,
  basic: false,
  special1: false,
  special2: false,
  special3: false,
};

interface CreateBattleStateOptions {
  matchId?: string;
  initialMaterialGrid?: MaterialCell[];
}

export function createBattleState(
  playerSpecId: FighterSpecId = 'water',
  seed = 0xc0ffee,
  options: CreateBattleStateOptions = {},
): BattleState {
  const cpuSpecId = cpuOpponentFor(playerSpecId);
  const state: BattleState = {
    matchId: options.matchId ?? createMatchId(seed),
    schemaVersion: REPLAY_SCHEMA_VERSION,
    tick: 0,
    timerTicks: MATCH_TICKS,
    initialSeed: seed >>> 0,
    rngSeed: seed >>> 0,
    materialGrid: options.initialMaterialGrid ? cloneInitialMaterialGrid(options.initialMaterialGrid) : buildArenaGrid(),
    temporaryCells: [],
    temporaryCellHead: 0,
    temporaryCellCount: 0,
    dirtyMaterialIndices: new Set<number>(),
    fighters: {
      p1: createFighterState('p1', playerSpecId, P1_SPAWN),
      cpu: createFighterState('cpu', cpuSpecId, CPU_SPAWN),
    },
    activeHitboxes: [],
    nextHitboxId: 1,
    matchPhase: 'running',
    result: null,
    eventLog: [],
    runtimeStats: createRuntimeStats(),
  };
  ensureSpawnSafety(state, state.fighters.p1);
  ensureSpawnSafety(state, state.fighters.cpu);
  markNonAirCellsDirty(state);
  return state;
}

function cloneInitialMaterialGrid(grid: MaterialCell[]): MaterialCell[] {
  const expectedCells = GRID_WIDTH * GRID_HEIGHT;
  if (grid.length !== expectedCells) {
    throw new Error(`Initial material grid must contain ${expectedCells} cells, received ${grid.length}.`);
  }
  return grid.map((cell) => ({ material: cell.material, expiresAtTick: null, provenance: cell.provenance ?? 'snapshot' }));
}

export function stepBattle(
  state: BattleState,
  playerActions: ActionState = EMPTY_ACTIONS,
  cpuActionsOverride?: ActionState,
): BattleState {
  if (state.matchPhase === 'finished') return state;

  tickMaterialLifetimes(state);
  decrementCounters(state.fighters.p1);
  decrementCounters(state.fighters.cpu);
  updateBoostFlags(state);

  const cpuActions = cpuActionsOverride ?? computeCpuActions(state);
  applyFighterIntent(state, state.fighters.p1, playerActions);
  applyFighterIntent(state, state.fighters.cpu, cpuActions);

  updateActiveMove(state, state.fighters.p1);
  updateActiveMove(state, state.fighters.cpu);

  moveFighter(state, state.fighters.p1, playerActions);
  moveFighter(state, state.fighters.cpu, cpuActions);

  processHitboxes(state);
  resolveMaterialCombos(state);
  applyMaterialEffects(state);
  resolveStockLosses(state);
  resolveTimer(state);

  state.tick++;
  return state;
}

export function fighterHasMaterialBoost(state: BattleState, fighter: FighterState): boolean {
  const matching = BOOST_MATERIALS[FIGHTER_SPECS[fighter.specId].element];
  return countMatchingCellsNearFighter(state.materialGrid, fighter, matching) >= BOOST_REQUIRED_CELLS;
}

export function tryStartMove(
  state: BattleState,
  fighter: FighterState,
  command: InputCommand,
  bufferedInput?: BufferedInput,
): MoveActivationResult {
  const move = moveForCommand(fighter.specId, command);
  const boosted = move.category === 'special' && move.meterCost > 0 && fighter.boosted;
  const cost = boosted ? move.boostedMeterCost : move.meterCost;

  if (state.matchPhase === 'finished') return denyMove(state, 'finished', move.id, cost, boosted);
  if (fighter.activeMove) return denyMove(state, 'active-move', move.id, cost, boosted);
  if (fighter.hitstunTicks > 0) return denyMove(state, 'hitstun', move.id, cost, boosted);
  if (fighter.shieldStunTicks > 0) return denyMove(state, 'shield-stun', move.id, cost, boosted);
  if (fighter.landingLagTicks > 0) return denyMove(state, 'landing-lag', move.id, cost, boosted);
  if (move.oncePerAirtime && fighter.airRecoveryUsed && !fighter.onGround) return denyMove(state, 'recovery', move.id, cost, boosted);

  if ((fighter.moveCooldowns[move.id] ?? 0) > 0) return denyMove(state, 'cooldown', move.id, cost, boosted);

  const isSpecial = move.category === 'special';
  if (fighter.meter < cost) {
    if (isSpecial) pushEvent(state, 'meter-empty', `${fighter.id} lacked meter for ${move.name}`);
    return denyMove(state, 'meter', move.id, cost, boosted);
  }

  fighter.meter = clamp(fighter.meter - cost, 0, MAX_METER);
  fighter.moveCooldowns[move.id] = move.cooldownTicks;
  fighter.activeMove = {
    moveId: move.id,
    startedTick: state.tick,
    boosted,
    spawned: false,
    command,
    direction: bufferedInput?.direction ?? move.direction,
    facing: bufferedInput?.facing ?? fighter.facing,
    airborne: bufferedInput?.airborne ?? !fighter.onGround,
  };
  if (move.oncePerAirtime) fighter.airRecoveryUsed = true;
  pushEvent(state, 'move-start', `${fighter.id} started ${move.name}${fighter.activeMove.boosted ? ' boosted' : ''}`);
  return { ok: true, moveId: move.id, boosted, cost };
}

export function applyDamage(
  state: BattleState,
  target: FighterState,
  amount: number,
  knockbackX: number,
  knockbackY: number,
  sourceOwnerId: FighterId | null,
  context: DamageContext = {},
): boolean {
  if (state.matchPhase === 'finished' || target.invulnTicks > 0 || amount <= 0) return false;

  const sourceFighter = sourceOwnerId && sourceOwnerId !== target.id ? state.fighters[sourceOwnerId] : null;
  const environmentalDamage = sourceFighter === null;
  const blocked = target.blockTicks > 0 && target.hitstunTicks === 0 && context.hitType !== 'grab';
  const sourceMoveBoosted = context.boosted ?? sourceFighter?.activeMove?.boosted ?? false;
  let finalDamage = blocked ? amount * 0.25 : amount;
  let finalKnockbackX = blocked ? knockbackX * 0.45 : knockbackX;
  let finalKnockbackY = blocked ? knockbackY * 0.45 : knockbackY;

  if (sourceFighter?.specId === 'fire' && (sourceFighter.boosted || sourceMoveBoosted)) {
    finalDamage *= FIRE_BOOSTED_DAMAGE_MULTIPLIER;
  }
  if (target.specId === 'water' && environmentalDamage) {
    finalDamage *= WATER_HAZARD_DAMAGE_MULTIPLIER;
  }
  if (target.specId === 'earth') {
    finalDamage *= EARTH_DAMAGE_MULTIPLIER;
    finalKnockbackX *= EARTH_KNOCKBACK_MULTIPLIER;
    finalKnockbackY *= EARTH_KNOCKBACK_MULTIPLIER;
  }

  if (blocked) {
    target.shieldPoints = clamp(target.shieldPoints - (amount + Math.abs(knockbackX) * 0.8 + Math.abs(knockbackY) * 0.5), 0, MAX_SHIELD_POINTS);
    target.shieldStunTicks = Math.max(target.shieldStunTicks, 8);
    target.inputBuffer = null;
    if (target.shieldPoints <= 0) {
      target.blockTicks = 0;
      target.shieldStunTicks = SHIELD_BREAK_STUN_TICKS;
      pushEvent(state, 'shield-break', `${target.id} shield broke`);
    }
  }
  target.health = clamp(target.health - finalDamage, 0, MAX_HEALTH);
  target.vx += finalKnockbackX;
  target.vy = finalKnockbackY < 0 ? Math.min(target.vy, finalKnockbackY) : Math.max(target.vy, finalKnockbackY);
  const baseHitstun = blocked ? 8 : 18;
  const finalHitstun = target.specId === 'earth' ? Math.max(4, baseHitstun - EARTH_HITSTUN_REDUCTION) : baseHitstun;
  target.hitstunTicks = Math.max(target.hitstunTicks, finalHitstun);
  target.lastDamageTakenTick = state.tick;
  if (!blocked) {
    target.activeMove = null;
    target.inputBuffer = null;
  }

  if (sourceOwnerId && sourceOwnerId !== target.id) {
    const attacker = state.fighters[sourceOwnerId];
    attacker.meter = clamp(attacker.meter + finalDamage * 0.7, 0, MAX_METER);
  }
  recordCombatImpact(state, {
    tick: state.tick,
    sourceId: sourceOwnerId,
    targetId: target.id,
    moveId: context.moveId,
    impactKind: environmentalDamage ? 'hazard' : blocked ? 'blocked' : 'hit',
    damage: finalDamage,
    blocked,
    boosted: sourceMoveBoosted,
    contactX: context.contactX ?? target.x,
    contactY: context.contactY ?? target.y,
  });
  target.meter = clamp(target.meter + finalDamage * 0.25, 0, MAX_METER);

  if (blocked && sourceOwnerId) {
    pushEvent(state, 'blocked-hit', `${target.id} blocked ${context.moveId ?? 'hit'}`);
  } else {
    pushEvent(state, 'damage', `${target.id} took ${finalDamage.toFixed(1)} damage`);
  }

  if (state.matchPhase === 'suddenDeath') {
    finishMatch(state, sourceOwnerId && sourceOwnerId !== target.id ? sourceOwnerId : otherFighter(target.id), 'sudden-death');
  }

  return true;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function createFighterState(
  id: FighterId,
  specId: FighterSpecId,
  spawn: { x: number; y: number },
): FighterState {
  const spec = FIGHTER_SPECS[specId];
  return {
    id,
    specId,
    x: spawn.x,
    y: spawn.y,
    previousX: spawn.x,
    previousY: spawn.y,
    vx: 0,
    vy: 0,
    facing: id === 'p1' ? 1 : -1,
    width: spec.width,
    height: spec.height,
    health: MAX_HEALTH,
    stocks: STARTING_STOCKS,
    meter: 35,
    onGround: false,
    blockedTicks: 0,
    invulnTicks: 0,
    hitstunTicks: 0,
    blockTicks: 0,
    shieldPoints: MAX_SHIELD_POINTS,
    shieldStunTicks: 0,
    shieldReleaseTicks: 0,
    landingLagTicks: 0,
    jumpHeldTicks: 0,
    airRecoveryUsed: false,
    inputBuffer: null,
    slowTicks: 0,
    activeMove: null,
    moveCooldowns: {},
    boosted: false,
    lastDamageTakenTick: -1,
  };
}

function decrementCounters(fighter: FighterState): void {
  fighter.invulnTicks = Math.max(0, fighter.invulnTicks - 1);
  fighter.hitstunTicks = Math.max(0, fighter.hitstunTicks - 1);
  fighter.blockTicks = Math.max(0, fighter.blockTicks - 1);
  fighter.shieldStunTicks = Math.max(0, fighter.shieldStunTicks - 1);
  fighter.shieldReleaseTicks = Math.max(0, fighter.shieldReleaseTicks - 1);
  fighter.landingLagTicks = Math.max(0, fighter.landingLagTicks - 1);
  fighter.slowTicks = Math.max(0, fighter.slowTicks - 1);
  for (const key of Object.keys(fighter.moveCooldowns)) {
    fighter.moveCooldowns[key] = Math.max(0, fighter.moveCooldowns[key] - 1);
  }
}

function updateBoostFlags(state: BattleState): void {
  state.fighters.p1.boosted = fighterHasMaterialBoost(state, state.fighters.p1);
  state.fighters.cpu.boosted = fighterHasMaterialBoost(state, state.fighters.cpu);
  state.fighters.p1.meter = clamp(state.fighters.p1.meter + (state.fighters.p1.boosted ? 0.12 : 0.05), 0, MAX_METER);
  state.fighters.cpu.meter = clamp(state.fighters.cpu.meter + (state.fighters.cpu.boosted ? 0.12 : 0.05), 0, MAX_METER);
}

function applyFighterIntent(state: BattleState, fighter: FighterState, actions: ActionState): void {
  updateShieldIntent(fighter, actions);
  const candidate = resolveCommandCandidate(fighter, actions);
  if (candidate) {
    fighter.inputBuffer = createBufferedInput(candidate, state.tick);
  }
  if (!fighter.inputBuffer) return;
  if (fighter.inputBuffer.expiresAtTick < state.tick) {
    fighter.inputBuffer = null;
    return;
  }
  if (isFighterActionLocked(fighter)) return;

  const result = tryStartMove(state, fighter, fighter.inputBuffer.command, fighter.inputBuffer);
  if (result.ok || result.deniedReason) fighter.inputBuffer = null;
}

function updateShieldIntent(fighter: FighterState, actions: ActionState): void {
  const wantsShield = actions.shield || actions.block;
  const canShield =
    wantsShield &&
    !fighter.activeMove &&
    fighter.hitstunTicks === 0 &&
    fighter.shieldStunTicks === 0 &&
    fighter.landingLagTicks === 0 &&
    fighter.shieldReleaseTicks === 0 &&
    fighter.shieldPoints > 0;

  if (canShield) {
    fighter.blockTicks = 3;
    fighter.shieldPoints = clamp(fighter.shieldPoints - SHIELD_HOLD_DRAIN_PER_TICK, 0, MAX_SHIELD_POINTS);
    if (fighter.shieldPoints <= 0) fighter.shieldStunTicks = SHIELD_BREAK_STUN_TICKS;
    return;
  }

  if (fighter.blockTicks > 0 && !wantsShield) fighter.shieldReleaseTicks = SHIELD_RELEASE_TICKS;
  fighter.shieldPoints = clamp(fighter.shieldPoints + SHIELD_REGEN_PER_TICK, 0, MAX_SHIELD_POINTS);
}

function isFighterActionLocked(fighter: FighterState): boolean {
  return (
    fighter.health <= 0 ||
    fighter.stocks <= 0 ||
    fighter.hitstunTicks > 0 ||
    fighter.shieldStunTicks > 0 ||
    fighter.activeMove !== null ||
    fighter.landingLagTicks > 0
  );
}

function updateActiveMove(state: BattleState, fighter: FighterState): void {
  if (!fighter.activeMove) return;
  const spec = moveSpecForActiveMove(fighter);
  const elapsed = state.tick - fighter.activeMove.startedTick;
  if (!fighter.activeMove.spawned && elapsed >= spec.startupTicks) {
    spawnMoveEffects(state, fighter, spec, fighter.activeMove.boosted);
    fighter.activeMove.spawned = true;
  }

  if (elapsed >= spec.startupTicks + spec.activeTicks + spec.recoveryTicks) {
    if (!fighter.onGround && spec.landingLagTicks) {
      fighter.landingLagTicks = Math.max(fighter.landingLagTicks, Math.ceil(spec.landingLagTicks / 2));
    }
    fighter.activeMove = null;
  }
}

function moveSpecForActiveMove(fighter: FighterState): MoveSpec {
  const activeMove = fighter.activeMove;
  if (!activeMove) throw new Error('No active move');
  const spec = FIGHTER_SPECS[fighter.specId].moves.find((move) => move.id === activeMove.moveId);
  if (!spec) throw new Error(`Missing active move ${activeMove.moveId}`);
  return spec;
}

function spawnMoveEffects(
  state: BattleState,
  fighter: FighterState,
  move: MoveSpec,
  boosted: boolean,
): void {
  const moveFacing = fighter.activeMove?.facing ?? fighter.facing;
  const hitbox = buildHitbox(fighter, move, boosted, moveFacing);
  state.activeHitboxes.push({
    id: state.nextHitboxId++,
    ownerId: fighter.id,
    moveId: move.id,
    boosted,
    hitType: move.hitType ?? 'strike',
    rect: hitbox,
    damage: move.damage,
    knockbackX: move.knockbackX * moveFacing * boostedKnockbackMultiplier(move, boosted),
    knockbackY: move.knockbackY * boostedKnockbackMultiplier(move, boosted),
    expiresAtTick: state.tick + move.activeTicks,
    hitFighterIds: [],
  });

  if (move.selfImpulseX) fighter.vx += move.selfImpulseX * moveFacing;
  if (move.selfImpulseY) {
    fighter.vy += move.selfImpulseY;
    if (move.selfImpulseY < 0) fighter.onGround = false;
  }

  const baseCellX = worldToCell(fighter.x);
  const baseCellY = worldToCell(fighter.y);
  for (const spawn of move.materialSpawns) {
    const boostedWidth = boosted && move.boost.stat === 'size' ? spawn.widthCells + move.boost.amount : spawn.widthCells;
    const boostedLifetime = boosted && move.boost.stat === 'duration' ? spawn.lifetimeTicks + move.boost.amount : spawn.lifetimeTicks;
    const x = moveFacing === 1
      ? baseCellX + spawn.offsetCellsX
      : baseCellX - spawn.offsetCellsX - boostedWidth + 1;
    const y = settleSpawnYAbovePermanentCells(state, x, baseCellY + spawn.offsetCellsY, boostedWidth, spawn.heightCells);
    setTemporaryRect(state, fighter.id, x, y, boostedWidth, spawn.heightCells, spawn.material, boostedLifetime);
  }
}

function settleSpawnYAbovePermanentCells(
  state: BattleState,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  let currentY = y;
  for (let attempt = 0; attempt < height + 8; attempt++) {
    let hasOpenCell = false;
    for (let cy = currentY; cy < currentY + height; cy++) {
      for (let cx = x; cx < x + width; cx++) {
        if (getCell(state.materialGrid, cx, cy).expiresAtTick !== null || getCell(state.materialGrid, cx, cy).material === MaterialType.Air) {
          hasOpenCell = true;
          break;
        }
      }
      if (hasOpenCell) break;
    }
    if (hasOpenCell) return currentY;
    currentY--;
  }
  return y;
}

function buildHitbox(fighter: FighterState, move: MoveSpec, boosted: boolean, facing = fighter.facing): Rect {
  const extraWidth = boosted && move.boost.stat === 'size' ? move.boost.amount * CELL_SIZE : 0;
  const width = move.hitbox.width + extraWidth;
  const height = move.hitbox.height;
  const centerX = fighter.x + move.hitbox.offsetX * facing;
  const centerY = fighter.y + move.hitbox.offsetY;
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  };
}

function boostedKnockbackMultiplier(move: MoveSpec, boosted: boolean): number {
  return boosted && move.boost.stat === 'knockback' ? move.boost.amount : 1;
}

function moveFighter(state: BattleState, fighter: FighterState, actions: ActionState): void {
  const spec = FIGHTER_SPECS[fighter.specId];
  fighter.previousX = fighter.x;
  fighter.previousY = fighter.y;

  if (fighter.hitstunTicks === 0 && fighter.shieldStunTicks === 0) {
    applyMovementControls(fighter, spec, actions);
  }

  fighter.vy = clamp(fighter.vy + GRAVITY, -100, MAX_FALL_SPEED);
  if (actions.down && fighter.vy > 0) fighter.vy = Math.min(MAX_FALL_SPEED, fighter.vy + 0.8);

  resolveFighterCollision(state, fighter);
}

function applyMovementControls(fighter: FighterState, spec: FighterSpec, actions: ActionState): void {
  const speed = spec.moveSpeed * (fighter.slowTicks > 0 ? 0.55 : 1);
  let desired = 0;
  const movementLocked = fighter.landingLagTicks > 0 || fighter.shieldStunTicks > 0;
  if (!movementLocked && actions.left) {
    desired -= speed;
    if (!fighter.activeMove) fighter.facing = -1;
  }
  if (!movementLocked && actions.right) {
    desired += speed;
    if (!fighter.activeMove) fighter.facing = 1;
  }

  if (fighter.activeMove) {
    desired *= activeMoveDamping(fighter.activeMove.moveId);
  }

  if (!movementLocked && actions.dash && (fighter.moveCooldowns.dash ?? 0) === 0 && !fighter.activeMove) {
    fighter.vx = spec.dashVelocity * fighter.facing;
    fighter.moveCooldowns.dash = 34;
  } else if (desired !== 0) {
    fighter.vx = desired;
  } else if (fighter.onGround) {
    fighter.vx *= FRICTION;
    if (Math.abs(fighter.vx) < 0.05) fighter.vx = 0;
  }

  if (!movementLocked && actions.up && fighter.onGround && !fighter.activeMove) {
    fighter.vy = spec.jumpVelocity;
    fighter.onGround = false;
    fighter.jumpHeldTicks = 1;
  } else if (actions.up && fighter.jumpHeldTicks > 0) {
    fighter.jumpHeldTicks++;
  } else if (!actions.up && fighter.jumpHeldTicks > 0) {
    if (!fighter.onGround && fighter.jumpHeldTicks <= SHORT_HOP_RELEASE_TICKS && fighter.vy < -5) {
      fighter.vy *= 0.58;
    }
    fighter.jumpHeldTicks = 0;
  }

  if (fighter.blockTicks > 0) {
    fighter.vx *= 0.35;
  }
  if (!fighter.onGround && actions.down && !fighter.activeMove && fighter.vy > 0) {
    fighter.vy = Math.max(fighter.vy, 10.5);
  }
}

function resolveFighterCollision(state: BattleState, fighter: FighterState): void {
  const previousX = fighter.x;
  const wasOnGround = fighter.onGround;
  fighter.x += fighter.vx;
  let blocked = false;
  if (fighterRectIntersectsSolid(state, fighter)) {
    const dir = Math.sign(fighter.vx) || 1;
    let guard = Math.ceil(Math.abs(fighter.vx)) + CELL_SIZE;
    while (fighterRectIntersectsSolid(state, fighter) && guard-- > 0) {
      fighter.x -= dir;
    }
    fighter.vx = 0;
    blocked = true;
  }

  fighter.onGround = false;
  fighter.y += fighter.vy;
  if (fighterRectIntersectsSolid(state, fighter)) {
    const dir = Math.sign(fighter.vy) || 1;
    let guard = Math.ceil(Math.abs(fighter.vy)) + CELL_SIZE;
    while (fighterRectIntersectsSolid(state, fighter) && guard-- > 0) {
      fighter.y -= dir;
    }
    if (dir > 0) fighter.onGround = true;
    fighter.vy = 0;
  }

  if (!wasOnGround && fighter.onGround) {
    fighter.airRecoveryUsed = false;
    fighter.jumpHeldTicks = 0;
    if (fighter.activeMove) {
      const move = moveSpecForActiveMove(fighter);
      if (move.landingLagTicks && (move.airborne || fighter.activeMove.airborne)) {
        fighter.landingLagTicks = Math.max(fighter.landingLagTicks, move.landingLagTicks);
        fighter.activeMove = null;
      }
    }
  }

  if (blocked || Math.abs(fighter.x - previousX) < 0.15 && Math.abs(fighter.vx) > 0.2) {
    fighter.blockedTicks++;
  } else {
    fighter.blockedTicks = Math.max(0, fighter.blockedTicks - 2);
  }
}

function fighterRectIntersectsSolid(state: BattleState, fighter: FighterState): boolean {
  return rectIntersectsSolid(
    state.materialGrid,
    fighter.x - fighter.width / 2,
    fighter.y - fighter.height / 2,
    fighter.width,
    fighter.height,
  );
}

function processHitboxes(state: BattleState): void {
  state.activeHitboxes = state.activeHitboxes.filter((hitbox) => hitbox.expiresAtTick > state.tick);
  for (const hitbox of state.activeHitboxes) {
    const targetId = otherFighter(hitbox.ownerId);
    if (hitbox.hitFighterIds.includes(targetId)) continue;
    const target = state.fighters[targetId];
    const targetRect = fighterRect(target);
    if (!rectsOverlap(hitbox.rect, targetRect)) continue;
    const contact = rectIntersectionCenter(hitbox.rect, targetRect);
    const didHit = applyDamage(state, target, hitbox.damage, hitbox.knockbackX, hitbox.knockbackY, hitbox.ownerId, {
      moveId: hitbox.moveId,
      boosted: hitbox.boosted,
      contactX: contact.x,
      contactY: contact.y,
      hitType: hitbox.hitType,
    });
    if (didHit) hitbox.hitFighterIds.push(targetId);
  }
}

function applyMaterialEffects(state: BattleState): void {
  for (const fighter of [state.fighters.p1, state.fighters.cpu]) {
    const materials = materialsInFighterRect(state.materialGrid, fighter);
    if (materials.has(MaterialType.Lava)) {
      applyDamage(state, fighter, 0.65, fighter.x < ARENA_WIDTH / 2 ? -0.18 : 0.18, -0.2, null, {
        contactX: fighter.x,
        contactY: fighter.y,
      });
    } else if (materials.has(MaterialType.Fire)) {
      applyDamage(state, fighter, 0.28, fighter.x < ARENA_WIDTH / 2 ? -0.12 : 0.12, -0.1, null, {
        contactX: fighter.x,
        contactY: fighter.y,
      });
    }

    if (materials.has(MaterialType.Ice)) {
      fighter.slowTicks = Math.max(fighter.slowTicks, 3);
    }

    if (materials.has(MaterialType.Water)) {
      fighter.vx += fighter.x < ARENA_WIDTH / 2 ? -0.16 : 0.16;
    }

    if (materials.has(MaterialType.Steam)) {
      fighter.vy -= 0.42;
    }
  }
}

function resolveStockLosses(state: BattleState): void {
  if (state.matchPhase === 'finished') return;
  const deaths: FighterId[] = [];
  for (const fighter of [state.fighters.p1, state.fighters.cpu]) {
    if (fighter.health <= 0 || worldBoundsExceeded(fighter)) deaths.push(fighter.id);
  }
  if (deaths.length === 0) return;

  if (state.matchPhase === 'suddenDeath') {
    finishMatch(state, otherFighter(deaths[0]), 'sudden-death');
    return;
  }

  for (const id of deaths) loseStock(state, state.fighters[id]);
  evaluateStockWinnerOrSuddenDeath(state);
}

function loseStock(state: BattleState, fighter: FighterState): void {
  fighter.stocks = Math.max(0, fighter.stocks - 1);
  pushEvent(state, 'stock-lost', `${fighter.id} lost a stock`);
  if (fighter.stocks > 0) {
    resetFighterForStock(state, fighter);
  } else {
    fighter.health = 0;
    fighter.vx = 0;
    fighter.vy = 0;
  }
}

function resetFighterForStock(state: BattleState, fighter: FighterState): void {
  const spawn = fighter.id === 'p1' ? P1_SPAWN : CPU_SPAWN;
  clearFighterTransientState(fighter);
  fighter.x = spawn.x;
  fighter.y = spawn.y;
  fighter.previousX = spawn.x;
  fighter.previousY = spawn.y;
  fighter.health = MAX_HEALTH;
  fighter.meter = Math.min(fighter.meter, 50);
  fighter.invulnTicks = RESPAWN_INVULN_TICKS;
  fighter.facing = fighter.id === 'p1' ? 1 : -1;
  ensureSpawnSafety(state, fighter);
}

function clearFighterTransientState(fighter: FighterState): void {
  fighter.vx = 0;
  fighter.vy = 0;
  fighter.onGround = false;
  fighter.blockedTicks = 0;
  fighter.hitstunTicks = 0;
  fighter.blockTicks = 0;
  fighter.shieldStunTicks = 0;
  fighter.shieldReleaseTicks = 0;
  fighter.landingLagTicks = 0;
  fighter.jumpHeldTicks = 0;
  fighter.airRecoveryUsed = false;
  fighter.inputBuffer = null;
  fighter.slowTicks = 0;
  fighter.activeMove = null;
  fighter.moveCooldowns = {};
}

function ensureSpawnSafety(state: BattleState, fighter: FighterState): void {
  clearRectAroundWorldPoint(state, fighter.x, fighter.y, 5, 7);
}

function evaluateStockWinnerOrSuddenDeath(state: BattleState): void {
  const p1 = state.fighters.p1;
  const cpu = state.fighters.cpu;
  if (p1.stocks <= 0 && cpu.stocks <= 0) {
    startSuddenDeath(state);
    return;
  }
  if (p1.stocks <= 0) finishMatch(state, 'cpu', 'stocks');
  if (cpu.stocks <= 0) finishMatch(state, 'p1', 'stocks');
}

function resolveTimer(state: BattleState): void {
  if (state.matchPhase !== 'running') return;
  state.timerTicks = Math.max(0, state.timerTicks - 1);
  if (state.timerTicks > 0) return;

  const p1 = state.fighters.p1;
  const cpu = state.fighters.cpu;
  if (p1.stocks !== cpu.stocks) {
    finishMatch(state, p1.stocks > cpu.stocks ? 'p1' : 'cpu', 'timer');
    return;
  }
  if (Math.abs(p1.health - cpu.health) > 0.001) {
    finishMatch(state, p1.health > cpu.health ? 'p1' : 'cpu', 'timer');
    return;
  }
  startSuddenDeath(state);
}

function startSuddenDeath(state: BattleState): void {
  if (state.matchPhase === 'finished') return;
  state.matchPhase = 'suddenDeath';
  state.activeHitboxes = [];
  for (const fighter of [state.fighters.p1, state.fighters.cpu]) {
    fighter.stocks = 1;
    resetFighterForStock(state, fighter);
    fighter.health = 1;
    fighter.meter = 0;
    fighter.invulnTicks = 45;
  }
  pushEvent(state, 'sudden-death', 'Sudden death started');
}

function finishMatch(state: BattleState, winner: FighterId | null, reason: MatchEndReason): void {
  if (state.result) return;
  const result: MatchResult = {
    winner,
    reason,
    finalStocks: {
      p1: state.fighters.p1.stocks,
      cpu: state.fighters.cpu.stocks,
    },
    finalHealth: {
      p1: state.fighters.p1.health,
      cpu: state.fighters.cpu.health,
    },
    elapsedTicks: state.tick,
  };
  state.result = result;
  state.matchPhase = 'finished';
  state.activeHitboxes = [];
  state.fighters.p1.activeMove = null;
  state.fighters.cpu.activeMove = null;
  state.fighters.p1.inputBuffer = null;
  state.fighters.cpu.inputBuffer = null;
  pushEvent(state, 'match-end', `${winner ?? 'nobody'} won by ${reason}`);
}

function computeCpuActions(state: BattleState): ActionState {
  const cpu = state.fighters.cpu;
  const player = state.fighters.p1;
  const temperament = CPU_TEMPERAMENTS[cpu.specId];
  const actions = { ...EMPTY_ACTIONS };
  if (cpu.hitstunTicks > 0 || state.matchPhase === 'finished') {
    setCpuDecisionTelemetry(state, {
      mode: 'neutral',
      reason: cpu.hitstunTicks > 0 ? 'in hitstun' : 'match finished',
      laneChoice: 'none',
      laneDelta: 0,
    });
    return actions;
  }

  const cpuMaterials = materialsInFighterRect(state.materialGrid, cpu);
  const standingInHazard = cpuMaterials.has(MaterialType.Lava) || cpuMaterials.has(MaterialType.Fire);
  if (standingInHazard) {
    const retreatDirection = cpu.x >= player.x ? 1 : -1;
    if (retreatDirection > 0) actions.right = true;
    else actions.left = true;
    setShieldAction(actions);
    if (cpu.onGround) actions.up = true;
    if ((cpu.moveCooldowns.dash ?? 0) === 0 && Math.abs(cpu.x - player.x) < 240) actions.dash = true;
    setCpuDecisionTelemetry(state, {
      mode: 'hazard-escape',
      reason: cpuMaterials.has(MaterialType.Lava) ? 'standing in lava' : 'standing in fire',
      laneChoice: 'none',
      laneDelta: 0,
    });
    return actions;
  }

  let hasBoostLaneIntent = false;
  let leftLane: CpuLaneTelemetry | undefined;
  let rightLane: CpuLaneTelemetry | undefined;
  let laneChoice: CpuDecisionTelemetry['laneChoice'] = 'none';
  let laneDelta = 0;
  let mode: CpuDecisionTelemetry['mode'] = 'neutral';
  let reason = 'holding neutral';
  if (!cpu.boosted && cpu.meter < 35) {
    const matching = BOOST_MATERIALS[cpu.specId];
    leftLane = scoreCpuBoostLane(state, cpu, -1, matching);
    rightLane = scoreCpuBoostLane(state, cpu, 1, matching);
    laneDelta = rightLane.score - leftLane.score;
    if (Math.abs(laneDelta) >= 4) {
      if (laneDelta > 0) {
        actions.right = true;
        laneChoice = 'right';
      } else {
        actions.left = true;
        laneChoice = 'left';
      }
      mode = 'boost-lane';
      reason = 'low meter lane seek';
      hasBoostLaneIntent = true;
    } else {
      reason = 'low meter, lanes too close';
    }
  }

  const incoming = state.activeHitboxes.some((hitbox) =>
    hitbox.ownerId === 'p1' && rectsOverlap(expandRect(hitbox.rect, 18), fighterRect(cpu)),
  );
  if (incoming) {
    setShieldAction(actions);
    if (cpu.onGround && Math.abs(cpu.x - player.x) < 95) actions.up = true;
    setCpuDecisionTelemetry(state, {
      mode: 'incoming-block',
      reason: 'incoming hitbox threat',
      laneChoice,
      laneDelta,
      leftLane,
      rightLane,
    });
    return actions;
  }

  const dx = player.x - cpu.x;
  const dy = player.y - cpu.y;
  const absDx = Math.abs(dx);
  if (cpu.blockedTicks > 90) {
    actions.up = true;
    actions.dash = true;
    if (dx > 0) actions.left = true;
    else actions.right = true;
    if (cpu.blockedTicks > 120) actions.attack = true;
    setCpuDecisionTelemetry(state, {
      mode: 'terrain-unstick',
      reason: `blocked ${cpu.blockedTicks} ticks`,
      laneChoice,
      laneDelta,
      leftLane,
      rightLane,
    });
    return actions;
  }

  if (!hasBoostLaneIntent && absDx > temperament.approachDistance) {
    if (dx > 0) actions.right = true;
    else actions.left = true;
    if (cpu.onGround && Math.abs(player.y - cpu.y) > temperament.jumpChaseVerticalDistance) actions.up = true;
    mode = 'approach';
    reason = temperament.approachReason;
  } else if (!hasBoostLaneIntent && absDx < temperament.spacingDistance) {
    if (dx > 0) actions.left = true;
    else actions.right = true;
    if (state.tick % 80 < 18) setShieldAction(actions);
    mode = 'space';
    reason = temperament.spacingReason;
  }

  if (absDx < temperament.basicRange && Math.abs(player.y - cpu.y) < temperament.basicVerticalRange) {
    actions.attack = true;
    mode = 'engage-basic';
    reason = `${cpu.specId} basic punish window`;
  } else if (absDx < temperament.specialRange) {
    const choice = chooseCpuSpecialCommand(state, cpu, absDx, dy);
    if (choice) {
      applyCpuSpecialAction(actions, choice.command);
      mode = 'engage-special';
      reason = `special pressure: ${choice.reason}`;
    } else if (mode === 'neutral') {
      reason = `${cpu.specId} specials unavailable`;
    }
  }

  setCpuDecisionTelemetry(state, {
    mode,
    reason,
    laneChoice,
    laneDelta,
    leftLane,
    rightLane,
  });
  return actions;
}

function chooseCpuSpecialCommand(
  state: BattleState,
  cpu: FighterState,
  absDx: number,
  dy: number,
): { command: InputCommand; reason: string } | null {
  const candidates = rankedCpuSpecialChoices(state, cpu, absDx, dy);
  for (const candidate of candidates) {
    if (!canActivateCpuCommand(cpu, candidate.command)) continue;
    return candidate;
  }
  return null;
}

function rankedCpuSpecialChoices(
  state: BattleState,
  cpu: FighterState,
  absDx: number,
  dy: number,
): Array<{ command: InputCommand; reason: string }> {
  const choices: Array<{ command: InputCommand; reason: string }> = [];
  const pushChoice = (command: InputCommand, reason: string): void => {
    if (choices.some((choice) => choice.command === command)) return;
    choices.push({ command, reason });
  };

  switch (cpu.specId) {
    case 'water': {
      if (dy < -30) pushChoice('special-up', 'water anti-air steam lift');
      if (dy > 28 && absDx < 150) pushChoice('special-down', 'water low trap ice snare');
      if (absDx > 155) pushChoice('special-neutral', 'water long-range lash');
      pushChoice('special-neutral', 'water mid-range pressure');
      pushChoice('special-down', 'water fallback ice snare');
      pushChoice('special-side', 'water fallback surf dash');
      break;
    }
    case 'earth': {
      if (dy < -34) pushChoice('special3', 'earth anti-air wall rise');
      if (absDx < 96 && Math.abs(dy) < 68) pushChoice('special1', 'earth close punish stone fist');
      if (absDx > 170) pushChoice('special2', 'earth long-range sand wave');
      pushChoice('special2', 'earth lane pressure sand wave');
      pushChoice('special1', 'earth fallback stone fist');
      pushChoice('special3', 'earth fallback wall rise');
      break;
    }
    case 'fire': {
      if (dy > 24 && absDx < 150) pushChoice('special3', 'fire low lava pressure');
      if (absDx < 108 && cpu.onGround) pushChoice('special2', 'fire burst dash punish');
      if (absDx > 160) pushChoice('special1', 'fire ranged flame shot');
      const tieBreak = randomInt(state.rngSeed, 2);
      state.rngSeed = tieBreak.seed;
      if (tieBreak.value === 0) {
        pushChoice('special1', 'fire mixed flame shot');
        pushChoice('special2', 'fire fallback blast dash');
      } else {
        pushChoice('special2', 'fire mixed blast dash');
        pushChoice('special1', 'fire fallback flame shot');
      }
      pushChoice('special3', 'fire fallback lava break');
      break;
    }
  }
  return choices;
}

function canActivateCpuCommand(fighter: FighterState, command: InputCommand): boolean {
  const move = moveForCommand(fighter.specId, command);
  const cost = fighter.boosted ? move.boostedMeterCost : move.meterCost;
  if (fighter.meter < cost) return false;
  return (fighter.moveCooldowns[move.id] ?? 0) <= 0;
}

function fighterRect(fighter: FighterState): Rect {
  return {
    x: fighter.x - fighter.width / 2,
    y: fighter.y - fighter.height / 2,
    width: fighter.width,
    height: fighter.height,
  };
}

function expandRect(rect: Rect, amount: number): Rect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

function setCpuDecisionTelemetry(
  state: BattleState,
  decision: Omit<CpuDecisionTelemetry, 'tick'>,
): void {
  state.runtimeStats.lastCpuDecision = { tick: state.tick, ...decision };
}

function setShieldAction(actions: ActionState): void {
  actions.shield = true;
  actions.block = true;
}

function applyCpuSpecialAction(actions: ActionState, command: InputCommand): void {
  if (command === 'special1') {
    actions.special1 = true;
    return;
  }
  if (command === 'special2') {
    actions.special2 = true;
    return;
  }
  if (command === 'special3') {
    actions.special3 = true;
    return;
  }

  actions.special = true;
  if (command === 'special-up') actions.up = true;
  if (command === 'special-down') actions.down = true;
  if (command === 'special-side') actions.left = true;
}

function recordCombatImpact(state: BattleState, impact: CombatImpact): void {
  const previous = state.runtimeStats.lastCombatImpact;
  if (
    previous?.tick === impact.tick &&
    previous.impactKind !== 'hazard' &&
    impact.impactKind === 'hazard'
  ) {
    return;
  }
  state.runtimeStats.combatImpactSeq++;
  state.runtimeStats.lastCombatImpact = impact;
}

function scoreCpuBoostLane(
  state: BattleState,
  fighter: FighterState,
  direction: -1 | 1,
  matching: Set<MaterialType>,
): CpuLaneTelemetry {
  const centerX = worldToCell(fighter.x + direction * 72);
  const centerY = worldToCell(fighter.y);
  const lane: CpuLaneTelemetry = {
    score: 0,
    boostCells: 0,
    fireCells: 0,
    lavaCells: 0,
    tempStoneCells: 0,
    quenchRiskCells: 0,
  };
  for (let cy = centerY - 4; cy <= centerY + 4; cy++) {
    for (let cx = centerX - 6; cx <= centerX + 6; cx++) {
      const cell = getCell(state.materialGrid, cx, cy);
      if (matching.has(cell.material)) {
        lane.boostCells++;
        lane.score += CPU_BOOST_MATCH_WEIGHT;
      }
      if (cy < centerY - 2 || cy > centerY + 3) continue;
      if (cell.material === MaterialType.Fire) {
        lane.fireCells++;
        lane.score -= CPU_LANE_FIRE_PENALTY;
      }
      if (cell.material === MaterialType.Lava) {
        lane.lavaCells++;
        lane.score -= CPU_LANE_LAVA_PENALTY;
      }
      if (cell.material === MaterialType.Stone && cell.expiresAtTick !== null) {
        lane.tempStoneCells++;
        lane.score -= CPU_LANE_TEMP_STONE_PENALTY;
      }
      if (
        cell.material === MaterialType.Water &&
        cell.expiresAtTick !== null &&
        hasAdjacentTemporaryMaterial(state, cx, cy, MaterialType.Lava)
      ) {
        lane.quenchRiskCells++;
        lane.score -= CPU_LANE_WATER_LAVA_QUENCH_PENALTY;
      }
    }
  }
  return lane;
}

function hasAdjacentTemporaryMaterial(
  state: BattleState,
  x: number,
  y: number,
  target: MaterialType,
): boolean {
  for (const offset of REACTION_OFFSETS) {
    const nx = x + offset.dx;
    const ny = y + offset.dy;
    if (!inGrid(nx, ny)) continue;
    const neighbor = getCell(state.materialGrid, nx, ny);
    if (neighbor.material === target && neighbor.expiresAtTick !== null) return true;
  }
  return false;
}

function otherFighter(id: FighterId): FighterId {
  return id === 'p1' ? 'cpu' : 'p1';
}

function pushEvent(state: BattleState, type: string, message: string): void {
  state.eventLog.push({ tick: state.tick, type, message });
  if (state.eventLog.length > 180) state.eventLog.shift();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function denyMove(
  state: BattleState,
  reason: MoveDenialReason,
  moveId: string,
  cost: number,
  boosted: boolean,
): MoveActivationResult {
  noteMoveDenial(state, reason, moveId, cost, boosted);
  return { ok: false, moveId, boosted, cost, deniedReason: reason };
}

function createMatchId(seed: number): string {
  return `match-${Date.now().toString(36)}-${(seed >>> 0).toString(36)}`;
}

export function materialCellWorldRect(cellX: number, cellY: number): Rect {
  return {
    x: cellToWorld(cellX),
    y: cellToWorld(cellY),
    width: CELL_SIZE,
    height: CELL_SIZE,
  };
}
