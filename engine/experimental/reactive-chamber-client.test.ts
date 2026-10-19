import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {createReactiveWorkerHost3D} from 'state-space-engine/experimental/3d/reactive-materials';
import {openChamber, type ChamberClient} from '../../examples/reactive-chamber/client.js';
import {createChamber, chamberPolicy} from '../../examples/reactive-chamber/scenario.js';
import {stateHash} from '../../examples/reactive-chamber/recording.js';

// Execute the real host and physics through an asynchronous structured-clone port.
// Only the browser Worker shell is replaced; dropped replies use the public transport hook.
class LocalWorker extends EventTarget {
  private receive = (_value: unknown) => {};
  private host: ReturnType<typeof createReactiveWorkerHost3D> | null = null;
  private terminated = false;
  constructor() {
    super();
    void createChamber().then(({registry, initial}) => {
      if (this.terminated) return;
      this.host = createReactiveWorkerHost3D({send: value => this.emit(value), close() {},
        subscribe: receive => {this.receive = receive; return () => {this.receive = () => {};};}},
      registry, initial, chamberPolicy(registry), {channel: 'chamber', work: 256});
      this.emit({kind: 'chamber-ready', catalogHash: registry.hash});
    }).catch(() => this.dispatchEvent(new Event('error')));
  }
  private emit(value: unknown) {
    const data = structuredClone(value);
    queueMicrotask(() => {if (!this.terminated) this.dispatchEvent(new MessageEvent('message', {data}));});
  }
  postMessage(value: unknown) {const data = structuredClone(value); queueMicrotask(() => {if (!this.terminated) this.receive(data);});}
  terminate() {this.terminated = true; this.host?.close();}
}
const clients: ChamberClient[] = [];
async function open(options: Parameters<typeof openChamber>[0] = {}) {const client = await openChamber(options); clients.push(client); return client;}
async function bounded<T>(promise: Promise<T>, ms = 1000): Promise<T | 'still pending'> {
  let timer: ReturnType<typeof setTimeout>;
  try {return await Promise.race([promise, new Promise<'still pending'>(resolve => {timer = setTimeout(() => resolve('still pending'), ms);})]);}
  finally {clearTimeout(timer!);}
}
beforeEach(() => {vi.stubGlobal('Worker', LocalWorker);});
afterEach(async () => {await Promise.all(clients.splice(0).map(client => client.close().catch(() => {}))); vi.unstubAllGlobals();});

describe('chamber client failure and ownership boundaries', () => {
  test('a dropped discard acknowledgement rejects cancellation and notifies subscribers', async () => {
    const client = await open({timeoutMs: 250, wrapTransport: transport => ({...transport,
      subscribe(receive, failed) {return transport.subscribe(value => {if ((value as {kind?: string}).kind !== 'discard') receive(value);}, failed);},
    })});
    const initial = client.exportSave(), observed: string[] = [];
    client.onChange(() => observed.push(client.state.status));
    expect((await client.preview({kind: 'wait'})).status).toBe('ready');
    const cancelled = client.cancel().then(() => 'resolved', error => String(error));
    expect(await bounded(cancelled)).toMatch(/timed out/);
    expect(observed.at(-1)).toBe('failed'); expect(client.state.uncertain).toBe(false);
    expect(client.exportSave()).toBe(initial);
  });
  test('closing during cancellation settles the cancellation waiter', async () => {
    const client = await open();
    expect((await client.preview({kind: 'wait'})).status).toBe('ready');
    const cancelled = client.cancel().then(() => 'resolved', error => String(error));
    await client.close();
    expect(await bounded(cancelled)).toMatch(/closed/i);
    expect(client.state.status).toBe('closed');
  });
  test('returned previews cannot mutate the candidate or poison the committed recording', async () => {
    const client = await open(), result = await client.preview({kind: 'wait'});
    if (result.status !== 'ready') throw Error('Preview did not finish.');
    const expected = client.previewSnapshot();
    result.preview.state.game.remainingQ--;
    Object.assign(result.preview.base, {revision: 99});
    expect(client.previewSnapshot()).toEqual(expected);
    const committed = await client.commit(), save = JSON.parse(client.exportSave());
    expect(save.snapshot).toEqual(committed);
    expect(save.steps[0].sha256).toBe(await stateHash(committed));
  });
});
