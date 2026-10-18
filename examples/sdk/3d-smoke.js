import { materialPasses, materialContinuation, structural } from './3d-smoke-probes.js';
const status=document.getElementById('status'),output=document.getElementById('report');
const buttons=[...document.querySelectorAll('button')],complete=new Set(),rows=[];
const stages={passes:materialPasses,continuation:materialContinuation,
  dense:(budget,progress)=>structural('dense',budget,progress),active:(budget,progress)=>structural('active',budget,progress)};
let failed=false;
for(const button of buttons)button.onclick=async()=>{
  for(const b of buttons)b.disabled=true;
  const started=performance.now(),stage=button.dataset.stage;
  const budget=()=>{if(performance.now()-started>30000)throw Error('The 30-second probe deadline expired.');};
  status.textContent='Running '+stage+'…';
  try{
    const result=await stages[stage](budget,text=>{status.textContent=text;});budget();
    rows.push({stage,passed:true,...result,durationMs:performance.now()-started});complete.add(stage);
    status.textContent='Passed: '+result.summary+'.';
  }catch(error){failed=true;rows.push({stage,passed:false,error:String(error.stack||error)});status.textContent='Failed: '+error.message+'. Stop and inspect this failure before running another probe.';}
  output.textContent=JSON.stringify({scope:'bounded 3D GPU development probes',releaseAccepted:false,userAgent:navigator.userAgent,rows},null,2);
  for(const b of buttons)b.disabled=failed||complete.has(b.dataset.stage);
};
