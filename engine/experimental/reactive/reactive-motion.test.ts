import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Tiny executed-path checks. Old M5, native and GPU execution remain held. */
import { beforeAll, describe, expect, test, vi } from 'vitest';

import { reactiveGeometrySource3D } from './reactive-geometry.js';
import { reactiveTickMovementSource3D, bindReactiveTickMovement3D } from './reactive-motion.js';
import { REACTIVE_EVOLUTION_RULES_3D, startReactiveEvolutionJob3D } from './reactive-evolution.js';
import {
  createReactiveMaterialRegistry3D,
  defaultReactiveMaterialCatalog3D,
  createReactiveMaterialBlock3D as block,
  editReactiveMaterialBlock3D as edit,
  createReactiveWorldSnapshot3D as world,
  createReactiveDomainsSnapshot3D as domains,
  createReactiveWorldTickJob3D as tick,
  createReactiveDomainsTickJob3D as domainTick,
  createReactiveDomainSet3D,
  createReactiveWorld3D,
  createReactiveSession3D as session,
  runReactiveMovementPass3D,
  MAT,
  ANCHOR_3D,
  REACTIVE_MOTION_LIMITS_3D,
  type ReactiveMaterialRegistry3D,
  type ReactiveMaterialEdit3D,
  type ReactiveMaterialBlock3D,
  type ReactiveMotionSegment3D,
  type ReactiveMotionReport3D,
  type ReactiveTickOptions3D,
  type ReactiveBranch3D,
  type ReactiveSessionPolicy3D,
  type ReactiveSessionMovementAccess3D,
} from '../reactive-materials.js';
holdPhysics('volumeStep', 'solveStructure3D', ...STRUCTURAL_CALLS);
let r: ReactiveMaterialRegistry3D, warm: ReactiveMaterialRegistry3D;
beforeAll(async () => {
  warm = await createReactiveMaterialRegistry3D();
  const c = defaultReactiveMaterialCatalog3D();
  for (const m of c.propertiesCatalog.materials) m.properties.conductivity = 0;
  r = await createReactiveMaterialRegistry3D(c);
});
const shape = { width: 3, height: 3, depth: 1 },
  capture: ReactiveTickOptions3D = { motion: { maxEntries: 8192 } };
const place = (
  x = 0,
  y = 0,
  material: number = MAT.STONE,
  thermal = 70,
): ReactiveMaterialEdit3D => ({ kind: 'place', x, y, z: 0, material, thermal });
const state = (
  edits: ReactiveMaterialEdit3D[] = [place()],
  absoluteTick = 0,
  dimensions = shape,
  registry = r,
) => {
  expect(dimensions.width * dimensions.height * dimensions.depth).toBeLessThanOrEqual(125);
  return world(registry, edit(registry, block(registry, dimensions), edits).block, absoluteTick);
};
function finish<J extends { progress(): { status: string }; advance(work?: number): unknown }>(
  job: J,
  work = 7,
): J {
  let calls = 0;
  while (job.progress().status === 'running') {
    if (++calls > 10000) throw Error('Tiny job work bound');
    job.advance(work);
  }
  return job;
}
const run = (s = state(), options = capture, work = 7, registry = r) =>
  finish(tick(registry, s, options), work);
const apply = (b: ReactiveMaterialBlock3D, trace: ReactiveMotionReport3D) => {
  const out = structuredClone(b);
  for (const pass of trace.passes)
    for (const c of pass.changes) {
      out.packedCells[c.index] = c.packed;
      out.energyQ[c.index] = c.energyQ;
      out.structure[c.index] = c.structure;
    }
  return out;
};
function input(absoluteTick = 0, edits: ReactiveMaterialEdit3D[] = [place()]) {
  return {
    worldId: 'motion-world',
    gameRulesVersion: 'motion-game-1',
    domains: domains(r, state(edits, absoluteTick), [
      { id: 'flask', world: state([], absoluteTick) },
    ]),
    game: { ap: 2, turn: 0 },
  };
}
type Game = ReturnType<typeof input>['game'];
function ready(b: ReactiveBranch3D<Game>, work = 7) {
  let calls = 0;
  while (['preparing', 'running'].includes(b.progress().status)) {
    if (++calls > 10000) throw Error('Tiny branch work bound');
    b.advance(work);
  }
  return b;
}

