import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['engine/**/*.test.ts'],
    // Native fixtures create GPU contexts. Never compile/run them concurrently.
    fileParallelism: false,
    maxWorkers: 1,
  },
});
