/** Authored physical acceptance. Held separately; never selected by CPU mock gates. */
import { describe, expect, test } from 'vitest';
import { createSlabController } from '../../../examples/tactical-slab/controller.js';
import { createSlabSession } from '../../../examples/tactical-slab/scenario.js';

describe('held physical hot slab integration', () => {
  test('wind save after an odd physical tick resumes material controls and actors exactly', async () => {
    const a = createSlabController();
    let b: ReturnType<typeof createSlabController> | undefined;
    try {
      const first = a.request({ kind: 'wind', parcel: 'steam', direction: 'east' }, 1);
      expect((await first.result).status).toBe('ready');
      const saved = a.commit(first).snapshot;
      b = createSlabController(createSlabSession(JSON.parse(JSON.stringify(saved))));
      const x = a.request({ kind: 'drift' }, 1),
        y = b.request({ kind: 'drift' }, 1);
      expect((await x.result).status).toBe('ready');
      expect((await y.result).status).toBe('ready');
      expect(a.commit(x).snapshot).toEqual(b.commit(y).snapshot);
    } finally {
      await a.close();
      await b?.close();
    }
  });
  test('air previews agree with independent physical execution without reapplying the impulse', async () => {
    const a = createSlabController(),
      b = createSlabController();
    try {
      const x = a.request({ kind: 'air', unit: 'scout', direction: 'up' }, 2);
      expect((await x.result).status).toBe('ready');
      const y = b.request({ kind: 'air', unit: 'scout', direction: 'up' }, 2);
      expect((await y.result).status).toBe('ready');
      const left = a.commit(x).snapshot,
        right = b.commit(y).snapshot;
      expect(left).toEqual(right);
      expect(left.game.pendingAir).toBeNull();
      expect(left.game.ap).toBe(2);
    } finally {
      await a.close();
      await b.close();
    }
  });
  test('saved midair physical state continues exactly after restoration', async () => {
    const a = createSlabController();
    let b: ReturnType<typeof createSlabController> | undefined;
    try {
      const first = a.request({ kind: 'air', unit: 'scout', direction: 'up' }, 1);
      expect((await first.result).status).toBe('ready');
      const saved = a.commit(first).snapshot;
      b = createSlabController(createSlabSession(saved));
      const x = a.request({ kind: 'wait' }, 2);
      expect((await x.result).status).toBe('ready');
      const y = b.request({ kind: 'wait' }, 2);
      expect((await y.result).status).toBe('ready');
      expect(a.commit(x).snapshot).toEqual(b.commit(y).snapshot);
    } finally {
      await a.close();
      await b?.close();
    }
  });
  test('physical preview and independent execution produce the same complete game and terrain', async () => {
    const a = createSlabController(),
      b = createSlabController();
    try {
      const x = a.request({ kind: 'lift' }, 1);
      const left = await x.result;
      expect(left.status).toBe('ready');
      const y = b.request({ kind: 'lift' }, 1);
      const right = await y.result;
      expect(right.status).toBe('ready');
      expect(a.commit(x).snapshot).toEqual(b.commit(y).snapshot);
    } finally {
      await a.close();
      await b.close();
    }
  });
  test('odd-tick saved controlled matter and actors continue exactly after restoration', async () => {
    const a = createSlabController();
    let b: ReturnType<typeof createSlabController> | undefined;
    try {
      const first = a.request({ kind: 'lift' }, 1);
      expect((await first.result).status).toBe('ready');
      const saved = a.commit(first).snapshot;
      b = createSlabController(createSlabSession(saved));
      const x = a.request({ kind: 'wait' }, 1);
      expect((await x.result).status).toBe('ready');
      const y = b.request({ kind: 'wait' }, 1);
      expect((await y.result).status).toBe('ready');
      expect(a.commit(x).snapshot).toEqual(b.commit(y).snapshot);
    } finally {
      await a.close();
      await b?.close();
    }
  });
  test('control expiry is followed by actual slab descent and rider response', async () => {
    const c = createSlabController();
    try {
      const lift = c.request({ kind: 'lift' }, 0);
      expect((await lift.result).status).toBe('ready');
      const raised = c.commit(lift).snapshot;
      const wait = c.request({ kind: 'wait' }, 5);
      expect((await wait.result).status).toBe('ready');
      const resolved = c.commit(wait).snapshot;
      expect(resolved.holds).toEqual([]);
      expect(
        resolved.game.slab.every(
          (n, i) => Math.floor(n / 8) % 8 > Math.floor(raised.game.slab[i] / 8) % 8,
        ),
      ).toBe(true);
      expect(resolved.game.units[0].body.minQ[1]).toBeGreaterThan(
        raised.game.units[0].body.minQ[1],
      );
      expect(resolved.accounting).toEqual(raised.accounting);
    } finally {
      await c.close();
    }
  });
  test('removing the supporting slab produces distant walkway and scout consequences', async () => {
    const c = createSlabController();
    try {
      const before = c.snapshot(),
        lift = c.request({ kind: 'lift' }, 2);
      expect((await lift.result).status).toBe('ready');
      const after = c.commit(lift).snapshot;
      expect(after.terrain.structure[5 + 8 * (5 + 8 * 2)]).not.toBe(
        before.terrain.structure[5 + 8 * (5 + 8 * 2)],
      );
      expect(after.game.units[1].body.minQ[1]).toBeGreaterThan(before.game.units[1].body.minQ[1]);
      expect(after.accounting).toEqual(before.accounting);
    } finally {
      await c.close();
    }
  });
});
