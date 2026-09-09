import type { CombatSoundCue } from '../game/simulation/types';

const DEFAULT_CUE_COOLDOWNS_MS: Record<CombatSoundCue, number> = {
  'hit-light': 35,
  'hit-medium': 45,
  'hit-heavy': 70,
  block: 55,
  'startup-heavy': 180,
  'ring-danger': 520,
  hazard: 320,
};

const CUE_SETTINGS: Record<CombatSoundCue, { frequency: number; durationMs: number; gain: number; type: OscillatorType }> = {
  'hit-light': { frequency: 180, durationMs: 45, gain: 0.035, type: 'square' },
  'hit-medium': { frequency: 130, durationMs: 58, gain: 0.045, type: 'sawtooth' },
  'hit-heavy': { frequency: 82, durationMs: 82, gain: 0.06, type: 'sawtooth' },
  block: { frequency: 420, durationMs: 54, gain: 0.04, type: 'triangle' },
  'startup-heavy': { frequency: 260, durationMs: 72, gain: 0.026, type: 'sine' },
  'ring-danger': { frequency: 620, durationMs: 95, gain: 0.028, type: 'triangle' },
  hazard: { frequency: 95, durationMs: 38, gain: 0.015, type: 'sine' },
};

export function canPlayAudioCue(
  lastPlayedAt: Partial<Record<CombatSoundCue, number>>,
  cue: CombatSoundCue,
  nowMs: number,
  cooldowns: Record<CombatSoundCue, number> = DEFAULT_CUE_COOLDOWNS_MS,
): boolean {
  const previous = lastPlayedAt[cue] ?? Number.NEGATIVE_INFINITY;
  return nowMs - previous >= cooldowns[cue];
}

export class CombatAudio {
  private context: AudioContext | null = null;
  private unlocked = false;
  private disabled = false;
  private lastPlayedAt: Partial<Record<CombatSoundCue, number>> = {};

  unlock(): void {
    if (this.unlocked || this.disabled || typeof window === 'undefined') return;
    try {
      const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        this.disabled = true;
        return;
      }
      this.context = this.context ?? new AudioContextCtor();
      void this.context.resume();
      this.unlocked = true;
    } catch {
      this.disabled = true;
    }
  }

  play(cue: CombatSoundCue | null): void {
    if (!cue || this.disabled) return;
    this.unlock();
    const context = this.context;
    if (!context || context.state === 'closed') return;

    const nowMs = context.currentTime * 1000;
    if (!canPlayAudioCue(this.lastPlayedAt, cue, nowMs)) return;
    this.lastPlayedAt[cue] = nowMs;

    try {
      const setting = CUE_SETTINGS[cue];
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = setting.type;
      oscillator.frequency.setValueAtTime(setting.frequency, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, setting.frequency * 0.55), context.currentTime + setting.durationMs / 1000);
      gain.gain.setValueAtTime(setting.gain, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + setting.durationMs / 1000);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + setting.durationMs / 1000);
    } catch {
      this.disabled = true;
    }
  }
}
