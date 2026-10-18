import { defineConfig } from 'vitest/config';
// Held actual physics and actor continuation; excluded from edit/mock checks.
export default defineConfig({test: {
  environment: 'node', include: ['engine/experimental/terrain-motion.runtime-cases.ts'],
  pool: 'forks', fileParallelism: false, maxWorkers: 1, maxConcurrency: 1,
  testTimeout: 2000, hookTimeout: 5000, bail: 1,
}});
