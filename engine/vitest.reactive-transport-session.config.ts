import { defineConfig } from 'vitest/config';
export default defineConfig({test: {environment: 'node', include: ['engine/experimental/reactive-transport-session.test.ts'],
  pool: 'forks', fileParallelism: false, maxWorkers: 1, maxConcurrency: 1,
  testTimeout: 2000, hookTimeout: 5000, bail: 1}});
