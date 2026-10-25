import { defineConfig } from 'vitest/config';
import { sourceAliases } from './vitest.shared.js';
export default defineConfig({
  resolve: { alias: sourceAliases },
  test: {
    environment: 'node',
    include: ['engine/experimental/multiphysics/fluid-qualification.runtime-cases.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30000,
  },
});
