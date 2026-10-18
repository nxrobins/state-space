"""Record a quiet gate and bounded CPU command only; never launch a workload."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re
import sys
import time

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
PREVIOUS = OUT.parent / 'build-11-2026-10-17'
sys.path.insert(0, str(ROOT))
from scripts.verification_health import HostHealth


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def main():
    stage, attempt = sys.argv[1:]
    if stage not in ('tests', 'typecheck', 'lint') or not re.fullmatch({'tests': r'attempt-\d+', 'typecheck': r'typecheck-\d+', 'lint': r'lint-\d+'}[stage], attempt):
        raise ValueError('Only bounded edit/inert tests, no-emit types or lint allowed')
    folder = OUT / attempt
    gate_path = OUT / ('quiet-window-' + attempt + '.json')
    if folder.exists() or gate_path.exists():
        raise ValueError('Refusing to overwrite a previous stage')
    previous = json.loads((PREVIOUS / 'summary.json').read_text())
    for name, expected in previous['protectedSourceHashes'].items():
        if digest(ROOT / name) != expected:
            raise ValueError('Protected physics/configuration changed: ' + name)
    hold = json.loads((ROOT / 'dist/verification/safety-hold.json').read_text())
    if not hold['blockRecovery'] or 'recoveryPermit' in hold:
        raise ValueError('Runtime hold must remain intact')
    runner = 'run_tests.py' if stage == 'tests' else 'run_cpu_stage.py'
    if not (OUT / runner).exists():
        (OUT / runner).write_bytes((PREVIOUS / runner).read_bytes())
    if digest(OUT / runner) != digest(PREVIOUS / runner):
        raise ValueError('Reviewed runner changed')
    gate = {'purpose': 'Build 12 bounded CPU ' + stage, 'requiredSamples': 10, 'maxHostCpuPercent': 20,
            'minFreeMemoryMiB': 8192, 'samples': [], 'passed': False}
    health = HostHealth(); health.sample()
    for _ in range(10):
        time.sleep(1); sample = health.sample(); gate['samples'].append(sample)
        if sample['hostCpuPercent'] is None or sample['hostCpuPercent'] > 20 or sample['freeMemoryMiB'] < 8192:
            break
    gate['passed'] = len(gate['samples']) == 10 and all(s['hostCpuPercent'] is not None and s['hostCpuPercent'] <= 20 and s['freeMemoryMiB'] >= 8192 for s in gate['samples'])
    gate['finishedAt'] = time.time(); gate_path.write_text(json.dumps(gate, indent=2) + '\n')
    if not gate['passed']:
        raise RuntimeError('Quiet gate failed; no workload authorized or launched')
    folder.mkdir()
    node = r'C:\Program Files\nodejs\node.exe'
    commands = {
        'tests': [node, '--max-old-space-size=256', str(ROOT / 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'engine/vitest.tactical-session.config.ts', '--bail=1', '--reporter=verbose', '--reporter=json', '--outputFile.json=' + str(folder / 'vitest.json')],
        'typecheck': [node, '--max-old-space-size=512', str(ROOT / 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'engine/tsconfig.json'],
        'lint': [node, '--max-old-space-size=512', 'engine/lint_ts.mjs'],
    }
    names = set(previous['lintedSourceHashes'])
    names.update(p.relative_to(ROOT).as_posix() for p in (ROOT / 'engine').rglob('*.ts'))
    names.update(p.relative_to(ROOT).as_posix() for p in OUT.glob('*.py'))
    count = len(re.findall(r"^\s*test\('", (ROOT / 'engine/experimental/terrain-motion.test.ts').read_text(), re.M))
    manifest = {'scope': 'Wishlist bounded pure/edit/inert CPU and static checks; SDK deferred; physical runtime/GPU/replay/benchmarks held',
        'stage': 'selected-edit-inert-tests' if stage == 'tests' else stage,
        'issuedAt': datetime.now(timezone.utc).isoformat(), 'expiresAt': time.time() + 300, 'timeoutSeconds': 30,
        'command': commands[stage], 'sourceHashes': {name: digest(ROOT / name) for name in sorted(names)},
        'quietGate': gate_path.name, 'quietGateSHA256': digest(gate_path)}
    if stage == 'tests':
        manifest['expectedTests'] = 300 + count
    (folder / 'authorization.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'gatePassed': True, 'maxHostCpuPercent': max(s['hostCpuPercent'] for s in gate['samples']), 'stage': stage,
                      'newCases': count, 'expectedTests': manifest.get('expectedTests'), 'attempt': attempt}))


if __name__ == '__main__':
    main()
