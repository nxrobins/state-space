"""Verify hardware WebGPU, the live lab UI and installed SDK parity in a real browser."""

import argparse
import functools
import hashlib
import http.server
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from engine.verify import ROOT, source_hashes


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_captured(command, *, stdin=None, timeout=60):
    # Daemon descendants may inherit output handles. A finite file read does not
    # wait for those descendants after the direct child exits.
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        result = subprocess.run(command, cwd=ROOT, input=stdin, stdout=out, stderr=err, text=True,
                                encoding='utf-8', errors='replace', timeout=timeout, check=False)
        out.seek(0)
        err.seek(0)
        return result.returncode, out.read().decode('utf-8', errors='replace'), err.read().decode('utf-8', errors='replace')


def validate_browser_evidence(results, corpus, sdk):
    """Missing, software-only or partial browser results cannot close a release."""
    conformance = results['conformance']
    if len(corpus) < 31 or len({scene['name'] for scene in corpus}) != len(corpus):
        raise ValueError('Fresh native corpus is incomplete or ambiguous')
    expected = [(scene['name'], len(scene['passes'])) for scene in corpus]
    observed = [(scene['name'], scene['passComparisons']) for scene in conformance['rows']]
    if conformance['passed'] is not True or observed != expected or conformance['caseCount'] != len(corpus):
        raise ValueError('Browser corpus coverage is incomplete')
    if conformance['passComparisons'] != sum(count for _, count in expected):
        raise ValueError('Browser pass count is incomplete')
    if conformance['backendInfo']['isFallbackAdapter'] is not False:
        raise ValueError('Hardware WebGPU evidence is required')
    for row, native in zip(conformance['rows'], corpus):
        for flag in ('completeReportsMatch', 'uninspectedMatch', 'restartMatch'):
            if row[flag] is not True:
                raise ValueError('Browser per-pass or restart proof is incomplete')
        frame = native['passes'][-1]
        for key, source in (('packedCells', 'cells'), ('energyQ', 'energyQ'), ('structure', 'structure')):
            if row['final'][key] != frame[source]:
                raise ValueError('Browser/native complete final state differs')
    lab = results['lab']
    if lab['passed'] is not True or lab['sceneCount'] != 5 or [row['scene'] for row in lab['rows']] != ['span', 'fragment', 'fire', 'phase', 'extension']:
        raise ValueError('Live showcase coverage is incomplete')
    for row in lab['rows']:
        if row['backendInfo']['isFallbackAdapter'] is not False or any(row[flag] is not True for flag in ('reportsMatch', 'restartMatch', 'invalidImportRejected', 'concurrentStepsSerialized')):
            raise ValueError('Live showcase behavior proof is incomplete')
    ui = results['ui']
    if ui['passed'] is not True or any(ui[flag] is not True for flag in ('snapshotControls', 'customFileImport', 'playback')) or ui['inspectedPasses'] != 18:
        raise ValueError('Live UI proof is incomplete')
    browser = results['sdk']
    for key in ('catalogHash', 'initial', 'final', 'energyQ', 'replayEqual', 'passes'):
        if browser[key] != sdk['nativeClient'][key]:
            raise ValueError(f'Installed native/browser SDK difference: {key}')
    for flag in ('replayEqual', 'passDeltasMatch', 'invalidRestoreRejected', 'concurrentAccessRejected'):
        if browser[flag] is not True:
            raise ValueError('SDK behavior proof is incomplete')
    if browser['backendInfo']['isFallbackAdapter'] is not False:
        raise ValueError('Hardware SDK evidence is required')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--sdk-report', type=Path, required=True)
    parser.add_argument('--browser-cli', default=os.environ.get('STATE_SPACE_BROWSER_CLI'))
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    before = source_hashes()
    report = {'reportVersion': 1, 'startedAt': datetime.now(timezone.utc).isoformat(), 'sourceHashes': before,
              'passed': False, 'commands': [], 'artifacts': {}}
    server = None
    prefix = None
    session = 'state-space-' + uuid.uuid4().hex[:12]

    def execute(command, *, stdin=None, timeout=60):
        code, stdout, stderr = run_captured(command, stdin=stdin, timeout=timeout)
        report['commands'].append({'command': [str(value) for value in command], 'exitCode': code,
                                   'stdoutSha256': hashlib.sha256(stdout.encode('utf-8')).hexdigest(), 'stderr': stderr})
        if code != 0:
            raise RuntimeError(f'Browser command failed: {command}\n{stdout}\n{stderr}')
        return stdout

    def cli(*arguments, stdin=None):
        result = json.loads(execute([*prefix, '--session', session, '--json', *arguments], stdin=stdin))
        if result.get('success') is not True:
            raise RuntimeError(f'Browser operation failed: {result}')
        return result['data']

    def save(name, value):
        path = output / name
        path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n', encoding='utf-8')
        return value

    def job(name, expression):
        script = ('window.__releaseJob = {done:false}; window.__releaseProgress = null; '
                  f'void (async () => ({expression}))().then(result => {{window.__releaseJob={{done:true,result}};}}, '
                  'error => {window.__releaseJob={done:true,error:String(error.stack || error)};}); "started"')
        cli('eval', '--stdin', stdin=script)
        deadline = time.monotonic() + 240
        while True:
            state = cli('eval', '({done:window.__releaseJob.done,error:window.__releaseJob.error})')['result']
            if state['done']:
                if state.get('error'):
                    raise RuntimeError(state['error'])
                return save(name + '.json', cli('eval', 'window.__releaseJob.result')['result'])
            if time.monotonic() > deadline:
                raise TimeoutError(f'Browser job did not complete: {name}')
            time.sleep(1)

    try:
        executable = args.browser_cli or shutil.which('agent-browser')
        if not executable:
            raise RuntimeError('agent-browser is required. Set STATE_SPACE_BROWSER_CLI or pass --browser-cli with its executable or bin/agent-browser.js path.')
        path = Path(executable).resolve()
        prefix = [shutil.which('node'), str(path)] if path.suffix in ('.js', '.mjs') else [str(path)]
        if not path.is_file() or any(value is None for value in prefix):
            raise RuntimeError('Browser CLI or Node executable is unavailable')
        report['browserCliSha256'] = digest(path)
        report['browserCliVersion'] = execute([*prefix, '--version']).strip()
        bundle = ROOT / 'dist/sdk/state-space.js'
        report['browserBundleHash'] = digest(bundle)
        sdk = json.loads(args.sdk_report.read_text(encoding='utf-8'))
        if sdk.get('passed') is not True or sdk.get('browserBundleHash') != digest(bundle):
            raise ValueError('A successful SDK package report for the current browser bundle is required')
        report['sdkReportSha256'] = digest(args.sdk_report)
        native = execute([sys.executable, '-m', 'engine.conformance'], timeout=180)
        corpus = json.loads(native)
        save('native.json', corpus)

        class Handler(http.server.SimpleHTTPRequestHandler):
            def translate_path(self, path):
                if path.split('?', 1)[0] == '/evidence/native.json':
                    return str(output / 'native.json')
                return super().translate_path(path)

            def log_message(self, *_args):
                pass

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_address[1]}'
        cli('open', base + '/examples/lab/')
        cli('wait', '--fn', 'Boolean(window.engineLab?.controller.view)')
        save('lab-initial-snapshot.json', cli('snapshot', '-i'))
        cli('screenshot', '--full', str(output / 'lab-initial.png'))
        cli('eval', 'document.getElementById("step").scrollIntoView({block:"center"})')
        cli('find', 'role', 'button', 'click', '--name', 'Step 1 tick')
        if cli('eval', 'window.engineLab.controller.view.snapshot.tick')['result'] != 1:
            raise ValueError('The actual Step button did not advance the field')
        results = {}
        print('Browser: live UI', flush=True)
        results['ui'] = job('ui', "await (await import('/examples/lab/verify.js')).verifyLabUI()")
        cli('screenshot', '--full', str(output / 'lab-final.png'))
        print('Browser: live CPU/WebGPU scenarios', flush=True)
        results['lab'] = job('lab', "await (await import('/examples/lab/verify.js')).verifyLab(value => {window.__releaseProgress=value;})")
        print('Browser: fresh native corpus', flush=True)
        results['conformance'] = job('conformance', "await (await import('/scripts/browser_conformance.js')).verifyBrowserCorpus('/evidence/native.json', value => {window.__releaseProgress=value;})")
        save('lab-errors.json', cli('errors'))
        cli('open', base + '/examples/sdk/browser.html')
        cli('wait', '--fn', 'Boolean(window.sdkExample)')
        print('Browser: installed SDK parity', flush=True)
        results['sdk'] = job('sdk', 'await window.sdkExample.verify()')
        save('sdk-errors.json', cli('errors'))
        for name in ('lab-errors.json', 'sdk-errors.json'):
            errors = json.loads((output / name).read_text(encoding='utf-8'))
            if errors.get('errors'):
                raise ValueError(f'Browser page errors: {errors}')
        validate_browser_evidence(results, corpus, sdk)
        report['caseCount'] = len(corpus)
        report['passComparisons'] = results['conformance']['passComparisons']
        report['sceneCount'] = results['lab']['sceneCount']
        report['backendInfo'] = results['conformance']['backendInfo']
        report['sourceUnchangedDuringVerification'] = before == source_hashes() and report['browserBundleHash'] == digest(bundle)
        if not report['sourceUnchangedDuringVerification']:
            raise ValueError('Source or browser bundle changed during verification')
        report['passed'] = True
    except Exception as error:
        report['error'] = f'{type(error).__name__}: {error}'
        print(report['error'], flush=True)
    finally:
        if prefix:
            try:
                cli('close')
            except Exception as error:
                report['cleanupError'] = str(error)
                report['passed'] = False
        if server:
            server.shutdown()
            server.server_close()
        report['finishedAt'] = datetime.now(timezone.utc).isoformat()
        report['artifacts'] = {path.name: digest(path) for path in sorted(output.iterdir()) if path.is_file() and path.name != 'report.json'}
        save('report.json', report)
    print(f'Browser report: {output / "report.json"}', flush=True)
    return int(not report['passed'])


if __name__ == '__main__':
    raise SystemExit(main())
