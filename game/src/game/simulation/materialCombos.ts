import { GRID_WIDTH, MaterialType } from './constants';
import { gridIndex, inGrid, markDirty, refreshTemporaryCellLifetime } from './grid';
import type { BattleState, MaterialCell, MaterialCellProvenance, MaterialComboOutput, MaterialComboRule } from './types';

const ORTHOGONAL_PAIR_OFFSETS = [
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
] as const;

const MAX_COMBO_EVENTS_PER_TICK = 6;
const GAS_REFRESH_MAX_AGE_TICKS = 180;
const TEMPORARY_ONLY = ['temporary'] as const;

export const MATERIAL_COMBO_RULES: readonly MaterialComboRule[] = [
  {
    id: 'sand-heat-glass',
    inputs: [[MaterialType.Sand], [MaterialType.Fire, MaterialType.Lava]],
    outputs: [MaterialType.Glass, 'preserve'],
    priority: 10,
    adjacency: 'orthogonal',
    allowedProvenance: TEMPORARY_ONLY,
    eventMessage: 'Sand vitrified',
  },
  {
    id: 'water-lava-quench',
    inputs: [[MaterialType.Water], [MaterialType.Lava]],
    outputs: [MaterialType.Steam, MaterialType.Stone],
    priority: 20,
    adjacency: 'orthogonal',
    allowedProvenance: TEMPORARY_ONLY,
    eventMessage: 'Lava quenched',
  },
  {
    id: 'water-fire-steam',
    inputs: [[MaterialType.Water], [MaterialType.Fire]],
    outputs: [MaterialType.Steam, MaterialType.Steam],
    priority: 20,
    adjacency: 'orthogonal',
    allowedProvenance: TEMPORARY_ONLY,
    eventMessage: 'Steam burst formed',
  },
  {
    id: 'ice-heat-melt',
    inputs: [[MaterialType.Ice], [MaterialType.Fire, MaterialType.Lava]],
    outputs: [MaterialType.Water, 'preserve'],
    priority: 30,
    adjacency: 'orthogonal',
    allowedProvenance: TEMPORARY_ONLY,
    eventMessage: 'Ice melted',
  },
  {
    id: 'gas-heat-refresh',
    inputs: [[MaterialType.Steam, MaterialType.Smoke], [MaterialType.Fire, MaterialType.Lava]],
    outputs: ['refresh', 'preserve'],
    priority: 40,
    adjacency: 'orthogonal',
    allowedProvenance: TEMPORARY_ONLY,
    maxRefreshTicks: GAS_REFRESH_MAX_AGE_TICKS,
    eventMessage: 'Heat fed a hazard cloud',
  },
] as const;

interface ComboCandidate {
  rule: MaterialComboRule;
  indexes: readonly [number, number];
  sortIndex: number;
  secondarySortIndex: number;
}

export function resolveMaterialCombos(state: BattleState): void {
  const candidates = gatherComboCandidates(state);
  candidates.sort(compareComboCandidates);

  const usedCellIndices = new Set<number>();
  const emittedRuleIds = new Set<string>();
  let emittedEvents = 0;

  for (const candidate of candidates) {
    const [firstIndex, secondIndex] = candidate.indexes;
    if (usedCellIndices.has(firstIndex) || usedCellIndices.has(secondIndex)) continue;
    if (!candidateStillMatches(state, candidate)) continue;

    const changed = applyComboCandidate(state, candidate);
    if (!changed) continue;

    usedCellIndices.add(firstIndex);
    usedCellIndices.add(secondIndex);
    if (
      candidate.rule.eventMessage &&
      !emittedRuleIds.has(candidate.rule.id) &&
      emittedEvents < MAX_COMBO_EVENTS_PER_TICK
    ) {
      pushComboEvent(state, candidate.rule.eventMessage);
      emittedRuleIds.add(candidate.rule.id);
      emittedEvents++;
    }
  }
}

