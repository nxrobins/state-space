import functools,http.server,json,threading,uuid,hashlib,time
from pathlib import Path
from scripts.verify_browser import run_captured
from engine.verify import ROOT
import argparse,shutil
from scripts.verification_guard import guarded_entry

def main():
    guarded_entry('gpu',180)
    parser=argparse.ArgumentParser(description='Bounded Cavern UI controls, saves and recovery checks.');parser.add_argument('--browser-cli',type=Path,required=True);parser.add_argument('--output',type=Path,default=ROOT/'dist/volume-m4/ui');parser.add_argument('--resident-gameplay',action='store_true');args=parser.parse_args();out=args.output;out.mkdir(parents=True,exist_ok=True)
    class Handler(http.server.SimpleHTTPRequestHandler):
     def log_message(self,*args):pass
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start()
    cli=([shutil.which('node'),str(args.browser_cli)] if args.browser_cli.suffix in ('.js','.mjs') else [str(args.browser_cli)])+['--session','m4-ui-'+uuid.uuid4().hex[:8],'--json']
    def call(*a,stdin=None):
     c,o,e=run_captured(cli+list(a),stdin=stdin);r=json.loads(o)
     if c or not r.get('success'):raise RuntimeError(o+'\n'+e)
     return r['data']
    report={'passed':False,'residentGameplay':args.resident_gameplay,'harnessSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    try:
     print('Starting bounded UI smoke test',flush=True)
     call('open',f'http://127.0.0.1:{server.server_address[1]}/examples/active-cavern/'+('?gameplay=gpu' if args.resident_gameplay else ''));call('set','viewport','1920','1080');call('wait','--fn','Boolean(window.activeCavern?.ready)')
     if args.resident_gameplay:
      print('Switching resident/CPU backends through the selector',flush=True)
      for backend in ('cpu','gpu'):
       call('eval',f"document.getElementById('gameplay-backend').value='{backend}';document.getElementById('gameplay-backend').dispatchEvent(new Event('change'));'switching'")
       call('wait','--fn',f"Boolean(window.activeCavern?.ready&&window.activeCavern.gameplayBackend==='{backend}')")
       if call('eval','window.activeCavern.game.field.tick')['result']!=0:raise RuntimeError('Backend switch failed to reset')
      report['backendSelectorResets']=True
     script=r'''(async()=>{
     const mark=text=>{window.__ui.stage=text;};mark('Playback and single step');
     const live=window.activeCavern,check=(v,m)=>{if(!v)throw Error(m)},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sleep=ms=>new Promise(r=>setTimeout(r,ms));
     async function until(test,ms=8000){const end=performance.now()+ms;while(!test()){if(performance.now()>end)throw Error('UI wait timed out');await sleep(10);}}
     const initial=await live.snapshot();window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyQ'}));document.getElementById('play').click();await until(()=>live.game.field.tick>=3);document.getElementById('play').click();const paused=await live.snapshot();const latency=live.latency();check(latency.input?.source==='browser-event'&&latency.input.event?.type==='keydown','Missing input timestamps');check(latency.engine.enabled&&latency.engine.records.length<=32,'Unbounded or disabled UI latency');latency.input.event.handledAt=-1;check(live.latency().input.event.handledAt>=0,'Latency API leaked mutable state');window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyQ'}));
     document.getElementById('step').click();await until(()=>live.game.field.tick===paused.field.tick+1&&!live.operationInFlight);await live.reset();
     const tape=live.replayTape();tape.initial.seed=-1;tape.initial.player.x=-1;tape.initial.field.chunks[0].energyQ[0]=12345;
     await live.reset();check(same(await live.snapshot(),initial),'Exported tape corrupted a shared reset baseline');
     // A restore at the same absolute tick must invalidate the paused view.
     mark('Paused view and same-tick restore');
     const submit=GPUQueue.prototype.submit;let submissions=0;GPUQueue.prototype.submit=function(...args){submissions++;return submit.apply(this,args)};
     try{await sleep(100);submissions=0;await sleep(100);check(submissions===0,'Paused view keeps redrawing');await live.restore(initial);submissions=0;await sleep(100);check(submissions>0,'Same-tick restore did not redraw');}finally{GPUQueue.prototype.submit=submit;}
     async function upload(saved){const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(saved)],'cavern.json',{type:'application/json'}));const input=document.getElementById('file');input.files=dt.files;input.dispatchEvent(new Event('change'));}
     mark('Atomic file imports');
     const before=await live.snapshot();await upload({...before,seed:-1});await until(()=>!document.getElementById('error').hidden);check(same(await live.snapshot(),before),'Bad file mutated state');
     await upload(initial);await until(()=>document.getElementById('file').value==='');check(document.getElementById('error').hidden,'Valid import kept error');check(same(await live.snapshot(),initial),'File round trip differs');
     mark('Deterministic crossing');document.getElementById('route').click();await until(()=>live.game.status==='won',12000);const route=await live.snapshot();check(route.field.tick===191,'Route tick differs');check(route.events.some(e=>e.type==='ice-walk'),'No physical ice crossing');
     mark('Benchmark cancellation');
     await live.reset();const pending=live.runBenchmark();await until(()=>live.benchmarkResult?.warmup.length>=3);live.cancelBenchmark();const partial=await pending;check(partial.cancelled&&!partial.complete&&partial.samples.length<600,'Cancellation was not retained');check(!document.getElementById('receipt').hidden,'No partial receipt');
     mark('Software error and reset recovery');live.game.step=async()=>{throw Error('Injected UI recovery check')};document.getElementById('play').click();await until(()=>document.getElementById('mode').textContent.includes('ERROR'));await live.reset();await live.step();check((await live.snapshot()).field.tick===1,'Reset recovery failed');await live.reset();
     return{inputLatencyIsolated:true,playPauseStep:true,exportIsolation:true,pausedViewIdle:true,sameTickRestoreRedraws:true,fileImportAtomic:true,fileRoundTrip:true,routeWonAt:route.field.tick,iceWalk:true,cancellationRetained:true,softwareErrorRecovery:true};
    })()'''
     call('eval','--stdin',stdin='window.__ui={done:false,stage:"Starting UI checks"};void('+script+').then(result=>Object.assign(window.__ui,{done:true,result}),error=>Object.assign(window.__ui,{done:true,error:String(error.stack||error)}));"started"')
     deadline=time.monotonic()+100;last=''
     while True:
      state=call('eval','({done:window.__ui.done,stage:window.__ui.stage,error:window.__ui.error,tick:window.activeCavern.game.field.tick})')['result']
      progress=f'{state["stage"]}: tick {state["tick"]}'
      if progress!=last:print(progress,flush=True);last=progress
      if state.get('error'):raise RuntimeError(state['error'])
      if state['done']:break
      if time.monotonic()>deadline:raise TimeoutError('UI checks exceeded the recovery budget')
      time.sleep(1)
     report['checks']=call('eval','window.__ui.result')['result'];report['errors']=call('errors').get('errors',[]);report['passed']=not report['errors'];call('screenshot',str(out/'cavern.png'));print(json.dumps(report['checks']),flush=True)
    finally:
     (out/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
     call('close');server.shutdown();server.server_close()
    if not report['passed']:raise SystemExit(1)

if __name__ == '__main__':
    main()
