import { defineConfig } from 'vitest/config';
import { boundedTests } from './vitest.shared.js';
// Held physical actor continuation; not part of selected edit/mock verification.
export default defineConfig({
  test: {
    ...boundedTests,
    include: ['engine/experimental/gameplay/translation-displacement.runtime-cases.ts'],
  },
});
