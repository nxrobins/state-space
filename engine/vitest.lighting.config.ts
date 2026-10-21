import { defineConfig } from 'vitest/config';
import { boundedTests } from './vitest.shared.js';
// Proposed non-GPU stage only. Runtime authorization/containment is external;
// this config grants no recovery permit and must not be used to bypass the hold.
export default defineConfig({
  test: {
    ...boundedTests,
    include: [
      'engine/experimental/lighting-cache.test.ts',
      'engine/experimental/cavern-appearance.test.ts',
      'engine/experimental/structural-client.test.ts',
    ],
  },
});
