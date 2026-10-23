/** A patched realm is outside the bit-identity contract. Under an Array.prototype index accessor or an
 * Object.prototype hook a world tick still publishes the true state or fails. A tick that finds the
 * array, map, set or typed-array built-ins it calls replaced since the SDK loaded fails. Built-ins
 * replaced before the SDK loaded carry no guarantee; the tests below pin the windows where this
 * branch would otherwise do worse than the engine before batching. A slice replaced before load can
 * still steer the structure output.
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
import { overlayReactiveHolds3D, stripReactiveHoldAnchors3D } from './reactive-holds.js';
import { reactivePlainObjectPrototype3D } from './reactive-registry.js';
import { startReactiveStructureJob3D } from './reactive-structure.js';
import { startPerStepOracleStructureJob3D } from './reactive-structure.per-step-oracle.js';

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
        // Publishing anything but the true state is never allowed. Failing closed would be, but these
        // inputs are expected to complete: the count below keeps the test from passing vacuously.
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
  const REALM_ERROR = 'Reactive world ticks need the array built-ins the SDK loaded with.';
  type Patch = () => () => void;
  /** Built-in replacements a caller could make after the SDK loaded, each undone by its return. */
  const patches = () => {
    const RealArray = Array,
      slice = Array.prototype.slice,
      constructor = Reflect.getOwnPropertyDescriptor(Array.prototype, 'constructor')!,
      species = Reflect.getOwnPropertyDescriptor(Array, Symbol.species)!,
      iterator = Object.getPrototypeOf([][Symbol.iterator]()) as { next: () => unknown },
      next = iterator.next,
      mapGet = Map.prototype.get;
    /** An array whose stores vanish, as a caller's species could return. */
    class Swallow extends Array {
      constructor(...items: unknown[]) {
        super(...(items as number[]));
        return new Proxy(this, { set: () => true });
      }
    }
    const replaceSlice =
      (next: (this: unknown[], ...rest: unknown[]) => unknown): Patch =>
      () => {
        Array.prototype.slice = next as typeof slice;
        return () => void (Array.prototype.slice = slice);
      };
    const swallowSlice = replaceSlice(function (...rest) {
      return new Proxy(slice.apply(this, rest as []), { set: () => true });
    });
    const useSpecies: Patch = () => {
      Object.defineProperty(Array, Symbol.species, { configurable: true, get: () => Swallow });
      return () => void Object.defineProperty(Array, Symbol.species, species);
    };
    return {
      identitySlice: replaceSlice(function (...rest) {
        return rest.length ? slice.apply(this, rest as []) : this;
      }),
      swallowSlice,
      swapSlice: replaceSlice(function (...rest) {
        const out = slice.apply(this, rest as []);
        if (out.length > 1) [out[0], out[1]] = [out[1], out[0]];
        return out;
      }),
      species: useSpecies,
      constructor: (() => {
        Object.defineProperty(Array.prototype, 'constructor', { ...constructor, value: Swallow });
        return () => void Object.defineProperty(Array.prototype, 'constructor', constructor);
      }) as Patch,
      // A global Array rebound to a lookalike whose own prototype carries the original slice.
      reboundArray: (() => {
        const restore = swallowSlice();
        const Lookalike = function (...items: unknown[]) {
          return Reflect.construct(RealArray, items);
        };
        Lookalike.prototype = { slice, constructor: Lookalike };
        Object.defineProperty(Lookalike, Symbol.species, species);
        (globalThis as { Array: unknown }).Array = Lookalike;
        return () => {
          (globalThis as { Array: unknown }).Array = RealArray;
          restore();
        };
      }) as Patch,
      iterator: (() => {
        iterator.next = function (this: unknown) {
          const step = next.call(this) as { done: boolean };
          return step.done ? step : next.call(this);
        };
        return () => void (iterator.next = next);
      }) as Patch,
      typedSpecies: (() => {
        const typed = Object.getOwnPropertyDescriptor(Uint8Array, Symbol.species);
        class Kept extends Uint8Array {}
        Object.defineProperty(Uint8Array, Symbol.species, { configurable: true, get: () => Kept });
        return () =>
          void (typed
            ? Object.defineProperty(Uint8Array, Symbol.species, typed)
            : delete (Uint8Array as unknown as Record<symbol, unknown>)[Symbol.species]);
      }) as Patch,
      mapGet: (() => {
        Map.prototype.get = function (this: Map<unknown, unknown>, key: unknown) {
          return key;
        };
        return () => void (Map.prototype.get = mapGet);
      }) as Patch,
    };
  };
  /** Holds up to two cohesive cells that nothing anchors, as a caller would. */
  const holdCells = (w: ReturnType<typeof createReactiveWorld3D>) => {
    const b = w.snapshot().block,
      held: number[] = [];
    for (let i = 0; i < b.packedCells.length && held.length < 2; i++)
      if (b.structure[i] !== 0 && !(b.structure[i] & ANCHOR_3D)) held.push(i);
    const n = b.width;
    w.hold({
      id: 'held',
      expiresAtTick: 9,
      cells: held.map((i): [number, number, number] => [
        i % n,
        Math.floor(i / n) % b.height,
        Math.floor(i / (n * b.height)),
      ]),
    });
    return held;
  };
  test('array built-ins replaced after load fail the tick and keep the world', () => {
    const p = patches();
    type Phase = 'evolution' | 'structure-prepare' | 'publish';
    const plans: [string, boolean, Partial<Record<Phase, Patch>>][] = [
      ['identity slice at structure', false, { 'structure-prepare': p.identitySlice }],
      ['swallowing slice at structure', false, { 'structure-prepare': p.swallowSlice }],
      ['species at structure', false, { 'structure-prepare': p.species }],
      ['constructor at structure', false, { 'structure-prepare': p.constructor }],
      ['rebound Array at structure', false, { 'structure-prepare': p.reboundArray }],
      ['species during evolution', false, { evolution: p.species }],
      ['swapping slice during evolution', false, { evolution: p.swapSlice }],
      ['typed species during evolution', false, { evolution: p.typedSpecies }],
      ['Map get at structure', true, { 'structure-prepare': p.mapGet }],
      ['species at publish', true, { publish: p.species }],
      ['constructor at publish', true, { publish: p.constructor }],
      ['iterator at publish', true, { publish: p.iterator }],
    ];
    const world = (held: boolean) => {
      const w = createReactiveWorld3D(r, mixed(6));
      if (held) holdCells(w);
      return w;
    };
    for (const [name, held, plan] of plans) {
      const w = world(held),
        before = w.snapshot(),
        j = w.prepareTick();
      let hit = false,
        outcome = 'committed';
      try {
        while (j.progress().status === 'running') {
          const install = plan[j.progress().phase as Phase],
            restore = install ? install() : () => undefined;
          hit ||= Boolean(install);
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
      expect({ name, hit, outcome, kept: w.snapshot() }).toEqual({
        name,
        hit: true,
        outcome: REALM_ERROR,
        kept: before,
      });
      // The world ticks on as an untouched twin does.
      const twin = world(held);
      for (const target of [w, twin]) {
        const next = target.prepareTick();
        finish(next, () => () => undefined);
        target.commitTick(next);
      }
      expect({ name, after: w.snapshot() }).toEqual({ name, after: twin.snapshot() });
    }
  });
  test('a standalone structure job slices only with the realm slice it loaded with', () => {
    const p = patches(),
      input = readReactiveMaterialBlock3D(r, mixed(6)),
      original = structuredClone(input);
    const solve = (patch: Patch) => {
      const restore = patch();
      let started;
      try {
        started = startReactiveStructureJob3D(r, input);
      } finally {
        restore();
      }
      while (started.job.progress().status === 'running') started.job.advance(256);
      return started.job.result();
    };
    const clean = solve(() => () => undefined);
    for (const name of [
      'identitySlice',
      'swallowSlice',
      'species',
      'constructor',
      'reboundArray',
    ] as const)
      expect({ name, result: solve(p[name]) }).toEqual({ name, result: clean });
    expect(input).toEqual(original);
  });
  test('result() and motion() under replaced array built-ins fail and leave the job committable', () => {
    const p = patches(),
      twin = createReactiveWorld3D(r, mixed(6)),
      w = createReactiveWorld3D(r, mixed(6)),
      j = w.prepareTick({ motion: { maxEntries: 4096 } }),
      t = twin.prepareTick();
    finish(j, () => () => undefined);
    finish(t, () => () => undefined);
    for (const patch of [p.identitySlice, p.species, p.mapGet]) {
      const restore = patch();
      const outcomes: string[] = [];
      for (const read of [() => j.result(), () => j.motion()])
        try {
          read();
          outcomes.push('read');
        } catch (error) {
          outcomes.push((error as Error).message);
        } finally {
          if (outcomes.length === 2) restore();
        }
      expect(outcomes).toEqual([REALM_ERROR, REALM_ERROR]);
    }
    // A commit under a replaced built-in fails too and keeps the job for a later commit.
    const restore = p.species();
    let outcome = 'committed';
    try {
      w.commitTick(j);
    } catch (error) {
      outcome = (error as Error).message;
    } finally {
      restore();
    }
    expect({ outcome, tick: w.tick }).toEqual({ outcome: REALM_ERROR, tick: 0 });
    w.commitTick(j);
    twin.commitTick(t);
    expect(w.snapshot()).toEqual(twin.snapshot());
  });
  test('a snapshot taken under a replaced slice is a copy, never the live state', () => {
    const w = createReactiveWorld3D(r, mixed(6)),
      committed = w.snapshot(),
      restore = patches().identitySlice();
    let handed;
    try {
      handed = w.snapshot();
    } finally {
      restore();
    }
    handed.block.packedCells.fill(0);
    handed.block.energyQ.fill(0);
    expect(w.snapshot()).toEqual(committed);
  });
  /** A copy of the SDK loaded after install() ran, so its checks take the replacement for the realm's. */
  const loadAfter = async (install: () => () => void) => {
    const restore = install();
    vi.resetModules();
    try {
      const fresh = await import('../reactive-materials.js');
      return { fresh, registry: await fresh.createReactiveMaterialRegistry3D(), restore };
    } catch (error) {
      restore();
      throw error;
    }
  };
  test('a result() read before commit is copied at commit, even under a slice replaced before load', async () => {
    const slice = Array.prototype.slice;
    let identity = false;
    const { fresh, registry, restore } = await loadAfter(() => {
      Array.prototype.slice = function (this: unknown[], ...rest: unknown[]) {
        return identity && !rest.length ? this : slice.apply(this, rest as []);
      } as typeof slice;
      return () => void (Array.prototype.slice = slice);
    });
    try {
      const w = fresh.createReactiveWorld3D(registry, mixed(6)),
        j = w.prepareTick();
      while (j.progress().status === 'running') j.advance(64);
      identity = true;
      let handed;
      try {
        handed = j.result();
      } finally {
        identity = false;
      }
      w.commitTick(j);
      const committed = w.snapshot();
      handed.state.block.packedCells.fill(0);
      handed.state.block.energyQ.fill(0);
      expect(w.snapshot()).toEqual(committed);
    } finally {
      restore();
    }
  });
  test('an array iterator replaced before load cannot leave a hold anchor behind', async () => {
    const iterator = Object.getPrototypeOf([][Symbol.iterator]()) as { next: () => unknown },
      next = iterator.next;
    let skip = -1;
    const { fresh, registry, restore } = await loadAfter(() => {
      // Skips one cell index in every array iteration while armed.
      iterator.next = function (this: unknown) {
        let step = next.call(this) as { done: boolean; value: unknown };
        while (!step.done && step.value === skip) step = next.call(this) as typeof step;
        return step;
      };
      return () => void (iterator.next = next);
    });
    try {
      const tick = (armed: boolean) => {
        const w = fresh.createReactiveWorld3D(registry, mixed(6)),
          held = holdCells(w as unknown as ReturnType<typeof createReactiveWorld3D>),
          j = w.prepareTick();
        while (j.progress().status === 'running') {
          skip = armed && j.progress().phase === 'publish' ? held[1] : -1;
          try {
            j.advance(64);
          } finally {
            skip = -1;
          }
        }
        w.commitTick(j);
        return w.snapshot();
      };
      expect(tick(true)).toEqual(tick(false));
    } finally {
      restore();
    }
  });
  test('the hold overlay and strip visit every held cell under a replaced array iterator', () => {
    const block = readReactiveMaterialBlock3D(r, mixed(6)),
      cells: number[] = [];
    for (let i = 0; i < block.structure.length && cells.length < 3; i++)
      if (block.structure[i] !== 0 && !(block.structure[i] & ANCHOR_3D)) cells.push(i);
    const holds = [{ id: 'held', expiresAtTick: 9, cells }],
      iterator = Object.getPrototypeOf([][Symbol.iterator]()) as { next: () => unknown },
      next = iterator.next;
    // Skips every second value of every array iteration.
    let count = 0;
    iterator.next = function (this: unknown) {
      const step = next.call(this) as { done: boolean };
      return step.done || ++count % 2 ? step : next.call(this);
    };
    let over, stripped;
    try {
      over = overlayReactiveHolds3D(block, holds);
      stripped = stripReactiveHoldAnchors3D(block, over, holds);
    } finally {
      iterator.next = next;
    }
    expect(cells.map((i) => Boolean(over.structure[i] & ANCHOR_3D))).toEqual([true, true, true]);
    expect(stripped.structure).toEqual(block.structure);
  });
  test('a commit copy that a hook changes in any way fails the commit and keeps the world', () => {
    const stash = new WeakMap<object, unknown>();
    /** Object.prototype hooks that make the commit's copy differ from the true state. */
    const hooks: [string, string, PropertyDescriptor][] = [
      // Swallowed stores: the copied block lacks the field.
      ['swallow depth', 'depth', { set: () => undefined }],
      ['swallow width', 'width', { set: () => undefined }],
      ['swallow height', 'height', { set: () => undefined }],
      // A stored value that differs from the true one.
      [
        'width off by one',
        'width',
        {
          set(this: object, value: number) {
            Object.defineProperty(this, 'width', {
              value: value + 1,
              writable: true,
              enumerable: true,
              configurable: true,
            });
          },
        },
      ],
      // An own accessor that answers with the true value while the hook decides it.
      [
        'own accessor for width',
        'width',
        {
          set(this: object, value: unknown) {
            Object.defineProperty(this, 'width', {
              get: () => value,
              enumerable: true,
              configurable: true,
            });
          },
        },
      ],
      // The copied block on another prototype, which could carry its own accessors later.
      [
        'block on another prototype',
        'block',
        {
          set(this: object, value: object) {
            Object.defineProperty(this, 'block', {
              value: Object.setPrototypeOf(value, { tampered: true }),
              writable: true,
              enumerable: true,
              configurable: true,
            });
          },
        },
      ],
      // The true value plus an extra own key on the copy.
      [
        'extra key beside width',
        'width',
        {
          set(this: object, value: unknown) {
            Object.defineProperty(this, 'width', {
              value,
              writable: true,
              enumerable: true,
              configurable: true,
            });
            Object.defineProperty(this, 'extra', {
              value: 1,
              enumerable: true,
              configurable: true,
            });
          },
        },
      ],
      // An own accessor whose descriptor a planted 'value' would answer with the true width.
      [
        'own accessor with planted value',
        'width',
        {
          set(this: object, value: unknown) {
            Object.defineProperty(this, 'width', {
              get: () => value,
              enumerable: true,
              configurable: true,
            });
            Object.defineProperty(Object.prototype, 'value', {
              value,
              writable: true,
              configurable: true,
            });
          },
        },
      ],
      // A hole whose reads the hook answers from a stash: the held cells array keeps no element.
      [
        'stashed index 0',
        '0',
        {
          get(this: object) {
            return stash.get(this);
          },
          set(this: object, value: unknown) {
            stash.set(this, value);
          },
        },
      ],
    ];
    for (const [name, key, descriptor] of hooks) {
      const w = createReactiveWorld3D(r, mixed(6));
      holdCells(w);
      const j = w.prepareTick();
      finish(j, () => () => undefined);
      const before = w.snapshot();
      Object.defineProperty(Object.prototype, key, { configurable: true, ...descriptor });
      let outcome = 'committed';
      try {
        w.commitTick(j);
      } catch (error) {
        outcome = (error as Error).message;
      } finally {
        delete (Object.prototype as Record<string, unknown>)[key];
        delete (Object.prototype as Record<string, unknown>).value;
      }
      expect({ name, outcome, tick: w.tick, same: w.snapshot() }).toEqual({
        name,
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
    // Wrappers installed after load cannot hide a swallowing setter from the check.
    const swallow = () => undefined,
      descriptor = Reflect.getOwnPropertyDescriptor,
      hasOwn = Object.hasOwn;
    const wrappers: [string, () => () => void][] = [
      [
        'ownKeys',
        () => {
          Reflect.ownKeys = ((target: object) =>
            ownKeys(target).filter((key) => key !== 'tick')) as typeof Reflect.ownKeys;
          return () => void (Reflect.ownKeys = ownKeys);
        },
      ],
      [
        'getOwnPropertyDescriptor',
        () => {
          Reflect.getOwnPropertyDescriptor = ((target: object, key: PropertyKey) =>
            key === 'tick'
              ? { value: undefined, writable: true, enumerable: false, configurable: true }
              : descriptor(target, key)) as typeof Reflect.getOwnPropertyDescriptor;
          return () => void (Reflect.getOwnPropertyDescriptor = descriptor);
        },
      ],
      [
        'hasOwn',
        () => {
          // With a planted 'writable', an accessor descriptor would read as a writable data one.
          Object.defineProperty(Object.prototype, 'writable', {
            value: true,
            writable: true,
            configurable: true,
          });
          // Hides the hook's own accessor fields and shows a writable field it lacks.
          Object.hasOwn = ((target: object, key: PropertyKey) =>
            (target as PropertyDescriptor).set === swallow
              ? key !== 'set' && key !== 'get' && (key === 'writable' || hasOwn(target, key))
              : hasOwn(target, key)) as typeof Object.hasOwn;
          return () => {
            Object.hasOwn = hasOwn;
            delete (Object.prototype as Record<string, unknown>).writable;
          };
        },
      ],
    ];
    for (const [name, wrap] of wrappers) {
      Object.defineProperty(Object.prototype, 'tick', { configurable: true, set: swallow });
      const restore = wrap();
      let plain;
      try {
        plain = reactivePlainObjectPrototype3D();
      } finally {
        restore();
        delete (Object.prototype as Record<string, unknown>).tick;
      }
      expect({ name, plain }).toEqual({ name, plain: false });
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
      const total = run(startPerStepOracleStructureJob3D, key, 0, 64).appends;
      expect(total).toBeGreaterThan(4);
      for (let nth = 1; nth <= total; nth++)
        for (const budget of [1, 7, 64, 256]) {
          const expected = run(startPerStepOracleStructureJob3D, key, nth, budget);
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
