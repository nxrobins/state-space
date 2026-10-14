import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({ build: { target: 'es2022', outDir: resolve('dist/sdk'), emptyOutDir: false, minify: false,
  lib: { entry: resolve('engine/experimental/world.ts'), formats: ['es'], fileName: () => 'state-space-world.js' } } });
