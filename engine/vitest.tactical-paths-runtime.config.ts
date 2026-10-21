import { defineConfig } from 'vitest/config';
import { boundedTests } from './vitest.shared.js';
// Held physical path verification; excluded from every edit/mock suite.
export default defineConfig({
  test: { ...boundedTests, include: ['engine/experimental/motion-paths.runtime-cases.ts'] },
});
