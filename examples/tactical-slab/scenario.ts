/** Application rules for the hot-slab reference. Imports never start simulation. */
import { createStateSpaceStructuralWorld3D, MAT, type StructuralSnapshot3D } from 'state-space-engine/experimental/3d/structural-world';
import { createTacticalSession3D, createTerrainBody3D, readTerrainBody3D, moveTerrainActors3D, createTerrainActorGroup3D,
  createMaterialTransport3D, captureMaterialTransportMemory3D, restoreMaterialTransportMemory3D, followMaterialTransport3D,
  followTranslatedMaterialTransport3D, prepareMaterialTransport3D, type MaterialTransportMemory3D,
  createTranslatedActorGroup3D, GEOMETRY_SCALE_3D as Q,
  type TacticalSessionInitial3D, type TacticalSessionPolicy3D, type TacticalPreviewEditor3D,
  type TacticalSessionSnapshot3D, type TacticalPreview3D, type GameplayGeometry3D, type NamedTerrainBody3D,
} from 'state-space-engine/experimental/3d/tactical-session';

export const SLAB_RULES = 'hot-slab-game-4';
export const SLAB_WORLD = 'hot-slab-chamber';
export const SLAB_LIMITS = Object.freeze({size: 8, cells: 4, ap: 3, heatBudgetQ: 512, heatDeltaQ: 64,
  liftCells: 2, holdTicks: 4, horizon: 2, maxHorizon: 8, rangeCells: 6});
export const SLAB_HOLD = 'earth-control';
export const SLAB_AIR_IMPULSES = Object.freeze({up: Object.freeze([0, -512, 0] as const),
  west: Object.freeze([-512, 0, 0] as const), east: Object.freeze([512, 0, 0] as const),
  north: Object.freeze([0, 0, -512] as const), south: Object.freeze([0, 0, 512] as const)});
export type SlabAirCommand = {kind: 'air'; unit: 'rider' | 'scout'; direction: keyof typeof SLAB_AIR_IMPULSES};
export type SlabWindCommand = {kind: 'wind'; parcel: 'sand' | 'steam' | 'water'; direction: keyof typeof SLAB_AIR_IMPULSES};
export type SlabGame = {rulesVersion: typeof SLAB_RULES; ap: number; heatBudgetQ: number; turn: number; rng: number;
  slab: number[]; units: NamedTerrainBody3D[]; pendingAir: SlabAirCommand | null; wind: MaterialTransportMemory3D};
