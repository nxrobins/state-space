import { describe, it, expect } from 'vitest';
import {
  checkedGameplayCommand,
  checkedGameplayRules,
  checkedGameplayState,
} from './gameplay-gpu.js';

const player = {
  x: 6 * 256,
  y: 24 * 256,
  z: 15 * 256,
  vy: 0,
  grounded: true,
  wet: false,
  jumpHeld: false,
  cooldown: 0,
  blocked: false,
};
const state = {
  player,
  look: [256, 0, 0],
  status: 'playing' as const,
  carved: false,
  iceWalk: false,
};
const command = {
  tick: 1,
  moveX: 256,
  moveZ: 0,
  jump: false,
  tool: 'none' as const,
  look: [256, 0, 0],
};
describe('resident gameplay command boundary', () => {
  it('owns accepted state, rules and commands', () => {
    const s = checkedGameplayState(state, [32, 32, 32]);
    s.player.x = 99;
    s.look[0] = 0;
    expect(state.player.x).toBe(1536);
    expect(state.look[0]).toBe(256);
    const c = checkedGameplayCommand(command, 1);
    c.look[0] = 0;
    expect(command.look[0]).toBe(256);
    const r = {
      goal: { minX: 6144, maxY: 6145, minZ: 3328, maxZ: 4608 },
      fallY: 7168,
      toolCeiling: 29,
    };
    const owned = checkedGameplayRules(r, [32, 32, 32]);
    owned.goal.minX = 0;
    expect(r.goal.minX).toBe(6144);
  });
  it('rejects sparse, noninteger, stale and out-of-range input before dispatch', () => {
    for (const c of [
      null,
      {},
      { ...command, tick: 2 },
      { ...command, tick: NaN },
      { ...command, look: [256, , 0] },
      { ...command, moveZ: 256 },
      { ...command, moveX: 1.5 },
      { ...command, jump: 1 },
      { ...command, tool: 'heat' },
      { ...command, extra: true },
    ])
      expect(() => checkedGameplayCommand(c as never, 1)).toThrow();
    for (const s of [
      { ...state, look: [256, , 0] },
      { ...state, carved: 1 },
      { ...state, player: { ...player, x: -1 } },
      { ...state, player: { ...player, vy: 151 } },
    ])
      expect(() => checkedGameplayState(s as never, [32, 32, 32])).toThrow();
    expect(() =>
      checkedGameplayRules(
        { goal: { minX: 0, maxY: 0, minZ: 100, maxZ: 1 }, fallY: 7168, toolCeiling: 29 },
        [32, 32, 32],
      ),
    ).toThrow();
  });
});
