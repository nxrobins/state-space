import { defineConfig } from 'vitest/config';
// Held physical continuation/restarts; excluded from selected edit/mock validation.
export default defineConfig({test: {
  environment: 'node', include: ['engine/experimental/translation-paths.runtime-cases.ts'],
  pool: 'forks', fileParallelism: false, maxWorkers: 1, maxConcurrency: 1,
  testTimeout: 2000, hookTimeout: 5000, bail: 1,
}});
