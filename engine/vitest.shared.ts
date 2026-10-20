import { fileURLToPath } from 'node:url';

export const boundedTests = {
  environment: 'node', pool: 'forks', fileParallelism: false,
  maxWorkers: 1, maxConcurrency: 1, testTimeout: 2000, hookTimeout: 5000, bail: 1,
} as const;

// Unit fixtures and SDK-backed examples must share private geometry/scene identities.
// Installed-package integration is verified separately.
export const sourceAliases = [
  {find: /^state-space-engine\/experimental\/3d\/tactical-renderer$/, replacement: fileURLToPath(new URL('./experimental/tactical-renderer.ts', import.meta.url))},
  {find: /^state-space-engine\/experimental\/3d\/tactical-session$/, replacement: fileURLToPath(new URL('./experimental/tactical-session.ts', import.meta.url))},
  {find: /^state-space-engine\/experimental\/3d\/structural-world$/, replacement: fileURLToPath(new URL('./experimental/structural-world.ts', import.meta.url))},
];
