import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Tiny speculative gameplay over exact reactive kernels; old runtime remains trapped. */
import { beforeAll, describe, expect, test, vi } from 'vitest';

import {
  createReactiveMaterialRegistry3D,
  defaultReactiveMaterialCatalog3D,
  createReactiveMaterialBlock3D as block,
  editReactiveMaterialBlock3D as edit,
  createReactiveWorldSnapshot3D as world,
  createReactiveDomainsSnapshot3D as domains,
  createReactiveSession3D as create,
  readReactiveSessionSnapshot3D as read,
  createReactiveSessionSnapshot3D as save,
  createReactiveDomainSet3D as domainOwner,
  REACTIVE_SESSION_LIMITS_3D,
  MAT,
  BONDS_3D,
  ANCHOR_3D,
  type ReactiveMaterialRegistry3D,
  type ReactiveMaterialEdit3D,
  type ReactiveSessionInitial3D,
  type ReactiveSessionPolicy3D,
  type ReactiveBranch3D,
  type ReactiveSession3D,
  type ReactiveSessionCommand3D,
  type ReactiveSessionSnapshot3D,
} from '../reactive-materials.js';
holdPhysics('volumeStep', 'solveStructure3D', ...STRUCTURAL_CALLS);
let r: ReactiveMaterialRegistry3D;
beforeAll(async () => {
  const c = defaultReactiveMaterialCatalog3D();
  for (const m of c.propertiesCatalog.materials) m.properties.conductivity = 0;
  r = await createReactiveMaterialRegistry3D(c);
});
type Game = {
  ap: number;
  turn: number;
  rng: number;
  units: { id: string; x: number; y: number; z: number }[];
};
const game = (): Game => ({ ap: 2, turn: 0, rng: 1, units: [{ id: 'earth', x: 1, y: 1, z: 0 }] });
const p = { x: 0, y: 0, z: 0 },
  shape = { width: 3, height: 3, depth: 1 };
const place = (
  x = 0,
  y = 0,
  material: number = MAT.STONE,
  thermal = 70,
): ReactiveMaterialEdit3D => ({ kind: 'place', x, y, z: 0, material, thermal });
function initial(
  edits: ReactiveMaterialEdit3D[] = [place()],
  tick = 0,
  reservoirEdits: ReactiveMaterialEdit3D[] = [],
): ReactiveSessionInitial3D<Game> {
  const a = world(r, edit(r, block(r, shape), edits).block, tick),
    b = world(r, edit(r, block(r, shape), reservoirEdits).block, tick);
  expect(a.block.packedCells.length + b.block.packedCells.length).toBeLessThanOrEqual(125);
  return {
    worldId: 'mission',
    gameRulesVersion: 'ability-1',
    domains: domains(r, a, [{ id: 'flask', world: b }]),
    game: game(),
  };
}
const valid = (s: ReactiveSessionSnapshot3D<Game>) =>
  Number.isInteger(s.game.ap) &&
  s.game.ap >= 0 &&
  s.game.ap <= 2 &&
  Number.isSafeInteger(s.game.turn);
const session = (input = initial(), policy: ReactiveSessionPolicy3D<Game> = {}) =>
  create(r, input, { validateGame: valid, ...policy });
function finish(b: ReactiveBranch3D<Game>, budget = 7) {
  let calls = 0;
  while (['preparing', 'running'].includes(b.progress().status)) {
    if (++calls > 50000) throw Error('Tiny preview exceeded its work bound.');
    b.advance(budget);
  }
  return b.inspect();
}
const spend = (ap = 1): ReactiveSessionCommand3D<Game> => ({
  kind: 'game',
  game: { ...game(), ap },
});
const transfer = (): ReactiveSessionCommand3D<Game> => ({
  kind: 'transfer',
  request: { from: null, to: 'flask', cells: [[0, 0, 0]], offset: [0, 0, 0] },
});
const move = (path: [number, number, number][] = [[1, 0, 0]]): ReactiveSessionCommand3D<Game> => ({
  kind: 'translate',
  domain: null,
  request: { cells: [[0, 0, 0]], path },
});
const nextGame = ({ game: g }: { game: Game }): Game => ({
  ...g,
  turn: g.turn + 1,
  rng: (Math.imul(g.rng, 1664525) + 1013904223) >>> 0,
});
const complete = (
  s: ReactiveSession3D<Game>,
  horizon = 0,
  commands: ReactiveSessionCommand3D<Game>[] = [],
) => {
  const b = s.branch({ horizonTicks: horizon });
  for (const c of commands) b.enqueue(c);
  finish(b);
  return s.commit(b);
};

