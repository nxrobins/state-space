import { defineConfig } from 'vitest/config';

// Native parity fixtures have their own explicit, single-file entry point.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['engine/**/*.test.ts'],
    exclude: ['engine/conformance.test.ts', 'engine/structure.test.ts', 'engine/sdk.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 10000,
  },
});
