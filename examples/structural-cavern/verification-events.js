/** Verification-only transport. Runtime clients do not install this journal. */
export function installVerificationJournal(url) {
 const queue=[];let next=0,active=false,fault,waiters=[];
 function fail(error){
  fault??=error;for(const item of queue)item.reject(fault);queue.length=0;
  for(const w of waiters)w.reject(fault);waiters=[];return fault;
 }
 async function pump(){
  if(active||fault)return;active=true;
  try{
   while(queue.length){
    const item=queue[0],response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({sequence:item.sequence,event:item.event}),signal:AbortSignal.timeout(4000)});
    if(!response.ok)throw Error(`Verification journal rejected event: ${response.status}`);
    const ack=await response.json();if(ack.sequence!==item.sequence||!/^[0-9a-f]{64}$/.test(ack.sha256))throw Error('Invalid durable acknowledgement');
    if(fault)throw fault;
    queue.shift();item.resolve(ack);
   }
   for(const w of waiters)w.resolve();waiters=[];
  }catch(error){
   fail(error);
  }finally{active=false;}
 }
 const api={
  emit(event){
   if(fault)return Promise.reject(fault);
   if(queue.length>=64)return Promise.reject(fail(Error('Verification journal queue is full')));
   return new Promise((resolve,reject)=>{queue.push({sequence:++next,event,resolve,reject});void pump();});
  },
  flush(){if(fault)return Promise.reject(fault);if(!queue.length)return Promise.resolve();return new Promise((resolve,reject)=>waiters.push({resolve,reject}));},
  check(){if(fault)throw fault;},
 };
 window.__stateSpaceVerification=api;return api;
}

export async function verificationEvent(event){
 const journal=globalThis.__stateSpaceVerification;
 if(!journal)throw Error('Replay verification requires a durable journal');
 return journal.emit(event);
}
