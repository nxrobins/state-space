import {probeStructuralScale} from '../structural-cavern/scale-probe.js';
/** The existing eight-frame responsiveness probe, inside the fixed Mac guard. */
export async function probePlayableScale(){
 const output=document.getElementById('report');output.style.display='none';
 try{
  output.textContent=JSON.stringify({done:false,progress:'128³ eight-frame scale probe'});
  const result=await probeStructuralScale(window.structuralCavern);
  output.textContent=JSON.stringify({...result,done:true,progress:'Scale probe complete',releaseAccepted:false});
 }catch(error){output.textContent=JSON.stringify({done:true,passed:false,error:String(error.stack||error)});}
}
