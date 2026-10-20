import { defineConfig } from 'vitest/config';
import { boundedTests } from './vitest.shared.js';
// Held actual physics and actor continuation; excluded from edit/mock checks.
export default defineConfig({test: {...boundedTests, include: ['engine/experimental/terrain/terrain-motion.runtime-cases.ts']}});
