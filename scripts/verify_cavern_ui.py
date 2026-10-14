import functools,http.server,json,threading,uuid,hashlib
from pathlib import Path
from scripts.verify_browser import run_captured
from engine.verify import ROOT
import argparse,shutil
from scripts.verification_guard import guarded_entry

def main():
    guarded_entry('gpu',90)
    parser=argparse.ArgumentParser(description='Bounded Cavern UI controls, saves and recovery checks.');parser.add_argument('--browser-cli',type=Path,required=True);parser.add_argument('--output',type=Path,default=ROOT/'docs/checkpoints/volume-m3/ui');args=parser.parse_args();out=args.output;out.mkdir(parents=True,exist_ok=True)
    class Handler(http.server.SimpleHTTPRequestHandler):
     def log_message(self,*args):pass
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start()
    cli=([shutil.which('node'),str(args.browser_cli)] if args.browser_cli.suffix in ('.js','.mjs') else [str(args.browser_cli)])+['--session','m3-ui-'+uuid.uuid4().hex[:8],'--json']
    def call(*a,stdin=None):
     c,o,e=run_captured(cli+list(a),stdin=stdin);r=json.loads(o)
     if c or not r.get('success'):raise RuntimeError(o+'\n'+e)
     return r['data']
    report={'passed':False,'harnessSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    try:
     print('Starting bounded UI smoke test',flush=True)
     call('open',f'http://127.0.0.1:{server.server_address[1]}/examples/cavern/');call('set','viewport','1920','1080');call('wait','--fn','Boolean(window.cavern?.ready)')
     script=r'''(async()=>{
     const live=window.cavern,check=(v,m)=>{if(!v)throw Error(m)},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sleep=ms=>new Promise(r=>setTimeout(r,ms));
     async function until(test,ms=8000){const end=performance.now()+ms;while(!test()){if(performance.now()>end)throw Error('UI wait timed out');await sleep(10);}}
     const initial=await live.snapshot();document.getElementById('play').click();await until(()=>live.game.field.tick>=3);document.getElementById('play').click();const paused=await live.snapshot();
     document.getElementById('step').click();await until(()=>live.game.field.tick===paused.field.tick+1);await live.reset();
     // A restore at the same absolute tick must invalidate the paused view.
     const submit=GPUQueue.prototype.submit;let submissions=0;GPUQueue.prototype.submit=function(...args){submissions++;return submit.apply(this,args)};
     try{await sleep(100);submissions=0;await sleep(100);check(submissions===0,'Paused view keeps redrawing');await live.restore(initial);submissions=0;await sleep(100);check(submissions>0,'Same-tick restore did not redraw');}finally{GPUQueue.prototype.submit=submit;}
     async function upload(saved){const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(saved)],'cavern.json',{type:'application/json'}));const input=document.getElementById('file');input.files=dt.files;input.dispatchEvent(new Event('change'));}
     const before=await live.snapshot();await upload({...before,seed:-1});await until(()=>!document.getElementById('error').hidden);check(same(await live.snapshot(),before),'Bad file mutated state');
     await upload(initial);await until(()=>document.getElementById('file').value==='');check(document.getElementById('error').hidden,'Valid import kept error');check(same(await live.snapshot(),initial),'File round trip differs');
     document.getElementById('route').click();await until(()=>live.game.status==='won',12000);const route=await live.snapshot();check(route.field.tick===215,'Route tick differs');check(route.events.some(e=>e.type==='ice-walk'),'No physical ice crossing');
     await live.reset();const pending=live.runBenchmark();await until(()=>live.benchmarkResult?.warmup.length>=3);live.cancelBenchmark();const partial=await pending;check(partial.cancelled&&!partial.complete&&partial.samples.length<600,'Cancellation was not retained');check(!document.getElementById('receipt').hidden,'No partial receipt');
     live.game.step=async()=>{throw Error('Injected UI recovery check')};document.getElementById('play').click();await until(()=>document.getElementById('mode').textContent.includes('ERROR'));await live.reset();await live.step();check((await live.snapshot()).field.tick===1,'Reset recovery failed');await live.reset();
     return{playPauseStep:true,pausedViewIdle:true,sameTickRestoreRedraws:true,fileImportAtomic:true,fileRoundTrip:true,routeWonAt:route.field.tick,iceWalk:true,cancellationRetained:true,softwareErrorRecovery:true};
    })()'''
     report['checks']=call('eval','--stdin',stdin=script)['result'];report['errors']=call('errors').get('errors',[]);report['passed']=not report['errors'];call('screenshot',str(out/'cavern.png'));print(json.dumps(report['checks']),flush=True)
    finally:
     (out/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
     call('close');server.shutdown();server.server_close()
    if not report['passed']:raise SystemExit(1)

if __name__ == '__main__':
    main()
