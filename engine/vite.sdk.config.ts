import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: resolve('dist/sdk'),
    emptyOutDir: true,
    minify: false,
    lib: { entry: resolve('engine/index.ts'), formats: ['es'], fileName: () => 'state-space.js' },
  },
});
