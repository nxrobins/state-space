import { parentPort, workerData } from 'node:worker_threads';
import { createSliceSession } from './slice.mjs';

import { choiceResponder } from './choices.mjs';

if (workerData?.twoChoice) {
  parentPort.on(
    'message',
    choiceResponder((reply) => parentPort.postMessage(reply)),
  );
} else {
  const session = await createSliceSession();
  parentPort.on('message', (data) => {
    try {
      parentPort.postMessage({ value: session(data) });
    } catch (error) {
      parentPort.postMessage({ error: String(error) });
    }
  });
}
