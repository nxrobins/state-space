import { beforeAll, expect, test } from 'vitest';
import { createMultiphysicsProfiles3D, type MultiphysicsProfiles3D } from './profiles.js';
import { seedThermalParcel3D } from './thermal.js';
import { createMultiphysicsSnapshot3D, multiphysicsInventory3D } from './model.js';
import { createMultiphysicsWorld3D } from './world.js';
let profiles: MultiphysicsProfiles3D;
beforeAll(async () => {
  profiles = await createMultiphysicsProfiles3D();
});
const make = () =>
  createMultiphysicsWorld3D(
    profiles,
    createMultiphysicsSnapshot3D(profiles, {
      parcels: [
        seedThermalParcel3D(profiles, {
          id: 'a',
          material: 'copper',
          owner: 'start',
          center: [0, 3, 0],
        }),
      ],
    }),
  );
test('preview remains private, supports bounded work, and commits exactly once at its revision', () => {
  const world = make(),
    original = world.snapshot(),
    preview = world.prepare([], 2);
  while (preview.progress().status === 'running') {
    expect(preview.advance(7).lastAdvanceWork).toBeLessThanOrEqual(7);
    expect(world.snapshot()).toEqual(original);
  }
  const expected = preview.result();
  expect(expected.snapshot.tick).toBe(2);
  const result = world.commit(preview);
  expect(result.revision).toBe(1);
  expect(world.snapshot()).toEqual(expected.snapshot);
  expect(() => world.commit(preview)).toThrow(/stale/);
  const outsider = make().prepare([], 0);
  outsider.advance();
  expect(() => world.commit(outsider)).toThrow(/another world/);
});
test('atomic edits account for added and removed matter, internal heat, and mechanical potential', () => {
  const world = make(),
    initial = multiphysicsInventory3D(world.snapshot());
  const change = world.edit([
    { kind: 'place', parcel: { id: 'b', material: 'wood', owner: 'new', center: [1, 3, 0] } },
    { kind: 'heat', id: 'a', energyQ: 256 },
  ]);
  expect(change.result.edits.mass).toBeGreaterThan(0);
  expect(BigInt(change.result.edits.storedSubQ)).toBeGreaterThan(0n);
  expect(world.snapshot().accounting.externalMass).toBe(change.result.edits.mass);
  const moved = world.edit([
    {
      kind: 'transform',
      ids: ['a'],
      translation: [0, 1, 0],
      rotation: [0, 0, 0, 1],
      pivot: [0, 0, 0],
    },
  ]);
  expect(moved.result.edits.mechanicalEnergy).toBeCloseTo(initial.mass * 9.8, 12);
  const removed = world.edit([{ kind: 'remove', ids: ['b'] }]);
  expect(removed.result.edits.mass).toBeLessThan(0);
  expect(multiphysicsInventory3D(world.snapshot()).mass).toBe(initial.mass);
});
test('a center impulse edits only translation and accounts for the work and moment of the push', () => {
  const world = make(),
    before = world.snapshot(),
    unit = before.parcels[0],
    m = unit.mass;
  const kick = { kind: 'impulse' as const, id: unit.id, impulse: [3 * m, 0, 0] as const };
  const preview = world.prepare([kick], 0);
  preview.advance();
  expect(world.snapshot()).toEqual(before);
  const { result } = world.commit(preview);
  expect(result.snapshot.parcels[0]).toEqual({ ...unit, velocity: [3, 0, 0] });
  expect(result.edits.linearMomentum).toEqual([3 * m, 0, 0]);
  expect(result.edits.angularMomentum[2]).toBeCloseTo(-9 * m, 10);
  expect(result.edits.mechanicalEnergy).toBeCloseTo(4.5 * m, 10);
  expect(result.edits.mass).toBe(0);
  expect(result.edits.storedSubQ).toBe('0');
  const second = world.edit([kick]).result;
  expect(second.snapshot.parcels[0].velocity).toEqual([6, 0, 0]);
  expect(second.edits.mechanicalEnergy).toBeCloseTo(13.5 * m, 10);
  expect(second.snapshot.accounting.externalMechanicalEnergy).toBeCloseTo(18 * m, 10);
});

