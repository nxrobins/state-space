import { defineConfig } from 'vite';
/** Private native-Worker probe: the page driver and the module Worker it starts. */
export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: 'dist/multiphysics',
    lib: {
      entry: {
        probe: 'engine/experimental/multiphysics/worker-probe.ts',
        worker: 'engine/experimental/multiphysics/worker-entry.ts',
      },
      formats: ['es'],
      fileName: (_format, name) => `multiphysics-${name}.js`,
    },
    minify: false,
  },
});
