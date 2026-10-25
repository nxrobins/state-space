import { defineConfig } from 'vitest/config';
import { sourceAliases } from './vitest.shared.js';

// Native parity fixtures have their own explicit, single-file entry point.
export default defineConfig({
  resolve: { alias: sourceAliases },
  test: {
    environment: 'node',
    include: ['engine/**/*.test.ts'],
    exclude: ['engine/conformance.test.ts', 'engine/structure.test.ts', 'engine/sdk.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 10000,
  },
});
