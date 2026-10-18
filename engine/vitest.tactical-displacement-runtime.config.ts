import { defineConfig } from 'vitest/config';
// Held physical pushes/restarts; never part of selected edit/mock validation.
export default defineConfig({test: {
  environment: 'node', include: ['engine/experimental/terrain-displacement.runtime-cases.ts'],
  pool: 'forks', fileParallelism: false, maxWorkers: 1, maxConcurrency: 1,
  testTimeout: 2000, hookTimeout: 5000, bail: 1,
}});
