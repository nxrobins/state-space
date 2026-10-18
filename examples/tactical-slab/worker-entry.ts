import { installSlabWorker } from './worker.js';
installSlabWorker(globalThis as unknown as Parameters<typeof installSlabWorker>[0]);