describe('atomic reactive ability previews', () => {
  test('initial saves own game and all domains with explicit identities and balanced accounting', () => {
    const input = initial(),
      s = session(input),
      before = s.snapshot();
    input.game.ap = 0;
    input.domains.world.block.energyQ[0] = 0;
    expect(s.snapshot()).toEqual(before);
    expect(before.rulesVersion).toBe('reactive-session-1');
    expect(before.revision).toBe(0);
    expect(s.energyBalance().driftQ).toBe(0n);
    expect(read<Game>(r, JSON.parse(JSON.stringify(before)))).toEqual(before);
    expect(Object.isFrozen(REACTIVE_SESSION_LIMITS_3D)).toBe(true);
  });
  test('a zero-horizon paid edit publishes game terrain and energy accounting together', () => {
    const s = session(),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 0 });
    b.enqueue(spend());
    b.enqueue({
      kind: 'edit',
      domain: null,
      edits: [{ ...p, kind: 'energy', energyQ: before.domains.world.block.energyQ[0] + 17 }],
    });
    const preview = finish(b);
    expect(s.snapshot()).toEqual(before);
    expect(preview.state.game.ap).toBe(1);
    expect(preview.state.accounting.externalQ).toBe('17');
    const out = s.commit(b);
    expect(out.snapshot.game.ap).toBe(1);
    expect(out.snapshot.domains.tick).toBe(0);
    expect(out.receipt.externalEnergyQ).toBe('17');
    expect(s.energyBalance().externalQ).toBe(17n);
  });
  test('a paid lifted hot damaged slab stays held for the requested exact horizon without healing', () => {
    const input = initial([
        place(),
        place(1),
        { ...p, kind: 'bond', direction: 1, bonded: true },
        { ...p, kind: 'integrity', integrity: 73 },
      ]),
      s = session(input),
      b = s.branch({ horizonTicks: 2 });
    b.enqueue(spend());
    b.enqueue({
      kind: 'translate',
      domain: null,
      request: {
        cells: [
          [0, 0, 0],
          [1, 0, 0],
        ],
        path: [[0, 1, 0]],
      },
    });
    b.enqueue({
      kind: 'hold',
      domain: null,
      request: { id: 'lift', expiresAtTick: 2, cells: [[0, 1, 0]] },
    });
    const preview = finish(b);
    expect(preview.progress.completedTicks).toBe(2);
    expect(preview.state.domains.world.block.structure[3]).toBe(73 | BONDS_3D[1]);
    expect(preview.state.domains.world.block.energyQ[3]).toBe(input.domains.world.block.energyQ[0]);
    const w = preview.state.domains.world;
    expect(w.schemaVersion === 2 && w.holds).toEqual([]);
    expect(s.snapshot().game.ap).toBe(2);
    s.commit(b);
    expect(s.snapshot().game.ap).toBe(1);
  });
  test('preview physics equals direct domain execution with the same ordered intervention and ticks', () => {
    const input = initial([place(0, 0, MAT.WATER, 40)]),
      s = session(input, { reduceTick: nextGame }),
      b = s.branch({ horizonTicks: 2 });
    b.enqueue(spend());
    b.enqueue(transfer());
    const preview = finish(b, 1),
      direct = domainOwner(r, input.domains.world, input.domains.reservoirs),
      request = transfer();
    if (request.kind !== 'transfer') throw Error('Fixture');
    const x = direct.prepareTransfer(request.request);
    while (x.progress().status === 'running') x.advance(256);
    direct.commitTransfer(x);
    let g = { ...game(), ap: 1 };
    for (let i = 0; i < 2; i++) {
      const j = direct.prepareTick();
      let calls = 0;
      while (j.progress().status === 'running') {
        if (++calls > 5000) throw Error('Fixture');
        j.advance(256);
      }
      direct.commitTick(j);
      g = nextGame({ game: g });
    }
    expect(preview.state.domains).toEqual(direct.snapshot());
    expect(preview.state.game).toEqual(g);
    expect(preview.base).toEqual(s.revision);
    expect(preview.progress.horizonTicks).toBe(2);
  });
  test('support extraction previews the full distant walkway collapse while the committed route stays intact', () => {
    const width = 5,
      a = world(
        r,
        edit(r, block(r, { width, height: 2, depth: 1 }), [
          ...Array.from({ length: width }, (_, x) => place(x)),
          ...Array.from({ length: width - 1 }, (_, x) => ({
            ...p,
            x,
            kind: 'bond' as const,
            direction: 1,
            bonded: true,
          })),
          place(0, 1),
        ]).block,
      );
    const input = { ...initial(), domains: domains(r, a, initial().domains.reservoirs) },
      s = session(input),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 1 });
    b.enqueue(spend());
    b.enqueue({
      kind: 'transfer',
      request: { from: null, to: 'flask', cells: [[0, 1, 0]], offset: [0, -1, 0] },
    });
    finish(b);
    const last = b.lastBoundary();
    expect(last?.kind).toBe('tick');
    if (last?.kind !== 'tick') throw Error('Fixture');
    expect(last.report.domains[0].report.structure.movingCells).toEqual([0, 1, 2, 3, 4]);
    expect(last.report.domains[0].report.moves).toContainEqual({ from: 4, to: 9 });
    expect(s.snapshot()).toEqual(before);
    s.commit(b);
    expect(s.snapshot().domains.world.block.packedCells[9] & 255).toBe(MAT.STONE);
  });
  test('a late reservoir obstruction rolls back previously staged AP unit movement heat and partial swaps', () => {
    const s = session(initial([place(), place(1)], 0, [place(1)])),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 1 });
    b.enqueue({
      kind: 'game',
      game: { ...game(), ap: 0, units: [{ id: 'earth', x: 2, y: 1, z: 0 }] },
    });
    b.enqueue({
      kind: 'edit',
      domain: null,
      edits: [{ ...p, kind: 'energy', energyQ: before.domains.world.block.energyQ[0] + 9 }],
    });
    b.enqueue({
      kind: 'transfer',
      request: {
        from: null,
        to: 'flask',
        cells: [
          [0, 0, 0],
          [1, 0, 0],
        ],
        offset: [0, 0, 0],
      },
    });
    b.advance(1);
    b.advance(1);
    b.advance(1);
    b.advance(1);
    expect(b.inspect().state.game.ap).toBe(0);
    expect(s.snapshot()).toEqual(before);
    expect(() => b.advance(1)).toThrow(/obstructed/);
    expect(b.progress().status).toBe('failed');
    expect(s.snapshot()).toEqual(before);
    expect(s.energyBalance().externalQ).toBe(0n);
  });
  test('a late translation collision discards an earlier anchor release and game cost', () => {
    const s = session(initial([place(), place(2), { ...p, kind: 'anchor', anchored: true }])),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 0 });
    b.enqueue(spend(0));
    b.enqueue({
      kind: 'translate',
      domain: null,
      request: {
        cells: [[0, 0, 0]],
        path: [
          [1, 0, 0],
          [1, 0, 0],
        ],
        anchors: 'release',
      },
    });
    expect(() => finish(b)).toThrow(/obstructed/);
    expect(s.snapshot()).toEqual(before);
    expect(s.snapshot().domains.world.block.structure[0] & ANCHOR_3D).toBe(ANCHOR_3D);
  });
  test('a late invalid edit batch rejects the whole paid command sequence', () => {
    const s = session(),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 0 });
    b.enqueue(spend());
    b.enqueue({ kind: 'edit', domain: null, edits: [place(1), place(99)] });
    expect(() => finish(b)).toThrow();
    expect(b.progress().status).toBe('failed');
    expect(s.snapshot()).toEqual(before);
  });
  test('invalid queued data fails only that branch and leaves a sibling candidate usable', () => {
    const s = session(),
      sibling = s.branch({ horizonTicks: 0 }),
      bad = s.branch({ horizonTicks: 0 });
    bad.enqueue(spend());
    expect(() => bad.enqueue(null as never)).toThrow();
    expect(bad.progress().status).toBe('failed');
    finish(sibling);
    s.commit(sibling);
    expect(s.snapshot().game.ap).toBe(2);
  });
  test('the first advance seals preparation without destroying a valid candidate on a later enqueue', () => {
    const s = session(),
      b = s.branch({ horizonTicks: 0 });
    b.enqueue(spend());
    b.advance();
    expect(() => b.enqueue(spend(0))).toThrow(/sealed/);
    finish(b);
    s.commit(b);
    expect(s.snapshot().game.ap).toBe(1);
  });
  test('queued nested inputs and all inspected data are isolated from eventual publication', () => {
    const s = session(),
      b = s.branch({ horizonTicks: 0 }),
      cost = spend(),
      m = move();
    b.enqueue(cost);
    b.enqueue(m);
    if (cost.kind === 'game') cost.game.ap = 0;
    if (m.kind === 'translate') (m.request.path as unknown as number[][])[0][0] = -1;
    const preview = finish(b);
    preview.state.game.ap = 0;
    preview.state.domains.world.block.energyQ[1] = 0;
    (preview.base as { revision: number }).revision = 99;
    const out = s.commit(b);
    expect(out.snapshot.game.ap).toBe(1);
    expect(out.snapshot.domains.world.block.packedCells[1] & 255).toBe(MAT.STONE);
    out.snapshot.game.ap = 0;
    expect(s.snapshot().game.ap).toBe(1);
  });
  test('incomplete physical slices expose the previous complete domain and game boundary', () => {
    const s = session(initial(), { reduceTick: nextGame }),
      b = s.branch({ horizonTicks: 1 }),
      before = b.inspect().state;
    for (let i = 0; i < 20; i++) {
      b.advance(1);
      expect(b.inspect().state).toEqual(before);
      expect(b.progress().completedTicks).toBe(0);
    }
    const result = finish(b);
    expect(result.state.game.turn).toBe(1);
    expect(result.state.domains.tick).toBe(1);
    expect(s.snapshot().game.turn).toBe(0);
  });
  test('latest-boundary sequence advances per complete command and tick without retaining a history list', () => {
    const b = session().branch({ horizonTicks: 2 });
    b.enqueue(spend());
    b.enqueue({ kind: 'edit', domain: null, edits: [] });
    expect(b.lastBoundary()).toBeNull();
    b.advance();
    expect(b.lastBoundary()).toMatchObject({
      sequence: 1,
      kind: 'command',
      commandKind: 'game',
      tick: 0,
    });
    b.advance();
    expect(b.lastBoundary()).toMatchObject({ sequence: 2, commandKind: 'edit' });
    finish(b);
    expect(b.lastBoundary()).toMatchObject({ sequence: 4, kind: 'tick', tick: 2 });
    b.discard();
  });
  test('discarding a partially executed transfer releases the entire private transaction', () => {
    const s = session(initial([place(), place(1)])),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 0 });
    b.enqueue(spend());
    b.enqueue({
      kind: 'transfer',
      request: {
        from: null,
        to: 'flask',
        cells: [
          [0, 0, 0],
          [1, 0, 0],
        ],
        offset: [0, 0, 0],
      },
    });
    b.advance(1);
    b.advance(1);
    b.advance(1);
    expect(b.discard()).toBe(true);
    expect(b.discard()).toBe(false);
    expect(() => s.commit(b)).toThrow();
    expect(() => b.inspect()).toThrow();
    expect(s.snapshot()).toEqual(before);
  });
  test('discarding during a synchronized physical tick cannot publish a completed subdomain', () => {
    const s = session(),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 1 });
    for (let i = 0; i < 60; i++) b.advance(256);
    expect(b.progress().completedTicks).toBe(0);
    expect(b.discard()).toBe(true);
    expect(s.snapshot()).toEqual(before);
  });
  test('discarding a ready candidate spends nothing and frees branch capacity', () => {
    const s = session(),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 2 });
    b.enqueue(spend());
    finish(b);
    b.discard();
    expect(s.snapshot()).toEqual(before);
    expect(s.branch({ horizonTicks: 0 }).discard()).toBe(true);
  });
  test('zero one and three tick horizons produce exact durations independent of work budget', () => {
    for (const horizon of [0, 1, 3]) {
      const a = session(initial([], 1), { reduceTick: nextGame }),
        b = session(initial([], 1), { reduceTick: nextGame });
      const x = a.branch({ horizonTicks: horizon }),
        y = b.branch({ horizonTicks: horizon });
      expect(finish(x, 1)).toEqual(finish(y, 256));
      expect(a.commit(x).snapshot).toEqual(b.commit(y).snapshot);
      expect(a.snapshot().domains.tick).toBe(1 + horizon);
      expect(a.snapshot().game.turn).toBe(horizon);
    }
  });
  test('odd-tick saved continuation preserves complete domains game RNG and external accounting', () => {
    const input = initial([place(0, 0, MAT.WOOD, 181)], 1),
      a = session(input, { reduceTick: nextGame });
    complete(a, 2, [
      spend(),
      { kind: 'edit', domain: 'flask', edits: [place(0, 0, MAT.WATER, 40)] },
    ]);
    const saved = a.snapshot();
    const b = session(
      { ...input, domains: saved.domains, game: saved.game },
      { reduceTick: nextGame },
    );
    b.restore(JSON.parse(JSON.stringify(saved)));
    const x = a.branch({ horizonTicks: 3 }),
      y = b.branch({ horizonTicks: 3 });
    expect(finish(x, 1).state).toEqual(finish(y, 256).state);
    expect(a.commit(x).snapshot).toEqual(b.commit(y).snapshot);
    expect(a.energyBalance()).toEqual(b.energyBalance());
  });
  test('a successful commit stales every sibling and requires recomputation from the new revision', () => {
    const s = session(),
      a = s.branch({ horizonTicks: 0 }),
      b = s.branch({ horizonTicks: 1 });
    a.enqueue(spend());
    finish(a);
    b.advance();
    s.commit(a);
    expect(b.progress().status).toBe('stale');
    expect(() => b.advance()).toThrow(/stale/);
    expect(() => s.commit(b)).toThrow(/stale/);
    expect(s.branch({ horizonTicks: 0 }).base.revision).toBe(1);
  });
  test('restore increments the live revision and stales work even when the saved payload is identical', () => {
    const s = session(),
      saved = s.snapshot(),
      b = s.branch({ horizonTicks: 0 });
    finish(b);
    const out = s.restore(saved);
    expect(out.revision).toBe(1);
    expect(out.domains).toEqual(saved.domains);
    expect(b.progress().status).toBe('stale');
    expect(() => s.commit(b)).toThrow(/stale/);
  });
  test('foreign copied and consumed branch handles cannot authorize commits', () => {
    const a = session(),
      b = session(),
      branch = a.branch({ horizonTicks: 0 });
    finish(branch);
    expect(() => b.commit(branch)).toThrow(/foreign/);
    expect(() => a.commit({ ...branch })).toThrow(/foreign/);
    a.commit(branch);
    expect(branch.progress().status).toBe('committed');
    expect(() => a.commit(branch)).toThrow();
  });
  test('an incomplete commit rejects without discarding the candidate', () => {
    const s = session(),
      b = s.branch({ horizonTicks: 1 });
    b.enqueue(spend());
    expect(() => s.commit(b)).toThrow(/ready/);
    finish(b);
    s.commit(b);
    expect(s.snapshot().game.ap).toBe(1);
  });
  test('commit publishes the preview result without running the reducer or physics again', () => {
    const reducer = vi.fn(nextGame),
      s = session(initial(), { reduceTick: reducer }),
      b = s.branch({ horizonTicks: 2 });
    const preview = finish(b);
    expect(reducer).toHaveBeenCalledTimes(2);
    const out = s.commit(b);
    expect(reducer).toHaveBeenCalledTimes(2);
    expect(out.snapshot).toEqual({ ...preview.state, revision: 1 });
  });
  test('synchronous policy errors after physical work roll back the complete paid ability', () => {
    let count = 0;
    const s = session(initial(), {
        reduceTick: (context) => {
          if (++count === 2) throw Error('application failure');
          return nextGame(context);
        },
      }),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 3 });
    b.enqueue(spend());
    b.enqueue(transfer());
    expect(() => finish(b)).toThrow(/application failure/);
    expect(count).toBe(2);
    expect(s.snapshot()).toEqual(before);
    expect(b.progress().status).toBe('failed');
  });
  test('promise reducers are rejected and rejected results are observed', async () => {
    const s = session(initial(), {
        reduceTick: (() => Promise.reject(Error('async reducer'))) as never,
      }),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 1 });
    expect(() => finish(b)).toThrow(/synchronous/);
    await Promise.resolve();
    expect(s.snapshot()).toEqual(before);
    expect(b.progress().status).toBe('failed');
  });
  test('promise validators reject construction without leaving an unhandled rejection', async () => {
    expect(() =>
      session(initial(), {
        validateGame: (() => Promise.reject(Error('async validator'))) as never,
      }),
    ).toThrow(/synchronous/);
    await Promise.resolve();
  });
  test('nonportable reducer output cannot publish the already computed physical tick', () => {
    const s = session(initial(), { reduceTick: (context) => ({ ...context.game, ap: NaN }) }),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 1 });
    expect(() => finish(b)).toThrow(/finite/);
    expect(s.snapshot()).toEqual(before);
  });
  test('final game-policy rejection rolls back all commands and the simulated horizon', () => {
    const reducer = vi.fn(nextGame),
      s = session(initial(), { reduceTick: reducer }),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 2 });
    b.enqueue(spend(-1));
    b.enqueue(transfer());
    expect(() => finish(b)).toThrow(/policy rejected/);
    expect(reducer).toHaveBeenCalledTimes(2);
    expect(s.snapshot()).toEqual(before);
  });
  test('commit rechecks policy and a rejection leaves other candidates usable', () => {
    let accept = true;
    const s = session(initial(), { validateGame: () => accept }),
      a = s.branch({ horizonTicks: 0 }),
      b = s.branch({ horizonTicks: 0 }),
      before = s.snapshot();
    a.enqueue(spend());
    finish(a);
    finish(b);
    accept = false;
    expect(() => s.commit(a)).toThrow(/policy rejected/);
    expect(s.snapshot()).toEqual(before);
    expect(b.progress().status).toBe('ready');
    accept = true;
    s.commit(b);
  });
  test('policies receive isolated domains reports and game values', () => {
    const s = session(initial(), {
      validateGame: (value) => {
        value.game.ap = 999;
        value.domains.world.block.energyQ[0] = 0;
        return true;
      },
      reduceTick: (value) => {
        value.domains.tick = 999;
        value.report.toTick = 999;
        return nextGame(value);
      },
    });
    const out = complete(s, 1);
    expect(out.snapshot.game.ap).toBe(2);
    expect(out.snapshot.game.turn).toBe(1);
    expect(out.snapshot.domains.tick).toBe(1);
    expect(s.energyBalance().driftQ).toBe(0n);
  });
  test('policy functions are captured at construction rather than read from a mutable policy object', () => {
    const policy = { validateGame: valid, reduceTick: nextGame },
      s = create(r, initial(), policy);
    policy.validateGame = () => false;
    policy.reduceTick = () => {
      throw Error('changed');
    };
    expect(complete(s, 1).snapshot.game.turn).toBe(1);
  });
  test('swallowed reducer reentry poisons the branch while inspection sees the previous complete boundary', () => {
    let b: ReactiveBranch3D<Game>;
    let seen: ReactiveSessionSnapshot3D<Game> | undefined;
    const s = session(initial(), {
        reduceTick: (value) => {
          seen = b.inspect().state;
          try {
            b.discard();
          } catch {}
          return nextGame(value);
        },
      }),
      before = s.snapshot();
    b = s.branch({ horizonTicks: 1 });
    expect(() => finish(b)).toThrow(/reentry/);
    expect(seen).toEqual(before);
    expect(s.snapshot()).toEqual(before);
    expect(b.progress().status).toBe('failed');
  });
  test('swallowed validation reentry cannot restore or publish during finalization', () => {
    let armed = false;
    let s: ReactiveSession3D<Game>;
    s = session(initial(), {
      validateGame: (value) => {
        if (armed) {
          try {
            s.restore(value);
          } catch {}
        }
        return true;
      },
    });
    const before = s.snapshot(),
      b = s.branch({ horizonTicks: 0 });
    b.enqueue(spend());
    armed = true;
    expect(() => finish(b)).toThrow(/reentry/);
    expect(s.snapshot()).toEqual(before);
  });
  test('swallowed reentry while copying queued input cannot mutate the session or accept a command', () => {
    const s = session(),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 0 });
    let tried = false;
    const command = new Proxy(spend(), {
      ownKeys(target) {
        if (!tried) {
          tried = true;
          try {
            s.restore(before);
          } catch {}
        }
        return Reflect.ownKeys(target);
      },
    });
    expect(() => b.enqueue(command)).toThrow(/reentry/);
    expect(b.progress().status).toBe('failed');
    expect(s.snapshot()).toEqual(before);
  });
  test('invalid options preserve existing ready work and reject absolute tick overflow', () => {
    const s = session(),
      b = s.branch({ horizonTicks: 0 });
    finish(b);
    for (const options of [
      null,
      { horizonTicks: -1 },
      { horizonTicks: 65 },
      { horizonTicks: 1.5 },
      { horizonTicks: 0, extra: true },
    ])
      expect(() => s.branch(options as never)).toThrow();
    s.commit(b);
    const near = session(initial([], Number.MAX_SAFE_INTEGER));
    expect(() => near.branch({ horizonTicks: 1 })).toThrow();
    near.branch({ horizonTicks: 0 }).discard();
  });
  test('four branch slots are released by discard failure commit and sibling invalidation', () => {
    const s = session(),
      branches = Array.from({ length: 4 }, () => s.branch({ horizonTicks: 0 }));
    expect(() => s.branch({ horizonTicks: 0 })).toThrow(/capacity/);
    branches[0].discard();
    const replacement = s.branch({ horizonTicks: 0 });
    expect(() => branches[1].enqueue(null as never)).toThrow();
    s.branch({ horizonTicks: 0 });
    finish(replacement);
    s.commit(replacement);
    const fresh = Array.from({ length: 4 }, () => s.branch({ horizonTicks: 64 }));
    for (const b of fresh) b.discard();
  });
  test('operation and combined command-data budgets bound accepted preparation', () => {
    const s = session(),
      b = s.branch({ horizonTicks: 0 });
    for (let i = 0; i < 256; i++) b.enqueue(spend());
    expect(b.progress().totalCommands).toBe(256);
    expect(() => b.enqueue(spend())).toThrow(/budget/);
    expect(b.progress().status).toBe('failed');
    const chars = s.branch({ horizonTicks: 0 });
    chars.enqueue({ kind: 'game', game: { text: 'x'.repeat(600000) } } as never);
    expect(() =>
      chars.enqueue({ kind: 'game', game: { text: 'x'.repeat(600000) } } as never),
    ).toThrow(/budget/);
    const nodes = s.branch({ horizonTicks: 0 });
    nodes.enqueue({ kind: 'game', game: new Array(40000).fill(0) } as never);
    expect(() => nodes.enqueue({ kind: 'game', game: new Array(40000).fill(0) } as never)).toThrow(
      /budget/,
    );
  });
  test('portable game copying rejects holes cycles accessors functions and nonfinite values without invoking getters', () => {
    const raw = save(r, initial()),
      getter = vi.fn(() => 1),
      accessed = {};
    Object.defineProperty(accessed, 'ap', { get: getter, enumerable: true });
    const cycle: unknown[] = [];
    cycle.push(cycle);
    for (const g of [undefined, NaN, () => 0, new Array(1), accessed, cycle, new Uint32Array(1)])
      expect(() => read(r, { ...raw, game: g })).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const value = JSON.parse('{"__proto__":{"safe":true},"n":0}');
    expect(Object.hasOwn(read(r, { ...raw, game: value }).game as object, '__proto__')).toBe(true);
  });
  test('accounting uses canonical decimal quantities and rejects internally inconsistent saves', () => {
    const s = session(),
      raw = s.snapshot();
    for (const value of ['01', '-0', '1e3', '', 0, undefined, '99999999999999999999'])
      expect(() =>
        s.restore({ ...raw, accounting: { ...raw.accounting, externalQ: value } }),
      ).toThrow();
    expect(() =>
      s.restore({ ...raw, accounting: { ...raw.accounting, externalQ: '1' } }),
    ).toThrow();
    expect(s.snapshot()).toEqual(raw);
  });
  test('restore preserves external accounting history instead of granting a fresh energy baseline', () => {
    const s = session(),
      original = s.snapshot();
    complete(s, 0, [
      {
        kind: 'edit',
        domain: null,
        edits: [{ ...p, kind: 'energy', energyQ: original.domains.world.block.energyQ[0] + 123 }],
      },
    ]);
    const saved = s.snapshot(),
      b = session();
    b.restore(JSON.parse(JSON.stringify(saved)));
    expect(b.energyBalance()).toEqual(s.energyBalance());
    expect(b.snapshot().accounting.externalQ).toBe('123');
  });
  test('wrong identities rules topology and catalog cannot replace a save or revoke a valid candidate', () => {
    const s = session(),
      raw = s.snapshot(),
      b = s.branch({ horizonTicks: 0 });
    finish(b);
    const wrongDomain = structuredClone(raw.domains);
    wrongDomain.world.block.materialCatalogHash = 'wrong';
    for (const bad of [
      { ...raw, worldId: 'other' },
      { ...raw, gameRulesVersion: 'other' },
      { ...raw, rulesVersion: 'other' },
      { ...raw, schemaVersion: 2 },
      { ...raw, domains: { ...raw.domains, reservoirs: [] } },
      { ...raw, domains: wrongDomain },
      { ...raw, revision: -1 },
      { ...raw, extra: true },
    ])
      expect(() => s.restore(bad)).toThrow();
    expect(s.snapshot()).toEqual(raw);
    expect(b.progress().status).toBe('ready');
    s.commit(b);
  });
  test('invalid application identities and policy accessors reject before invoking callbacks', () => {
    const getter = vi.fn(() => valid),
      policy = {};
    Object.defineProperty(policy, 'validateGame', { get: getter, enumerable: true });
    expect(() => create(r, initial(), policy)).toThrow();
    expect(() => session({ ...initial(), worldId: 'bad id' })).toThrow();
    expect(() => session({ ...initial(), gameRulesVersion: '' })).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  test('preview wrappers cannot silently masquerade as committed save envelopes', () => {
    const s = session(),
      b = s.branch({ horizonTicks: 0 }),
      preview = finish(b);
    expect(() => s.restore(preview)).toThrow();
    expect(b.progress().status).toBe('ready');
    s.commit(b);
  });
  test('held material requires an explicit queued release before a paid move', () => {
    const s = session(),
      before = s.snapshot(),
      bad = s.branch({ horizonTicks: 0 });
    bad.enqueue(spend());
    bad.enqueue({
      kind: 'hold',
      domain: null,
      request: { id: 'h', expiresAtTick: 2, cells: [[0, 0, 0]] },
    });
    bad.enqueue(move());
    expect(() => finish(bad)).toThrow(/hold/);
    expect(s.snapshot()).toEqual(before);
    const good = s.branch({ horizonTicks: 0 });
    good.enqueue(spend());
    good.enqueue({
      kind: 'hold',
      domain: null,
      request: { id: 'h', expiresAtTick: 2, cells: [[0, 0, 0]] },
    });
    good.enqueue({ kind: 'releaseHold', domain: null, id: 'h' });
    good.enqueue(move());
    finish(good);
    s.commit(good);
    expect(s.snapshot().game.ap).toBe(1);
  });
  test('a paid storage and cooling preview freezes water with conserved matter and accounted energy', () => {
    const s = session(initial([place(0, 0, MAT.WATER, 40)])),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 1 });
    b.enqueue(spend());
    b.enqueue(transfer());
    b.enqueue({ kind: 'edit', domain: 'flask', edits: [{ ...p, kind: 'energy', energyQ: 0 }] });
    const preview = finish(b);
    expect(
      preview.state.domains.reservoirs[0].world.block.packedCells.some(
        (v) => (v & 255) === MAT.ICE,
      ),
    ).toBe(true);
    expect(BigInt(preview.state.accounting.externalQ)).toBeLessThan(0n);
    expect(s.snapshot()).toEqual(before);
    s.commit(b);
    expect(s.energyBalance().driftQ).toBe(0n);
    expect(s.snapshot().game.ap).toBe(1);
  });
  test('returned boundary reports cannot mutate the private candidate or eventual commit', () => {
    const s = session(),
      b = s.branch({ horizonTicks: 1 });
    finish(b);
    const last = b.lastBoundary();
    if (last?.kind !== 'tick') throw Error('Fixture');
    last.report.domains[0].report.structure.movingCells.length = 0;
    last.report.toTick = 99;
    const again = b.lastBoundary();
    expect(again?.kind === 'tick' && again.report.toTick).toBe(1);
    expect(s.commit(b).snapshot.domains.tick).toBe(1);
  });
  test('invalid work budgets leave preparation open and ready branches cannot advance further', () => {
    const s = session(),
      b = s.branch({ horizonTicks: 0 }),
      before = b.progress();
    for (const n of [0, 257, NaN, 1.5]) {
      expect(() => b.advance(n)).toThrow();
      expect(b.progress()).toEqual(before);
    }
    b.enqueue(spend());
    finish(b);
    expect(() => b.advance()).toThrow();
    expect(b.progress().status).toBe('ready');
    s.commit(b);
  });
});
