import { defineConfig } from 'vite';
export default defineConfig({build:{emptyOutDir:false,outDir:'dist/sdk',lib:{entry:'engine/experimental/active-world.ts',formats:['es'],fileName:()=> 'state-space-active-world.js'},minify:false}});
