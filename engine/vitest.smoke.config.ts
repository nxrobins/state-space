import { defineConfig } from 'vitest/config';
import { boundedTests } from './vitest.shared.js';
// Small CPU fixtures for a first local run. GPU parity and scale are separate gates.
export default defineConfig({test: {...boundedTests, include: [
  'engine/contracts.test.ts',
  'engine/validation.test.ts',
  'engine/pressure.test.ts',
  'engine/experimental/lighting-cache.test.ts',
  'engine/experimental/3d.test.ts',
  'engine/experimental/structural-world.test.ts',
]}});
