import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Tiny saved constraints and real reactive ticks; old M5 runtime stays trapped. */
import { beforeAll, describe, expect, test, vi } from 'vitest';

import {
  createReactiveMaterialRegistry3D,
  defaultReactiveMaterialCatalog3D,
  createReactiveMaterialBlock3D as block,
  editReactiveMaterialBlock3D as edit,
  createReactiveWorldSnapshot3D as state,
  createConstrainedReactiveWorldSnapshot3D as constrained,
  readReactiveWorldSnapshot3D as read,
  createReactiveWorldTickJob3D as job,
  createReactiveTranslationJob3D,
  createReactiveWorld3D as world,
  REACTIVE_HOLD_LIMITS_3D,
  MAT,
  ANCHOR_3D,
  BONDS_3D,
  type ReactiveMaterialRegistry3D,
  type ReactiveMaterialEdit3D,
  type ReactiveHoldRequest3D,
  type ReactiveHold3D,
  type ReactiveWorld3D,
  type ReactiveWorldTickJob3D,
} from '../reactive-materials.js';
holdPhysics('volumeStep', 'solveStructure3D', ...STRUCTURAL_CALLS);
let r: ReactiveMaterialRegistry3D, custom: ReactiveMaterialRegistry3D;
beforeAll(async () => {
  const c = defaultReactiveMaterialCatalog3D();
  for (const m of c.propertiesCatalog.materials) m.properties.conductivity = 0;
  r = await createReactiveMaterialRegistry3D(c);
  const stone = structuredClone(r.material(MAT.STONE));
  Object.assign(stone.properties, {
    melt_point: 0,
    melts_into: 0,
    latent_heat_melt: 0,
    freeze_point: 0,
    boil_point: 0,
    softening: 20,
  });
  custom = await r.extend([
    { ...stone, id: 200, name: 'heat_weak_stone' },
    {
      ...stone,
      id: 201,
      name: 'fixed_shell',
      properties: { ...stone.properties, cohesion: 0, softening: 0 },
    },
  ]);
});
const at = { x: 0, y: 0, z: 0 };
const place = (
  x: number,
  y = 0,
  z = 0,
  material: number = MAT.STONE,
  thermal = 20,
): ReactiveMaterialEdit3D => ({ kind: 'place', x, y, z, material, thermal });
function fixture(
  edits: ReactiveMaterialEdit3D[] = [place(0)],
  dimensions = { width: 2, height: 3, depth: 1 },
  registry = r,
  tick = 0,
) {
  expect(dimensions.width * dimensions.height * dimensions.depth).toBeLessThanOrEqual(125);
  return state(registry, edit(registry, block(registry, dimensions), edits).block, tick);
}
const hold = (
  expiresAtTick = 2,
  id = 'lift',
  cells: ReactiveHoldRequest3D['cells'] = [[0, 0, 0]],
): ReactiveHoldRequest3D => ({ id, expiresAtTick, cells });
function finish(j: ReactiveWorldTickJob3D, budget = 7) {
  let calls = 0;
  while (j.progress().status === 'running') {
    if (++calls > 20 * 125 + 64) throw Error('Tiny fixture work bound exceeded.');
    j.advance(budget);
  }
  return j.result();
}
function tick(w: ReactiveWorld3D, budget = 7) {
  const j = w.prepareTick();
  finish(j, budget);
  return w.commitTick(j);
}
function suspended(material: number = MAT.STONE, thermal = 70, expiry = 2, registry = r) {
  const s = fixture([place(0, 0, 0, material, thermal)], undefined, registry),
    w = world(registry, s.block);
  w.hold(hold(expiry));
  return w;
}
describe('reactive hold state and deterministic lifetime', () => {
  test('default construction and v1 reads preserve the exact unconstrained format', () => {
    const s = fixture(),
      w = world(r, s.block);
    expect(w.snapshot()).toEqual(s);
    expect(w.snapshot().schemaVersion).toBe(1);
    expect(w.holds()).toEqual([]);
    expect(read(r, JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(Object.hasOwn(tick(w).report, 'holds')).toBe(false);
  });
  test('adding a hold explicitly creates v2 without altering canonical material or time', () => {
    const s = fixture(),
      w = world(r, s.block),
      balance = w.energyBalance(),
      result = w.hold(hold());
    expect(w.snapshot()).toEqual({
      schemaVersion: 2,
      rulesVersion: 'reactive-world-2',
      holdRulesVersion: 'reactive-holds-1',
      tick: 0,
      block: s.block,
      holds: [{ id: 'lift', expiresAtTick: 2, cells: [0] }],
    });
    expect(result.fromRevision).toBe(0);
    expect(result.toRevision).toBe(1);
    expect(result.rulesVersion).toBe('reactive-holds-1');
    expect(w.tick).toBe(0);
    expect(w.energyBalance()).toEqual(balance);
  });
  test('hold expiry constrains the final lifetime tick and allows falling on the next tick', () => {
    const w = suspended(),
      original = w.snapshot().block;
    const first = tick(w);
    expect(w.snapshot().block).toEqual(original);
    expect(w.holds()).toHaveLength(1);
    expect(first.report.holds?.expired).toEqual([]);
    const second = tick(w);
    expect(w.snapshot().block).toEqual(original);
    expect(w.holds()).toEqual([]);
    expect(second.report.holds?.expired).toEqual(['lift']);
    expect(second.report.holds?.structureCells).toEqual([0]);
    const third = tick(w);
    expect(third.report.structure.movingCells).toEqual([0]);
    expect(w.snapshot().block.packedCells[2] & 255).toBe(MAT.STONE);
    expect(w.energyBalance().driftQ).toBe(0n);
  });
  test('explicit release removes only the constraint and permits the next ordinary fall', () => {
    const w = suspended(),
      before = w.snapshot().block;
    const receipt = w.releaseHold('lift');
    expect(receipt.fromRevision).toBe(1);
    expect(receipt.toRevision).toBe(2);
    expect(w.snapshot().schemaVersion).toBe(2);
    expect(w.snapshot().block).toEqual(before);
    expect(tick(w).report.structure.movingCells).toEqual([0]);
    expect(w.energyBalance().externalQ).toBe(0n);
  });
  test('temporary holds never leak anchor bits into snapshots or completed block changes', () => {
    const w = suspended();
    for (let k = 0; k < 2; k++) {
      const receipt = tick(w);
      expect(w.snapshot().block.structure[0] & ANCHOR_3D).toBe(0);
      expect(receipt.report.changedCells).toEqual([]);
      expect(receipt.report.holds?.before).toHaveLength(1);
      expect(receipt.report.structure.distances[0]).toBe(0);
    }
  });
  test('a permanent anchor survives expiry and continues supporting the terrain', () => {
    const s = fixture([place(0), { ...at, kind: 'anchor', anchored: true }]),
      w = world(r, s.block);
    w.hold(hold(1));
    tick(w);
    tick(w);
    expect(w.holds()).toEqual([]);
    expect(w.snapshot().block).toEqual(s.block);
    expect(w.snapshot().block.structure[0] & ANCHOR_3D).toBe(ANCHOR_3D);
  });
  test('holding one member suspends its damaged bonded slab without healing or cooling', () => {
    const s = fixture([
      place(0, 0, 0, MAT.STONE, 70),
      place(1, 0, 0, MAT.STONE, 90),
      { ...at, kind: 'bond', direction: 1, bonded: true },
      { ...at, x: 1, kind: 'integrity', integrity: 73 },
    ]);
    const w = world(r, s.block);
    w.hold(hold());
    tick(w);
    expect(w.snapshot().block).toEqual(s.block);
    expect(w.snapshot().block.structure[1]).toBe(73 | BONDS_3D[0]);
  });
  test('thermal damage can destroy integrity while a valid constraint keeps debris stationary', () => {
    const w = suspended(200, 84, 3, custom),
      q = w.snapshot().block.energyQ[0];
    const first = tick(w);
    expect(first.report.structure.brokenCells).toEqual([0]);
    expect(w.snapshot().block.structure[0]).toBe(0);
    expect(w.holds()).toHaveLength(1);
    tick(w);
    expect(w.snapshot().block.packedCells[0] & 255).toBe(200);
    expect(w.snapshot().block.energyQ[0]).toBe(q);
    w.releaseHold('lift');
    tick(w);
    expect(w.snapshot().block.packedCells[4] & 255).toBe(200);
    expect(w.energyBalance().driftQ).toBe(0n);
  });
  test('already failed cohesive debris can be held without receiving new integrity', () => {
    const s = fixture([place(0), { ...at, kind: 'integrity', integrity: 0 }]),
      w = world(r, s.block);
    w.hold(hold());
    tick(w);
    expect(w.snapshot().block).toEqual(s.block);
    expect(w.holds()[0].cells).toEqual([0]);
  });
  test('heat exchange still operates on held material and conserves exact energy', async () => {
    const conductive = await createReactiveMaterialRegistry3D(),
      s = fixture([place(0, 0, 0, MAT.STONE, 70)], undefined, conductive);
    const w = world(conductive, s.block);
    w.hold(hold());
    const q = w.snapshot().block.energyQ[0];
    tick(w);
    expect(w.snapshot().block.energyQ[0]).toBeLessThan(q);
    expect(w.holds()).toHaveLength(1);
    expect(w.energyBalance().driftQ).toBe(0n);
  });
  test('held ice melts and retires before structural settlement without an anchor residue', () => {
    const w = suspended(MAT.ICE, 80, 3),
      result = tick(w);
    expect(w.holds()).toEqual([]);
    expect(w.snapshot().block.packedCells[0] & 255).toBe(MAT.WATER);
    expect(w.snapshot().block.structure[0]).toBe(0);
    expect(result.report.holds?.retired).toEqual([{ id: 'lift', cells: [0] }]);
    expect(result.report.holds?.structureCells).toEqual([]);
  });
  test('held fuel burns and releases its distant bridge during the same tick', () => {
    const s = fixture(
        [
          ...Array.from({ length: 5 }, (_, x) => place(x)),
          ...Array.from({ length: 4 }, (_, x) => ({
            ...at,
            x,
            kind: 'bond' as const,
            direction: 1,
            bonded: true,
          })),
          place(0, 1, 0, MAT.WOOD, 181),
        ],
        { width: 5, height: 3, depth: 1 },
      ),
      w = world(r, s.block);
    w.hold(hold(3, 'support', [[0, 1, 0]]));
    const result = tick(w);
    expect(w.holds()).toEqual([]);
    expect(result.report.holds?.retired).toEqual([{ id: 'support', cells: [5] }]);
    expect(result.report.structure.movingCells).toEqual([0, 1, 2, 3, 4]);
    expect(result.report.moves).toContainEqual({ from: 4, to: 9 });
    expect(w.snapshot().block.structure.every((word) => !(word & ANCHOR_3D))).toBe(true);
    expect(w.energyBalance().driftQ).toBe(0n);
  });
  test('partial transformation retires only the changed members of a hold', () => {
    const s = fixture([place(0, 0, 0, MAT.ICE, 80), place(1)]),
      w = world(r, s.block);
    w.hold(
      hold(3, 'pair', [
        [0, 0, 0],
        [1, 0, 0],
      ]),
    );
    const result = tick(w);
    expect(w.holds()).toEqual([{ id: 'pair', expiresAtTick: 3, cells: [1] }]);
    expect(result.report.holds?.retired).toEqual([{ id: 'pair', cells: [0] }]);
    expect(result.report.holds?.movementCells).toEqual([0, 1]);
    expect(result.report.holds?.structureCells).toEqual([1]);
  });
  test('a hold can both transform and reach its expiry in the same tick with both facts reported', () => {
    const w = suspended(MAT.ICE, 80, 1),
      result = tick(w);
    expect(result.report.holds?.expired).toEqual(['lift']);
    expect(result.report.holds?.retired).toEqual([{ id: 'lift', cells: [0] }]);
    expect(result.report.holds?.after).toEqual([]);
  });
  test('identical placement retires held identity even when the block diff is empty', () => {
    const s = fixture([place(0), place(1)]),
      w = world(r, s.block);
    w.hold(
      hold(3, 'pair', [
        [0, 0, 0],
        [1, 0, 0],
      ]),
    );
    const result = w.edit([place(0)]);
    expect(result.receipt.changedCells).toEqual([]);
    expect(result.receipt.externalEnergyQ).toBe('0');
    expect(w.snapshot().block).toEqual(s.block);
    expect(w.holds()).toEqual([{ id: 'pair', expiresAtTick: 3, cells: [1] }]);
    expect(tick(w).report.structure.movingCells).toEqual([0]);
  });
  test('energy integrity bonds and permanent-anchor edits preserve held identity', () => {
    const s = fixture([place(0), place(1)]),
      w = world(r, s.block);
    w.hold(hold(3));
    w.edit([
      { ...at, kind: 'energy', energyQ: s.block.energyQ[0] + 1 },
      { ...at, kind: 'integrity', integrity: 73 },
      { ...at, kind: 'bond', direction: 1, bonded: true },
      { ...at, kind: 'anchor', anchored: true },
    ]);
    expect(w.holds()).toEqual([{ id: 'lift', expiresAtTick: 3, cells: [0] }]);
    expect(w.energyBalance().externalQ).toBe(1n);
  });
  test('a failed late edit cannot retire holds or invalidate prepared work', () => {
    const w = suspended(),
      before = w.snapshot(),
      j = w.prepareTick();
    expect(() => w.edit([place(0), { ...at, x: 99, kind: 'place', material: MAT.AIR }])).toThrow();
    expect(w.snapshot()).toEqual(before);
    expect(w.revision).toBe(1);
    finish(j);
    w.commitTick(j);
  });
  test('translation cannot release a temporary hold via the permanent-anchor policy', () => {
    const w = suspended();
    expect(() =>
      w.prepareTranslation({ cells: [[0, 0, 0]], path: [[1, 0, 0]], anchors: 'release' }),
    ).toThrow(/hold/);
    expect(() =>
      createReactiveTranslationJob3D(r, w.snapshot(), { cells: [[0, 0, 0]], path: [[1, 0, 0]] }),
    ).toThrow(/hold/);
    w.releaseHold('lift');
    const j = w.prepareTranslation({ cells: [[0, 0, 0]], path: [[1, 0, 0]] });
    j.advance();
    j.advance();
    w.commitTranslation(j);
    expect(w.snapshot().block.packedCells[1] & 255).toBe(MAT.STONE);
  });
  test('unselected held zero-integrity debris blocks mobile displacement', () => {
    const s = fixture([place(0), place(1), { ...at, x: 1, kind: 'integrity', integrity: 0 }]),
      w = world(r, s.block);
    w.hold(hold(3, 'debris', [[1, 0, 0]]));
    const before = w.snapshot(),
      j = w.prepareTranslation({ cells: [[0, 0, 0]], path: [[1, 0, 0]], displacement: 'mobile' });
    expect(() => j.advance()).toThrow(/obstructed/);
    expect(w.snapshot()).toEqual(before);
    expect(w.revision).toBe(1);
  });
  test('unheld translations preserve other saved hold coordinates and lifetime', () => {
    const s = fixture([place(0), place(2)], { width: 4, height: 2, depth: 1 }),
      w = world(r, s.block);
    w.hold(hold(3));
    const j = w.prepareTranslation({ cells: [[2, 0, 0]], path: [[1, 0, 0]] });
    j.advance();
    j.advance();
    w.commitTranslation(j);
    expect(w.holds()).toEqual([{ id: 'lift', expiresAtTick: 3, cells: [0] }]);
    expect(w.snapshot().block.structure[0]).toBe(255);
  });
  test('adding or releasing holds makes older tick and translation jobs stale', () => {
    const w = world(r, fixture().block),
      tickJob = w.prepareTick(),
      translation = w.prepareTranslation({ cells: [[0, 0, 0]], path: [[1, 0, 0]] });
    w.hold(hold());
    expect(() => w.commitTick(tickJob)).toThrow(/stale/);
    expect(() => w.commitTranslation(translation)).toThrow(/stale/);
    tickJob.cancel();
    translation.cancel();
    const heldTick = w.prepareTick();
    w.releaseHold('lift');
    expect(() => w.commitTick(heldTick)).toThrow(/stale/);
    heldTick.cancel();
  });
  test('hold additions reads snapshots reports and releases are isolated', () => {
    const w = world(r, fixture().block),
      req = hold(3),
      receipt = w.hold(req);
    (req.cells as unknown as number[][])[0][0] = 1;
    receipt.holds[0].cells.length = 0;
    const observed = w.holds();
    observed[0].expiresAtTick = 99;
    observed[0].cells.length = 0;
    const result = tick(w);
    result.report.holds!.after[0].cells.length = 0;
    result.report.holds!.before[0].expiresAtTick = 99;
    expect(w.holds()).toEqual([{ id: 'lift', expiresAtTick: 3, cells: [0] }]);
    expect(read(r, w.snapshot())).toEqual(w.snapshot());
  });
  test('holds and members are canonically ordered in explicit v2 snapshots', () => {
    const s = fixture([place(0), place(1), place(0, 1)]),
      out = constrained(r, s.block, 0, [
        { id: 'z', expiresAtTick: 2, cells: [2] },
        { id: 'a', expiresAtTick: 3, cells: [1, 0] },
      ]);
    expect(out.holds).toEqual([
      { id: 'a', expiresAtTick: 3, cells: [0, 1] },
      { id: 'z', expiresAtTick: 2, cells: [2] },
    ]);
    expect(read(r, out)).toEqual(out);
  });
  test('empty v2 worlds preserve v1 material state reports and exact physics', () => {
    const s = fixture([place(0), place(1, 0, 0, MAT.WATER, 40)]),
      a = finish(job(r, s)),
      b = finish(job(r, constrained(r, s.block)));
    expect(b.state.block).toEqual(a.state.block);
    expect(b.report.evolution).toEqual(a.report.evolution);
    expect(b.report.structure).toEqual(a.report.structure);
    expect(b.report.moves).toEqual(a.report.moves);
    expect(b.report.energy).toEqual(a.report.energy);
    expect(b.report.holds).toEqual({
      rulesVersion: 'reactive-holds-1',
      before: [],
      after: [],
      expired: [],
      retired: [],
      movementCells: [],
      structureCells: [],
    });
  });
  test('odd-tick JSON restarts preserve remaining lifetime and future complete states', () => {
    const s = fixture([place(0, 0, 0, MAT.STONE, 70)]),
      a = world(r, s.block),
      b = world(r, s.block);
    a.hold(hold(3));
    b.restore(a.snapshot());
    for (let i = 0; i < 6; i++) {
      if (i === 1 || i === 3) b.restore(JSON.parse(JSON.stringify(a.snapshot())));
      const first = tick(a, 1),
        second = tick(b, 31);
      expect(second.report).toEqual(first.report);
      expect(b.snapshot()).toEqual(a.snapshot());
    }
    expect(a.holds()).toEqual([]);
    expect(a.energyBalance().driftQ).toBe(0n);
    expect(b.energyBalance().driftQ).toBe(0n);
  });
  test('save restore retains expiry rather than granting a fresh lifetime', () => {
    const a = suspended(),
      s = a.snapshot();
    tick(a);
    const saved = a.snapshot(),
      b = world(r, s.block);
    b.restore(saved);
    expect(b.holds()[0].expiresAtTick).toBe(2);
    expect(b.tick).toBe(1);
    tick(b);
    expect(b.holds()).toEqual([]);
    expect(b.tick).toBe(2);
  });
  test('cancellation at each incomplete boundary publishes neither expired holds nor anchor overlays', () => {
    const w = world(r, fixture([place(0)], { width: 1, height: 1, depth: 1 }).block);
    w.hold(hold(1));
    const before = w.snapshot(),
      balance = w.energyBalance();
    const full = w.prepareTick();
    let calls = 0;
    while (full.progress().status === 'running') {
      full.advance(1);
      calls++;
    }
    for (let stop = 0; stop < calls; stop++) {
      const j = w.prepareTick();
      for (let i = 0; i < stop; i++) j.advance(1);
      expect(j.cancel()).toBe(true);
      expect(() => w.commitTick(j)).toThrow();
      expect(w.snapshot()).toEqual(before);
      expect(w.energyBalance()).toEqual(balance);
      expect(w.revision).toBe(1);
    }
  });
  test('custom cohesion drives hold eligibility and fixed noncohesive solids reject', () => {
    const s = fixture([place(0, 0, 0, 200)], undefined, custom),
      w = world(custom, s.block);
    w.hold(hold());
    expect(w.holds()).toHaveLength(1);
    const invalid = world(custom, fixture([place(0, 0, 0, 201)], undefined, custom).block);
    expect(() => invalid.hold(hold())).toThrow(/cohesive/);
    expect(invalid.revision).toBe(0);
  });
  test('air liquids gases and powder cannot receive structural positional holds', () => {
    for (const material of [MAT.AIR, MAT.WATER, MAT.SAND, MAT.SMOKE, MAT.LAVA]) {
      const w = world(r, fixture([place(0, 0, 0, material)]).block);
      expect(() => w.hold(hold())).toThrow(/cohesive/);
      expect(w.revision).toBe(0);
    }
  });
  test('invalid identity expiry duplicate membership and overlaps reject atomically', () => {
    const w = suspended(),
      before = w.snapshot();
    for (const req of [
      hold(2, ''),
      hold(2, 'bad id'),
      hold(0, 'other'),
      hold(1025, 'other'),
      hold(1.5, 'other'),
      hold(2, 'lift'),
      hold(2, 'other'),
      hold(2, 'other', []),
      hold(2, 'other', [
        [0, 0, 0],
        [0, 0, 0],
      ]),
      hold(2, 'other', [[99, 0, 0]]),
    ]) {
      expect(() => w.hold(req)).toThrow();
      expect(w.snapshot()).toEqual(before);
      expect(w.revision).toBe(1);
    }
  });
  test('unknown release and invalid request data do not invalidate a valid prepared tick', () => {
    const w = suspended(),
      j = w.prepareTick(),
      before = w.snapshot();
    expect(() => w.releaseHold('missing')).toThrow();
    for (const bad of [
      null,
      { ...hold(), extra: true },
      { ...hold(), cells: new Array(1) },
      { ...hold(), cells: [new Int32Array([0, 0, 0])] },
    ])
      expect(() => w.hold(bad as ReactiveHoldRequest3D)).toThrow();
    expect(w.snapshot()).toEqual(before);
    finish(j);
    w.commitTick(j);
  });
  test('hold and snapshot accessors reject without invoking user getters', () => {
    const w = world(r, fixture().block),
      getter = vi.fn(() => 2),
      req = hold();
    Object.defineProperty(req, 'expiresAtTick', { get: getter, enumerable: true });
    expect(() => w.hold(req)).toThrow();
    const saved = constrained(r, fixture().block, 0, [{ id: 'a', expiresAtTick: 2, cells: [0] }]);
    Object.defineProperty(saved.holds[0], 'cells', { get: getter, enumerable: true });
    expect(() => w.restore(saved)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(w.revision).toBe(0);
  });
  test('swallowed reentry poisons a hold operation and preserves a previous candidate', () => {
    const w = world(r, fixture().block),
      before = w.snapshot(),
      j = w.prepareTick();
    let attempted = false;
    const req = new Proxy(hold(), {
      ownKeys(target) {
        if (!attempted) {
          attempted = true;
          try {
            w.edit([]);
          } catch {}
        }
        return Reflect.ownKeys(target);
      },
    });
    expect(() => w.hold(req)).toThrow(/reentry/);
    expect(w.snapshot()).toEqual(before);
    expect(w.revision).toBe(0);
    finish(j);
    w.commitTick(j);
  });
  test('malformed constrained saves reject without replacing any committed domain', () => {
    const w = suspended(),
      before = w.snapshot(),
      balance = w.energyBalance();
    for (const bad of [
      { ...before, holdRulesVersion: 'wrong' },
      { ...before, holds: undefined },
      { ...before, holds: [{ id: 'a', expiresAtTick: 0, cells: [0] }] },
      { ...before, holds: [{ id: 'a', expiresAtTick: 2, cells: [5] }] },
      { ...before, holds: new Array(1) },
      { ...before, schemaVersion: 1 },
      { ...before, rulesVersion: 'reactive-world-1' },
    ]) {
      expect(() => w.restore(bad)).toThrow();
      expect(w.snapshot()).toEqual(before);
      expect(w.energyBalance()).toEqual(balance);
      expect(w.revision).toBe(1);
    }
  });
  test('maximum hold count and lifetime are accepted while one beyond each bound rejects', () => {
    expect(Object.isFrozen(REACTIVE_HOLD_LIMITS_3D)).toBe(true);
    const b = block(r, { width: 5, height: 5, depth: 5 }, MAT.STONE);
    const holds: ReactiveHold3D[] = Array.from({ length: 64 }, (_, i) => ({
      id: 'h' + i,
      expiresAtTick: 1024,
      cells: [i],
    }));
    expect(constrained(r, b, 0, holds).holds).toHaveLength(64);
    expect(() =>
      constrained(r, b, 0, [...holds, { id: 'extra', expiresAtTick: 1, cells: [64] }]),
    ).toThrow();
    expect(() => constrained(r, b, 0, [{ id: 'a', expiresAtTick: 1025, cells: [0] }])).toThrow();
  });
  test('expiry at the largest exact tick cannot overflow and the following tick rejects', () => {
    const s = fixture(undefined, undefined, r, Number.MAX_SAFE_INTEGER - 1),
      w = world(r, s.block, s.tick);
    w.hold(hold(Number.MAX_SAFE_INTEGER));
    tick(w);
    expect(w.tick).toBe(Number.MAX_SAFE_INTEGER);
    expect(w.holds()).toEqual([]);
    const before = w.snapshot();
    expect(() => w.prepareTick()).toThrow(/overflow/);
    expect(w.snapshot()).toEqual(before);
  });
});
