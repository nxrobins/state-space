import { afterAll, describe, expect, test, vi } from 'vitest';
import { MAT } from './3d.js';
import { ANCHOR_3D, BONDS_3D } from './structural-mechanics.js';
import { CpuStructuralWorld3D, type StructuralSnapshot3D } from './structural-world-core.js';
import { createTacticalSession3D } from './tactical-session.js';
import { createTacticalSessionCore3D, type TacticalSimulationFactory3D } from './tactical-session-core.js';
import type { TacticalSessionInitial3D, TacticalSessionPolicy3D, TacticalSessionSnapshot3D } from './tactical-session-view.js';
import type { MaterialReservoir3D, MaterialTransferRequest3D } from './material-reservoirs.js';

// These authored tests are CPU edits and inert drivers only. Runtime remains held.
const physicalStep = vi.spyOn(CpuStructuralWorld3D.prototype, 'step').mockImplementation(() => {throw Error('Physical runtime validation is held.');});
afterAll(() => {expect(physicalStep).not.toHaveBeenCalled(); physicalStep.mockRestore();});
type Game = {ap: number; turn: number};
function volume(width = 4) {return new CpuStructuralWorld3D({width, height: 4, depth: 4, chunkSize: 4});}
function initial(material: number = MAT.WATER): TacticalSessionInitial3D<Game> {
  const world = volume(), flask = volume(8);
  world.setCell(1, 1, 1, material, 150);
  return {worldId: 'storage-world', gameRulesVersion: 'storage-game-1', terrain: world.snapshot(),
    reservoirs: [{id: 'flask', terrain: flask.snapshot()}], game: {ap: 2, turn: 0}};
}
const extract: MaterialTransferRequest3D = {from: null, to: 'flask', cells: [[1, 1, 1]], offset: [2, 0, 0]};
function totals(s: {terrain: StructuralSnapshot3D; reservoirs: readonly MaterialReservoir3D[]}) {
  const counts: Record<number, number> = {}; let energy = 0n, volume = 0;
  for (const d of [s.terrain, ...s.reservoirs.map(r => r.terrain)]) for (let i = 0; i < d.packedCells.length; i++) {
    const id = d.packedCells[i] & 255; counts[id] = (counts[id] ?? 0) + 1; energy += BigInt(d.energyQ[i]); if (id !== MAT.AIR) volume++;
  }
  return {counts, energy, volume};
}
function mock(source = initial(), policy: TacticalSessionPolicy3D<Game> = {}, callbacks: {
  create?: (domain: string | null) => void;
  step?: (s: StructuralSnapshot3D, domain: string | null) => void | Promise<void>;
  close?: (domain: string | null) => void;
} = {}) {
  const steps: {domain: string | null; tick: number}[] = [], closed: (string | null)[] = [], created: (string | null)[] = [];
  const factory: TacticalSimulationFactory3D = (snapshot, domain) => {
    callbacks.create?.(domain); created.push(domain); let state = structuredClone(snapshot);
    return {
      load(s) {state = structuredClone(s);},
      async step() {steps.push({domain, tick: state.tick}); if (callbacks.step) await callbacks.step(state, domain); else state.tick++;},
      snapshot: () => state,
      close() {closed.push(domain); callbacks.close?.(domain);},
    };
  };
  return {session: createTacticalSessionCore3D(source, factory, policy, async () => {}), steps, closed, created};
}

