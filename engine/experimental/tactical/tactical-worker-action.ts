/** Portable intervention receipts: validate observations without re-executing them. */
import { MAX_ENERGY_Q } from '../../thermal.js';
import { checkedInteger } from '../../validation.js';
import { INTERVENTION_RULES_VERSION_3D, TRANSLATION_LIMITS_3D } from '../interventions.js';
import { MATERIAL_RESERVOIR_RULES_VERSION_3D } from '../gameplay/material-reservoirs.js';
import {
  TACTICAL_ACTION_LIMITS_3D,
  THERMAL_INTERVENTION_RULES_VERSION_3D,
} from './tactical-actions.js';
import { fields } from './tactical-worker-wire.js';
import type { ActionIntervention3D } from '../gameplay/action-journal.js';
import type { StructuralSnapshot3D } from '../structural/structural-world-core.js';
import type { TacticalSessionSnapshot3D, TacticalValue } from './tactical-session-view.js';

export const actionInteger = (v: unknown, lo: number, hi: number) =>
  checkedInteger(v as number, lo, hi, 'action journal integer');
export function actionArray(v: unknown, limit: number): unknown[] {
  if (!Array.isArray(v) || v.length > limit || Reflect.ownKeys(v).length !== v.length + 1)
    throw Error('Invalid bounded action array.');
  for (let i = 0; i < v.length; i++) {
    const d = Object.getOwnPropertyDescriptor(v, String(i));
    if (!d || !('value' in d) || !d.enumerable)
      throw Error('Action arrays must contain dense data.');
  }
  return v;
}
function decimal(v: unknown, bound: bigint): bigint {
  if (typeof v !== 'string' || v.length > 32 || !/^(0|-?[1-9][0-9]*)$/.test(v))
    throw Error('Invalid canonical action energy.');
  const q = BigInt(v);
  if (q < -bound || q > bound) throw Error('Action energy exceeds its volume.');
  return q;
}
const shape = (s: StructuralSnapshot3D) => [s.width, s.height, s.depth];
const point = (i: number, s: StructuralSnapshot3D) => [
  i % s.width,
  Math.floor(i / s.width) % s.height,
  Math.floor(i / (s.width * s.height)),
];
function indices(v: unknown, s: StructuralSnapshot3D, limit: number, nonempty = false): number[] {
  const a = actionArray(v, limit);
  let previous = -1;
  if (nonempty && !a.length) throw Error('Action requires selected matter.');
  return a.map((raw) => {
    const i = actionInteger(raw, 0, s.packedCells.length - 1);
    if (i <= previous) throw Error('Action indices must be sorted and unique.');
    previous = i;
    return i;
  });
}
function cuts(
  v: unknown,
  s: StructuralSnapshot3D,
  selected: Set<number>,
  limit: number,
): [number, number][] {
  let previous = [-1, -1];
  return actionArray(v, limit).map((raw) => {
    const a = actionArray(raw, 2);
    if (a.length !== 2) throw Error('Invalid cut bond.');
    const x = actionInteger(a[0], 0, s.packedCells.length - 1),
      y = actionInteger(a[1], x + 1, s.packedCells.length - 1);
    const p = point(x, s),
      q = point(y, s);
    if (
      p.reduce((n, v, axis) => n + Math.abs(v - q[axis]), 0) !== 1 ||
      selected.has(x) === selected.has(y) ||
      x < previous[0] ||
      (x === previous[0] && y <= previous[1])
    )
      throw Error('Invalid external bond order or geometry.');
    previous = [x, y];
    return [x, y];
  });
}
export function actionReceiptData(
  raw: unknown,
  snapshot: TacticalSessionSnapshot3D<TacticalValue>,
  tick: number,
  budget: number,
) {
  fields(raw, ['kind'], ['externalEnergyQ', 'receipt', 'hold']);
  const world = snapshot.terrain,
    energyBound = BigInt(world.packedCells.length) * BigInt(MAX_ENERGY_Q);
  let used = 0,
    external = 0n;
  const charge = (n: number) => {
    used += n;
    if (used > budget) throw Error('Action journal receipt exceeds shared budget.');
  };
  if (raw.kind === 'edit' || raw.kind === 'game') {
    fields(raw, ['kind', 'externalEnergyQ']);
    external = decimal(raw.externalEnergyQ, energyBound);
    if (raw.kind === 'game' && external !== 0n)
      throw Error('Game state cannot add physical energy.');
  } else if (raw.kind === 'tick') fields(raw, ['kind']);
  else if (raw.kind === 'hold' || raw.kind === 'release-hold') {
    fields(raw, ['kind', 'hold']);
    fields(raw.hold, ['id', 'expiresAtTick', 'cells']);
    const h = raw.hold;
    if (typeof h.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(h.id))
      throw Error('Invalid journal hold identity.');
    actionInteger(
      h.expiresAtTick,
      tick + 1,
      Math.min(Number.MAX_SAFE_INTEGER, tick + TACTICAL_ACTION_LIMITS_3D.lifetimeTicks),
    );
    charge(
      indices(h.cells, world, Math.min(budget, TACTICAL_ACTION_LIMITS_3D.heldCells), true).length,
    );
  } else if (raw.kind === 'energy') {
    fields(raw, ['kind', 'receipt']);
    fields(raw.receipt, ['rulesVersion', 'tick', 'suppliedQ', 'removedQ', 'externalQ', 'changes']);
    const r = raw.receipt;
    if (r.rulesVersion !== THERMAL_INTERVENTION_RULES_VERSION_3D || r.tick !== tick)
      throw Error('Thermal receipt identity differs.');
    const changes = actionArray(
      r.changes,
      Math.min(budget, TACTICAL_ACTION_LIMITS_3D.thermalCells),
    );
    charge(changes.length);
    let supplied = 0n,
      removed = 0n,
      previous = -1;
    for (const c of changes) {
      fields(c, ['index', 'beforeQ', 'afterQ', 'deltaQ']);
      const i = actionInteger(c.index, 0, world.packedCells.length - 1);
      const before = actionInteger(c.beforeQ, 0, MAX_ENERGY_Q),
        after = actionInteger(c.afterQ, 0, MAX_ENERGY_Q),
        delta = actionInteger(c.deltaQ, -MAX_ENERGY_Q, MAX_ENERGY_Q);
      if (i <= previous || after - before !== delta)
        throw Error('Thermal receipt correspondence differs.');
      previous = i;
      if (delta > 0) supplied += BigInt(delta);
      else removed -= BigInt(delta);
    }
    external = decimal(r.externalQ, energyBound);
    if (
      decimal(r.suppliedQ, energyBound) !== supplied ||
      decimal(r.removedQ, energyBound) !== removed ||
      external !== supplied - removed
    )
      throw Error('Thermal receipt does not balance.');
  } else if (raw.kind === 'translate' || raw.kind === 'transfer') {
    fields(raw, ['kind', 'receipt']);
    const r = raw.receipt,
      translating = raw.kind === 'translate';
    fields(
      r,
      translating
        ? [
            'rulesVersion',
            'tick',
            'externalEnergyQ',
            'sources',
            'destinations',
            'path',
            'cutBonds',
            'releasedAnchors',
            'editedCells',
          ]
        : [
            'rulesVersion',
            'tick',
            'from',
            'to',
            'sources',
            'destinations',
            'sourceEnergyDeltaQ',
            'destinationEnergyDeltaQ',
            'externalEnergyQ',
            'cutBonds',
            'releasedAnchors',
            'sourceEditedCells',
            'destinationEditedCells',
          ],
    );
    if (
      r.tick !== tick ||
      r.externalEnergyQ !== '0' ||
      r.rulesVersion !==
        (translating ? INTERVENTION_RULES_VERSION_3D : MATERIAL_RESERVOIR_RULES_VERSION_3D)
    )
      throw Error('Material receipt identity differs.');
    const domain = (id: unknown) => {
      if (id === null) return world;
      const s = snapshot.reservoirs.find((d) => d.id === id)?.terrain;
      if (!s) throw Error('Unknown action domain.');
      return s;
    };
    const source = translating ? world : domain(r.from),
      target = translating ? world : domain(r.to);
    if (!translating && r.from === r.to) throw Error('Transfer needs distinct domains.');
    const sources = indices(r.sources, source, Math.min(budget, TRANSLATION_LIMITS_3D.cells), true);
    charge(sources.length);
    const destinations = indices(r.destinations, target, budget - used, true);
    charge(destinations.length);
    if (sources.length !== destinations.length) throw Error('Material receipt volume differs.');
    const selected = new Set(sources),
      cut = cuts(r.cutBonds, source, selected, budget - used);
    charge(cut.length);
    const released = indices(r.releasedAnchors, source, budget - used);
    charge(released.length);
    if (released.some((i) => !selected.has(i)))
      throw Error('Released anchor is outside selected matter.');
    const offset = [0, 0, 0];
    if (translating) {
      const path = actionArray(r.path, TRANSLATION_LIMITS_3D.path);
      charge(path.length);
      if (!path.length || sources.length * (path.length + 1) > TRANSLATION_LIMITS_3D.cellSteps)
        throw Error('Translation path exceeds work budget.');
      const lo = shape(source),
        hi = [0, 0, 0],
        dimensions = shape(source);
      for (const i of sources)
        point(i, source).forEach((v, a) => {
          lo[a] = Math.min(lo[a], v);
          hi[a] = Math.max(hi[a], v);
        });
      for (const rawStep of path) {
        const step = actionArray(rawStep, 3);
        if (step.length !== 3) throw Error('Invalid path dimension.');
        const vector = step.map((v) => actionInteger(v, -1, 1));
        if (vector.reduce((n, v) => n + Math.abs(v), 0) !== 1) throw Error('Path is not cardinal.');
        vector.forEach((v, a) => {
          offset[a] += v;
          if (lo[a] + offset[a] < 0 || hi[a] + offset[a] >= dimensions[a])
            throw Error('Path leaves closed volume.');
        });
      }
      charge(indices(r.editedCells, source, budget - used).length);
    } else {
      point(destinations[0], target).forEach((v, a) => {
        offset[a] = v - point(sources[0], source)[a];
      });
      const bound = BigInt(sources.length) * BigInt(MAX_ENERGY_Q);
      if (decimal(r.sourceEnergyDeltaQ, bound) + decimal(r.destinationEnergyDeltaQ, bound) !== 0n)
        throw Error('Transfer does not conserve energy.');
      charge(indices(r.sourceEditedCells, source, budget - used).length);
      charge(indices(r.destinationEditedCells, target, budget - used).length);
    }
    sources.forEach((i, k) => {
      const end = point(destinations[k], target);
      if (point(i, source).some((v, a) => v + offset[a] !== end[a]))
        throw Error('Material receipt mapping differs.');
    });
  } else throw Error('Unknown action kind.');
  return { action: structuredClone(raw) as ActionIntervention3D, entries: used, external };
}
