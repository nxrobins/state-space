import { holdPhysics } from '../test-support/hold-physics.js';
import { describe, expect, test, vi } from 'vitest';
import { MAT } from './3d.js';

import { CpuStructuralWorld3D, type StructuralSnapshot3D } from './structural-world-core.js';
import { createTacticalSessionCore3D, type TacticalSimulationFactory3D } from './tactical-session-core.js';
import { createTacticalSession3D } from './tactical-session.js';
import type { TacticalSessionPolicy3D } from './tactical-session-view.js';
import { MOTION_TRACE_RULES_3D, type MaterialMotionTrace3D } from './motion-trace.js';
import { MOTION_PATH_RULES_3D, type MaterialMotionPaths3D } from './motion-paths.js';
import { appendPathFrame3D, createPathJournal3D, readPathJournal3D, type PathJournalFrame3D, type TickMovement3D } from './path-journal.js';
import type { GameplayGeometry3D } from './gameplay-geometry.js';

// Only real edits and inert domain drivers. No production material ticks/solves.
holdPhysics('solveStructure3D', 'step', 'stepWithMotion', 'stepWithMotionPaths');
const world = () => new CpuStructuralWorld3D({width: 4, height: 4, depth: 4, chunkSize: 4});
type Game = {ap: number; tick: number};
function observation(s: StructuralSnapshot3D, swapped = false): {motion: MaterialMotionTrace3D; paths: MaterialMotionPaths3D} {
  const common = {width: s.width, height: s.height, depth: s.depth, physicsRulesVersion: s.rulesVersion, materialCatalogHash: s.materialCatalogHash, fromTick: s.tick - 1, toTick: s.tick, status: 'complete' as const, requiresReexecution: false};
  return {motion: {...common, rulesVersion: MOTION_TRACE_RULES_3D, movedCells: swapped ? 2 : 0, touchedCells: swapped ? 2 : 0, fragmentCount: 0, fragmentCells: 0,
    moves: swapped ? [[0, 4, 1], [4, 0, 1]] : [], touched: swapped ? [[0, 1], [4, 1]] : [], fragments: []},
    paths: {...common, rulesVersion: MOTION_PATH_RULES_3D, passesObserved: 28, cellTransfers: swapped ? 2 : 0,
      passes: swapped ? [{index: 1, segments: [{origin: 0, from: 0, to: 4, mode: 'linear'}, {origin: 4, from: 4, to: 0, mode: 'linear'}]}] : []}};
}
function frame(swapped = false): PathJournalFrame3D {return {domain: null, operation: 1, ...observation({...world().snapshot(), tick: 1}, swapped)};}
function fixture(options: {reservoirs?: number; swapped?: boolean; missing?: boolean; closeFails?: boolean;
  paths?: (value: MaterialMotionPaths3D, domain: string | null) => MaterialMotionPaths3D | Promise<MaterialMotionPaths3D>;
  policy?: TacticalSessionPolicy3D<Game>; seed?: StructuralSnapshot3D} = {}) {
  const requested: {domain: string | null; motion: boolean; motionLimit: number; paths: boolean; pathLimit: number}[] = [], closed: (string | null)[] = [], pathReads: (string | null)[] = [];
  const factory: TacticalSimulationFactory3D = (input, domain, motion, motionLimit, paths, pathLimit) => {
    requested.push({domain, motion, motionLimit, paths, pathLimit}); let state = structuredClone(input);
    return {load(value) {state = structuredClone(value);}, step() {state.tick++;}, snapshot: () => state,
      motion: () => observation(state, options.swapped).motion,
      ...(!options.missing ? {paths() {pathReads.push(domain); const value = observation(state, options.swapped).paths; return options.paths ? options.paths(value, domain) : value;}} : {}),
      close() {closed.push(domain); if (options.closeFails) throw Error('fixture cleanup failure');}};
  };
  const terrain = options.seed ?? world().snapshot();
  const s = createTacticalSessionCore3D({worldId: 'path-world', gameRulesVersion: 'path-game-1', terrain, game: {ap: 2, tick: 0},
    reservoirs: Array.from({length: options.reservoirs ?? 0}, (_, i) => ({id: 'flask' + i, terrain: world().snapshot()}))}, factory, options.policy, async () => {});
  return {s, requested, closed, pathReads};
}

