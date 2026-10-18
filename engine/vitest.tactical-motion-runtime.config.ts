import { defineConfig } from 'vitest/config';
// Held physics/replay gate. Never included in the edit/mock selection.
export default defineConfig({test: {
  environment: 'node', include: ['engine/experimental/motion-trace.runtime-cases.ts'],
  pool: 'forks', fileParallelism: false, maxWorkers: 1, maxConcurrency: 1,
  testTimeout: 2000, hookTimeout: 5000, bail: 1,
}});
