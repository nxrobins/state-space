"""Run one fixed native Metal validation stage under the verification supervisor."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib
import json
import os
import re
import shutil
import subprocess
import sys
import uuid

from scripts.verification_guard import ROOT, guarded_entry
from scripts.verification_metal import STAGES, bounded_corpus


def adapter_probe():
    import wgpu
    adapter = wgpu.gpu.request_adapter_sync(power_preference='high-performance')
    if adapter is None:
        raise RuntimeError('No native GPU adapter is available.')
    info = dict(adapter.info)
    if info.get('backend_type') != 'Metal' or info.get('adapter_type') not in ('IntegratedGPU', 'DiscreteGPU'):
        raise RuntimeError(f'A native hardware Metal adapter is required: {info}')
    device = adapter.request_device_sync()
    buffer = None
    try:
        import struct
        expected = struct.pack('<4I', 0, 1, 0xffffffff, 123456)
        buffer = device.create_buffer_with_data(data=expected, usage=wgpu.BufferUsage.COPY_SRC)
        if bytes(device.queue.read_buffer(buffer)) != expected:
            raise RuntimeError('Native Metal buffer roundtrip differs.')
    finally:
        if buffer is not None:
            buffer.destroy()
        device.destroy()
    return {'info': info, 'bufferRoundtrip': True}


def reference(command, out, name, timeout):
    # Files retain partial evidence even if the subprocess reaches its deadline.
    with (out / (name + '.stdout.log')).open('wb') as stdout, (out / (name + '.stderr.log')).open('wb') as stderr:
        return subprocess.run(command, cwd=ROOT, stdout=stdout, stderr=stderr, timeout=timeout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', choices=STAGES, required=True)
    args = parser.parse_args()
    guarded_entry('metal-smoke', 60 if args.stage == 'conformance' else 30,
                  module='scripts.verify_macos_native')
    if os.environ.get('STATE_SPACE_VERIFICATION_KIND') != 'metal-smoke':
        raise RuntimeError('The native Metal probe requires its bounded supervisor profile.')
    os.environ['WGPU_BACKEND_TYPE'] = 'Metal'
    out = ROOT / 'dist/verification' / ('native-metal-' + args.stage + '-' + uuid.uuid4().hex[:12])
    out.mkdir(parents=True, exist_ok=False)
    paths = sorted([*ROOT.glob('engine/**/*.py'), *ROOT.glob('engine/**/*.wgsl'),
                    *ROOT.glob('engine/**/*.wasm'), *ROOT.glob('engine/**/*.ts'), *ROOT.glob('engine/**/*.json'),
                    *ROOT.glob('examples/sdk/*'), ROOT / 'package.json', ROOT / 'package-lock.json', ROOT / 'uv.lock',
                    ROOT / 'scripts/verify_macos_native.py', ROOT / 'scripts/verification_metal.py',
                    ROOT / 'scripts/verification_guard.py', ROOT / 'dist/sdk/state-space.js'])
    def hashes():
        return {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in paths if p.is_file()}
    before = hashes()
    report = {'scope': 'bounded native Metal ' + args.stage, 'passed': False,
              'releaseAccepted': False, 'startedAt': datetime.now(timezone.utc).isoformat(),
              'sourceHashes': before, 'supervisorJob': os.environ['STATE_SPACE_VERIFICATION_JOB'],
              'gpuTelemetryAvailable': False}
    def save():
        (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    save()
    try:
        print('Checking native Metal adapter and buffer readback.', flush=True)
        report['adapter'] = adapter_probe()
        save()
        if args.stage == 'sdk':
            native = importlib.import_module('examples.sdk.native').run()
            command = [shutil.which('node'), 'examples/sdk/node.mjs']
            (out / 'native-sdk.json').write_text(json.dumps(native, indent=2) + '\n')
            result = reference(command, out, 'node', 10)
            if result.returncode:
                raise RuntimeError('The public JavaScript SDK reference failed.')
            cpu = json.loads((out / 'node.stdout.log').read_text())
            if native != cpu or any(p['deltaQ'] != '0' for p in native['passes']):
                raise RuntimeError('Native Metal and JavaScript SDK state or pass reports differ.')
            report['sdk'] = {'passes': len(native['passes']), 'completeStateExact': True,
                             'restartExact': native['replayEqual'], 'energyDriftQ': '0', 'native': native}
        elif args.stage == 'conformance':
            from engine.conformance import conformance_cases
            report['bounds'] = bounded_corpus(conformance_cases())
            save()
            command = [shutil.which('node'), 'node_modules/vitest/vitest.mjs', 'run',
                       'engine/conformance.test.ts', '--config', 'engine/vitest.config.ts']
            print('Checking bounded native/CPU corpus: ' + json.dumps(report['bounds']), flush=True)
            result = reference(command, out, 'conformance', 50)
            print((out / 'conformance.stdout.log').read_text(), flush=True)
            if result.returncode:
                print((out / 'conformance.stderr.log').read_text(), file=sys.stderr, flush=True)
                raise RuntimeError('Native Metal/CPU conformance failed; inspect retained logs.')
            evidence = re.search(r'Conformance: (\d+) scenes, (\d+) pass comparisons, (\d+) pipeline variants\.',
                                 (out / 'conformance.stdout.log').read_text())
            if evidence is None or int(evidence[1]) != report['bounds']['cases']:
                raise RuntimeError('Conformance finished without the required coverage evidence.')
            report['conformance'] = {'passed': True, 'command': command, 'scenes': int(evidence[1]),
                                     'passComparisons': int(evidence[2]), 'pipelineVariants': int(evidence[3])}
        report['sourceUnchanged'] = before == hashes()
        if not report['sourceUnchanged']:
            raise RuntimeError('Sources changed during native verification.')
        report['passed'] = True
    except Exception as error:
        report['error'] = str(error)
    finally:
        report['finishedAt'] = datetime.now(timezone.utc).isoformat()
        save()
        print('Native report: ' + str(out / 'report.json'), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
