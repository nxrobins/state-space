import { defineConfig } from 'vitest/config';
import { boundedTests } from './vitest.shared.js';

export default defineConfig({
  test: {
    ...boundedTests,
    include: [
      'engine/experimental/multiphysics/fluids.test.ts',
      'engine/experimental/multiphysics/fluids-coordinate.test.ts',
      'engine/experimental/multiphysics/fluid-optimization.runtime-cases.ts',
    ],
    testTimeout: 10000,
  },
});
