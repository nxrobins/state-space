import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Native parity fixtures have their own explicit, single-file entry point.
export default defineConfig({
  // Unit fixtures and SDK-backed examples must share private geometry/scene
  // identities. Built-package integration is verified separately after install.
  resolve: {alias: [
    {find: /^state-space-engine\/experimental\/3d\/tactical-renderer$/, replacement: fileURLToPath(new URL('./experimental/tactical-renderer.ts', import.meta.url))},
    {find: /^state-space-engine\/experimental\/3d\/tactical-session$/, replacement: fileURLToPath(new URL('./experimental/tactical-session.ts', import.meta.url))},
    {find: /^state-space-engine\/experimental\/3d\/structural-world$/, replacement: fileURLToPath(new URL('./experimental/structural-world.ts', import.meta.url))},
  ]},
  test: {
    environment: 'node',
    include: ['engine/**/*.test.ts'],
    exclude: ['engine/conformance.test.ts', 'engine/structure.test.ts', 'engine/sdk.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 10000,
  },
});
