"""Bounded 8-cubed CPU/hardware-GPU edit validation regression, without a game loop."""
import argparse
import functools
import hashlib
import http.server
import json
from pathlib import Path
import shutil
import threading
import uuid

from engine.verify import ROOT
from scripts.verification_guard import guarded_entry
from scripts.verify_browser import run_captured


def main():
    guarded_entry('gpu', 90)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser-cli', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/volume-m3-edits')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    paths = ['engine/experimental/volume/world-core.ts', 'engine/experimental/world.test.ts',
             'examples/cavern/verify.js', 'scripts/verify_volume_m3_edits.py',
             'dist/sdk/state-space-world.js', 'dist/sdk/state-space-world-gpu.js',
             'dist/sdk/state-space-3d.js']
    hashes = {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in paths}

    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            if self.path == '/__m3_edits':
                body = b'<!doctype html><meta charset="utf-8"><title>M3 edit regression</title><p id="status">Isolated 8-cubed edit validation</p>'
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                super().do_GET()

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    prefix = ([shutil.which('node'), str(args.browser_cli)] if args.browser_cli.suffix in ('.js', '.mjs') else [str(args.browser_cli)])
    session = 'm3-edits-' + uuid.uuid4().hex[:12]
    report = {'passed': False, 'sourceHashes': hashes, 'scope': '8-cubed CPU/hardware-GPU validation only; no rendering or gameplay benchmark'}

    def call(*arguments, stdin=None):
        code, stdout, stderr = run_captured([*prefix, '--session', session, '--json', *arguments], stdin=stdin, timeout=30)
        result = json.loads(stdout) if stdout else {}
        if code or not result.get('success'):
            raise RuntimeError(f'Browser operation failed: {stdout}\n{stderr}')
        return result['data']

    try:
        print('Starting isolated 8-cubed edit regression', flush=True)
        call('open', f'http://127.0.0.1:{server.server_address[1]}/__m3_edits')
        script = '(async()=>{const {verifyWorldEditBatches}=await import("/examples/cavern/verify.js");return await verifyWorldEditBatches();})()'
        report['regression'] = call('eval', '--stdin', stdin=script)['result']
        report['browserErrors'] = call('errors').get('errors', [])
        report['sourceUnchanged'] = all(hashlib.sha256((ROOT / p).read_bytes()).hexdigest() == h for p, h in hashes.items())
        result = report['regression']
        report['passed'] = (result.get('passed') is True and result['backendInfo'].get('isFallbackAdapter') is False
                            and result['rejections'] == 24 and result['stateTickAndLedgerUnchanged']
                            and result['validDefaultsExact'] and report['sourceUnchanged'] and not report['browserErrors'])
        print(json.dumps(result), flush=True)
    except BaseException as error:
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
