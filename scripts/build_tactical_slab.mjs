// Compile only. Never creates a browser, Worker, GPU device or physics tick.
import {build} from 'esbuild';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function buildTacticalSlab() {
  const outdir=resolve('dist/tactical-slab');await mkdir(outdir,{recursive:true});
  const result=await build({entryPoints:{app:'examples/tactical-slab/browser-entry.ts',worker:'examples/tactical-slab/worker-entry.ts'},outdir,bundle:true,platform:'browser',format:'esm',target:'es2022',metafile:true,logLevel:'silent'});
  for(const name of ['index.html','style.css'])await copyFile(resolve('examples/tactical-slab',name),resolve(outdir,name));
  await writeFile(resolve(outdir,'bundle-inputs.json'),JSON.stringify(result.metafile,null,2)+'\n');
  return {outdir,inputs:Object.keys(result.metafile.inputs),outputs:Object.keys(result.metafile.outputs)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(await buildTacticalSlab()));