describe('executed reactive motion and bounded preview provenance', () => {
  test('default capture is explicitly disabled without changing the existing result shape', () => {
    const j = run(state(), {});
    expect(j.motion()).toMatchObject({
      status: 'disabled',
      requiresReexecution: true,
      entries: 0,
      passesObserved: 0,
      passes: [],
    });
    expect(Object.keys(j.result()).sort()).toEqual(['report', 'state']);
    expect(Object.hasOwn(j.result().state, 'motion')).toBe(false);
  });
  test('complete capture has all 29 ordered boundaries and reconstructs the exact final coordinates', () => {
    const before = state([place(0, 0, MAT.SAND), place(1, 0, MAT.WATER, 40), place(2, 0)]),
      j = run(before),
      trace = j.motion();
    expect(trace.status).toBe('complete');
    expect(trace.passes.map((p) => p.index)).toEqual(Array.from({ length: 29 }, (_, i) => i));
    expect(trace.passes.map((p) => p.kind)).toEqual([
      ...new Array(20).fill('movement'),
      ...new Array(6).fill('heat'),
      'phase',
      'combustion',
      'structure',
    ]);
    expect(trace.entries).toBe(
      trace.passes.reduce((n, p) => n + 1 + p.segments.length + p.changes.length, 0),
    );
    expect(apply(before.block, trace)).toEqual(j.result().state.block);
    expect(trace).toMatchObject({
      fromTick: 0,
      toTick: 1,
      width: 3,
      height: 3,
      depth: 1,
      materialCatalogHash: r.hash,
      worldRulesVersion: 'reactive-world-1',
    });
  });
  test('captured and uncaptured complete states reports and accounting match across rotated schedules', () => {
    for (const absolute of [0, 1, 2, 3]) {
      const before = state(
        [place(0, 0, MAT.SAND), place(1, 0, MAT.WATER, 40), place(2, 2, MAT.STEAM, 150)],
        absolute,
      );
      expect(run(before, capture, 1).result()).toEqual(run(before, {}, 256).result());
    }
  });
  test('movement segments follow actual single-pass swaps with exact slot lineage', () => {
    const before = state(
        [place(0, 0, MAT.SAND), place(1, 0, MAT.WATER, 40), place(2, 2, MAT.STEAM, 150)],
        3,
      ),
      trace = run(before).motion();
    let current = before.block,
      origins = Array.from({ length: current.packedCells.length }, (_, i) => i);
    for (let index = 0; index < 20; index++) {
      const out = runReactiveMovementPass3D(r, current, 3, index),
        expected: ReactiveMotionSegment3D[] = [],
        next = [...origins];
      for (const [a, b] of out.swaps) {
        expected.push(
          { origin: origins[a], from: a, to: b, mode: 'linear', component: null },
          { origin: origins[b], from: b, to: a, mode: 'linear', component: null },
        );
        next[a] = origins[b];
        next[b] = origins[a];
      }
      expect(trace.passes[index].segments).toEqual(expected.sort((a, b) => a.from - b.from));
      expect(apply(current, { ...trace, passes: [trace.passes[index]] })).toEqual(out.block);
      current = out.block;
      origins = next;
    }
  });
  test('composed segment destinations agree with the existing whole-tick permutation', () => {
    const before = state([place(0, 0, MAT.WATER, 40), place(1), place(2)]),
      j = run(before),
      trace = j.motion(),
      n = before.block.packedCells.length;
    let positions = Array.from({ length: n }, (_, i) => i);
    for (const pass of trace.passes) {
      const next = [...positions];
      for (const s of pass.segments) {
        expect(positions[s.from]).toBe(s.origin);
        next[s.to] = s.origin;
      }
      expect(new Set(next).size).toBe(n);
      positions = next;
    }
    const destinations = new Array<number>(n);
    positions.forEach((origin, i) => {
      destinations[origin] = i;
    });
    expect(destinations.flatMap((to, from) => (to === from ? [] : [{ from, to }]))).toEqual(
      j.result().report.moves,
    );
  });
  test('falling bonded fragments are linear while long displaced occupants are relocations', () => {
    const before = state(
      [place(0, 0), place(0, 1), { kind: 'bond', x: 0, y: 0, z: 0, direction: 3, bonded: true }],
      0,
      { width: 1, height: 3, depth: 1 },
    );
    expect(run(before).motion().passes[28].segments).toEqual([
      { origin: 0, from: 0, to: 1, mode: 'linear', component: 0 },
      { origin: 1, from: 1, to: 2, mode: 'linear', component: 0 },
      { origin: 2, from: 2, to: 0, mode: 'relocation', component: null },
    ]);
  });
  test('structural capture includes the distant bridge released by a removed support', () => {
    const edits: ReactiveMaterialEdit3D[] = [
      ...Array.from({ length: 5 }, (_, x) => place(x)),
      ...Array.from({ length: 4 }, (_, x) => ({
        kind: 'bond' as const,
        x,
        y: 0,
        z: 0,
        direction: 1,
        bonded: true,
      })),
    ];
    const j = run(state(edits, 0, { width: 5, height: 2, depth: 1 })),
      segments = j.motion().passes[28].segments;
    expect(segments.filter((s) => s.mode === 'linear').map((s) => s.from)).toEqual([0, 1, 2, 3, 4]);
    expect(segments.find((s) => s.from === 4)).toMatchObject({ to: 9, component: 0 });
  });
  test('heat changes retain exact energy at each boundary and reconstruct actual conductivity', () => {
    const before = state(
        [place(0, 0, MAT.STONE, 150), place(1, 0, MAT.STONE, 20)],
        0,
        { width: 2, height: 1, depth: 1 },
        warm,
      ),
      j = run(before, capture, 7, warm),
      trace = j.motion();
    expect(trace.passes[20].changes.length).toBeGreaterThan(0);
    let b = before.block;
    const total = b.energyQ.reduce((a, q) => a + BigInt(q), 0n);
    for (const p of trace.passes) {
      b = apply(b, { ...trace, passes: [p] });
      expect(b.energyQ.reduce((a, q) => a + BigInt(q), 0n)).toBe(total);
    }
    expect(b).toEqual(j.result().state.block);
  });
  test('freezing occurs at the recorded phase boundary without invented movement', () => {
    const before = state([place(0, 1, MAT.WATER, 0)], 0, { width: 1, height: 2, depth: 1 }),
      trace = run(before).motion();
    expect(trace.passes[26].changes.some((c) => (c.packed & 255) === MAT.ICE)).toBe(true);
    expect(trace.passes[26].segments).toEqual([]);
  });
  test('combustion transformations appear after phase changes and conserve the captured energy', () => {
    const before = state([place(0, 1, MAT.WOOD, 181)], 0, { width: 1, height: 2, depth: 1 }),
      j = run(before),
      trace = j.motion();
    expect(j.result().report.evolution.reactions.reactedPairs.length).toBe(1);
    expect(trace.passes[27].changes.length).toBe(2);
    expect(trace.passes[27].segments).toEqual([]);
    expect(apply(before.block, trace)).toEqual(j.result().state.block);
  });
  test('temporary holds never leak anchor overlays and permanent anchors remain canonical', () => {
    for (const permanent of [false, true]) {
      const before = state([
          place(),
          ...(permanent ? [{ kind: 'anchor' as const, x: 0, y: 0, z: 0, anchored: true }] : []),
        ]),
        owner = createReactiveWorld3D(r, before.block);
      owner.hold({ id: 'lift', cells: [[0, 0, 0]], expiresAtTick: 2 });
      const saved = owner.snapshot(),
        j = finish(owner.prepareTick(capture));
      expect(apply(saved.block, j.motion())).toEqual(j.result().state.block);
      if (!permanent)
        expect(
          j
            .motion()
            .passes.flatMap((p) => p.changes)
            .every((c) => !(c.structure & ANCHOR_3D)),
        ).toBe(true);
      expect(j.motion().passes.every((p) => p.segments.length === 0)).toBe(true);
      // Nothing moves or heats the held stone, so no pass may record it: stripping the overlay must
      // start no later than the pass after the last movement pass.
      expect(
        j
          .motion()
          .passes.flatMap((p) => p.changes)
          .filter((c) => c.index === 0),
      ).toEqual([]);
      expect(Boolean(j.result().state.block.structure[0] & ANCHOR_3D)).toBe(permanent);
    }
  });
  test('a melting held cell retires canonically before the structural pass', () => {
    const before = state([place(0, 0, MAT.ICE, 60)], 0, { width: 1, height: 2, depth: 1 }),
      owner = createReactiveWorld3D(r, before.block);
    owner.hold({ id: 'ice', cells: [[0, 0, 0]], expiresAtTick: 2 });
    const saved = owner.snapshot(),
      j = finish(owner.prepareTick(capture));
    expect(j.motion().passes[26].changes.some((c) => (c.packed & 255) === MAT.WATER)).toBe(true);
    expect(apply(saved.block, j.motion())).toEqual(j.result().state.block);
    expect(
      j
        .motion()
        .passes.flatMap((p) => p.changes)
        .every((c) => !(c.structure & ANCHOR_3D)),
    ).toBe(true);
  });
  test('a complete trace is independent of graph slice size and survives a fresh JSON registry', async () => {
    const before = state([place(), place(1), place(2, 2, MAT.WATER, 40)], 1),
      a = run(before, capture, 1),
      b = run(before, capture, 256);
    expect(a.motion()).toEqual(b.motion());
    expect(a.result()).toEqual(b.result());
    const restored = await createReactiveMaterialRegistry3D(
        JSON.parse(JSON.stringify(r.toCatalog())),
      ),
      c = run(JSON.parse(JSON.stringify(before)), capture, 7, restored);
    expect(c.motion()).toEqual(a.motion());
    expect(c.result()).toEqual(a.result());
  });
  test('dense odd-volume capture remains bounded and exactly matches uncaptured physics', () => {
    const before = state([place(0, 0, MAT.SAND), place(2, 0), place(1, 2, MAT.WATER, 40)], 1, {
        width: 5,
        height: 5,
        depth: 5,
      }),
      j = run(before);
    expect(j.motion().entries).toBeLessThanOrEqual(8192);
    expect(apply(before.block, j.motion())).toEqual(j.result().state.block);
    expect(j.result()).toEqual(run(before, {}).result());
  });
  test('a budget counts empty pass headers exactly and one fewer entry overflows', () => {
    const before = state([], 0, { width: 1, height: 1, depth: 1 });
    expect(run(before, { motion: { maxEntries: 29 } }).motion()).toMatchObject({
      status: 'complete',
      entries: 29,
      passesObserved: 29,
    });
    expect(run(before, { motion: { maxEntries: 28 } }).motion()).toMatchObject({
      status: 'overflow',
      entries: 0,
      passes: [],
      overflowAtPass: 28,
      passesObserved: 29,
    });
  });
  test('overflow during moving tuples clears all partial data without altering the physical result', () => {
    const before = state([place(0, 0, MAT.SAND)]),
      unlimited = run(before),
      exact = unlimited.motion().entries;
    expect(run(before, { motion: { maxEntries: exact } }).motion().status).toBe('complete');
    for (const n of [0, 1, 2, 4, exact - 1]) {
      const j = run(before, { motion: { maxEntries: n } });
      expect(j.motion()).toMatchObject({
        status: 'overflow',
        requiresReexecution: true,
        entries: 0,
        passes: [],
        passesObserved: 29,
      });
      expect(j.result()).toEqual(unlimited.result());
    }
  });
  test('random captures equal full block diffs at every boundary and overflow at the exact pass', () => {
    let seed = 4242;
    const next = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return Math.floor((seed / 4294967296) * n);
    };
    const ids = warm.materialIds,
      diff = (from: ReactiveMaterialBlock3D, to: ReactiveMaterialBlock3D) =>
        to.packedCells.flatMap((packed, index) =>
          packed !== from.packedCells[index] ||
          to.energyQ[index] !== from.energyQ[index] ||
          to.structure[index] !== from.structure[index]
            ? [{ index, packed, energyQ: to.energyQ[index], structure: to.structure[index] }]
            : [],
        );
    let overflowed = 0;
    for (let k = 0; k < 24; k++) {
      const size = { width: 1 + next(5), height: 1 + next(5), depth: 1 + next(5) };
      let b = block(warm, size);
      for (let e = 8 + next(32); e > 0; e--) {
        const at = { x: next(size.width), y: next(size.height), z: next(size.depth) },
          roll = next(10);
        const change: ReactiveMaterialEdit3D =
          roll < 8
            ? { ...at, kind: 'place', material: ids[next(ids.length)], thermal: next(256) }
            : roll < 9
              ? { ...at, kind: 'integrity', integrity: next(256) }
              : { ...at, kind: 'bond', direction: next(6), bonded: true };
        try {
          b = edit(warm, b, [change]).block;
        } catch {
          // Ineligible edits are skipped.
        }
      }
      const before = world(warm, b, next(8)),
        boundaries: ReactiveMaterialBlock3D[] = [before.block];
      // Reference blocks are copied at every evolution boundary before a later pass can reuse them.
      const evolution = startReactiveEvolutionJob3D(
        warm,
        {
          schemaVersion: 1,
          rulesVersion: REACTIVE_EVOLUTION_RULES_3D,
          tick: before.tick,
          block: before.block,
        },
        { swap() {}, pass: (_index, x) => boundaries.push(structuredClone(x)) },
      );
      for (let i = 0; i < 28; i++) evolution.job.advance();
      const full = run(
          before,
          { motion: { maxEntries: REACTIVE_MOTION_LIMITS_3D.entries } },
          5,
          warm,
        ),
        trace = full.motion();
      boundaries.push(full.result().state.block);
      expect(trace.status).toBe('complete');
      expect(trace.passes.map((p) => p.changes)).toEqual(
        boundaries.slice(1).map((x, i) => diff(boundaries[i], x)),
      );
      const needs = trace.passes.map((p) => 1 + p.segments.length + p.changes.length);
      for (const maxEntries of [next(71), next(71), trace.entries - 1, trace.entries]) {
        let used = 0,
          at: number | null = null;
        for (const [index, need] of needs.entries()) {
          if (used + need > maxEntries) {
            at = index;
            break;
          }
          used += need;
        }
        const j = run(before, { motion: { maxEntries } }, 1 + next(9), warm);
        if (at === null) expect(j.motion()).toEqual({ ...trace, maxEntries });
        else {
          overflowed++;
          expect(j.motion()).toMatchObject({
            status: 'overflow',
            overflowAtPass: at,
            entries: 0,
            passes: [],
            passesObserved: 29,
          });
        }
        expect(j.result()).toEqual(full.result());
      }
    }
    expect(overflowed).toBeGreaterThan(24);
  });
  test('invalid capture options reject before work without invoking getters', () => {
    const s = state(),
      getter = vi.fn(() => 1);
    for (const options of [
      null,
      { extra: true },
      { motion: undefined },
      { motion: null },
      { motion: { extra: 1 } },
      ...[-1, 65537, 1.5, NaN, Infinity].map((maxEntries) => ({ motion: { maxEntries } })),
    ])
      expect(() => tick(r, s, options as never)).toThrow();
    expect(() =>
      tick(r, s, {
        motion: Object.defineProperty({}, 'maxEntries', { get: getter, enumerable: true }),
      }),
    ).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(Object.isFrozen(REACTIVE_MOTION_LIMITS_3D)).toBe(true);
  });
  test('capture options are owned before the caller can mutate their budget', () => {
    const opts = { motion: { maxEntries: 29 } },
      j = tick(r, state([], 0, { width: 1, height: 1, depth: 1 }), opts);
    opts.motion.maxEntries = 0;
    finish(j);
    expect(j.motion().status).toBe('complete');
  });
  test('no partial motion is observable and cancellation releases every major job phase', () => {
    for (const phase of ['evolution', 'structure-prepare', 'structure', 'publish']) {
      const j = tick(r, state(), capture);
      let calls = 0;
      while (j.progress().phase !== phase) {
        if (++calls > 1000) throw Error('Fixture');
        expect(() => j.motion()).toThrow();
        j.advance(1);
      }
      expect(() => j.motion()).toThrow();
      expect(j.cancel()).toBe(true);
      expect(() => j.motion()).toThrow();
      expect(() => j.result()).toThrow();
      expect(j.cancel()).toBe(false);
    }
  });
  test('completed trace reads are isolated and cannot mutate results or other trace reads', () => {
    const j = run(),
      before = j.result(),
      first = j.motion();
    first.passes[28].segments[0].origin = 99;
    first.passes[28].changes.length = 0;
    first.entries = 0;
    expect(j.motion().passes[28].segments[0].origin).toBe(0);
    expect(j.result()).toEqual(before);
    expect(j.cancel()).toBe(false);
    expect(j.motion().entries).toBeGreaterThan(0);
  });
  test('world ownership keeps observation options revision-bound and invalid options preserve prior jobs', () => {
    const owner = createReactiveWorld3D(r, state().block),
      old = owner.prepareTick(capture);
    expect(() => owner.prepareTick({ motion: { maxEntries: -1 } })).toThrow();
    finish(old);
    owner.commitTick(old);
    expect(owner.energyBalance().driftQ).toBe(0n);
    expect(old.motion().status).toBe('complete');
    const stale = owner.prepareTick(capture);
    owner.edit([]);
    finish(stale);
    expect(() => owner.commitTick(stale)).toThrow(/stale/);
  });
  test('reservoirs share one aggregate entry budget and overflow clears earlier domain traces', () => {
    const empty = state([], 0, { width: 1, height: 1, depth: 1 }),
      all = domains(r, empty, [{ id: 'flask', world: empty }]);
    const complete = finish(domainTick(r, all, { motion: { maxEntries: 58 } }));
    expect(complete.motion()).toMatchObject({ status: 'complete', entries: 58 });
    expect(complete.motion().domains.map((d) => d.motion.maxEntries)).toEqual([58, 29]);
    const overflow = finish(domainTick(r, all, { motion: { maxEntries: 57 } }));
    expect(overflow.motion()).toMatchObject({
      status: 'overflow',
      entries: 0,
      domains: [],
      overflowDomain: 'flask',
    });
    expect(overflow.result()).toEqual(complete.result());
  });
  test('eight domains cannot multiply the capture budget and disabled domain capture stays empty', () => {
    const empty = state([], 0, { width: 1, height: 1, depth: 1 }),
      all = domains(
        r,
        empty,
        Array.from({ length: 7 }, (_, i) => ({ id: 'r' + i, world: empty })),
      );
    const j = finish(domainTick(r, all, { motion: { maxEntries: 232 } }));
    expect(j.motion().entries).toBe(232);
    expect(j.motion().domains.length).toBe(8);
    expect(finish(domainTick(r, all, { motion: { maxEntries: 231 } })).motion()).toMatchObject({
      status: 'overflow',
      overflowDomain: 'r6',
      domains: [],
    });
    expect(finish(domainTick(r, all)).motion()).toMatchObject({
      status: 'disabled',
      entries: 0,
      domains: [],
    });
  });
  test('cancelled partial domain sets expose neither completed primary traces nor partial reservoirs', () => {
    const all = input().domains,
      j = domainTick(r, all, capture);
    let calls = 0;
    while (j.progress().completedDomains === 0) {
      if (++calls > 1000) throw Error('Fixture');
      j.advance(7);
    }
    expect(() => j.motion()).toThrow();
    expect(j.cancel()).toBe(true);
    expect(() => j.motion()).toThrow();
    expect(() => j.result()).toThrow();
  });
  test('domain owner commits captured and uncaptured ticks with identical reports and accounting', () => {
    const raw = input().domains,
      owners = [
        createReactiveDomainSet3D(r, raw.world, raw.reservoirs),
        createReactiveDomainSet3D(r, raw.world, raw.reservoirs),
      ];
    const results = owners.map((o, i) => o.commitTick(finish(o.prepareTick(i ? capture : {}))));
    expect(results[0]).toEqual(results[1]);
    expect(owners[0].snapshot()).toEqual(owners[1].snapshot());
    expect(owners[0].energyBalance()).toEqual(owners[1].energyBalance());
  });
  test('session movement is privately bound to exactly the reducer query boundaries', () => {
    const s = session(r, input(), {
        reduceTick(c) {
          const m = c.movement(),
            source = reactiveTickMovementSource3D(m);
          expect(source.before).toBe(reactiveGeometrySource3D(c.beforeQueries()).token);
          expect(source.after).toBe(reactiveGeometrySource3D(c.queries()).token);
          expect(m.from).toEqual(c.beforeQueries().stamp);
          expect(m.to).toEqual(c.queries().stamp);
          expect(m.trace?.passes.length).toBe(29);
          expect(c.movement('flask').to.domain).toBe('flask');
          return { ...c.game, turn: 1 };
        },
      }),
      b = s.branch({ horizonTicks: 1, ...capture });
    ready(b);
    expect(b.lastMovement()?.status).toBe('complete');
    s.commit(b);
    expect(s.snapshot().game.turn).toBe(1);
  });
  test('public movement edits and cloned records cannot change or forge private provenance', () => {
    const s = session(r, input()),
      b = s.branch({ horizonTicks: 1, ...capture });
    ready(b);
    const m = b.lastMovement()!,
      privateData = reactiveTickMovementSource3D(m),
      original = structuredClone(privateData.trace);
    m.trace!.passes.length = 0;
    m.status = 'overflow';
    expect(reactiveTickMovementSource3D(m).trace).toEqual(original);
    expect(b.lastMovement()!.trace!.passes.length).toBe(29);
    expect(() => reactiveTickMovementSource3D(structuredClone(m))).toThrow();
    expect(() => reactiveTickMovementSource3D({ ...m })).toThrow();
  });
  test('movement accessors retain their original tick after later ticks and branch discard', () => {
    const kept: ReactiveSessionMovementAccess3D[] = [],
      s = session(r, input(3), {
        reduceTick(c) {
          kept.push(c.movement);
          return c.game;
        },
      }),
      b = s.branch({ horizonTicks: 2, ...capture });
    expect(b.lastMovement()).toBeNull();
    ready(b);
    expect(b.lastMovement()?.to.tick).toBe(5);
    b.discard();
    expect(() => b.lastMovement()).toThrow();
    expect(kept.map((k) => [k().from.tick, k().to.tick])).toEqual([
      [3, 4],
      [4, 5],
    ]);
  });
  test('partial next ticks retain only the previous complete movement observation', () => {
    const s = session(r, input()),
      b = s.branch({ horizonTicks: 2, ...capture });
    let calls = 0;
    while (b.progress().completedTicks < 1) {
      if (++calls > 1000) throw Error('Fixture');
      b.advance(7);
    }
    const prior = b.lastMovement();
    b.advance(1);
    b.advance(1);
    expect(b.lastMovement()).toEqual(prior);
    ready(b);
    expect(b.lastMovement()?.from.tick).toBe(1);
  });
  test('missing capture is explicit and a required-motion policy rolls back a paid ability', () => {
    const policy: ReactiveSessionPolicy3D<Game> = {
      reduceTick(c) {
        const m = c.movement();
        expect(m).toMatchObject({ status: 'disabled', requiresReexecution: true, trace: null });
        throw Error('Motion required');
      },
    };
    const s = session(r, input(), policy),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 1 });
    b.enqueue({ kind: 'game', game: { ap: 0, turn: 0 } });
    expect(() => ready(b)).toThrow(/Motion required/);
    expect(s.snapshot()).toEqual(before);
  });
  test('aggregate overflow reaches every domain policy and can reject the whole transaction', () => {
    const s = session(r, input(), {
        reduceTick(c) {
          for (const id of [null, 'flask'])
            expect(c.movement(id)).toMatchObject({
              status: 'overflow',
              trace: null,
              requiresReexecution: true,
            });
          throw Error('Reexecute');
        },
      }),
      before = s.snapshot(),
      b = s.branch({ horizonTicks: 1, motion: { maxEntries: 0 } });
    b.enqueue({ kind: 'game', game: { ap: 1, turn: 0 } });
    expect(() => ready(b)).toThrow(/Reexecute/);
    expect(s.snapshot()).toEqual(before);
    expect(s.energyBalance().driftQ).toBe(0n);
  });
  test('invalid branch capture options preserve existing candidates and caller mutation cannot change accepted budgets', () => {
    const s = session(r, input()),
      old = s.branch({ horizonTicks: 0 });
    expect(() => s.branch({ horizonTicks: 1, motion: { maxEntries: -1 } })).toThrow();
    ready(old);
    s.commit(old);
    const options = { horizonTicks: 1, motion: { maxEntries: 8192 } },
      b = s.branch(options);
    options.motion.maxEntries = 0;
    ready(b);
    expect(b.lastMovement()?.status).toBe('complete');
  });
  test('observation binding rejects another branch or an incorrect trace boundary', () => {
    const contexts: Parameters<NonNullable<ReactiveSessionPolicy3D<Game>['reduceTick']>>[0][] = [],
      s = session(r, input(), {
        reduceTick(c) {
          contexts.push(c);
          return c.game;
        },
      });
    ready(s.branch({ horizonTicks: 1, ...capture }));
    ready(s.branch({ horizonTicks: 1, ...capture }));
    const [a, b] = contexts;
    expect(() =>
      bindReactiveTickMovement3D(a.beforeQueries(), b.queries(), 'complete', a.movement().trace),
    ).toThrow();
    const bad = a.movement().trace!;
    bad.fromTick++;
    expect(() =>
      bindReactiveTickMovement3D(a.beforeQueries(), a.queries(), 'complete', bad),
    ).toThrow();
  });
  test('captured and uncaptured sessions produce identical complete state and continue exactly after odd-tick restart', () => {
    const raw = input(3),
      a = session(r, raw),
      b = session(r, raw);
    a.commit(ready(a.branch({ horizonTicks: 1, ...capture })));
    b.commit(ready(b.branch({ horizonTicks: 1 })));
    expect(a.snapshot()).toEqual(b.snapshot());
    const resumed = session(r, raw);
    resumed.restore(JSON.parse(JSON.stringify(a.snapshot())));
    const left = ready(a.branch({ horizonTicks: 2, ...capture })),
      right = ready(resumed.branch({ horizonTicks: 2, ...capture }));
    expect(left.lastMovement()!.trace).toEqual(right.lastMovement()!.trace);
    expect(a.commit(left).snapshot).toEqual(resumed.commit(right).snapshot);
  });
});
