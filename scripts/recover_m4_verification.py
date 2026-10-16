"""Explicit staged recovery. The incident hold remains active between stages.

Each stage gets a short-lived permit for one exact command. No legacy demo or
aggregate native suite is part of recovery. Run one stage at a time; inspect its
receipt before advancing. This reduces exposure; it cannot rule out a kernel or
hardware hang that prevents the supervisor itself from running.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid
from scripts.verification_guard import ROOT, Lease


STAGES = ('heat-probe', 'haze-probe', 'optics-probe', 'appearance-probe', 'appearance-replay', 'frames128beauty', 'appearance-timing', 'appearance-ui', 'gameplay-probe', 'gameplay128', 'frames128gpu', 'timing128gpu', 'ui-gpu', 'cpu-smoke', 'cpu-reference', 'receipt-tests', 'unit', 'probe', 'gate64', 'continuation128', 'frames32', 'frames64', 'frames128', 'timing128', 'diagnostic128', 'ui', 'lint', 'typecheck', 'build', 'sdk', 'publish')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=STAGES)
    parser.add_argument('--browser-cli', type=Path)
    args = parser.parse_args()
    stage = args.stage
    base = ROOT / 'dist/volume-m4/recovery'
    base.mkdir(parents=True, exist_ok=True)
    # UI correctness depends on a fresh exactness proof, not a timing pass.
    # The frame gates remain strict; publication retains timing failures.
    previous = {'heat-probe':'haze-probe', 'haze-probe':'optics-probe', 'optics-probe':'appearance-probe', 'appearance-probe':'probe', 'appearance-replay':'appearance-probe', 'frames128beauty':'appearance-replay', 'appearance-timing':'appearance-replay', 'appearance-ui':'appearance-replay', 'gameplay-probe':'probe', 'gameplay128':'continuation128', 'frames128gpu':'gameplay128', 'timing128gpu':'gameplay128', 'ui-gpu':'gameplay128', 'unit': 'cpu-smoke', 'cpu-reference': 'unit', 'probe': 'unit', 'gate64': 'probe', 'frames32': 'gate64', 'frames64': 'frames32',
                'continuation128': 'frames64', 'frames128': 'continuation128', 'timing128': 'continuation128', 'diagnostic128': 'continuation128', 'ui': 'continuation128', 'sdk': 'probe', 'publish': 'sdk'}.get(stage)
    prerequisites=([previous] if previous else [])+(['gameplay-probe'] if stage=='gameplay128' else [])+(['optics-probe','haze-probe','heat-probe'] if stage=='appearance-replay' else [])
    for previous in prerequisites:
        receipt = json.loads((base / (previous + '.json')).read_text(encoding='utf-8'))
        if not receipt.get('passed'):
            raise RuntimeError(f'Previous recovery stage {previous} did not pass.')
        if previous in ('heat-probe', 'haze-probe', 'optics-probe', 'appearance-probe', 'appearance-replay', 'probe', 'gate64', 'frames32', 'frames64', 'continuation128', 'frames128', 'gameplay-probe', 'gameplay128'):
            prior = json.loads((ROOT / receipt['evidence']).read_text(encoding='utf-8'))
            for name in ('3d-gpu-core.ts', '3d-shader.ts', 'active-shader.ts', 'world-renderer.ts', 'cavern-appearance.ts', 'cavern-optics.ts', 'cavern-haze.ts', 'rock-textures.ts', '3d-view.ts', 'active-world-gpu.ts', '3d-renderer.ts', 'latency.ts', 'gameplay-gpu.ts', 'gameplay-shader.ts', 'gameplay-view.ts'):
                path = 'engine/experimental/' + name
                if prior['sourceHashes'].get(path) != hashlib.sha256((ROOT / path).read_bytes()).hexdigest():
                    raise RuntimeError(f'{previous} is stale for {path}; repeat the bounded prerequisite first.')
    out = base / (stage + '-' + uuid.uuid4().hex[:8])
    out.mkdir()
    node = shutil.which('node')
    kind = 'cpu'; timeout = 120
    if stage == 'cpu-smoke':
        program = '''import assert from 'node:assert/strict';
import {createStateSpaceActiveWorld3D,MAT} from './dist/sdk/state-space-active-world.js';
const w=createStateSpaceActiveWorld3D({width:8,height:8,depth:8,chunkSize:4});
w.setCell(3,1,3,MAT.SAND,20);const initial=w.snapshot();
for(let i=0;i<16;i++){w.step();console.log('CPU recovery tick',i+1);await new Promise(r=>setTimeout(r,20));}
const end=w.snapshot();w.restore(initial);for(let i=0;i<16;i++){w.step();await new Promise(r=>setTimeout(r,20));}
assert.deepEqual(w.snapshot(),end);assert.equal(w.energyBalance().driftQ,0n);console.log('Tiny CPU replay exact');'''
        command = [node, '--input-type=module', '-e', program]; timeout = 15
    elif stage == 'cpu-reference':
        command = [node, 'scripts/verify_volume_m4.mjs', '--compare-game-refactor', '--output', (out / 'evidence').relative_to(ROOT).as_posix()]; timeout = 600
    elif stage == 'receipt-tests':
        command = [sys.executable, '-m', 'unittest', 'tests.test_volume_latency_report']; timeout = 15
    elif stage == 'unit':
        command = [node, 'scripts/verify_checks.mjs', '--suite', 'unit']
    elif stage in ('heat-probe', 'haze-probe', 'optics-probe', 'appearance-probe', 'appearance-replay', 'frames128beauty', 'appearance-timing', 'gameplay-probe', 'gameplay128', 'frames128gpu', 'timing128gpu', 'probe', 'gate64', 'continuation128', 'frames32', 'frames64', 'frames128', 'timing128', 'diagnostic128'):
        if not args.browser_cli or not args.browser_cli.is_file():
            parser.error('--browser-cli must identify the installed browser CLI')
        kind = 'frames' if stage.startswith('frames') or stage in ('timing128','diagnostic128','timing128gpu','appearance-timing') else 'gpu'
        timeout = 120
        command = [sys.executable, '-m', 'scripts.verify_volume_m4_browser', '--browser-cli',
                   str(args.browser_cli.resolve()), '--phase', 'frames128beauty' if stage=='appearance-timing' else 'frames128gpu' if stage=='timing128gpu' else 'frames128' if stage in ('timing128','diagnostic128','timing128gpu','appearance-timing') else stage, '--output', str(out / 'evidence')]
        if stage in ('timing128','diagnostic128','timing128gpu','appearance-timing'): command.append('--gpu-timing')
        if stage=='diagnostic128': command.append('--devtools-trace')
    elif stage in ('ui','ui-gpu','appearance-ui'):
        if not args.browser_cli or not args.browser_cli.is_file():
            parser.error('--browser-cli must identify the installed browser CLI')
        kind = 'gpu'
        command = [sys.executable, '-m', 'scripts.verify_active_cavern_ui', '--browser-cli',
                   str(args.browser_cli.resolve()), '--output', str(out / 'evidence')]
        if stage in ('ui-gpu','appearance-ui'): command.append('--resident-gameplay')
    elif stage == 'lint':
        command = [node, 'engine/lint_ts.mjs']
    elif stage == 'typecheck':
        command = [node, 'node_modules/typescript/bin/tsc', '--noEmit', '-p', 'engine/tsconfig.json']
    elif stage == 'build':
        command = [shutil.which('npm.cmd' if sys.platform == 'win32' else 'npm'), 'run', 'build:sdk']
    elif stage == 'publish':
        command = [sys.executable, '-m', 'scripts.publish_volume_m4']
    else:
        kind = 'gpu'; timeout = 300
        command = [sys.executable, '-m', 'scripts.verify_sdk', '--report', str(out / 'evidence/report.json')]
    with Lease():
        hold = ROOT / 'dist/verification/safety-hold.json'
        state = json.loads(hold.read_text(encoding='utf-8'))
        state['recoveryPermit'] = {'command': command, 'kind': kind, 'timeoutSeconds': timeout,
                                  'expiresAt': time.time() + 60, 'stage': stage,
                                  'reason': 'Staged recovery after quarantine and supervisor regression checks'}
        hold.write_text(json.dumps(state, indent=2) + '\n', encoding='utf-8')
    supervisor = out / 'supervisor'
    result = subprocess.run([sys.executable, '-m', 'scripts.verification_guard', '--kind', kind,
                             '--timeout', str(timeout), '--stall', '30' if stage == 'sdk' else '15', '--output', str(supervisor),
                             '--', *command], cwd=ROOT)
    report = json.loads((supervisor / 'report.json').read_text(encoding='utf-8'))
    passed = result.returncode == 0 and report['passed']
    evidence = out / 'evidence/report.json'
    performance = None
    if evidence.exists():
        verification = json.loads(evidence.read_text(encoding='utf-8'))
        passed &= verification.get('passed', False)
        performance = verification.get('performancePassed')
        if stage.startswith('frames'):
            passed &= performance is True
    record = {'stage': stage, 'passed': passed, 'performancePassed': performance,
              'supervisor': str((supervisor / 'report.json').relative_to(ROOT)),
              'supervisorSha256': hashlib.sha256((supervisor / 'report.json').read_bytes()).hexdigest(),
              'evidence': str(evidence.relative_to(ROOT)) if evidence.exists() else None,
              'holdRemainsActive': (ROOT / 'dist/verification/safety-hold.json').exists()}
    (base / (stage + '.json')).write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    if stage=='cpu-reference' and passed:
        shutil.copyfile(evidence,ROOT / 'dist/volume-m4/node128/report.json')
    print(json.dumps(record, indent=2), flush=True)
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
