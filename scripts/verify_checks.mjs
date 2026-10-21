import {spawn} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {guardNode} from './verification_guard.mjs';
export const VITEST='node_modules/vitest/vitest.mjs';
// The supervisor stops a child that prints nothing for 40 seconds. Vitest's default
// reporter is silent until the run ends when stdout is a pipe, so every supervised
// vitest check streams one dot per completed test instead.
export const STREAMING_REPORTER='--reporter=dot';
const nativeFiles=['engine/conformance.test.ts','engine/structure.test.ts','engine/sdk.test.ts'];
const vitest=(...args)=>[VITEST,'run',STREAMING_REPORTER,...args];
/** Select the sequential checks, supervisor kind and timeout for one suite. */
export function selectChecks(suite,argv=process.argv,env=process.env){
  let checks;
  if(suite==='smoke'){
    checks=[
      vitest('--config','engine/vitest.smoke.config.ts'),
      ['--test','--test-concurrency=1','examples/lab/lab.test.mjs','examples/sdk/3d-smoke-probes.test.mjs','tests/verification-events.test.mjs'],
    ];
  }else if(suite==='unit'){
    checks=[
      vitest('--config','engine/vitest.cpu.config.ts'),
      ['--test','--test-concurrency=1','tests/build-tooling.test.mjs','web/rendering.test.mjs','examples/first-person/game.test.mjs','examples/cavern/game.test.mjs','examples/active-cavern/game.test.mjs'],
    ];
  }else if(suite==='native'){
    const file=argv[argv.indexOf('--file')+1];
    if(!nativeFiles.includes(file))throw Error(`Choose one native fixture with --file: ${nativeFiles.join(', ')}`);
    checks=[vitest(file,'--config','engine/vitest.config.ts')];
  }else if(suite==='demos'){
    if(env.STATE_SPACE_RUN_LEGACY_DEMOS!=='isolated-host')throw Error('Legacy 256x256 demo trajectories are quarantined after a host freeze. No demo workload was launched.');
    checks=[['--test','--test-concurrency=1','web/demo-trajectory.test.mjs']];
  }else throw Error('Unknown verification suite. Choose smoke, unit, native, or demos.');
  return {checks,kind:suite==='native'?'gpu':'cpu',timeout:suite==='smoke'?30:120};
}
// Node resolves the entry module through symlinks; compare real paths so an
// invocation through a linked checkout still runs instead of exiting silently.
if(process.argv[1]&&fileURLToPath(import.meta.url)===realpathSync(resolve(process.argv[1]))){
  const suiteIndex=process.argv.indexOf('--suite');
  const suite=suiteIndex<0?'unit':process.argv[suiteIndex+1];
  const {checks,kind,timeout}=selectChecks(suite);
  await guardNode(kind,timeout);
  console.log(`Verification scope: ${suite}. Native fixtures and legacy demo trajectories are separate gates.`);
  for(const args of checks){
    console.log(`Sequential check: node ${args.join(' ')}`);
    const child=spawn(process.execPath,args,{stdio:'inherit',windowsHide:true});
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
    if(code)process.exit(code);
  }
}
