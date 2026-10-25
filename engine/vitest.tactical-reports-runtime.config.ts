import { defineConfig } from 'vitest/config';
import { boundedTests } from './vitest.shared.js';
// Held runtime gate. Do not include in the authorized edit/mock verification.
export default defineConfig({
  test: {
    ...boundedTests,
    include: ['engine/experimental/gameplay/change-reports.runtime-cases.ts'],
  },
});