function gatherComboCandidates(state: BattleState): ComboCandidate[] {
  const candidates: ComboCandidate[] = [];
  const visitedActiveIndices = new Set<number>();

  for (let i = state.temporaryCellHead; i < state.temporaryCells.length; i++) {
    const ref = state.temporaryCells[i];
    if (visitedActiveIndices.has(ref.index)) continue;

    const cell = state.materialGrid[ref.index];
    if (cell.expiresAtTick !== ref.expiresAtTick) continue;
    if (!isComboEligibleCell(cell, TEMPORARY_ONLY)) continue;
    visitedActiveIndices.add(ref.index);

    const x = ref.index % GRID_WIDTH;
    const y = Math.floor(ref.index / GRID_WIDTH);
    for (const offset of ORTHOGONAL_PAIR_OFFSETS) {
      const nx = x + offset.dx;
      const ny = y + offset.dy;
      if (!inGrid(nx, ny)) continue;
      const neighborIndex = gridIndex(nx, ny);
      const neighbor = state.materialGrid[neighborIndex];
      if (!isComboEligibleCell(neighbor, TEMPORARY_ONLY)) continue;

      for (const rule of MATERIAL_COMBO_RULES) {
        const indexes = matchRuleIndexes(rule, cell, ref.index, neighbor, neighborIndex);
        if (!indexes) continue;
        candidates.push({
          rule,
          indexes,
          sortIndex: Math.min(indexes[0], indexes[1]),
          secondarySortIndex: Math.max(indexes[0], indexes[1]),
        });
      }
    }
  }

  return candidates;
}

function matchRuleIndexes(
  rule: MaterialComboRule,
  firstCell: MaterialCell,
  firstIndex: number,
  secondCell: MaterialCell,
  secondIndex: number,
): readonly [number, number] | null {
  if (!isComboEligibleCell(firstCell, rule.allowedProvenance) || !isComboEligibleCell(secondCell, rule.allowedProvenance)) {
    return null;
  }
  if (rule.inputs[0].includes(firstCell.material) && rule.inputs[1].includes(secondCell.material)) {
    return [firstIndex, secondIndex];
  }
  if (rule.inputs[0].includes(secondCell.material) && rule.inputs[1].includes(firstCell.material)) {
    return [secondIndex, firstIndex];
  }
  return null;
}

function candidateStillMatches(state: BattleState, candidate: ComboCandidate): boolean {
  const first = state.materialGrid[candidate.indexes[0]];
  const second = state.materialGrid[candidate.indexes[1]];
  return matchRuleIndexes(candidate.rule, first, candidate.indexes[0], second, candidate.indexes[1]) !== null;
}

function applyComboCandidate(state: BattleState, candidate: ComboCandidate): boolean {
  let changed = false;
  for (let slot = 0; slot < candidate.rule.outputs.length; slot++) {
    const output = candidate.rule.outputs[slot];
    const index = candidate.indexes[slot];
    changed = applyComboOutput(state, index, output, candidate.rule) || changed;
  }
  return changed;
}

function applyComboOutput(
  state: BattleState,
  index: number,
  output: MaterialComboOutput,
  rule: MaterialComboRule,
): boolean {
  if (output === 'preserve') return false;
  if (output === 'refresh') {
    return refreshTemporaryCellLifetime(state, index, rule.maxRefreshTicks ?? GAS_REFRESH_MAX_AGE_TICKS);
  }

  const cell = state.materialGrid[index];
  if (cell.material === output) return false;
  state.materialGrid[index] = { ...cell, material: output, provenance: 'temporary' };
  markDirty(state, index);
  return true;
}

function compareComboCandidates(a: ComboCandidate, b: ComboCandidate): number {
  return (
    a.rule.priority - b.rule.priority ||
    a.sortIndex - b.sortIndex ||
    a.secondarySortIndex - b.secondarySortIndex ||
    a.rule.id.localeCompare(b.rule.id)
  );
}

function isComboEligibleCell(
  cell: MaterialCell,
  allowedProvenance: readonly MaterialCellProvenance[],
): boolean {
  if (cell.material === MaterialType.Air || cell.expiresAtTick === null) return false;
  return allowedProvenance.includes(cell.provenance ?? 'temporary');
}

function pushComboEvent(state: BattleState, message: string): void {
  state.eventLog.push({ tick: state.tick, type: 'material-combo', message });
  if (state.eventLog.length > 180) state.eventLog.shift();
}
