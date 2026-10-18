"""Record a CPU-only quiet gate and exact bounded-stage inputs; launches no workload."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re
import sys
import time

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
PREVIOUS = OUT.parent / 'validation-08-2026-10-17'
sys.path.insert(0, str(ROOT))
from scripts.verification_health import HostHealth


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def main():
    stage, attempt = sys.argv[1:]
    if stage not in ('tests', 'typecheck', 'lint') or not re.fullmatch({'tests': r'attempt-\d+', 'typecheck': r'typecheck-\d+', 'lint': r'lint-\d+'}[stage], attempt):
        raise ValueError('Only bounded edit/inert tests, no-emit types or lint are allowed')
    gate_path = OUT / ('quiet-window-' + attempt + '.json')
    folder = OUT / attempt
    if gate_path.exists() or folder.exists():
        raise ValueError('Refusing to overwrite a previous gate or attempt')
    hold = json.loads((ROOT / 'dist/verification/safety-hold.json').read_text())
    if not hold['blockRecovery'] or 'recoveryPermit' in hold:
        raise ValueError('Runtime hold must remain intact')
    prior = json.loads((PREVIOUS / 'summary.json').read_text())
    for name, expected in prior['protectedSourceHashes'].items():
        if digest(ROOT / name) != expected:
            raise ValueError('Protected physical/configuration source changed: ' + name)
    runner = 'run_tests.py' if stage == 'tests' else 'run_cpu_stage.py'
    if not (OUT / runner).exists():
        (OUT / runner).write_bytes((PREVIOUS / runner).read_bytes())
    if digest(OUT / runner) != digest(PREVIOUS / runner):
        raise ValueError('Reviewed launcher differs')
    gate = {'purpose': 'Build 9 bounded CPU ' + stage, 'requiredSamples': 10,
            'maxHostCpuPercent': 20, 'minFreeMemoryMiB': 8192, 'samples': [], 'passed': False}
    health = HostHealth()
    health.sample()
    for _ in range(10):
        time.sleep(1)
        sample = health.sample()
        gate['samples'].append(sample)
        if sample['hostCpuPercent'] is None or sample['hostCpuPercent'] > 20 or sample['freeMemoryMiB'] < 8192:
            break
    gate['passed'] = len(gate['samples']) == 10 and all(s['hostCpuPercent'] is not None and s['hostCpuPercent'] <= 20 and s['freeMemoryMiB'] >= 8192 for s in gate['samples'])
    gate['finishedAt'] = time.time()
    gate_path.write_text(json.dumps(gate, indent=2) + '\n')
    if not gate['passed']:
        raise RuntimeError('Quiet gate failed; no workload authorized or launched')
    folder.mkdir()
    node = r'C:\Program Files\nodejs\node.exe'
    commands = {
        'tests': [node, '--max-old-space-size=256', str(ROOT / 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'engine/vitest.tactical-session.config.ts', '--bail=1', '--reporter=verbose', '--reporter=json', '--outputFile.json=' + str(folder / 'vitest.json')],
        'typecheck': [node, '--max-old-space-size=512', str(ROOT / 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'engine/tsconfig.json'],
        'lint': [node, '--max-old-space-size=512', 'engine/lint_ts.mjs'],
    }
    names = set(prior['lintedSourceHashes']) | set(prior['testedSourceHashes']) | set(prior['typecheckedSourceHashes'])
    names.update(p.relative_to(ROOT).as_posix() for p in (ROOT / 'engine').rglob('*.ts'))
    names.update([Path(__file__).relative_to(ROOT).as_posix(), (OUT / runner).relative_to(ROOT).as_posix()])
    count = len(re.findall(r"^\s*test\('", (ROOT / 'engine/experimental/terrain-body.test.ts').read_text(), re.M)) + 12
    source = {name: digest(ROOT / name) for name in sorted(names)}
    manifest = {
        'scope': 'Active wishlist: bounded edit/inert CPU and static checks only; SDK deferred; real physics/GPU/replay/benchmarks held',
        'stage': 'selected-edit-inert-tests' if stage == 'tests' else stage,
        'issuedAt': datetime.now(timezone.utc).isoformat(), 'expiresAt': time.time() + 300,
        'timeoutSeconds': 30, 'command': commands[stage], 'sourceHashes': source,
        'quietGate': gate_path.name, 'quietGateSHA256': digest(gate_path),
    }
    if stage == 'tests':
        manifest['expectedTests'] = 201 + count
    (folder / 'authorization.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'gatePassed': True, 'maxHostCpuPercent': max(s['hostCpuPercent'] for s in gate['samples']), 'stage': stage, 'newBodyTests': count, 'expectedTests': manifest.get('expectedTests'), 'sourceCount': len(source), 'runner': runner, 'attempt': attempt}))


if __name__ == '__main__':
    main()
