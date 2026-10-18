/** One owned Chromium process and one persistent CDP connection per stage.
 * This helper is inert on import. It never attaches to an existing user browser.
 */
import {spawn} from 'node:child_process';
import {readFile, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, relative, isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

const MAX_BYTES=32*1024*1024;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

export async function withDeadline(promise,ms,label){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(Error(label)),ms);
 })]);}finally{clearTimeout(timer);}
}

export function validateRequest(value, expected) {
 if(!value||value.id!==expected||!Number.isSafeInteger(value.id)||!['open','eval','errors','screenshot','close'].includes(value.method))throw Error('Invalid browser request');
 if(!value.params||typeof value.params!=='object'||Array.isArray(value.params))throw Error('Invalid browser parameters');
 return value;
}

export class Connection {
 constructor(socket){
  this.socket=socket;this.next=0;this.pending=new Map();this.errors=[];this.errorBytes=0;this.fault=null;
  socket.addEventListener('message',event=>{
   try{
    if(typeof event.data!=='string'||Buffer.byteLength(event.data)>MAX_BYTES)throw Error('Oversized CDP message');
    const message=JSON.parse(event.data);
    if(Object.hasOwn(message,'id')){
     const item=this.pending.get(message.id);if(!Number.isSafeInteger(message.id)||!item)throw Error('Unexpected CDP response ID');
     this.pending.delete(message.id);clearTimeout(item.timer);
     if(message.error)item.reject(Error(JSON.stringify(message.error)));else item.resolve(message.result);
    }else if(message.method==='Runtime.exceptionThrown'){
     this.recordError(message.params.exceptionDetails);
    }else if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error'){
     this.recordError({consoleError:message.params.args});
    }else if(message.method==='Inspector.targetCrashed')throw Error('Browser target crashed');
   }catch(error){this.fail(error);}
  });
  socket.addEventListener('close',()=>this.fail(Error('CDP connection closed')));
  socket.addEventListener('error',()=>this.fail(Error('CDP transport failed')));
 }
 recordError(value){
  const bytes=Buffer.byteLength(JSON.stringify(value));
  if(this.errors.length>=100||this.errorBytes+bytes>1024*1024)throw Error('Browser error buffer overflow');
  this.errorBytes+=bytes;this.errors.push(value);
 }
 fail(error){this.fault??=error;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(this.fault);}this.pending.clear();this.onFailure?.(this.fault);}
 call(method,params={},sessionId){
  if(this.fault)return Promise.reject(this.fault);
  if(this.pending.size>=8)return Promise.reject(Error('CDP request bound exceeded'));
  return new Promise((resolve,reject)=>{
   const id=++this.next,timer=setTimeout(()=>this.fail(Error('CDP operation deadline: '+method)),10000);
   this.pending.set(id,{resolve,reject,timer});
   try{this.socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));}catch(error){this.fail(error);}
  });
 }
}

