import { MaterialType } from './constants';
import type { FighterSpecId, InputCommand, MoveDirection, MoveSpec } from './types';

const emptyBoost = { stat: 'knockback' as const, amount: 1 };

const sharedBasic = (fighter: FighterSpecId): MoveSpec => ({
  id: `${fighter}-basic`,
  name: 'Strike',
  command: 'basic',
  category: 'attack',
  direction: 'neutral',
  hitType: 'strike',
  animationId: 'basic',
  meterCost: 0,
  boostedMeterCost: 0,
  cooldownTicks: 18,
  startupTicks: 5,
  activeTicks: 6,
  recoveryTicks: 8,
  damage: 6,
  knockbackX: 5.5,
  knockbackY: -3,
  hitbox: { offsetX: 30, offsetY: -4, width: 42, height: 34 },
  materialSpawns: [],
  boost: emptyBoost,
});

const waterAttack = (
  id: string,
  name: string,
  command: InputCommand,
  animationId: string,
  hitbox: MoveSpec['hitbox'],
  damage: number,
  knockbackX: number,
  knockbackY: number,
  timings: { startup: number; active: number; recovery: number; cooldown: number },
  options: Partial<MoveSpec> = {},
): MoveSpec => ({
  id,
  name,
  command,
  category: command.startsWith('air-') ? 'attack' : 'attack',
  direction: directionForCommand(command),
  airborne: command.startsWith('air-'),
  hitType: 'strike',
  animationId,
  meterCost: 0,
  boostedMeterCost: 0,
  cooldownTicks: timings.cooldown,
  startupTicks: timings.startup,
  activeTicks: timings.active,
  recoveryTicks: timings.recovery,
  damage,
  knockbackX,
  knockbackY,
  hitbox,
  materialSpawns: [],
  boost: emptyBoost,
  ...options,
});

const waterSpecial = (
  id: string,
  name: string,
  command: InputCommand,
  animationId: string,
  hitbox: MoveSpec['hitbox'],
  damage: number,
  knockbackX: number,
  knockbackY: number,
  timings: { startup: number; active: number; recovery: number; cooldown: number },
  materialSpawns: MoveSpec['materialSpawns'],
  options: Partial<MoveSpec> = {},
): MoveSpec => ({
  id,
  name,
  command,
  category: 'special',
  direction: directionForCommand(command),
  hitType: 'strike',
  animationId,
  meterCost: 25,
  boostedMeterCost: 15,
  cooldownTicks: timings.cooldown,
  startupTicks: timings.startup,
  activeTicks: timings.active,
  recoveryTicks: timings.recovery,
  damage,
  knockbackX,
  knockbackY,
  hitbox,
  materialSpawns,
  boost: { stat: 'size', amount: 4 },
  ...options,
});

const waterGrab = (
  id: string,
  name: string,
  command: InputCommand,
  animationId: string,
  knockbackX: number,
  knockbackY: number,
): MoveSpec => ({
  id,
  name,
  command,
  category: 'grab',
  direction: directionForCommand(command),
  hitType: 'grab',
  animationId,
  meterCost: 0,
  boostedMeterCost: 0,
  cooldownTicks: 34,
  startupTicks: 6,
  activeTicks: 4,
  recoveryTicks: 18,
  damage: 4,
  knockbackX,
  knockbackY,
  hitbox: { offsetX: 24, offsetY: -2, width: 38, height: 44 },
  materialSpawns: [],
  boost: emptyBoost,
});

