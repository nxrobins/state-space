import { defineConfig } from 'vite';
export default defineConfig({build:{emptyOutDir:false,outDir:'dist/sdk',lib:{entry:'engine/experimental/interventions.ts',formats:['es'],fileName:()=> 'state-space-interventions.js'},minify:false}});