describe('conservative reservoirs: real edits, no physical advancement', () => {
  test('hot water and displaced air exchange exactly and return without a fresh seed', () => {
    const session = createTacticalSession3D(initial()), before = session.snapshot(), branch = session.branch({horizonTicks: 0});
    const receipt = branch.transfer(extract), preview = branch.inspect();
    expect(session.snapshot()).toEqual(before); expect(totals(preview)).toEqual(totals(before));
    expect(preview.terrain.packedCells[21]).toBe(before.reservoirs[0].terrain.packedCells[43]);
    expect(preview.terrain.energyQ[21]).toBe(before.reservoirs[0].terrain.energyQ[43]);
    expect(preview.reservoirs[0].terrain.packedCells[43]).toBe(before.terrain.packedCells[21]);
    expect(preview.reservoirs[0].terrain.energyQ[43]).toBe(before.terrain.energyQ[21]);
    expect(BigInt(receipt.sourceEnergyDeltaQ) + BigInt(receipt.destinationEnergyDeltaQ)).toBe(0n);
    expect(receipt).toMatchObject({externalEnergyQ: '0', from: null, to: 'flask', sources: [21], destinations: [43]});
    branch.transfer({from: 'flask', to: null, cells: [[3, 1, 1]], offset: [-2, 0, 0]});
    const result = session.commit(branch); expect(result.snapshot.terrain).toEqual(before.terrain);
    expect(result.snapshot.reservoirs).toEqual(before.reservoirs); expect(result.snapshot.accounting).toEqual(before.accounting);
  });

  test('damaged bonded ice crosses different geometries without repair or welding', () => {
    const world = volume(), flask = volume(8);
    world.setCell(1, 1, 1, MAT.ICE, 20); world.setCell(2, 1, 1, MAT.ICE, 20);
    world.setIntegrity(1, 1, 1, 37); world.setIntegrity(2, 1, 1, 91);
    flask.setCell(5, 1, 1, MAT.STONE);
    const session = createTacticalSession3D({...initial(), terrain: world.snapshot(), reservoirs: [{id: 'flask', terrain: flask.snapshot()}]});
    const before = session.snapshot(), branch = session.branch({horizonTicks: 0});
    branch.transfer({...extract, cells: [[2, 1, 1], [1, 1, 1]]}); const after = session.commit(branch).snapshot;
    expect(totals(after)).toEqual(totals(before));
    expect(after.reservoirs[0].terrain.structure[43]).toBe(37 | BONDS_3D[1]);
    expect(after.reservoirs[0].terrain.structure[44]).toBe(91 | BONDS_3D[0]);
    expect(after.reservoirs[0].terrain.structure[45]).toBe(before.reservoirs[0].terrain.structure[45]);
    expect(after.reservoirs[0].terrain.energyQ[43]).toBe(before.terrain.energyQ[21]);
  });

  test('external bonds and permanent pins require explicit policies and cut reciprocally', () => {
    const world = volume(); world.setCell(1, 1, 1, MAT.STONE); world.setCell(2, 1, 1, MAT.STONE); world.setAnchor(1, 1, 1, true);
    const source = {...initial(), terrain: world.snapshot()}, session = createTacticalSession3D(source), before = session.snapshot();
    for (const request of [extract, {...extract, anchors: 'release' as const}]) {
      const b = session.branch({horizonTicks: 0}); expect(() => b.transfer(request)).toThrow(); expect(session.snapshot()).toEqual(before);
    }
    const b = session.branch({horizonTicks: 0}), receipt = b.transfer({...extract, anchors: 'release', externalBonds: 'cut'});
    const after = session.commit(b).snapshot;
    expect(receipt.releasedAnchors).toEqual([21]); expect(receipt.cutBonds).toEqual([[21, 22]]);
    expect(receipt.sourceEditedCells).toContain(22); expect(after.terrain.structure[22] & BONDS_3D[0]).toBe(0);
    expect(after.reservoirs[0].terrain.structure[43]).toBe(255); expect(totals(after)).toEqual(totals(before));
  });

  test('mobile displacement returns the destination liquid rather than deleting it', () => {
    const source = initial(MAT.SAND), flask = volume(8); flask.setCell(3, 1, 1, MAT.WATER, 100); source.reservoirs = [{id: 'flask', terrain: flask.snapshot()}];
    const session = createTacticalSession3D(source), before = session.snapshot(), blocked = session.branch({horizonTicks: 0});
    expect(() => blocked.transfer(extract)).toThrow(/obstructed/);
    const b = session.branch({horizonTicks: 0}); b.transfer({...extract, displacement: 'mobile'}); const after = session.commit(b).snapshot;
    expect(after.terrain.packedCells[21]).toBe(before.reservoirs[0].terrain.packedCells[43]);
    expect(after.reservoirs[0].terrain.packedCells[43]).toBe(before.terrain.packedCells[21]); expect(totals(after)).toEqual(totals(before));
  });

  test('intact solids and pinned broken matter block mobile displacement', () => {
    for (const broken of [false, true]) {
      const source = initial(), flask = volume(8); flask.setCell(3, 1, 1, MAT.STONE);
      if (broken) {flask.setIntegrity(3, 1, 1, 0); flask.setAnchor(3, 1, 1, true);}
      source.reservoirs = [{id: 'flask', terrain: flask.snapshot()}];
      const session = createTacticalSession3D(source), before = session.snapshot(), b = session.branch({horizonTicks: 0});
      expect(() => b.transfer({...extract, displacement: 'mobile'})).toThrow(/obstructed/); expect(session.snapshot()).toEqual(before);
    }
  });

  test('temporary held sources must be released and cannot be displaced as targets', () => {
    const session = createTacticalSession3D(initial(MAT.STONE)), before = session.snapshot(), held = session.branch({horizonTicks: 0});
    held.hold({id: 'suspension', cells: [[1, 1, 1]], expiresAtTick: 2});
    expect(() => held.transfer({...extract, anchors: 'release'})).toThrow(/Release held matter/); expect(session.snapshot()).toEqual(before);
    const free = session.branch({horizonTicks: 0}); free.hold({id: 'suspension', cells: [[1, 1, 1]], expiresAtTick: 2}); free.releaseHold('suspension'); free.transfer(extract);
    expect(session.commit(free).snapshot.holds).toEqual([]);
    const fill = session.branch({horizonTicks: 0}); fill.edit([{kind: 'material', x: 1, y: 1, z: 1, material: MAT.STONE}, {kind: 'integrity', x: 1, y: 1, z: 1, integrity: 0}]);
    fill.hold({id: 'blocked', cells: [[1, 1, 1]], expiresAtTick: 2});
    expect(() => fill.transfer({from: 'flask', to: null, cells: [[3, 1, 1]], offset: [-2, 0, 0], displacement: 'mobile'})).toThrow(/obstructed/);
  });

  test('reservoir-to-reservoir handoffs leave primary terrain and holds untouched', () => {
    const source = initial(MAT.STONE), other = volume(8); other.setCell(2, 1, 1, MAT.WATER, 180);
    source.reservoirs = [...source.reservoirs!, {id: 'other', terrain: other.snapshot()}];
    const session = createTacticalSession3D(source), before = session.snapshot(), b = session.branch({horizonTicks: 0});
    b.hold({id: 'slab', cells: [[1, 1, 1]], expiresAtTick: 3});
    b.transfer({from: 'other', to: 'flask', cells: [[2, 1, 1]], offset: [1, 0, 0]});
    const after = session.commit(b).snapshot; expect(after.terrain).toEqual(before.terrain); expect(after.holds).toHaveLength(1);
    expect(totals(after)).toEqual(totals(before)); expect(after.accounting).toEqual(before.accounting);
  });

  test('invalid domains, coordinates, duplicates and late bounds errors never partially commit', () => {
    const requests = [null, {...extract, from: 'missing'}, {...extract, to: null}, {...extract, to: ''},
      {...extract, cells: []}, {...extract, cells: new Array(1)}, {...extract, cells: new Array(65537)},
      {...extract, cells: [[1, 1, 1], [1, 1, 1]]}, {...extract, cells: [[0, 0, 0]]},
      {...extract, cells: [[1, 1, 1], [4, 1, 1]]}, {...extract, offset: [7, 0, 0]},
      {...extract, offset: [0.5, 0, 0]}, {...extract, offset: [0, 0]}, {...extract, anchors: null}, {...extract, extra: true}];
    for (const request of requests) {
      const session = createTacticalSession3D(initial()), before = session.snapshot(), b = session.branch({horizonTicks: 0});
      b.setGame({ap: 0, turn: 0}); expect(() => b.transfer(request as never)).toThrow(); expect(b.status).toBe('failed'); expect(session.snapshot()).toEqual(before);
    }
  });

  test('caller ordering cannot change canonical transfers or receipts', () => {
    const world = volume(); world.setCell(1, 1, 1, MAT.WATER, 50); world.setCell(2, 1, 1, MAT.WATER, 150);
    const source = {...initial(), terrain: world.snapshot()}, a = createTacticalSession3D(source), b = createTacticalSession3D(source);
    const x = a.branch({horizonTicks: 0}), y = b.branch({horizonTicks: 0});
    const first = x.transfer({...extract, cells: [[1, 1, 1], [2, 1, 1]]}), second = y.transfer({...extract, cells: [[2, 1, 1], [1, 1, 1]]});
    expect(first).toEqual(second);
    const left = a.commit(x), right = b.commit(y);
    // Retained inspection callbacks have different identities; compare their data.
    expect(left.snapshot).toEqual(right.snapshot); expect(left.receipt).toEqual(right.receipt);
    expect(left.motion()).toEqual(right.motion()); expect(left.journal()).toEqual(right.journal());
  });

  test('saved domains, inputs, receipt arrays and previews own their memory', () => {
    const source = initial(), session = createTacticalSession3D(source), before = session.snapshot(); source.reservoirs![0].terrain.energyQ.fill(0);
    expect(session.snapshot()).toEqual(before); const b = session.branch({horizonTicks: 0}), receipt = b.transfer(extract);
    receipt.sources.fill(0); const preview = b.inspect(); preview.reservoirs[0].terrain.packedCells.fill(0); preview.reservoirs[0].id = 'changed';
    const committed = session.commit(b), expected = session.snapshot(); committed.snapshot.reservoirs[0].terrain.energyQ.fill(0);
    expect(session.snapshot()).toEqual(expected); const restored = session.restore(JSON.parse(JSON.stringify(expected)));
    expect(restored.reservoirs).toEqual(expected.reservoirs); expect(restored.accounting).toEqual(expected.accounting);
  });

  test('genesis includes reservoir energy and rejects incomplete accounting', () => {
    const source = initial(), session = createTacticalSession3D(source), state = session.snapshot();
    expect(BigInt(state.accounting.initialQ)).toBe(totals(state).energy); expect(state.accounting.externalQ).toBe('0');
    const onlyWorld = source.terrain.energyQ.reduce((sum, q) => sum + BigInt(q), 0n);
    expect(() => createTacticalSession3D({...source, accounting: {initialQ: onlyWorld.toString(), externalQ: '0'}})).toThrow(/balance/);
    const b = session.branch({horizonTicks: 0}); b.transfer(extract); b.addEnergy([{x: 0, y: 0, z: 0, deltaQ: 3}]); const result = session.commit(b);
    expect(result.receipt.externalEnergyQ).toBe('3'); expect(totals(result.snapshot).energy).toBe(BigInt(state.accounting.initialQ) + 3n);
  });

  test('invalid saved state, tick, versions and topology reject before replacing live state', () => {
    const session = createTacticalSession3D(initial()), saved = session.snapshot(), r = saved.reservoirs[0];
    const bad = [{...saved, schemaVersion: 2}, {...saved, storageRulesVersion: 'unknown'}, {...saved, reservoirs: []},
      {...saved, reservoirs: null}, {...saved, reservoirs: [r, r]}, {...saved, reservoirs: [{...r, id: 'renamed'}]},
      {...saved, reservoirs: [{...r, terrain: {...r.terrain, tick: 1}}]}, {...saved, reservoirs: [{...r, terrain: {...r.terrain, width: 4}}]},
      {...saved, reservoirs: [{...r, terrain: {...r.terrain, energyQ: []}}]}, {...saved, reservoirs: [{...r, terrain: {...r.terrain, rulesVersion: 'different'}}]}];
    for (const value of bad) {expect(() => session.restore(value as never)).toThrow(); expect(session.snapshot()).toEqual(saved);}
  });

  test('capacity, domain count and malformed records fail before oversized state allocation', () => {
    const source = initial(), r = source.reservoirs![0];
    for (const reservoirs of [new Array(1), Array(9).fill(r), [{...r, extra: true}],
      [{...r, terrain: {...r.terrain, width: 128, height: 128, depth: 128}}]]) {
      expect(() => createTacticalSession3D({...source, reservoirs} as never)).toThrow();
    }
    const getter = vi.fn(() => r.terrain), bad = Object.defineProperty({id: 'flask'}, 'terrain', {get: getter, enumerable: true});
    expect(() => createTacticalSession3D({...source, reservoirs: [bad]} as never)).toThrow(); expect(getter).not.toHaveBeenCalled();
    const widthGetter = vi.fn(() => 8), cellsGetter = vi.fn(() => 0);
    const terrain = Object.defineProperty({...r.terrain}, 'width', {get: widthGetter, enumerable: true});
    expect(() => createTacticalSession3D({...source, reservoirs: [{id: 'flask', terrain}]})).toThrow();
    const cells = r.terrain.energyQ.slice(); Object.defineProperty(cells, '0', {get: cellsGetter, enumerable: true});
    expect(() => createTacticalSession3D({...source, reservoirs: [{id: 'flask', terrain: {...r.terrain, energyQ: cells}}]})).toThrow();
    expect(widthGetter).not.toHaveBeenCalled(); expect(cellsGetter).not.toHaveBeenCalled();
  });

  test('game policy and stale revisions prevent otherwise valid material transfers', () => {
    const session = createTacticalSession3D(initial(), {validateGame: ({game, reservoirs}) => game.ap >= 0 && reservoirs.length === 1}), before = session.snapshot();
    const bad = session.branch({horizonTicks: 0}); bad.transfer(extract); bad.setGame({ap: -1, turn: 0});
    expect(() => session.commit(bad)).toThrow(/policy/); expect(session.snapshot()).toEqual(before);
    const stale = session.branch({horizonTicks: 0}), winner = session.branch({horizonTicks: 0}); stale.transfer(extract); winner.setGame({ap: 1, turn: 0});
    const newer = session.commit(winner); expect(() => session.commit(stale)).toThrow(/stale/); expect(session.snapshot()).toEqual(newer.snapshot);
  });
});

