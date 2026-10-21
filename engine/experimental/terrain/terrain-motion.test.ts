import { holdPhysics } from '../../test-support/hold-physics.js';
import { seed, index, factory, type Spec } from './terrain-motion.fixtures.js';
import { describe, expect, test, vi } from 'vitest';
import { MAT } from '../3d.js';
import { buildColdTable } from '../../generated/materials.js';
import { thermalView } from '../../thermal.js';
import { volumeSchedule } from '../3d-core.js';

import { createTacticalSessionCore3D } from '../tactical/tactical-session-core.js';
import {
  createTerrainMotion3D,
  TERRAIN_MOTION_RULES_3D,
  type TerrainMotion3D,
} from './terrain-motion.js';
import { createTerrainBody3D, type TerrainBodyState3D } from './terrain-body.js';
import {
  createGameplayGeometry3D,
  GEOMETRY_SCALE_3D as Q,
  type GameplayGeometry3D,
} from '../gameplay-geometry.js';
import type { TickMovement3D } from '../path-journal.js';

// Synthetic executed permutations and static/edit queries only; no M5 solve/tick.
holdPhysics('solveStructure3D', 'step', 'stepWithMotion', 'stepWithMotionPaths');
async function fixture(terrain = seed(), spec: Spec = {}, capturePaths = true) {
  let context!: TerrainMotion3D,
    before!: GameplayGeometry3D,
    after!: GameplayGeometry3D,
    movement!: TickMovement3D;
  const s = createTacticalSessionCore3D(
    { worldId: 'terrain-motion-world', gameRulesVersion: 'fixture-1', terrain, game: { ap: 2 } },
    factory(spec),
    {
      reduceTick: ({ game, beforeQueries, queries, movement: read }) => {
        before = beforeQueries();
        after = queries();
        movement = read();
        context = createTerrainMotion3D(before, after, movement);
        return game;
      },
    },
    async () => {},
  );
  const b = s.branch({ horizonTicks: 1, capturePaths });
  await b.advance(1);
  const commit = s.commit(b);
  return {
    context,
    before,
    after,
    movement,
    s,
    commit,
    body: (minQ: [number, number, number], sizeQ: [number, number, number] = [Q, Q, Q]) =>
      createTerrainBody3D(before, { minQ, sizeQ }),
  };
}
function pass(kind: string, axis: number, parity: number, direction = 1): number {
  const found = volumeSchedule(0).findIndex(
    (p) => p.kind === kind && p.axis === axis && p.parity === parity && p.direction === direction,
  );
  if (found < 0) throw Error('Missing synthetic schedule pass');
  return found + 1;
}
const slab = () => seed([[1, 2, 1, MAT.STONE]]),
  falling = { falls: [[index(1, 2, 1)]] };

