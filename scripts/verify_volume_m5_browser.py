"""Bounded M5 probes with persistent browser transport and durable progress.

No browser is launched while the incident recovery hold is hard-blocked.
"""
import argparse
import functools
import http.server
import json
import os
import platform
from pathlib import Path
import queue
import shutil
import subprocess
import threading
import time
import uuid
from scripts.verification_browser import PersistentBrowser
from scripts.verification_guard import ROOT, guarded_entry
from scripts.verification_journal import DurableJournal, durable_json, validate_evidence


class BoundedServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False
    request_queue_size = 8

    def __init__(self, address, handler, journal):
        self.slots = threading.BoundedSemaphore(8)
        self.journal = journal
        self.verification_started = False
        super().__init__(address, handler)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.journal.error = 'HTTP request bound exceeded'
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            self.journal.error = 'HTTP handler could not start'
            raise

    def process_request_thread(self, request, client_address):
        try:
            request.settimeout(5)
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


def finish_resources(report, browser, server, journal):
    """One failed cleanup must not prevent the remaining cleanup or receipt."""
    errors = []
    for name, resource in (('browser', browser), ('server', server), ('journal', journal)):
        if resource is None:
            continue
        try:
            if name == 'server':
                try:
                    if resource.verification_started:
                        resource.shutdown()
                finally:
                    resource.server_close()
            else:
                resource.close()
        except Exception as error:
            errors.append(f'{name}: {error}')
    if browser and browser.fault:
        errors.append('browser: ' + browser.fault)
    if journal:
        report['journal'] = journal.summary()
        if not report['journal']['complete']:
            errors.append('Incomplete durable journal')
    if errors:
        report['passed'] = False
        report['cleanupErrors'] = errors


def invocation_for(args):
    module = '/dist/volume-m5/structural-probe.js'
    invocation = 'verifyM5ShaderCompile()' if args.probe == 'compile' else 'verifyM5GpuTiny(' + json.dumps('active' if args.probe == 'active-tiny' else 'dense') + ')'
    if args.probe == 'trajectory':
        url = '/' + args.reference.resolve().relative_to(ROOT).as_posix()
        invocation = 'verifyM5GpuTrajectory(' + json.dumps(args.mode) + ',' + json.dumps(url) + ')'
    if args.probe == 'seams':
        invocation = 'verifyM5DistantSupport(' + json.dumps(args.mode) + ')'
    if args.probe == 'fallback':
        invocation = 'verifyM5DistantSupport("active",1)'
    if args.probe == 'order':
        invocation = 'verifyM5ProcessingOrder()'
    if args.probe == 'review':
        module = '/examples/structural-cavern/verify-review.js'
        invocation = 'verifyStructuralReview()'
    if args.probe == 'gameplay':
        module = '/examples/structural-cavern/verify.js'
        invocation = 'verifyStructuralGameplay(' + json.dumps({'size': args.size, 'scenario': args.scene, 'mode': args.mode}) + ')'
    if args.probe == 'level-trajectory':
        module = '/examples/structural-cavern/replay.js'
        url = '/' + args.reference.resolve().relative_to(ROOT).as_posix()
        invocation = 'verifyStructuralTrajectory(' + json.dumps({'mode': args.mode, 'base': url, 'part': args.replay_part}) + ')'
    if args.probe in ('frames', 'ui', 'scale'):
        action = ('window.structuralCavern.runScaleProbe()' if args.probe == 'scale' else
                  'window.structuralCavern.runBenchmark()' if args.probe == 'frames' else
                  '({passed:true,scope:"Paused M5 UI smoke probe",backendInfo:window.structuralCavern.field.backendInfo,tick:window.structuralCavern.field.tick})')
        return 'while(!window.structuralCavern)await new Promise(r=>setTimeout(r,20));await window.structuralCavern.ready;return ' + action + ';'
    return 'const m=await import(' + json.dumps(module) + ');return m.' + invocation + ';'