const waterMoves: MoveSpec[] = [
  waterAttack(
    'water-attack-neutral',
    'Flow Palm',
    'attack-neutral',
    'attack-neutral',
    { offsetX: 29, offsetY: -4, width: 46, height: 34 },
    5,
    4.8,
    -2.4,
    { startup: 4, active: 5, recovery: 7, cooldown: 13 },
  ),
  waterAttack(
    'water-attack-side',
    'Wave Step',
    'attack-side',
    'attack-side',
    { offsetX: 42, offsetY: -5, width: 66, height: 34 },
    7,
    7.2,
    -2.8,
    { startup: 7, active: 6, recovery: 12, cooldown: 22 },
  ),
  waterAttack(
    'water-attack-up',
    'Rising Current',
    'attack-up',
    'attack-up',
    { offsetX: 9, offsetY: -38, width: 46, height: 72 },
    7,
    2.8,
    -8.6,
    { startup: 7, active: 7, recovery: 14, cooldown: 24 },
  ),
  waterAttack(
    'water-attack-down',
    'Low Tide Sweep',
    'attack-down',
    'attack-down',
    { offsetX: 34, offsetY: 28, width: 70, height: 22 },
    6,
    5.8,
    -1.8,
    { startup: 6, active: 6, recovery: 13, cooldown: 23 },
    {
      materialSpawns: [
        { offsetCellsX: 2, offsetCellsY: 4, widthCells: 6, heightCells: 1, material: MaterialType.Ice, lifetimeTicks: 100 },
      ],
      boost: { stat: 'duration', amount: 45 },
    },
  ),
  waterAttack(
    'water-air-neutral',
    'Mist Wheel',
    'air-neutral',
    'air-neutral',
    { offsetX: 2, offsetY: -10, width: 66, height: 58 },
    6,
    4.6,
    -3.4,
    { startup: 5, active: 8, recovery: 14, cooldown: 26 },
    { landingLagTicks: 9 },
  ),
  waterAttack(
    'water-air-forward',
    'Wave Chop',
    'air-forward',
    'air-forward',
    { offsetX: 42, offsetY: -8, width: 62, height: 38 },
    8,
    8.3,
    -3.5,
    { startup: 8, active: 5, recovery: 18, cooldown: 32 },
    { landingLagTicks: 11 },
  ),
  waterAttack(
    'water-air-back',
    'Backwash Heel',
    'air-back',
    'air-back',
    { offsetX: -36, offsetY: -8, width: 58, height: 36 },
    9,
    -8.8,
    -3.2,
    { startup: 7, active: 5, recovery: 17, cooldown: 32 },
    { landingLagTicks: 11 },
  ),
  waterAttack(
    'water-air-up',
    'Spray Upper',
    'air-up',
    'air-up',
    { offsetX: 4, offsetY: -44, width: 48, height: 62 },
    7,
    2.6,
    -8.8,
    { startup: 6, active: 6, recovery: 16, cooldown: 29 },
    { landingLagTicks: 9 },
  ),
  waterAttack(
    'water-air-down',
    'Drop Torrent',
    'air-down',
    'air-down',
    { offsetX: 8, offsetY: 34, width: 48, height: 58 },
    8,
    2.5,
    6.4,
    { startup: 9, active: 6, recovery: 20, cooldown: 34 },
    { landingLagTicks: 14 },
  ),
  waterSpecial(
    'water-lash',
    'Water Lash',
    'special-neutral',
    'special-neutral',
    { offsetX: 58, offsetY: -8, width: 92, height: 30 },
    9,
    8,
    -4,
    { startup: 9, active: 10, recovery: 14, cooldown: 42 },
    [
      { offsetCellsX: 3, offsetCellsY: -4, widthCells: 12, heightCells: 3, material: MaterialType.Water, lifetimeTicks: 180 },
    ],
    { boost: { stat: 'size', amount: 4 } },
  ),
  waterSpecial(
    'water-surf-dash',
    'Surf Dash',
    'special-side',
    'special-side',
    { offsetX: 38, offsetY: -2, width: 64, height: 40 },
    7,
    8.6,
    -2.2,
    { startup: 6, active: 9, recovery: 16, cooldown: 48 },
    [
      { offsetCellsX: -3, offsetCellsY: 3, widthCells: 7, heightCells: 1, material: MaterialType.Water, lifetimeTicks: 120 },
    ],
    { selfImpulseX: 6.6, boost: { stat: 'knockback', amount: 1.22 } },
  ),
  waterSpecial(
    'water-steam-lift',
    'Steam Lift',
    'special-up',
    'special-up',
    { offsetX: 20, offsetY: -36, width: 58, height: 82 },
    6,
    3.2,
    -9.4,
    { startup: 5, active: 10, recovery: 22, cooldown: 58 },
    [
      { offsetCellsX: -2, offsetCellsY: -8, widthCells: 6, heightCells: 8, material: MaterialType.Steam, lifetimeTicks: 120 },
    ],
    {
      meterCost: 0,
      boostedMeterCost: 0,
      oncePerAirtime: true,
      selfImpulseY: -12.8,
      landingLagTicks: 16,
      boost: { stat: 'duration', amount: 45 },
    },
  ),
  waterSpecial(
    'water-ice-snare',
    'Ice Snare',
    'special-down',
    'special-down',
    { offsetX: 44, offsetY: 30, width: 82, height: 24 },
    5,
    3,
    -7,
    { startup: 12, active: 12, recovery: 18, cooldown: 58 },
    [
      { offsetCellsX: 2, offsetCellsY: 4, widthCells: 10, heightCells: 2, material: MaterialType.Ice, lifetimeTicks: 210 },
    ],
    { boost: { stat: 'duration', amount: 90 } },
  ),
  waterGrab('water-grab-neutral', 'Current Hold', 'grab-neutral', 'grab', 5.6, -3.2),
  waterGrab('water-grab-forward', 'Forward Throw', 'grab-forward', 'grab', 7.2, -4.2),
  waterGrab('water-grab-back', 'Back Throw', 'grab-back', 'grab', -7.2, -4.2),
  waterGrab('water-grab-up', 'Up Throw', 'grab-up', 'grab', 1.2, -8.8),
  waterGrab('water-grab-down', 'Down Throw', 'grab-down', 'grab', 3.2, 5.4),
];

