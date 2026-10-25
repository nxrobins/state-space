import { defineConfig } from 'vitest/config';
import { boundedTests } from './vitest.shared.js';
// Held physical acceptance only. No aggregate or selected CPU gate includes this.
export default defineConfig({
  test: {
    ...boundedTests,
    include: ['engine/experimental/tactical/tactical-slab.runtime-cases.ts'],
  },
});
