import { parentPort } from 'node:worker_threads';
import { createSliceSession } from './slice.mjs';

const session = await createSliceSession();
parentPort.on('message', (data) => {
  try {
    parentPort.postMessage({ value: session(data) });
  } catch (error) {
    parentPort.postMessage({ error: String(error) });
  }
});
