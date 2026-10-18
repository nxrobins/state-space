import { defineConfig } from 'vitest/config';
// Held physical path journal cases; never selected by edit/mock checks.
export default defineConfig({test: {
  environment: 'node', include: ['engine/experimental/path-journal.runtime-cases.ts'],
  pool: 'forks', fileParallelism: false, maxWorkers: 1, maxConcurrency: 1,
  testTimeout: 2000, hookTimeout: 5000, bail: 1,
}});