export type SlabCommand = {kind: 'lift' | 'release' | 'wait' | 'drift'} | {kind: 'heat'; deltaQ: number} | SlabAirCommand | SlabWindCommand;
export type SlabSnapshot = TacticalSessionSnapshot3D<SlabGame>;
const at = (x: number, y: number, z: number) => x + 8 * (y + 8 * z);
const point = (i: number): [number, number, number] => [i % 8, Math.floor(i / 8) % 8, Math.floor(i / 64)];
const box = (unit: NamedTerrainBody3D) => ({minQ: unit.body.minQ, maxQ: unit.body.minQ.map((v, a) => v + unit.body.sizeQ[a]) as [number, number, number]});
function fields(raw: unknown, keys: readonly string[]): asserts raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
      Reflect.ownKeys(raw).length !== keys.length || keys.some(k => !Object.hasOwn(raw, k)) ||
      Object.values(Object.getOwnPropertyDescriptors(raw)).some(d => !('value' in d) || !d.enumerable)) throw Error('Invalid slab application data.');
}
function integer(n: unknown, lo: number, hi: number): number {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < lo || n > hi) throw Error('Invalid slab integer.'); return n;
}
function dense(v: unknown, length: number): unknown[] {
  if (!Array.isArray(v) || v.length !== length || Reflect.ownKeys(v).length !== length + 1) throw Error('Invalid slab array.');
  for (let i = 0; i < length; i++) {const d = Object.getOwnPropertyDescriptor(v, String(i)); if (!d || !('value' in d) || !d.enumerable) throw Error('Slab arrays require dense data.');}
  return v;
}
export function readSlabCommand(raw: unknown): SlabCommand {
  if (!raw || typeof raw !== 'object') throw Error('Invalid slab command.');
  const kind = Object.getOwnPropertyDescriptor(raw, 'kind');
  if (!kind || !('value' in kind)) throw Error('Invalid slab command kind.');
  if (kind.value === 'heat') {
    fields(raw, ['kind', 'deltaQ']); const deltaQ = integer(raw.deltaQ, -SLAB_LIMITS.heatDeltaQ, SLAB_LIMITS.heatDeltaQ);
    if (deltaQ === 0) throw Error('Heat command needs a nonzero energy change.'); return {kind: 'heat', deltaQ};
  }
  if (kind.value === 'air') {
    fields(raw, ['kind', 'unit', 'direction']);
    if (!['rider', 'scout'].includes(raw.unit as string) || typeof raw.direction !== 'string' || !Object.hasOwn(SLAB_AIR_IMPULSES, raw.direction)) throw Error('Invalid air unit or direction.');
    return {kind: 'air', unit: raw.unit as SlabAirCommand['unit'], direction: raw.direction as SlabAirCommand['direction']};
  }
  if (kind.value === 'wind') {
    fields(raw, ['kind', 'parcel', 'direction']);
    if (!['sand', 'steam', 'water'].includes(raw.parcel as string) || typeof raw.direction !== 'string' || !Object.hasOwn(SLAB_AIR_IMPULSES, raw.direction)) throw Error('Invalid wind parcel or direction.');
    return {kind: 'wind', parcel: raw.parcel as SlabWindCommand['parcel'], direction: raw.direction as SlabWindCommand['direction']};
  }
  fields(raw, ['kind']); if (!['lift', 'release', 'wait', 'drift'].includes(raw.kind as string)) throw Error('Unknown slab command.');
  return {kind: raw.kind as 'lift' | 'release' | 'wait' | 'drift'};
}
/** Validate before a local/controller request can supersede a ready candidate. */
export function readSlabRequest(raw: unknown, horizonTicks: number) {
  const command = readSlabCommand(raw); integer(horizonTicks, 0, SLAB_LIMITS.maxHorizon);
  if (command.kind === 'air' && horizonTicks === 0) throw Error('Air assistance needs at least one preview tick.');
  return {command, horizonTicks};
}
function terrainShape(s: StructuralSnapshot3D) {
  if (s.width !== 8 || s.height !== 8 || s.depth !== 8 || s.chunkSize !== 4) throw Error('This reference scene requires an 8-cubed world.');
}
function readGame(raw: unknown, view: GameplayGeometry3D): SlabGame {
  fields(raw, ['rulesVersion', 'ap', 'heatBudgetQ', 'turn', 'rng', 'slab', 'units', 'pendingAir', 'wind']);
  if (raw.rulesVersion !== SLAB_RULES) throw Error('Incompatible slab game rules.');
  const slab = dense(raw.slab, 4).map(n => integer(n, 0, 511));
  if (slab.some((n, i) => i > 0 && n <= slab[i - 1])) throw Error('Slab identities must be canonical and unique.');
  const units = dense(raw.units, 2).map((row, i) => {
    fields(row, ['id', 'body']); if (row.id !== ['rider', 'scout'][i]) throw Error('Unexpected slab unit identity.');
    const body = readTerrainBody3D(view, row.body as NamedTerrainBody3D['body']);
    if (!view.fit({box: box({id: row.id, body})}).fits) throw Error('Unit is embedded or outside the chamber.');
    return {id: row.id, body};
  });
  if (units[0].body.step !== units[1].body.step) throw Error('Units must share a body-step boundary.');
  const pendingAir = raw.pendingAir === null ? null : readSlabCommand(raw.pendingAir);
  if (pendingAir && pendingAir.kind !== 'air') throw Error('Invalid pending air intent.');
  // Terrain-driven displacement still rejects overlapping final poses. Voluntary
  // actor motion additionally sweeps peers using the SDK's serial actor rules.
  const [a, b] = units.map(box);
  if (a.minQ.every((v, k) => v < b.maxQ[k] && b.minQ[k] < a.maxQ[k])) throw Error('Units overlap.');
  return {rulesVersion: SLAB_RULES, ap: integer(raw.ap, 0, SLAB_LIMITS.ap), heatBudgetQ: integer(raw.heatBudgetQ, 0, SLAB_LIMITS.heatBudgetQ),
    turn: integer(raw.turn, 0, Number.MAX_SAFE_INTEGER), rng: integer(raw.rng, 0, 0xffffffff), slab, units, pendingAir, wind: structuredClone(raw.wind) as MaterialTransportMemory3D};
}
function identities(view: GameplayGeometry3D) {
  const r = view.stamp.kind === 'committed' ? view.stamp.revision : view.stamp.base;
  if (r.worldId !== SLAB_WORLD || r.gameRulesVersion !== SLAB_RULES || view.stamp.domain !== null) throw Error('Wrong slab world identity.');
}
export function createSlabPolicy(): TacticalSessionPolicy3D<SlabGame> {
  return {requiresPaths: true,
    validateGame({game, terrain, holds, reservoirs}) {
      const wind = restoreMaterialTransportMemory3D(terrain, game.wind);
      if (wind.parcels.some(p => !['sand', 'steam', 'water'].includes(p.id))) throw Error('Unknown chamber parcel identity.');
      terrainShape(terrain); if (reservoirs.length || holds.some(h => h.id !== SLAB_HOLD || h.cells.some(i => !game.slab.includes(i)))) return false;
      // Pure construction gives the validator the SDK's branded geometry. It does
      // not advance the temporary session or observe structural support capacity.
      const view = createTacticalSession3D({worldId: SLAB_WORLD, gameRulesVersion: SLAB_RULES, terrain, game: null}).queries();
      if (readGame(game, view).pendingAir !== null) throw Error('A pending air intent cannot be saved or committed.'); return true;
    },
    reduceTranslation({game, receipt, beforeQueries, queries, movement}) {
      const before = beforeQueries(), after = queries(); identities(before); identities(after);
      const current = readGame(game, before), observed = movement(), result = createTranslatedActorGroup3D(before, after, observed).resolve(current.units);
      if (result.status !== 'resolved') throw Error(result.peerContact ? `Terrain motion rejected: actor contact between ${result.peerContact.first} and ${result.peerContact.second}.` :
        result.failure ? `Terrain motion rejected: unit ${result.failure.id} is ${result.failure.response.status}.` : 'Terrain actor response exceeded its shared budget.');
      const moved = new Map(Array.from(receipt.sources, (i, k) => [i, receipt.destinations[k]]));
      return {...current, units: result.bodies, slab: current.slab.map(i => moved.get(i) ?? i).sort((a, b) => a - b),
        wind: followTranslatedMaterialTransport3D(before, after, observed, current.wind).memory};
    },
    reduceTick({game, beforeQueries, queries, movement}) {
      const before = beforeQueries(), after = queries(), observed = movement(); identities(before); identities(after);
      const current = readGame(game, before), result = createTerrainActorGroup3D(before, after, observed).resolve(current.units);
      if (result.status !== 'resolved' || observed.status !== 'complete' || !observed.motion) throw Error('Environmental unit response is unresolved; action was not committed.');
      const air = current.pendingAir, response = moveTerrainActors3D(after, result.bodies, air ? [{id: air.unit, impulseQ: SLAB_AIR_IMPULSES[air.direction]}] : []);
      if (response.status !== 'resolved') throw Error('Unit movement is unresolved; action was not committed.');
      const slab = current.slab.map(i => {for (const [start, destination, length] of observed.motion!.moves) if (i >= start && i < start + length) return destination + i - start; return i;}).sort((a, b) => a - b);
      return {...current, units: response.bodies, slab, pendingAir: null, wind: followMaterialTransport3D(before, after, observed, current.wind).memory};
    },
  };
}

