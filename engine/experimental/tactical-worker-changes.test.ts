import { createMicrotaskTransport } from '../test-support/microtask-transport.js';
import { holdPhysics, STRUCTURAL_CALLS } from '../test-support/hold-physics.js';
/** Real endpoint comparison, inert support observations and clone-isolated transport. */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MAT } from './3d.js';

import { CpuStructuralWorld3D, type StructuralSnapshot3D } from './structural-world-core.js';
import { createTacticalSessionCore3D } from './tactical-session-core.js';
import { createTacticalWorkerHost3D } from './tactical-worker-host.js';
import { createTacticalWorkerClient3D, type TacticalWorkerCommit3D } from './tactical-worker-client.js';
import type { TacticalCommit3D } from './tactical-session-view.js';
import type { GameplayChangeReport3D, SupportObserver3D } from './change-reports.js';
import type { Wire } from './tactical-worker-wire.js';
holdPhysics('solveStructure3D', ...STRUCTURAL_CALLS);
afterEach(() => vi.useRealTimers());
function observed(s: StructuralSnapshot3D) {
  const n = s.packedCells.length, result = {distances: new Int32Array(n).fill(-1), loads: new Uint32Array(n), capacities: new Uint32Array(n), reactions: new Uint32Array(n)};
  // A deterministic test seam: local damage affects a distant unedited cell.
  if ((s.structure[21] & 255) !== 255) {result.distances[63] = 1; result.loads[63] = 2;}
  return result;
}
type Game = {ap: number};
type Command = {kind: string};
function fixture(observe: SupportObserver3D = observed, timeoutMs = 10000) {
  const world = new CpuStructuralWorld3D({width: 4, height: 4, depth: 4, chunkSize: 4}); world.setCell(1, 1, 1, MAT.STONE, 120);
  const flask = new CpuStructuralWorld3D({width: 4, height: 4, depth: 4, chunkSize: 4}), observer = vi.fn(observe);
  const session = createTacticalSessionCore3D({worldId: 'report-world', gameRulesVersion: 'report-game', terrain: world.snapshot(),
    game: {ap: 2}, reservoirs: [{id: 'flask', terrain: flask.snapshot()}]}, () => {throw Error('No physical driver');}, {}, async () => {}, observer);
  let latest: TacticalCommit3D<Game> | undefined;
  const {ports, sent, closed, setRewrite: intercept, deliver} = createMicrotaskTransport<Wire>();  const host = createTacticalWorkerHost3D(ports[1], {...session, get revision() {return session.revision;}, commit(branch) {latest = session.commit(branch); return latest;}}, (editor, command: Command) => {
    if (command.kind === 'damage') editor.edit([{kind: 'integrity', x: 1, y: 1, z: 1, integrity: 200}]);
    else if (command.kind === 'heat') editor.addEnergy([{x: 1, y: 1, z: 1, deltaQ: 1}]);
    else if (command.kind === 'transfer') editor.transfer({from: null, to: 'flask', cells: [[1, 1, 1]], offset: [0, 0, 0]});
    else if (command.kind === 'hold') editor.hold({id: 'lift', cells: [[1, 1, 1]], expiresAtTick: 2});
    else if (command.kind === 'wide') editor.edit(Array.from({length: 18}, (_, n) => {
      const i = n + 3; return {kind: 'material', x: i % 4, y: Math.floor(i / 4) % 4, z: Math.floor(i / 16), material: MAT.SAND};
    }));
    else if (command.kind === 'roundtrip') {editor.translate({cells: [[1, 1, 1]], path: [[1, 0, 0]]}); editor.translate({cells: [[2, 1, 1]], path: [[-1, 0, 0]]});}
    else if (command.kind !== 'game') throw Error('Unknown command');
    editor.setGame({ap: 1});
  }, 'report-channel');
  const client = createTacticalWorkerClient3D<Game, Command>(ports[0], {channel: 'report-channel', worldId: 'report-world', gameRulesVersion: 'report-game', timeoutMs});
  return {client, host, session, observer, sent, closed, latest: () => latest!, intercept, deliver};
}
async function commit(f: ReturnType<typeof fixture>, kind = 'damage') {const ticket = f.client.request({kind}, 0); expect((await ticket.result).status).toBe('ready'); return f.client.commit(ticket);}
async function finish(f: ReturnType<typeof fixture>) {if (f.client.state.status !== 'failed') await f.client.close(); await f.host.close();}