describe('grounded actors and moving support', () => {
  test('complete empty motion preserves body state and reports exact boundary exposure', async () => {
    const f = await fixture(),
      input = f.body([Q, Q, Q]),
      r = f.context.reconcile(input);
    expect(r.status).toBe('resolved');
    expect(r.body).toEqual(input);
    expect(r.carriedQ).toEqual([0, 0, 0]);
    expect(r.coverage).toBe('complete');
    expect(r.contacts).toEqual([]);
    expect(r.from).toEqual(f.before.stamp);
    expect(r.to).toEqual(f.after.stamp);
    expect(r.exposure.stamp).toEqual(f.after.stamp);
  });
  test('a falling slab carries its grounded actor exactly one cell without altering velocity or actor step', async () => {
    const f = await fixture(slab(), falling),
      input = f.body([Q, Q, Q]),
      saved = structuredClone(input),
      r = f.context.reconcile(input);
    expect(r.status).toBe('resolved');
    expect(r.body.minQ).toEqual([Q, 2 * Q, Q]);
    expect(r.carriedQ).toEqual([0, Q, 0]);
    expect(r.supportFragments).toEqual([index(1, 2, 1)]);
    expect(r.body.grounded).toBe(true);
    expect(r.body.velocityQ).toEqual(input.velocityQ);
    expect(r.body.step).toBe(input.step);
    expect(input).toEqual(saved);
    expect(r.contacts).toEqual([]);
  });
  test('a stationary support prevents carry even when another contacted support falls', async () => {
    const f = await fixture(
        seed([
          [1, 2, 1, MAT.STONE],
          [2, 2, 1, MAT.STONE],
        ]),
        falling,
      ),
      input = f.body([Q, Q, Q], [2 * Q, Q, Q]),
      r = f.context.reconcile(input);
    expect(r.status).toBe('resolved');
    expect(r.carriedQ).toEqual([0, 0, 0]);
    expect(r.body.minQ).toEqual(input.minQ);
    expect(r.body.grounded).toBe(true);
    expect(r.supportFragments).toEqual([]);
  });
  test('separate fragments with the same fall jointly carry a shared actor', async () => {
    const f = await fixture(
      seed([
        [1, 2, 1, MAT.STONE],
        [2, 2, 1, MAT.STONE],
      ]),
      { falls: [[index(1, 2, 1)], [index(2, 2, 1)]] },
    );
    const r = f.context.reconcile(f.body([Q, Q, Q], [2 * Q, Q, Q]));
    expect(r.status).toBe('resolved');
    expect(r.carriedQ[1]).toBe(Q);
    expect(r.supportFragments).toHaveLength(2);
  });
  test('a body with no geometric support is not pulled down by a nearby fragment', async () => {
    const f = await fixture(slab(), falling),
      r = f.context.reconcile(f.body([Q, 0, Q]));
    expect(r.status).toBe('resolved');
    expect(r.carriedQ[1]).toBe(0);
    expect(r.body.grounded).toBe(false);
  });
  test('an airborne saved body touching a platform is not attached automatically', async () => {
    const f = await fixture(slab(), falling),
      input = f.body([Q, Q, Q]);
    input.grounded = false;
    const r = f.context.reconcile(input);
    expect(r.status).toBe('resolved');
    expect(r.carriedQ[1]).toBe(0);
    expect(r.body.grounded).toBe(false);
  });
  test('loose powder support moves without carrying and reports lost footing', async () => {
    const a = index(1, 2, 1),
      f = await fixture(seed([[1, 2, 1, MAT.SAND]]), { swaps: new Map([[1, [[a, a + 4]]]]) });
    const r = f.context.reconcile(f.body([Q, Q, Q]));
    expect(r.status).toBe('resolved');
    expect(r.carriedQ[1]).toBe(0);
    expect(r.lostFooting).toBe(true);
    expect(r.body.grounded).toBe(false);
  });
  test('the closed world floor remains stationary support', async () => {
    const f = await fixture(),
      r = f.context.reconcile(f.body([Q, 3 * Q, Q]));
    expect(r.status).toBe('resolved');
    expect(r.body.grounded).toBe(true);
    expect(r.carriedQ[1]).toBe(0);
  });
  test('the full carry sweep reports a stationary ledge reached exactly at its endpoint', async () => {
    const f = await fixture(
      seed([
        [1, 2, 1, MAT.STONE],
        [2, 3, 1, MAT.STONE],
      ]),
      falling,
    );
    const r = f.context.reconcile(f.body([Q, Q, Q], [2 * Q, Q, Q]));
    expect(r.status).toBe('resolved');
    expect(r.carriedQ[1]).toBe(Q);
    expect(r.contacts).toMatchObject([
      { kind: 'stationary', time: { numerator: 1, denominator: 1 }, origin: index(2, 3, 1) },
    ]);
    expect(r.supportAfter.surfaces).toHaveLength(2);
  });
});

