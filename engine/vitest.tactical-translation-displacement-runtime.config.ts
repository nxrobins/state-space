import { defineConfig } from 'vitest/config';
// Held physical actor continuation; not part of selected edit/mock verification.
export default defineConfig({test: {
  environment: 'node', include: ['engine/experimental/translation-displacement.runtime-cases.ts'],
  pool: 'forks', fileParallelism: false, maxWorkers: 1, maxConcurrency: 1,
  testTimeout: 2000, hookTimeout: 5000, bail: 1,
}});
