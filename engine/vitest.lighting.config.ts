import {defineConfig} from 'vitest/config';

// Proposed non-GPU stage only. Runtime authorization/containment is external;
// this config grants no recovery permit and must not be used to bypass the hold.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'engine/experimental/lighting-cache.test.ts',
      'engine/experimental/cavern-appearance.test.ts',
      'engine/experimental/structural-client.test.ts',
    ],
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    maxConcurrency: 1,
    testTimeout: 2000,
    hookTimeout: 5000,
    bail: 1,
  },
});
