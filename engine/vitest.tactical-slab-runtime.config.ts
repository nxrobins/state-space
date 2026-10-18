import { defineConfig } from 'vitest/config';
// Held physical acceptance only. No aggregate or selected CPU gate includes this.
export default defineConfig({test: {environment: 'node', include: ['engine/experimental/tactical-slab.runtime-cases.ts'],
  pool: 'forks', fileParallelism: false, maxWorkers: 1, maxConcurrency: 1, testTimeout: 2000, hookTimeout: 5000, bail: 1}});
