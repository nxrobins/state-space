/** Exact parcel continuity and transaction staging; no material stepping here. */
import { MAT } from '../../generated/materials.js';
import {
  applyMaterialTransport3D,
  readMaterialTransport3D,
  materialTransportCellMovable3D,
  MATERIAL_TRANSPORT_LIMITS_3D,
  type MaterialTransportState3D,
  type MaterialParcel3D,
  type MaterialImpulse3D,
  type MaterialTransportReceipt3D,
} from './material-transport.js';
import { gameplayGeometrySource3D, type GameplayGeometry3D } from './gameplay-geometry.js';
import { tickMovementSource3D, type TickMovement3D } from './path-journal.js';
import { translationMovementSource3D, type TranslationMovement3D } from './translation-paths.js';
import { TACTICAL_SESSION_LIMITS_3D } from '../tactical/tactical-session-core.js';
import type { TacticalPreviewEditor3D } from '../tactical/tactical-previews.js';
import type { TacticalValue } from '../tactical/tactical-session-view.js';
import type { StructuralSnapshot3D } from '../structural/structural-world-core.js';

export const MATERIAL_TRANSPORT_MEMORY_RULES_3D = 'material-transport-memory-1';
type TerrainIdentity = Omit<StructuralSnapshot3D, 'packedCells' | 'energyQ' | 'structure'>;
export type MaterialTransportMemory3D = {
  rulesVersion: typeof MATERIAL_TRANSPORT_MEMORY_RULES_3D;
  transportSchemaVersion: 1;
  transportRulesVersion: 'material-transport-1';
  cycle: number;
  terrain: TerrainIdentity;
  parcels: (MaterialParcel3D & { packed: number; energyQ: number; structure: number })[];
};
const identityKeys = [
  'schemaVersion',
  'rulesVersion',
  'worldVersion',
  'materialCatalogHash',
  'width',
  'height',
  'depth',
  'chunkSize',
  'tick',
] as const;
function fields(raw: unknown, keys: readonly string[]): asserts raw is Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
    Reflect.ownKeys(raw).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(raw, k)) ||
    Object.values(Object.getOwnPropertyDescriptors(raw)).some(
      (d) => !('value' in d) || !d.enumerable,
    )
  )
    throw Error('Invalid material transport memory.');
}

/** Store this compact value inside the same authoritative game/terrain save. */
export function captureMaterialTransportMemory3D(
  raw: MaterialTransportState3D,
): MaterialTransportMemory3D {
  const state = readMaterialTransport3D(raw),
    { packedCells, energyQ, structure, ...terrain } = state.terrain;
  return {
    rulesVersion: MATERIAL_TRANSPORT_MEMORY_RULES_3D,
    transportSchemaVersion: state.schemaVersion,
    transportRulesVersion: state.rulesVersion,
    cycle: state.cycle,
    terrain,
    parcels: state.parcels.map((p) => ({
      ...p,
      packed: packedCells[p.cell],
      energyQ: energyQ[p.cell],
      structure: structure[p.cell],
    })),
  };
}

