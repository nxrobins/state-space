import { ARENA_HEIGHT, ARENA_WIDTH } from './simulation/constants';
import type {
  ActiveMove,
  CombatImpact,
  CombatSoundCue,
  FighterState,
  MoveFeelSpec,
  MoveSpec,
  Rect,
} from './simulation/types';

export const MAX_PRESENTATION_HITSTOP_TICKS = 6;
export const MAX_SHAKE_DURATION_MS = 120;
export const MAX_SHAKE_INTENSITY = 0.0038;

const EDGE_DANGER_MARGIN = 96;
const BOTTOM_DANGER_MARGIN = 92;
const OUTWARD_X_SPEED = 1.1;
const OUTWARD_Y_SPEED = 2.2;

const LIGHT_FEEL: MoveFeelSpec = {
  weight: 'light',
  hitstopTicks: 2,
  blockedHitstopTicks: 1,
  soundCue: 'hit-light',
  telegraphStyle: 'light',
  shakeOnHit: false,
};

const MEDIUM_FEEL: MoveFeelSpec = {
  weight: 'medium',
  hitstopTicks: 3,
  blockedHitstopTicks: 1,
  soundCue: 'hit-medium',
  telegraphStyle: 'medium',
  shakeOnHit: false,
};

const HEAVY_FEEL: MoveFeelSpec = {
  weight: 'heavy',
  hitstopTicks: 4,
  blockedHitstopTicks: 2,
  soundCue: 'hit-heavy',
  telegraphStyle: 'heavy',
  shakeOnHit: true,
  startupCue: 'startup-heavy',
};

const HEAVY_MOVE_IDS = new Set(['earth-stone-fist', 'fire-lava-break', 'water-air-down', 'water-ice-snare']);

export interface ImpactFeedback {
  hitstopTicks: number;
  flashTicks: number;
  shakeDurationMs: number;
  shakeIntensity: number;
  soundCue: CombatSoundCue | null;
  spark: 'hit' | 'block' | 'hazard' | 'none';
  weight: MoveFeelSpec['weight'];
}

export interface RingOutDanger {
  active: boolean;
  side: 'left' | 'right' | 'bottom' | 'top' | null;
  severity: number;
}

export function feelForMove(moveId?: string, boosted = false): MoveFeelSpec {
  const base = baseFeelForMove(moveId);
  if (!boosted || base.weight !== 'heavy') return base;
  return {
    ...base,
    hitstopTicks: Math.min(MAX_PRESENTATION_HITSTOP_TICKS, base.hitstopTicks + 1),
  };
}

export function impactFeedbackFor(
  impact: CombatImpact,
  options: { reducedMotion?: boolean } = {},
): ImpactFeedback {
  if (impact.impactKind === 'hazard') {
    return {
      hitstopTicks: 0,
      flashTicks: 0,
      shakeDurationMs: 0,
      shakeIntensity: 0,
      soundCue: 'hazard',
      spark: 'hazard',
      weight: 'light',
    };
  }

  const feel = feelForMove(impact.moveId, impact.boosted);
  if (impact.blocked || impact.impactKind === 'blocked') {
    return {
      hitstopTicks: Math.min(MAX_PRESENTATION_HITSTOP_TICKS, feel.blockedHitstopTicks),
      flashTicks: options.reducedMotion ? 1 : 3,
      shakeDurationMs: 0,
      shakeIntensity: 0,
      soundCue: 'block',
      spark: 'block',
      weight: feel.weight,
    };
  }

  const shouldShake = feel.shakeOnHit && !options.reducedMotion;
  return {
    hitstopTicks: Math.min(MAX_PRESENTATION_HITSTOP_TICKS, feel.hitstopTicks),
    flashTicks: options.reducedMotion ? 1 : feel.hitstopTicks + 2,
    shakeDurationMs: shouldShake ? Math.min(MAX_SHAKE_DURATION_MS, 72 + impact.damage * 4) : 0,
    shakeIntensity: shouldShake ? Math.min(MAX_SHAKE_INTENSITY, 0.0024 + impact.damage * 0.00008) : 0,
    soundCue: feel.soundCue,
    spark: 'hit',
    weight: feel.weight,
  };
}

export function startupTelegraphProgress(activeMove: ActiveMove, move: MoveSpec, tick: number): number {
  if (move.startupTicks <= 0) return 1;
  const elapsed = Math.max(0, tick - activeMove.startedTick);
  return clamp(elapsed / move.startupTicks, 0, 1);
}

export function ringOutDangerFor(fighter: FighterState): RingOutDanger {
  const leftRisk = fighter.x < EDGE_DANGER_MARGIN && fighter.vx < -OUTWARD_X_SPEED;
  const rightRisk = fighter.x > ARENA_WIDTH - EDGE_DANGER_MARGIN && fighter.vx > OUTWARD_X_SPEED;
  const bottomRisk = fighter.y > ARENA_HEIGHT - BOTTOM_DANGER_MARGIN && fighter.vy > OUTWARD_Y_SPEED;
  const topRisk = fighter.y < 32 && fighter.vy < -7;

  if (leftRisk) return danger('left', (EDGE_DANGER_MARGIN - fighter.x) / EDGE_DANGER_MARGIN, Math.abs(fighter.vx) / 12);
  if (rightRisk) return danger('right', (fighter.x - (ARENA_WIDTH - EDGE_DANGER_MARGIN)) / EDGE_DANGER_MARGIN, Math.abs(fighter.vx) / 12);
  if (bottomRisk) return danger('bottom', (fighter.y - (ARENA_HEIGHT - BOTTOM_DANGER_MARGIN)) / BOTTOM_DANGER_MARGIN, fighter.vy / 16);
  if (topRisk) return danger('top', (32 - fighter.y) / 80, Math.abs(fighter.vy) / 16);

  return { active: false, side: null, severity: 0 };
}

export function activeMoveDamping(moveId?: string): number {
  const feel = feelForMove(moveId);
  return feel.weight === 'light' ? 0.55 : 0.25;
}

export function rectIntersectionCenter(a: Rect, b: Rect): { x: number; y: number } {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (left <= right && top <= bottom) {
    return {
      x: (left + right) / 2,
      y: (top + bottom) / 2,
    };
  }
  return {
    x: (a.x + a.width / 2 + b.x + b.width / 2) / 2,
    y: (a.y + a.height / 2 + b.y + b.height / 2) / 2,
  };
}

function baseFeelForMove(moveId?: string): MoveFeelSpec {
  if (moveId?.endsWith('-basic') || moveId?.includes('attack-neutral') || moveId?.includes('grab')) return LIGHT_FEEL;
  if (moveId && HEAVY_MOVE_IDS.has(moveId)) return HEAVY_FEEL;
  return MEDIUM_FEEL;
}

function danger(side: RingOutDanger['side'], positionRisk: number, velocityRisk: number): RingOutDanger {
  return {
    active: true,
    side,
    severity: clamp(Math.max(positionRisk, velocityRisk), 0.25, 1),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