describe('bounded pure path journals', () => {
  test('disabled capture is explicit and cannot accept frames', () => {
    const data = createPathJournal3D(false); expect(() => appendPathFrame3D(data, frame())).toThrow(/disabled/);
    expect(data).toEqual({status: 'disabled', recordsObserved: 0, entries: 0, frames: []});
  });
  test('empty frames cost one entry and record 257 clears the entire retained prefix', () => {
    const data = createPathJournal3D(true), f = frame(); for (let i = 0; i < 256; i++) appendPathFrame3D(data, f);
    expect(data).toMatchObject({status: 'complete', entries: 256, recordsObserved: 256});
    appendPathFrame3D(data, f); expect(data).toEqual({status: 'overflow', entries: 0, recordsObserved: 257, frames: []});
  });
  test('net and path detail share one exact budget with frame overhead', () => {
    const data = createPathJournal3D(true), f = frame(true); data.entries = 65528; appendPathFrame3D(data, f);
    expect(data).toMatchObject({status: 'complete', entries: 65536}); appendPathFrame3D(data, f);
    expect(data).toMatchObject({status: 'overflow', entries: 0, frames: [], recordsObserved: 2});
  });
  test('either incomplete record clears all detail and later frames only increase counts', () => {
    for (const kind of ['motion', 'paths'] as const) {
      const data = createPathJournal3D(true), f = frame(); appendPathFrame3D(data, f); f[kind].status = 'overflow';
      appendPathFrame3D(data, f); appendPathFrame3D(data, frame()); expect(data).toEqual({status: 'overflow', entries: 0, recordsObserved: 3, frames: []});
    }
  });
  test('reads isolate every nested array and freeze full revision identities', () => {
    const {s} = fixture(), data = createPathJournal3D(true); appendPathFrame3D(data, frame(true));
    const read = () => readPathJournal3D(data, s.revision, {kind: 'committed', revision: s.revision}), a = read(), b = read();
    a.frames[0].paths.passes[0].segments[0].origin = 60; a.frames[0].motion.moves.length = 0;
    expect(read()).toEqual(b); expect(Object.isFrozen(b.from)).toBe(true); expect(Object.isFrozen(b.to)).toBe(true);
  });
});

