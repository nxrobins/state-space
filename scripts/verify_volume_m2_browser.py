"""Hardware GPU conformance, exact gameplay replay, and complete 32-cubed frames."""
import argparse
import functools
import hashlib
import http.server
import json
import os
import platform
import shutil
import threading
import time
import uuid
from pathlib import Path

from engine.verify import ROOT
from scripts.verify_browser import run_captured


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser-cli', type=Path, required=True)
    parser.add_argument('--node-report', type=Path, default=Path('docs/checkpoints/volume-m2/node.json'))
    parser.add_argument('--output', type=Path, default=Path('docs/checkpoints/volume-m2/browser'))
    parser.add_argument('--frames', action='store_true')
    parser.add_argument('--frames-only', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    expected = json.loads(args.node_report.read_text(encoding='utf-8'))
    if not expected.get('passed') or not expected.get('sourceUnchanged'):
        raise ValueError('Passing fresh Node reference required.')
    sources = expected['sourceHashes']

    def unchanged():
        return all((ROOT / p).is_file() and hashlib.sha256((ROOT / p).read_bytes()).hexdigest() == h
                   for p, h in sources.items())

    if not unchanged():
        raise ValueError('Sources differ from Node reference; rerun verify_volume_m2.mjs.')
    session = 'volume-m2-' + uuid.uuid4().hex[:12]
    prefix = [shutil.which('node'), str(args.browser_cli)] if args.browser_cli.suffix in ('.js', '.mjs') else [str(args.browser_cli)]
    commands = []

    def journal(event, **details):
        with (args.output / 'progress.jsonl').open('a', encoding='utf-8') as stream:
            stream.write(json.dumps({'time': time.time(), 'event': event, **details}) + '\n')
            stream.flush()
            os.fsync(stream.fileno())

    def cli(*arguments, stdin=None):
        code, stdout, stderr = run_captured([*prefix, '--session', session, '--json', *arguments], stdin=stdin)
        commands.append({'arguments': arguments, 'exitCode': code, 'stderr': stderr})
        result = json.loads(stdout) if stdout else {}
        if code or not result.get('success'):
            raise RuntimeError(f'Browser operation failed: {stdout}\n{stderr}')
        return result['data']

    def job(expression):
        script = ('window.__m2Job={done:false}; void (async()=>{' + expression +
                  '})().then(result=>window.__m2Job={done:true,result},error=>window.__m2Job={done:true,error:String(error.stack||error)}); "started"')
        cli('eval', '--stdin', stdin=script)
        deadline = time.monotonic() + 600
        last = ''
        while True:
            status = cli('eval', '({done:window.__m2Job.done,error:window.__m2Job.error,status:document.getElementById("status").textContent})')['result']
            if status['status'] != last:
                last = status['status']
                journal('progress', **status)
                print(last, flush=True)
            if status.get('error'):
                raise RuntimeError(status['error'])
            if status['done']:
                return cli('eval', 'window.__m2Job.result')['result']
            if time.monotonic() > deadline:
                cli('eval', 'window.crossing.cancelBenchmark(); "cancelled"')
                raise TimeoutError('M2 browser operation exceeded deadline.')
            time.sleep(2)

    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    report = {'version': 1, 'passed': False, 'recordedAt': time.time(), 'host': platform.platform(), 'sourceHashes': sources}
    journal('started', session=session)
    try:
        cli('open', f'http://127.0.0.1:{server.server_address[1]}/examples/first-person/')
        cli('wait', '--fn', 'Boolean(window.crossing?.ready)')
        cli('screenshot', str((args.output / 'ready.png').resolve()))
        if not args.frames_only:
            url = '/' + args.node_report.as_posix()
            report['verification'] = job('const {verifyCrossing}=await import("./verify.js"); const expected=await fetch(' + json.dumps(url) + ').then(r=>r.json()); return await verifyCrossing(expected);')
            cli('screenshot', str((args.output / 'verified.png').resolve()))
        if args.frames or args.frames_only:
            report['frames'] = job('return await window.crossing.runBenchmark();')
            frames = report['frames']
            frames['nodeExact'] = (frames.get('initial') == expected['game']['initial'] and
                                   frames.get('final') == expected['game']['final'] and
                                   frames.get('commands') == expected['game']['commands'])
            cli('screenshot', str((args.output / 'measured.png').resolve()))
        report['browserErrors'] = cli('errors').get('errors', [])
        report['sourceUnchanged'] = unchanged()
        report['passed'] = (report.get('verification', {}).get('passed', args.frames_only) and
                            report['sourceUnchanged'] and not report['browserErrors'])
        if args.frames or args.frames_only:
            frames = report['frames']
            report['passed'] &= (frames['complete'] and frames['nodeExact'] and
                                 frames['energyBalance']['driftQ'] == '0' and frames['final']['status'] == 'won')
            # Correctness and performance are reported separately; a failed timing
            # gate cannot masquerade as a locked 60 Hz result.
            report['performancePassed'] = frames.get('performancePassed', False)
        journal('completed', passed=report['passed'], performancePassed=report.get('performancePassed'))
    except BaseException as error:
        report['error'] = str(error)
        journal('interrupted' if isinstance(error, KeyboardInterrupt) else 'failed', error=str(error))
        raise
    finally:
        report['commands'] = commands
        (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        try:
            cli('close')
        finally:
            server.shutdown()
            server.server_close()
    return int(not report['passed'])


if __name__ == '__main__':
    raise SystemExit(main())
