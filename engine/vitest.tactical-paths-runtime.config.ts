import { defineConfig } from 'vitest/config';
// Held physical path verification; excluded from every edit/mock suite.
export default defineConfig({test: {
  environment: 'node', include: ['engine/experimental/motion-paths.runtime-cases.ts'],
  pool: 'forks', fileParallelism: false, maxWorkers: 1, maxConcurrency: 1,
  testTimeout: 2000, hookTimeout: 5000, bail: 1,
}});
