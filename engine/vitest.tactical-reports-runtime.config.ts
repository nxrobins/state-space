import { defineConfig } from 'vitest/config';
// Held runtime gate. Do not include in the authorized edit/mock verification.
export default defineConfig({test: {
  environment: 'node', include: ['engine/experimental/change-reports.runtime-cases.ts'],
  pool: 'forks', fileParallelism: false, maxWorkers: 1, maxConcurrency: 1,
  testTimeout: 2000, hookTimeout: 5000, bail: 1,
}});
