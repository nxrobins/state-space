import { defineConfig } from 'vitest/config';
import { boundedTests } from './vitest.shared.js';
// Held physical pushes/restarts; never part of selected edit/mock validation.
export default defineConfig({test: {...boundedTests, include: ['engine/experimental/terrain-displacement.runtime-cases.ts']}});