/** Same-session saved memory, checked against current coordinates before use. */
export function restoreMaterialTransportMemory3D(
  terrain: StructuralSnapshot3D,
  raw: unknown,
): MaterialTransportState3D {
  fields(raw, [
    'rulesVersion',
    'transportSchemaVersion',
    'transportRulesVersion',
    'cycle',
    'terrain',
    'parcels',
  ]);
  if (raw.rulesVersion !== MATERIAL_TRANSPORT_MEMORY_RULES_3D)
    throw Error('Incompatible transport memory.');
  fields(raw.terrain, identityKeys);
  const rows = raw.parcels;
  if (
    !Array.isArray(rows) ||
    rows.length > MATERIAL_TRANSPORT_LIMITS_3D.parcels ||
    Reflect.ownKeys(rows).length !== rows.length + 1
  )
    throw Error('Invalid transport memory parcels.');
  const parcels: MaterialParcel3D[] = [],
    witnesses: { packed: unknown; energyQ: unknown; structure: unknown }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(rows, String(i));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      throw Error('Transport memory needs dense parcel data.');
    const p: unknown = descriptor.value;
    fields(p, ['id', 'cell', 'velocityQ', 'remainderQ', 'packed', 'energyQ', 'structure']);
    parcels.push({
      id: p.id,
      cell: p.cell,
      velocityQ: p.velocityQ,
      remainderQ: p.remainderQ,
    } as MaterialParcel3D);
    witnesses.push({ packed: p.packed, energyQ: p.energyQ, structure: p.structure });
  }
  const state = readMaterialTransport3D({
    schemaVersion: raw.transportSchemaVersion,
    rulesVersion: raw.transportRulesVersion,
    cycle: raw.cycle,
    terrain,
    parcels,
  });
  const expected = raw.terrain;
  if (identityKeys.some((k) => expected[k] !== state.terrain[k]))
    throw Error('Transport memory terrain identity or tick differs.');
  for (let k = 0; k < state.parcels.length; k++) {
    const i = state.parcels[k].cell,
      w = witnesses[k];
    if (
      w.packed !== state.terrain.packedCells[i] ||
      w.energyQ !== state.terrain.energyQ[i] ||
      w.structure !== state.terrain.structure[i]
    )
      throw Error('Transport memory cell history differs.');
  }
  return state;
}

/** Follow the original identity through exactly one coordinator-observed tick. */
export function followMaterialTransport3D(
  before: GameplayGeometry3D,
  after: GameplayGeometry3D,
  movement: TickMovement3D,
  memory: MaterialTransportMemory3D,
) {
  const source = gameplayGeometrySource3D(before),
    target = gameplayGeometrySource3D(after),
    observed = tickMovementSource3D(movement);
  if (
    source.token !== observed.before ||
    target.token !== observed.after ||
    JSON.stringify(before.stamp) !== JSON.stringify(observed.from) ||
    JSON.stringify(after.stamp) !== JSON.stringify(observed.to)
  )
    throw Error('Transport continuation boundaries differ.');
  const frame = observed.frame;
  if (!frame || frame.motion.status !== 'complete' || frame.paths.status !== 'complete')
    throw Error('Transport continuation requires complete material provenance.');
  const prior = restoreMaterialTransportMemory3D(source.token as StructuralSnapshot3D, memory);
  const next = readMaterialTransport3D({ ...prior, terrain: target.token, parcels: [] });
  const moved: { id: string; source: number; destination: number }[] = [];
  const retired: { id: string; source: number; destination: number; reason: 'air' | 'immobile' }[] =
    [];
  for (const p of prior.parcels) {
    let cell = p.cell;
    for (const [start, destination, length] of frame.motion.moves)
      if (p.cell >= start && p.cell < start + length) {
        cell = destination + p.cell - start;
        break;
      }
    const row = { id: p.id, source: p.cell, destination: cell };
    moved.push(row);
    if (!materialTransportCellMovable3D(next.terrain, cell))
      retired.push({
        ...row,
        reason: (next.terrain.packedCells[cell] & 255) === MAT.AIR ? 'air' : 'immobile',
      });
    else next.parcels.push({ ...p, cell });
  }
  return {
    memory: captureMaterialTransportMemory3D(next),
    moved,
    retired,
    from: structuredClone(observed.from),
    to: structuredClone(observed.to),
  };
}

