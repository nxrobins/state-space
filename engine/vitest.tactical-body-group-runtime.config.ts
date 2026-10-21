import { defineConfig } from 'vitest/config';
import { boundedTests } from './vitest.shared.js';
// Held physical group continuation; excluded from selected edit/mock verification.
export default defineConfig({
  test: {
    ...boundedTests,
    include: ['engine/experimental/terrain/terrain-body-group.runtime-cases.ts'],
  },
});
