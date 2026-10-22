/** A patched realm is outside the bit-identity contract; a tick still publishes the true state or fails. */
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
import {
  createReactiveMaterialRegistry3D,
  createReactiveMaterialBlock3D,
  editReactiveMaterialBlock3D,
  createReactiveWorldSnapshot3D,
  createReactiveWorldTickJob3D,
  createReactiveWorld3D,
  MAT,
  ENERGY_SCALE,
  type ReactiveMaterialRegistry3D,
  type ReactiveMaterialBlock3D,
  type ReactiveMaterialEdit3D,
  type ReactiveWorldTickJob3D,
} from '../reactive-materials.js';

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
      let snapshot = createReactiveWorldSnapshot3D(r, mixed());
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
    const observe = (descriptor: PropertyDescriptor, key: string) => {
      const w = createReactiveWorld3D(r, mixed(6)),
        j = w.prepareTick();
      finish(j, () => () => undefined);
      const setter = vi.fn();
      Object.defineProperty(Object.prototype, key, {
        configurable: true,
        ...descriptor,
        ...('set' in descriptor ? { set: setter } : {}),
      });
      try {
        w.commitTick(j);
        return { committed: w.tick, calls: setter.mock.calls.length };
      } catch (error) {
        return { error: (error as Error).message, tick: w.tick, calls: setter.mock.calls.length };
      } finally {
        delete (Object.prototype as Record<string, unknown>)[key];
      }
    };
    // A copy assigns every field, so a setter named 'tick' swallows it and the commit fails closed.
    expect(observe({ set: () => undefined }, 'tick')).toEqual({
      error: 'Reactive tick commit identity or accounting mismatch.',
      tick: 0,
      calls: 1,
    });
    expect(observe({ value: 7, writable: false }, 'width')).toEqual({
      error: "Cannot assign to read only property 'width' of object '#<Object>'",
      tick: 0,
      calls: 0,
    });
    expect(observe({ value: 7, writable: true }, 'width')).toEqual({ committed: 1, calls: 0 });
  });
});
