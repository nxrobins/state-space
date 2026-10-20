import { defineConfig } from 'vitest/config';
import { boundedTests } from './vitest.shared.js';
// Held real-physics preview cases; never included by the edit/inert selector.
export default defineConfig({test: {...boundedTests, include: ['engine/experimental/tactical/tactical-previews.runtime-cases.ts']}});
