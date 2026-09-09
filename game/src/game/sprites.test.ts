import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { FIGHTER_SPECS } from './simulation/fighters';
import {
  FIGHTER_SPRITE_ANIMATION_IDS,
  FIGHTER_SPRITE_ANIMATIONS,
  FIGHTER_SPRITE_FRAME_HEIGHT,
  FIGHTER_SPRITE_FRAME_WIDTH,
  fighterAnimationKey,
  fighterSpriteSheetKey,
  fighterSpriteSheetUrl,
  createFighterAnimationDecision,
  fighterSpriteAnimationIdsForSpec,
  resolveFighterSpriteAnimation,
  selectFighterAnimation,
  stabilizeFighterAnimation,
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
    shieldPoints: 100,
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
    ...overrides,
  };
}

describe('fighter sprite catalog', () => {
  it('builds stable Phaser sheet and animation keys', () => {
    expect(fighterSpriteSheetKey('fire', 'special3')).toBe('fighter-fire-special3');
    expect(fighterAnimationKey('earth', 'run')).toBe('fighter-earth-run-anim');
    expect(fighterSpriteSheetUrl('water', 'idle')).toBe('/assets/sprites/fighters/water/idle.png');
  });

  it('contains the legacy core fighting animation set and Water platform catalog', () => {
    expect(FIGHTER_SPRITE_ANIMATION_IDS).toEqual(expect.arrayContaining([
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
    ]));
    expect(fighterSpriteAnimationIdsForSpec('earth')).toEqual([
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
    expect(fighterSpriteAnimationIdsForSpec('water')).toEqual(expect.arrayContaining([
      'shield',
      'fall',
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
    ]));
    expect(FIGHTER_SPRITE_ANIMATIONS.idle.frameRate).toBeLessThan(FIGHTER_SPRITE_ANIMATIONS.run.frameRate);
    expect(FIGHTER_SPRITE_ANIMATIONS.idle.frameRate).toBeLessThanOrEqual(3);
  });

  it('has generated PNG sheets for every fighter-specific animation', () => {
    for (const specId of Object.keys(FIGHTER_SPECS) as FighterSpecId[]) {
      for (const animationId of fighterSpriteAnimationIdsForSpec(specId)) {
        const url = fighterSpriteSheetUrl(specId, animationId);
        const path = resolve(GAME_ROOT, 'public', url.replace(/^\//, ''));
        expect(existsSync(path), `${url} is missing`).toBe(true);
        expect(readPngDimensions(path)).toEqual({
          width: FIGHTER_SPRITE_ANIMATIONS[animationId].frames * FIGHTER_SPRITE_FRAME_WIDTH,
          height: FIGHTER_SPRITE_FRAME_HEIGHT,
        });
        expect(readPngCornerAlphas(path), `${url} corners must stay transparent`).toEqual([0, 0, 0, 0]);
      }
    }
  });

  it('selects animation from combat state priority', () => {
    expect(selectFighterAnimation(fighter())).toBe('idle');
    expect(selectFighterAnimation(fighter({ vx: 2 }))).toBe('run');
    expect(selectFighterAnimation(fighter({ onGround: false }))).toBe('jump');
    expect(selectFighterAnimation(fighter({ onGround: false, vy: 4 }))).toBe('fall');
    expect(selectFighterAnimation(fighter({ blockTicks: 2, vx: 3 }))).toBe('shield');
    expect(selectFighterAnimation(fighter({ hitstunTicks: 5, blockTicks: 2 }))).toBe('hurt');
    expect(selectFighterAnimation(fighter({ health: 0 }))).toBe('ko');
    expect(resolveFighterSpriteAnimation('earth', 'shield')).toBe('block');
    expect(resolveFighterSpriteAnimation('fire', 'special-neutral')).toBe('special1');
  });

  it('maps active move commands to attack animations', () => {
    expect(selectFighterAnimation(fighter({ activeMove: { moveId: 'water-basic', startedTick: 0, boosted: false, spawned: false } }))).toBe('basic');
    expect(selectFighterAnimation(fighter({ activeMove: { moveId: 'water-attack-side', startedTick: 0, boosted: false, spawned: false } }))).toBe('attack-side');
    expect(selectFighterAnimation(fighter({ activeMove: { moveId: 'water-air-back', startedTick: 0, boosted: false, spawned: false } }))).toBe('air-back');
    expect(selectFighterAnimation(fighter({ activeMove: { moveId: 'water-lash', startedTick: 0, boosted: false, spawned: false } }))).toBe('special-neutral');
    expect(selectFighterAnimation(fighter({ activeMove: { moveId: 'water-ice-snare', startedTick: 0, boosted: false, spawned: false } }))).toBe('special-down');
    expect(selectFighterAnimation(fighter({ activeMove: { moveId: 'water-steam-lift', startedTick: 0, boosted: false, spawned: false } }))).toBe('special-up');
  });

  it('debounces locomotion animation flicker without delaying combat states', () => {
    let decision = createFighterAnimationDecision('idle');

    decision = stabilizeFighterAnimation('jump', decision, 4);
    expect(decision.animation).toBe('idle');
    decision = stabilizeFighterAnimation('run', decision, 4);
    expect(decision.animation).toBe('idle');
    decision = stabilizeFighterAnimation('jump', decision, 4);
    expect(decision.animation).toBe('idle');

    decision = createFighterAnimationDecision('idle');
    decision = stabilizeFighterAnimation('jump', decision, 4);
    decision = stabilizeFighterAnimation('jump', decision, 4);
    decision = stabilizeFighterAnimation('jump', decision, 4);
    expect(decision.animation).toBe('idle');
    decision = stabilizeFighterAnimation('jump', decision, 4);
    expect(decision.animation).toBe('jump');

    decision = stabilizeFighterAnimation('special1', decision, 4);
    expect(decision.animation).toBe('special1');
    decision = stabilizeFighterAnimation('idle', decision, 4);
    expect(decision.animation).toBe('idle');
  });
});

function readPngDimensions(path: string): { width: number; height: number } {
  const buffer = readFileSync(path);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readPngCornerAlphas(path: string): number[] {
  const rgba = readPngRgba(path);
  const { width, height, pixels } = rgba;
  return [
    alphaAt(pixels, width, 0, 0),
    alphaAt(pixels, width, width - 1, 0),
    alphaAt(pixels, width, 0, height - 1),
    alphaAt(pixels, width, width - 1, height - 1),
  ];
}

function alphaAt(pixels: Uint8Array, width: number, x: number, y: number): number {
  return pixels[(y * width + x) * 4 + 3];
}

function readPngRgba(path: string): { width: number; height: number; pixels: Uint8Array } {
  const buffer = readFileSync(path);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer.readUInt8(24);
  const colorType = buffer.readUInt8(25);
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`${path} must be an 8-bit RGBA PNG for corner alpha checks.`);
  }

  const idatChunks: Buffer[] = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === 'IDAT') idatChunks.push(buffer.subarray(dataStart, dataStart + length));
    offset = dataStart + length + 4;
    if (type === 'IEND') break;
  }

  const inflated = inflateSync(Buffer.concat(idatChunks));
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const pixels = new Uint8Array(width * height * bytesPerPixel);
  let source = 0;
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[source++];
    const row = Uint8Array.from(inflated.subarray(source, source + stride));
    source += stride;
    unfilterRow(row, previous, bytesPerPixel, filter);
    pixels.set(row, y * stride);
    previous = row;
  }
  return { width, height, pixels };
}

function unfilterRow(row: Uint8Array, previous: Uint8Array, bytesPerPixel: number, filter: number): void {
  for (let i = 0; i < row.length; i++) {
    const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
    const up = previous[i] ?? 0;
    const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;
    if (filter === 1) row[i] = (row[i] + left) & 0xff;
    else if (filter === 2) row[i] = (row[i] + up) & 0xff;
    else if (filter === 3) row[i] = (row[i] + Math.floor((left + up) / 2)) & 0xff;
    else if (filter === 4) row[i] = (row[i] + paeth(left, up, upLeft)) & 0xff;
    else if (filter !== 0) throw new Error(`Unsupported PNG row filter ${filter}.`);
  }
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}
