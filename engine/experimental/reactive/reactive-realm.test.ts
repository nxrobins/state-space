/** A patched realm is outside the bit-identity contract. Under an Array.prototype index accessor or an
 * Object.prototype hook a tick still publishes the true state or fails. Replaced array methods,
 * iterators or species carry no such guarantee, but the windows tested here (the structure output,
 * copies handed out before a commit, hold anchors at publish) stay as safe as before batching.
 */
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
import {
  createReactiveMaterialRegistry3D,
  createReactiveMaterialBlock3D,
  editReactiveMaterialBlock3D,
  readReactiveMaterialBlock3D,
  createReactiveWorldSnapshot3D,
  createReactiveWorldTickJob3D,
  createReactiveWorld3D,
  MAT,
  ANCHOR_3D,
  ENERGY_SCALE,
  type ReactiveMaterialRegistry3D,
  type ReactiveMaterialBlock3D,
  type ReactiveMaterialEdit3D,
  type ReactiveWorldTickJob3D,
} from '../reactive-materials.js';
import { reactivePlainObjectPrototype3D } from './reactive-registry.js';
import { startReactiveStructureJob3D } from './reactive-structure.js';
import { startStepBaselineStructureJob3D } from './reactive-structure.per-step-oracle.js';

holdPhysics('volumeStep', 'solveStructure3D', ...STRUCTURAL_CALLS);
let r: ReactiveMaterialRegistry3D;
beforeAll(async () => {
  r = await createReactiveMaterialRegistry3D();
});
/** Falling powder and fragments, liquids, gases, phase changes and burning wood on an anchored floor. */
function mixed(n = 8): ReactiveMaterialBlock3D {
  const edits: ReactiveMaterialEdit3D[] = [],
    pulses: [number, number, number][] = [];
  const place = (x: number, y: number, z: number, material: number, thermal = 20) =>
    edits.push({ kind: 'place', x, y, z, material, thermal });
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      place(x, n - 1, z, MAT.STONE);
      edits.push({ kind: 'anchor', x, y: n - 1, z, anchored: true });
    }
  for (let x = 1; x < n - 1; x++) place(x, 1, 1, MAT.SAND);
  for (let x = 1; x < n - 1; x++) place(x, 1, 2, MAT.WATER, 25);
  for (let z = 3; z < n - 1; z++) place(1, n - 3, z, MAT.LAVA, 200);
  for (let z = 3; z < n - 1; z++) place(2, n - 3, z, MAT.ICE, 5);
  for (let x = 3; x < n - 2; x++) place(x, 2, n - 2, MAT.STEAM, 110);
  for (let x = 2; x < n - 2; x += 2) {
    place(x, n - 2, 3, MAT.WOOD);
    pulses.push([x, n - 2, 3]);
  }
  place(3, 3, 3, MAT.STONE);
  place(4, 3, 3, MAT.STONE);
  edits.push({ kind: 'bond', x: 3, y: 3, z: 3, direction: 1, bonded: true });
  for (let x = 2; x < n - 2; x++) place(x, 1, n - 3, MAT.OIL);
  place(n - 2, 2, 2, MAT.SMOKE, 60);
  let b = editReactiveMaterialBlock3D(
    r,
    createReactiveMaterialBlock3D(r, { width: n, height: n, depth: n }),
    edits,
  ).block;
  b = editReactiveMaterialBlock3D(
    r,
    b,
    pulses.map(([x, y, z]) => ({
      kind: 'energy' as const,
      x,
      y,
      z,
      energyQ: b.energyQ[x + n * (y + n * z)] + 235 * ENERGY_SCALE,
    })),
  ).block;
  return b;
}
const finish = (j: ReactiveWorldTickJob3D, during: () => () => void) => {
  const restore = during();
  try {
    while (j.progress().status === 'running') j.advance(64);
  } finally {
    restore();
  }
};
/** An Array.prototype index accessor that reads 0 and swallows writes, as a patched realm could. */
const indexAccessor = (key: string) => () => {
  Object.defineProperty(Array.prototype, key, {
    get: () => 0,
    set: () => undefined,
    configurable: true,
  });
  return () => void delete (Array.prototype as unknown as Record<string, unknown>)[key];
};

