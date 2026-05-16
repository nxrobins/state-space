import {
  ARENA_WIDTH,
  BOOST_REQUIRED_CELLS,
  CELL_SIZE,
  GRID_WIDTH,
  MATCH_TICKS,
  MAX_HEALTH,
  MAX_METER,
  MaterialType,
  REPLAY_SCHEMA_VERSION,
  RESPAWN_INVULN_TICKS,
  STARTING_STOCKS,
} from './constants';
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
import { commandFromActions, moveForCommand } from './moves';
import { randomInt } from './rng';
import type {
  ActionState,
  ActiveHitbox,
  BattleState,
  CpuDecisionTelemetry,
  CpuLaneTelemetry,
  FighterId,
  FighterSpec,
  FighterSpecId,
  FighterState,
  InputCommand,
  MatchEndReason,
  MatchResult,
  MoveActivationResult,
  MoveDenialReason,
  MoveSpec,
  Rect,
} from './types';

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
  basic: false,
  special1: false,
  special2: false,
  special3: false,
};

export function createBattleState(
  playerSpecId: FighterSpecId = 'water',
  seed = 0xc0ffee,
  options: { matchId?: string } = {},
): BattleState {
  const cpuSpecId = cpuOpponentFor(playerSpecId);
  const state: BattleState = {
    matchId: options.matchId ?? createMatchId(seed),
    schemaVersion: REPLAY_SCHEMA_VERSION,
    tick: 0,
    timerTicks: MATCH_TICKS,
    initialSeed: seed >>> 0,
    rngSeed: seed >>> 0,
    materialGrid: buildArenaGrid(),
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
  resolveMaterialReactions(state);
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
): MoveActivationResult {
  const move = moveForCommand(fighter.specId, command);
  const boosted = command !== 'basic' && fighter.boosted;
  const cost = boosted ? move.boostedMeterCost : move.meterCost;

  if (state.matchPhase === 'finished') return denyMove(state, 'finished', move.id, cost, boosted);
  if (fighter.activeMove) return denyMove(state, 'active-move', move.id, cost, boosted);
  if (fighter.hitstunTicks > 0) return denyMove(state, 'hitstun', move.id, cost, boosted);

  if ((fighter.moveCooldowns[move.id] ?? 0) > 0) return denyMove(state, 'cooldown', move.id, cost, boosted);

  const isSpecial = command !== 'basic';
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
  };
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
): boolean {
  if (state.matchPhase === 'finished' || target.invulnTicks > 0 || amount <= 0) return false;

  const sourceFighter = sourceOwnerId && sourceOwnerId !== target.id ? state.fighters[sourceOwnerId] : null;
  const environmentalDamage = sourceFighter === null;
  const blocked = target.blockTicks > 0 && target.hitstunTicks === 0;
  let finalDamage = blocked ? amount * 0.25 : amount;
  let finalKnockbackX = blocked ? knockbackX * 0.45 : knockbackX;
  let finalKnockbackY = blocked ? knockbackY * 0.45 : knockbackY;

  if (sourceFighter?.specId === 'fire' && (sourceFighter.boosted || sourceFighter.activeMove?.boosted)) {
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

  target.health = clamp(target.health - finalDamage, 0, MAX_HEALTH);
  target.vx += finalKnockbackX;
  target.vy = Math.min(target.vy, finalKnockbackY);
  const baseHitstun = blocked ? 8 : 18;
  const finalHitstun = target.specId === 'earth' ? Math.max(4, baseHitstun - EARTH_HITSTUN_REDUCTION) : baseHitstun;
  target.hitstunTicks = Math.max(target.hitstunTicks, finalHitstun);
  target.lastDamageTakenTick = state.tick;

  if (sourceOwnerId && sourceOwnerId !== target.id) {
    const attacker = state.fighters[sourceOwnerId];
    attacker.meter = clamp(attacker.meter + finalDamage * 0.7, 0, MAX_METER);
    state.runtimeStats.combatImpactSeq++;
    state.runtimeStats.lastCombatImpact = {
      tick: state.tick,
      sourceId: sourceOwnerId,
      targetId: target.id,
      damage: finalDamage,
      blocked,
    };
  }
  target.meter = clamp(target.meter + finalDamage * 0.25, 0, MAX_METER);

  pushEvent(state, 'damage', `${target.id} took ${finalDamage.toFixed(1)} damage`);

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
  if (actions.block && !fighter.activeMove && fighter.hitstunTicks === 0) {
    fighter.blockTicks = 3;
  }

  const command = commandFromActions({
    basic: actions.basic,
    special1: actions.special1,
    special2: actions.special2,
    special3: actions.special3,
  });
  if (command) {
    tryStartMove(state, fighter, command);
  }
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
  const hitbox = buildHitbox(fighter, move, boosted);
  state.activeHitboxes.push({
    id: state.nextHitboxId++,
    ownerId: fighter.id,
    moveId: move.id,
    rect: hitbox,
    damage: move.damage,
    knockbackX: move.knockbackX * fighter.facing * boostedKnockbackMultiplier(move, boosted),
    knockbackY: move.knockbackY * boostedKnockbackMultiplier(move, boosted),
    expiresAtTick: state.tick + move.activeTicks,
    hitFighterIds: [],
  });

  if (move.selfImpulseX) fighter.vx += move.selfImpulseX * fighter.facing;
  if (move.selfImpulseY) fighter.vy += move.selfImpulseY;

  const baseCellX = worldToCell(fighter.x);
  const baseCellY = worldToCell(fighter.y);
  for (const spawn of move.materialSpawns) {
    const boostedWidth = boosted && move.boost.stat === 'size' ? spawn.widthCells + move.boost.amount : spawn.widthCells;
    const boostedLifetime = boosted && move.boost.stat === 'duration' ? spawn.lifetimeTicks + move.boost.amount : spawn.lifetimeTicks;
    const x = fighter.facing === 1
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

function buildHitbox(fighter: FighterState, move: MoveSpec, boosted: boolean): Rect {
  const extraWidth = boosted && move.boost.stat === 'size' ? move.boost.amount * CELL_SIZE : 0;
  const width = move.hitbox.width + extraWidth;
  const height = move.hitbox.height;
  const centerX = fighter.x + move.hitbox.offsetX * fighter.facing;
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

  if (fighter.hitstunTicks === 0) {
    applyMovementControls(fighter, spec, actions);
  }

  fighter.vy = clamp(fighter.vy + GRAVITY, -100, MAX_FALL_SPEED);
  if (actions.down && fighter.vy > 0) fighter.vy = Math.min(MAX_FALL_SPEED, fighter.vy + 0.8);

  resolveFighterCollision(state, fighter);
}

function applyMovementControls(fighter: FighterState, spec: FighterSpec, actions: ActionState): void {
  const speed = spec.moveSpeed * (fighter.slowTicks > 0 ? 0.55 : 1);
  let desired = 0;
  if (actions.left) {
    desired -= speed;
    fighter.facing = -1;
  }
  if (actions.right) {
    desired += speed;
    fighter.facing = 1;
  }

  if (fighter.activeMove) {
    desired *= 0.45;
  }

  if (actions.dash && (fighter.moveCooldowns.dash ?? 0) === 0 && !fighter.activeMove) {
    fighter.vx = spec.dashVelocity * fighter.facing;
    fighter.moveCooldowns.dash = 34;
  } else if (desired !== 0) {
    fighter.vx = desired;
  } else if (fighter.onGround) {
    fighter.vx *= FRICTION;
    if (Math.abs(fighter.vx) < 0.05) fighter.vx = 0;
  }

  if (actions.up && fighter.onGround && !fighter.activeMove) {
    fighter.vy = spec.jumpVelocity;
    fighter.onGround = false;
  }

  if (fighter.blockTicks > 0) {
    fighter.vx *= 0.35;
  }
}

function resolveFighterCollision(state: BattleState, fighter: FighterState): void {
  const previousX = fighter.x;
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
    if (!rectsOverlap(hitbox.rect, fighterRect(target))) continue;
    const didHit = applyDamage(state, target, hitbox.damage, hitbox.knockbackX, hitbox.knockbackY, hitbox.ownerId);
    if (didHit) hitbox.hitFighterIds.push(targetId);
  }
}

function applyMaterialEffects(state: BattleState): void {
  for (const fighter of [state.fighters.p1, state.fighters.cpu]) {
    const materials = materialsInFighterRect(state.materialGrid, fighter);
    if (materials.has(MaterialType.Lava)) {
      applyDamage(state, fighter, 0.65, fighter.x < ARENA_WIDTH / 2 ? -0.18 : 0.18, -0.2, null);
    } else if (materials.has(MaterialType.Fire)) {
      applyDamage(state, fighter, 0.28, fighter.x < ARENA_WIDTH / 2 ? -0.12 : 0.12, -0.1, null);
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

function resolveMaterialReactions(state: BattleState): void {
  const toSteam = new Set<number>();
  const toStone = new Set<number>();
  const toWater = new Set<number>();

  for (let i = state.temporaryCellHead; i < state.temporaryCells.length; i++) {
    const ref = state.temporaryCells[i];
    const cell = state.materialGrid[ref.index];
    if (cell.expiresAtTick !== ref.expiresAtTick) continue;

    const x = ref.index % GRID_WIDTH;
    const y = Math.floor(ref.index / GRID_WIDTH);
    if (cell.material === MaterialType.Water) {
      for (const offset of REACTION_OFFSETS) {
        const nx = x + offset.dx;
        const ny = y + offset.dy;
        if (!inGrid(nx, ny)) continue;
        const neighborIndex = gridIndex(nx, ny);
        const neighbor = state.materialGrid[neighborIndex];
        if (neighbor.expiresAtTick === null) continue;
        if (neighbor.material === MaterialType.Fire) {
          toSteam.add(ref.index);
          toSteam.add(neighborIndex);
        } else if (neighbor.material === MaterialType.Lava) {
          toSteam.add(ref.index);
          toStone.add(neighborIndex);
        }
      }
    } else if (cell.material === MaterialType.Ice) {
      for (const offset of REACTION_OFFSETS) {
        const nx = x + offset.dx;
        const ny = y + offset.dy;
        if (!inGrid(nx, ny)) continue;
        const neighbor = state.materialGrid[gridIndex(nx, ny)];
        if (neighbor.expiresAtTick === null) continue;
        if (neighbor.material === MaterialType.Fire || neighbor.material === MaterialType.Lava) {
          toWater.add(ref.index);
          break;
        }
      }
    }
  }

  for (const index of toStone) {
    const cell = state.materialGrid[index];
    if (cell.expiresAtTick === null || cell.material !== MaterialType.Lava) continue;
    state.materialGrid[index] = { ...cell, material: MaterialType.Stone };
    state.dirtyMaterialIndices.add(index);
  }
  for (const index of toWater) {
    const cell = state.materialGrid[index];
    if (cell.expiresAtTick === null || cell.material !== MaterialType.Ice) continue;
    state.materialGrid[index] = { ...cell, material: MaterialType.Water };
    state.dirtyMaterialIndices.add(index);
  }
  for (const index of toSteam) {
    const cell = state.materialGrid[index];
    if (cell.expiresAtTick === null) continue;
    if (cell.material !== MaterialType.Fire && cell.material !== MaterialType.Water) continue;
    state.materialGrid[index] = { ...cell, material: MaterialType.Steam };
    state.dirtyMaterialIndices.add(index);
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
    actions.block = true;
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
    actions.block = true;
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
    if (cpu.blockedTicks > 120) actions.basic = true;
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
    actions.block = state.tick % 80 < 18;
    mode = 'space';
    reason = temperament.spacingReason;
  }

  if (absDx < temperament.basicRange && Math.abs(player.y - cpu.y) < temperament.basicVerticalRange) {
    actions.basic = true;
    mode = 'engage-basic';
    reason = `${cpu.specId} basic punish window`;
  } else if (absDx < temperament.specialRange) {
    const choice = chooseCpuSpecialCommand(state, cpu, absDx, dy);
    if (choice) {
      actions[choice.command] = true;
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
): { command: 'special1' | 'special2' | 'special3'; reason: string } | null {
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
): Array<{ command: 'special1' | 'special2' | 'special3'; reason: string }> {
  const choices: Array<{ command: 'special1' | 'special2' | 'special3'; reason: string }> = [];
  const pushChoice = (command: 'special1' | 'special2' | 'special3', reason: string): void => {
    if (choices.some((choice) => choice.command === command)) return;
    choices.push({ command, reason });
  };

  switch (cpu.specId) {
    case 'water': {
      if (dy < -30) pushChoice('special3', 'water anti-air steam burst');
      if (dy > 28 && absDx < 150) pushChoice('special2', 'water low trap ice snare');
      if (absDx > 155) pushChoice('special1', 'water long-range lash');
      pushChoice('special1', 'water mid-range pressure');
      pushChoice('special2', 'water fallback ice snare');
      pushChoice('special3', 'water fallback steam burst');
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

function canActivateCpuCommand(fighter: FighterState, command: 'special1' | 'special2' | 'special3'): boolean {
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