export const FIGHTER_MOVES: Record<FighterSpecId, MoveSpec[]> = {
  water: waterMoves,
  earth: [
    sharedBasic('earth'),
    {
      id: 'earth-stone-fist',
      name: 'Stone Fist',
      command: 'special1',
      category: 'special',
      direction: 'neutral',
      hitType: 'strike',
      animationId: 'special1',
      meterCost: 25,
      boostedMeterCost: 15,
      cooldownTicks: 48,
      startupTicks: 11,
      activeTicks: 8,
      recoveryTicks: 18,
      damage: 13,
      knockbackX: 10,
      knockbackY: -5,
      hitbox: { offsetX: 46, offsetY: -6, width: 62, height: 44 },
      materialSpawns: [
        { offsetCellsX: 4, offsetCellsY: -4, widthCells: 4, heightCells: 5, material: MaterialType.Stone, lifetimeTicks: 150 },
      ],
      boost: { stat: 'knockback', amount: 1.3 },
    },
    {
      id: 'earth-sand-wave',
      name: 'Sand Wave',
      command: 'special2',
      category: 'special',
      direction: 'down',
      hitType: 'strike',
      animationId: 'special2',
      meterCost: 25,
      boostedMeterCost: 15,
      cooldownTicks: 46,
      startupTicks: 10,
      activeTicks: 12,
      recoveryTicks: 14,
      damage: 8,
      knockbackX: 9,
      knockbackY: -3,
      hitbox: { offsetX: 66, offsetY: 28, width: 108, height: 28 },
      materialSpawns: [
        { offsetCellsX: 3, offsetCellsY: 4, widthCells: 14, heightCells: 2, material: MaterialType.Sand, lifetimeTicks: 180 },
      ],
      boost: { stat: 'size', amount: 5 },
    },
    {
      id: 'earth-wall-rise',
      name: 'Wall Rise',
      command: 'special3',
      category: 'special',
      direction: 'up',
      hitType: 'strike',
      animationId: 'special3',
      meterCost: 25,
      boostedMeterCost: 15,
      cooldownTicks: 70,
      startupTicks: 14,
      activeTicks: 8,
      recoveryTicks: 20,
      damage: 6,
      knockbackX: 4,
      knockbackY: -8,
      hitbox: { offsetX: 38, offsetY: -26, width: 34, height: 90 },
      materialSpawns: [
        { offsetCellsX: 4, offsetCellsY: -9, widthCells: 3, heightCells: 10, material: MaterialType.Stone, lifetimeTicks: 240 },
      ],
      boost: { stat: 'duration', amount: 120 },
    },
  ],
  fire: [
    sharedBasic('fire'),
    {
      id: 'fire-flame-shot',
      name: 'Flame Shot',
      command: 'special1',
      category: 'special',
      direction: 'neutral',
      hitType: 'strike',
      animationId: 'special1',
      meterCost: 25,
      boostedMeterCost: 15,
      cooldownTicks: 38,
      startupTicks: 7,
      activeTicks: 9,
      recoveryTicks: 13,
      damage: 10,
      knockbackX: 8,
      knockbackY: -3,
      hitbox: { offsetX: 62, offsetY: -10, width: 96, height: 30 },
      materialSpawns: [
        { offsetCellsX: 3, offsetCellsY: -4, widthCells: 12, heightCells: 3, material: MaterialType.Fire, lifetimeTicks: 110 },
      ],
      boost: { stat: 'size', amount: 4 },
    },
    {
      id: 'fire-blast-dash',
      name: 'Blast Dash',
      command: 'special2',
      category: 'special',
      direction: 'side',
      hitType: 'strike',
      animationId: 'special2',
      meterCost: 25,
      boostedMeterCost: 15,
      cooldownTicks: 54,
      startupTicks: 5,
      activeTicks: 10,
      recoveryTicks: 18,
      damage: 8,
      knockbackX: 9,
      knockbackY: -4,
      hitbox: { offsetX: 36, offsetY: -2, width: 62, height: 42 },
      materialSpawns: [
        { offsetCellsX: -2, offsetCellsY: 2, widthCells: 6, heightCells: 2, material: MaterialType.Fire, lifetimeTicks: 90 },
        { offsetCellsX: -4, offsetCellsY: 0, widthCells: 4, heightCells: 3, material: MaterialType.Smoke, lifetimeTicks: 120 },
      ],
      boost: { stat: 'knockback', amount: 1.25 },
      selfImpulseX: 7,
      selfImpulseY: -1,
    },
    {
      id: 'fire-lava-break',
      name: 'Lava Break',
      command: 'special3',
      category: 'special',
      direction: 'down',
      hitType: 'strike',
      animationId: 'special3',
      meterCost: 25,
      boostedMeterCost: 15,
      cooldownTicks: 68,
      startupTicks: 16,
      activeTicks: 12,
      recoveryTicks: 20,
      damage: 12,
      knockbackX: 7,
      knockbackY: -8,
      hitbox: { offsetX: 48, offsetY: 26, width: 82, height: 30 },
      materialSpawns: [
        { offsetCellsX: 3, offsetCellsY: 4, widthCells: 10, heightCells: 2, material: MaterialType.Lava, lifetimeTicks: 150 },
      ],
      boost: { stat: 'duration', amount: 80 },
    },
  ],
};

