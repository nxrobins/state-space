/** Dedicated worker owns physics, actors and resource accounting. */
import {createReactiveWorkerHost3D, type ReactiveWorkerTransport3D} from 'state-space-engine/experimental/3d/reactive-materials';
import {createChamber, chamberPolicy} from './scenario.js';
const endpoint = globalThis as unknown as {postMessage(value: unknown): void; close(): void;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  removeEventListener(type: string, listener: (event: MessageEvent) => void): void};
void (async () => {
  try {
    const {registry, initial} = await createChamber();
    const transport: ReactiveWorkerTransport3D = {send: value => endpoint.postMessage(value), close: () => endpoint.close(),
      subscribe(receive, failed) {
        const message = (event: MessageEvent) => receive(event.data), error = () => failed(Error('Worker message could not be decoded.'));
        endpoint.addEventListener('message', message); endpoint.addEventListener('messageerror', error);
        return () => {endpoint.removeEventListener('message', message); endpoint.removeEventListener('messageerror', error);};
      }};
    createReactiveWorkerHost3D(transport, registry, initial, chamberPolicy(registry), {channel: 'chamber', work: 256});
    endpoint.postMessage({kind: 'chamber-ready', catalogHash: registry.hash});
  } catch (error) {endpoint.postMessage({kind: 'chamber-start-failed', error: error instanceof Error ? error.message : 'Worker failed.'}); endpoint.close();}
})();
