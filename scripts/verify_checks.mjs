import {spawn} from 'node:child_process';
import {guardNode} from './verification_guard.mjs';
const suiteIndex=process.argv.indexOf('--suite');
const suite=suiteIndex<0?'unit':process.argv[suiteIndex+1];
const nativeFiles=['engine/conformance.test.ts','engine/structure.test.ts','engine/sdk.test.ts'];
let checks;
if(suite==='smoke'){
  checks=[
    ['node_modules/vitest/vitest.mjs','run','--config','engine/vitest.smoke.config.ts'],
    ['--test','--test-concurrency=1','examples/lab/lab.test.mjs','examples/sdk/3d-smoke-probes.test.mjs','tests/verification-events.test.mjs'],
  ];
}else if(suite==='unit'){
  checks=[
    ['node_modules/vitest/vitest.mjs','run','--config','engine/vitest.cpu.config.ts'],
    ['--test','--test-concurrency=1','tests/build-tooling.test.mjs','web/rendering.test.mjs','examples/first-person/game.test.mjs','examples/cavern/game.test.mjs','examples/active-cavern/game.test.mjs'],
  ];
}else if(suite==='native'){
  const file=process.argv[process.argv.indexOf('--file')+1];
  if(!nativeFiles.includes(file))throw Error(`Choose one native fixture with --file: ${nativeFiles.join(', ')}`);
  checks=[['node_modules/vitest/vitest.mjs','run',file,'--config','engine/vitest.config.ts']];
}else if(suite==='demos'){
  if(process.env.STATE_SPACE_RUN_LEGACY_DEMOS!=='isolated-host')throw Error('Legacy 256x256 demo trajectories are quarantined after a host freeze. No demo workload was launched.');
  checks=[['--test','--test-concurrency=1','web/demo-trajectory.test.mjs']];
}else throw Error('Unknown verification suite. Choose smoke, unit, native, or demos.');
await guardNode(suite==='native'?'gpu':'cpu',suite==='smoke'?30:120);
console.log(`Verification scope: ${suite}. Native fixtures and legacy demo trajectories are separate gates.`);
for(const args of checks){
  console.log(`Sequential check: node ${args.join(' ')}`);
  const child=spawn(process.execPath,args,{stdio:'inherit',windowsHide:true});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
  if(code)process.exit(code);
}
