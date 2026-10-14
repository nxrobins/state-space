import {spawn} from 'node:child_process';
import {guardNode} from './verification_guard.mjs';
await guardNode('gpu',900);
for(const args of [
  ['node_modules/vitest/vitest.mjs','run','--config','engine/vitest.config.ts'],
  ['--test','--test-concurrency=1','web/rendering.test.mjs','examples/first-person/game.test.mjs','examples/cavern/game.test.mjs'],
]){
  console.log(`Sequential check: node ${args.join(' ')}`);
  const child=spawn(process.execPath,args,{stdio:'inherit',windowsHide:true});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
  if(code)process.exit(code);
}