describe('observed debris paths and exact contacts', () => {
  test('incoming linear cells contact a fractional actor on every axis and sign', async () => {
    for (const axis of [0, 1, 2])
      for (const sign of [-1, 1]) {
        const a = [1, 1, 1],
          b = [1, 1, 1];
        a[axis] = sign > 0 ? 0 : 1;
        b[axis] = sign > 0 ? 1 : 0;
        const from = index(...(a as [number, number, number])),
          to = index(...(b as [number, number, number]));
        const p = axis === 1 ? 1 : pass('liquid', axis, 0);
        const f = await fixture(seed([[...(a as [number, number, number]), MAT.SAND]]), {
          swaps: new Map([[p, [[from, to]]]]),
        });
        const min = b.map((v) => v * Q + Q / 4) as [number, number, number],
          input = f.body(min, [Q / 2, Q / 2, Q / 2]),
          r = f.context.reconcile(input);
        expect(r.status).toBe('blocked');
        expect(r.body).toEqual(input);
        expect(r.contacts[0].time).toEqual({ numerator: 1, denominator: 4 });
        expect(r.contacts[0].normal[axis]).toBe(sign);
        expect(r.contacts[0].origin).toBe(from);
        expect(r.coverage).toBe('through-contact');
      }
  });
  test('diagonal contacts preserve exact fractions and deterministic X-before-Y axis ties', async () => {
    const from = index(0, 0, 1),
      to = index(1, 1, 1),
      p = pass('diagonal', 0, 0, 1);
    const f = await fixture(seed([[0, 0, 1, MAT.SAND]]), { swaps: new Map([[p, [[from, to]]]]) });
    const r = f.context.reconcile(f.body([Q + Q / 4, Q + Q / 4, Q + Q / 4], [Q / 2, Q / 2, Q / 2]));
    expect(r.status).toBe('blocked');
    expect(r.contacts[0].normal).toEqual([1, 0, 0]);
    expect(r.contacts[0].time).toEqual({ numerator: 1, denominator: 4 });
  });
  test('a transient round trip hits an actor even when net movement and final overlap are empty', async () => {
    const a = index(1, 0, 1),
      b = index(1, 1, 1),
      f = await fixture(seed([[1, 0, 1, MAT.SAND]]), {
        swaps: new Map([
          [1, [[a, b]]],
          [15, [[a, b]]],
        ]),
      });
    const input = f.body([Q, Q + Q / 4, Q], [Q, Q / 2, Q]),
      r = f.context.reconcile(input);
    expect(f.movement.motion!.moves).toEqual([]);
    expect(r.status).toBe('blocked');
    expect(r.fitsAfter).toBe(true);
    expect(r.contacts[0].pass).toBe(1);
  });
  test('a carried body and another falling fragment use relative simultaneous motion', async () => {
    const f = await fixture(
      seed([
        [1, 2, 1, MAT.STONE],
        [1, 0, 1, MAT.STONE],
      ]),
      { falls: [[index(1, 2, 1)], [index(1, 0, 1)]] },
    );
    const r = f.context.reconcile(f.body([Q, Q, Q]));
    expect(r.status).toBe('resolved');
    expect(r.carriedQ[1]).toBe(Q);
    expect(r.contacts).toEqual([]);
  });
  test('simultaneous debris contacts tie by original identity independent of actor iteration order', async () => {
    const a = index(1, 0, 1),
      b = index(2, 0, 1),
      f = await fixture(
        seed([
          [1, 0, 1, MAT.SAND],
          [2, 0, 1, MAT.SAND],
        ]),
        {
          swaps: new Map([
            [
              1,
              [
                [a, a + 4],
                [b, b + 4],
              ],
            ],
          ]),
        },
      );
    const input = f.body([Q, Q + 1, Q], [2 * Q, Q / 2, Q]),
      first = f.context.reconcile(input);
    f.context.reconcile(f.body([0, 0, 0]));
    expect(f.context.reconcile(input)).toEqual(first);
    expect(first.contacts.map((c) => c.origin)).toEqual([a, b]);
    expect(first.contacts[0].time).toEqual({ numerator: 1, denominator: Q });
  });
  test('nonblocking water and gas paths never become solid debris contacts', async () => {
    for (const material of [MAT.WATER, MAT.STEAM]) {
      const a = index(1, 0, 1),
        f = await fixture(seed([[1, 0, 1, material]]), { swaps: new Map([[1, [[a, a + 4]]]]) });
      const r = f.context.reconcile(f.body([Q, Q, Q]));
      expect(r.status).toBe('resolved');
      expect(r.contacts).toEqual([]);
      expect(r.exposure.materials[0].material).toBe(material);
    }
  });
  test('endpoint-only touching is reported without inventing penetration', async () => {
    const a = index(1, 0, 1),
      f = await fixture(seed([[1, 0, 1, MAT.SAND]]), { swaps: new Map([[1, [[a, a + 4]]]]) });
    const r = f.context.reconcile(f.body([Q, 2 * Q, Q]));
    expect(r.status).toBe('resolved');
    expect(r.contacts[0].time).toEqual({ numerator: 1, denominator: 1 });
    expect(r.fitsAfter).toBe(true);
  });
  test('synthetic relocated occupants do not produce impacts through intermediate space', async () => {
    // These synthetic air members leave an inspectable gap along a relocation.
    // This tests query semantics, not the physical eligibility of such a plan.
    const f = await fixture(seed([[1, 3, 1, MAT.STONE]]), {
      falls: [[index(1, 0, 1), index(1, 1, 1), index(1, 2, 1)]],
    });
    const r = f.context.reconcile(f.body([Q, Q, Q]));
    expect(r.status).toBe('resolved');
    expect(r.contacts).toEqual([]);
  });
  test('a relocated solid overlapping the actor at its destination is explicit', async () => {
    const f = await fixture(seed([[1, 3, 1, MAT.STONE]]), {
      falls: [[index(1, 0, 1), index(1, 1, 1), index(1, 2, 1)]],
    });
    const input = f.body([Q, 0, Q]),
      r = f.context.reconcile(input);
    expect(r.status).toBe('blocked');
    expect(r.body).toEqual(input);
    expect(r.contacts).toMatchObject([
      {
        kind: 'relocation',
        time: { numerator: 1, denominator: 1 },
        from: index(1, 3, 1),
        to: index(1, 0, 1),
      },
    ]);
  });
  test('phase-created solid overlap is explicit and leaves the actor state untouched', async () => {
    const before = seed([[1, 1, 1, MAT.WATER]]),
      after = seed([[1, 1, 1, MAT.ICE]]);
    // Equal total energy is required by the inert transaction coordinator.
    after.energyQ = before.energyQ.slice();
    after.packedCells[index(1, 1, 1)] = thermalView(
      after.packedCells[index(1, 1, 1)],
      after.energyQ[index(1, 1, 1)],
      buildColdTable(),
    );
    const f = await fixture(before, { after }),
      input = f.body([Q, Q, Q]),
      r = f.context.reconcile(input);
    expect(r.status).toBe('embedded');
    expect(r.body).toEqual(input);
    expect(r.contacts[0].kind).toBe('phase-overlap');
    expect(r.coverage).toBe('complete');
  });
});

