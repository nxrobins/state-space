import { defineConfig } from 'vitest/config';
import { boundedTests } from './vitest.shared.js';
// Held physical continuation/restarts; excluded from selected edit/mock validation.
export default defineConfig({test: {...boundedTests, include: ['engine/experimental/translation-paths.runtime-cases.ts']}});
