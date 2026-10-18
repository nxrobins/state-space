import { defineConfig } from 'vitest/config';

// CPU edit-only fixtures: no stepping, browser, native GPU or benchmark imports.
// Authorization and resource containment are provided by the external harness.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['engine/experimental/interventions.test.ts'],
    pool: 'forks', fileParallelism: false, maxWorkers: 1, maxConcurrency: 1,
    testTimeout: 2000, hookTimeout: 5000, bail: 1,
  },
});
