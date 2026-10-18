import { defineConfig } from 'vitest/config';
// Held real-physics preview cases; never included by the edit/inert selector.
export default defineConfig({test: {
  environment: 'node', include: ['engine/experimental/tactical-previews.runtime-cases.ts'],
  pool: 'forks', fileParallelism: false, maxWorkers: 1, maxConcurrency: 1,
  testTimeout: 2000, hookTimeout: 5000, bail: 1,
}});
