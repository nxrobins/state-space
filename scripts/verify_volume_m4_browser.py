"""Sequential, supervised M4 hardware probes and full-frame measurements."""
import argparse
import base64
import functools
import hashlib
import gzip
import http.server
import json
import math
from pathlib import Path
import queue
import shutil
import sys
import threading
import time
import uuid
from engine.verify import ROOT
from scripts.verification_guard import guarded_entry
from scripts.volume_latency_report import summarize_latency
from scripts.verify_browser import run_captured


def main():
    guarded_entry('frames' if any(a.startswith('frames') for a in sys.argv) else 'gpu', 600)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser-cli', type=Path, required=True)
    parser.add_argument('--phase', choices=['heat-probe','haze-probe','optics-probe', 'appearance-probe', 'appearance-replay', 'frames128beauty', 'gameplay-probe', 'gameplay128', 'frames128gpu', 'probe', 'gate64', 'frames32', 'frames64', 'frames128', 'replay128', 'continuation128'], default='probe')
    parser.add_argument('--gpu-timing', action='store_true', help='Separate diagnostic run with optional GPU timestamps')
    parser.add_argument('--devtools-trace', action='store_true', help='Separate diagnostic capture; may perturb timing')
    parser.add_argument('--node-report', type=Path, default=Path('dist/volume-m4/node128/report.json'))
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/volume-m4/probe')
    args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    paths = sorted({p.relative_to(ROOT).as_posix() for pattern in ['engine/experimental/**/*.ts','examples/active-cavern/*','examples/cavern/*','examples/first-person/*','examples/volume-lab/*.js','web/frame-*.js','scripts/*volume_m4*','dist/sdk/*.js'] for p in ROOT.glob(pattern) if p.is_file()} | {'package.json', 'scripts/volume_latency_report.py'})
    hashes = {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in paths}
    references = {}; node = None
    if args.phase in ('frames128beauty', 'appearance-replay', 'frames128', 'frames128gpu', 'gameplay128', 'continuation128'):
        node = json.loads(args.node_report.read_text(encoding='utf-8'))
        if not node.get('passed') or not node.get('sourceUnchanged'): raise ValueError('A passing dense CPU reference is required.')
        if not all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in node['referenceInputHashes'].items()): raise ValueError('CPU reference inputs changed.')
        references[args.node_report.as_posix()] = hashlib.sha256(args.node_report.read_bytes()).hexdigest()
    for p in ['docs/checkpoints/volume-m3/node.json','docs/checkpoints/volume-m3/m2-node.json']:
        references[p] = hashlib.sha256((ROOT/p).read_bytes()).hexdigest()
    # Frame runs push existing UI progress over the local HTTP connection. Do
    # not spawn CLI/CDP evaluations inside the timed loop. The supervisor still
    # requires real progress and retains its unchanged 15-second stall limit.
    progress_path='/__m4_progress/'+uuid.uuid4().hex
    progress_queue=queue.Queue(maxsize=128)
    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_args): pass
        def do_POST(self):
            if self.path != progress_path:
                self.send_error(404);return
            try:
                size=int(self.headers.get('Content-Length','0'))
                if not 0<size<=4096: raise ValueError('Invalid progress size')
                value=json.loads(self.rfile.read(size))
                if (not isinstance(value,dict) or type(value.get('done')) is not bool
                    or not isinstance(value.get('status'),str) or len(value['status'])>2048
                    or type(value.get('at')) not in (int,float) or not math.isfinite(value['at'])):
                    raise ValueError('Invalid progress event')
                progress_queue.put_nowait({**value,'receivedAt':time.time()})
                self.send_response(204);self.end_headers()
            except (ValueError,queue.Full): self.send_error(400)
        def do_GET(self):
            if self.path == '/__m4':
                body=b'<!doctype html><meta charset="utf-8"><title>M4 verification</title><p id="status">Starting bounded M4 verification</p>'
                self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
            else: super().do_GET()
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start()
    prefix=([shutil.which('node'),str(args.browser_cli)] if args.browser_cli.suffix in ('.js','.mjs') else [str(args.browser_cli)])
    session='m4-'+uuid.uuid4().hex[:12];report={'passed':False,'phase':args.phase,'sourceHashes':hashes,'referenceHashes':references}
    def call(*arguments,stdin=None):
        code,stdout,stderr=run_captured([*prefix,'--session',session,'--json',*arguments],stdin=stdin,timeout=40)
        value=json.loads(stdout) if stdout else {}
        if code or not value.get('success'): raise RuntimeError(f'Browser call failed: {stdout}\n{stderr}')
        return value['data']
    try:
        print(f'M4 {args.phase}: starting isolated hardware session',flush=True)
        path={'frames32':'/examples/first-person/','frames64':'/examples/cavern/','frames128':'/examples/active-cavern/?appearance=diagnostic','frames128gpu':'/examples/active-cavern/?gameplay=gpu&appearance=diagnostic','frames128beauty':'/examples/active-cavern/?gameplay=gpu&appearance=naturalistic'}.get(args.phase,'/__m4')
        if args.gpu_timing: path+=('&' if '?' in path else '?')+'gpuTiming=1'
        call('open',f'http://127.0.0.1:{server.server_address[1]}'+path);call('set','viewport','1920','1080')
        functions={'heat-probe':'verifyHeatProbe','haze-probe':'verifyHazeProbe','optics-probe':'verifyOpticsProbe','appearance-probe':'verifyAppearanceProbe','appearance-replay':'verifyAppearanceReplay','gameplay-probe':'verifyGameplayProbe','gameplay128':'verifyResident128','probe':'verifyM4Probe','gate64':'verify64Gate','replay128':'verify128Replay','continuation128':'verify128Continuation'}
        if args.phase in functions:
            argument=json.dumps('/'+args.node_report.as_posix()) if args.phase in ('appearance-replay','continuation128','gameplay128') else ''
            module='verify-appearance.js' if (args.phase.startswith('appearance') or args.phase in ('heat-probe','haze-probe','optics-probe')) else 'verify-gameplay.js' if args.phase in ('gameplay-probe','gameplay128') else 'verify.js'
            expression='const m=await import("/examples/active-cavern/'+module+'");return await m.'+functions[args.phase]+'('+argument+');'
        else:
            name={'frames32':'crossing','frames64':'cavern','frames128':'activeCavern','frames128gpu':'activeCavern','frames128beauty':'activeCavern'}[args.phase]
            call('wait','--fn',f'Boolean(window.{name}?.ready)');expression=f'return await window.{name}.runBenchmark();'
        if args.devtools_trace: call('profiler','start','--categories','devtools.timeline,v8,v8.execute,blink.user_timing,toplevel,gpu,disabled-by-default-v8.gc,disabled-by-default-devtools.timeline,disabled-by-default-v8.cpu_profiler')
        push=args.phase.startswith('frames')
        progress_script='''
let sending=false,pending;
async function sendProgress(){
 pending={done:window.__m4.done,error:window.__m4.error,status:document.getElementById('status').textContent,at:performance.now()};
 if(sending)return;sending=true;
 try{while(pending){const next=pending;pending=undefined;
  const response=await fetch(PROGRESS_PATH,{method:'POST',body:JSON.stringify(next),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('Progress transport failed');
 }}catch(error){window.__m4ProgressError=String(error);}
 finally{sending=false;}
}
const observer=new MutationObserver(sendProgress);
observer.observe(document.getElementById('status'),{childList:true,characterData:true,subtree:true});
void sendProgress();
'''.replace('PROGRESS_PATH',json.dumps(progress_path)) if push else ''
        finish='.finally(()=>{observer.disconnect();void sendProgress();})' if push else ''
        call('eval','--stdin',stdin='performance.mark("m4-clock-"+performance.now());window.__m4={done:false};'+progress_script+'void(async()=>{'+expression+'})().then(result=>window.__m4={done:true,result},error=>window.__m4={done:true,error:String(error.stack||error)})'+finish+';"started"')
        deadline=time.monotonic()+500;last=''
        report['observer']={'mode':'http-progress' if push else 'cli-poll','events':[]}
        while True:
            if push:
                try: state=progress_queue.get(timeout=1)
                except queue.Empty:
                    if time.monotonic()>deadline: raise TimeoutError('M4 job deadline')
                    continue
                report['observer']['events'].append(state)
            else:
                state=call('eval','({done:window.__m4.done,error:window.__m4.error,status:document.getElementById("status").textContent})')['result']
            if state['status']!=last: last=state['status'];print(last,flush=True)
            if state.get('error'): raise RuntimeError(state['error'])
            if state['done']: break
            if time.monotonic()>deadline: raise TimeoutError('M4 job deadline')
            if not push: time.sleep(2)
        if push and call('eval','window.__m4ProgressError||null')['result']:
            raise RuntimeError('Frame progress transport failed')
        if args.devtools_trace:
            trace_path=args.output/'chrome-trace.json';call('profiler','stop',str(trace_path.resolve()))
            if not json.loads(trace_path.read_text(encoding='utf-8')).get('traceEvents'):
                raise RuntimeError('Chrome diagnostic trace contains no events')
            report['devtoolsTrace']={'path':str(trace_path.relative_to(ROOT)),'sha256':hashlib.sha256(trace_path.read_bytes()).hexdigest()}
        report['result']=call('eval','window.__m4.result')['result'];report['browserErrors']=call('errors').get('errors',[])
        report['sourceUnchanged']=all(hashlib.sha256((ROOT / p).read_bytes()).hexdigest()==h for p,h in hashes.items())
        result=report['result'];report['passed']=result.get('passed',result.get('complete',False)) and report['sourceUnchanged'] and not report['browserErrors']
        info=result.get('backendInfo',{});report['passed'] &= info.get('isFallbackAdapter') is False
        if args.phase.startswith('frames'):
            if not result.get('complete'):
                report['passed'] = False
                raise RuntimeError(result.get('error') or 'Frame benchmark incomplete; partial samples retained.')
            if args.phase in ('frames128','frames128gpu','frames128beauty'):
                def fixture(name): return json.loads(gzip.decompress((ROOT/node['fixtures'][name]['path']).read_bytes()))
                initial=json.loads(gzip.decompress(base64.b64decode(result['initialCompressed']['data'])))
                final=json.loads(gzip.decompress(base64.b64decode(result['finalCompressed']['data'])))
                result['nodeExact']=(initial==fixture('initial') and final==fixture('final') and result['commands']==fixture('commands'))
                won=result['finalStatus']=='won'
            elif args.phase=='frames64':
                ref=json.loads((ROOT/'docs/checkpoints/volume-m3/node.json').read_text())
                def old_fixture(name): return json.loads(gzip.decompress((ROOT/ref['fixtures'][name]['path']).read_bytes()))
                result['nodeExact']=(result['initial']==old_fixture('game-initial') and result['final']==old_fixture('game-final') and result['commands']==old_fixture('commands'));won=result['final']['status']=='won'
            else:
                ref=json.loads((ROOT/'docs/checkpoints/volume-m3/m2-node.json').read_text())['game'];result['nodeExact']=all(result[k]==ref[k] for k in ['initial','final','commands']);won=result['final']['status']=='won'
            report['passed'] &= result['nodeExact'] and won and result['energyBalance']['driftQ']=='0'
            report['performancePassed']=result.get('performancePassed',False)
            report['latencySummary']=summarize_latency(result)
        report['referencesUnchanged']=all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in references.items());report['passed'] &= report['referencesUnchanged']
        call('screenshot',str((args.output/'verified.png').resolve()));print(f'M4 {args.phase}: passed={report["passed"]}',flush=True)
    except BaseException as error:
        report['error']=str(error)
        try: call('screenshot',str((args.output/'failed.png').resolve()))
        except Exception: pass
        raise
    finally:
        (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        try: call('close')
        finally: server.shutdown();server.server_close()
    return int(not report['passed'])

if __name__=='__main__': raise SystemExit(main())
