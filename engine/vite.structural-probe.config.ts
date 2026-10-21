import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: 'dist/volume-m5',
    lib: {
      entry: 'engine/experimental/structural-probe.ts',
      formats: ['es'],
      fileName: () => 'structural-probe.js',
    },
    minify: false,
  },
});
