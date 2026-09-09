import { FIGHTER_SPECS } from './simulation/fighters';
import { animationForMoveId } from './simulation/moves';
import type { FighterSpecId, FighterState, InputCommand } from './simulation/types';

export const FIGHTER_SPRITE_FRAME_WIDTH = 96;
export const FIGHTER_SPRITE_FRAME_HEIGHT = 96;

export const FIGHTER_SPRITE_ANIMATIONS = {
  idle: { frames: 6, frameRate: 2, repeat: -1 },
  run: { frames: 8, frameRate: 14, repeat: -1 },
  jump: { frames: 4, frameRate: 10, repeat: 0 },
  block: { frames: 4, frameRate: 10, repeat: -1 },
  shield: { frames: 4, frameRate: 10, repeat: -1 },
  hurt: { frames: 4, frameRate: 12, repeat: 0 },
  basic: { frames: 6, frameRate: 16, repeat: 0 },
  special1: { frames: 8, frameRate: 14, repeat: 0 },
  special2: { frames: 8, frameRate: 14, repeat: 0 },
  special3: { frames: 8, frameRate: 14, repeat: 0 },
  fall: { frames: 4, frameRate: 10, repeat: 0 },
  grab: { frames: 6, frameRate: 13, repeat: 0 },
  'attack-neutral': { frames: 6, frameRate: 16, repeat: 0 },
  'attack-side': { frames: 6, frameRate: 15, repeat: 0 },
  'attack-up': { frames: 6, frameRate: 15, repeat: 0 },
  'attack-down': { frames: 6, frameRate: 15, repeat: 0 },
  'air-neutral': { frames: 6, frameRate: 15, repeat: 0 },
  'air-forward': { frames: 6, frameRate: 15, repeat: 0 },
  'air-back': { frames: 6, frameRate: 15, repeat: 0 },
  'air-up': { frames: 6, frameRate: 15, repeat: 0 },
  'air-down': { frames: 6, frameRate: 15, repeat: 0 },
  'special-neutral': { frames: 8, frameRate: 14, repeat: 0 },
  'special-side': { frames: 8, frameRate: 14, repeat: 0 },
  'special-up': { frames: 8, frameRate: 14, repeat: 0 },
  'special-down': { frames: 8, frameRate: 14, repeat: 0 },
  ko: { frames: 6, frameRate: 8, repeat: 0 },
} as const;

export type FighterSpriteAnimationId = keyof typeof FIGHTER_SPRITE_ANIMATIONS;

export const FIGHTER_SPRITE_ANIMATION_IDS = Object.keys(FIGHTER_SPRITE_ANIMATIONS) as FighterSpriteAnimationId[];
export const LEGACY_FIGHTER_SPRITE_ANIMATION_IDS: FighterSpriteAnimationId[] = [
  'idle',
  'run',
  'jump',
  'block',
  'hurt',
  'basic',
  'special1',
  'special2',
  'special3',
  'ko',
];
export const WATER_FIGHTER_SPRITE_ANIMATION_IDS: FighterSpriteAnimationId[] = [
  'idle',
  'run',
  'jump',
  'fall',
  'shield',
  'hurt',
  'grab',
  'attack-neutral',
  'attack-side',
  'attack-up',
  'attack-down',
  'air-neutral',
  'air-forward',
  'air-back',
  'air-up',
  'air-down',
  'special-neutral',
  'special-side',
  'special-up',
  'special-down',
  'ko',
  ...LEGACY_FIGHTER_SPRITE_ANIMATION_IDS,
];

export interface FighterAnimationDecision {
  animation: FighterSpriteAnimationId;
  candidate: FighterSpriteAnimationId;
  candidateTicks: number;
}

const IMMEDIATE_ANIMATIONS = new Set<FighterSpriteAnimationId>([
  'block',
  'shield',
  'hurt',
  'basic',
  'special1',
  'special2',
  'special3',
  'grab',
  'attack-neutral',
  'attack-side',
  'attack-up',
  'attack-down',
  'air-neutral',
  'air-forward',
  'air-back',
  'air-up',
  'air-down',
  'special-neutral',
  'special-side',
  'special-up',
  'special-down',
  'ko',
]);

