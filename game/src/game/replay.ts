import { REPLAY_SCHEMA_VERSION } from './simulation/constants';
import { createBattleState, stepBattle } from './simulation/battle';
import { emptyActions } from './input/actions';
import type { ActionState, BattleState, FighterSpecId, MatchResult, ReplayLog } from './simulation/types';

const ACTION_BITS: Array<keyof ActionState> = [
  'left',
  'right',
  'up',
  'down',
  'dash',
  'block',
  'basic',
  'special1',
  'special2',
  'special3',
];

export function createReplayLog(
  selectedFighter: FighterSpecId,
  seed: number,
  matchId: string,
): ReplayLog {
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    matchId,
    selectedFighter,
    seed,
    frames: [],
  };
}

export function packActions(actions: ActionState): number {
  let packed = 0;
  for (let i = 0; i < ACTION_BITS.length; i++) {
    if (actions[ACTION_BITS[i]]) packed |= 1 << i;
  }
  return packed;
}

export function unpackActions(input: number): ActionState {
  const actions = emptyActions();
  for (let i = 0; i < ACTION_BITS.length; i++) {
    actions[ACTION_BITS[i]] = (input & (1 << i)) !== 0;
  }
  return actions;
}

export function appendReplayFrame(log: ReplayLog, tick: number, actions: ActionState): void {
  log.frames.push({ tick, input: packActions(actions) });
}

export function replayBattle(log: ReplayLog): BattleState | null {
  if (log.schemaVersion !== REPLAY_SCHEMA_VERSION) return null;
  const state = createBattleState(log.selectedFighter, log.seed, { matchId: log.matchId });
  for (const frame of log.frames) {
    if (frame.tick !== state.tick || state.matchPhase === 'finished') break;
    stepBattle(state, unpackActions(frame.input));
  }
  return state;
}

export function completeReplay(log: ReplayLog, result: MatchResult): ReplayLog {
  return { ...log, completedResult: result };
}
