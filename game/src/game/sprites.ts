import { FIGHTER_SPECS } from './simulation/fighters';
import type { FighterSpecId, FighterState, InputCommand } from './simulation/types';

export const FIGHTER_SPRITE_FRAME_WIDTH = 96;
export const FIGHTER_SPRITE_FRAME_HEIGHT = 96;

export const FIGHTER_SPRITE_ANIMATIONS = {
  idle: { frames: 6, frameRate: 8, repeat: -1 },
  run: { frames: 8, frameRate: 14, repeat: -1 },
  jump: { frames: 4, frameRate: 10, repeat: 0 },
  block: { frames: 4, frameRate: 10, repeat: -1 },
  hurt: { frames: 4, frameRate: 12, repeat: 0 },
  basic: { frames: 6, frameRate: 16, repeat: 0 },
  special1: { frames: 8, frameRate: 14, repeat: 0 },
  special2: { frames: 8, frameRate: 14, repeat: 0 },
  special3: { frames: 8, frameRate: 14, repeat: 0 },
  ko: { frames: 6, frameRate: 8, repeat: 0 },
} as const;

export type FighterSpriteAnimationId = keyof typeof FIGHTER_SPRITE_ANIMATIONS;

export const FIGHTER_SPRITE_ANIMATION_IDS = Object.keys(FIGHTER_SPRITE_ANIMATIONS) as FighterSpriteAnimationId[];

export function fighterSpriteSheetKey(specId: FighterSpecId, animation: FighterSpriteAnimationId): string {
  return `fighter-${specId}-${animation}`;
}

export function fighterAnimationKey(specId: FighterSpecId, animation: FighterSpriteAnimationId): string {
  return `${fighterSpriteSheetKey(specId, animation)}-anim`;
}

export function fighterSpriteSheetUrl(specId: FighterSpecId, animation: FighterSpriteAnimationId): string {
  return `/assets/sprites/fighters/${specId}/${animation}.png`;
}

export function selectFighterAnimation(fighter: FighterState): FighterSpriteAnimationId {
  if (fighter.health <= 0 || fighter.stocks <= 0) return 'ko';
  if (fighter.hitstunTicks > 0) return 'hurt';
  if (fighter.blockTicks > 0) return 'block';
  if (fighter.activeMove) return animationForMove(fighter);
  if (!fighter.onGround) return 'jump';
  if (Math.abs(fighter.vx) > 0.4) return 'run';
  return 'idle';
}

function animationForMove(fighter: FighterState): FighterSpriteAnimationId {
  const move = FIGHTER_SPECS[fighter.specId].moves.find((candidate) => candidate.id === fighter.activeMove?.moveId);
  if (!move) return 'basic';
  const command = move.command as InputCommand;
  if (command === 'basic') return 'basic';
  return command;
}
