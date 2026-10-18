import { defineConfig } from 'vite';
export default defineConfig({build:{emptyOutDir:false,outDir:'dist/sdk',lib:{entry:'engine/experimental/reactive-materials.ts',formats:['es'],fileName:()=> 'state-space-reactive-materials.js'},minify:false}});
