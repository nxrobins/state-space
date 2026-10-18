import { defineConfig } from 'vite';
export default defineConfig({build: {emptyOutDir: false, outDir: 'dist/sdk', lib: {entry: 'engine/experimental/tactical-renderer.ts', formats: ['es'], fileName: () => 'state-space-tactical-renderer.js'}, minify: false}});
