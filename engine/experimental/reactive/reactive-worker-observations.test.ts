import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
import { createWorkerBus } from '../../test-support/worker-bus.js';
/** Exact tiny observations and mock ports; old M5/native execution remains held. */
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import {
  createReactiveMaterialRegistry3D,
  defaultReactiveMaterialCatalog3D,
  createReactiveMaterialBlock3D as block,
  editReactiveMaterialBlock3D as edit,
  createReactiveWorldSnapshot3D as world,
  createReactiveDomainsSnapshot3D as domains,
  createReactiveSession3D as session,
  createReactiveChangeJob3D as changes,
  createReactiveWorkerHost3D as host,
  createReactiveWorkerClient3D as client,
  MAT,
  type ReactiveMaterialRegistry3D,
  type ReactiveMaterialEdit3D,
  type ReactiveSessionCommand3D,
  type ReactiveWorkerQuery3D,
  type ReactiveChangeJob3D,
  type ReactiveChangeReport3D,
  type ReactiveGameplayGeometry3D,
} from '../reactive-materials.js';
import { readReactiveChangeReport3D } from './reactive-worker-changes.js';
import { reactiveWorkerGeometryStamp3D } from './reactive-worker-queries.js';
import type { ReactiveWorkerWire3D } from './reactive-worker-wire.js';
holdPhysics('volumeStep', 'solveStructure3D', ...STRUCTURAL_CALLS);
let r: ReactiveMaterialRegistry3D;
beforeAll(async () => {
  const c = defaultReactiveMaterialCatalog3D();
  for (const m of c.propertiesCatalog.materials) m.properties.conductivity = 0;
  const base = await createReactiveMaterialRegistry3D(c),
    wood = base.material(MAT.WOOD);
  r = await base.extend([
    { ...wood, id: 200, name: 'resin', properties: { ...wood.properties, fuel_energy: 120 } },
  ]);
});
type Game = { ap: number };
type V = [number, number, number];
const place = (
  x = 0,
  y = 1,
  z = 0,
  material: number = MAT.STONE,
  thermal = 70,
): ReactiveMaterialEdit3D => ({ kind: 'place', x, y, z, material, thermal });
const bond = (x: number, bonded = true): ReactiveMaterialEdit3D => ({
  kind: 'bond',
  x,
  y: 1,
  z: 0,
  direction: 1,
  bonded,
});
const bridge = () => [
  ...Array.from({ length: 5 }, (_, x) => place(x)),
  ...Array.from({ length: 4 }, (_, x) => bond(x)),
  { kind: 'anchor', x: 0, y: 1, z: 0, anchored: true } as ReactiveMaterialEdit3D,
];
function initial(edits = bridge()) {
  const b = edit(r, block(r, { width: 5, height: 3, depth: 1 }), edits).block;
  const flask = edit(r, block(r, { width: 1, height: 2, depth: 1 }), [
    place(0, 1, 0, MAT.WATER),
  ]).block;
  return {
    worldId: 'observations',
    gameRulesVersion: 'observations-1',
    domains: domains(r, world(r, b, 3), [{ id: 'flask', world: world(r, flask, 3) }]),
    game: { ap: 2 },
  };
}
const cut: ReactiveSessionCommand3D<Game> = { kind: 'edit', domain: null, edits: [bond(0, false)] };
const cellBox = (x: number, y = 1) => ({
  minQ: [x * 1024, y * 1024, 0] as V,
  maxQ: [(x + 1) * 1024, (y + 1) * 1024, 1024] as V,
});
const fit: ReactiveWorkerQuery3D = { kind: 'fit', request: { box: cellBox(4) } };
const finish = (job: ReactiveChangeJob3D, work = 64) => {
  let n = 0;
  while (job.progress().status === 'running') {
    if (++n > 10000) throw Error('Tiny diagnostic bound');
    job.advance(work);
  }
  return job.result();
};
function endpoints(command: ReactiveSessionCommand3D<Game> = cut, init = initial(), ticks = 0) {
  const s = session(r, init),
    before = s.queries(),
    saved = s.snapshot(),
    branch = s.branch({ horizonTicks: ticks });
  branch.enqueue(command);
  for (let n = 0; branch.progress().status !== 'ready'; n++) {
    if (n > 10000) throw Error('Tiny branch bound');
    branch.advance();
  }
  return { s, before, after: branch.queries(), branch, saved, preview: branch.inspect() };
}
function fixture(init = initial()) {
  const bus = createWorkerBus<ReactiveWorkerWire3D>(20000);
  const h = host(bus.ports[1], r, init, {}, { channel: 'observe', work: 4 });
  const c = client<Game>(bus.ports[0], r, {
    channel: 'observe',
    worldId: init.worldId,
    gameRulesVersion: init.gameRulesVersion,
    timeoutMs: 10000,
    schedule: bus.schedule,
  });
  resources.push(() => {
    bus.errors[0](Error('cleanup'));
    h.close();
  });
  return { ...bus, c, h, init };
}
const resources: (() => void)[] = [];
afterEach(() => {
  for (const release of resources.splice(0)) release();
  vi.useRealTimers();
});
async function ready(init = initial()) {
  const f = fixture(init);
  await f.settle(f.c.ready);
  return f;
}
async function preview(f: Awaited<ReturnType<typeof ready>>, commands = [cut]) {
  const t = f.c.request(commands, { horizonTicks: 0 });
  expect((await f.settle(t.result)).status).toBe('ready');
  return t;
}
async function close(f: Awaited<ReturnType<typeof ready>>) {
  await f.settle(f.c.close());
  expect(f.closed).toEqual([true, true]);
}
const indices = (c: ReactiveChangeReport3D['channels']['support']) =>
  c.runs.flatMap(([start, length]) => Array.from({ length }, (_, j) => start + j));

