import { defineConfig } from 'vitest/config';
import { boundedTests } from './vitest.shared.js';

// Explicit CPU study, excluded from ordinary unit selection. Use the supervised
// scripts/profile_coupled_solver.mjs entry point after incident review.
export default defineConfig({
  test: {
    ...boundedTests,
    include: ['engine/experimental/multiphysics/fluid-solver-study.runtime-cases.ts'],
    testTimeout: 10000,
  },
});
