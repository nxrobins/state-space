/** End-to-end check of the actual public-SDK game controls and checkpoint UI. */
export async function verifyPlayableClient(){
 const api=window.structuralCavern,output=document.getElementById('report'),result={stage:'client',done:false,passed:false,checks:[]};
 const wait=async predicate=>{const end=performance.now()+10000;while(!predicate()){if(performance.now()>end)throw Error('Client UI did not settle');await new Promise(r=>setTimeout(r,20));}};
 const check=(value,text)=>{if(!value)throw Error(text);result.checks.push(text);};
 const click=async id=>{document.getElementById(id).click();await new Promise(r=>setTimeout(r,0));await wait(()=>!document.getElementById('step').disabled);};
 try{
  check(api.field.tick===0,'Starts paused at tick zero');
  await click('step');check(api.field.tick===1,'Step completes one tick');
  await click('remember');const remembered=await api.snapshot();check(!document.getElementById('resume').disabled,'Remember enables restore');
  await click('step');check(api.field.tick===2,'World advances after remember');
  await click('resume');check(JSON.stringify(await api.snapshot())===JSON.stringify(remembered),'UI restores exact world and actor');
  await click('cut');check(api.field.tick===2,'Cut action commits one tick');
  await click('inspect');check(document.getElementById('energy').textContent==='0 Q @ 2','Energy inspection shows zero drift');
  await click('appearance');await click('camera');check(api.field.tick===2,'Presentation controls preserve tick');
  await click('reset');check(api.field.tick===0&&document.getElementById('resume').disabled,'Reset clears checkpoint and returns to tick zero');
  check(document.getElementById('error').hidden,'No visible runtime error');
  result.backendInfo=api.field.backendInfo;result.passed=true;
 }catch(error){result.error=String(error.stack||error);}finally{result.done=true;result.progress=result.passed?'Playable client controls passed':result.error;output.textContent=JSON.stringify(result,null,2);}
}
