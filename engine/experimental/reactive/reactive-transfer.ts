/** Conservative cross-domain exchange. No placement, tick or external energy. */
import { MAT, PHASE, PHASE_SHIFT, COLD_STRIDE, COLD_COHESION } from '../../generated/materials.js';
import { ANCHOR_3D, BONDS_3D, structuralNeighbor } from '../structural-mechanics.js';
import { reactiveArray3D, reactiveFields3D, reactiveInteger3D, reactiveRegistrySource3D, type ReactiveMaterialRegistry3D } from './reactive-registry.js';
import { reactiveHeldCells3D } from './reactive-holds.js';
import { reactiveSnapshotHolds3D } from './reactive-world-tick.js';
import { readReactiveDomainsSnapshot3D, reactiveDomainId3D, reactiveDomain3D, reactiveDomainsEnergyQ3D,
  type ReactiveDomainId3D, type ReactiveDomainsSnapshot3D } from './reactive-domain-state.js';
import type { ReactiveTranslationCoordinate3D } from './reactive-translation.js';
import type { ReactiveMaterialBlock3D } from './reactive-block.js';
export const REACTIVE_TRANSFER_RULES_3D = 'reactive-transfer-1';
export const REACTIVE_TRANSFER_LIMITS_3D = Object.freeze({cells: 32768, work: 256});
export type ReactiveTransferRequest3D = {from: ReactiveDomainId3D; to: ReactiveDomainId3D;
  cells: readonly ReactiveTranslationCoordinate3D[]; offset: ReactiveTranslationCoordinate3D;
  externalBonds?: 'reject' | 'cut'; anchors?: 'reject' | 'release'; displacement?: 'air' | 'mobile'};
export type ReactiveTransferReceipt3D = {rulesVersion: typeof REACTIVE_TRANSFER_RULES_3D; materialCatalogHash: string; tick: number;
  from: ReactiveDomainId3D; to: ReactiveDomainId3D; sources: number[]; destinations: number[];
  sourceEnergyDeltaQ: string; destinationEnergyDeltaQ: string; externalEnergyQ: '0';
  cutBonds: [number, number][]; releasedAnchors: number[]; sourceChangedCells: number[]; destinationChangedCells: number[];
  energy: {beforeQ: string; afterQ: string; driftQ: '0'}};