describe('worker endpoint change reports with inert support observations', () => {
  test('local damage retains distant support reach and matches the direct committed report', async () => {
    const f = fixture(); await f.client.ready; const c = await commit(f); expect(f.observer).not.toHaveBeenCalled();
    const report = await f.client.changes(c); expect(report).toEqual(f.latest().changes());
    expect(report.domains[0].channels.structure.runs).toEqual([[21, 1]]); expect(report.domains[0].channels.support.runs).toEqual([[63, 1]]);
    expect(report.domains[0].channels.support.bounds).toEqual({min: [3, 3, 3], max: [4, 4, 4]}); await finish(f);
  });
  test('zero detail budget retains complete coarse counts and bounds without partial runs', async () => {
    const f = fixture(); await f.client.ready; const c = await commit(f), r = await f.client.changes(c, {maxRuns: 0});
    expect(r).toEqual(f.latest().changes({maxRuns: 0})); expect(r.domains[0].channels.support).toEqual({mode: 'bounds', count: 1,
      bounds: {min: [3, 3, 3], max: [4, 4, 4]}, runs: [], requiresFullRead: true}); await finish(f);
  });
  test('one run budget is shared across channels and reservoir domains', async () => {
    const f = fixture(); await f.client.ready; const c = await commit(f, 'transfer'), r = await f.client.changes(c, {maxRuns: 1});
    expect(r).toEqual(f.latest().changes({maxRuns: 1})); expect(r.domains.map(d => d.domain)).toEqual([null, 'flask']);
    expect(r.domains[1].channels.material).toMatchObject({mode: 'bounds', count: 1, requiresFullRead: true});
    expect(r.domains.flatMap(d => Object.values(d.channels)).reduce((n, c) => n + c.runs.length, 0)).toBeLessThanOrEqual(1); await finish(f);
  });
  test('accounted heat reports energy and exact temperature independently from material', async () => {
    const f = fixture(); await f.client.ready; const c = await commit(f, 'heat'), r = await f.client.changes(c);
    expect(r).toEqual(f.latest().changes()); expect(r.accountingChanged).toBe(true);
    expect(r.domains[0].channels.energy.runs).toEqual([[21, 1]]); expect(r.domains[0].channels.material.count).toBe(0); await finish(f);
  });
  test('temporary constraints and multi-row coalesced runs keep their exact report representation', async () => {
    for (const kind of ['hold', 'wide']) {
      const f = fixture(); await f.client.ready; const c = await commit(f, kind), r = await f.client.changes(c);
      expect(r).toEqual(f.latest().changes());
      if (kind === 'hold') expect(r.domains[0].channels.constraints.runs).toEqual([[21, 1]]);
      else expect(r.domains[0].channels.material).toMatchObject({runs: [[3, 18]], count: 18, bounds: {min: [0, 0, 0], max: [4, 4, 2]}});
      await finish(f);
    }
  });
  test('game-only report invokes no support observation and leaves committed state unchanged', async () => {
    const f = fixture(); await f.client.ready; const c = await commit(f, 'game'), before = f.client.snapshot(), r = await f.client.changes(c);
    expect(r.gameChanged).toBe(true); expect(r.accountingChanged).toBe(false); expect(f.observer).not.toHaveBeenCalled();
    expect(f.client.snapshot()).toEqual(before); expect(f.session.snapshot()).toEqual(before); await finish(f);
  });
  test('endpoint reports do not invent matter correspondence for round trips', async () => {
    const f = fixture(); await f.client.ready; const c = await commit(f, 'roundtrip'), r = await f.client.changes(c);
    expect(r.motion).toEqual({status: 'not-observed', reason: 'endpoint-states-do-not-identify-matter', requiresExecutionTrace: true});
    expect(Object.values(r.domains[0].channels).every(c => c.count === 0)).toBe(true); await finish(f);
  });
  test('mutated returned commit fields and report data cannot change private provenance', async () => {
    const f = fixture(); await f.client.ready; const c = await commit(f), before = f.client.snapshot();
    c.receipt.revision = 999; c.snapshot.game.ap = -1; const r = await f.client.changes(c); r.domains[0].channels.support.runs[0][0] = 0;
    expect((await f.client.changes(c)).to).toEqual({kind: 'committed', revision: f.session.revision});
    expect(f.client.snapshot()).toEqual(before); expect(f.session.snapshot()).toEqual(before); await finish(f);
  });
  test('foreign and copied commit handles reject before dispatch', async () => {
    const a = fixture(), b = fixture(); await Promise.all([a.client.ready, b.client.ready]); const c = await commit(a);
    expect(() => b.client.changes(c)).toThrow(/latest/); expect(() => a.client.changes({...c})).toThrow(/latest/);
    expect(() => a.client.changes(null as unknown as TacticalWorkerCommit3D<Game>)).toThrow(/latest/);
    expect(a.sent[0].filter(m => m.kind === 'changes')).toHaveLength(0); await finish(a); await finish(b);
  });
  test('a newer commit expires the earlier handle instead of silently reporting another action', async () => {
    const f = fixture(); await f.client.ready; const old = await commit(f), next = await commit(f, 'heat');
    expect(() => f.client.changes(old)).toThrow(/latest/); const r = await f.client.changes(next);
    expect(r.from.revision).toBe(1); expect(r.to).toEqual({kind: 'committed', revision: f.session.revision}); await finish(f);
  });
  test('successful restore invalidates the report handle', async () => {
    const f = fixture(); await f.client.ready; const saved = f.client.snapshot(), c = await commit(f); await f.client.restore(saved);
    expect(() => f.client.changes(c)).toThrow(/latest/); expect(f.sent[0].filter(m => m.kind === 'changes')).toHaveLength(0); await finish(f);
  });
  test('invalid options reject locally and do not invalidate the report or ready preview', async () => {
    const f = fixture(); await f.client.ready; const c = await commit(f), t = f.client.request({kind: 'game'}, 0); await t.result;
    const getter = vi.fn(); for (const options of [{maxRuns: -1}, {maxRuns: 4097}, {extra: 1}, Object.defineProperty({}, 'maxRuns', {get: getter, enumerable: true})]) {
      expect(() => f.client.changes(c, options)).toThrow();
    }
    expect(getter).not.toHaveBeenCalled(); expect(f.client.state.readyId).toBe(t.id); await f.client.changes(c); await f.client.commit(t); await finish(f);
  });
  test('support observer failure is a read error after a successful atomic commit', async () => {
    const f = fixture(() => {throw Error('Observation failed');}); await f.client.ready; const c = await commit(f), committed = f.client.snapshot();
    const t = f.client.request({kind: 'game'}, 0); await t.result;
    await expect(f.client.changes(c)).rejects.toThrow(/Observation/); expect(f.client.state).toMatchObject({status: 'ready', readyId: t.id, uncertain: false});
    expect(f.client.snapshot()).toEqual(committed); expect(f.session.snapshot()).toEqual(committed); await f.client.commit(t); await finish(f);
  });
  test('out-of-band revision changes reject at the host before support observation', async () => {
    const f = fixture(); await f.client.ready; const c = await commit(f); f.session.restore(f.session.snapshot());
    await expect(f.client.changes(c)).rejects.toThrow(/Stale/); expect(f.observer).not.toHaveBeenCalled(); expect(f.client.state.uncertain).toBe(false); await finish(f);
  });
  test('pending report excludes mutations, previews and other reads', async () => {
    const f = fixture(); await f.client.ready; const c = await commit(f); let held: Wire | undefined;
    f.intercept((m, side) => {if (side === 1 && m.kind === 'changes') {held = m; return null;} return m;});
    const pending = f.client.changes(c); await Promise.resolve(); await Promise.resolve();
    expect(() => f.client.changes(c)).toThrow(/idle/); expect(() => f.client.query([{kind: 'fit', request: {box: {minQ: [0, 0, 0], maxQ: [1, 1, 1]}}}])).toThrow(/idle/);
    expect(() => f.client.request({kind: 'game'}, 0)).toThrow(/in flight/); expect(() => f.client.restore(c.snapshot)).toThrow(/idle/);
    f.deliver(0, held!); await pending; await finish(f);
  });
  test('report timeout retains the committed state without retry or uncertain mutation', async () => {
    vi.useFakeTimers(); const f = fixture(observed, 30); await f.client.ready; const c = await commit(f), before = f.client.snapshot();
    f.intercept((m, side) => side === 1 && m.kind === 'changes' ? null : m);
    const failed = expect(f.client.changes(c)).rejects.toThrow(/timed out/); await vi.advanceTimersByTimeAsync(31); await failed;
    expect(f.client.state).toMatchObject({status: 'failed', uncertain: false}); expect(f.client.snapshot()).toEqual(before); expect(f.session.snapshot()).toEqual(before);
    expect(f.sent[0].filter(m => m.kind === 'changes')).toHaveLength(1); await finish(f);
  });
  test('malformed stamps, domains, runs and coarse prefixes fail closed', async () => {
    const changes: ((r: GameplayChangeReport3D) => void)[] = [r => {r.from = {...r.from, revision: 99};}, r => {r.domains[0].width = 3;},
      r => {r.domains[0].channels.support.count = 2;}, r => {r.domains[0].channels.support.runs[0][0] = 62;},
      r => {r.domains[0].channels.support.mode = 'bounds'; r.domains[0].channels.support.requiresFullRead = true;},
      r => {r.runBudget = 0;}, r => {r.domains.pop();}];
    for (const change of changes) {
      const f = fixture(); await f.client.ready; const c = await commit(f), before = f.client.snapshot();
      f.intercept((m, side) => {if (side === 1 && m.kind === 'changes') change(m.payload as GameplayChangeReport3D); return m;});
      await expect(f.client.changes(c)).rejects.toThrow(); expect(f.client.state.uncertain).toBe(false); expect(f.client.snapshot()).toEqual(before); await finish(f);
    }
  });
  test('close waits for an outstanding report before disposing its endpoint', async () => {
    const f = fixture(); await f.client.ready; const c = await commit(f), pending = f.client.changes(c), close = f.client.close();
    expect(f.closed[0]).toBe(false); await pending; await close; expect(f.closed[0]).toBe(true); await f.host.close();
  });
  test('version two peers cannot supply version three change reports', async () => {
    const f = fixture(); await f.client.ready; const c = await commit(f);
    f.intercept((m, side) => side === 1 && m.kind === 'changes' ? {...m, protocol: 'tactical-worker-2'} as unknown as Wire : m);
    await expect(f.client.changes(c)).rejects.toThrow(/Incompatible/); await finish(f);
  });
});
