import fs from 'node:fs';
import { build } from 'vite';
const directory = 'dist/performance/pacing-probe';
const mark = label => `globalThis.__tickMarks?.push(['${label}', performance.now()]); performance.mark('stage:${label}');`;
await build({ configFile: false, plugins: [{ name: 'profile-stages', enforce: 'pre', transform(code, id) {
  if (!id.endsWith('/engine/webgpu_field.ts')) return;
  const edits = [
    ['const structuralPlan =', mark('planned') + 'const structuralPlan ='],
    ['let encoder = this.#device.createCommandEncoder();', mark('uploaded') + 'let encoder = this.#device.createCommandEncoder();'],
    ['const mapping = this.#staging.mapAsync(GPUMapMode.READ);', mark('submitted') + 'const mapping = this.#staging.mapAsync(GPUMapMode.READ); mapping.then(()=>{' + mark('mapped') + '},()=>{});'],
    ["if (this.#staging.mapState === 'mapped') this.#staging.unmap();", "if (this.#staging.mapState === 'mapped') this.#staging.unmap();" + mark('copied')],
    ['before = validateOwnedStructure(before, this.width, this.height, this.registry);', 'before = validateOwnedStructure(before, this.width, this.height, this.registry);' + mark('validated')],
    ['scopeOpen = false; return result;', 'scopeOpen = false; result.then(()=>{' + mark('scope') + '},()=>{}); return result;'],
  ];
  for (const [from,to] of edits) { if (!code.includes(from)) throw Error(from); code=code.replace(from,to); }
  return code;
} }], build: { target:'es2022', outDir:directory+'/sdk', emptyOutDir:true, minify:false,
  lib:{entry:'engine/index.ts',formats:['es'],fileName:()=> 'state-space.js'} } });
let frames=fs.readFileSync('web/frame-benchmark.js','utf8')
  .replace('../dist/sdk/state-space.js','./sdk/state-space.js')
  .replace("'./renderer.js'", "'./profile-renderer.js'")
  .replaceAll("'./demo.js'", "'/web/demo.js'")
  .replaceAll("'./frame-clock.js'", "'/web/frame-clock.js'")
  .replaceAll("'./frame-pump.js'", "'/web/frame-pump.js'")
  .replaceAll('await world.step(', 'await tracedStep(world,');
frames += `\nasync function tracedStep(world, ticks) {
  const stages = [['start', performance.now()]]; globalThis.__tickMarks = stages; performance.mark('stage:start');
  await world.step(ticks);
  stages.push(['step-end', performance.now()]);
  globalThis.stageTraces.push({label:globalThis.profileLabel,tick:world.tick,stages});
}\n`;
fs.writeFileSync(directory+'/stages-benchmark.js',frames);
let renderer=fs.readFileSync('web/renderer.js','utf8').replace("'./shaders.js'", "'/web/shaders.js'");
renderer=renderer.replace('const encoder = device.createCommandEncoder();',mark('render-uploaded')+'const encoder = device.createCommandEncoder();')
  .replace('device.queue.submit([encoder.finish()]);','device.queue.submit([encoder.finish()]);'+mark('render-submitted'))
  .replace('await device.queue.onSubmittedWorkDone();','await device.queue.onSubmittedWorkDone();'+mark('render-completed'));
fs.writeFileSync(directory+'/profile-renderer.js',renderer);
