/** Explicit interventions between M5 ticks; never reseed or step material. */
import { MAT, PHASE, PHASE_SHIFT } from '../generated/materials.js';
import {
  validateStructuralSnapshot3D,
  validateStructuralState3D,
  type StructuralSnapshot3D,
} from './structural-world-core.js';
import {
  ANCHOR_3D,
  BONDS_3D,
  structuralEligible,
  structuralNeighbor,
} from './structural-mechanics.js';

export const INTERVENTION_RULES_VERSION_3D = 'material-interventions-1';
export const TRANSLATION_LIMITS_3D = Object.freeze({ cells: 65536, path: 384, cellSteps: 262144 });
export type CellCoordinate3D = readonly [number, number, number];
export type TranslationRequest3D = {
  cells: readonly CellCoordinate3D[];
  /** Cardinal unit steps, evaluated in order without advancing simulation time. */
  path: readonly CellCoordinate3D[];
  externalBonds?: 'reject' | 'cut';
  anchors?: 'reject' | 'release';
  displacement?: 'air' | 'mobile';
};
export type TranslationReceipt3D = {
  rulesVersion: typeof INTERVENTION_RULES_VERSION_3D;
  tick: number;
  externalEnergyQ: bigint;
  /** Paired canonical global indices, in ascending original-source order. */
  sources: Uint32Array;
  destinations: Uint32Array;
  path: CellCoordinate3D[];
  /** Canonical endpoint pairs in the original coordinate system. */
  cutBonds: [number, number][];
  releasedAnchors: Uint32Array;
  /** Exact edit differences, not a prediction of subsequent support changes. */
  editedCells: Uint32Array;
};
export type TranslationResult3D = { snapshot: StructuralSnapshot3D; receipt: TranslationReceipt3D };

function coordinate(value: readonly number[]): CellCoordinate3D {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !Number.isSafeInteger(value[0]) ||
    !Number.isSafeInteger(value[1]) ||
    !Number.isSafeInteger(value[2])
  ) {
    throw Error('Expected three integer coordinates.');
  }
  return [value[0], value[1], value[2]];
}

/**
 * Translate selected existing matter through a fully checked path. Every step
 * rotates each selected run with its terminal occupant, conserving all matter
 * and energy even when source and destination overlap. Internal bonds translate;
 * boundary bonds/pins require explicit policies. Contact never seeds fresh bonds.
 * The caller owns the returned snapshot and must commit it transactionally with
 * game state. Restoring it into an M5 field establishes that field's new baseline.
 */