/** Follow selected and displaced matter through one bound translation action. */
export function followTranslatedMaterialTransport3D(
  before: GameplayGeometry3D,
  after: GameplayGeometry3D,
  movement: TranslationMovement3D,
  memory: MaterialTransportMemory3D,
) {
  const source = gameplayGeometrySource3D(before),
    target = gameplayGeometrySource3D(after),
    observed = translationMovementSource3D(movement);
  if (
    source.token !== observed.before ||
    target.token !== observed.after ||
    JSON.stringify(before.stamp) !== JSON.stringify(observed.from) ||
    JSON.stringify(after.stamp) !== JSON.stringify(observed.to)
  )
    throw Error('Transport translation boundaries differ.');
  if (observed.paths.status !== 'complete')
    throw Error('Transport translation requires complete material provenance.');
  const prior = restoreMaterialTransportMemory3D(source.token as StructuralSnapshot3D, memory);
  // Segment origins refer to the original input identity, including terminal gas
  // relocated behind a translated region. Last occurrence gives its final cell.
  const destinations = new Map<number, number>();
  for (const pass of observed.paths.passes)
    for (const segment of pass.segments) destinations.set(segment.origin, segment.to);
  const next = readMaterialTransport3D({ ...prior, terrain: target.token, parcels: [] });
  const moved = prior.parcels.map((p) => {
    const destination = destinations.get(p.cell) ?? p.cell;
    next.parcels.push({ ...p, cell: destination });
    return { id: p.id, source: p.cell, destination };
  });
  return {
    memory: captureMaterialTransportMemory3D(next),
    moved,
    from: structuredClone(observed.from),
    to: structuredClone(observed.to),
  };
}

/**
 * Atomic candidate preparation. Existing translations retain actor policies and
 * journals; failures discard the entire branch even when callers catch the error.
 * The callback must retain returned memory in game state and apply game costs.
 */
export function prepareMaterialTransport3D<T extends TacticalValue>(
  editor: TacticalPreviewEditor3D<T>,
  memory: MaterialTransportMemory3D,
  impulses: readonly MaterialImpulse3D[],
  reduceGame: (context: {
    game: T;
    memory: MaterialTransportMemory3D;
    receipt: MaterialTransportReceipt3D;
  }) => T,
): MaterialTransportReceipt3D {
  try {
    if (typeof reduceGame !== 'function')
      throw Error('Transport preparation needs a synchronous game reducer.');
    const before = editor.inspect(),
      plan = applyMaterialTransport3D(
        restoreMaterialTransportMemory3D(before.terrain, memory),
        impulses,
      );
    const coordinate = (i: number): [number, number, number] => [
      i % before.terrain.width,
      Math.floor(i / before.terrain.width) % before.terrain.height,
      Math.floor(i / (before.terrain.width * before.terrain.height)),
    ];
    const groups: { cell: [number, number, number]; path: [number, number, number][] }[] = [];
    let at = 0;
    for (const row of plan.receipt.parcels) {
      let position = row.source;
      const path: [number, number, number][] = [];
      while (position !== row.destination) {
        const swap = plan.receipt.swaps[at++];
        if (!swap || swap[0] !== position) throw Error('Transport path composition differs.');
        const a = coordinate(position),
          b = coordinate(swap[1]);
        path.push(b.map((v, axis) => v - a[axis]) as [number, number, number]);
        position = swap[1];
      }
      if (path.length) groups.push({ cell: coordinate(row.source), path });
    }
    if (at !== plan.receipt.swaps.length) throw Error('Transport path coverage differs.');
    if (before.preview.operation + groups.length + 1 > TACTICAL_SESSION_LIMITS_3D.operations)
      throw Error('Transport exceeds remaining branch operation budget.');
    for (const g of groups)
      editor.translateWithMotion({ cells: [g.cell], path: g.path, displacement: 'mobile' });
    const staged = editor.inspect();
    for (const key of ['packedCells', 'energyQ', 'structure'] as const) {
      if (staged.terrain[key].some((v, i) => v !== plan.state.terrain[key][i]))
        throw Error('Staged terrain differs from the conservative transport plan.');
    }
    const nextMemory = captureMaterialTransportMemory3D(plan.state);
    editor.updateGame((game) =>
      reduceGame({
        game,
        memory: structuredClone(nextMemory),
        receipt: structuredClone(plan.receipt),
      }),
    );
    return structuredClone(plan.receipt);
  } catch (error) {
    try {
      editor.discard();
    } catch {
      /* Failed/expired branches already reject publication. */
    }
    throw error;
  }
}
