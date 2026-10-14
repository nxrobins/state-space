"""Verify the worker/viewer and measure bounded 32-cubed frames in a real browser."""
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
    parser.add_argument('--node-report', type=Path, default=Path('docs/checkpoints/volume-m1/node-verification.json'))
    parser.add_argument('--output', type=Path, default=Path('docs/checkpoints/volume-m1/browser'))
    parser.add_argument('--frames', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    expected = json.loads(args.node_report.read_text(encoding='utf-8'))
    if not expected.get('passed') or not expected.get('sourceUnchanged'):
        raise ValueError('A passing fresh Node verification report is required.')
    before = expected['sourceHashes']

    def unchanged():
        return all((ROOT / path).is_file() and hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == digest
                   for path, digest in before.items())

    if not unchanged():
        raise ValueError('Node report sources differ from current sources. Rerun verify_volume.mjs.')
    session = 'volume-' + uuid.uuid4().hex[:12]
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
        script = ('window.__volumeJob={done:false}; void (async()=>{' + expression +
                  '})().then(result=>window.__volumeJob={done:true,result},error=>window.__volumeJob={done:true,error:String(error.stack||error)}); "started"')
        cli('eval', '--stdin', stdin=script)
        deadline = time.monotonic() + 600
        last = ''
        while True:
            status = cli('eval', '({done:window.__volumeJob.done,error:window.__volumeJob.error,status:document.getElementById("status").textContent})')['result']
            if status['status'] != last:
                last = status['status']
                journal('progress', **status)
                print(last, flush=True)
            if status.get('error'):
                raise RuntimeError(status['error'])
            if status['done']:
                return cli('eval', 'window.__volumeJob.result')['result']
            if time.monotonic() > deadline:
                cli('eval', 'window.volumeLab.cancelBenchmark(); "cancelled"')
                raise TimeoutError('Volume browser operation exceeded its deadline.')
            time.sleep(2)

    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    report = {'reportVersion': 1, 'passed': False, 'host': platform.platform(), 'sourceHashes': before}
    journal('started', session=session)
    try:
        cli('open', f'http://127.0.0.1:{server.server_address[1]}/examples/volume-lab/')
        cli('wait', '--fn', 'Boolean(window.volumeLab?.ready)')
        cli('screenshot', str((args.output / 'ready.png').resolve()))
        report['verification'] = job('const {verifyVolumeBrowser}=await import("./verify.js"); return await verifyVolumeBrowser(' + json.dumps(expected) + ');')
        cli('screenshot', str((args.output / 'verified.png').resolve()))
        if args.frames:
            report['frames'] = job('return await window.volumeLab.runBenchmark();')
            for row in report['frames']['rows']:
                reference = next(r for r in expected['rows'] if r['scene'] == row['scene'])
                row['nodeExact'] = row['initialHash'] == reference['hashes']['0'] and row['finalHash'] == reference['hashes']['660']
            cli('screenshot', str((args.output / 'measured.png').resolve()))
        report['browserErrors'] = cli('errors').get('errors', [])
        report['sourceUnchanged'] = unchanged()
        report['passed'] = report['verification']['passed'] and report['sourceUnchanged'] and not report['browserErrors']
        if args.frames:
            frames = report['frames']
            report['passed'] &= (not frames['cancelled'] and not frames.get('error') and len(frames['rows']) == 3 and
                                 all(r['complete'] and r['nodeExact'] and r['energyDriftQ'] == '0' for r in frames['rows']))
        journal('completed', passed=report['passed'])
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
