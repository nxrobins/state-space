import { defineConfig } from 'vitest/config';
import { boundedTests } from './vitest.shared.js';
// Held physical acceptance only; no selected CPU gate includes this file.
export default defineConfig({test: {...boundedTests, include: ['engine/experimental/material-transport-coupling.runtime-cases.ts']}});
