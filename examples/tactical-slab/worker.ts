/** Bundle as a module worker; importing waits for explicit initialization. */
import { createTacticalWorkerHost3D } from 'state-space-engine/experimental/3d/tactical-session';
import { createSlabSession, prepareSlabCommand, type SlabCommand, type SlabSnapshot } from './scenario.js';

type Endpoint = {addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  removeEventListener(type: string, listener: (event: MessageEvent) => void): void; postMessage(value: unknown): void; close(): void};
/** Explicitly install in a dedicated worker entry. No registration on module import. */
export function installSlabWorker(endpoint: Endpoint): () => Promise<void> {
  let initialized = false, disposed = false, host: {close(): Promise<void>} | undefined;
  const initialize = (event: MessageEvent) => {
    if (initialized || disposed) return;
    try {
    const value = event.data;
    if (!value || typeof value !== 'object' || value.kind !== 'initialize' ||
        Object.keys(value).sort().join(',') !== 'channel,kind,snapshot' || typeof value.channel !== 'string' ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value.channel)) throw Error('Invalid slab worker initialization.');
    const session = createSlabSession(value.snapshot === null ? undefined : value.snapshot as SlabSnapshot);
    host = createTacticalWorkerHost3D({send: value => endpoint.postMessage(value),
      subscribe(receive, failed) {
        const message = (e: MessageEvent) => receive(e.data), error = () => failed(Error('Slab worker clone failed.'));
        endpoint.addEventListener('message', message); endpoint.addEventListener('messageerror', error);
        return () => {endpoint.removeEventListener('message', message); endpoint.removeEventListener('messageerror', error);};
      }, close: () => endpoint.close()}, session, (editor, command: SlabCommand) => prepareSlabCommand(editor, command), value.channel);
    initialized = true; endpoint.removeEventListener('message', initialize);
    } catch (error) {disposed = true; endpoint.removeEventListener('message', initialize); endpoint.close(); throw error;}
  };
  endpoint.addEventListener('message', initialize);
  return async () => {if (disposed) return; disposed = true; endpoint.removeEventListener('message', initialize); try {await host?.close();} finally {endpoint.close();}};
}
