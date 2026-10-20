/** Dedicated worker owns physics, actors and resource accounting. */
import {
  createReactiveWorkerHost3D,
  type ReactiveWorkerTransport3D,
} from 'state-space-engine/experimental/3d/reactive-materials';
import { createChamber, chamberPolicy, readScenario } from './scenario.js';
const endpoint = globalThis as unknown as {
  postMessage(value: unknown): void;
  close(): void;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  removeEventListener(type: string, listener: (event: MessageEvent) => void): void;
};
void (async () => {
  try {
    const params = new URL(import.meta.url).searchParams;
    const scenario = readScenario(params.get('scenario') ?? 'chamber');
    const profile = params.get('profile') === '1';
    const { registry, initial } = await createChamber(scenario);
    let started = 0;
    const transport: ReactiveWorkerTransport3D = {
      send: (value) =>
        endpoint.postMessage(
          profile
            ? { kind: 'chamber-profile', message: value, workMs: performance.now() - started }
            : value,
        ),
      close: () => endpoint.close(),
      subscribe(receive, failed) {
        const message = (event: MessageEvent) => {
            started = performance.now();
            receive(event.data);
          },
          error = () => failed(Error('Worker message could not be decoded.'));
        endpoint.addEventListener('message', message);
        endpoint.addEventListener('messageerror', error);
        return () => {
          endpoint.removeEventListener('message', message);
          endpoint.removeEventListener('messageerror', error);
        };
      },
    };
    createReactiveWorkerHost3D(transport, registry, initial, chamberPolicy(registry), {
      channel: 'chamber',
      work: 256,
    });
    endpoint.postMessage({ kind: 'chamber-ready', catalogHash: registry.hash, scenario });
  } catch (error) {
    endpoint.postMessage({
      kind: 'chamber-start-failed',
      error: error instanceof Error ? error.message : 'Worker failed.',
    });
    endpoint.close();
  }
})();
