import { defineConfig } from 'vitest/config';
// Held physical group continuation; excluded from selected edit/mock verification.
export default defineConfig({test: {
  environment: 'node', include: ['engine/experimental/terrain-body-group.runtime-cases.ts'],
  pool: 'forks', fileParallelism: false, maxWorkers: 1, maxConcurrency: 1,
  testTimeout: 2000, hookTimeout: 5000, bail: 1,
}});