export async function main(){
 const root=resolve(import.meta.dirname,'..');
 // A forged/inherited job environment must not bypass an incident hold.
 try{
  const hold=JSON.parse(await readFile(join(root,'dist/verification/safety-hold.json'),'utf8'));
  if(!hold||typeof hold!=='object'||Array.isArray(hold)||Object.hasOwn(hold,'blockRecovery')&&hold.blockRecovery!==false)throw Error('Runtime verification remains blocked pending review');
 }catch(error){if(error.code!=='ENOENT')throw error;}
 if(process.platform!=='win32'||!/^([0-9a-f]{32})$/.test(process.env.STATE_SPACE_VERIFICATION_JOB??''))throw Error('Persistent browser requires the Windows verification supervisor');
 if(typeof WebSocket!=='function')throw Error('Persistent browser requires Node 22 or newer');
 const executable=process.argv[2],output=resolve(process.argv[3]??'');
 if(!executable||!isAbsolute(executable)||!process.argv[3])throw Error('Explicit browser executable and output directory required');
 const browserPath=await realpath(executable),temporaryRoot=await realpath(tmpdir());
 const profile=await mkdtemp(join(temporaryRoot,'state-space-verification-'));
 let browser,cdp,sessionId,closing=false,shutdownPromise;
 async function shutdown(){
  if(shutdownPromise)return shutdownPromise;
  shutdownPromise=(async()=>{
   closing=true;
   // Closing CDP is expected here; it must not reject the command loop before
   // the close acknowledgement has been sent to Python.
   if(cdp)cdp.onFailure=undefined;
   if(cdp&&!cdp.fault)await withDeadline(cdp.call('Browser.close'),1000,'Browser close deadline').catch(()=>{});
   cdp?.fail(Error('Browser closing'));cdp?.socket.close();
   if(browser&&browser.exitCode===null&&browser.signalCode===null){
    await withDeadline(new Promise(r=>browser.once('exit',r)),250,'Graceful browser exit deadline').catch(()=>{});
    if(browser.exitCode===null&&browser.signalCode===null){
     browser.kill();await withDeadline(new Promise(r=>browser.once('exit',r)),500,'Browser exit deadline');
     if(browser.exitCode===null&&browser.signalCode===null)throw Error('Owned browser did not exit');
    }
   }
   // Remove only the fresh profile created above, never a user's browser data.
   const childPath=relative(temporaryRoot,profile);
   if(!childPath.startsWith('state-space-verification-')||childPath.includes('..')||isAbsolute(childPath))throw Error('Unsafe profile cleanup target');
   await withDeadline(rm(profile,{recursive:true,force:true,maxRetries:0}),1000,'Temporary profile cleanup deadline');
  })();return shutdownPromise;
 }
 try{
  browser=spawn(browserPath,['--headless=new','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',
   '--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','--enable-unsafe-webgpu',
   '--window-size=1920,1080','about:blank'],{stdio:'ignore',windowsHide:true});
  let launchError;browser.on('error',error=>{launchError=error;cdp?.fail(error);});
  browser.on('exit',()=>{if(!closing)cdp?.fail(Error('Owned browser exited'));});
  const deadline=Date.now()+12000;let port,path;
  while(Date.now()<deadline){
   if(launchError)throw launchError;
   if(browser.exitCode!==null||browser.signalCode!==null)throw Error('Browser exited before CDP startup');
   try{[port,path]=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);break;}
   catch(error){if(error.code!=='ENOENT')throw error;await sleep(50);}
  }
  if(!/^\d{1,5}$/.test(port??'')||Number(port)>65535||!/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(path??''))throw Error('Browser startup deadline or invalid endpoint');
  const socket=new WebSocket(`ws://127.0.0.1:${port}${path}`);
  cdp=new Connection(socket);
  await new Promise((resolve,reject)=>{
   cdp.onFailure=reject;if(cdp.fault){reject(cdp.fault);return;}
   const timer=setTimeout(()=>reject(Error('CDP connect timeout')),2000);
   socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
   socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('CDP connect failed'));},{once:true});
  });
  const {targetId}=await cdp.call('Target.createTarget',{url:'about:blank'});
  ({sessionId}=await cdp.call('Target.attachToTarget',{targetId,flatten:true}));
  for(const method of ['Runtime.enable','Page.enable','Inspector.enable'])await cdp.call(method,{},sessionId);
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false},sessionId);
  const version=await cdp.call('Browser.getVersion');
  await send({id:0,result:{transport:'persistent-cdp',version,pid:browser.pid,viewport:[1920,1080],headless:true}});
  let expected=1,busy=false,buffer='';
  async function evaluate(expression){
   if(typeof expression!=='string'||expression.length>65536)throw Error('Invalid evaluation');
   const result=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);
   if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
   return result.result.value??null;
  }
  async function handle(request){
   const {method,params}=validateRequest(request,expected++);
   if(cdp.fault)throw cdp.fault;
   if(method==='eval')return evaluate(params.expression);
   if(method==='errors')return cdp.errors;
   if(method==='screenshot'){
    const {data}=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);
    await writeFile(join(output,'view.png'),Buffer.from(data,'base64'));return {path:'view.png'};
   }
   if(method==='open'){
    const url=new URL(params.url);
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')throw Error('Verification navigation must stay on loopback');
    const navigation=await cdp.call('Page.navigate',{url:url.href},sessionId);
    if(navigation.errorText)throw Error(navigation.errorText);
    const until=Date.now()+10000;
    while(Date.now()<until){
     if(await evaluate(`location.href===${JSON.stringify(url.href)}&&document.readyState==='complete'`))return {url:url.href};
     await sleep(50);
    }throw Error('Navigation deadline');
   }
   await shutdown();return {closed:true};
  }
  process.stdin.setEncoding('utf8');
  await new Promise((resolve,reject)=>{
   cdp.onFailure=reject;if(cdp.fault){reject(cdp.fault);return;}
   process.stdin.on('data',chunk=>{
    buffer+=chunk;
    if(Buffer.byteLength(buffer)>1024*1024){reject(Error('Browser request buffer overflow'));return;}
    const end=buffer.indexOf('\n');if(end<0)return;
    if(busy||buffer.indexOf('\n',end+1)>=0){reject(Error('Only one browser request may be outstanding'));return;}
    const line=buffer.slice(0,end);buffer=buffer.slice(end+1);busy=true;
    void(async()=>{
     let request;
     try{request=JSON.parse(line);const result=await handle(request);await send({id:request.id,result});busy=false;if(closing)resolve();}
     catch(error){try{await send({id:request?.id??-1,error:String(error.stack??error)});}catch{}finally{reject(error);}}
    })();
   });
   process.stdin.on('end',()=>reject(Error('Browser command pipe closed before explicit shutdown')));process.stdin.on('error',reject);
  });
 }finally{if(cdp)cdp.onFailure=undefined;process.stdin.destroy();await shutdown();}
}

async function send(value){
 const text=JSON.stringify(value)+'\n';
 if(Buffer.byteLength(text)>MAX_BYTES)throw Error('Browser response exceeds transport bound');
 if(!process.stdout.write(text))await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{process.stdout.off('drain',done);reject(Error('Browser response pipe stalled'));},3000);
  function done(){clearTimeout(timer);resolve();}process.stdout.once('drain',done);
 });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 main().catch(error=>{process.stderr.write(String(error.stack??error)+'\n');process.exitCode=1;});
}
