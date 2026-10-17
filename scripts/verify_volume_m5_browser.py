"""Bounded M5 compilation/replay probes. No legacy page or trajectory is opened."""
import argparse
import functools
import http.server
import json
import math
import queue
import os
import platform
import subprocess
from pathlib import Path
import shutil
import threading
import time
import uuid
from scripts.verify_browser import run_captured
from scripts.verification_guard import ROOT, guarded_entry


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser-cli', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--probe', choices=('review', 'compile', 'tiny', 'active-tiny', 'trajectory', 'level-trajectory', 'seams', 'gameplay', 'frames', 'ui', 'fallback', 'order', 'scale'), default='compile')
    parser.add_argument('--mode', choices=('dense', 'active'), default='dense')
    parser.add_argument('--reference', type=Path)
    parser.add_argument('--replay-part',choices=('all','main','restarts'),default='all')
    parser.add_argument('--size', type=int, choices=(32,64,128), default=32)
    parser.add_argument('--scene', default='cut')
    args = parser.parse_args()
    guarded_entry('frames' if args.probe=='frames' else 'gpu', 120 if args.probe in ('trajectory','level-trajectory','frames') else 60)
    if args.probe in ('trajectory','level-trajectory') and (not args.reference or not (args.reference / 'report.json').is_file()):
        parser.error('--reference must contain the retained Node checkpoints')
    args.output.mkdir(parents=True, exist_ok=True)
    progress_path='/__m5_progress/'+uuid.uuid4().hex
    progress_queue=queue.Queue(maxsize=128)

    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_):
            pass

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
            if self.path == '/__m5':
                body = b'<!doctype html><meta charset="utf-8"><p id="status">M5 bounded probe starting</p>'
                self.send_response(200)
                self.send_header('Content-Type', 'text/html')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                super().do_GET()

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    cli = ([shutil.which('node'), str(args.browser_cli)] if args.browser_cli.suffix in ('.js', '.mjs') else [str(args.browser_cli)])
    cli += ['--session', 'm5-' + uuid.uuid4().hex[:10], '--json']

    def call(*arguments, stdin=None):
        code, stdout, stderr = run_captured([*cli, *arguments], stdin=stdin, timeout=15)
        value = json.loads(stdout) if stdout else {}
        if code or not value.get('success'):
            raise RuntimeError(f'Browser probe failed: {stdout}\n{stderr}')
        return value['data']

    report = {'passed': False, 'probe': args.probe, 'scope': 'One bounded M5 stage; not complete release acceptance'}
    try:
        cpu=platform.processor()
        if os.name=='nt':
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,r'HARDWARE\DESCRIPTION\System\CentralProcessor\0') as key:
                cpu=winreg.QueryValueEx(key,'ProcessorNameString')[0].strip()
        gpu=subprocess.run([shutil.which('nvidia-smi'),'--query-gpu=name,driver_version,memory.total','--format=csv,noheader,nounits'],capture_output=True,text=True,timeout=2,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        if gpu.returncode: raise RuntimeError('GPU identity query failed')
        report['hardware']={'os':platform.platform(),'cpu':cpu,'logicalProcessors':os.cpu_count(),'gpu':gpu.stdout.strip()}
        print('M5: isolated ' + args.probe + ' probe', flush=True)
        call('set','viewport','1920','1080')
        page=f'/examples/structural-cavern/?size={args.size}&scene={args.scene}' if args.probe in ('frames','ui','scale') else '/__m5'
        call('open', f'http://127.0.0.1:{server.server_address[1]}{page}')
        invocation = 'verifyM5ShaderCompile()' if args.probe == 'compile' else 'verifyM5GpuTiny(' + ('"active"' if args.probe == 'active-tiny' else '"dense"') + ')'
        if args.probe == 'trajectory':
            url = '/' + args.reference.resolve().relative_to(ROOT).as_posix()
            invocation = 'verifyM5GpuTrajectory(' + json.dumps(args.mode) + ',' + json.dumps(url) + ')'
        if args.probe == 'seams':
            invocation = 'verifyM5DistantSupport(' + json.dumps(args.mode) + ')'
        if args.probe == 'fallback':
            invocation = 'verifyM5DistantSupport("active",1)'
        if args.probe == 'order':
            invocation = 'verifyM5ProcessingOrder()'
        module = '/dist/volume-m5/structural-probe.js'
        if args.probe == 'review':
            module = '/examples/structural-cavern/verify-review.js'
            invocation = 'verifyStructuralReview()'
        if args.probe == 'gameplay':
            module = '/examples/structural-cavern/verify.js'
            invocation = 'verifyStructuralGameplay(' + json.dumps({'size':args.size,'scenario':args.scene,'mode':args.mode}) + ')'
        if args.probe == 'level-trajectory':
            module = '/examples/structural-cavern/replay.js'
            url = '/' + args.reference.resolve().relative_to(ROOT).as_posix()
            invocation = 'verifyStructuralTrajectory(' + json.dumps({'mode':args.mode,'base':url,'part':args.replay_part}) + ')'
        if args.probe in ('frames','ui','scale'):
            action='window.structuralCavern.runScaleProbe()' if args.probe=='scale' else 'window.structuralCavern.runBenchmark()' if args.probe=='frames' else '({passed:true,scope:"Paused M5 UI smoke probe",backendInfo:window.structuralCavern.field.backendInfo,tick:window.structuralCavern.field.tick})'
            progress_script='''
let sending=false,pending,lastSent=0;
async function sendProgress(){
 const now=performance.now();if(!window.__m5.done&&now-lastSent<250)return;lastSent=now;
 pending={done:window.__m5.done,error:window.__m5.error,status:document.getElementById('mode').textContent+' · tick '+document.getElementById('tick').textContent,at:now};
 if(sending)return;sending=true;
 try{while(pending){const next=pending;pending=undefined;
  const response=await fetch(PROGRESS_PATH,{method:'POST',body:JSON.stringify(next),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('Progress transport failed');
 }}catch(error){window.__m5ProgressError=String(error);}
 finally{sending=false;}
}
const observer=new MutationObserver(sendProgress);
observer.observe(document.getElementById('mode'),{childList:true,characterData:true,subtree:true});void sendProgress();
'''.replace('PROGRESS_PATH',json.dumps(progress_path)) if args.probe=='frames' else ''
            finish='.finally(()=>{observer.disconnect();void sendProgress();})' if args.probe=='frames' else ''
            call('eval','--stdin',stdin='window.__m5={done:false};'+progress_script+'void (async()=>{while(!window.structuralCavern)await new Promise(r=>setTimeout(r,20));await window.structuralCavern.ready;return '+action+';})().then(result=>window.__m5={done:true,result},error=>window.__m5={done:true,error:String(error.stack||error)})'+finish+';"started"')
        else:
            call('eval', '--stdin', stdin='window.__m5={done:false};void import(' + json.dumps(module) + ').then(m=>m.' + invocation + ').then(result=>window.__m5={done:true,result},error=>window.__m5={done:true,error:String(error.stack||error)});"started"')
        deadline = time.monotonic() + (95 if args.probe in ('trajectory','level-trajectory','frames') else 30)
        report['observer']={'mode':'http-progress' if args.probe=='frames' else 'cli-poll','events':[]}
        while True:
            if args.probe=='frames':
                try: state=progress_queue.get(timeout=1)
                except queue.Empty:
                    if time.monotonic()>deadline: raise TimeoutError('M5 observation deadline')
                    continue
                report['observer']['events'].append(state)
            else:
                state = call('eval', '({done:window.__m5.done,error:window.__m5.error,status:(document.getElementById("status")||document.getElementById("mode")).textContent})')['result']
            print(state['status'], flush=True)
            if state.get('error'):
                raise RuntimeError(state['error'])
            if state['done']:
                break
            if time.monotonic() > deadline:
                raise TimeoutError('M5 probe exceeded its bounded observation deadline')
            if args.probe!='frames': time.sleep(.5)
        if args.probe=='frames' and call('eval','window.__m5ProgressError||null')['result']:
            raise RuntimeError('Frame progress transport failed')
        report['result'] = call('eval', 'window.__m5.result')['result']
        if args.probe in ('ui','frames'):
            call('screenshot',str((args.output/'view.png').resolve()))
        report['errors'] = call('errors').get('errors', [])
        report['passed'] = report['result']['passed'] and not report['errors'] and report['result']['backendInfo']['isFallbackAdapter'] is False
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        try:
            call('close')
        finally:
            server.shutdown()
            server.server_close()
    return int(not report['passed'])


if __name__ == '__main__':
    raise SystemExit(main())