export function createSlabInitial(): TacticalSessionInitial3D<SlabGame> {
  const world = createStateSpaceStructuralWorld3D({width: 8, height: 8, depth: 8, chunkSize: 4});
  for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {world.setCell(x, 7, z, MAT.STONE); world.setAnchor(x, 7, z, true);}
  for (const z of [2, 3]) for (let x = 1; x <= 6; x++) {
    const slab = x === 2 || x === 3; world.setCell(x, 5, z, MAT.STONE, slab ? 120 : 20);
    if (slab) world.setIntegrity(x, 5, z, 96); if (x === 1) world.setAnchor(x, 5, z, true);
  }
  world.setCell(5, 4, 4, MAT.STEAM, 110); world.setCell(4, 5, 4, MAT.WATER, 20); world.setCell(5, 5, 5, MAT.SAND, 20);
  const terrain = world.snapshot(), view = createTacticalSession3D({worldId: SLAB_WORLD, gameRulesVersion: SLAB_RULES, terrain, game: null}).queries();
  const units = [2, 5].map((x, i) => ({id: i ? 'scout' : 'rider', body: createTerrainBody3D(view, {
    minQ: [x * Q + Q / 4, 4 * Q + Q / 4, 2 * Q + Q / 4], sizeQ: [Q / 2, 3 * Q / 4, Q / 2], gravityQ: 64})}));
  return {worldId: SLAB_WORLD, gameRulesVersion: SLAB_RULES, terrain,
    game: {rulesVersion: SLAB_RULES, ap: 3, heatBudgetQ: SLAB_LIMITS.heatBudgetQ, turn: 0, rng: 0x5a17, slab: [at(2, 5, 2), at(3, 5, 2), at(2, 5, 3), at(3, 5, 3)], units, pendingAir: null,
      wind: captureMaterialTransportMemory3D(createMaterialTransport3D(terrain, [{id: 'sand', cell: [5, 5, 5]}, {id: 'steam', cell: [5, 4, 4]}, {id: 'water', cell: [4, 5, 4]}]))}};
}
export function createSlabSession(saved?: SlabSnapshot) {
  const session = createTacticalSession3D(createSlabInitial(), createSlabPolicy()); if (saved !== undefined) session.restore(saved); return session;
}
/** Same synchronous preparation callback for local and worker-owned previews. */
export function prepareSlabCommand(editor: TacticalPreviewEditor3D<SlabGame>, raw: unknown): void {
  const initial = editor.inspect(), {command} = readSlabRequest(raw, initial.preview.horizonTicks), view = editor.queries(); identities(view);
  // Apply the application limit inside shared preparation as well as the local
  // controller, so a worker client cannot request a different ability horizon.
  integer(initial.preview.horizonTicks, 0, SLAB_LIMITS.maxHorizon);
  terrainShape(initial.terrain); const game = readGame(initial.game, view), cost = command.kind === 'wait' ? 0 : 1;
  if (game.pendingAir !== null) throw Error('Resolve the pending air intent before preparing another command.');
  if (game.ap < cost) throw Error('Insufficient AP.'); integer(game.turn + 1, 0, Number.MAX_SAFE_INTEGER);
  const scout = game.units.find(u => u.id === 'scout')!, origin = scout.body.minQ.map(v => Math.floor(v / Q));
  if (['lift', 'release', 'heat'].includes(command.kind) && game.slab.some(i => point(i).reduce((n, v, k) => n + Math.abs(v - origin[k]), 0) > SLAB_LIMITS.rangeCells)) throw Error('Slab is outside control range.');
  if (command.kind === 'wind' || command.kind === 'drift') {
    const controls = restoreMaterialTransportMemory3D(initial.terrain, game.wind), pushed = command.kind === 'wind' ? controls.parcels.find(p => p.id === command.parcel) : undefined;
    if (!controls.parcels.length || (command.kind === 'wind' && !pushed)) throw Error('That parcel is no longer controllable.');
    // Wind reaches only the parcel it pushes. Drift adds no impulse, so a parcel that
    // physics carried out of range never blocks the remaining controls.
    if (pushed && point(pushed.cell).reduce((n, v, k) => n + Math.abs(v - origin[k]), 0) > SLAB_LIMITS.rangeCells) throw Error('Parcel is outside wind range.');
    prepareMaterialTransport3D(editor, game.wind, command.kind === 'wind' ? [{id: command.parcel, impulseQ: SLAB_AIR_IMPULSES[command.direction]}] : [],
      ({game: current, memory}) => ({...current, wind: memory, ap: game.ap - cost, turn: game.turn + 1}));
    return;
  }
  if (command.kind === 'air') {
    const target = game.units.find(u => u.id === command.unit)!;
    if (target.body.minQ.reduce((n, v, k) => n + Math.abs(Math.floor(v / Q) - origin[k]), 0) > SLAB_LIMITS.rangeCells) throw Error('Unit is outside air-assist range.');
  }
  if (command.kind === 'lift') {
    if (game.slab.some(i => (initial.terrain.packedCells[i] & 255) !== MAT.STONE)) throw Error('Only the existing stone slab can be lifted.');
    if (initial.holds.some(h => h.id === SLAB_HOLD)) editor.releaseHold(SLAB_HOLD);
    const receipt = editor.translate({cells: game.slab.map(point), path: [[0, -1, 0], [0, -1, 0]], externalBonds: 'cut', anchors: 'reject', displacement: 'air'});
    editor.hold({id: SLAB_HOLD, cells: Array.from(receipt.destinations, point), expiresAtTick: initial.terrain.tick + SLAB_LIMITS.holdTicks});
  } else if (command.kind === 'release') editor.releaseHold(SLAB_HOLD);
  else if (command.kind === 'heat') {
    const energyCost = Math.abs(command.deltaQ) * game.slab.length;
    if (game.heatBudgetQ < energyCost) throw Error('Insufficient heat resource.');
    editor.addEnergy(game.slab.map(i => {const [x, y, z] = point(i); return {x, y, z, deltaQ: command.deltaQ};}));
  }
  const next = editor.inspect().game;
  editor.setGame({...next, ap: game.ap - cost, heatBudgetQ: game.heatBudgetQ - (command.kind === 'heat' ? Math.abs(command.deltaQ) * game.slab.length : 0), turn: game.turn + 1,
    pendingAir: command.kind === 'air' ? command : null});
}
/** Read-only game presentation, with the exact candidate/committed geometry stamp. */
export function inspectSlab(state: SlabSnapshot | TacticalPreview3D<SlabGame>, view: GameplayGeometry3D) {
  identities(view); terrainShape(state.terrain);
  const stamp = view.stamp, revision = stamp.kind === 'committed' ? stamp.revision : stamp.base;
  const expected = {worldId: state.worldId, revision: state.revision, tick: 'preview' in state ? state.preview.base.tick : state.terrain.tick,
    gameRulesVersion: state.gameRulesVersion, physicsRulesVersion: state.terrain.rulesVersion, materialCatalogHash: state.terrain.materialCatalogHash,
    interventionRulesVersion: state.interventionRulesVersion, sessionRulesVersion: state.rulesVersion, constraintRulesVersion: state.constraintRulesVersion, storageRulesVersion: state.storageRulesVersion};
  if (stamp.tick !== state.terrain.tick || Object.entries(expected).some(([k, v]) => revision[k as keyof typeof revision] !== v) ||
      ('preview' in state) !== (stamp.kind === 'preview')) throw Error('Slab observation boundary differs.');
  if ('preview' in state && stamp.kind === 'preview' && (['branchId', 'operation', 'horizonTicks', 'completedTicks'] as const).some(k => stamp[k] !== state.preview[k])) throw Error('Slab candidate identity differs.');
  const game = readGame(state.game, view);
  if (game.pendingAir !== null) throw Error('Air preview has not completed its first tick.');
  const ray = view.raycast({fromQ: [Q / 2, 3 * Q + Q / 2, 2 * Q + Q / 2], toQ: [7 * Q + Q / 2, 3 * Q + Q / 2, 2 * Q + Q / 2]});
  return {stamp: structuredClone(view.stamp), tick: state.terrain.tick, ap: game.ap, heatBudgetQ: game.heatBudgetQ,
    firingLine: ray.contact === null ? 'open' as const : 'blocked' as const, obstruction: ray.contact,
    units: game.units.map(u => ({id: u.id, body: structuredClone(u.body), support: view.support({box: box(u), maxDropQ: Q}), exposure: view.exposure({box: box(u)})})),
    wind: captureMaterialTransportMemory3D(restoreMaterialTransportMemory3D(state.terrain, game.wind)),
    holds: structuredClone(state.holds), energyAccounting: structuredClone(state.accounting)};
}
