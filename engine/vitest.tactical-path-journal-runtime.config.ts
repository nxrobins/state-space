import { defineConfig } from 'vitest/config';
import { boundedTests } from './vitest.shared.js';
// Held physical path journal cases; never selected by edit/mock checks.
export default defineConfig({
  test: { ...boundedTests, include: ['engine/experimental/path-journal.runtime-cases.ts'] },
});
