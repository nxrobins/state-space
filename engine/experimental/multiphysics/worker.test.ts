import { beforeAll, expect, test, vi } from 'vitest';
import { createWorkerBus } from '../../test-support/worker-bus.js';
import { createMultiphysicsProfiles3D, type MultiphysicsProfiles3D } from './profiles.js';
import { seedThermalParcel3D } from './thermal.js';
import { createMultiphysicsSnapshot3D } from './model.js';
import { createMultiphysicsWorld3D } from './world.js';
import { createMultiphysicsWorkerHost3D } from './worker-host.js';
import { createMultiphysicsWorkerClient3D } from './worker-client.js';
import type { MultiphysicsWorkerMessage3D } from './worker-wire.js';
let profiles: MultiphysicsProfiles3D;
beforeAll(async () => {
  profiles = await createMultiphysicsProfiles3D();
});
function setup(work = 7) {
  const initial = createMultiphysicsSnapshot3D(profiles, {
    parcels: [
      seedThermalParcel3D(profiles, {
        id: 'a',
        material: 'copper',
        owner: 'start',
        center: [0, 2, 0],
        angularVelocity: [0, 1, 0],
      }),
    ],
  });
  const bus = createWorkerBus<MultiphysicsWorkerMessage3D>(10000);
  const host = createMultiphysicsWorkerHost3D(bus.ports[1], profiles, initial, {
    work,
    schedule: bus.schedule,
  });
  const client = createMultiphysicsWorkerClient3D(bus.ports[0], profiles, { timeoutMs: 1000 });
  return {
    initial,
    bus,
    host,
    client,
    close() {
      client.close();
      host.close();
    },
  };
}
test('Worker preview, commit, and JSON restart exactly match direct execution across work budgets', async () => {
  for (const work of [1, 256]) {
    const h = setup(work);
    try {
      await h.bus.settle(h.client.ready);
      const direct = createMultiphysicsWorld3D(profiles, h.initial),
        edits = [{ kind: 'heat' as const, id: 'a', energyQ: 3 }];
      const expected = direct.prepare(edits, 2);
      while (expected.progress().status === 'running') expected.advance(31);
      const expectedResult = expected.result(),
        preview = await h.bus.settle(h.client.preview(edits, 2));
      expect(preview.result).toEqual(expectedResult);
      preview.result.snapshot.parcels[0].mass = 999; // presentation cannot rewrite host candidate
      const committed = await h.bus.settle(h.client.commit(preview));
      expect(committed.result).toEqual(expectedResult);
      await expect(h.client.commit(preview)).rejects.toThrow(/stale/);
      const saved = JSON.parse(JSON.stringify(committed.result.snapshot));
      expect((await h.bus.settle(h.client.restore(saved))).snapshot).toEqual(saved);
      const restarted = await h.bus.settle(h.client.preview([], 1));
      const next = createMultiphysicsWorld3D(profiles, saved).prepare([], 1);
      while (next.progress().status === 'running') next.advance(256);
      expect(restarted.result).toEqual(next.result());
      expect(h.bus.maximum()).toBe(1);
    } finally {
      h.close();
    }
  }
});
test('cancel during work and cancel after ready both preserve live state and reject stale tokens', async () => {
  const h = setup();
  try {
    await h.bus.settle(h.client.ready);
    const pending = h.client.preview([], 2),
      rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await h.bus.until(() => h.bus.tasks.some((t) => t.kind === 'slice'));
    const cancel = h.client.cancel();
    await h.bus.settle(cancel);
    await rejected;
    expect((await h.bus.settle(h.client.snapshot())).snapshot).toEqual(h.initial);
    const old = await h.bus.settle(h.client.preview([], 0));
    await h.bus.settle(h.client.cancel());
    const fresh = await h.bus.settle(h.client.preview([], 0));
    await expect(h.client.commit(old)).rejects.toThrow(/stale/);
    expect((await h.bus.settle(h.client.commit(fresh))).revision).toBe(1);
    expect(h.bus.maximum()).toBeLessThanOrEqual(2);
  } finally {
    h.close();
  }
});
test('cancellation wins a ready reply already queued for delivery', async () => {
  const h = setup(256);
  try {
    await h.bus.settle(h.client.ready);
    h.bus.config.hold = (m, side) => side === 1 && m.kind === 'preview';
    const pending = h.client.preview([], 0),
      rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await h.bus.until(() => h.bus.held.length === 1);
    const cancel = h.client.cancel();
    h.bus.releaseHeld();
    await h.bus.settle(cancel);
    await rejected;
    expect((await h.bus.settle(h.client.snapshot())).snapshot).toEqual(h.initial);
  } finally {
    h.close();
  }
});
test('bad edits reject atomically; busy operations do not create a request queue', async () => {
  const h = setup();
  try {
    await h.bus.settle(h.client.ready);
    await expect(
      h.bus.settle(h.client.preview([{ kind: 'remove', ids: ['absent'] }], 1)),
    ).rejects.toThrow(/absent/);
    const pending = h.client.preview([], 2);
    await expect(h.client.preview([], 1)).rejects.toThrow(/idle/);
    await expect(h.client.restore(h.initial)).rejects.toThrow(/idle/);
    const preview = await h.bus.settle(pending);
    await h.bus.settle(h.client.cancel());
    await expect(h.client.commit(preview)).rejects.toThrow(/stale/);
    expect((await h.bus.settle(h.client.snapshot())).snapshot).toEqual(h.initial);
    expect(h.bus.maximum()).toBe(1);
  } finally {
    h.close();
  }
});
test('invalid revision replies and transport failures terminate all pending work', async () => {
  const h = setup();
  try {
    await h.bus.settle(h.client.ready);
    h.bus.config.mapReply = (m) =>
      m.kind === 'snapshot' ? { ...m, payload: { ...(m.payload as object), revision: 100 } } : m;
    await expect(h.bus.settle(h.client.snapshot())).rejects.toThrow(/revision/);
    expect(h.bus.closed[0]).toBe(true);
    await expect(h.client.preview()).rejects.toThrow();
  } finally {
    h.close();
  }
  const b = setup();
  try {
    await b.bus.settle(b.client.ready);
    const pending = b.client.preview();
    const rejected = expect(pending).rejects.toThrow(/broken/);
    b.bus.errors[0](Error('broken'));
    await rejected;
    expect(b.bus.removed[0]).toBe(true);
  } finally {
    b.close();
  }
});
test('lost replies have a finite timeout and cannot leave a client operation pending', async () => {
  vi.useFakeTimers();
  const h = setup();
  try {
    await h.bus.settle(h.client.ready);
    h.bus.config.mapReply = () => null;
    const pending = h.client.preview(),
      rejected = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(1001);
    await rejected;
    expect(h.bus.closed[0]).toBe(true);
  } finally {
    h.close();
    vi.useRealTimers();
  }
});
test('scheduler failure and malformed host envelopes never publish a candidate', async () => {
  const h = setup();
  try {
    await h.bus.settle(h.client.ready);
    h.bus.config.scheduleFailure = true;
    await expect(h.bus.settle(h.client.preview())).rejects.toThrow(/Scheduler/);
    expect((await h.bus.settle(h.client.snapshot())).snapshot).toEqual(h.initial);
    let reads = 0;
    h.bus.receive[1]({
      get protocol() {
        reads++;
        return 'bad';
      },
    });
    expect(reads).toBe(0);
    expect(h.bus.closed[1]).toBe(true);
  } finally {
    h.close();
  }
});
