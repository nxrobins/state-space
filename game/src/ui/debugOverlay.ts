import type { BattleState } from '../game/simulation/types';

export function setDebugOverlayVisible(visible: boolean): void {
  const overlay = document.getElementById('debug-overlay');
  if (!overlay) return;
  overlay.hidden = !visible;
}

export function updateDebugOverlay(state: BattleState, visible: boolean): void {
  if (!visible) return;
  const overlay = document.getElementById('debug-overlay');
  if (!overlay) return;
  const stats = state.runtimeStats;
  const cpuDecision = stats.lastCpuDecision;
  const cpuLine = cpuDecision
    ? `cpu ${cpuDecision.mode} (${cpuDecision.reason}) lane ${cpuDecision.laneChoice} d${cpuDecision.laneDelta}`
    : 'cpu decision none';
  const laneLine = cpuDecision?.leftLane && cpuDecision.rightLane
    ? `lanes L:${formatLane(cpuDecision.leftLane)} | R:${formatLane(cpuDecision.rightLane)}`
    : 'lanes n/a';
  overlay.textContent = [
    `match ${state.matchId}`,
    `seed ${state.initialSeed} tick ${state.tick} phase ${state.matchPhase}`,
    `frame ${stats.lastFrameMs.toFixed(1)}ms steps ${stats.simStepsLastFrame} clamps ${stats.catchupClamps}`,
    `dirty ${stats.dirtyCellsLastFrame} temp ${stats.temporaryCellCount}/${stats.temporaryCellsLength} hitboxes ${stats.activeHitboxCount}`,
    `denials ${JSON.stringify(stats.moveDenials)}`,
    cpuLine,
    laneLine,
    `last ${state.eventLog[state.eventLog.length - 1]?.message ?? 'none'}`,
  ].join('\n');
}

function formatLane(lane: NonNullable<BattleState['runtimeStats']['lastCpuDecision']>['leftLane']): string {
  if (!lane) return 'n/a';
  return `s${lane.score} b${lane.boostCells} f${lane.fireCells} l${lane.lavaCells} t${lane.tempStoneCells} q${lane.quenchRiskCells}`;
}
