import { defineConfig } from 'vite';
export default defineConfig({build:{emptyOutDir:false,outDir:'dist/sdk',lib:{entry:'engine/experimental/tactical-session.ts',formats:['es'],fileName:()=> 'state-space-tactical-session.js'},minify:false}});
