"""Prepare one bounded CPU stage; no engine execution and no runtime permit."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re
import sys
import time

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
PREVIOUS = OUT.parent / 'build-22-2026-10-17'
sys.path.insert(0, str(ROOT))
from scripts.verification_health import HostHealth

def digest(path):
    return sha256(path.read_bytes()).hexdigest()

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def require(condition, message):
    if not condition:
        raise ValueError(message)

def prerequisite(prefix):
    candidates = [p for p in OUT.glob(prefix + '-*/report.json')]
    require(bool(candidates), 'Missing prerequisite: ' + prefix)
    path = max(candidates, key=lambda p: read(p)['startedAt'])
    report = read(path)
    cleanup = read(path.parent / 'cleanup.json')
    require(report['passed'] and report['exitCode'] == 0, 'Prerequisite failed: ' + prefix)
    require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists']
            and cleanup['globalHoldAndSourceHashesUnchanged'], 'Cleanup incomplete')
    for name, expected in read(path.parent / 'authorization.json')['sourceHashes'].items():
        if name.startswith(('engine/', 'scripts/', 'examples/tactical-worker/')) or name in ('package.json', 'package-lock.json'):
            require(digest(ROOT / name) == expected, 'Source changed after prerequisite: ' + name)

def main():
    stage, attempt = sys.argv[1:]
    prefix = {'tests': 'attempt', 'typecheck': 'typecheck', 'lint': 'lint', 'sdk': 'sdk', 'public-entry': 'public-entry'}
    require(stage in prefix and re.fullmatch(prefix[stage] + r'-\d+', attempt), 'Unknown bounded stage')
    folder, gate_path = OUT / attempt, OUT / ('quiet-window-' + attempt + '.json')
    require(not folder.exists() and not gate_path.exists(), 'Refusing to overwrite an attempt')
    previous = read(PREVIOUS / 'summary.json')
    require(all(digest(ROOT / name) == value for name, value in previous['protectedSourceHashes'].items()), 'Protected physics/configuration changed')
    for runner in ('run_tests.py', 'run_cpu_stage.py'):
        require(digest(OUT / runner) == digest(PREVIOUS / runner), 'Reviewed runner changed')
    hold = read(ROOT / 'dist/verification/safety-hold.json')
    require(hold.get('blockRecovery') is True and 'recoveryPermit' not in hold, 'Runtime hold must remain intact')
    preceding = {'typecheck': 'attempt', 'lint': 'typecheck', 'sdk': 'lint', 'public-entry': 'sdk'}
    if stage in preceding:
        prerequisite(preceding[stage])
    node = r'C:\Program Files\nodejs\node.exe'
    commands = {
        'tests': [node, '--max-old-space-size=256', str(ROOT / 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'engine/vitest.tactical-session.config.ts', '--bail=1', '--reporter=verbose', '--reporter=json', '--outputFile.json=' + str(folder / 'vitest.json')],
        'typecheck': [node, '--max-old-space-size=512', str(ROOT / 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'engine/tsconfig.json'],
        'lint': [node, '--max-old-space-size=512', 'engine/lint_ts.mjs'],
        'sdk': [node, '--max-old-space-size=512', r'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js', 'run', 'build:sdk'],
        'public-entry': [node, '--max-old-space-size=512', 'scripts/check_tactical_session_sdk.mjs'],
    }
    names = set(previous['checkedSourceHashes']) | set(previous['protectedSourceHashes'])
    names.update(p.relative_to(ROOT).as_posix() for p in (ROOT / 'engine').rglob('*.ts'))
    names.update(p.relative_to(ROOT).as_posix() for p in OUT.glob('*.py'))
    names.update(['docs/checkpoints/TACTICAL_INTERVENTIONS.md', 'docs/SDK.md', 'examples/tactical-worker/client.js', 'examples/tactical-worker/worker.js'])
    if stage == 'public-entry':
        for entry in read(ROOT / 'package.json')['exports'].values():
            require(all((ROOT / entry[key]).is_file() for key in ('import', 'types')), 'SDK artifacts incomplete')
        names.update(p.relative_to(ROOT).as_posix() for p in (ROOT / 'dist/sdk').rglob('*') if p.is_file())
    gate = {'purpose': 'Build 23 bounded CPU ' + stage, 'requiredSamples': 10, 'maxHostCpuPercent': 20,
            'minFreeMemoryMiB': 8192, 'samples': [], 'passed': False}
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
    gate_path.write_text(json.dumps(gate, indent=2) + '\n', encoding='utf-8')
    require(gate['passed'], 'Quiet gate failed; no workload authorized or launched')
    folder.mkdir()
    count = len(re.findall(r"^\s*test\('", (ROOT / 'engine/experimental/tactical-worker-paths.test.ts').read_text(), re.M))
    manifest = {
        'scope': 'Build 23 edit/inert scheduling, static checks and zero-tick SDK integration; runtime/GPU/replay/benchmarks held',
        'stage': 'selected-edit-inert-tests' if stage == 'tests' else stage,
        'issuedAt': datetime.now(timezone.utc).isoformat(), 'expiresAt': time.time() + 300,
        'timeoutSeconds': 60 if stage == 'sdk' else 30, 'command': commands[stage],
        'sourceHashes': {name: digest(ROOT / name) for name in sorted(names)},
        'quietGate': gate_path.name, 'quietGateSHA256': digest(gate_path),
    }
    if stage == 'tests':
        manifest['expectedTests'] = 600 + count
    (folder / 'authorization.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'gatePassed': True, 'maxHostCpuPercent': max(s['hostCpuPercent'] for s in gate['samples']),
                      'stage': stage, 'attempt': attempt, 'expectedTests': manifest.get('expectedTests')}))

if __name__ == '__main__':
    main()
