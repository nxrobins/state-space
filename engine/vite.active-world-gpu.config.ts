import { defineConfig } from 'vite';
export default defineConfig({build:{emptyOutDir:false,outDir:'dist/sdk',lib:{entry:'engine/experimental/active-world-gpu.ts',formats:['es'],fileName:()=> 'state-space-active-world-gpu.js'},minify:false}});
