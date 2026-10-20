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
/** Fixed application profiles, not permission to run an arbitrary larger world. */
export const SCENARIOS = Object.freeze({
  chamber: {
    size: 8,
    worldId: CHAMBER_WORLD,
    pulseQ: CHAMBER.pulseQ,
    title: '8³ reference chamber',
    description:
      'Burn the wooden connector to release the platform and remove the actor’s footing.',
    support: SUPPORT,
    ice: ICE,
  },
  collapse: {
    size: 16,
    worldId: 'reactive-sandbox-collapse-1',
    pulseQ: CHAMBER.pulseQ,
    title: '16³ burning support',
    description: 'Heat the wooden connector. Compare the supported platform with its collapse.',
    support: [5, 8, 6],
    ice: [11, 14, 11],
  },
  flow: {
    size: 16,
    worldId: 'reactive-sandbox-flow-1',
    pulseQ: 60 * ENERGY_SCALE,
    title: '16³ melt, flow, freeze',
    description:
      'Heat the ice on the shelf, commit and wait for water to fall. Select the water and cool it to freeze it again.',
    support: [3, 12, 3],
    ice: [8, 6, 8],
  },
  chain: {
    size: 16,
    worldId: 'reactive-sandbox-chain-1',
    pulseQ: CHAMBER.pulseQ,
    title: '16³ distant collapse',
    description:
      'Burn the connector at the left end of the bridge. Follow the loss of support to the actor at the far end.',
    support: [3, 6, 7],
    ice: [11, 14, 11],
  },
} as const);
for (const profile of Object.values(SCENARIOS)) {
  Object.freeze(profile.support);
  Object.freeze(profile.ice);
  Object.freeze(profile);
}
export type ScenarioId = keyof typeof SCENARIOS;
export function readScenario(raw: unknown): ScenarioId {
  if (typeof raw !== 'string' || !Object.hasOwn(SCENARIOS, raw))
    throw Error('Unknown chamber scenario.');
  return raw as ScenarioId;
}
export function snapshotScenario(snapshot: { worldId: string }): ScenarioId {
  const id = (Object.keys(SCENARIOS) as ScenarioId[]).find(
    (id) => SCENARIOS[id].worldId === snapshot.worldId,
  );
  if (!id) throw Error('Incompatible chamber world.');
  return id;
}
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
export const index = ([x, y, z]: readonly number[], size = 8) => x + size * (y + size * z);
export const coordinate = (i: number, size = 8): Cell => [
  i % size,
  Math.floor(i / size) % size,
  Math.floor(i / (size * size)),
];
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
export function readCommand(raw: unknown, scenario: ScenarioId = 'chamber'): ChamberCommand {
  const size = SCENARIOS[readScenario(scenario)].size;
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
    return integer(d.value, 0, size - 1);
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
  return validateChamberSnapshot(
    registry,
    readReactiveSessionSnapshot3D<ChamberGame>(registry, raw),
  );
}
/** Session policies receive an owned, already validated SDK boundary. */
function validateChamberSnapshot(
  registry: ReactiveMaterialRegistry3D,
  s: ChamberSnapshot,
): ChamberSnapshot {
  const b = s.domains.world.block,
    g = s.game,
    profile = SCENARIOS[snapshotScenario(s)];
  if (
    s.gameRulesVersion !== CHAMBER_RULES ||
    s.domains.reservoirs.length ||
    b.width !== profile.size ||
    b.height !== profile.size ||
    b.depth !== profile.size ||
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
    integer(g[k], 0, profile.size ** 3 * CHAMBER.maxTicks);
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
      validateChamberSnapshot(registry, snapshot);
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
        cost > SCENARIOS[snapshotScenario(game.actor)].pulseQ ||
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
  scenario: ScenarioId = 'chamber',
): ReactiveSessionInitial3D<ChamberGame> {
  const edits: ReactiveMaterialEdit3D[] = [];
  const place = (x: number, y: number, z: number, material: number = MAT.STONE, thermal = 20) =>
    edits.push({ kind: 'place', x, y, z, material, thermal });
  const anchor = (x: number, y: number, z: number) =>
    edits.push({ kind: 'anchor', x, y, z, anchored: true });
  const bond = (x: number, y: number, z: number, direction: number) =>
    edits.push({ kind: 'bond', x, y, z, direction, bonded: true });
  const profile = SCENARIOS[readScenario(scenario)],
    size = profile.size;
  const [sx, sy, sz] = profile.support;
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      place(x, size - 1, z);
      anchor(x, size - 1, z);
    }
  for (let y = sy; y < size - 1; y++) {
    place(sx - 1, y, sz);
    anchor(sx - 1, y, sz);
  }
  place(sx, sy, sz, MAT.WOOD);
  const end = scenario === 'chain' ? 12 : sx + 2;
  for (let x = sx + 1; x <= end; x++) place(x, sy, sz);
  for (let x = sx - 1; x < end; x++) bond(x, sy, sz, 1);
  place(profile.ice[0], profile.ice[1], profile.ice[2], MAT.ICE, 5);
  if (scenario === 'flow') {
    // A one-cell lip supports the ice; melted water can leave its exposed edges.
    place(8, 7, 8);
    anchor(8, 7, 8);
  }
  const block = editReactiveMaterialBlock3D(
    registry,
    createReactiveMaterialBlock3D(registry, { width: size, height: size, depth: size }),
    edits,
  ).block;
  const domains = createReactiveDomainsSnapshot3D(
    registry,
    createReactiveWorldSnapshot3D(registry, block),
    [],
  );
  const identity = { worldId: profile.worldId, gameRulesVersion: CHAMBER_RULES, domains };
  const view = createReactiveSession3D(registry, { ...identity, game: {} }).queries();
  const actor = createReactiveBody3D(view, {
    minQ: [(scenario === 'chain' ? end : sx) * Q + Q / 8, sy * Q - ACTOR_SIZE_Q, sz * Q + Q / 8],
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
export async function createChamber(scenario: ScenarioId = 'chamber') {
  const registry = await createReactiveMaterialRegistry3D(),
    initial = chamberInitial(registry, scenario);
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
  const scenario = snapshotScenario(snapshot),
    command = readCommand(raw, scenario);
  if (snapshot.domains.tick + CHAMBER.horizon > CHAMBER.maxTicks)
    throw Error('Chamber tick limit reached; start a new chamber.');
  if (command.kind === 'wait') return [];
  const b = snapshot.domains.world.block,
    i = index(command.cell, b.width),
    floor = registry.material(b.packedCells[i] & 255).properties.fuel_energy * ENERGY_SCALE;
  const pulseQ = SCENARIOS[scenario].pulseQ;
  const delta = command.kind === 'heat' ? pulseQ : -Math.min(pulseQ, b.energyQ[i] - floor);
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