describe('reactive ticks in a patched realm', () => {
  test('an Array.prototype index accessor never steers a tick to a different state', () => {
    let ticks = 0;
    for (const key of ['0', '1', '2', '5', '17']) {
      let snapshot = createReactiveWorldSnapshot3D(r, mixed(6));
      for (let t = 0; t < 3; t++) {
        const clean = createReactiveWorldTickJob3D(r, snapshot),
          patched = createReactiveWorldTickJob3D(r, snapshot);
        finish(clean, () => () => undefined);
        let outcome: string;
        try {
          finish(patched, indexAccessor(key));
          outcome = 'complete';
        } catch (error) {
          outcome = (error as Error).message;
        }
        // Failing closed is allowed; publishing anything but the true state is not.
        if (outcome === 'complete') {
          expect({ key, t, state: patched.result().state }).toEqual({
            key,
            t,
            state: clean.result().state,
          });
          ticks++;
        }
        snapshot = clean.result().state;
      }
    }
    expect(ticks).toBe(15);
  });
  test('commits copy the whole result as before while Object.prototype carries hooks', () => {
    const observe = (
      descriptor: PropertyDescriptor,
      key: string,
      plantDescriptorFields = false,
    ) => {
      const w = createReactiveWorld3D(r, mixed(6)),
        j = w.prepareTick();
      finish(j, () => () => undefined);
      const setter = vi.fn(),
        planted = plantDescriptorFields ? ['value', 'writable'] : [];
      Object.defineProperty(Object.prototype, key, {
        configurable: true,
        ...descriptor,
        ...('set' in descriptor ? { set: setter } : {}),
      });
      // Inherited descriptor fields: an accessor descriptor then reads as a writable data one.
      for (const field of planted)
        Object.defineProperty(Object.prototype, field, {
          value: true,
          writable: true,
          configurable: true,
        });
      try {
        w.commitTick(j);
        return { committed: w.tick, calls: setter.mock.calls.length };
      } catch (error) {
        return { error: (error as Error).message, tick: w.tick, calls: setter.mock.calls.length };
      } finally {
        for (const field of [key, ...planted])
          delete (Object.prototype as Record<string, unknown>)[field];
      }
    };
    // A copy assigns every field, so a setter named 'tick' swallows it and the commit fails closed.
    const swallowed = {
      error: 'Reactive tick commit identity or accounting mismatch.',
      tick: 0,
      calls: 1,
    };
    expect(observe({ set: () => undefined }, 'tick')).toEqual(swallowed);
    expect(observe({ set: () => undefined }, 'tick', true)).toEqual(swallowed);
    expect(observe({ value: 7, writable: false }, 'width')).toEqual({
      error: "Cannot assign to read only property 'width' of object '#<Object>'",
      tick: 0,
      calls: 0,
    });
    expect(observe({ value: 7, writable: true }, 'width')).toEqual({ committed: 1, calls: 0 });
  });
  test('a replaced slice, constructor or species during the structure stage leaves the true state', () => {
    const slice = Array.prototype.slice,
      constructor = Reflect.getOwnPropertyDescriptor(Array.prototype, 'constructor')!,
      species = Reflect.getOwnPropertyDescriptor(Array, Symbol.species)!;
    /** An array whose stores vanish, as a hostile species could return. */
    class Swallow extends Array {
      constructor(...items: unknown[]) {
        super(...(items as number[]));
        return new Proxy(this, { set: () => true });
      }
    }
    const replaceSlice = (next: (this: unknown[], ...rest: unknown[]) => unknown) => () => {
      Array.prototype.slice = next as typeof slice;
      return () => void (Array.prototype.slice = slice);
    };
    const patches: Record<string, () => () => void> = {
      identity: replaceSlice(function (...rest) {
        return rest.length ? slice.apply(this, rest as []) : this;
      }),
      swallow: replaceSlice(function (...rest) {
        return new Proxy(slice.apply(this, rest as []), { set: () => true });
      }),
      species: () => {
        Object.defineProperty(Array, Symbol.species, { configurable: true, get: () => Swallow });
        return () => void Object.defineProperty(Array, Symbol.species, species);
      },
      constructor: () => {
        Object.defineProperty(Array.prototype, 'constructor', { ...constructor, value: Swallow });
        return () => void Object.defineProperty(Array.prototype, 'constructor', constructor);
      },
    };
    const tick = (patch: () => () => void) => {
      const w = createReactiveWorld3D(r, mixed(6)),
        j = w.prepareTick();
      let patched = 0;
      while (j.progress().status === 'running') {
        const stage = j.progress().phase === 'structure-prepare',
          restore = stage ? patch() : () => undefined;
        try {
          j.advance(64);
        } finally {
          restore();
        }
        patched += stage ? 1 : 0;
      }
      w.commitTick(j);
      return { patched: patched > 0, snapshot: w.snapshot() };
    };
    const clean = tick(() => () => undefined).snapshot;
    for (const [name, patch] of Object.entries(patches))
      expect({ name, ...tick(patch) }).toEqual({ name, patched: true, snapshot: clean });
  });
  test('a copy handed out under a replaced slice never aliases the committed state', () => {
    const slice = Array.prototype.slice;
    const w = createReactiveWorld3D(r, mixed(6)),
      j = w.prepareTick();
    finish(j, () => () => undefined);
    // A slice that returns its receiver would hand out the job's own arrays.
    Array.prototype.slice = function (this: unknown[], ...rest: unknown[]) {
      return rest.length ? slice.apply(this, rest as []) : this;
    } as typeof slice;
    let handed;
    try {
      handed = j.result();
    } finally {
      Array.prototype.slice = slice;
    }
    w.commitTick(j);
    const committed = w.snapshot();
    handed.state.block.packedCells.fill(0);
    handed.state.block.energyQ.fill(0);
    expect(w.snapshot()).toEqual(committed);
  });
  test('a replaced array iterator during publish leaves no hold anchor behind', () => {
    const iterator = Object.getPrototypeOf([][Symbol.iterator]()) as { next: () => unknown },
      next = iterator.next;
    /** Skips one cell index in every array iteration, as a hostile iterator could. */
    const skip = (cell: number) => () => {
      iterator.next = function (this: unknown) {
        let step = next.call(this) as { done: boolean; value: unknown };
        while (!step.done && step.value === cell) step = next.call(this) as typeof step;
        return step;
      };
      return () => void (iterator.next = next);
    };
    const tick = (patch: (cell: number) => () => () => void) => {
      const w = createReactiveWorld3D(r, mixed(6)),
        b = w.snapshot().block,
        held: number[] = [];
      for (let i = 0; i < b.packedCells.length && held.length < 2; i++)
        if (b.structure[i] !== 0 && !(b.structure[i] & ANCHOR_3D)) held.push(i);
      const cells = held.map((i): [number, number, number] => [
        i % 6,
        Math.floor(i / 6) % 6,
        Math.floor(i / 36),
      ]);
      w.hold({ id: 'held', expiresAtTick: 9, cells });
      const before = w.snapshot(),
        j = w.prepareTick();
      let patched = false,
        outcome = 'committed';
      try {
        while (j.progress().status === 'running') {
          const stage = j.progress().phase === 'publish',
            restore = stage ? patch(held[1])() : () => undefined;
          patched ||= stage;
          try {
            j.advance(64);
          } finally {
            restore();
          }
        }
        w.commitTick(j);
      } catch (error) {
        outcome = (error as Error).message;
      }
      return { patched, outcome, before, after: w.snapshot() };
    };
    const clean = tick(() => () => () => undefined),
      patched = tick(skip);
    expect({ clean: clean.outcome, patched: patched.patched }).toEqual({
      clean: 'committed',
      patched: true,
    });
    // Failing closed is allowed; publishing anything but the true state is not.
    expect(patched.after).toEqual(patched.outcome === 'committed' ? clean.after : patched.before);
  });
  test('a commit copy that loses a state field fails the commit and keeps the world', () => {
    for (const key of ['depth', 'width', 'height']) {
      const w = createReactiveWorld3D(r, mixed(6)),
        j = w.prepareTick();
      finish(j, () => () => undefined);
      const before = w.snapshot();
      // A setter that swallows the store: the copied block would lack the field.
      Object.defineProperty(Object.prototype, key, { configurable: true, set: () => undefined });
      let outcome = 'committed';
      try {
        w.commitTick(j);
      } catch (error) {
        outcome = (error as Error).message;
      } finally {
        delete (Object.prototype as Record<string, unknown>)[key];
      }
      expect({ key, outcome, tick: w.tick, same: w.snapshot() }).toEqual({
        key,
        outcome: 'Reactive tick commit identity or accounting mismatch.',
        tick: 0,
        same: before,
      });
    }
  });
  test('the plain Object.prototype check sees a replaced __proto__ and ignores later wrappers', () => {
    const proto = Reflect.getOwnPropertyDescriptor(Object.prototype, '__proto__')!,
      ownKeys = Reflect.ownKeys;
    expect(reactivePlainObjectPrototype3D()).toBe(true);
    Object.defineProperty(Object.prototype, '__proto__', { ...proto, set: () => undefined });
    try {
      expect(reactivePlainObjectPrototype3D()).toBe(false);
    } finally {
      Object.defineProperty(Object.prototype, '__proto__', proto);
    }
    // A wrapper installed after load cannot hide a swallowing setter from the check.
    Reflect.ownKeys = ((target: object) =>
      ownKeys(target).filter((key) => key !== 'tick')) as typeof Reflect.ownKeys;
    Object.defineProperty(Object.prototype, 'tick', { configurable: true, set: () => undefined });
    try {
      expect(reactivePlainObjectPrototype3D()).toBe(false);
    } finally {
      delete (Object.prototype as Record<string, unknown>).tick;
      Reflect.ownKeys = ownKeys;
    }
    expect(reactivePlainObjectPrototype3D()).toBe(true);
  });
  test('an append that fails inside a structure batch stops where the per-step job stops', () => {
    // Hot wood breaks on the floor and a loose stone bar falls, so every report array fills. No cell
    // rests on a bond or on another fragment: the per-step job then appends to no scratch list.
    const edits: ReactiveMaterialEdit3D[] = [];
    for (let x = 0; x < 4; x++)
      edits.push(
        { kind: 'place', x, y: 2, z: 0, material: MAT.WOOD, thermal: 184 },
        { kind: 'place', x, y: 0, z: 1, material: MAT.STONE, thermal: 20 },
      );
    for (let x = 0; x < 3; x++)
      edits.push({ kind: 'bond', x, y: 0, z: 1, direction: 1, bonded: true });
    const input = readReactiveMaterialBlock3D(
      r,
      editReactiveMaterialBlock3D(
        r,
        createReactiveMaterialBlock3D(r, { width: 4, height: 3, depth: 2 }),
        edits,
      ).block,
    );
    /** Array.prototype[key] stores like an own element, except that its nth append throws. A store
     * into a presized array is not counted: the batched job copies its output block instead. */
    const run = (
      start: typeof startReactiveStructureJob3D,
      key: string,
      nth: number,
      budget: number,
    ) => {
      const { job } = start(r, input);
      let appends = 0,
        error = 'none';
      Object.defineProperty(Array.prototype, key, {
        get: () => undefined,
        set(this: unknown[], value: unknown) {
          if (this.length === Number(key) && ++appends === nth) throw Error('Append failed.');
          Object.defineProperty(this, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
          });
        },
        configurable: true,
      });
      try {
        while (job.progress().status === 'running') job.advance(budget);
      } catch (e) {
        error = (e as Error).message;
      } finally {
        delete (Array.prototype as unknown as Record<string, unknown>)[key];
      }
      const p = job.progress();
      return { error, appends, progress: [p.status, p.stage, p.completedWork, p.lastAdvanceWork] };
    };
    const stages = new Set<unknown>();
    for (const key of ['0', '1', '3']) {
      const total = run(startStepBaselineStructureJob3D, key, 0, 64).appends;
      expect(total).toBeGreaterThan(4);
      for (let nth = 1; nth <= total; nth++)
        for (const budget of [1, 7, 64, 256]) {
          const expected = run(startStepBaselineStructureJob3D, key, nth, budget);
          expect({
            key,
            nth,
            budget,
            ...run(startReactiveStructureJob3D, key, nth, budget),
          }).toEqual({
            key,
            nth,
            budget,
            ...expected,
          });
          stages.add(expected.progress[1]);
        }
    }
    // The failing append sits in the damage, moving, publish and report loops in turn.
    expect([...stages]).toEqual(expect.arrayContaining(['damage', 'moving', 'publish', 'report']));
  });
});