def start_script(args, progress_path):
    # Foundation probes use changed DOM status; authored replay/frames emit ticks.
    observe = args.probe not in ('level-trajectory', 'frames')
    return '''window.__m5={done:false};void(async()=>{
 const {installVerificationJournal}=await import('/examples/structural-cavern/verification-events.js');
 const journal=installVerificationJournal(PROGRESS_PATH);let observer,lastStatus;
 try{
  await journal.emit({kind:'stage-start',probe:PROBE});
  if(OBSERVE){
   const element=document.getElementById('status')||document.getElementById('mode');
   if(element){observer=new MutationObserver(()=>{
    const text=element.textContent;if(text&&text!==lastStatus){lastStatus=text;void journal.emit({kind:'status',text}).catch(()=>{});}
   });observer.observe(element,{childList:true,characterData:true,subtree:true});}
  }
  const result=await(async()=>{INVOCATION})();observer?.disconnect();
  await journal.flush();journal.check();window.__m5={done:true,result};
  await journal.emit({kind:'stage-end'});
 }catch(error){
  observer?.disconnect();window.__m5={done:true,error:String(error.stack||error)};
  try{await journal.emit({kind:'stage-error',error:window.__m5.error.slice(0,2048)});}catch{}
 }
})().catch(error=>{window.__m5={done:true,error:String(error.stack||error)};});'started';'''.replace(
        'PROGRESS_PATH', json.dumps(progress_path)).replace('PROBE', json.dumps(args.probe)).replace(
        'OBSERVE', 'true' if observe else 'false').replace('INVOCATION', invocation_for(args))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser-executable', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--probe', choices=('review', 'compile', 'tiny', 'active-tiny', 'trajectory', 'level-trajectory', 'seams', 'gameplay', 'frames', 'ui', 'fallback', 'order', 'scale'), default='compile')
    parser.add_argument('--mode', choices=('dense', 'active'), default='dense')
    parser.add_argument('--reference', type=Path)
    parser.add_argument('--replay-part', choices=('all', 'main', 'restarts'), default='all')
    parser.add_argument('--size', type=int, choices=(32, 64, 128), default=32)
    parser.add_argument('--scene', default='cut')
    args = parser.parse_args()
    guarded_entry('frames' if args.probe == 'frames' else 'gpu',
                  120 if args.probe in ('trajectory', 'level-trajectory', 'frames') else 60,
                  structured_progress=True)
    if not args.browser_executable.is_file():
        parser.error('--browser-executable must identify an installed Chromium or Edge executable')
    if args.probe in ('trajectory', 'level-trajectory') and (not args.reference or not (args.reference / 'report.json').is_file()):
        parser.error('--reference must contain retained Node checkpoints')
    # A repeated invocation must not overwrite a previous or interrupted receipt.
    args.output.mkdir(parents=True, exist_ok=False)
    progress_path = '/__m5_progress/' + uuid.uuid4().hex
    journal = server = browser = None
    report = {'passed': False, 'status': 'starting', 'probe': args.probe, 'scope': 'One bounded M5 stage; not complete release acceptance'}
    try:
        durable_json(args.output / 'report.json', report)
        expected_ranges = None
        if args.probe == 'level-trajectory':
            reference = json.loads((args.reference / 'report.json').read_text(encoding='utf-8'))
            if reference.get('size') != args.size or reference.get('scenario') != args.scene:
                raise ValueError('Requested replay does not match the retained scene and size')
            action = reference['actionTick']
            restarts = [(3, 31), (action - 1, action + 3), (509, 1024)]
            expected_ranges = [(0, 1024)] if args.replay_part == 'main' else restarts if args.replay_part == 'restarts' else [(0, 1024), *restarts]
        journal = DurableJournal(args.output, args.probe)

        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                if self.path != progress_path:
                    self.send_error(404)
                    return
                try:
                    size = int(self.headers.get('Content-Length', '0'))
                    if not 0 < size <= 4096 or self.headers.get('Transfer-Encoding'):
                        raise ValueError('Invalid journal request size')
                    raw = self.rfile.read(size)
                    if len(raw) != size:
                        raise ValueError('Truncated journal request')
                    ack = journal.append(json.loads(raw))
                    body = json.dumps(ack).encode()
                    self.send_response(200); self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(body))); self.end_headers()
                    self.wfile.write(body)
                except Exception as error:
                    journal.error = str(error) or type(error).__name__
                    self.send_error(400, 'Journal refused progress')

            def do_GET(self):
                if self.path == '/__m5':
                    body = b'<!doctype html><meta charset="utf-8"><p id="status">M5 bounded probe starting</p>'
                    self.send_response(200); self.send_header('Content-Type', 'text/html')
                    self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
                else:
                    super().do_GET()

        server = BoundedServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)), journal)
        threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .1}, daemon=True).start()
        server.verification_started = True
        cpu = platform.processor()
        if os.name == 'nt':
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'HARDWARE\DESCRIPTION\System\CentralProcessor\0') as key:
                cpu = winreg.QueryValueEx(key, 'ProcessorNameString')[0].strip()
        nvidia = shutil.which('nvidia-smi')
        if not nvidia:
            raise RuntimeError('GPU identity query unavailable')
        gpu = subprocess.run([nvidia, '--query-gpu=name,driver_version,memory.total', '--format=csv,noheader,nounits'],
            capture_output=True, text=True, timeout=2, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        if gpu.returncode:
            raise RuntimeError('GPU identity query failed')
        report['hardware'] = {'os': platform.platform(), 'cpu': cpu, 'logicalProcessors': os.cpu_count(), 'gpu': gpu.stdout.strip()}
        print('M5: isolated ' + args.probe + ' probe', flush=True)
        browser = PersistentBrowser(args.browser_executable, args.output)
        report['browser'] = browser.metadata
        report['status'] = 'running'
        durable_json(args.output / 'report.json', report)
        page = f'/examples/structural-cavern/?size={args.size}&scene={args.scene}' if args.probe in ('frames', 'ui', 'scale') else '/__m5'
        browser.call('open', url=f'http://127.0.0.1:{server.server_address[1]}{page}')
        browser.call('eval', expression=start_script(args, progress_path))
        deadline = time.monotonic() + (95 if args.probe in ('trajectory', 'level-trajectory', 'frames') else 30)
        report['observer'] = {'mode': 'persistent-cdp+durable-http', 'heartbeatIsProgress': False}
        while True:
            browser.check()
            if journal.error:
                raise RuntimeError(journal.error)
            if time.monotonic() > deadline:
                raise TimeoutError('M5 probe exceeded its bounded observation deadline')
            try:
                record = journal.events.get(timeout=.2)
            except queue.Empty:
                continue
            # Only events published by the fsync writer advance the supervisor.
            print('STATE_SPACE_PROGRESS ' + json.dumps({'job': os.environ['STATE_SPACE_VERIFICATION_JOB'], 'sequence': record['sequence']}), flush=True)
            event = record['event']
            if event['kind'] == 'status':
                print(event['text'], flush=True)
            if event['kind'] == 'stage-error':
                raise RuntimeError(event['error'])
            if event['kind'] == 'stage-end':
                break
        # Wait for the final HTTP acknowledgement too, not just its disk write.
        state = browser.call('eval', expression='(async()=>{await window.__stateSpaceVerification.flush();return window.__m5;})()')
        if not isinstance(state, dict) or state.get('done') is not True or state.get('error'):
            raise RuntimeError('Browser stage did not finish successfully')
        report['result'] = state['result']
        validate_evidence(journal, report['result'], expected_ranges=expected_ranges)
        if type(report['result'].get('passed')) is not bool:
            raise ValueError('Probe result must contain a boolean passed value')
        if args.probe == 'level-trajectory' and any(report['result'].get(key) != value for key, value in
                {'size': args.size, 'scenario': args.scene, 'mode': args.mode, 'part': args.replay_part}.items()):
            raise ValueError('Replay identity differs from the requested stage')
        if args.probe in ('ui', 'frames'):
            browser.call('screenshot')
        report['errors'] = browser.call('errors')
        report['passed'] = report['result']['passed'] is True and not report['errors'] and report['result']['backendInfo']['isFallbackAdapter'] is False
    except Exception as error:
        report['error'] = str(error)
        report['passed'] = False
    finally:
        finish_resources(report, browser, server, journal)
        report['status'] = 'finished' if report['passed'] else 'failed'
        durable_json(args.output / 'report.json', report)
    return int(not report['passed'])


if __name__ == '__main__':
    raise SystemExit(main())