describe('tactical capture with inert domain execution', () => {
  test('default and net-only branches never request paths', async () => {
    for (const captureMotion of [false, true]) {
      const {s, requested, pathReads} = fixture(), b = s.branch({horizonTicks: 1, captureMotion}); await b.advance(1); const r = s.commit(b);
      expect(pathReads).toEqual([]); expect(requested[0].paths).toBe(false); expect(r.paths()).toMatchObject({status: 'disabled', requiresReexecution: true, frames: []});
    }
  });
  test('zero-horizon public branches expose a complete empty path journal without stepping', () => {
    const s = createTacticalSession3D({worldId: 'zero', gameRulesVersion: 'zero-1', terrain: world().snapshot(), game: {ap: 2}});
    const b = s.branch({horizonTicks: 0, capturePaths: true}), r = s.commit(b);
    expect(r.paths()).toMatchObject({status: 'complete', recordsObserved: 0, entries: 0, frames: [], includesSubpassPaths: true, includesInterventions: false});
  });
  test('capture implies net motion and preserves ordered primary/reservoir and operation identities', async () => {
    const {s, requested} = fixture({reservoirs: 1, swapped: true}), b = s.branch({horizonTicks: 2, capturePaths: true, pathMaxEntries: 3});
    await b.advance(1); b.setGame({ap: 1, tick: 1}); await b.advance(1);
    const preview = b.paths(), r = s.commit(b), committed = r.paths();
    expect(committed.frames.map(f => [f.domain, f.operation, f.paths.fromTick, f.paths.toTick])).toEqual([[null, 1, 0, 1], ['flask0', 1, 0, 1], [null, 3, 1, 2], ['flask0', 3, 1, 2]]);
    expect(committed.frames).toEqual(preview.frames); expect(committed.to).toMatchObject({kind: 'committed', revision: {revision: 1}});
    expect(requested.every(r => r.motion && r.paths && r.pathLimit === 3)).toBe(true); expect(r.motion().includesSubpassPaths).toBe(false);
  });
  test('invalid flags, contradictory capture and unsupported detail budgets reject before allocating branches', () => {
    const {s, requested} = fixture();
    for (const patch of [{capturePaths: 1}, {capturePaths: true, captureMotion: false}, {pathMaxEntries: 1}, {capturePaths: true, pathMaxEntries: -1}, {capturePaths: true, pathMaxEntries: 65537}, {capturePaths: true, pathMaxEntries: 0.5}]) expect(() => s.branch({horizonTicks: 0, ...patch} as never)).toThrow();
    expect(requested).toEqual([]); expect(s.branch({horizonTicks: 0, capturePaths: true}).paths().status).toBe('complete');
  });
  test('requiresPaths cannot be disabled or changed by later policy mutation', async () => {
    const policy: TacticalSessionPolicy3D<Game> = {requiresPaths: true, reduceTick: ({game, movement}) => {expect(movement().status).toBe('complete'); return game;}};
    const {s, requested} = fixture({policy}); policy.requiresPaths = false;
    expect(() => s.branch({horizonTicks: 1, capturePaths: false})).toThrow(/required/); expect(() => s.branch({horizonTicks: 1, captureMotion: false})).toThrow(/net motion/);
    const b = s.branch({horizonTicks: 1}); await b.advance(1); s.commit(b); expect(requested[0].paths).toBe(true);
    expect(() => fixture({policy: {requiresPaths: true}})).toThrow(/reducer/);
  });
  test('missing driver support fails atomically and closes every created domain', async () => {
    const {s, closed} = fixture({reservoirs: 1, missing: true}), before = s.snapshot(), b = s.branch({horizonTicks: 1, capturePaths: true});
    await expect(b.advance(1)).rejects.toThrow(/requested paths/); expect(s.snapshot()).toEqual(before); expect(closed).toEqual(['flask0', null]); expect(() => b.paths()).toThrow(/failed/);
  });
  test('malformed reservoir paths cannot publish already staged primary state or invoke the reducer', async () => {
    const reduceTick = vi.fn(({game}: {game: Game}) => game), {s, closed} = fixture({reservoirs: 1, policy: {reduceTick}, paths: (p, domain) => domain ? {...p, toTick: 99} : p});
    const before = s.snapshot(), b = s.branch({horizonTicks: 1, capturePaths: true}); await expect(b.advance(1)).rejects.toThrow(/identity/);
    expect(s.snapshot()).toEqual(before); expect(reduceTick).not.toHaveBeenCalled(); expect(closed).toEqual(['flask0', null]);
  });
  test('valid detail above the requested per-tick budget rejects before publication', async () => {
    const {s} = fixture({swapped: true}), before = s.snapshot(), b = s.branch({horizonTicks: 1, capturePaths: true, pathMaxEntries: 2});
    await expect(b.advance(1)).rejects.toThrow(/requested detail/); expect(s.snapshot()).toEqual(before);
  });
  test('a declared overflow remains observable without inventing partial paths', async () => {
    const seen: TickMovement3D[] = [], {s} = fixture({swapped: true, paths: p => ({...p, status: 'overflow', requiresReexecution: true, passes: []}),
      policy: {reduceTick: ({game, movement}) => {seen.push(movement()); return game;}}});
    const b = s.branch({horizonTicks: 1, capturePaths: true, pathMaxEntries: 0}); await b.advance(1); const r = s.commit(b);
    expect(r.paths()).toMatchObject({status: 'overflow', frames: [], recordsObserved: 1, requiresReexecution: true});
    expect(seen[0]).toMatchObject({scope: 'logical-tick-domain', status: 'overflow', paths: {passes: [], cellTransfers: 2}});
  });
  test('disabled movement is explicit inside reducers and unknown domains reject', async () => {
    const {s} = fixture({policy: {reduceTick: ({game, movement, beforeQueries}) => {
      expect(movement()).toMatchObject({status: 'disabled', motion: null, paths: null, requiresReexecution: true});
      expect(() => movement({domain: 'missing'})).toThrow(/Unknown/); expect(() => beforeQueries({domain: 'missing'})).toThrow(/Unknown/); return game;
    }}}); const b = s.branch({horizonTicks: 1}); await b.advance(1); s.commit(b);
  });
  test('all domains validate before exact start/end queries and movement reach the reducer', async () => {
    const seen: number[][] = [], {s, pathReads} = fixture({reservoirs: 1, policy: {requiresPaths: true, reduceTick: ({game, tick, queries, beforeQueries, movement}) => {
      expect(pathReads).toHaveLength(tick * 2); expect(beforeQueries()).toBe(beforeQueries());
      for (const domain of [null, 'flask0']) {
        const m = movement({domain}); expect(m.from).toEqual(beforeQueries({domain}).stamp); expect(m.to).toEqual(queries({domain}).stamp);
        seen.push([m.from.tick, m.to.tick, m.paths!.fromTick, m.paths!.toTick]);
      }
      return {...game, tick};
    }}}); const before = s.snapshot(), b = s.branch({horizonTicks: 2}); await b.advance(2);
    expect(s.snapshot()).toEqual(before); expect(s.commit(b).snapshot.game.tick).toBe(2); expect(seen).toEqual([[0, 1, 0, 1], [0, 1, 0, 1], [1, 2, 1, 2], [1, 2, 1, 2]]);
  });
  test('retained callbacks keep the original terrain, movement and operation after edits and commit', async () => {
    const retained: {before: () => GameplayGeometry3D; after: () => GameplayGeometry3D; motion: () => TickMovement3D}[] = [];
    const w = world(); w.setCell(1, 1, 1, MAT.WATER);
    const {s} = fixture({seed: w.snapshot(), swapped: true, policy: {requiresPaths: true, reduceTick: ({game, beforeQueries, queries, movement}) => {retained.push({before: beforeQueries, after: queries, motion: movement}); return game;}}});
    const b = s.branch({horizonTicks: 2}); await b.advance(1); b.edit([{kind: 'material', x: 1, y: 1, z: 1, material: MAT.ICE}]); await b.advance(1); s.commit(b);
    const box = {minQ: [1024, 1024, 1024] as const, maxQ: [2048, 2048, 2048] as const};
    expect(retained[0].before().exposure({box}).materials[0].material).toBe(MAT.WATER); expect(retained[1].before().exposure({box}).materials[0].material).toBe(MAT.ICE);
    expect(retained[0].motion().from).toMatchObject({operation: 1, tick: 0, completedTicks: 0}); expect(retained[1].motion().to).toMatchObject({operation: 3, tick: 2, completedTicks: 2});
    const output = retained[0].motion(); output.paths!.passes[0].segments[0].origin = 60; expect(retained[0].motion().paths!.passes[0].segments[0].origin).toBe(0);
  });
  test('long-horizon retention overflow does not remove valid per-tick actor input', async () => {
    let calls = 0; const {s} = fixture({reservoirs: 8, policy: {requiresPaths: true, reduceTick: ({game, movement}) => {
      calls++; expect(movement().status).toBe('complete'); expect(movement({domain: 'flask7'}).status).toBe('complete'); return game;
    }}}); const b = s.branch({horizonTicks: 29}); await b.advance(29); const r = s.commit(b);
    expect(calls).toBe(29); expect(r.paths()).toMatchObject({status: 'overflow', recordsObserved: 261, frames: [], entries: 0, requiresReexecution: true});
  });
  test('cleanup and reducer failures publish neither journal nor terrain/game state', async () => {
    for (const kind of ['cleanup', 'reducer']) {
      const {s, closed} = fixture({closeFails: kind === 'cleanup', policy: kind === 'reducer' ? {reduceTick: () => {throw Error('fixture reducer failure');}} : undefined});
      const before = s.snapshot(), b = s.branch({horizonTicks: 1, capturePaths: true}); await expect(b.advance(1)).rejects.toThrow();
      expect(s.snapshot()).toEqual(before); expect(closed).toEqual([null]); expect(() => b.paths()).toThrow(/failed/);
    }
  });
  test('cancellation during asynchronous path retrieval discards private data and cleans the driver', async () => {
    let entered!: () => void, release!: () => void; const waiting = new Promise<void>(resolve => {entered = resolve;}), resume = new Promise<void>(resolve => {release = resolve;});
    const {s, closed} = fixture({paths: async p => {entered(); await resume; return p;}}), before = s.snapshot(), b = s.branch({horizonTicks: 1, capturePaths: true}), controller = new AbortController();
    const pending = b.advance(1, {signal: controller.signal}); await waiting; controller.abort(); release(); await expect(pending).rejects.toThrow(/discarded/);
    expect(s.snapshot()).toEqual(before); expect(closed).toEqual([null]); expect(() => b.paths()).toThrow(/discarded/);
  });
  test('stale previews reject, while committed journals survive restore and caller mutation', async () => {
    const {s} = fixture({swapped: true}), saved = s.snapshot(), b = s.branch({horizonTicks: 1, capturePaths: true}), stale = s.branch({horizonTicks: 0, capturePaths: true});
    await b.advance(1); const r = s.commit(b), expected = r.paths(); expect(() => stale.paths()).toThrow(/stale/);
    r.paths().frames[0].paths.passes.length = 0; r.snapshot.terrain.tick = 99; s.restore(saved); expect(r.paths()).toEqual(expected);
    expect('paths' in saved).toBe(false); expect('capturePaths' in saved).toBe(false);
  });
});