export type ReactiveTransferResult3D = {state: ReactiveDomainsSnapshot3D; receipt: ReactiveTransferReceipt3D};
export type ReactiveTransferProgress3D = {status: 'running' | 'complete' | 'cancelled'; phase: 'swap' | 'publish' | 'complete'; completedPairs: number; totalPairs: number; lastAdvanceWork: number};
export interface ReactiveTransferJob3D {progress(): ReactiveTransferProgress3D; advance(work?: number): ReactiveTransferProgress3D; cancel(): boolean; result(): ReactiveTransferResult3D;}
function coordinate(raw: unknown): number[] {
  const c = reactiveArray3D(raw, 3); if (c.length !== 3) throw Error('Transfer requires three coordinates.');
  return c.map(v => reactiveInteger3D(v, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER));
}
function index(c: number[], block: ReactiveMaterialBlock3D): number {
  const x = reactiveInteger3D(c[0], 0, block.width - 1), y = reactiveInteger3D(c[1], 0, block.height - 1), z = reactiveInteger3D(c[2], 0, block.depth - 1);
  return x + block.width * (y + block.height * z);
}
const changed = (a: ReactiveMaterialBlock3D, b: ReactiveMaterialBlock3D) => a.packedCells.flatMap((v, i) => v !== b.packedCells[i] || a.energyQ[i] !== b.energyQ[i] || a.structure[i] !== b.structure[i] ? [i] : []);
export function createReactiveTransferJob3D(registry: ReactiveMaterialRegistry3D, raw: ReactiveDomainsSnapshot3D, request: ReactiveTransferRequest3D): ReactiveTransferJob3D {
  let before: ReactiveDomainsSnapshot3D | null = readReactiveDomainsSnapshot3D(registry, raw), current: ReactiveDomainsSnapshot3D | null = structuredClone(before);
  reactiveFields3D(request, ['from', 'to', 'cells', 'offset'], ['externalBonds', 'anchors', 'displacement']);
  const from = reactiveDomainId3D(request.from), to = reactiveDomainId3D(request.to); if (from === to) throw Error('Use checked-path translation within a domain.');
  const externalBonds = Object.hasOwn(request, 'externalBonds') ? request.externalBonds : 'reject', anchors = Object.hasOwn(request, 'anchors') ? request.anchors : 'reject';
  const displacement = Object.hasOwn(request, 'displacement') ? request.displacement : 'air';
  if (!['reject', 'cut'].includes(externalBonds as string) || !['reject', 'release'].includes(anchors as string) || !['air', 'mobile'].includes(displacement as string)) throw Error('Invalid reactive transfer policy.');
  const offset = coordinate(request.offset), selected = reactiveArray3D(request.cells, REACTIVE_TRANSFER_LIMITS_3D.cells);
  if (!selected.length) throw Error('Transfer must select existing matter.');
  let source: ReactiveMaterialBlock3D | null = reactiveDomain3D(current, from).block, target: ReactiveMaterialBlock3D | null = reactiveDomain3D(current, to).block;
  const sourceHolds = new Set(reactiveHeldCells3D(reactiveSnapshotHolds3D(reactiveDomain3D(before, from))));
  const targetHolds = new Set(reactiveHeldCells3D(reactiveSnapshotHolds3D(reactiveDomain3D(before, to))));
  let pairs = selected.map(value => {const c = coordinate(value); return {from: index(c, source!), to: index(c.map((v, axis) => v + offset[axis]), target!)};}).sort((a, b) => a.from - b.from);
  const members = new Set(pairs.map(p => p.from)); if (members.size !== pairs.length) throw Error('Duplicate reactive transfer source.');
  const cutBonds: [number, number][] = [], releasedAnchors: number[] = [], cold = reactiveRegistrySource3D(registry).cold;
  const initialQ = reactiveDomainsEnergyQ3D(before); let sourceDelta = 0n;
  for (const {from: i} of pairs) {
    if ((source.packedCells[i] & 255) === MAT.AIR) throw Error('Transfer must select existing matter, not air.');
    if (sourceHolds.has(i)) throw Error('Explicitly release held source matter before transfer.');
    if (source.structure[i] & ANCHOR_3D) {if (anchors !== 'release') throw Error('Explicitly release selected anchors.'); source.structure[i] &= ~ANCHOR_3D; releasedAnchors.push(i);}
    for (let dir = 0; dir < 6; dir++) if (source.structure[i] & BONDS_3D[dir]) {
      const j = structuralNeighbor(i, dir, source); if (members.has(j)) continue;
      if (externalBonds !== 'cut') throw Error('Explicitly cut external bonds.');
      source.structure[i] &= ~BONDS_3D[dir]; source.structure[j] &= ~BONDS_3D[dir ^ 1]; cutBonds.push([Math.min(i, j), Math.max(i, j)]);
    }
  }
  cutBonds.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let expectedStructure: number[] | null = source.structure.slice(), completedPairs = 0, lastAdvanceWork = 0;
  const totalPairs = pairs.length; let status: ReactiveTransferProgress3D['status'] = 'running', phase: ReactiveTransferProgress3D['phase'] = 'swap', result: ReactiveTransferResult3D | null = null;
  const progress = (): ReactiveTransferProgress3D => ({status, phase, completedPairs, totalPairs, lastAdvanceWork});
  const release = () => {before = current = null; source = target = null; expectedStructure = null; pairs = []; members.clear(); sourceHolds.clear(); targetHolds.clear();};
  const cancel = () => {if (status !== 'running') return false; release(); status = 'cancelled'; return true;};
  return Object.freeze({progress, cancel,
    advance(work: number = 64) {
      reactiveInteger3D(work, 1, REACTIVE_TRANSFER_LIMITS_3D.work);
      if (status !== 'running' || !before || !current || !source || !target) throw Error('Reactive transfer is no longer running.');
      lastAdvanceWork = 0;
      try {
        if (phase === 'swap') {
          const end = Math.min(totalPairs, completedPairs + work);
          for (; completedPairs < end; completedPairs++) {
            const {from: i, to: j} = pairs[completedPairs], word = target.packedCells[j], p = word >>> PHASE_SHIFT & 15;
            const loose = [PHASE.GAS, PHASE.POWDER, PHASE.LIQUID, PHASE.VISCOUS, PHASE.MOLTEN].some(v => v === p);
            const cohesive = [PHASE.SOLID, PHASE.FROZEN].some(v => v === p) && cold[(word & 255) * COLD_STRIDE + COLD_COHESION] > 0;
            if (targetHolds.has(j) || target.structure[j] !== 0 || (word & 255) !== MAT.AIR && (displacement !== 'mobile' || !loose && !cohesive)) throw Error('Reactive transfer destination is obstructed.');
            sourceDelta += BigInt(target.energyQ[j]) - BigInt(source.energyQ[i]);
            for (const key of ['packedCells', 'energyQ', 'structure'] as const) [source[key][i], target[key][j]] = [target[key][j], source[key][i]];
            lastAdvanceWork++;
          }
          if (completedPairs === totalPairs) phase = 'publish';
        } else if (phase === 'publish') {
          const validated = readReactiveDomainsSnapshot3D(registry, current), afterQ = reactiveDomainsEnergyQ3D(validated);
          if (afterQ !== initialQ) throw Error('Reactive transfer lost conserved energy.');
          const oldSource = reactiveDomain3D(before, from).block, oldTarget = reactiveDomain3D(before, to).block;
          for (const {from: i, to: j} of pairs) {
            if (target.packedCells[j] !== oldSource.packedCells[i] || target.energyQ[j] !== oldSource.energyQ[i] || target.structure[j] !== expectedStructure![i] ||
              source.packedCells[i] !== oldTarget.packedCells[j] || source.energyQ[i] !== oldTarget.energyQ[j] || source.structure[i] !== oldTarget.structure[j]) throw Error('Reactive transfer changed material history.');
          }
          result = {state: validated, receipt: {rulesVersion: REACTIVE_TRANSFER_RULES_3D, materialCatalogHash: registry.hash, tick: before.tick, from, to,
            sources: pairs.map(p => p.from), destinations: pairs.map(p => p.to), sourceEnergyDeltaQ: sourceDelta.toString(), destinationEnergyDeltaQ: (-sourceDelta).toString(), externalEnergyQ: '0',
            cutBonds, releasedAnchors, sourceChangedCells: changed(oldSource, source), destinationChangedCells: changed(oldTarget, target),
            energy: {beforeQ: initialQ.toString(), afterQ: afterQ.toString(), driftQ: '0'}}};
          release(); status = 'complete'; phase = 'complete';
        }
      } catch (error) {cancel(); throw error;} return progress();
    },
    result() {if (!result || status !== 'complete') throw Error('Reactive transfer is not complete.'); return structuredClone(result);},
  });
}
