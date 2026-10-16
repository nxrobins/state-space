import { defineConfig } from 'vite';
export default defineConfig({build:{emptyOutDir:false,outDir:'dist/sdk',lib:{entry:'engine/experimental/structural-world-gpu.ts',formats:['es'],fileName:()=> 'state-space-structural-world-gpu.js'},minify:false}});
