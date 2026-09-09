import { describe, expect, it } from 'vitest';
import { canPlayAudioCue } from './combatAudio';
import type { CombatSoundCue } from '../game/simulation/types';

describe('combat audio helpers', () => {
  it('rate-limits repeated cues by sound kind', () => {
    const lastPlayedAt: Partial<Record<CombatSoundCue, number>> = { 'hit-heavy': 1000 };

    expect(canPlayAudioCue(lastPlayedAt, 'hit-heavy', 1030)).toBe(false);
    expect(canPlayAudioCue(lastPlayedAt, 'hit-heavy', 1100)).toBe(true);
    expect(canPlayAudioCue(lastPlayedAt, 'block', 1030)).toBe(true);
  });
});