describe('resumable reactive endpoint changes', () => {
  test('cutting one bond reports support changes at the remote bridge end', () => {
    const f = endpoints(),
      out = finish(changes(r, f.before, f.after));
    expect(indices(out.channels.structure)).toEqual([5, 6]);
    expect(indices(out.channels.support)).toContain(9);
    expect(out.channels.support.bounds).toEqual({ min: [0, 1, 0], max: [5, 2, 1] });
    expect(out.channels.material.count).toBe(0);
    expect(f.s.snapshot()).toEqual(f.saved);
    expect(f.branch.inspect()).toEqual(f.preview);
  });
  test('support assessment never applies proposed fragment motion or damage', () => {
    const f = endpoints({
      kind: 'edit',
      domain: null,
      edits: [{ kind: 'anchor', x: 0, y: 1, z: 0, anchored: false }],
    });
    const state = f.branch.inspect().state,
      job = changes(r, f.before, f.after);
    const result = finish(job, 1);
    expect(result.channels.support.count).toBe(5);
    expect(f.branch.inspect().state).toEqual(state);
    expect(state.domains.world.block.structure[9] & 255).toBe(255);
  });
  test('work budgets produce identical reports and bound cell scans', () => {
    const f = endpoints(),
      a = changes(r, f.before, f.after),
      b = changes(r, f.before, f.after);
    expect(a.advance(1).scannedCells).toBe(1);
    expect(a.advance(1).scannedCells).toBe(2);
    expect(finish(a, 1)).toEqual(finish(b, 256));
  });
  test('identical endpoints skip both support solves and report no differences', () => {
    const s = session(r, initial()),
      q = s.queries(),
      j = changes(r, q, q);
    expect(j.advance(256).status).toBe('complete');
    expect(Object.values(j.result().channels).every((c) => c.count === 0)).toBe(true);
    expect(j.result().motion).toEqual({ status: 'not-observed', requiresExecutionTrace: true });
  });
  test('cancellation at each diagnostic phase cannot publish partial ranges', () => {
    const f = endpoints();
    for (const phase of ['scan', 'support-before', 'support-after', 'support-compare'] as const) {
      const j = changes(r, f.before, f.after);
      while (j.progress().phase !== phase) j.advance(1);
      expect(j.cancel()).toBe(true);
      expect(j.cancel()).toBe(false);
      expect(() => j.result()).toThrow();
      expect(() => j.advance()).toThrow();
    }
    expect(f.s.snapshot()).toEqual(f.saved);
  });
  test('zero run budget retains exact counts and full distant bounds', () => {
    const f = endpoints(),
      full = finish(changes(r, f.before, f.after)),
      bounded = finish(changes(r, f.before, f.after, { maxRuns: 0 }));
    for (const name of Object.keys(full.channels) as (keyof typeof full.channels)[]) {
      expect(bounded.channels[name].count).toBe(full.channels[name].count);
      expect(bounded.channels[name].bounds).toEqual(full.channels[name].bounds);
      if (full.channels[name].count)
        expect(bounded.channels[name]).toMatchObject({
          mode: 'bounds',
          runs: [],
          requiresFullRead: true,
        });
    }
  });
  test('one shared budget bounds all channels and discards incomplete runs', () => {
    const f = endpoints({
      kind: 'edit',
      domain: null,
      edits: [place(0, 0, 0, MAT.WATER), place(2, 0, 0, MAT.WATER)],
    });
    const full = finish(changes(r, f.before, f.after)),
      out = finish(changes(r, f.before, f.after, { maxRuns: 1 }));
    expect(Object.values(out.channels).reduce((n, c) => n + c.runs.length, 0)).toBeLessThanOrEqual(
      1,
    );
    expect(out.channels.packed).toMatchObject({
      mode: 'bounds',
      count: 2,
      runs: [],
      bounds: full.channels.packed.bounds,
    });
  });
  test('custom fuel sensible temperature and chemical energy use the custom catalog', () => {
    const init = initial([place(0, 1, 0, 200, 70)]),
      s = session(r, init),
      q = s.snapshot().domains.world.block.energyQ[5];
    const f = endpoints(
        {
          kind: 'edit',
          domain: null,
          edits: [{ kind: 'energy', x: 0, y: 1, z: 0, energyQ: q + 256 }],
        },
        init,
      ),
      out = finish(changes(r, f.before, f.after));
    expect(indices(out.channels.energy)).toEqual([5]);
    expect(indices(out.channels.temperature)).toEqual([5]);
    expect(out.channels.material.count).toBe(0);
  });
  test('temporary constraints report metadata and actual remote support effects', () => {
    const init = initial(bridge().filter((e) => e.kind !== 'anchor'));
    const held = endpoints(
      { kind: 'hold', domain: null, request: { id: 'lift', expiresAtTick: 8, cells: [[0, 1, 0]] } },
      init,
    );
    const out = finish(changes(r, held.before, held.after));
    expect(indices(out.channels.constraints)).toEqual([5]);
    expect(out.channels.structure.count).toBe(0);
    expect(indices(out.channels.support)).toContain(9);
  });
  test('retained reports and caller-mutated results remain isolated', () => {
    const f = endpoints(),
      j = changes(r, f.before, f.after),
      expected = finish(j);
    const edited = j.result();
    edited.channels.support.runs.length = 0;
    (edited.from as { domain: string | null }).domain = 'wrong';
    expect(j.result()).toEqual(expected);
    f.s.commit(f.branch);
    expect(j.result()).toEqual(expected);
    expect(j.cancel()).toBe(false);
  });
  test('foreign geometry, domains, dimensions and malformed limits reject', () => {
    const f = endpoints();
    expect(() => changes(r, { ...f.before } as ReactiveGameplayGeometry3D, f.after)).toThrow();
    expect(() => changes(r, f.before, f.s.queries('flask'))).toThrow();
    expect(() => changes(r, f.before, f.after, { maxRuns: -1 })).toThrow();
    expect(() => changes(r, f.before, f.after).advance(257)).toThrow();
  });
  test('translation endpoints cannot claim an executed path or identify identical matter', () => {
    const init = initial([place(0, 0, 0, MAT.WATER), place(1, 0, 0, MAT.WATER)]),
      s = session(r, init),
      out = finish(changes(r, s.queries(), s.queries()));
    expect(out.scope).toBe('endpoints');
    expect(out.motion.requiresExecutionTrace).toBe(true);
    expect(out.channels.material.count).toBe(0);
  });
});
describe('reactive worker observations', () => {
  test('all five geometry answers match the exact committed SDK views', async () => {
    const f = await ready(initial([place(1)])),
      s = session(r, f.init),
      view = s.queries();
    const requests: ReactiveWorkerQuery3D[] = [
      { kind: 'fit', request: { box: cellBox(1) } },
      { kind: 'support', request: { box: cellBox(1, 0), maxDropQ: 1024 } },
      { kind: 'raycast', request: { fromQ: [0, 1536, 512], toQ: [5120, 1536, 512] } },
      { kind: 'sweep', request: { box: cellBox(0), deltaQ: [4096, 0, 0] } },
      { kind: 'exposure', request: { box: cellBox(1) } },
    ];
    const out = await f.settle(f.c.query(requests));
    for (let i = 0; i < requests.length; i++) {
      const q = requests[i];
      expect(out.results[i].value).toEqual(
        (view[q.kind] as (request: unknown) => unknown)(q.request),
      );
    }
    expect(f.maximum()).toBe(1);
    await close(f);
  });
  test('custom material filters and temperatures survive the worker boundary', async () => {
    const f = await ready(initial([place(0, 1, 0, 200)])),
      q = session(r, f.init).queries();
    const out = await f.settle(
      f.c.query([
        { kind: 'fit', request: { box: cellBox(0), materials: [200] } },
        { kind: 'exposure', request: { box: cellBox(0) } },
      ]),
    );
    expect(out.results[0].value).toEqual(q.fit({ box: cellBox(0), materials: [200] }));
    expect(out.results[1].value).toEqual(q.exposure({ box: cellBox(0) }));
    await close(f);
  });
  test('reservoir query answers retain their own domain and dimensions', async () => {
    const f = await ready(),
      out = await f.settle(
        f.c.query([{ kind: 'exposure', domain: 'flask', request: { box: cellBox(0) } }]),
      );
    expect(out.results[0]).toMatchObject({
      domain: 'flask',
      value: { stamp: { domain: 'flask' } },
    });
    await close(f);
  });
  test('only one query executes per inspection slice with no full-state reply', async () => {
    const f = await ready(),
      pending = f.c.query([fit, fit]);
    await f.until(() => f.sent[1].some((m) => m.kind === 'inspect-advance'));
    expect(f.c.state.status).toBe('working');
    const out = await f.settle(pending);
    expect(out.results).toHaveLength(2);
    const replies = f.sent[1].filter((m) => m.kind === 'inspect-advance');
    expect(replies).toHaveLength(2);
    expect((replies[0].payload as { result: unknown }).result).toBeNull();
    expect(JSON.stringify(replies)).not.toContain('packedCells');
    await close(f);
  });
  test('preview queries identify the latest ready branch and cannot mutate it', async () => {
    const f = await ready(),
      t = await preview(f),
      result = await t.result;
    if (result.status !== 'ready') throw Error('ready');
    const out = await f.settle(f.c.queryPreview(t, [fit]));
    expect(out.results[0].value.stamp).toMatchObject({
      kind: 'preview',
      branchId: result.preview.branchId,
      completedCommands: 1,
    });
    out.results.length = 0;
    expect((await f.settle(f.c.commit(t))).snapshot.revision).toBe(1);
    await close(f);
  });
  test('preview reports include remote support and match committed report channels', async () => {
    const f = await ready(),
      t = await preview(f),
      p = await f.settle(f.c.changesPreview(t));
    expect(indices(p.channels.support)).toContain(9);
    const commit = await f.settle(f.c.commit(t)),
      c = await f.settle(f.c.changes(commit));
    expect(c.channels).toEqual(p.channels);
    expect(c.to.kind).toBe('committed');
    expect(p.to.kind).toBe('preview');
    await close(f);
  });
  test('worker report matches the direct resumable diagnostic exactly', async () => {
    const f = await ready(),
      t = await preview(f),
      direct = endpoints(),
      expected = finish(changes(r, direct.before, direct.after));
    expect(await f.settle(f.c.changesPreview(t))).toEqual(expected);
    await close(f);
  });
  test('one physical tick reports collapse beyond the cut and matches direct execution', async () => {
    const f = await ready(),
      t = f.c.request([cut], { horizonTicks: 1 }),
      outcome = await f.settle(t.result);
    if (outcome.status !== 'ready') throw Error('ready');
    const direct = endpoints(cut, f.init, 1),
      expected = finish(changes(r, direct.before, direct.after));
    const report = await f.settle(f.c.changesPreview(t));
    expect(report).toEqual(expected);
    expect(indices(report.channels.material)).toContain(9);
    expect(outcome.preview.state).toEqual(direct.preview.state);
    const committed = await f.settle(f.c.commit(t));
    expect(committed).toEqual(direct.s.commit(direct.branch));
    await close(f);
  });
  test('reports for an unchanged reservoir avoid unrelated world support changes', async () => {
    const f = await ready(),
      t = await preview(f),
      report = await f.settle(f.c.changesPreview(t, 'flask'));
    expect(Object.values(report.channels).every((c) => c.count === 0)).toBe(true);
    expect(report.to.domain).toBe('flask');
    await close(f);
  });
  test('worker overflow preserves counts and full bounds without partial runs', async () => {
    const f = await ready(),
      t = await preview(f),
      out = await f.settle(f.c.changesPreview(t, null, { maxRuns: 0 }));
    expect(out.channels.support).toMatchObject({
      mode: 'bounds',
      count: 5,
      requiresFullRead: true,
      runs: [],
    });
    await close(f);
  });
  test('explicit inspection cancellation preserves the ready preview', async () => {
    const f = await ready(),
      t = await preview(f),
      pending = f.c.changesPreview(t),
      rejection = expect(pending).rejects.toThrow(/cancelled/);
    await f.until(() => f.sent[0].some((m) => m.kind === 'inspect-advance'));
    expect(f.c.cancelInspection()).toBe(true);
    await f.until(() => f.c.state.inspection === null && f.c.state.status === 'ready');
    await rejection;
    expect((await f.settle(f.c.commit(t))).snapshot.revision).toBe(1);
    await close(f);
  });
  test('new intent supersedes inspection before discarding its parent preview', async () => {
    const f = await ready(),
      t = await preview(f),
      pending = f.c.changesPreview(t),
      rejection = expect(pending).rejects.toThrow(/superseded/);
    const next = f.c.request([], { horizonTicks: 0 });
    expect((await f.settle(next.result)).status).toBe('ready');
    await rejection;
    const kinds = f.sent[0].map((m) => m.kind);
    expect(kinds.indexOf('inspect-cancel')).toBeLessThan(kinds.indexOf('discard'));
    expect(f.maximum()).toBe(1);
    await close(f);
  });
  test('cancelling the parent ticket rejects its pending query and prevents commit', async () => {
    const f = await ready(),
      t = await preview(f),
      pending = f.c.queryPreview(t, [fit, fit]),
      rejection = expect(pending).rejects.toThrow(/cancelled/);
    t.cancel();
    await f.until(() => f.c.state.activeId === null);
    await rejection;
    expect(() => f.c.commit(t)).toThrow();
    await close(f);
  });
  test('a completed but superseded inspection reply is rejected as stale', async () => {
    const f = await ready(),
      t = await preview(f),
      pending = f.c.queryPreview(t, [fit]),
      rejection = expect(pending).rejects.toThrow(/superseded/);
    await f.until(() =>
      f.sent[1].some(
        (m) => m.kind === 'inspect-advance' && (m.payload as { result: unknown }).result !== null,
      ),
    );
    const next = f.c.request([], { horizonTicks: 0 });
    expect((await f.settle(next.result)).status).toBe('ready');
    await rejection;
    expect(f.maximum()).toBe(1);
    await close(f);
  });
  test('read errors reject only the inspection and retain the same ready preview', async () => {
    const f = await ready(),
      t = await preview(f);
    await expect(
      f.settle(
        f.c.queryPreview(t, [{ kind: 'fit', request: { box: cellBox(0), materials: [255] } }]),
      ),
    ).rejects.toThrow();
    expect(f.c.state.status).not.toBe('failed');
    expect((await f.settle(f.c.commit(t))).snapshot.revision).toBe(1);
    await close(f);
  });
  test('invalid batches and copied tickets reject before dispatch', async () => {
    const f = await ready(),
      t = await preview(f),
      count = f.sent[0].length;
    expect(() => f.c.query([])).toThrow();
    expect(() => f.c.query(new Array(33).fill(fit))).toThrow();
    expect(() => f.c.queryPreview({ ...t }, [fit])).toThrow();
    expect(() => f.c.changesPreview(t, 'missing')).toThrow();
    expect(f.sent[0]).toHaveLength(count);
    await close(f);
  });
  test('queries and reports cannot overlap each other or a physical preview', async () => {
    const f = await ready(),
      t = f.c.request([cut], { horizonTicks: 0 });
    expect(() => f.c.query([fit])).toThrow(/idle/);
    await f.settle(t.result);
    const pending = f.c.query([fit]);
    expect(() => f.c.query([fit])).toThrow(/idle/);
    expect(() => f.c.commit(t)).toThrow();
    await f.settle(pending);
    await close(f);
  });
  test('commit copies and older commits cannot obtain current reports', async () => {
    const f = await ready(),
      t = await preview(f),
      a = await f.settle(f.c.commit(t));
    expect(() => f.c.changes({ ...a })).toThrow();
    const next = await preview(f, []);
    await f.settle(f.c.commit(next));
    expect(() => f.c.changes(a)).toThrow();
    await close(f);
  });
  test('restore invalidates earlier report handles while retaining returned reports', async () => {
    const f = await ready(),
      t = await preview(f),
      commit = await f.settle(f.c.commit(t)),
      out = await f.settle(f.c.changes(commit)),
      before = structuredClone(out);
    await f.settle(f.c.restore(f.c.snapshot()));
    expect(() => f.c.changes(commit)).toThrow();
    expect(out).toEqual(before);
    await close(f);
  });
  test('closing during a support assessment cancels it and retains the saved world', async () => {
    const f = await ready(),
      before = f.c.snapshot(),
      t = await preview(f),
      pending = f.c.changesPreview(t),
      rejection = expect(pending).rejects.toThrow(/closing/);
    await f.until(
      () =>
        f.c.state.inspection?.kind === 'changes' &&
        f.c.state.inspection.value.phase === 'support-before',
    );
    await f.settle(f.c.close());
    await rejection;
    expect(f.c.snapshot()).toEqual(before);
    expect(f.closed).toEqual([true, true]);
  });
  test('wrong domain stamps in geometry replies fail closed', async () => {
    const f = await ready(),
      before = f.c.snapshot();
    f.config.mapReply = (m) => {
      const p = m.payload as {
        result?: { results?: { value: { stamp: { domain: string | null } } }[] };
      };
      if (m.kind === 'inspect-advance' && p.result?.results)
        p.result.results[0].value.stamp.domain = 'flask';
      return m;
    };
    await expect(f.settle(f.c.query([fit]))).rejects.toThrow(/stamp/);
    expect(f.c.snapshot()).toEqual(before);
    expect(f.c.state.uncertain).toBe(false);
  });
  test('wrong queried cell contents are rejected without a committed mutation', async () => {
    const f = await ready();
    f.config.mapReply = (m) => {
      const p = m.payload as {
        result?: { results?: { value: { blocker: { energyQ: number } } }[] };
      };
      if (m.kind === 'inspect-advance' && p.result?.results)
        p.result.results[0].value.blocker.energyQ++;
      return m;
    };
    await expect(f.settle(f.c.query([fit]))).rejects.toThrow(/cell differs/);
    expect(f.c.snapshot().revision).toBe(0);
  });
  test('partial inspection payloads are never accepted', async () => {
    const f = await ready();
    f.config.mapReply = (m) => {
      if (m.kind === 'inspect-start') (m.payload as { result: unknown }).result = {};
      return m;
    };
    await expect(f.settle(f.c.query([fit]))).rejects.toThrow(/partial/);
    expect(f.c.state.status).toBe('failed');
  });
  test('malformed support counts bounds and range budgets are rejected', () => {
    const f = endpoints(),
      raw = finish(changes(r, f.before, f.after)),
      from = reactiveWorkerGeometryStamp3D(f.saved, null),
      to = reactiveWorkerGeometryStamp3D(f.preview.state, null, f.preview);
    const read = (value: unknown) =>
      readReactiveChangeReport3D(r, value, f.saved, f.preview.state, from, to, 256);
    expect(read(raw)).toEqual(raw);
    const count = structuredClone(raw);
    count.channels.support.count++;
    expect(() => read(count)).toThrow();
    const bounds = structuredClone(raw);
    bounds.channels.support.bounds!.max[0]--;
    expect(() => read(bounds)).toThrow();
    const budget = structuredClone(raw);
    budget.runBudget = 0;
    expect(() => read(budget)).toThrow();
  });
  test('overlapping unmerged and out-of-bounds report ranges are rejected', () => {
    const f = endpoints(),
      raw = finish(changes(r, f.before, f.after)),
      read = (v: unknown) =>
        readReactiveChangeReport3D(
          r,
          v,
          f.saved,
          f.preview.state,
          f.before.stamp,
          f.after.stamp,
          256,
        );
    for (const runs of [
      [
        [5, 2],
        [6, 1],
      ],
      [
        [5, 1],
        [6, 1],
      ],
      [[14, 2]],
    ] as [number, number][][]) {
      const v = structuredClone(raw);
      v.channels.structure.runs = runs;
      expect(() => read(v)).toThrow();
    }
  });
  test('reported material changes must match the observed endpoints', () => {
    const f = endpoints(),
      raw = finish(changes(r, f.before, f.after));
    raw.channels.material = structuredClone(raw.channels.structure);
    expect(() =>
      readReactiveChangeReport3D(
        r,
        raw,
        f.saved,
        f.preview.state,
        f.before.stamp,
        f.after.stamp,
        256,
      ),
    ).toThrow(/did not change/);
  });
  test('a truncated report cannot claim complete runs', async () => {
    const f = await ready(),
      t = await preview(f);
    f.config.mapReply = (m) => {
      const p = m.payload as { result?: ReactiveChangeReport3D };
      if (m.kind === 'inspect-advance' && p.result?.channels)
        p.result.channels.support.requiresFullRead = false;
      return m;
    };
    await expect(f.settle(f.c.changesPreview(t, null, { maxRuns: 0 }))).rejects.toThrow(/Partial/);
    expect(f.c.state.uncertain).toBe(false);
  });
  test('inspection timeout fails closed but does not claim an uncertain mutation', async () => {
    vi.useFakeTimers();
    const f = await ready();
    f.config.mapReply = (m) => (m.kind === 'inspect-start' ? null : m);
    const pending = f.c.query([fit]),
      rejection = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(10001);
    await rejection;
    expect(f.c.state.uncertain).toBe(false);
    expect(f.c.snapshot().revision).toBe(0);
  });
});
