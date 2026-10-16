import { defineConfig } from 'vite';
export default defineConfig({build:{emptyOutDir:false,outDir:'dist/sdk',lib:{entry:'engine/experimental/structural-world.ts',formats:['es'],fileName:()=> 'state-space-structural-world.js'},minify:false}});