describe('reservoir tick protocol: inert drivers only', () => {
  test('all domains advance sequentially before one complete game boundary is visible', async () => {
    const source = initial(); source.terrain.tick = 7; source.reservoirs![0].terrain.tick = 7;
    const second = volume().snapshot(); second.tick = 7; source.reservoirs = [{id: 'z-last', terrain: second}, ...source.reservoirs!];
    const boundaries: number[][] = [], {session, steps, closed} = mock(source, {reduceTick: ({game, terrain, reservoirs, tick}) => {
      boundaries.push([tick, terrain.tick, ...reservoirs.map(r => r.terrain.tick)]); reservoirs[0].terrain.energyQ[0] = 0; return {...game, turn: game.turn + 1};
    }});
    const before = session.snapshot(), b = session.branch({horizonTicks: 2}); b.transfer(extract); await b.advance(2);
    expect(session.snapshot()).toEqual(before); expect(boundaries).toEqual([[8, 8, 8, 8], [9, 9, 9, 9]]);
    expect(steps).toEqual([{domain: null, tick: 7}, {domain: 'flask', tick: 7}, {domain: 'z-last', tick: 7}, {domain: null, tick: 8}, {domain: 'flask', tick: 8}, {domain: 'z-last', tick: 8}]);
    expect(closed).toEqual(['z-last', 'flask', null]); const result = session.commit(b);
    expect(result.snapshot.game.turn).toBe(2); expect(totals(result.snapshot)).toEqual(totals(before));
  });

  test('a reservoir step failure cannot publish the already-advanced main world', async () => {
    const reduced = vi.fn(({game}: {game: Game}) => game), {session, closed, steps} = mock(initial(), {reduceTick: reduced}, {step(s, domain) {if (domain) throw Error('storage solve failure'); s.tick++;}});
    const before = session.snapshot(), b = session.branch({horizonTicks: 1}); b.transfer(extract); b.setGame({ap: 0, turn: 0});
    await expect(b.advance(1)).rejects.toThrow(/storage solve/); expect(reduced).not.toHaveBeenCalled(); expect(steps).toHaveLength(2);
    expect(closed).toEqual(['flask', null]); expect(session.snapshot()).toEqual(before); expect(b.status).toBe('failed');
  });

  test('partial driver creation failure closes previously created domains', async () => {
    const {session, closed, steps} = mock(initial(), {}, {create(domain) {if (domain) throw Error('storage creation failure');}}), before = session.snapshot(), b = session.branch({horizonTicks: 1});
    await expect(b.advance(1)).rejects.toThrow(/storage creation/); expect(closed).toEqual([null]); expect(steps).toEqual([]); expect(session.snapshot()).toEqual(before);
  });

  test('cleanup visits every driver even when a reservoir close fails', async () => {
    const {session, closed} = mock(initial(), {}, {close(domain) {if (domain) throw Error('storage close failure');}}), before = session.snapshot(), b = session.branch({horizonTicks: 1});
    await expect(b.advance(1)).rejects.toThrow(/cleanup/); expect(closed).toEqual(['flask', null]); expect(session.snapshot()).toEqual(before);
  });

  test.each(['tick', 'energy', 'geometry'] as const)('invalid reservoir %s output rejects the whole tick', async problem => {
    const {session, closed} = mock(initial(), {}, {step(s, domain) {
      s.tick++; if (domain) {if (problem === 'tick') s.tick++; if (problem === 'energy') s.energyQ[0]++; if (problem === 'geometry') s.chunkSize = 8;}
    }}), before = session.snapshot(), b = session.branch({horizonTicks: 1});
    await expect(b.advance(1)).rejects.toThrow(); expect(closed).toEqual(['flask', null]); expect(session.snapshot()).toEqual(before);
  });

  test('discard during a reservoir tick waits for cleanup and publishes no partial boundary', async () => {
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(r => {entered = r;}), gate = new Promise<void>(r => {release = r;});
    const {session, closed} = mock(initial(), {}, {async step(s, domain) {if (domain) {entered(); await gate;} s.tick++;}});
    const before = session.snapshot(), b = session.branch({horizonTicks: 2}); b.transfer(extract); const pending = b.advance(2); await waiting;
    expect(b.progress.inFlightCompletedTicks).toBe(0); b.discard(); expect(closed).toEqual([]); release(); await expect(pending).rejects.toThrow(/discarded/);
    expect(closed).toEqual(['flask', null]); expect(session.snapshot()).toEqual(before);
  });

  test('mock snapshot continuation matches uninterrupted domain state across odd ticks', async () => {
    const a = mock(initial(), {reduceTick: ({game}) => ({...game, turn: game.turn + 1})}), b = mock(initial(), {reduceTick: ({game}) => ({...game, turn: game.turn + 1})});
    for (const {session} of [a, b]) {const edit = session.branch({horizonTicks: 0}); edit.transfer(extract); session.commit(edit);}
    const long = a.session.branch({horizonTicks: 3}); await long.advance(3); const expected = a.session.commit(long).snapshot;
    const first = b.session.branch({horizonTicks: 1}); await first.advance(1); const save = b.session.commit(first).snapshot;
    b.session.restore(JSON.parse(JSON.stringify(save))); const rest = b.session.branch({horizonTicks: 2}); await rest.advance(2); const actual = b.session.commit(rest).snapshot;
    expect({...actual, revision: expected.revision} satisfies TacticalSessionSnapshot3D<Game>).toEqual(expected); expect(b.steps).toEqual(a.steps);
  });
});
