"""Measure the actual Spillway game loop and retain its exact CPU replay receipts."""

import argparse
import functools
import http.server
import json
import os
import platform
import shutil
import threading
import time
import uuid
from pathlib import Path

from engine.verify import ROOT, source_hashes
from scripts.verify_browser import run_captured


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser-cli', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--require-locked', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    before = source_hashes()
    commands = []

    def journal(event, **details):
        entry = {'time': time.time(), 'event': event, **details}
        with (args.output / 'progress.jsonl').open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(entry) + '\n')
            stream.flush()
            os.fsync(stream.fileno())

    def gpu_load():
        executable = shutil.which('nvidia-smi')
        if not executable:
            return None
        code, stdout, stderr = run_captured([executable, '--query-gpu=name,driver_version,utilization.gpu,power.draw', '--format=csv,noheader'])
        return {'exitCode': code, 'output': stdout.strip(), 'error': stderr.strip()}

    host = {'system': platform.platform(), 'processor': platform.processor(), 'gpuBefore': gpu_load()}
    prefix = [shutil.which('node'), str(args.browser_cli)] if args.browser_cli.suffix in ('.js', '.mjs') else [str(args.browser_cli)]
    session = 'spillway-' + uuid.uuid4().hex[:12]
    journal('started', session=session, host=host, sourceHashes=before)

    def cli(*arguments, stdin=None):
        command = [*prefix, '--session', session, '--json', *arguments]
        code, stdout, stderr = run_captured(command, stdin=stdin)
        commands.append({'command': command, 'exitCode': code, 'stderr': stderr})
        result = json.loads(stdout) if stdout else {}
        if code or not result.get('success'):
            raise RuntimeError(f'Browser operation failed: {stdout}\n{stderr}')
        return result['data']

    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        cli('open', f'http://127.0.0.1:{server.server_address[1]}/examples/spillway/')
        cli('wait', '--fn', 'Boolean(window.spillway?.ready)')
        cli('screenshot', str((args.output / 'ready.png').resolve()))
        journal('ready')
        cli('eval', 'window.spillway.runBenchmark().then(result => window.spillwayReceipt = result).catch(error => window.benchmarkError = error.message); "started"')
        deadline, last = time.monotonic() + 600, ''
        while True:
            status = cli('eval', '({done:!!window.spillwayReceipt,error:window.benchmarkError,status:document.getElementById("status").textContent,tick:document.getElementById("tick").textContent})')['result']
            journal('progress', **status)
            if status['status'] != last:
                last = status['status']
                print(last, flush=True)
            if status.get('error'):
                raise RuntimeError(status['error'])
            if status['done']:
                break
            if time.monotonic() > deadline:
                raise TimeoutError('Spillway benchmark did not finish')
            time.sleep(3)
        receipt = cli('eval', 'window.spillwayReceipt')['result']
        cli('screenshot', str((args.output / 'completed.png').resolve()))
        errors = cli('errors').get('errors', [])
        host['gpuAfter'] = gpu_load()
        receipt.update(sourceHashes=before, sourceUnchanged=before == source_hashes(), commands=commands, browserErrors=errors, host=host)
        (args.output / 'frames.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
        journal('completed', locked60=receipt['locked60'], exactReplay=receipt['exactReplay'], sourceUnchanged=receipt['sourceUnchanged'])
        for row in receipt['rows']:
            print(f"{row['kind']}: {row['achievedHz']:.3f} Hz, p95 {row['frameMs']['p95']:.2f} ms, "
                  f"worst completion {row['completionDelayMs']['max']:.2f} ms, "
                  f"misses {row['deadlineMisses']}, CPU replay {row['cpuReplay']['exact']}", flush=True)
        return int(bool(errors) or not receipt['sourceUnchanged'] or not receipt['exactReplay'] or
                   (args.require_locked and not receipt['locked60']))
    except BaseException as error:
        journal('interrupted' if isinstance(error, KeyboardInterrupt) else 'failed', error=str(error))
        raise
    finally:
        try:
            cli('close')
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    raise SystemExit(main())
