import { defineConfig } from 'vitest/config';
// Separate tiny integrated CPU suite; the existing selected suite stays under its deadline.
export default defineConfig({test: {environment: 'node', include: ['engine/experimental/reactive-world.test.ts'],
  pool: 'forks', fileParallelism: false, maxWorkers: 1, maxConcurrency: 1,
  testTimeout: 2000, hookTimeout: 5000, bail: 1}});
