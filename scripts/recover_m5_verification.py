"""Bounded M5 stages. Never clears the incident hold or runs legacy trajectories."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid
from scripts.verification_guard import ROOT, Lease, assert_recovery_enabled, assert_runtime_not_blocked
from scripts.verification_journal import durable_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=('typecheck', 'cpu-unit', 'review-unit', 'review-gpu', 'build', 'declarations', 'lint', 'cpu-control', 'cpu-cut', 'cpu-heat', 'cpu-ice', 'gpu-build', 'probe-build', 'shader-probe', 'gpu-tiny', 'gpu-active-tiny', 'gpu-trajectory', 'gpu-seams', 'level-pilot', 'gameplay-pilot', 'ui-pilot', 'frames', 'gpu-fallback', 'gpu-order', 'level-trajectory', 'scale-pilot', 'compatibility-unit', 'sdk-build'))
    parser.add_argument('--browser-executable', type=Path)
    parser.add_argument('--mode', choices=('dense', 'active'), default='dense')
    parser.add_argument('--reference', type=Path)
    parser.add_argument('--scene', choices=('control','cut','heat','ice-control','ice-heat'), default='control')
    parser.add_argument('--size', type=int, choices=(32,64,128), default=32)
    parser.add_argument('--ticks', type=int, choices=(32,64,256,512,768,1024), default=32)
    parser.add_argument('--resume',type=Path)
    parser.add_argument('--replay-part',choices=('all','main','restarts'),default='all')
    # Explicit CPU-only files: never the native parity or legacy trajectory suites.
    parser.add_argument('--test-file', choices=('contracts', 'cpu_physics', 'fidelity', 'mutations', 'pressure', 'structure_compiled', 'structure_public', 'validation', 'experimental/3d', 'experimental/world', 'experimental/active-world', 'experimental/gameplay', 'experimental/latency'))
    parser.add_argument('--sdk-entry', choices=('sdk', 'volume', 'volume-gpu', 'world', 'world-gpu', 'active-world', 'active-world-gpu'))
    args = parser.parse_args()
    # Refuse before source hashing, receipt creation, permit issuance or launch.
    assert_runtime_not_blocked(ROOT)
    if args.size==128 and args.stage not in ('scale-pilot','frames'): parser.error('128^3 requires the scale pilot before frame measurement')
    node = shutil.which('node')
    commands = {
        'typecheck': [node, 'node_modules/typescript/bin/tsc', '--noEmit', '-p', 'engine/tsconfig.json'],
        'cpu-unit': [node, 'node_modules/vitest/vitest.mjs', 'run', 'engine/experimental/structural-world.test.ts', '--config', 'engine/vitest.cpu.config.ts'],
        'review-unit': [node, 'node_modules/vitest/vitest.mjs', 'run', 'engine/experimental/structural-gameplay.test.ts', 'engine/experimental/structural-client.test.ts', '--config', 'engine/vitest.cpu.config.ts'],
        'build': [node, 'node_modules/vite/bin/vite.js', 'build', '--config', 'engine/vite.structural-world.config.ts'],
        'declarations': [node, 'node_modules/typescript/bin/tsc', '-p', 'engine/tsconfig.sdk.json'],
        'lint': [node, 'engine/lint_ts.mjs'],
        'gpu-build': [node, 'node_modules/vite/bin/vite.js', 'build', '--config', 'engine/vite.structural-world-gpu.config.ts'],
        'probe-build': [node, 'node_modules/vite/bin/vite.js', 'build', '--config', 'engine/vite.structural-probe.config.ts'],
    }
    out = ROOT / 'dist/volume-m5/recovery' / (args.stage + '-' + uuid.uuid4().hex[:8])
    command = commands.get(args.stage)
    kind = 'cpu'
    if args.stage == 'compatibility-unit':
        if args.test_file is None: parser.error('--test-file is required for one bounded compatibility file')
        command = [node, 'node_modules/vitest/vitest.mjs', 'run', f'engine/{args.test_file}.test.ts', '--config', 'engine/vitest.cpu.config.ts']
    elif args.stage == 'sdk-build':
        if args.sdk_entry is None: parser.error('--sdk-entry is required for one bounded SDK build')
        command = [node, 'node_modules/vite/bin/vite.js', 'build', '--config', f'engine/vite.{args.sdk_entry}.config.ts']
    elif args.stage == 'level-pilot':
        command = [node,'scripts/verify_volume_m5_level.mjs','--size',str(args.size),'--scene',args.scene,'--ticks',str(args.ticks),'--action-tick','16' if args.ticks<=64 else '180','--output',str(out/'evidence')]
        if args.resume:
            reference=args.resume.resolve();reference.relative_to(ROOT)
            if not (reference/'report.json').is_file(): parser.error('Missing CPU continuation receipt')
            command += ['--resume',str(reference)]
    elif args.stage in ('review-gpu', 'shader-probe', 'gpu-tiny', 'gpu-active-tiny', 'gpu-trajectory', 'gpu-seams', 'gameplay-pilot', 'ui-pilot', 'frames', 'gpu-fallback', 'gpu-order', 'level-trajectory', 'scale-pilot'):
        if not args.browser_executable or not args.browser_executable.is_file():
            parser.error('--browser-executable must identify an installed Chromium or Edge executable')
        # Correctness probes are CPU-capped and below normal priority. Timed
        # display frames use the existing bounded frame policy, as M4 does.
        kind = 'frames' if args.stage=='frames' else 'gpu'
        command = [sys.executable, '-m', 'scripts.verify_volume_m5_browser', '--browser-executable', str(args.browser_executable.resolve()), '--output', str(out / 'evidence')]
        command += ['--probe', {'review-gpu':'review','shader-probe':'compile','gpu-tiny':'tiny','gpu-active-tiny':'active-tiny','gpu-trajectory':'trajectory','gpu-seams':'seams','gameplay-pilot':'gameplay','ui-pilot':'ui','frames':'frames','gpu-fallback':'fallback','gpu-order':'order','level-trajectory':'level-trajectory','scale-pilot':'scale'}[args.stage]]
        if args.stage in ('gameplay-pilot','ui-pilot','frames','level-trajectory','scale-pilot'):
            command += ['--mode',args.mode,'--size',str(args.size),'--scene',args.scene]
        if args.stage == 'gpu-seams':
            command += ['--mode', args.mode]
        if args.stage in ('gpu-trajectory','level-trajectory'):
            if not args.reference or not (args.reference / 'report.json').is_file():
                parser.error('--reference must contain retained Node evidence')
            reference = args.reference.resolve()
            reference.relative_to(ROOT)
            prior = json.loads((reference / 'report.json').read_text())
            if not prior.get('passed') or prior.get('ticks') != 1024:
                parser.error('Node trajectory did not pass')
            command += ['--mode', args.mode, '--reference', str(reference)]
            if args.stage=='level-trajectory': command += ['--replay-part',args.replay_part]
    elif command is None:
        command = [node, 'scripts/verify_volume_m5_cpu.mjs', '--scene', args.stage[4:], '--output', str(out / 'evidence')]
    timeout = 120 if args.stage in ('gpu-trajectory','level-trajectory','level-pilot','frames') or args.stage.startswith('cpu-') and args.stage != 'cpu-unit' else 60
    paths = list((ROOT / 'engine').rglob('*.ts')) + [Path(__file__).resolve(), ROOT / 'package.json',
        ROOT / 'engine/lint_ts.mjs', ROOT / 'engine/tsconfig.json', ROOT / 'engine/tsconfig.sdk.json',
        ROOT / 'scripts/verify_volume_m5_cpu.mjs', ROOT / 'scripts/verify_volume_m5_browser.py']
    paths += [p for p in (ROOT/'examples/structural-cavern').glob('*') if p.suffix in ('.js','.html','.css')] + [ROOT/'scripts/verify_volume_m5_level.mjs']
    paths += [ROOT/'examples/structural-cavern/README.md', ROOT/'web/frame-pump.js', ROOT/'web/frame-clock.js']
    paths += [ROOT/'scripts'/name for name in ('verification_browser.py', 'verification_browser.mjs',
        'verification_journal.py', 'verification_watchdog.py', 'verification_guard.py',
        'verification_guard.mjs', 'verification_health.py')]
    if args.stage.startswith('cpu-') and args.stage != 'cpu-unit':
        paths += [ROOT / 'dist/sdk/state-space-structural-world.js']
    if args.stage=='level-pilot':
        paths += [ROOT/'dist/sdk/state-space-structural-world.js']
    if kind == 'gpu':
        paths += [ROOT / 'dist/volume-m5/structural-probe.js']
    if args.stage in ('review-gpu','gameplay-pilot','ui-pilot','frames','level-trajectory','scale-pilot'):
        paths += list((ROOT/'dist/sdk').glob('*.js'))
        paths += [ROOT/'web/frame-pump.js',ROOT/'web/frame-clock.js']
    if args.stage in ('gpu-trajectory','level-trajectory') or args.stage=='level-pilot' and args.resume:
        paths += list(reference.glob('*'))
    if args.size==128:
        if not args.reference or not (args.reference/'report.json').is_file(): parser.error('128^3 requires a preceding bounded GPU receipt')
        reference=args.reference.resolve();reference.relative_to(ROOT)
        prior=json.loads((reference/'report.json').read_text());receipt=json.loads((reference.parent/'report.json').read_text())
        result=prior.get('result',{})
        if not prior.get('passed') or not receipt.get('passed') or not receipt.get('sourceUnchanged'): parser.error('Preceding stage did not pass')
        if args.stage=='scale-pilot' and (prior.get('probe')!='level-trajectory' or result.get('size')!=64 or result.get('part')!='main'): parser.error('Scale pilot requires a passing 64^3 uninterrupted GPU trajectory')
        if args.stage=='frames' and (prior.get('probe')!='scale' or result.get('size')!=128 or result.get('scenario')!=args.scene): parser.error('128^3 frames require the matching eight-frame scale pilot')
        critical=['engine/experimental/structural-world-gpu.ts','engine/experimental/structural-shader.ts','engine/experimental/structural-active-shader.ts','dist/sdk/state-space-structural-world-gpu.js','examples/structural-cavern/scene.js']
        if args.stage=='frames': critical += ['examples/structural-cavern/app.js','examples/structural-cavern/benchmark.js','examples/structural-cavern/scale-probe.js']
        for name in critical:
            if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=receipt['sourceHashes'].get(name): parser.error('GPU/scene source changed after the preceding scale gate')
        paths += list(reference.glob('*')) + [reference.parent/'report.json']
    hashes = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    out.mkdir(parents=True)
    start = {'version': 1, 'stage': args.stage, 'status': 'started', 'passed': False,
             'startedAt': time.time(), 'sourceHashes': hashes, 'command': command,
             'kind': kind, 'timeoutSeconds': timeout, 'stallSeconds': 15,
             'browserExecutable': str(args.browser_executable.resolve()) if kind != 'cpu' else None,
             'configuration': {key: str(value) if isinstance(value, Path) else value for key, value in vars(args).items()},
             'scope': 'One bounded stage; a start record never establishes completion'}
    durable_json(out / 'start.json', start)
    durable_json(out / 'report.json', {**start, 'status': 'incomplete', 'sourceUnchanged': False})
    with Lease():
        hold = ROOT / 'dist/verification/safety-hold.json'
        state = json.loads(hold.read_text(encoding='utf-8'))
        assert_recovery_enabled(state)
        state['recoveryPermit'] = {'command': command, 'kind': kind, 'timeoutSeconds': timeout,
                                  'expiresAt': time.time() + 60, 'stage': 'm5-' + args.stage,
                                  'reason': 'Bounded M5 development stage; no legacy workload'}
        durable_json(hold, state)
    supervisor = out / 'supervisor'
    result = subprocess.run([sys.executable, '-m', 'scripts.verification_guard', '--kind', kind,
                             '--timeout', str(timeout), '--stall', '15', '--output', str(supervisor),
                             *(['--structured-progress'] if kind != 'cpu' else []), '--', *command], cwd=ROOT)
    report = json.loads((supervisor / 'report.json').read_text(encoding='utf-8'))
    unchanged = all(hashlib.sha256((ROOT / p).read_bytes()).hexdigest() == h for p, h in hashes.items())
    receipt = {'stage': args.stage, 'passed': result.returncode == 0 and report['passed'] and unchanged,
               'startManifest': 'start.json', 'startManifestSha256': hashlib.sha256((out/'start.json').read_bytes()).hexdigest(),
               'sourceHashes': hashes, 'sourceUnchanged': unchanged,
               'supervisor': str((supervisor / 'report.json').relative_to(ROOT)),
               'holdRemainsActive': hold.exists()}
    evidence = out / 'evidence/report.json'
    if evidence.exists():
        receipt['evidence'] = str(evidence.relative_to(ROOT))
        receipt['passed'] &= json.loads(evidence.read_text(encoding='utf-8')).get('passed') is True
    elif kind != 'cpu':
        receipt['passed'] = False
        receipt['error'] = 'Browser stage did not retain its evidence receipt'
    durable_json(out / 'report.json', receipt)
    print(json.dumps({k: v for k, v in receipt.items() if k != 'sourceHashes'}), flush=True)
    return int(not receipt['passed'])


if __name__ == '__main__':
    raise SystemExit(main())
