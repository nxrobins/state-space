import { defineConfig } from 'vitest/config';

// Small CPU fixtures for a first local run. GPU parity and scale are separate gates.
export default defineConfig({test: {
  environment: 'node',
  include: ['engine/contracts.test.ts', 'engine/validation.test.ts', 'engine/pressure.test.ts',
    'engine/experimental/3d.test.ts', 'engine/experimental/structural-world.test.ts'],
  pool: 'forks', fileParallelism: false, maxWorkers: 1, maxConcurrency: 1,
  testTimeout: 2000, hookTimeout: 5000, bail: 1,
}});
