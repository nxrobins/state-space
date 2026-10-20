import { defineConfig } from 'vitest/config';
import { boundedTests } from './vitest.shared.js';
// Held physical journal gate; never selected by the edit/inert suite.
export default defineConfig({test: {...boundedTests, include: ['engine/experimental/action-journal.runtime-cases.ts']}});
