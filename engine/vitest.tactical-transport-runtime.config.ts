import { defineConfig } from 'vitest/config';
// Held physical acceptance only; no selected CPU gate includes this file.
export default defineConfig({test: {environment: 'node', include: ['engine/experimental/material-transport-coupling.runtime-cases.ts'],
  pool: 'forks', fileParallelism: false, maxWorkers: 1, maxConcurrency: 1, testTimeout: 2000, hookTimeout: 5000, bail: 1}});
