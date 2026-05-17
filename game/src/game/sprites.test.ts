import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIGHTER_SPECS } from './simulation/fighters';
import {
  FIGHTER_SPRITE_ANIMATION_IDS,
  FIGHTER_SPRITE_ANIMATIONS,
  FIGHTER_SPRITE_FRAME_HEIGHT,
  FIGHTER_SPRITE_FRAME_WIDTH,
  fighterAnimationKey,
  fighterSpriteSheetKey,
  fighterSpriteSheetUrl,
  selectFighterAnimation,
} from './sprites';
import type { FighterSpecId, FighterState } from './simulation/types';

const GAME_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function fighter(overrides: Partial<FighterState> = {}): FighterState {
  return {
    id: 'p1',
    specId: 'water',
    x: 0,
    y: 0,
    previousX: 0,
    previousY: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    width: 34,
    height: 58,
    health: 100,
    stocks: 3,
    meter: 0,
    onGround: true,
    blockedTicks: 0,
    invulnTicks: 0,
    hitstunTicks: 0,
    blockTicks: 0,
    slowTicks: 0,
    activeMove: null,
    moveCooldowns: {},
    boosted: false,
    lastDamageTakenTick: -1,
    ...overrides,
  };
}

describe('fighter sprite catalog', () => {
  it('builds stable Phaser sheet and animation keys', () => {
    expect(fighterSpriteSheetKey('fire', 'special3')).toBe('fighter-fire-special3');
    expect(fighterAnimationKey('earth', 'run')).toBe('fighter-earth-run-anim');
    expect(fighterSpriteSheetUrl('water', 'idle')).toBe('/assets/sprites/fighters/water/idle.png');
  });

  it('contains the core fighting animation set', () => {
    expect(FIGHTER_SPRITE_ANIMATION_IDS).toEqual([
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
    ]);
    expect(FIGHTER_SPRITE_ANIMATIONS.idle.frameRate).toBeLessThan(FIGHTER_SPRITE_ANIMATIONS.run.frameRate);
    expect(FIGHTER_SPRITE_ANIMATIONS.idle.frameRate).toBeLessThanOrEqual(3);
  });

  it('has generated PNG sheets for every fighter animation', () => {
    for (const specId of Object.keys(FIGHTER_SPECS) as FighterSpecId[]) {
      for (const animationId of FIGHTER_SPRITE_ANIMATION_IDS) {
        const url = fighterSpriteSheetUrl(specId, animationId);
        const path = resolve(GAME_ROOT, 'public', url.replace(/^\//, ''));
        expect(existsSync(path), `${url} is missing`).toBe(true);
        expect(readPngDimensions(path)).toEqual({
          width: FIGHTER_SPRITE_ANIMATIONS[animationId].frames * FIGHTER_SPRITE_FRAME_WIDTH,
          height: FIGHTER_SPRITE_FRAME_HEIGHT,
        });
      }
    }
  });

  it('selects animation from combat state priority', () => {
    expect(selectFighterAnimation(fighter())).toBe('idle');
    expect(selectFighterAnimation(fighter({ vx: 2 }))).toBe('run');
    expect(selectFighterAnimation(fighter({ onGround: false }))).toBe('jump');
    expect(selectFighterAnimation(fighter({ blockTicks: 2, vx: 3 }))).toBe('block');
    expect(selectFighterAnimation(fighter({ hitstunTicks: 5, blockTicks: 2 }))).toBe('hurt');
    expect(selectFighterAnimation(fighter({ health: 0 }))).toBe('ko');
  });

  it('maps active move commands to attack animations', () => {
    expect(selectFighterAnimation(fighter({ activeMove: { moveId: 'water-basic', startedTick: 0, boosted: false, spawned: false } }))).toBe('basic');
    expect(selectFighterAnimation(fighter({ activeMove: { moveId: 'water-lash', startedTick: 0, boosted: false, spawned: false } }))).toBe('special1');
    expect(selectFighterAnimation(fighter({ activeMove: { moveId: 'water-ice-snare', startedTick: 0, boosted: false, spawned: false } }))).toBe('special2');
    expect(selectFighterAnimation(fighter({ activeMove: { moveId: 'water-steam-burst', startedTick: 0, boosted: false, spawned: false } }))).toBe('special3');
  });
});

function readPngDimensions(path: string): { width: number; height: number } {
  const buffer = readFileSync(path);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}
