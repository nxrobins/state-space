"""Hardware GPU conformance, exact gameplay replay, and complete 64-cubed frames."""
import argparse
import sys
import functools
import hashlib
import http.server
import json
import gzip
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
    from scripts.verification_guard import guarded_entry
    guarded_entry('frames' if '--frames-only' in sys.argv else 'gpu', 600)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser-cli', type=Path, required=True)
    parser.add_argument('--node-report', type=Path, default=Path('docs/checkpoints/volume-m3/node.json'))
    parser.add_argument('--output', type=Path, default=Path('docs/checkpoints/volume-m3/browser'))
    parser.add_argument('--frames', action='store_true')
    parser.add_argument('--frames-only', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    expected = json.loads(args.node_report.read_text(encoding='utf-8'))
    if not expected.get('passed') or not expected.get('sourceUnchanged'):
        raise ValueError('Passing fresh Node reference required.')
    # Freeze CPU inputs independently from the GPU/UI implementation under test.
    # A presentation or GPU fix does not require repeating thousands of unchanged
    # CPU ticks; each browser receipt separately binds its complete current source.
    reference_paths = [
        'dist/sdk/state-space-3d.js', 'engine/experimental/3d.ts',
        'engine/experimental/3d-core.ts', 'engine/thermal.ts', 'engine/registry.ts',
        'engine/validation.ts', 'engine/materials.json', 'engine/generated/materials.ts',
        'scripts/verify_volume_m3.mjs', 'examples/cavern/game.js',
    ]
    if 'm3' == 'm3':
        reference_paths += ['dist/sdk/state-space-world.js', 'engine/experimental/world.ts',
                            'engine/experimental/world-core.ts', 'examples/cavern/scene.js']
    else:
        reference_paths += ['examples/volume-lab/scenes.js', 'examples/first-person/scene.js']
    reference_hashes = {p: expected['sourceHashes'][p] for p in reference_paths}
    if not all(hashlib.sha256((ROOT / p).read_bytes()).hexdigest() == h for p, h in reference_hashes.items()):
        raise ValueError('CPU reference inputs changed; regenerate the Node reference.')
    sources = {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in expected['sourceHashes']}


    def unchanged():
        return all((ROOT / p).is_file() and hashlib.sha256((ROOT / p).read_bytes()).hexdigest() == h
                   for p, h in sources.items())

    if not unchanged():
        raise ValueError('Sources differ from Node reference; rerun verify_volume_m3.mjs.')
    session = 'volume-m3-' + uuid.uuid4().hex[:12]
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
        script = ('window.__m3Job={done:false}; void (async()=>{' + expression +
                  '})().then(result=>window.__m3Job={done:true,result},error=>window.__m3Job={done:true,error:String(error.stack||error)}); "started"')
        cli('eval', '--stdin', stdin=script)
        deadline = time.monotonic() + 600
        last = ''
        while True:
            status = cli('eval', '({done:window.__m3Job.done,error:window.__m3Job.error,status:document.getElementById("status").textContent})')['result']
            if status['status'] != last:
                last = status['status']
                journal('progress', **status)
                print(last, flush=True)
            if status.get('error'):
                raise RuntimeError(status['error'])
            if status['done']:
                return cli('eval', 'window.__m3Job.result')['result']
            if time.monotonic() > deadline:
                cli('eval', 'window.cavern.cancelBenchmark(); "cancelled"')
                raise TimeoutError('M3 browser operation exceeded deadline.')
            time.sleep(2)

    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    report = {'version': 1, 'passed': False, 'recordedAt': time.time(), 'host': platform.platform(), 'sourceHashes': sources, 'referenceInputHashes': reference_hashes, 'nodeReferenceReceiptHash': hashlib.sha256(args.node_report.read_bytes()).hexdigest()}
    journal('started', session=session)
    try:
        cli('open', f'http://127.0.0.1:{server.server_address[1]}/examples/cavern/')
        cli('set', 'viewport', '1920', '1080')
        cli('wait', '--fn', 'Boolean(window.cavern?.ready)')
        report['backendInfo'] = cli('eval', 'window.cavern.backendInfo')['result']
        if report['backendInfo'].get('isFallbackAdapter') is not False:
            raise ValueError('Hardware WebGPU adapter required.')
        cli('screenshot', str((args.output / 'ready.png').resolve()))
        if not args.frames_only:
            url = '/' + args.node_report.as_posix()
            report['verification'] = job('const {verifyCavern}=await import("./verify.js"); const expected=await fetch(' + json.dumps(url) + ').then(r=>r.json()); return await verifyCavern(expected);')
            cli('screenshot', str((args.output / 'verified.png').resolve()))
        if args.frames or args.frames_only:
            report['frames'] = job('return await window.cavern.runBenchmark();')
            frames = report['frames']
            frames['nodeExact'] = (frames.get('initial') == json.loads(gzip.decompress((ROOT / expected['fixtures']['game-initial']['path']).read_bytes())) and
                                   frames.get('final') == json.loads(gzip.decompress((ROOT / expected['fixtures']['game-final']['path']).read_bytes())) and
                                   frames.get('commands') == json.loads(gzip.decompress((ROOT / expected['fixtures']['commands']['path']).read_bytes())))
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
