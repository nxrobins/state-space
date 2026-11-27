import { createSliceSession } from './slice.mjs';

const session = createSliceSession();
self.onmessage = async ({ data }) => {
  try {
    self.postMessage({ value: (await session)(data) });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
