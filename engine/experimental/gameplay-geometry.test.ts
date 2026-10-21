import { holdPhysics } from '../test-support/hold-physics.js';
import { describe, expect, test, vi } from 'vitest';
import { MAT } from './3d.js';
import { CpuStructuralWorld3D } from './structural-world-core.js';
import { createTacticalSession3D } from './tactical-session.js';
import { GEOMETRY_SCALE_3D as S, type GeometryBox3D } from './gameplay-geometry.js';

holdPhysics('step');
const vec = (x: number, y: number, z: number): [number, number, number] => [x * S, y * S, z * S];
const body = (min: [number, number, number], max: [number, number, number]): GeometryBox3D => ({
  minQ: vec(...min),
  maxQ: vec(...max),
});
function world() {
  return new CpuStructuralWorld3D({ width: 4, height: 4, depth: 4, chunkSize: 4 });
}
function session(
  terrain = world().snapshot(),
  reservoirs: { id: string; terrain: typeof terrain }[] = [],
) {
  return createTacticalSession3D({
    worldId: 'query-world',
    gameRulesVersion: 'query-game-1',
    terrain,
    reservoirs,
    game: { ap: 2 },
  });
}

describe('fixed-point gameplay geometry, no physical steps', () => {
  test('fit permits face contact but detects one quantum of overlap', () => {
    const w = world();
    w.setCell(2, 1, 1, MAT.STONE);
    const q = session(w.snapshot()).queries();
    const b = body([1, 1.25, 1.25], [2, 1.75, 1.75]);
    expect(q.fit({ box: b }).fits).toBe(true);
    const overlap = { ...b, maxQ: [2 * S + 1, 1.75 * S, 1.75 * S] as const };
    const result = q.fit({ box: overlap });
    expect(result.fits).toBe(false);
    expect(result.blocker?.coordinate).toEqual([2, 1, 1]);
    expect(result.outside).toBe(false);
  });

  test('closed boundaries reject outside bodies and permit touching the floor', () => {
    const q = session().queries();
    expect(q.fit({ box: body([0, 0, 0], [1, 1, 1]) })).toMatchObject({
      fits: true,
      outside: false,
    });
    expect(q.fit({ box: body([-0.25, 0, 0], [0.75, 1, 1]) })).toMatchObject({
      fits: false,
      outside: true,
      blocker: null,
    });
    expect(q.fit({ box: body([1, 3, 1], [2, 4, 2]) }).fits).toBe(true);
  });

  test.each([
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [2, 1],
    [2, -1],
  ])('sweep gives exact contact along axis %s sign %s', (axis, sign) => {
    const w = world(),
      obstacle: [number, number, number] = [1, 1, 1],
      delta: [number, number, number] = [0, 0, 0],
      normal = [0, 0, 0];
    obstacle[axis] = sign > 0 ? 2 : 0;
    delta[axis] = sign * S;
    normal[axis] = -sign;
    w.setCell(...obstacle, MAT.STONE);
    const result = session(w.snapshot())
      .queries()
      .sweep({ box: body([1.25, 1.25, 1.25], [1.75, 1.75, 1.75]), deltaQ: delta });
    expect(result.contact).toMatchObject({
      time: { numerator: 1, denominator: 4 },
      normal,
      boundary: false,
      startedOverlapping: false,
    });
    expect(result.contact?.cell?.coordinate).toEqual(obstacle);
  });

  test('sweeps cannot tunnel through a thin obstacle at a nonbinary contact fraction', () => {
    const w = world();
    w.setCell(2, 0, 0, MAT.STONE);
    const hit = session(w.snapshot())
      .queries()
      .sweep({ box: body([0.25, 0.25, 0.25], [0.75, 0.75, 0.75]), deltaQ: vec(3, 0, 0) }).contact;
    expect(hit?.time).toEqual({ numerator: 5, denominator: 12 });
    expect(hit?.cell?.coordinate).toEqual([2, 0, 0]);
  });

  test('diagonal grazing is clear while one quantum of positive overlap collides', () => {
    const w = world();
    w.setCell(1, 0, 0, MAT.STONE);
    const q = session(w.snapshot()).queries();
    const b = body([0.25, 0.75, 0.25], [0.75, 1.25, 0.75]);
    expect(q.sweep({ box: b, deltaQ: vec(2, 2, 0) }).contact).toBeNull();
    const wider = { ...b, maxQ: [0.75 * S + 1, 1.25 * S, 0.75 * S] as const };
    expect(q.sweep({ box: wider, deltaQ: vec(2, 2, 0) }).contact?.time).toEqual({
      numerator: 255,
      denominator: 2048,
    });
  });

  test('endpoint contact is reported but touching while moving away is clear', () => {
    const w = world();
    w.setCell(2, 1, 1, MAT.STONE);
    const q = session(w.snapshot()).queries();
    expect(
      q.sweep({ box: body([1, 1, 1], [1.5, 2, 2]), deltaQ: vec(0.5, 0, 0) }).contact?.time,
    ).toEqual({ numerator: 1, denominator: 1 });
    expect(
      q.sweep({ box: body([1, 1, 1], [2, 2, 2]), deltaQ: vec(-0.5, 0, 0) }).contact,
    ).toBeNull();
  });

  test('parallel and zero motion do not collide with a merely touching face', () => {
    const w = world();
    w.setCell(2, 1, 1, MAT.STONE);
    const q = session(w.snapshot()).queries(),
      b = body([1, 1, 1], [2, 2, 2]);
    expect(q.sweep({ box: b, deltaQ: vec(0, 0.5, 0) }).contact).toBeNull();
    expect(q.sweep({ box: b, deltaQ: [0, 0, 0] }).contact).toBeNull();
  });

  test('initial overlap is explicit rather than disguised as a normal sweep hit', () => {
    const w = world();
    w.setCell(1, 1, 1, MAT.STONE);
    const q = session(w.snapshot()).queries();
    const hit = q.sweep({
      box: body([1.25, 1.25, 1.25], [1.75, 1.75, 1.75]),
      deltaQ: vec(1, 0, 0),
    }).contact;
    expect(hit).toMatchObject({
      startedOverlapping: true,
      time: { numerator: 0, denominator: 1 },
      normal: [0, 0, 0],
      boundary: false,
    });
    expect(q.support({ box: body([1, 1, 1], [2, 2, 2]), maxDropQ: S })).toMatchObject({
      bodyFits: false,
      distanceQ: null,
      surfaces: [],
    });
  });

  test('world-wall contacts are exact and diagonal normal ties choose X first', () => {
    const q = session().queries();
    const hit = q.sweep({ box: body([1, 1, 1], [2, 2, 2]), deltaQ: vec(4, 4, 0) }).contact;
    expect(hit).toMatchObject({
      boundary: true,
      cell: null,
      time: { numerator: 1, denominator: 2 },
      normal: [-1, 0, 0],
    });
    expect(
      q.sweep({ box: body([0, 1, 1], [1, 2, 2]), deltaQ: vec(-1, 0, 0) }).contact?.time,
    ).toEqual({ numerator: 0, denominator: 1 });
  });

  test('equal-time cell contacts choose the lowest x-major index', () => {
    const w = world();
    w.setCell(2, 1, 1, MAT.STONE);
    w.setCell(2, 2, 1, MAT.STONE);
    const hit = session(w.snapshot())
      .queries()
      .sweep({ box: body([0, 1, 1], [1, 3, 2]), deltaQ: vec(2, 0, 0) }).contact;
    expect(hit?.cell?.index).toBe(22);
    expect(hit?.time).toEqual({ numerator: 1, denominator: 2 });
  });

  test('outside-camera rays clip into the world from either direction', () => {
    const w = world();
    w.setCell(0, 1, 1, MAT.STONE);
    w.setCell(3, 1, 1, MAT.STONE);
    const q = session(w.snapshot()).queries();
    const left = q.raycast({ fromQ: vec(-1, 1.5, 1.5), toQ: vec(2, 1.5, 1.5) }).contact;
    expect(left).toMatchObject({ time: { numerator: 1, denominator: 3 }, normal: [-1, 0, 0] });
    expect(left?.cell?.coordinate).toEqual([0, 1, 1]);
    const right = q.raycast({ fromQ: vec(5, 1.5, 1.5), toQ: vec(2, 1.5, 1.5) }).contact;
    expect(right).toMatchObject({ time: { numerator: 1, denominator: 3 }, normal: [1, 0, 0] });
    expect(right?.cell?.coordinate).toEqual([3, 1, 1]);
    expect(q.raycast({ fromQ: vec(-1, -1, -1), toQ: vec(-2, -2, -2) }).contact).toBeNull();
  });

  test.each([
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [2, 1],
    [2, -1],
  ])('ray traverses axis %s sign %s with exact entry time', (axis, sign) => {
    const w = world(),
      obstacle: [number, number, number] = [1, 1, 1],
      from = vec(1.5, 1.5, 1.5),
      to = vec(1.5, 1.5, 1.5),
      normal = [0, 0, 0];
    obstacle[axis] = sign > 0 ? 2 : 0;
    to[axis] += sign * 2 * S;
    normal[axis] = -sign;
    w.setCell(...obstacle, MAT.STONE);
    const hit = session(w.snapshot()).queries().raycast({ fromQ: from, toQ: to }).contact;
    expect(hit).toMatchObject({ time: { numerator: 1, denominator: 4 }, normal });
    expect(hit?.cell?.coordinate).toEqual(obstacle);
  });

  test('rays cross all tied axes together, skipping edge-only cells', () => {
    const w = world();
    w.setCell(1, 0, 0, MAT.STONE);
    let q = session(w.snapshot()).queries();
    const ray = { fromQ: vec(0.5, 0.5, 0.5), toQ: vec(3.5, 3.5, 0.5) };
    expect(q.raycast(ray).contact).toBeNull();
    w.setCell(1, 1, 0, MAT.STONE);
    q = session(w.snapshot()).queries();
    expect(q.raycast(ray).contact).toMatchObject({
      time: { numerator: 1, denominator: 6 },
      normal: [-1, 0, 0],
    });
    expect(q.raycast(ray).contact?.cell?.coordinate).toEqual([1, 1, 0]);
  });

  test('grid-plane ray starts select the travel side and canonical zero time', () => {
    const w = world();
    w.setCell(0, 1, 1, MAT.STONE);
    w.setCell(1, 1, 1, MAT.ICE);
    const q = session(w.snapshot()).queries();
    const left = q.raycast({ fromQ: vec(1, 1.5, 1.5), toQ: vec(0.5, 1.5, 1.5) }).contact;
    const right = q.raycast({ fromQ: vec(1, 1.5, 1.5), toQ: vec(1.5, 1.5, 1.5) }).contact;
    expect(left?.cell?.material).toBe(MAT.STONE);
    expect(right?.cell?.material).toBe(MAT.ICE);
    expect(left?.time).toEqual({ numerator: 0, denominator: 1 });
    expect(right?.time).toEqual({ numerator: 0, denominator: 1 });
    expect(left).toMatchObject({ normal: [1, 0, 0], startedOverlapping: false });
    expect(right).toMatchObject({ normal: [-1, 0, 0], startedOverlapping: false });
    const boundary = q.raycast({ fromQ: [-0, 1.5 * S, 1.5 * S], toQ: vec(0.5, 1.5, 1.5) }).contact;
    expect(Object.is(boundary?.time.numerator, -0)).toBe(false);
  });

  test('ray entry ties choose X before a simultaneous world boundary on Y', () => {
    const w = world();
    w.setCell(1, 0, 1, MAT.STONE);
    const q = session(w.snapshot()).queries();
    const start = q.raycast({ fromQ: vec(1, 0, 1.5), toQ: vec(2, 1, 1.5) }).contact;
    expect(start).toMatchObject({
      time: { numerator: 0, denominator: 1 },
      normal: [-1, 0, 0],
      startedOverlapping: false,
    });
    const clipped = q.raycast({ fromQ: vec(0.5, -0.5, 1.5), toQ: vec(1.5, 0.5, 1.5) }).contact;
    expect(clipped).toMatchObject({
      time: { numerator: 1, denominator: 2 },
      normal: [-1, 0, 0],
      startedOverlapping: false,
    });
    expect(clipped?.cell?.coordinate).toEqual([1, 0, 1]);
  });

  test('point rays, parallel outside rays and empty material filters terminate', () => {
    const w = world();
    w.setCell(1, 1, 1, MAT.SAND);
    const q = session(w.snapshot()).queries(),
      point = vec(1.5, 1.5, 1.5);
    expect(q.raycast({ fromQ: point, toQ: point }).contact?.cell?.material).toBe(MAT.SAND);
    expect(q.raycast({ fromQ: point, toQ: point, materials: [] }).contact).toBeNull();
    expect(q.raycast({ fromQ: vec(-1, 0, 0), toQ: vec(-1, 4, 0) }).contact).toBeNull();
  });

  test('explicit material filters target fluid without changing default body geometry', () => {
    const w = world();
    w.setCell(1, 1, 1, MAT.WATER);
    w.setCell(2, 1, 1, MAT.STONE);
    const q = session(w.snapshot()).queries();
    const ray = { fromQ: vec(0.5, 1.5, 1.5), toQ: vec(3.5, 1.5, 1.5) };
    expect(q.raycast(ray).contact?.cell?.material).toBe(MAT.STONE);
    expect(q.raycast({ ...ray, materials: [MAT.WATER] }).contact?.cell?.material).toBe(MAT.WATER);
    expect(q.fit({ box: body([1, 1, 1], [2, 2, 2]) }).fits).toBe(true);
    expect(q.fit({ box: body([1, 1, 1], [2, 2, 2]), materials: [MAT.WATER] }).fits).toBe(false);
  });

  test('support finds every co-nearest face and its exact footprint area', () => {
    const w = world();
    w.setCell(1, 2, 1, MAT.STONE);
    w.setCell(2, 2, 1, MAT.SAND);
    const q = session(w.snapshot()).queries();
    const b = body([1.5, 0.5, 1], [2.5, 1, 2]);
    const result = q.support({ box: b, maxDropQ: S });
    expect(result.bodyFits).toBe(true);
    expect(result.distanceQ).toBe(S);
    expect(result.surfaces.map((s) => [s.cell?.coordinate, s.areaQ2])).toEqual([
      [[1, 2, 1], (S * S) / 2],
      [[2, 2, 1], (S * S) / 2],
    ]);
    expect(q.support({ box: b, maxDropQ: S - 1 }).surfaces).toEqual([]);
  });

  test('support distinguishes nearest terrain from the closed floor boundary', () => {
    const q = session().queries(),
      b = body([1, 3, 1], [2, 4, 2]);
    expect(q.support({ box: b, maxDropQ: 0 })).toMatchObject({
      bodyFits: true,
      distanceQ: 0,
      surfaces: [{ cell: null, boundary: true, areaQ2: S * S }],
    });
    const w = world();
    w.setCell(1, 2, 1, MAT.STONE);
    w.setCell(2, 3, 1, MAT.STONE);
    const surface = session(w.snapshot())
      .queries()
      .support({ box: body([1, 0, 1], [3, 1, 2]), maxDropQ: 3 * S });
    expect(surface.distanceQ).toBe(S);
    expect(surface.surfaces).toHaveLength(1);
    expect(surface.surfaces[0].cell?.coordinate).toEqual([1, 2, 1]);
  });

  test('invalid query data rejects without reading accessors or accepting fractional units', () => {
    const q = session().queries(),
      b = body([0, 0, 0], [1, 1, 1]),
      getter = vi.fn(() => b);
    const bad = Object.defineProperty({}, 'box', { get: getter, enumerable: true });
    expect(() => q.fit(bad as never)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    for (const request of [
      null,
      { box: { minQ: [0, 0, 0], maxQ: [0, 1, 1] } },
      { box: { ...b, minQ: [0.1, 0, 0] } },
      { box: { ...b, minQ: [-524289, 0, 0] } },
      { box: b, materials: [255] },
      { box: b, materials: [MAT.STONE, MAT.STONE] },
      { box: b, materials: new Array(1) },
      { box: b, extra: true },
    ])
      expect(() => q.fit(request as never)).toThrow();
    expect(() => q.sweep({ box: b, deltaQ: [NaN, 0, 0] })).toThrow();
    expect(() => q.support({ box: b, maxDropQ: -1 })).toThrow();
  });

  test('array data is copied without calling inherited iterators or array methods', () => {
    const w = world();
    w.setCell(1, 1, 1, MAT.STONE);
    const q = session(w.snapshot()).queries();
    const callback = vi.fn(() => {
      throw Error('Caller array method invoked.');
    });
    const prototype = Object.create(Array.prototype, {
      some: { value: callback },
      map: { value: callback },
      [Symbol.iterator]: { value: callback },
    });
    const from = Object.setPrototypeOf(vec(0.5, 1.5, 1.5), prototype);
    const materials = Object.setPrototypeOf([MAT.STONE], prototype);
    expect(
      q.raycast({ fromQ: from, toQ: vec(3.5, 1.5, 1.5), materials }).contact?.cell?.coordinate,
    ).toEqual([1, 1, 1]);
    expect(callback).not.toHaveBeenCalled();
    const getter = vi.fn(() => MAT.STONE),
      accessors = [MAT.STONE];
    Object.defineProperty(accessors, '0', { get: getter, enumerable: true });
    expect(() =>
      q.raycast({ fromQ: vec(0, 0, 0), toQ: vec(1, 1, 1), materials: accessors }),
    ).toThrow(/dense data/);
    expect(getter).not.toHaveBeenCalled();
  });

  test('work budget rejects an oversized swept search explicitly', () => {
    const w = new CpuStructuralWorld3D({ width: 32, height: 32, depth: 64, chunkSize: 8 }),
      q = session(w.snapshot()).queries();
    const b = { minQ: [1, 1, 1] as const, maxQ: [32 * S - 1, 32 * S - 1, 64 * S - 1] as const };
    expect(q.fit({ box: b }).fits).toBe(true);
    expect(() => q.sweep({ box: b, deltaQ: [1, 0, 0] })).toThrow(/budget/);
  });
});

describe('geometry view identity and isolation', () => {
  test('old committed views remain isolated after a newer terrain commit', () => {
    const s = session(),
      q = s.queries(),
      b = body([1, 1, 1], [2, 2, 2]),
      before = s.snapshot();
    const branch = s.branch({ horizonTicks: 0 });
    branch.edit([{ kind: 'material', x: 1, y: 1, z: 1, material: MAT.STONE }]);
    expect(s.snapshot()).toEqual(before);
    const result = s.commit(branch);
    expect(q.stamp).toMatchObject({
      kind: 'committed',
      revision: { revision: 0 },
      tick: 0,
      domain: null,
    });
    expect(q.fit({ box: b }).fits).toBe(true);
    expect(s.queries().fit({ box: b }).fits).toBe(false);
    expect(s.queries().stamp).toMatchObject({ revision: { revision: result.snapshot.revision } });
  });

  test('preview views identify their branch and operation and match committed geometry', () => {
    const s = session(),
      a = s.branch({ horizonTicks: 0 }),
      b = s.branch({ horizonTicks: 0 }),
      before = a.queries();
    expect(before.stamp).toMatchObject({
      kind: 'preview',
      operation: 0,
      completedTicks: 0,
      horizonTicks: 0,
    });
    expect(before.stamp).not.toEqual(b.queries().stamp);
    a.edit([{ kind: 'material', x: 1, y: 1, z: 1, material: MAT.ICE }]);
    const after = a.queries(),
      request = { fromQ: vec(0.5, 1.5, 1.5), toQ: vec(3.5, 1.5, 1.5) };
    expect(after.stamp).toMatchObject({ operation: 1 });
    expect(before.raycast(request).contact).toBeNull();
    const expected = after.raycast(request).contact;
    s.commit(a);
    expect(s.queries().raycast(request).contact).toEqual(expected);
    expect(() => b.queries()).toThrow(/stale/);
    expect(after.raycast(request).contact).toEqual(expected);
  });

  test('reservoir queries share rules but retain their domain and independent terrain', () => {
    const stored = world();
    stored.setCell(1, 1, 1, MAT.STONE);
    const s = session(world().snapshot(), [{ id: 'flask', terrain: stored.snapshot() }]);
    const b = body([1, 1, 1], [2, 2, 2]);
    expect(s.queries().fit({ box: b }).fits).toBe(true);
    const q = s.queries({ domain: 'flask' });
    expect(q.stamp.domain).toBe('flask');
    expect(q.fit({ box: b }).fits).toBe(false);
    expect(() => s.queries({ domain: 'missing' })).toThrow(/Unknown/);
    expect(() => s.queries({ domain: 2 } as never)).toThrow();
    const inherited = vi.fn(() => 'flask'),
      options = Object.create(Object.defineProperty({}, 'domain', { get: inherited }));
    expect(s.queries(options).stamp.domain).toBeNull();
    expect(inherited).not.toHaveBeenCalled();
  });

  test('result and request mutations cannot change retained query geometry or session state', () => {
    const w = world();
    w.setCell(1, 1, 1, MAT.STONE);
    const s = session(w.snapshot()),
      before = s.snapshot(),
      q = s.queries();
    const request = { box: body([1, 1, 1], [2, 2, 2]) },
      first = q.fit(request);
    if (first.blocker) first.blocker.material = MAT.AIR;
    request.box = body([0, 0, 0], [1, 1, 1]);
    expect(q.fit({ box: body([1, 1, 1], [2, 2, 2]) }).blocker?.material).toBe(MAT.STONE);
    expect(Object.isFrozen(q.stamp)).toBe(true);
    expect(s.snapshot()).toEqual(before);
  });
});