describe('motion provenance, limits and application atomicity', () => {
  test('disabled and overflow observations are incomplete rather than empty movement', async () => {
    const disabled = await fixture(seed(), {}, false);
    expect(disabled.context.reconcile(disabled.body([Q, Q, Q]))).toMatchObject({
      status: 'incomplete',
      requiresReexecution: true,
      contacts: [],
    });
    const overflow = await fixture(slab(), { ...falling, overflow: true });
    expect(overflow.context.reconcile(overflow.body([Q, Q, Q]))).toMatchObject({
      status: 'incomplete',
      carriedQ: [0, 0, 0],
      contacts: [],
    });
  });
  test('contact budget overflow discards the complete prefix and cannot carry partially', async () => {
    const a = index(1, 0, 1),
      b = index(2, 0, 1),
      f = await fixture(
        seed([
          [1, 0, 1, MAT.SAND],
          [2, 0, 1, MAT.SAND],
        ]),
        {
          swaps: new Map([
            [
              1,
              [
                [a, a + 4],
                [b, b + 4],
              ],
            ],
          ]),
        },
      );
    const input = f.body([Q, Q + 1, Q], [2 * Q, Q / 2, Q]),
      r = f.context.reconcile(input, { maxContacts: 1 });
    expect(r).toMatchObject({
      status: 'incomplete',
      contacts: [],
      requiresReexecution: true,
      carriedQ: [0, 0, 0],
    });
    expect(r.body).toEqual(input);
    expect(f.context.reconcile(input, { maxContacts: 2 }).contacts).toHaveLength(2);
  });
  test('zero contact budget accepts a clean path and rejects the first actual contact', async () => {
    const f = await fixture(),
      r = f.context.reconcile(f.body([Q, Q, Q]), { maxContacts: 0 });
    expect(r.status).toBe('resolved');
    const a = index(1, 0, 1),
      debris = await fixture(seed([[1, 0, 1, MAT.SAND]]), { swaps: new Map([[1, [[a, a + 4]]]]) });
    expect(debris.context.reconcile(debris.body([Q, Q, Q]), { maxContacts: 0 }).status).toBe(
      'incomplete',
    );
  });
  test('invalid options reject without invoking accessors', async () => {
    const f = await fixture(),
      body = f.body([Q, Q, Q]),
      get = vi.fn(() => 1);
    for (const maxContacts of [-1, 4097, 0.5, NaN])
      expect(() => f.context.reconcile(body, { maxContacts })).toThrow(/budget/);
    expect(() =>
      f.context.reconcile(
        body,
        Object.defineProperty({}, 'maxContacts', { enumerable: true, get }),
      ),
    ).toThrow(/options/);
    expect(get).not.toHaveBeenCalled();
    expect(() => f.context.reconcile(body, { extra: true } as never)).toThrow(/options/);
  });
  test('cloned or forged observations cannot impersonate a live session record', async () => {
    const f = await fixture();
    expect(() => createTerrainMotion3D(f.before, f.after, structuredClone(f.movement))).toThrow(
      /live tick/,
    );
    expect(() => createTerrainMotion3D(f.before, f.after, { ...f.movement })).toThrow(/live tick/);
  });
  test('identical revision text from a different session cannot substitute its geometry', async () => {
    const a = await fixture(),
      b = await fixture();
    expect(a.before.stamp).toEqual(b.before.stamp);
    expect(() => createTerrainMotion3D(a.before, b.after, a.movement)).toThrow(/boundaries/);
    expect(() => createTerrainMotion3D(b.before, a.after, a.movement)).toThrow(/boundaries/);
  });
  test('wrong-domain or caller-cloned geometry is rejected', async () => {
    const f = await fixture(),
      other = createGameplayGeometry3D(seed(), { ...f.before.stamp, domain: 'flask' });
    expect(() => createTerrainMotion3D(other, f.after, f.movement)).toThrow(/boundaries/);
    expect(() => createTerrainMotion3D({ ...f.before }, f.after, f.movement)).toThrow(/isolated/);
  });
  test('public report mutations cannot change the private history and returned contacts are owned', async () => {
    const f = await fixture(slab(), falling),
      input = f.body([Q, Q, Q]),
      expected = f.context.reconcile(input);
    f.movement.paths!.passes.length = 0;
    f.movement.status = 'disabled';
    f.movement.motion!.fragments.length = 0;
    expect(createTerrainMotion3D(f.before, f.after, f.movement).reconcile(input)).toEqual(expected);
    expected.body.minQ[1] = 0;
    expected.supportFragments.length = 0;
    expected.exposure.materials.length = 0;
    expect(f.context.reconcile(input).body.minQ[1]).toBe(2 * Q);
    expect(f.context.reconcile(input).supportFragments).toHaveLength(1);
  });
  test('retained motion contexts preserve their boundary after later edits and restore', async () => {
    const f = await fixture(slab(), falling),
      input = f.body([Q, Q, Q]),
      expected = f.context.reconcile(input),
      saved = f.s.snapshot();
    const b = f.s.branch({ horizonTicks: 0 });
    b.edit([{ kind: 'material', x: 1, y: 3, z: 1, material: MAT.AIR }]);
    f.s.commit(b);
    f.s.restore(saved);
    expect(f.context.reconcile(input)).toEqual(expected);
    expect(Object.isFrozen(f.context)).toBe(true);
    expect(f.context.rulesVersion).toBe(TERRAIN_MOTION_RULES_3D);
  });
  test('an initially embedded or outside saved body cannot be silently depenetrated', async () => {
    const f = await fixture(slab(), falling),
      input = f.body([Q, Q, Q]);
    expect(f.context.reconcile({ ...input, minQ: [Q, 2 * Q, Q] }).status).toBe('embedded');
    expect(f.context.reconcile({ ...input, minQ: [-1, Q, Q] }).status).toBe('outside');
  });
  test('a reducer can atomically publish carried terrain, actor and AP', async () => {
    const base = await fixture(slab(), falling),
      actor = base.body([Q, Q, Q]);
    const s = createTacticalSessionCore3D(
      {
        worldId: 'terrain-motion-world',
        gameRulesVersion: 'carry-game-1',
        terrain: slab(),
        game: { actor, ap: 2 },
      },
      factory(falling),
      {
        requiresPaths: true,
        reduceTick: ({ game, beforeQueries, queries, movement }) => {
          const r = createTerrainMotion3D(beforeQueries(), queries(), movement()).reconcile(
            game.actor,
          );
          if (r.status !== 'resolved') throw Error('unresolved actor');
          return { actor: r.body, ap: game.ap - 1 };
        },
      },
      async () => {},
    );
    const before = s.snapshot(),
      b = s.branch({ horizonTicks: 1 });
    await b.advance(1);
    expect(s.snapshot()).toEqual(before);
    const committed = s.commit(b).snapshot;
    expect(committed.game.actor.minQ[1]).toBe(2 * Q);
    expect(committed.game.ap).toBe(1);
    expect(committed.terrain.tick).toBe(1);
  });
  test('rejecting a debris contact preserves terrain, actor, AP and revision together', async () => {
    const a = index(1, 0, 1),
      terrain = seed([[1, 0, 1, MAT.SAND]]),
      spec = { swaps: new Map([[1, [[a, a + 4] as [number, number]]]]) },
      base = await fixture(terrain, spec);
    const actor = base.body([Q, Q, Q]);
    const s = createTacticalSessionCore3D(
      {
        worldId: 'terrain-motion-world',
        gameRulesVersion: 'carry-game-1',
        terrain,
        game: { actor, ap: 2 },
      },
      factory(spec),
      {
        requiresPaths: true,
        reduceTick: ({ game, beforeQueries, queries, movement }) => {
          const r = createTerrainMotion3D(beforeQueries(), queries(), movement()).reconcile(
            game.actor,
          );
          if (r.status !== 'resolved') throw Error('debris policy rejects');
          return { actor: r.body, ap: 1 };
        },
      },
      async () => {},
    );
    const before = s.snapshot(),
      revision = s.revision,
      b = s.branch({ horizonTicks: 1 });
    await expect(b.advance(1)).rejects.toThrow(/debris policy/);
    expect(s.snapshot()).toEqual(before);
    expect(s.revision).toEqual(revision);
  });
  test('cleanup failure after successful carry cannot publish the staged actor', async () => {
    const base = await fixture(slab(), falling),
      actor: TerrainBodyState3D = base.body([Q, Q, Q]);
    const s = createTacticalSessionCore3D(
      {
        worldId: 'terrain-motion-world',
        gameRulesVersion: 'carry-game-1',
        terrain: slab(),
        game: { actor },
      },
      factory(falling, true),
      {
        requiresPaths: true,
        reduceTick: ({ game, beforeQueries, queries, movement }) => ({
          actor: createTerrainMotion3D(beforeQueries(), queries(), movement()).reconcile(game.actor)
            .body,
        }),
      },
      async () => {},
    );
    const before = s.snapshot(),
      b = s.branch({ horizonTicks: 1 });
    await expect(b.advance(1)).rejects.toThrow(/cleanup failed/);
    expect(s.snapshot()).toEqual(before);
  });
});
