import { describe, expect, it } from 'vitest';
import {
  DAMAGE_FLASH_TICKS,
  fighterStateSummary,
  incomingThreatSummary,
  isRecentlyDamaged,
  resolveTouchAction,
  shouldEnableTouchControls,
  shouldShowTouchHint,
} from './hud';
import type { FighterState } from '../game/simulation/types';

function createFighter(overrides: Partial<FighterState> = {}): FighterState {
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
    width: 42,
    height: 76,
    health: 100,
    stocks: 3,
    meter: 20,
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

describe('fighterStateSummary', () => {
  it('prioritizes invulnerability status', () => {
    const fighter = createFighter({ invulnTicks: 30, hitstunTicks: 14, blockTicks: 2, boosted: true });
    expect(fighterStateSummary(fighter)).toEqual({ label: 'Invuln 30', tone: 'boost' });
  });

  it('shows hitstun and danger tone when recently struck', () => {
    const fighter = createFighter({ hitstunTicks: 11 });
    expect(fighterStateSummary(fighter)).toEqual({ label: 'Hitstun 11', tone: 'danger' });
  });

  it('shows startup timing while an attack is winding up', () => {
    const fighter = createFighter({
      activeMove: { moveId: 'water-lash', startedTick: 100, boosted: false, spawned: false },
    });
    expect(fighterStateSummary(fighter, 104)).toEqual({ label: 'Startup 5f', tone: 'warning' });
  });

  it('shows active timing once the move is live', () => {
    const fighter = createFighter({
      activeMove: { moveId: 'water-lash', startedTick: 100, boosted: false, spawned: true },
    });
    expect(fighterStateSummary(fighter, 110)).toEqual({ label: 'Active 9f', tone: 'danger' });
  });

  it('shows recovery timing after active frames end', () => {
    const fighter = createFighter({
      activeMove: { moveId: 'water-lash', startedTick: 100, boosted: false, spawned: true },
    });
    expect(fighterStateSummary(fighter, 120)).toEqual({ label: 'Recover 13f', tone: 'neutral' });
  });

  it('falls back to generic attacking label when move metadata is missing', () => {
    const fighter = createFighter({
      activeMove: { moveId: 'missing-move-id', startedTick: 100, boosted: false, spawned: true },
    });
    expect(fighterStateSummary(fighter, 110)).toEqual({ label: 'Attacking', tone: 'warning' });
  });
});

describe('incomingThreatSummary', () => {
  it('returns warning cue when opponent startup is in the telegraph window', () => {
    const attacker = createFighter({
      specId: 'water',
      activeMove: { moveId: 'water-lash', startedTick: 100, boosted: false, spawned: false },
    });
    expect(incomingThreatSummary(attacker, 104)).toEqual({ framesUntilActive: 5, tone: 'warning' });
  });

  it('returns danger cue when opponent startup is imminent', () => {
    const attacker = createFighter({
      specId: 'water',
      activeMove: { moveId: 'water-lash', startedTick: 100, boosted: false, spawned: false },
    });
    expect(incomingThreatSummary(attacker, 106)).toEqual({ framesUntilActive: 3, tone: 'danger' });
  });

  it('returns null when opponent move is already active, too far out, or unknown', () => {
    const activeMoveAttacker = createFighter({
      specId: 'water',
      activeMove: { moveId: 'water-lash', startedTick: 100, boosted: false, spawned: true },
    });
    expect(incomingThreatSummary(activeMoveAttacker, 110)).toBeNull();

    const farStartupAttacker = createFighter({
      specId: 'fire',
      activeMove: { moveId: 'fire-blast-dash', startedTick: 100, boosted: false, spawned: false },
    });
    expect(incomingThreatSummary(farStartupAttacker, 101, 3)).toBeNull();

    const unknownMoveAttacker = createFighter({
      activeMove: { moveId: 'unknown', startedTick: 100, boosted: false, spawned: false },
    });
    expect(incomingThreatSummary(unknownMoveAttacker, 101)).toBeNull();
  });
});

describe('isRecentlyDamaged', () => {
  it('returns true within the damage flash window', () => {
    const fighter = createFighter({ lastDamageTakenTick: 120 });
    expect(isRecentlyDamaged(fighter, 120 + DAMAGE_FLASH_TICKS)).toBe(true);
  });

  it('returns false after the damage flash window elapses', () => {
    const fighter = createFighter({ lastDamageTakenTick: 120 });
    expect(isRecentlyDamaged(fighter, 120 + DAMAGE_FLASH_TICKS + 1)).toBe(false);
  });
});

describe('touch controls helpers', () => {
  it('enables touch controls when coarse pointer is reported', () => {
    expect(
      shouldEnableTouchControls({
        matchMedia: () => ({ matches: true }),
        navigator: { maxTouchPoints: 0 },
      }),
    ).toBe(true);
  });

  it('enables touch controls when touch points are available', () => {
    expect(
      shouldEnableTouchControls({
        matchMedia: () => ({ matches: false }),
        navigator: { maxTouchPoints: 2 },
      }),
    ).toBe(true);
  });

  it('resolves known touch actions and rejects unknown inputs', () => {
    expect(resolveTouchAction('basic')).toBe('basic');
    expect(resolveTouchAction('teleport')).toBeNull();
    expect(resolveTouchAction(undefined)).toBeNull();
  });

  it('shows touch hint while touch is enabled and player has not acted', () => {
    expect(
      shouldShowTouchHint({ enabled: true, dismissed: false, firstShownTick: 50, actionUsed: false }, 100, 120),
    ).toBe(true);
  });

  it('hides touch hint after action use, dismiss, or timeout', () => {
    expect(
      shouldShowTouchHint({ enabled: true, dismissed: false, firstShownTick: 0, actionUsed: true }, 40, 120),
    ).toBe(false);
    expect(
      shouldShowTouchHint({ enabled: true, dismissed: true, firstShownTick: 0, actionUsed: false }, 40, 120),
    ).toBe(false);
    expect(
      shouldShowTouchHint({ enabled: true, dismissed: false, firstShownTick: 0, actionUsed: false }, 121, 120),
    ).toBe(false);
  });
});
