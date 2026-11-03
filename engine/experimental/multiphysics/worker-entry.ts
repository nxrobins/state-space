/** Dedicated module Worker bootstrap: one initial snapshot, then the host protocol only. */
import { createMultiphysicsProfiles3D } from './profiles.js';
import { createMultiphysicsWorkerHost3D } from './worker-host.js';
import {
  createMultiphysicsTaskQueue3D,
  errorText,
  integer,
  MULTIPHYSICS_WORKER_BOOTSTRAP_3D,
  type MultiphysicsWorkerTransport3D,
} from './worker-wire.js';
import type { MultiphysicsSnapshot3D } from './model.js';
const endpoint = globalThis as unknown as {
  postMessage(value: unknown): void;
  close(): void;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  removeEventListener(type: string, listener: (event: MessageEvent) => void): void;
};
function started(event: MessageEvent) {
  endpoint.removeEventListener('message', started);
  void (async () => {
    const queue = createMultiphysicsTaskQueue3D();
    try {
      const data = event.data as { kind?: unknown; snapshot?: unknown; work?: unknown };
      if (data?.kind !== MULTIPHYSICS_WORKER_BOOTSTRAP_3D)
        throw Error('Multiphysics Worker bootstrap required.');
      const profiles = await createMultiphysicsProfiles3D();
      const transport: MultiphysicsWorkerTransport3D = {
        send: (value) => endpoint.postMessage(value),
        close() {
          queue.close();
          endpoint.close();
        },
        subscribe(receive, failed) {
          const message = (event: MessageEvent) => receive(event.data),
            error = () => failed(Error('Worker message could not be decoded.'));
          endpoint.addEventListener('message', message);
          endpoint.addEventListener('messageerror', error);
          return () => {
            endpoint.removeEventListener('message', message);
            endpoint.removeEventListener('messageerror', error);
          };
        },
      };
      // The host validates the snapshot before it subscribes to protocol messages.
      createMultiphysicsWorkerHost3D(transport, profiles, data.snapshot as MultiphysicsSnapshot3D, {
        schedule: queue.schedule,
        work: integer(data.work ?? 128, 1, 256),
      });
      endpoint.postMessage({ kind: MULTIPHYSICS_WORKER_BOOTSTRAP_3D, ready: true });
    } catch (error) {
      queue.close();
      endpoint.postMessage({
        kind: MULTIPHYSICS_WORKER_BOOTSTRAP_3D,
        ready: false,
        error: errorText(error),
      });
      endpoint.close();
    }
  })();
}
endpoint.addEventListener('message', started);
