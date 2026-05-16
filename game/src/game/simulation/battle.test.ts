import { describe, expect, it } from 'vitest';
import { MaterialType, RESPAWN_INVULN_TICKS } from './constants';
import { FIGHTER_SPECS } from './fighters';
import { clearRectAroundWorldPoint, consumeDirtyMaterialIndices, getCell, gridIndex, setTemporaryRect, tickMaterialLifetimes } from './grid';
import { applyDamage, createBattleState, EMPTY_ACTIONS, fighterHasMaterialBoost, stepBattle, tryStartMove } from './battle';
import { appendReplayFrame, packActions, replayBattle, unpackActions } from '../replay';
import type { ActionState, BattleState, FighterId, InputCommand, ReplayLog } from './types';

function actions(partial: Partial<ActionState> = {}): ActionState {
  return { ...EMPTY_ACTIONS, ...partial };
}

function snapshot(state: BattleState): string {
  return JSON.stringify({
    tick: state.tick,
    timerTicks: state.timerTicks,
    rngSeed: state.rngSeed,
    fighters: state.fighters,
    activeHitboxes: state.activeHitboxes,
    temporaryCellCount: state.temporaryCellCount,
    result: state.result,
  });
}

describe('battle simulation contracts', () => {
  it('updates deterministically with fixed input and seed', () => {
    const a = createBattleState('water', 1234);
    const b = createBattleState('water', 1234);
    const script = [
      actions({ right: true }),
      actions({ right: true, special1: true }),
      actions({ up: true }),
      actions({ basic: true }),
      actions({ left: true, block: true }),
    ];

    for (let i = 0; i < 180; i++) {
      stepBattle(a, script[i % script.length]);
      stepBattle(b, script[i % script.length]);
    }

    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it('keeps meter spending atomic and clamped', () => {
    const state = createBattleState('water');
    const fighter = state.fighters.p1;
    fighter.meter = 10;

    expect(tryStartMove(state, fighter, 'special1').ok).toBe(false);
    expect(fighter.meter).toBe(10);
    expect(fighter.activeMove).toBeNull();

    fighter.meter = 25;
    expect(tryStartMove(state, fighter, 'special1').ok).toBe(true);
    expect(fighter.meter).toBe(0);
    expect(fighter.moveCooldowns['water-lash']).toBeGreaterThan(0);
  });

  it('uses the bounded 13x13 boost window and 12-cell threshold', () => {
    const state = createBattleState('water');
    const fighter = state.fighters.p1;
    const cx = Math.floor(fighter.x / 8);
    const cy = Math.floor(fighter.y / 8);

    setTemporaryRect(state, 'p1', cx - 2, cy - 1, 4, 3, MaterialType.Water, 100);
    expect(fighterHasMaterialBoost(state, fighter)).toBe(true);

    const far = createBattleState('water');
    setTemporaryRect(far, 'p1', 0, 0, 12, 1, MaterialType.Water, 100);
    expect(fighterHasMaterialBoost(far, far.fighters.p1)).toBe(false);
  });

  it('resets stock loss state and caps preserved meter', () => {
    const state = createBattleState('earth');
    const fighter = state.fighters.p1;
    fighter.health = 0;
    fighter.meter = 88;
    fighter.vx = 5;
    fighter.activeMove = { moveId: 'earth-stone-fist', startedTick: 0, boosted: false, spawned: false };

    stepBattle(state, actions());

    expect(fighter.stocks).toBe(2);
    expect(fighter.health).toBe(100);
    expect(fighter.meter).toBe(50);
    expect(fighter.invulnTicks).toBe(RESPAWN_INVULN_TICKS);
    expect(fighter.activeMove).toBeNull();
    expect(fighter.vx).toBe(0);
  });

  it('applies simultaneous deaths in the same tick before match resolution', () => {
    const state = createBattleState('fire');
    state.fighters.p1.health = 0;
    state.fighters.cpu.health = 0;

    stepBattle(state, actions());

    expect(state.fighters.p1.stocks).toBe(2);
    expect(state.fighters.cpu.stocks).toBe(2);
    expect(state.result).toBeNull();
  });

  it('uses timer tie breakers by stocks, then health', () => {
    const state = createBattleState('water');
    state.timerTicks = 1;
    state.fighters.p1.health = 80;
    state.fighters.cpu.health = 60;

    stepBattle(state, actions());

    expect(state.result?.winner).toBe('p1');
    expect(state.result?.reason).toBe('timer');
  });

  it('enters sudden death when timer stocks and health are tied', () => {
    const state = createBattleState('water');
    state.timerTicks = 1;
    state.fighters.p1.health = 75;
    state.fighters.cpu.health = 75;

    stepBattle(state, actions());

    expect(state.matchPhase).toBe('suddenDeath');
    expect(state.fighters.p1.health).toBe(1);
    expect(state.fighters.cpu.health).toBe(1);
  });

  it('applies material reaction precedence across overlapping fighter coverage', () => {
    const state = createBattleState('water');
    const fighter = state.fighters.p1;
    fighter.invulnTicks = 0;
    const cx = Math.floor(fighter.x / 8);
    const cy = Math.floor(fighter.y / 8);
    setTemporaryRect(state, 'cpu', cx, cy, 1, 1, MaterialType.Lava, 100);
    setTemporaryRect(state, 'cpu', cx + 1, cy, 1, 1, MaterialType.Ice, 100);
    setTemporaryRect(state, 'cpu', cx - 1, cy, 1, 1, MaterialType.Water, 100);

    stepBattle(state, actions(), actions());

    expect(fighter.health).toBe(100);
    expect(getCell(state.materialGrid, cx, cy).material).toBe(MaterialType.Stone);
    expect(getCell(state.materialGrid, cx + 1, cy).material).toBe(MaterialType.Water);
    expect(getCell(state.materialGrid, cx - 1, cy).material).toBe(MaterialType.Steam);
  });

  it('quenches water and fire contact into steam', () => {
    const state = createBattleState('water');
    setTemporaryRect(state, 'p1', 40, 40, 1, 1, MaterialType.Water, 120);
    setTemporaryRect(state, 'cpu', 41, 40, 1, 1, MaterialType.Fire, 120);

    stepBattle(state, actions(), actions());

    expect(getCell(state.materialGrid, 40, 40).material).toBe(MaterialType.Steam);
    expect(getCell(state.materialGrid, 41, 40).material).toBe(MaterialType.Steam);
  });

  it('cools lava into stone when adjacent to water', () => {
    const state = createBattleState('water');
    setTemporaryRect(state, 'p1', 46, 41, 1, 1, MaterialType.Water, 120);
    setTemporaryRect(state, 'cpu', 47, 41, 1, 1, MaterialType.Lava, 120);

    stepBattle(state, actions(), actions());

    expect(getCell(state.materialGrid, 46, 41).material).toBe(MaterialType.Steam);
    expect(getCell(state.materialGrid, 47, 41).material).toBe(MaterialType.Stone);
  });

  it('melts ice into water when exposed to adjacent heat', () => {
    const state = createBattleState('earth');
    setTemporaryRect(state, 'p1', 52, 38, 1, 1, MaterialType.Ice, 120);
    setTemporaryRect(state, 'cpu', 53, 38, 1, 1, MaterialType.Fire, 120);

    stepBattle(state, actions(), actions());

    expect(getCell(state.materialGrid, 52, 38).material).toBe(MaterialType.Water);
  });

  it('does not let owned hitboxes damage their owner', () => {
    const state = createBattleState('earth');
    const p1 = state.fighters.p1;
    const cpu = state.fighters.cpu;
    cpu.x = p1.x + 48;
    cpu.y = p1.y;
    p1.meter = 0;
    expect(tryStartMove(state, p1, 'basic').ok).toBe(true);

    for (let i = 0; i < 8; i++) stepBattle(state, actions(), actions());

    expect(p1.health).toBe(100);
    expect(cpu.health).toBeLessThan(100);
  });

  it('water passive reduces environmental hazard damage', () => {
    const state = createBattleState('water');
    const p1 = state.fighters.p1;

    const didApply = applyDamage(state, p1, 10, 0, -0.5, null);

    expect(didApply).toBe(true);
    expect(p1.health).toBeCloseTo(93.5, 5);
  });

  it('earth passive reduces incoming damage, knockback, and hitstun', () => {
    const state = createBattleState('earth');
    const p1 = state.fighters.p1;

    const didApply = applyDamage(state, p1, 10, 2, -4, 'cpu');

    expect(didApply).toBe(true);
    expect(p1.health).toBeCloseTo(91, 5);
    expect(p1.vx).toBeCloseTo(1.56, 5);
    expect(p1.vy).toBeCloseTo(-3.12, 5);
    expect(p1.hitstunTicks).toBe(16);
  });

  it('fire passive boosts outgoing damage while boosted', () => {
    const state = createBattleState('fire');
    const p1 = state.fighters.p1;
    const cpu = state.fighters.cpu;
    p1.boosted = true;

    const didApply = applyDamage(state, cpu, 10, 0, -1, 'p1');

    expect(didApply).toBe(true);
    expect(cpu.health).toBeCloseTo(88.6, 5);
  });
});

describe('move contracts', () => {
  const commands: InputCommand[] = ['special1', 'special2', 'special3'];

  for (const specId of Object.keys(FIGHTER_SPECS) as Array<keyof typeof FIGHTER_SPECS>) {
    for (const command of commands) {
      it(`${specId} ${command} fails without meter and succeeds with bounded materials`, () => {
        const state = createBattleState(specId);
        const fighter = state.fighters.p1;
        const move = FIGHTER_SPECS[specId].moves.find((candidate) => candidate.command === command);
        if (!move) throw new Error(`Missing ${specId}:${command}`);

        fighter.meter = 0;
        expect(tryStartMove(state, fighter, command).ok).toBe(false);
        expect(fighter.activeMove).toBeNull();

        fighter.meter = 25;
        expect(tryStartMove(state, fighter, command).ok).toBe(true);
        expect(fighter.meter).toBe(0);
        expect(fighter.moveCooldowns[move.id]).toBe(move.cooldownTicks);

        for (let i = 0; i <= move.startupTicks; i++) stepBattle(state, actions(), actions());

        expect(state.temporaryCellCount).toBeGreaterThan(0);
        expect(state.temporaryCellCount).toBeLessThanOrEqual(700);
      });
    }
  }

  it('uses boosted discount and changes only the declared size stat for Water Lash', () => {
    const normal = createBattleState('water');
    const boosted = createBattleState('water');
    normal.fighters.p1.meter = 25;
    boosted.fighters.p1.meter = 15;
    boosted.fighters.p1.boosted = true;

    expect(tryStartMove(normal, normal.fighters.p1, 'special1').ok).toBe(true);
    expect(tryStartMove(boosted, boosted.fighters.p1, 'special1').ok).toBe(true);

    const startup = FIGHTER_SPECS.water.moves.find((move) => move.command === 'special1')!.startupTicks;
    for (let i = 0; i <= startup; i++) {
      stepBattle(normal, actions(), actions());
      stepBattle(boosted, actions(), actions());
    }

    expect(normal.fighters.p1.meter).toBeLessThan(1);
    expect(boosted.fighters.p1.meter).toBeLessThan(1);
    expect(boosted.temporaryCellCount).toBeGreaterThan(normal.temporaryCellCount);
  });
});

describe('operations hardening contracts', () => {
  it('tracks dirty cells on spawn, expiry, clearing, and consumption', () => {
    const state = createBattleState('water');
    consumeDirtyMaterialIndices(state);
    setTemporaryRect(state, 'p1', 10, 10, 2, 2, MaterialType.Water, 1);
    expect(consumeDirtyMaterialIndices(state).sort((a, b) => a - b)).toEqual([
      gridIndex(10, 10),
      gridIndex(11, 10),
      gridIndex(10, 11),
      gridIndex(11, 11),
    ].sort((a, b) => a - b));

    state.tick = 1;
    tickMaterialLifetimes(state);
    expect(state.temporaryCellCount).toBe(0);
    expect(consumeDirtyMaterialIndices(state).length).toBe(4);

    setTemporaryRect(state, 'p1', 20, 20, 1, 1, MaterialType.Fire, 10);
    consumeDirtyMaterialIndices(state);
    clearRectAroundWorldPoint(state, 20 * 8, 20 * 8, 1, 1);
    expect(consumeDirtyMaterialIndices(state)).toEqual([gridIndex(20, 20)]);
  });

  it('caps temporary cells and advances cleanup with a head pointer', () => {
    const state = createBattleState('earth');
    consumeDirtyMaterialIndices(state);
    setTemporaryRect(state, 'p1', 0, 0, 40, 25, MaterialType.Fire, 1);

    expect(state.temporaryCellCount).toBeLessThanOrEqual(700);
    expect(state.temporaryCellHead).toBeGreaterThan(0);
    expect(consumeDirtyMaterialIndices(state).length).toBeGreaterThan(700);

    state.tick = 1;
    tickMaterialLifetimes(state);
    expect(state.temporaryCellCount).toBe(0);
    expect(state.temporaryCells.length - state.temporaryCellHead).toBeLessThanOrEqual(state.temporaryCells.length);
  });

  it('round-trips packed actions and replays a match deterministically', () => {
    const script = [
      actions({ right: true }),
      actions({ right: true, special1: true }),
      actions({ up: true }),
      actions({ basic: true }),
      actions({ left: true, block: true }),
    ];
    expect(unpackActions(packActions(script[1]))).toEqual(script[1]);

    const manual = createBattleState('fire', 9876, { matchId: 'replay-test' });
    const log: ReplayLog = {
      schemaVersion: manual.schemaVersion,
      matchId: manual.matchId,
      selectedFighter: 'fire' as const,
      seed: manual.initialSeed,
      frames: [],
    };

    for (let i = 0; i < 180; i++) {
      appendReplayFrame(log, manual.tick, script[i % script.length]);
      stepBattle(manual, script[i % script.length]);
    }

    const replayed = replayBattle(log);
    expect(replayed).not.toBeNull();
    expect(snapshot(replayed!)).toEqual(snapshot(manual));
  });

  it('reports explicit move denial reasons', () => {
    const noMeter = createBattleState('water');
    noMeter.fighters.p1.meter = 0;
    expect(tryStartMove(noMeter, noMeter.fighters.p1, 'special1').deniedReason).toBe('meter');

    const cooldown = createBattleState('water');
    expect(tryStartMove(cooldown, cooldown.fighters.p1, 'basic').ok).toBe(true);
    cooldown.fighters.p1.activeMove = null;
    expect(tryStartMove(cooldown, cooldown.fighters.p1, 'basic').deniedReason).toBe('cooldown');

    const active = createBattleState('earth');
    expect(tryStartMove(active, active.fighters.p1, 'basic').ok).toBe(true);
    expect(tryStartMove(active, active.fighters.p1, 'special1').deniedReason).toBe('active-move');

    const hitstun = createBattleState('fire');
    hitstun.fighters.p1.hitstunTicks = 5;
    expect(tryStartMove(hitstun, hitstun.fighters.p1, 'basic').deniedReason).toBe('hitstun');

    const finished = createBattleState('fire');
    finished.matchPhase = 'finished';
    expect(tryStartMove(finished, finished.fighters.p1, 'basic').deniedReason).toBe('finished');
  });

  it('records combat impact telemetry for fighter-owned hits only', () => {
    const hazardOnly = createBattleState('water');
    const hazardCpu = hazardOnly.fighters.cpu;
    const hx = Math.floor(hazardCpu.x / 8);
    const hy = Math.floor(hazardCpu.y / 8);
    setTemporaryRect(hazardOnly, 'p1', hx - 1, hy - 2, 3, 3, MaterialType.Lava, 120);
    stepBattle(hazardOnly, actions(), actions());
    expect(hazardOnly.runtimeStats.combatImpactSeq).toBe(0);
    expect(hazardOnly.runtimeStats.lastCombatImpact).toBeNull();

    const combat = createBattleState('earth');
    const p1 = combat.fighters.p1;
    const cpu = combat.fighters.cpu;
    cpu.x = p1.x + 48;
    cpu.y = p1.y;
    p1.meter = 0;
    expect(tryStartMove(combat, p1, 'basic').ok).toBe(true);

    for (let i = 0; i < 8; i++) stepBattle(combat, actions(), actions());

    expect(combat.runtimeStats.combatImpactSeq).toBeGreaterThan(0);
    expect(combat.runtimeStats.lastCombatImpact).toMatchObject({
      sourceId: 'p1',
      targetId: 'cpu',
      blocked: false,
    });
  });

  it('flags blocked combat impacts in runtime telemetry', () => {
    const state = createBattleState('earth');
    const p1 = state.fighters.p1;
    const cpu = state.fighters.cpu;
    cpu.x = p1.x + 48;
    cpu.y = p1.y;
    cpu.blockTicks = 14;
    p1.meter = 0;
    expect(tryStartMove(state, p1, 'basic').ok).toBe(true);

    for (let i = 0; i < 8; i++) stepBattle(state, actions(), actions());

    expect(state.runtimeStats.lastCombatImpact?.blocked).toBe(true);
    expect(state.runtimeStats.lastCombatImpact?.damage).toBeLessThan(5);
  });
});

describe('cpu contracts', () => {
  it('uses the same meter gate when CPU special input is forced', () => {
    const state = createBattleState('water');
    state.fighters.cpu.meter = 0;

    stepBattle(state, actions(), actions({ special1: true }));

    expect(state.fighters.cpu.activeMove).toBeNull();
    expect(state.temporaryCellCount).toBe(0);
  });

  it('tries to recover when terrain-blocked for more than 90 ticks', () => {
    const state = createBattleState('water');
    const cpu = state.fighters.cpu;
    cpu.blockedTicks = 91;
    cpu.onGround = true;

    stepBattle(state, actions());

    expect(Math.abs(cpu.vx)).toBeGreaterThan(0);
  });

  it('scripted terrain can change a fight outcome by blocking movement', () => {
    const state = createBattleState('earth');
    const cpu = state.fighters.cpu;
    const before = cpu.x;
    const cx = Math.floor(cpu.x / 8) - 2;
    const cy = Math.floor(cpu.y / 8) - 4;
    setTemporaryRect(state, 'p1', cx, cy, 3, 8, MaterialType.Stone, 300);

    for (let i = 0; i < 20; i++) stepBattle(state, actions({ left: true }), actions({ left: true }));

    expect(cpu.x).toBeGreaterThanOrEqual(before - 16);
    expect(cpu.blockedTicks).toBeGreaterThan(0);
  });

  it('retreats and jumps when standing in hazard materials', () => {
    const state = createBattleState('water');
    const cpu = state.fighters.cpu;
    const cx = Math.floor(cpu.x / 8);
    const cy = Math.floor(cpu.y / 8);
    cpu.onGround = true;
    setTemporaryRect(state, 'p1', cx - 1, cy - 2, 3, 3, MaterialType.Lava, 120);

    stepBattle(state, actions());

    expect(cpu.vx).toBeGreaterThan(0);
    expect(cpu.vy).toBeLessThan(0);
    expect(state.runtimeStats.lastCpuDecision?.mode).toBe('hazard-escape');
    expect(state.runtimeStats.lastCpuDecision?.reason).toContain('lava');
  });

  it('steers toward a nearby boost-rich lane when under-metered', () => {
    const state = createBattleState('earth');
    const cpu = state.fighters.cpu;
    const cx = Math.floor(cpu.x / 8);
    const cy = Math.floor(cpu.y / 8);
    cpu.meter = 5;
    setTemporaryRect(state, 'p1', cx + 8, cy - 3, 8, 6, MaterialType.Smoke, 180);

    stepBattle(state, actions());

    expect(cpu.vx).toBeGreaterThan(0);
    expect(state.runtimeStats.lastCpuDecision?.mode).toBe('boost-lane');
    expect(state.runtimeStats.lastCpuDecision?.laneChoice).toBe('right');
    expect(state.runtimeStats.lastCpuDecision?.rightLane?.boostCells ?? 0).toBeGreaterThan(0);
  });

  it('avoids boost lanes that will quench into stone choke points', () => {
    const state = createBattleState('earth');
    const cpu = state.fighters.cpu;
    const cx = Math.floor(cpu.x / 8);
    const cy = Math.floor(cpu.y / 8);
    cpu.meter = 5;

    setTemporaryRect(state, 'p1', cx - 12, cy - 3, 5, 6, MaterialType.Smoke, 180);
    setTemporaryRect(state, 'p1', cx + 8, cy - 3, 8, 6, MaterialType.Smoke, 180);
    setTemporaryRect(state, 'p1', cx + 8, cy - 1, 5, 3, MaterialType.Water, 180);
    setTemporaryRect(state, 'p1', cx + 13, cy - 1, 5, 3, MaterialType.Lava, 180);

    stepBattle(state, actions());

    expect(cpu.vx).toBeLessThan(0);
    expect(state.runtimeStats.lastCpuDecision?.laneChoice).toBe('left');
    expect(state.runtimeStats.lastCpuDecision?.rightLane?.quenchRiskCells ?? 0).toBeGreaterThan(0);
  });

  it('gives fire more forward pressure than water at the same mid-range gap', () => {
    const waterCpuState = createBattleState('fire');
    const waterCpu = waterCpuState.fighters.cpu;
    const waterPlayer = waterCpuState.fighters.p1;
    waterCpu.meter = 14;
    waterCpu.boosted = true;
    waterCpu.onGround = true;
    waterPlayer.x = waterCpu.x - 180;
    waterPlayer.y = waterCpu.y;

    stepBattle(waterCpuState, actions());

    expect(Math.abs(waterCpu.vx)).toBeLessThan(0.1);
    expect(waterCpuState.runtimeStats.lastCpuDecision?.mode).toBe('neutral');

    const fireCpuState = createBattleState('earth');
    const fireCpu = fireCpuState.fighters.cpu;
    const firePlayer = fireCpuState.fighters.p1;
    fireCpu.meter = 14;
    fireCpu.boosted = true;
    fireCpu.onGround = true;
    firePlayer.x = fireCpu.x - 180;
    firePlayer.y = fireCpu.y;

    stepBattle(fireCpuState, actions());

    expect(fireCpu.vx).toBeLessThan(-1);
    expect(fireCpuState.runtimeStats.lastCpuDecision?.mode).toBe('approach');
    expect(fireCpuState.runtimeStats.lastCpuDecision?.reason).toContain('fire rushdown');
  });

  it('makes earth hold wider spacing than fire when close with vertical mismatch', () => {
    const earthCpuState = createBattleState('water');
    const earthCpu = earthCpuState.fighters.cpu;
    const earthPlayer = earthCpuState.fighters.p1;
    earthCpu.meter = 14;
    earthCpu.boosted = true;
    earthCpu.onGround = true;
    earthPlayer.x = earthCpu.x - 48;
    earthPlayer.y = earthCpu.y + 100;

    stepBattle(earthCpuState, actions());

    expect(earthCpu.vx).toBeGreaterThan(0.8);
    expect(earthCpuState.runtimeStats.lastCpuDecision?.mode).toBe('space');
    expect(earthCpuState.runtimeStats.lastCpuDecision?.reason).toContain('earth reset');

    const fireCpuState = createBattleState('earth');
    const fireCpu = fireCpuState.fighters.cpu;
    const firePlayer = fireCpuState.fighters.p1;
    fireCpu.meter = 14;
    fireCpu.boosted = true;
    fireCpu.onGround = true;
    firePlayer.x = fireCpu.x - 48;
    firePlayer.y = fireCpu.y + 100;

    stepBattle(fireCpuState, actions());

    expect(Math.abs(fireCpu.vx)).toBeLessThan(0.1);
    expect(fireCpuState.runtimeStats.lastCpuDecision?.mode).toBe('neutral');
  });

  it('uses water anti-air special when the player is airborne above', () => {
    const state = createBattleState('fire');
    const cpu = state.fighters.cpu;
    const p1 = state.fighters.p1;
    cpu.meter = 60;
    p1.x = cpu.x - 130;
    p1.y = cpu.y - 90;

    stepBattle(state, actions());

    expect(cpu.activeMove?.moveId).toBe('water-steam-burst');
    expect(state.runtimeStats.lastCpuDecision?.reason).toContain('water anti-air');
  });

  it('uses earth anti-air wall rise when the player is above', () => {
    const state = createBattleState('water');
    const cpu = state.fighters.cpu;
    const p1 = state.fighters.p1;
    cpu.meter = 60;
    p1.x = cpu.x - 130;
    p1.y = cpu.y - 80;

    stepBattle(state, actions());

    expect(cpu.activeMove?.moveId).toBe('earth-wall-rise');
    expect(state.runtimeStats.lastCpuDecision?.reason).toContain('earth anti-air');
  });

  it('uses fire blast dash in close grounded pressure windows', () => {
    const state = createBattleState('earth');
    const cpu = state.fighters.cpu;
    const p1 = state.fighters.p1;
    cpu.meter = 60;
    cpu.onGround = true;
    p1.x = cpu.x - 92;
    p1.y = cpu.y;

    stepBattle(state, actions());

    expect(cpu.activeMove?.moveId).toBe('fire-blast-dash');
    expect(state.runtimeStats.lastCpuDecision?.reason).toContain('fire burst dash');
  });

  it('does not throw non-boosted specials when meter only covers boosted cost', () => {
    const state = createBattleState('fire');
    const cpu = state.fighters.cpu;
    const p1 = state.fighters.p1;
    cpu.boosted = false;
    cpu.meter = 20;
    p1.x = cpu.x - 140;
    p1.y = cpu.y;

    stepBattle(state, actions());

    expect(cpu.activeMove).toBeNull();
    expect(state.runtimeStats.lastCpuDecision?.reason).toContain('specials unavailable');
  });

  it('allows boosted CPU specials when meter meets the discounted cost', () => {
    const state = createBattleState('fire');
    const cpu = state.fighters.cpu;
    const p1 = state.fighters.p1;
    cpu.meter = 20;
    const cx = Math.floor(cpu.x / 8);
    const cy = Math.floor(cpu.y / 8);
    setTemporaryRect(state, 'p1', cx - 2, cy - 1, 4, 3, MaterialType.Water, 120);
    p1.x = cpu.x - 140;
    p1.y = cpu.y;

    stepBattle(state, actions());

    expect(cpu.activeMove?.moveId).toBe('water-lash');
    expect(state.runtimeStats.lastCpuDecision?.mode).toBe('engage-special');
  });

  it('falls back to an available special when the preferred one is on cooldown', () => {
    const state = createBattleState('fire');
    const cpu = state.fighters.cpu;
    const p1 = state.fighters.p1;
    cpu.meter = 60;
    const cx = Math.floor(cpu.x / 8);
    const cy = Math.floor(cpu.y / 8);
    setTemporaryRect(state, 'p1', cx - 2, cy - 1, 4, 3, MaterialType.Water, 120);
    cpu.moveCooldowns['water-steam-burst'] = 20;
    p1.x = cpu.x - 130;
    p1.y = cpu.y - 90;

    stepBattle(state, actions());

    expect(cpu.activeMove?.moveId).toBe('water-lash');
    expect(state.runtimeStats.lastCpuDecision?.mode).toBe('engage-special');
    expect(state.runtimeStats.lastCpuDecision?.reason).not.toContain('anti-air');
  });
});
