import { defineConfig } from 'vitest/config';
import { boundedTests } from './vitest.shared.js';
// Held physics/replay gate. Never included in the edit/mock selection.
export default defineConfig({
  test: { ...boundedTests, include: ['engine/experimental/motion-trace.runtime-cases.ts'] },
});