test('invalid impulse batches are atomic and legacy worlds retain their original rejection', () => {
  const world = make(),
    kick = { kind: 'impulse' as const, id: 'a', impulse: [1, 0, 0] as const };
  const b = seedThermalParcel3D(profiles, {
    id: 'b',
    material: 'copper',
    owner: 'other',
    center: [1, 3, 0],
  });
  const water = seedThermalParcel3D(profiles, {
    id: 'liquid',
    material: 'water',
    owner: 'other',
    center: [4, 3, 0],
  });
  for (const command of [
    { ...kick, id: 'missing' },
    { ...kick, id: 'liquid' },
    { ...kick, impulse: [1, 0] as unknown as typeof kick.impulse },
    { ...kick, impulse: { 0: 1, 1: 0, 2: 0, length: 3 } as unknown as typeof kick.impulse },
    { ...kick, impulse: [Number.MAX_VALUE, 0, 0] as const },
    { ...kick, extra: true },
  ]) {
    const testWorld = createMultiphysicsWorld3D(
      profiles,
      createMultiphysicsSnapshot3D(profiles, { parcels: [...world.snapshot().parcels, water] }),
    );
    const initial = testWorld.snapshot();
    expect(() => testWorld.prepare([kick, command], 0)).toThrow();
    expect(testWorld.snapshot()).toEqual(initial);
    expect(testWorld.revision()).toBe(0);
  }
  for (const fixed of [
    { anchors: ['a'] },
    { bonds: [{ a: 'a', b: 'b', strength: 500, restLength: 1 }] },
  ]) {
    const s = createMultiphysicsSnapshot3D(profiles, {
      parcels: [...world.snapshot().parcels, b],
      ...fixed,
    });
    const fixedWorld = createMultiphysicsWorld3D(profiles, s);
    expect(() => fixedWorld.edit([kick])).toThrow(/free solid/);
    expect(fixedWorld.snapshot()).toEqual(s);
  }
  const legacy = createMultiphysicsWorld3D(profiles, {
    ...world.snapshot(),
    rules: 'multiphysics-world-1',
  });
  expect(() => legacy.prepare([kick], 1)).toThrow('Unknown multiphysics edit.');
  expect(legacy.revision()).toBe(0);
});

test('invalid later command rolls back an entire edit batch; getters never execute', () => {
  const world = make(),
    before = world.snapshot();
  expect(() =>
    world.edit([
      { kind: 'heat', id: 'a', energyQ: 5 },
      { kind: 'remove', ids: ['missing'] },
    ]),
  ).toThrow();
  expect(world.snapshot()).toEqual(before);
  expect(world.revision()).toBe(0);
  let reads = 0;
  expect(() =>
    world.edit([
      {
        kind: 'heat',
        id: 'a',
        get energyQ() {
          reads++;
          return 10;
        },
      },
    ]),
  ).toThrow();
  expect(reads).toBe(0);
  expect(world.snapshot()).toEqual(before);
});
test('edits and restore invalidate old previews while JSON continuation stays exact', () => {
  const world = make(),
    stale = world.prepare([], 1);
  while (stale.progress().status === 'running') stale.advance();
  world.edit([{ kind: 'heat', id: 'a', energyQ: 1 }]);
  expect(() => world.commit(stale)).toThrow(/stale/);
  const saved = world.snapshot(),
    first = world.prepare([], 2);
  while (first.progress().status === 'running') first.advance(1);
  world.restore(JSON.parse(JSON.stringify(saved)));
  expect(() => world.commit(first)).toThrow(/stale/);
  const second = world.prepare([], 2);
  while (second.progress().status === 'running') second.advance(256);
  expect(second.result()).toEqual(first.result());
});
test('removing a battery terminal retains core energy and starts bounded failed discharge', () => {
  const parcels = ['positive', 'core', 'negative'].map((id, i) =>
    seedThermalParcel3D(profiles, {
      id,
      material: id === 'core' ? 'ceramic' : 'copper',
      owner: 'source',
      center: [i, 0, 0],
    }),
  );
  const world = createMultiphysicsWorld3D(
    profiles,
    createMultiphysicsSnapshot3D(profiles, {
      parcels,
      settings: { gravity: [0, 0, 0] },
      bonds: [
        { a: 'positive', b: 'core', strength: 1000, restLength: 1 },
        { a: 'core', b: 'negative', strength: 1000, restLength: 1 },
      ],
      battery: {
        id: 'battery',
        positive: 'positive',
        negative: 'negative',
        cores: [{ id: 'core', energyQ: 100, energyFractionQ: 0 }],
        emf: 12,
        internalResistance: 1,
        failureRateQPerSecond: 3,
        failureTemperature: 180,
        failed: false,
        drawRemainderUnits: 0,
      },
    }),
  );
  world.edit([{ kind: 'remove', ids: ['positive'] }]);
  expect(world.snapshot().battery?.cores[0].energyQ).toBe(100);
  expect(world.snapshot().battery?.failed).toBe(true);
  const preview = world.prepare([], 1);
  while (preview.progress().status === 'running') preview.advance();
  const committed = world.commit(preview).result;
  expect(committed.ticks[0].battery?.sourceCurrent).toBe(0);
  expect(Number(committed.ticks[0].battery?.drawnUnits)).toBeGreaterThan(0);
  expect(committed.snapshot.battery?.cores[0].energyQ).toBeLessThan(100);
});
test('cancelled and failed work cannot change the owned world', () => {
  const world = make(),
    original = world.snapshot(),
    cancelled = world.prepare([{ kind: 'heat', id: 'a', energyQ: 1 }], 2);
  cancelled.advance(1);
  cancelled.cancel();
  expect(() => world.commit(cancelled)).toThrow(/ready/);
  expect(world.snapshot()).toEqual(original);
  expect(() => world.restore({ ...original, rules: 'old' })).toThrow();
  expect(world.snapshot()).toEqual(original);
});