export function moveForCommand(specId: FighterSpecId, command: InputCommand): MoveSpec {
  const move = FIGHTER_MOVES[specId].find((candidate) => candidate.command === command);
  if (move) return move;

  const legacyCommand = legacyCommandFor(specId, command);
  const legacyMove = FIGHTER_MOVES[specId].find((candidate) => candidate.command === legacyCommand);
  if (legacyMove) return legacyMove;
  throw new Error(`Missing move ${specId}:${command}`);
}

export function commandFromActions(actions: Partial<Record<InputCommand, boolean>>): InputCommand | null {
  if (actions['attack-neutral'] || actions.basic) return 'basic';
  if (actions['special-neutral'] || actions.special1) return 'special1';
  if (actions['special-down'] || actions.special2) return 'special2';
  if (actions['special-up'] || actions.special3) return 'special3';
  return null;
}

export function animationForMoveId(specId: FighterSpecId, moveId: string): string {
  const move = FIGHTER_MOVES[specId].find((candidate) => candidate.id === moveId);
  return move?.animationId ?? legacyAnimationForMoveId(moveId);
}

function legacyCommandFor(specId: FighterSpecId, command: InputCommand): InputCommand {
  if (specId === 'water') {
    if (command === 'basic') return 'attack-neutral';
    if (command === 'special1') return 'special-neutral';
    if (command === 'special2') return 'special-down';
    if (command === 'special3') return 'special-up';
  }
  if (command === 'attack-neutral' || command === 'attack-side' || command === 'attack-up' || command === 'attack-down') return 'basic';
  if (command.startsWith('air-')) return 'basic';
  if (command === 'special-up') return 'special3';
  if (command === 'special-down') return specId === 'earth' ? 'special2' : 'special3';
  if (command === 'special-side') return specId === 'fire' ? 'special2' : 'special1';
  if (command === 'special-neutral') return 'special1';
  if (command.startsWith('grab-')) return 'basic';
  return command;
}

function directionForCommand(command: InputCommand): MoveDirection {
  if (command.includes('up')) return 'up';
  if (command.includes('down')) return 'down';
  if (command.includes('forward')) return 'forward';
  if (command.includes('back')) return 'back';
  if (command.includes('side')) return 'side';
  return 'neutral';
}

function legacyAnimationForMoveId(moveId: string): string {
  if (moveId.endsWith('-basic')) return 'basic';
  if (moveId.includes('ice-snare') || moveId.includes('sand-wave') || moveId.includes('blast-dash')) return 'special2';
  if (moveId.includes('steam') || moveId.includes('wall-rise') || moveId.includes('lava-break')) return 'special3';
  return 'special1';
}
