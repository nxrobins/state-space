import { describe, expect, it } from 'vitest';
import { createBufferedInput, INPUT_BUFFER_TICKS, resolveCommandCandidate } from './commandResolver';
import { emptyActions } from './actions';
import type { ActionState, FighterState } from '../simulation/types';

function actions(partial: Partial<ActionState> = {}): ActionState {
  return { ...emptyActions(), ...partial };
}

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

describe('command resolver', () => {
  it('prefers the new directional attack grammar over duplicate legacy bits', () => {
    expect(resolveCommandCandidate(fighter(), actions({ attack: true, basic: true }))?.command).toBe('attack-neutral');
    expect(resolveCommandCandidate(fighter(), actions({ attack: true, basic: true, right: true }))?.command).toBe('attack-side');
    expect(resolveCommandCandidate(fighter(), actions({ attack: true, up: true }))?.command).toBe('attack-up');
    expect(resolveCommandCandidate(fighter(), actions({ attack: true, down: true }))?.command).toBe('attack-down');
  });

  it('resolves aerial forward and back relative to the facing snapshot', () => {
    expect(resolveCommandCandidate(fighter({ onGround: false, facing: 1 }), actions({ attack: true, right: true }))).toMatchObject({
      command: 'air-forward',
      direction: 'forward',
      facing: 1,
      airborne: true,
    });
    expect(resolveCommandCandidate(fighter({ onGround: false, facing: 1 }), actions({ attack: true, left: true }))).toMatchObject({
      command: 'air-back',
      direction: 'back',
      facing: 1,
    });
    expect(resolveCommandCandidate(fighter({ onGround: false, facing: -1 }), actions({ attack: true, left: true }))?.command).toBe('air-forward');
  });

  it('resolves directional specials and throws from the same held direction snapshot', () => {
    expect(resolveCommandCandidate(fighter(), actions({ special: true }))?.command).toBe('special-neutral');
    expect(resolveCommandCandidate(fighter(), actions({ special: true, right: true }))?.command).toBe('special-side');
    expect(resolveCommandCandidate(fighter(), actions({ special: true, up: true }))?.command).toBe('special-up');
    expect(resolveCommandCandidate(fighter(), actions({ grab: true, left: true }))?.command).toBe('grab-back');
  });

  it('keeps legacy-only replay action bits resolvable and stamps a six-tick buffer', () => {
    const resolution = resolveCommandCandidate(fighter({ facing: -1 }), actions({ special2: true }));
    expect(resolution).toMatchObject({ command: 'special2', direction: 'down', facing: -1, airborne: false });

    const buffered = createBufferedInput(resolution!, 40);
    expect(buffered).toMatchObject({
      command: 'special2',
      requestedTick: 40,
      expiresAtTick: 40 + INPUT_BUFFER_TICKS,
      facing: -1,
    });
  });
});
