import type { BattleState, MoveDenialReason, OperationalEvent, RuntimeStats } from './simulation/types';

const OPS_PREFIX = '[ElementFighter]';

declare global {
  interface Window {
    __elementFighterOps?: OperationalEvent[];
  }
}

export function createRuntimeStats(): RuntimeStats {
  return {
    lastFrameMs: 0,
    simStepsLastFrame: 0,
    catchupClamps: 0,
    dirtyCellsLastFrame: 0,
    temporaryCellsLength: 0,
    temporaryCellCount: 0,
    activeHitboxCount: 0,
    moveDenials: {},
    lastMoveDenial: null,
    combatImpactSeq: 0,
    lastCombatImpact: null,
    lastCpuDecision: null,
  };
}

export function noteMoveDenial(
  state: BattleState,
  reason: MoveDenialReason,
  moveId: string,
  cost = 0,
  boosted = false,
): void {
  state.runtimeStats.moveDenials[reason] = (state.runtimeStats.moveDenials[reason] ?? 0) + 1;
  state.runtimeStats.lastMoveDenial = {
    ok: false,
    moveId,
    boosted,
    cost,
    deniedReason: reason,
  };
}

export function syncRuntimeStats(
  state: BattleState,
  frame: { frameMs?: number; simSteps?: number; dirtyCells?: number } = {},
): void {
  if (frame.frameMs !== undefined) state.runtimeStats.lastFrameMs = frame.frameMs;
  if (frame.simSteps !== undefined) state.runtimeStats.simStepsLastFrame = frame.simSteps;
  if (frame.dirtyCells !== undefined) state.runtimeStats.dirtyCellsLastFrame = frame.dirtyCells;
  state.runtimeStats.temporaryCellsLength = Math.max(0, state.temporaryCells.length - state.temporaryCellHead);
  state.runtimeStats.temporaryCellCount = state.temporaryCellCount;
  state.runtimeStats.activeHitboxCount = state.activeHitboxes.length;
}

export function recordOpsEvent(event: OperationalEvent): void {
  if (typeof window !== 'undefined') {
    window.__elementFighterOps = window.__elementFighterOps ?? [];
    window.__elementFighterOps.push(event);
    if (window.__elementFighterOps.length > 200) window.__elementFighterOps.shift();
  }
  const details = event.details ? ` ${JSON.stringify(event.details)}` : '';
  console.info(`${OPS_PREFIX} ${event.type}: ${event.message}${details}`);
}

export function installGlobalOpsHandlers(getState: () => BattleState | null): void {
  if (typeof window === 'undefined') return;
  window.onerror = (_message, _source, _line, _column, error) => {
    recordOpsEvent({
      ...stateContext(getState()),
      type: 'window-error',
      message: error instanceof Error ? error.message : String(_message),
      details: error instanceof Error ? { stack: error.stack } : undefined,
    });
  };
  window.onunhandledrejection = (event) => {
    const reason = event.reason;
    recordOpsEvent({
      ...stateContext(getState()),
      type: 'unhandled-rejection',
      message: reason instanceof Error ? reason.message : String(reason),
      details: reason instanceof Error ? { stack: reason.stack } : undefined,
    });
  };
}

function stateContext(state: BattleState | null): Pick<OperationalEvent, 'matchId' | 'tick' | 'details'> {
  if (!state) return {};
  return {
    matchId: state.matchId,
    tick: state.tick,
    details: {
      phase: state.matchPhase,
      p1: state.fighters.p1.specId,
      cpu: state.fighters.cpu.specId,
      lastEvent: state.eventLog[state.eventLog.length - 1]?.message,
    },
  };
}
