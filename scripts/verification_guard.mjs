import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
/** All entry points share one OS lease and one bounded descendant process tree. */
export async function guardNode(kind,timeout=600){
  if(process.env.STATE_SPACE_VERIFICATION_JOB)return;
  const python=process.env.STATE_SPACE_PYTHON??(existsSync('.venv/Scripts/python.exe')?resolve('.venv/Scripts/python.exe'):'python');
  const child=spawn(python,['-m','scripts.verification_guard','--kind',kind,'--timeout',String(timeout),'--',process.execPath,...process.argv.slice(1)],{stdio:'inherit',windowsHide:true});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
  process.exit(code);
}
export const verificationYield=()=>new Promise(resolve=>setTimeout(resolve,Number(process.env.STATE_SPACE_VERIFY_YIELD_MS??5)));
