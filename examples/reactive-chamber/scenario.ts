/** Chamber application contract. Only public reactive SDK imports; no work at import time. */
import {
  createReactiveMaterialRegistry3D,
  createReactiveMaterialBlock3D,
  editReactiveMaterialBlock3D,
  createReactiveWorldSnapshot3D,
  createReactiveDomainsSnapshot3D,
  createReactiveSession3D,
  readReactiveSessionSnapshot3D,
  createReactiveBody3D,
  readReactiveBody3D,
  createReactiveDisplacement3D,
  stepReactiveBody3D,
  MAT,
  ENERGY_SCALE,
  GEOMETRY_SCALE_3D as Q,
  type ReactiveMaterialRegistry3D,
  type ReactiveMaterialEdit3D,
  type ReactiveBody3D,
  type ReactiveSessionInitial3D,
  type ReactiveSessionSnapshot3D,
  type ReactiveSessionPolicy3D,
  type ReactiveSessionCommand3D,
  type ReactiveSession3D,
  type ReactiveBranch3D,
} from 'state-space-engine/experimental/3d/reactive-materials';

export const CHAMBER_RULES = 'reactive-chamber-1';
export const CHAMBER_WORLD = 'reactive-chamber';
export const CHAMBER = Object.freeze({
  size: 8,
  horizon: 2,
  maxTicks: 128,
  pulseQ: 235 * ENERGY_SCALE,
  budgetQ: 8 * 235 * ENERGY_SCALE,
  maxCommands: 64,
  maxSlices: 4096,
});
export const ACTOR_SIZE_Q = (3 * Q) / 4;
export const SUPPORT = Object.freeze([3, 4, 3] as const);
export const ICE = Object.freeze([5, 6, 5] as const);
export type Cell = [number, number, number];
export type ChamberCommand = { kind: 'wait' } | { kind: 'heat' | 'cool'; cell: Cell };
export type ChamberGame = {
  rulesVersion: typeof CHAMBER_RULES;
  actor: ReactiveBody3D;
  tick: number;
  heatAddedQ: number;
  heatRemovedQ: number;
  remainingQ: number;
  burned: number;
  phaseChanges: number;
  broken: number;
  fallen: number;
  lostFooting: number;
};
export type ChamberSnapshot = ReactiveSessionSnapshot3D<ChamberGame>;
export type ChamberSession = ReactiveSession3D<ChamberGame>;
export const index = ([x, y, z]: readonly number[]) => x + 8 * (y + 8 * z);
export const coordinate = (i: number): Cell => [i % 8, Math.floor(i / 8) % 8, Math.floor(i / 64)];
export function fields(
  raw: unknown,
  keys: readonly string[],
): asserts raw is Record<string, unknown> {
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
    throw Error('Invalid chamber data.');
}
export function integer(n: unknown, min: number, max: number): number {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < min || n > max)
    throw Error('Invalid chamber integer.');
  return n;
}
export function readCommand(raw: unknown): ChamberCommand {
  if (!raw || typeof raw !== 'object') throw Error('Invalid chamber command.');
  const tag = Object.getOwnPropertyDescriptor(raw, 'kind');
  if (!tag || !('value' in tag)) throw Error('Invalid command kind.');
  if (tag.value === 'wait') {
    fields(raw, ['kind']);
    return { kind: 'wait' };
  }
  fields(raw, ['kind', 'cell']);
  if (raw.kind !== 'heat' && raw.kind !== 'cool') throw Error('Unknown chamber command.');
  if (!Array.isArray(raw.cell) || raw.cell.length !== 3 || Reflect.ownKeys(raw.cell).length !== 4)
    throw Error('Choose one cell.');
  const cell = [0, 1, 2].map((i) => {
    const d = Object.getOwnPropertyDescriptor(raw.cell, String(i));
    if (!d || !('value' in d)) throw Error('Invalid cell.');
    return integer(d.value, 0, 7);
  }) as Cell;
  return { kind: raw.kind, cell };
}
const actorBox = (actor: ReactiveBody3D) => ({
  minQ: actor.minQ,
  maxQ: actor.minQ.map((v, i) => v + actor.sizeQ[i]) as Cell,
});
export function readChamberSnapshot(
  registry: ReactiveMaterialRegistry3D,
  raw: unknown,
): ChamberSnapshot {
  const s = readReactiveSessionSnapshot3D<ChamberGame>(registry, raw),
    b = s.domains.world.block,
    g = s.game;
  if (
    s.worldId !== CHAMBER_WORLD ||
    s.gameRulesVersion !== CHAMBER_RULES ||
    s.domains.reservoirs.length ||
    b.width !== 8 ||
    b.height !== 8 ||
    b.depth !== 8 ||
    s.domains.world.schemaVersion !== 1
  )
    throw Error('Incompatible chamber world.');
  fields(g, [
    'rulesVersion',
    'actor',
    'tick',
    'heatAddedQ',
    'heatRemovedQ',
    'remainingQ',
    'burned',
    'phaseChanges',
    'broken',
    'fallen',
    'lostFooting',
  ]);
  if (g.rulesVersion !== CHAMBER_RULES || integer(g.tick, 0, CHAMBER.maxTicks) !== s.domains.tick)
    throw Error('Incompatible chamber cadence.');
  for (const k of ['heatAddedQ', 'heatRemovedQ', 'remainingQ'] as const)
    integer(g[k], 0, CHAMBER.budgetQ);
  if (
    g.heatAddedQ + g.heatRemovedQ + g.remainingQ !== CHAMBER.budgetQ ||
    BigInt(g.heatAddedQ - g.heatRemovedQ) !== BigInt(s.accounting.externalQ)
  )
    throw Error('Chamber resources do not balance.');
  for (const k of ['burned', 'phaseChanges', 'broken', 'fallen', 'lostFooting'] as const)
    integer(g[k], 0, 512 * CHAMBER.maxTicks);
  const view = createReactiveSession3D(registry, {
    worldId: s.worldId,
    gameRulesVersion: s.gameRulesVersion,
    domains: s.domains,
    game: {},
  }).queries();
  const actor = readReactiveBody3D(view, g.actor),
    support = view.support({ box: actorBox(actor), maxDropQ: 0 });
  if (
    actor.step !== s.domains.tick ||
    actor.gravityQ !== 64 ||
    actor.sizeQ.some((v) => v !== ACTOR_SIZE_Q) ||
    !support.bodyFits ||
    actor.grounded !== (support.distanceQ === 0)
  )
    throw Error('Invalid chamber actor boundary.');
  return s;
}
export function chamberPolicy(
  registry: ReactiveMaterialRegistry3D,
): ReactiveSessionPolicy3D<ChamberGame> {
  return {
    validateGame(snapshot) {
      readChamberSnapshot(registry, snapshot);
      return true;
    },
    reduceCommand({ game, command, receipt }) {
      if (
        command.kind !== 'edit' ||
        command.domain !== null ||
        command.edits.length !== 1 ||
        command.edits[0].kind !== 'energy' ||
        !('value' in receipt) ||
        !('externalEnergyQ' in receipt.value)
      )
        throw Error('Chamber only permits thermal edits.');
      const delta = Number(receipt.value.externalEnergyQ),
        cost = Math.abs(delta);
      if (
        !Number.isSafeInteger(delta) ||
        cost === 0 ||
        cost > CHAMBER.pulseQ ||
        cost > game.remainingQ
      )
        throw Error('Thermal resource exhausted or invalid pulse.');
      return {
        ...game,
        remainingQ: game.remainingQ - cost,
        heatAddedQ: game.heatAddedQ + Math.max(0, delta),
        heatRemovedQ: game.heatRemovedQ + Math.max(0, -delta),
      };
    },
    reduceTick({ game, beforeQueries, queries, movement, report }) {
      const displaced = createReactiveDisplacement3D(
        beforeQueries(),
        queries(),
        movement(),
      ).resolve(game.actor);
      if (displaced.status !== 'resolved')
        throw Error(`Actor response rejected: ${displaced.status}.`);
      const stepped = stepReactiveBody3D(queries(), displaced.body);
      if (stepped.status !== 'resolved') throw Error(`Actor movement rejected: ${stepped.status}.`);
      const physical = report.domains[0].report;
      return {
        ...game,
        actor: stepped.body,
        tick: game.tick + 1,
        burned: game.burned + physical.evolution.reactions.reactedPairs.length,
        phaseChanges: game.phaseChanges + physical.evolution.reactions.phaseChangedCells.length,
        broken: game.broken + physical.structure.brokenCells.length,
        fallen: game.fallen + physical.structure.movingCells.length,
        lostFooting: game.lostFooting + Number(displaced.lostFooting || stepped.lostFooting),
      };
    },
  };
}
export function chamberInitial(
  registry: ReactiveMaterialRegistry3D,
): ReactiveSessionInitial3D<ChamberGame> {
  const edits: ReactiveMaterialEdit3D[] = [];
  const place = (x: number, y: number, z: number, material: number = MAT.STONE, thermal = 20) =>
    edits.push({ kind: 'place', x, y, z, material, thermal });
  const anchor = (x: number, y: number, z: number) =>
    edits.push({ kind: 'anchor', x, y, z, anchored: true });
  const bond = (x: number, y: number, z: number, direction: number) =>
    edits.push({ kind: 'bond', x, y, z, direction, bonded: true });
  for (let z = 0; z < 8; z++)
    for (let x = 0; x < 8; x++) {
      place(x, 7, z);
      anchor(x, 7, z);
    }
  for (let y = 4; y < 7; y++) {
    place(2, y, 3);
    anchor(2, y, 3);
  }
  place(...SUPPORT, MAT.WOOD);
  place(4, 4, 3);
  place(5, 4, 3);
  bond(2, 4, 3, 1);
  bond(3, 4, 3, 1);
  bond(4, 4, 3, 1);
  place(...ICE, MAT.ICE, 5);
  const block = editReactiveMaterialBlock3D(
    registry,
    createReactiveMaterialBlock3D(registry, { width: 8, height: 8, depth: 8 }),
    edits,
  ).block;
  const domains = createReactiveDomainsSnapshot3D(
    registry,
    createReactiveWorldSnapshot3D(registry, block),
    [],
  );
  const identity = { worldId: CHAMBER_WORLD, gameRulesVersion: CHAMBER_RULES, domains };
  const view = createReactiveSession3D(registry, { ...identity, game: {} }).queries();
  const actor = createReactiveBody3D(view, {
    minQ: [3 * Q + Q / 8, 4 * Q - ACTOR_SIZE_Q, 3 * Q + Q / 8],
    sizeQ: [ACTOR_SIZE_Q, ACTOR_SIZE_Q, ACTOR_SIZE_Q],
    gravityQ: 64,
  });
  return {
    ...identity,
    game: {
      rulesVersion: CHAMBER_RULES,
      actor,
      tick: 0,
      heatAddedQ: 0,
      heatRemovedQ: 0,
      remainingQ: CHAMBER.budgetQ,
      burned: 0,
      phaseChanges: 0,
      broken: 0,
      fallen: 0,
      lostFooting: 0,
    },
  };
}
export async function createChamber() {
  const registry = await createReactiveMaterialRegistry3D(),
    initial = chamberInitial(registry);
  return {
    registry,
    initial,
    session: createReactiveSession3D(registry, initial, chamberPolicy(registry)),
  };
}
export function compileCommand(
  registry: ReactiveMaterialRegistry3D,
  snapshot: ChamberSnapshot,
  raw: unknown,
): ReactiveSessionCommand3D<ChamberGame>[] {
  const command = readCommand(raw);
  if (snapshot.domains.tick + CHAMBER.horizon > CHAMBER.maxTicks)
    throw Error('Chamber tick limit reached; start a new chamber.');
  if (command.kind === 'wait') return [];
  const b = snapshot.domains.world.block,
    i = index(command.cell),
    floor = registry.material(b.packedCells[i] & 255).properties.fuel_energy * ENERGY_SCALE;
  const delta =
    command.kind === 'heat' ? CHAMBER.pulseQ : -Math.min(CHAMBER.pulseQ, b.energyQ[i] - floor);
  if (delta === 0 || Math.abs(delta) > snapshot.game.remainingQ)
    throw Error('Not enough thermal resource, or the cell is already cold.');
  const [x, y, z] = command.cell;
  return [
    {
      kind: 'edit',
      domain: null,
      edits: [{ kind: 'energy', x, y, z, energyQ: b.energyQ[i] + delta }],
    },
  ];
}
export function prepareCommand(
  registry: ReactiveMaterialRegistry3D,
  session: ChamberSession,
  command: unknown,
) {
  const commands = compileCommand(registry, session.snapshot(), command),
    branch = session.branch({ horizonTicks: CHAMBER.horizon, motion: { maxEntries: 65536 } });
  try {
    for (const c of commands) branch.enqueue(c);
    return branch;
  } catch (error) {
    branch.discard();
    throw error;
  }
}
export function finishBranch(branch: ReactiveBranch3D<ChamberGame>, work = 256) {
  for (let i = 0; i < CHAMBER.maxSlices; i++) {
    if (branch.progress().status === 'ready') return branch.inspect();
    branch.advance(work);
  }
  branch.discard();
  throw Error('Chamber exceeded its finite work limit.');
}