export function translateStructuralRegion3D(
  snapshot: StructuralSnapshot3D,
  request: TranslationRequest3D,
): TranslationResult3D {
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    Object.keys(request).some(
      (k) => !['cells', 'path', 'externalBonds', 'anchors', 'displacement'].includes(k),
    ) ||
    !Object.hasOwn(request, 'cells') ||
    !Object.hasOwn(request, 'path')
  ) {
    throw Error('Invalid translation request.');
  }
  if (
    !Array.isArray(request.cells) ||
    !request.cells.length ||
    request.cells.length > TRANSLATION_LIMITS_3D.cells ||
    !Array.isArray(request.path) ||
    !request.path.length ||
    request.path.length > TRANSLATION_LIMITS_3D.path ||
    request.cells.length * (request.path.length + 1) > TRANSLATION_LIMITS_3D.cellSteps
  ) {
    throw Error('Translation exceeds the bounded cell/path budget.');
  }
  const externalBonds = request.externalBonds === undefined ? 'reject' : request.externalBonds;
  const anchors = request.anchors === undefined ? 'reject' : request.anchors;
  const displacement = request.displacement === undefined ? 'air' : request.displacement;
  if (
    !['reject', 'cut'].includes(externalBonds) ||
    !['reject', 'release'].includes(anchors) ||
    !['air', 'mobile'].includes(displacement)
  )
    throw Error('Invalid translation policy.');

  const path: CellCoordinate3D[] = [],
    directions: number[] = [];
  // Explicit indexing rejects sparse arrays; Array.map would skip their holes.
  for (let k = 0; k < request.path.length; k++) {
    const step = coordinate(request.path[k]);
    if (step.reduce((sum, n) => sum + Math.abs(n), 0) !== 1)
      throw Error('Path steps must be cardinal unit vectors.');
    path.push(step);
    const axis = step.findIndex((n) => n !== 0);
    directions.push(axis * 2 + Number(step[axis] > 0));
  }
  const state = validateStructuralSnapshot3D(snapshot);
  const shape = [snapshot.width, snapshot.height, snapshot.depth];
  let selected: number[] = [];
  for (let k = 0; k < request.cells.length; k++) {
    const c = coordinate(request.cells[k]);
    if (c.some((n, axis) => n < 0 || n >= shape[axis]))
      throw Error('Selected cell is outside the world.');
    const i = c[0] + snapshot.width * (c[1] + snapshot.height * c[2]);
    if ((state.grid[i] & 255) === MAT.AIR) throw Error('Select existing matter, not air.');
    selected.push(i);
  }
  selected.sort((a, b) => a - b);
  if (selected.some((i, k) => k > 0 && i === selected[k - 1]))
    throw Error('Duplicate selected cell.');
  const sources = Uint32Array.from(selected),
    members = new Set(selected);
  const cutBonds: [number, number][] = [],
    releasedAnchors: number[] = [];
  for (const i of selected) {
    if (state.structure[i] & ANCHOR_3D) {
      if (anchors === 'reject')
        throw Error('Explicitly release selected anchors before translation.');
      state.structure[i] &= ~ANCHOR_3D;
      releasedAnchors.push(i);
    }
    for (let direction = 0; direction < 6; direction++) {
      if (!(state.structure[i] & BONDS_3D[direction])) continue;
      const j = structuralNeighbor(i, direction, snapshot);
      if (members.has(j)) continue;
      if (externalBonds === 'reject')
        throw Error('Explicitly cut external bonds before translation.');
      state.structure[i] &= ~BONDS_3D[direction];
      state.structure[j] &= ~BONDS_3D[direction ^ 1];
      cutBonds.push([Math.min(i, j), Math.max(i, j)]);
    }
  }
  cutBonds.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const canDisplace = (i: number) => {
    if (state.structure[i] !== 0) return false;
    if ((state.grid[i] & 255) === MAT.AIR) return true;
    if (displacement === 'air') return false;
    const phase = (state.grid[i] >>> PHASE_SHIFT) & 15;
    return (
      phase === PHASE.GAS ||
      phase === PHASE.POWDER ||
      phase === PHASE.LIQUID ||
      phase === PHASE.VISCOUS ||
      phase === PHASE.MOLTEN ||
      structuralEligible(state.grid[i])
    );
  };
  const carried = new Uint32Array(selected.length * 3);
  for (const direction of directions) {
    members.clear();
    selected.forEach((i) => members.add(i));
    const destinations = selected.map((i) => structuralNeighbor(i, direction, snapshot));
    for (const j of destinations) {
      if (j < 0) throw Error('Translation path crosses a closed boundary.');
      if (!members.has(j) && !canDisplace(j)) throw Error('Translation path is obstructed.');
    }
    // Capture immutable input for this pass before writing any destination.
    for (let k = 0; k < selected.length; k++) {
      const i = selected[k];
      carried.set([state.grid[i], state.energyQ[i], state.structure[i]], k * 3);
    }
    const displaced: { head: number; grid: number; energyQ: number; structure: number }[] = [];
    for (const head of selected) {
      if (members.has(structuralNeighbor(head, direction ^ 1, snapshot))) continue;
      let terminal = structuralNeighbor(head, direction, snapshot);
      while (members.has(terminal)) terminal = structuralNeighbor(terminal, direction, snapshot);
      // Every target was checked above, including each terminal occupant.
      displaced.push({
        head,
        grid: state.grid[terminal],
        energyQ: state.energyQ[terminal],
        structure: state.structure[terminal],
      });
    }
    for (let k = 0; k < destinations.length; k++) {
      const i = destinations[k];
      state.grid[i] = carried[k * 3];
      state.energyQ[i] = carried[k * 3 + 1];
      state.structure[i] = carried[k * 3 + 2];
    }
    for (const cell of displaced) {
      state.grid[cell.head] = cell.grid;
      state.energyQ[cell.head] = cell.energyQ;
      state.structure[cell.head] = cell.structure;
    }
    selected = destinations;
  }
  // Validation asserts reciprocity; it must never normalize away a bad transfer.
  validateStructuralState3D(state.grid, state.energyQ, state.structure, snapshot);
  const edited: number[] = [];
  for (let i = 0; i < state.grid.length; i++) {
    if (
      state.grid[i] !== snapshot.packedCells[i] ||
      state.energyQ[i] !== snapshot.energyQ[i] ||
      state.structure[i] !== snapshot.structure[i]
    )
      edited.push(i);
  }
  return {
    snapshot: {
      ...snapshot,
      packedCells: Array.from(state.grid),
      energyQ: Array.from(state.energyQ),
      structure: Array.from(state.structure),
    },
    receipt: {
      rulesVersion: INTERVENTION_RULES_VERSION_3D,
      tick: snapshot.tick,
      externalEnergyQ: 0n,
      sources,
      destinations: Uint32Array.from(selected),
      path,
      cutBonds,
      releasedAnchors: Uint32Array.from(releasedAnchors),
      editedCells: Uint32Array.from(edited),
    },
  };
}