export function createFighterAnimationDecision(animation: FighterSpriteAnimationId = 'idle'): FighterAnimationDecision {
  return { animation, candidate: animation, candidateTicks: 0 };
}

export function stabilizeFighterAnimation(
  requested: FighterSpriteAnimationId,
  previous: FighterAnimationDecision,
  requiredStableTicks = 4,
): FighterAnimationDecision {
  if (requested === previous.animation) {
    return createFighterAnimationDecision(requested);
  }
  if (IMMEDIATE_ANIMATIONS.has(requested) || IMMEDIATE_ANIMATIONS.has(previous.animation)) {
    return createFighterAnimationDecision(requested);
  }

  const candidateTicks = previous.candidate === requested ? previous.candidateTicks + 1 : 1;
  if (candidateTicks >= requiredStableTicks) {
    return createFighterAnimationDecision(requested);
  }

  return {
    animation: previous.animation,
    candidate: requested,
    candidateTicks,
  };
}

export function fighterSpriteSheetKey(specId: FighterSpecId, animation: FighterSpriteAnimationId): string {
  return `fighter-${specId}-${animation}`;
}

export function fighterAnimationKey(specId: FighterSpecId, animation: FighterSpriteAnimationId): string {
  return `${fighterSpriteSheetKey(specId, animation)}-anim`;
}

export function fighterSpriteSheetUrl(specId: FighterSpecId, animation: FighterSpriteAnimationId): string {
  return `/assets/sprites/fighters/${specId}/${animation}.png`;
}

export function fighterSpriteAnimationIdsForSpec(specId: FighterSpecId): FighterSpriteAnimationId[] {
  return Array.from(new Set(specId === 'water' ? WATER_FIGHTER_SPRITE_ANIMATION_IDS : LEGACY_FIGHTER_SPRITE_ANIMATION_IDS));
}

export function resolveFighterSpriteAnimation(
  specId: FighterSpecId,
  animation: FighterSpriteAnimationId,
): FighterSpriteAnimationId {
  const available = fighterSpriteAnimationIdsForSpec(specId);
  if (available.includes(animation)) return animation;
  if (animation === 'shield') return 'block';
  if (animation === 'fall') return 'jump';
  if (animation === 'grab') return 'basic';
  if (animation.startsWith('attack-') || animation.startsWith('air-')) return 'basic';
  if (animation === 'special-neutral') return 'special1';
  if (animation === 'special-side') return 'special2';
  if (animation === 'special-up' || animation === 'special-down') return 'special3';
  return 'idle';
}

export function selectFighterAnimation(fighter: FighterState): FighterSpriteAnimationId {
  if (fighter.health <= 0 || fighter.stocks <= 0) return 'ko';
  if (fighter.hitstunTicks > 0) return 'hurt';
  if (fighter.blockTicks > 0 || fighter.shieldStunTicks > 0) return fighter.specId === 'water' ? 'shield' : 'block';
  if (fighter.activeMove) return animationForMove(fighter);
  if (!fighter.onGround) return fighter.specId === 'water' && fighter.vy > 1 ? 'fall' : 'jump';
  if (Math.abs(fighter.vx) > 0.4) return 'run';
  return 'idle';
}

function animationForMove(fighter: FighterState): FighterSpriteAnimationId {
  const move = FIGHTER_SPECS[fighter.specId].moves.find((candidate) => candidate.id === fighter.activeMove?.moveId);
  if (!move) return 'basic';
  const animation = animationForMoveId(fighter.specId, move.id);
  if (isFighterSpriteAnimationId(animation)) return resolveFighterSpriteAnimation(fighter.specId, animation);
  const command = move.command as InputCommand;
  if (command === 'basic') return 'basic';
  if (command === 'special1' || command === 'special2' || command === 'special3') return command;
  return 'basic';
}

function isFighterSpriteAnimationId(value: string): value is FighterSpriteAnimationId {
  return value in FIGHTER_SPRITE_ANIMATIONS;
}
