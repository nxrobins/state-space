/** Measures the actual playable application through its existing frame gate. */
export async function benchmarkPlayableClient(){
 const api=window.structuralCavern,output=document.getElementById('report');
 output.style.display='none';
 const progress=setInterval(()=>{output.textContent=JSON.stringify({done:false,progress:'Actual client frame '+api.field.tick+'/660'});},500);
 try{
  const result=await api.runBenchmark();
  clearInterval(progress);
  // Keep diagnostic completion distinct from passing the strict 60 Hz gate.
  output.textContent=JSON.stringify({stage:'gameplay',done:true,progress:'Actual client measurement complete',...result,passed:result.complete&&result.energyBalance?.driftQ==='0',releaseAccepted:false});
 }catch(error){clearInterval(progress);output.textContent=JSON.stringify({done:true,passed:false,error:String(error.stack||error)});}
}
