import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  MAT,
  createReactiveWorkerHost3D,
} from 'state-space-engine/experimental/3d/reactive-materials';
import {
  openChamber,
  loadChamber,
  type ChamberClient,
} from '../../../examples/reactive-chamber/client.js';
import {
  SCENARIOS,
  createChamber,
  chamberPolicy,
  readScenario,
  coordinate,
  SUPPORT,
} from '../../../examples/reactive-chamber/scenario.js';
import { stateHash } from '../../../examples/reactive-chamber/recording.js';
import { openChamberView } from '../../../examples/reactive-chamber/view.js';
import {
  sceneData,
  type ChamberScene,
  type ChamberCamera,
} from '../../../examples/reactive-chamber/presentation.js';
vi.mock('../../../examples/reactive-chamber/view.js', () => ({ openChamberView: vi.fn() }));

// Execute the real host and physics through an asynchronous structured-clone port.
// Only the browser Worker shell is replaced; dropped replies use the public transport hook.
class LocalWorker extends EventTarget {
  private receive = (_value: unknown) => {};
  private host: ReturnType<typeof createReactiveWorkerHost3D> | null = null;
  private terminated = false;
  constructor(url: URL) {
    super();
    const scenario = readScenario(url.searchParams.get('scenario') ?? 'chamber');
    void createChamber(scenario)
      .then(({ registry, initial }) => {
        if (this.terminated) return;
        this.host = createReactiveWorkerHost3D(
          {
            send: (value) => this.emit(value),
            close() {},
            subscribe: (receive) => {
              this.receive = receive;
              return () => {
                this.receive = () => {};
              };
            },
          },
          registry,
          initial,
          chamberPolicy(registry),
          { channel: 'chamber', work: 256 },
        );
        this.emit({ kind: 'chamber-ready', catalogHash: registry.hash, scenario });
      })
      .catch(() => this.dispatchEvent(new Event('error')));
  }
  private emit(value: unknown) {
    const data = structuredClone(value);
    queueMicrotask(() => {
      if (!this.terminated) this.dispatchEvent(new MessageEvent('message', { data }));
    });
  }
  postMessage(value: unknown) {
    const data = structuredClone(value);
    queueMicrotask(() => {
      if (!this.terminated) this.receive(data);
    });
  }
  terminate() {
    this.terminated = true;
    this.host?.close();
  }
}
const clients: ChamberClient[] = [];
async function open(options: Parameters<typeof openChamber>[0] = {}) {
  const client = await openChamber(options);
  clients.push(client);
  return client;
}
async function bounded<T>(promise: Promise<T>, ms = 1000): Promise<T | 'still pending'> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<'still pending'>((resolve) => {
        timer = setTimeout(() => resolve('still pending'), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
beforeEach(() => {
  vi.stubGlobal('Worker', LocalWorker);
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => {})));
  vi.unstubAllGlobals();
});

describe('chamber client failure and ownership boundaries', () => {
  test('a dropped discard acknowledgement rejects cancellation and notifies subscribers', async () => {
    const client = await open({
      timeoutMs: 250,
      wrapTransport: (transport) => ({
        ...transport,
        subscribe(receive, failed) {
          return transport.subscribe((value) => {
            if ((value as { kind?: string }).kind !== 'discard') receive(value);
          }, failed);
        },
      }),
    });
    const initial = client.exportSave(),
      observed: string[] = [];
    client.onChange(() => observed.push(client.state.status));
    expect((await client.preview({ kind: 'wait' })).status).toBe('ready');
    const cancelled = client.cancel().then(
      () => 'resolved',
      (error) => String(error),
    );
    expect(await bounded(cancelled)).toMatch(/timed out/);
    expect(observed.at(-1)).toBe('failed');
    expect(client.state.uncertain).toBe(false);
    expect(client.exportSave()).toBe(initial);
  });
  test('closing during cancellation settles the cancellation waiter', async () => {
    const client = await open();
    expect((await client.preview({ kind: 'wait' })).status).toBe('ready');
    const cancelled = client.cancel().then(
      () => 'resolved',
      (error) => String(error),
    );
    const closing = client.close();
    expect(client.close()).toBe(closing);
    await closing;
    expect(client.close()).toBe(closing);
    expect(await bounded(cancelled)).toMatch(/closed/i);
    expect(client.state.status).toBe('closed');
  });
  test('returned previews cannot mutate the candidate or poison the committed recording', async () => {
    const client = await open(),
      result = await client.preview({ kind: 'wait' });
    if (result.status !== 'ready') throw Error('Preview did not finish.');
    const expected = client.previewSnapshot();
    result.preview.state.game.remainingQ--;
    Object.assign(result.preview.base, { revision: 99 });
    expect(client.previewSnapshot()).toEqual(expected);
    const committed = await client.commit(),
      save = JSON.parse(client.exportSave());
    expect(save.snapshot).toEqual(committed);
    expect(save.steps[0].sha256).toBe(await stateHash(committed));
  });
});

