import { defineConfig } from 'vitest/config';
// Held physical journal gate; never selected by the edit/inert suite.
export default defineConfig({test: {
  environment: 'node', include: ['engine/experimental/action-journal.runtime-cases.ts'],
  pool: 'forks', fileParallelism: false, maxWorkers: 1, maxConcurrency: 1,
  testTimeout: 2000, hookTimeout: 5000, bail: 1,
}});
