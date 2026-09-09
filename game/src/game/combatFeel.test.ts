import { describe, expect, it } from 'vitest';
import { ARENA_HEIGHT, ARENA_WIDTH } from './simulation/constants';
import {
  MAX_PRESENTATION_HITSTOP_TICKS,
  activeMoveDamping,
  feelForMove,
  impactFeedbackFor,
  ringOutDangerFor,
  startupTelegraphProgress,
} from './combatFeel';
import { createBattleState } from './simulation/battle';
import { FIGHTER_SPECS } from './simulation/fighters';
import type { ActiveMove, CombatImpact } from './simulation/types';

function impact(partial: Partial<CombatImpact> = {}): CombatImpact {
  return {
    tick: 1,
    sourceId: 'p1',
    targetId: 'cpu',
    moveId: 'water-basic',
    impactKind: 'hit',
    damage: 6,
    blocked: false,
    boosted: false,
    contactX: 100,
    contactY: 200,
    ...partial,
  };
}

describe('combat feel helpers', () => {
  it('maps move ids to explicit light, medium, heavy, boosted, and fallback feel profiles', () => {
    expect(feelForMove('water-basic')).toMatchObject({ weight: 'light', hitstopTicks: 2, shakeOnHit: false });
    expect(feelForMove('water-lash')).toMatchObject({ weight: 'medium', hitstopTicks: 3, shakeOnHit: false });
    expect(feelForMove('earth-stone-fist')).toMatchObject({ weight: 'heavy', hitstopTicks: 4, shakeOnHit: true });
    expect(feelForMove('fire-lava-break', true)).toMatchObject({ weight: 'heavy', hitstopTicks: 5, shakeOnHit: true });
    expect(feelForMove('unknown-move')).toMatchObject({ weight: 'medium', hitstopTicks: 3, shakeOnHit: false });
  });

  it('derives impact feedback without shaking light, medium, blocked, hazard, or reduced-motion impacts', () => {
    expect(impactFeedbackFor(impact({ moveId: 'water-basic' }))).toMatchObject({
      hitstopTicks: 2,
      shakeDurationMs: 0,
      soundCue: 'hit-light',
      spark: 'hit',
    });
    expect(impactFeedbackFor(impact({ moveId: 'earth-stone-fist', damage: 13 }))).toMatchObject({
      hitstopTicks: 4,
      soundCue: 'hit-heavy',
      spark: 'hit',
    });
    expect(impactFeedbackFor(impact({ moveId: 'earth-stone-fist', impactKind: 'blocked', blocked: true }))).toMatchObject({
      hitstopTicks: 2,
      shakeDurationMs: 0,
      soundCue: 'block',
      spark: 'block',
    });
    expect(impactFeedbackFor(impact({ sourceId: null, moveId: undefined, impactKind: 'hazard' }))).toMatchObject({
      hitstopTicks: 0,
      shakeDurationMs: 0,
      soundCue: 'hazard',
    });
    expect(impactFeedbackFor(impact({ moveId: 'fire-lava-break', damage: 12 }), { reducedMotion: true })).toMatchObject({
      shakeDurationMs: 0,
      flashTicks: 1,
    });
  });

  it('caps boosted heavy hitstop and exposes stronger special commitment damping', () => {
    expect(feelForMove('fire-lava-break', true).hitstopTicks).toBeLessThanOrEqual(MAX_PRESENTATION_HITSTOP_TICKS);
    expect(activeMoveDamping('water-basic')).toBeGreaterThan(activeMoveDamping('water-lash'));
  });

  it('clamps startup telegraph progress from 0 to 1', () => {
    const move = FIGHTER_SPECS.water.moves.find((candidate) => candidate.id === 'water-lash')!;
    const activeMove: ActiveMove = { moveId: move.id, startedTick: 100, boosted: false, spawned: false };

    expect(startupTelegraphProgress(activeMove, move, 90)).toBe(0);
    expect(startupTelegraphProgress(activeMove, move, 100 + Math.floor(move.startupTicks / 2))).toBeGreaterThan(0);
    expect(startupTelegraphProgress(activeMove, move, 100 + move.startupTicks + 20)).toBe(1);
  });

  it('flags ring-out danger only near bounds while moving outward', () => {
    const state = createBattleState('water');
    const fighter = state.fighters.p1;

    fighter.x = ARENA_WIDTH / 2;
    fighter.y = ARENA_HEIGHT / 2;
    fighter.vx = -12;
    expect(ringOutDangerFor(fighter).active).toBe(false);

    fighter.x = 42;
    fighter.vx = 4;
    expect(ringOutDangerFor(fighter).active).toBe(false);

    fighter.x = 42;
    fighter.vx = -4;
    expect(ringOutDangerFor(fighter)).toMatchObject({ active: true, side: 'left' });

    fighter.x = ARENA_WIDTH - 42;
    fighter.vx = 4;
    expect(ringOutDangerFor(fighter)).toMatchObject({ active: true, side: 'right' });

    fighter.x = ARENA_WIDTH / 2;
    fighter.y = ARENA_HEIGHT - 30;
    fighter.vx = 0;
    fighter.vy = 5;
    expect(ringOutDangerFor(fighter)).toMatchObject({ active: true, side: 'bottom' });
  });
});