test.each(['flow', 'conduction', 'insulation', 'wax'] as const)(
  '%s save selects its own worker/catalog and resumes the same committed history',
  async (scenario) => {
    const client = await open({ scenario });
    const cell = [
      ...(scenario === 'flow' ? SCENARIOS.flow.secondary : SCENARIOS[scenario].primary),
    ] as [number, number, number];
    expect((await client.preview({ kind: 'heat', cell })).status).toBe('ready');
    await client.commit();
    const saved = client.exportSave();
    const loaded = await loadChamber(saved, { scenario: 'chamber' });
    clients.push(loaded);
    expect(loaded.scenario).toBe(scenario);
    expect(loaded.exportSave()).toBe(saved);
    for (const target of [client, loaded]) {
      expect((await target.preview({ kind: 'wait' })).status).toBe('ready');
      await target.commit();
    }
    expect(loaded.exportSave()).toBe(client.exportSave());
  },
);

test('selection and inspection ignore previous dimensions and catalogs until the replacement frame completes', async () => {
  const elements = new Map<string, { disabled: boolean; dataset: object; onclick?: () => void }>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { disabled: false, dataset: {} });
    return elements.get(id)!;
  };
  vi.stubGlobal('document', { getElementById: element });
  vi.stubGlobal('window', { addEventListener() {} });
  vi.stubGlobal('location', { href: 'http://localhost/?scenario=flow' });
  type Frame = { scene: ChamberScene; camera: ChamberCamera };
  let displayed: Frame | null = null,
    pending: Frame | null = null;
  let notifyPaint = () => {};
  vi.mocked(openChamberView).mockImplementation(async (_canvas, options) => ({
    renderer: {} as Awaited<ReturnType<typeof openChamberView>>['renderer'],
    get displayed() {
      return displayed;
    },
    present(scene, camera) {
      notifyPaint = options.onPaint;
      pending = { scene, camera };
    },
    async painted() {
      displayed = pending;
      options.onPaint();
    },
    async close() {},
  }));
  const { chamberApp: app } = await import('../../../examples/reactive-chamber/browser-entry.js');
  try {
    await app.start();
    for (const kind of ['heat', 'wait'] as const) {
      expect((await app.preview(kind))?.status).toBe('ready');
      await app.client!.commit();
    }
    await app.painted();
    const block = app.client!.snapshot().domains.world.block;
    const water = coordinate(
      block.packedCells.findIndex((v) => (v & 255) === MAT.WATER),
      16,
    );
    expect(water.some((v) => v >= 8)).toBe(true);
    element('select-water').onclick!();
    await app.painted();
    expect(app.scene!.selected).toEqual(water);

    await app.selectScenario('chamber');
    expect(app.client!.scenario).toBe('chamber');
    expect(sceneData(app.scene!).snapshot.worldId).toBe('reactive-sandbox-flow-1');
    expect(() => element('select-water').onclick!()).not.toThrow();
    await app.painted();
    expect(app.scene!.selected).toEqual(SUPPORT);
    expect((await app.preview('heat'))?.status).toBe('ready');
    await app.selectScenario('conduction');
    await app.painted();
    const sample = app.scene!;
    expect(app.client!.registry.material(32).name).toBe('copper');
    await app.selectScenario('chamber');
    expect(app.scene).toBe(sample);
    // An old completed frame can notify while the new client/catalog is installed.
    expect(() => notifyPaint()).not.toThrow();
    expect(() => element('select-water').onclick!()).not.toThrow();
    await app.painted();
    expect(app.scene!.selected).toEqual(SUPPORT);
  } finally {
    await app.stop();
    vi.mocked(openChamberView).mockReset();
  }
});
