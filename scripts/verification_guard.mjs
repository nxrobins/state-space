import {spawn} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
/** All entry points share one OS lease and one bounded descendant process tree. */
export async function guardNode(kind,timeout=600){
  const hold=new URL('../dist/verification/safety-hold.json',import.meta.url);
  if(existsSync(hold)){
    const state=JSON.parse(readFileSync(hold,'utf8'));
    if(!state||typeof state!=='object'||Array.isArray(state)||Object.hasOwn(state,'blockRecovery')&&state.blockRecovery!==false)throw Error('Runtime verification remains blocked pending incident review');
  }
  if(process.env.STATE_SPACE_VERIFICATION_JOB)return;
  const localPython=process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python';
  const python=process.env.STATE_SPACE_PYTHON??(existsSync(localPython)?resolve(localPython):'python');
  const child=spawn(python,['-m','scripts.verification_guard','--kind',kind,'--timeout',String(timeout),'--',process.execPath,...process.argv.slice(1)],{stdio:'inherit',windowsHide:true});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
  process.exit(code);
}
export const verificationYield=()=>new Promise(resolve=>setTimeout(resolve,Number(process.env.STATE_SPACE_VERIFY_YIELD_MS??5)));
