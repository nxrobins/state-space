"""Prepare only the explicitly reauthorized bounded SDK stages; never launch work."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re
import sys
import time

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
sys.path.insert(0, str(ROOT))
from scripts.verification_health import HostHealth

def digest(path):
    return sha256(path.read_bytes()).hexdigest()

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def require(condition, message):
    if not condition:
        raise ValueError(message)

def passed(attempt):
    report = read(OUT / attempt / 'report.json')
    cleanup = read(OUT / attempt / 'cleanup.json')
    require(report['passed'] and report['exitCode'] == 0, 'Prerequisite stage failed')
    require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists']
            and cleanup['globalHoldAndSourceHashesUnchanged'], 'Prerequisite cleanup incomplete')

def main():
    stage, attempt = sys.argv[1:]
    node = r'C:\Program Files\nodejs\node.exe'
    commands = {
        'sdk': [node, '--max-old-space-size=512', r'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js', 'run', 'build:sdk'],
        'public-entry-interventions': [node, '--max-old-space-size=512', 'scripts/check_interventions_sdk.mjs'],
        'public-entry-tactical': [node, '--max-old-space-size=512', 'scripts/check_tactical_session_sdk.mjs'],
    }
    require(stage in commands and re.fullmatch(re.escape(stage) + r'-\d+', attempt), 'Unknown SDK stage')
    folder = OUT / attempt
    gate_path = OUT / ('quiet-window-' + attempt + '.json')
    require(not folder.exists() and not gate_path.exists(), 'Refusing to overwrite a prior stage')
    passed('typecheck-03')
    passed('lint-01')
    previous = read(OUT / 'summary.json')
    require(all(digest(ROOT / name) == expected for name, expected in previous['protectedSourceHashes'].items()), 'Protected source/configuration changed')
    require(digest(OUT / 'run_cpu_stage.py') == digest(OUT.parent / 'build-15-2026-10-17/run_cpu_stage.py'), 'Reviewed runner changed')
    hold = read(ROOT / 'dist/verification/safety-hold.json')
    require(hold.get('blockRecovery') is True and 'recoveryPermit' not in hold, 'Runtime hold must remain intact')
    checked = read(OUT / 'typecheck-03/authorization.json')['sourceHashes']
    for name, expected in checked.items():
        if name.startswith(('engine/', 'scripts/')):
            require(digest(ROOT / name) == expected, 'Source changed since type check: ' + name)
    names = set(checked)
    names.update(['package.json', 'package-lock.json', 'scripts/check_interventions_sdk.mjs', 'scripts/check_tactical_session_sdk.mjs'])
    names.update(p.relative_to(ROOT).as_posix() for p in OUT.glob('*.py'))
    if stage != 'sdk':
        passed('sdk-01')
        for entry in read(ROOT / 'package.json')['exports'].values():
            require(all((ROOT / entry[key]).is_file() for key in ('import', 'types')), 'SDK export artifact missing')
        names.update(p.relative_to(ROOT).as_posix() for p in (ROOT / 'dist/sdk').rglob('*') if p.is_file())
    if stage == 'public-entry-tactical':
        passed('public-entry-interventions-01')
    gate = {'purpose': 'Reauthorized bounded CPU ' + stage, 'requiredSamples': 10,
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
    gate_path.write_text(json.dumps(gate, indent=2) + '\n', encoding='utf-8')
    require(gate['passed'], 'Quiet gate failed; no workload authorized or launched')
    folder.mkdir()
    manifest = {
        'scope': 'User reauthorized SDK build and zero-tick public package checks; runtime/GPU/replay/benchmarks remain held',
        'stage': 'sdk' if stage == 'sdk' else 'public-entry', 'issuedAt': datetime.now(timezone.utc).isoformat(),
        'expiresAt': time.time() + 300, 'timeoutSeconds': 60 if stage == 'sdk' else 30,
        'command': commands[stage], 'sourceHashes': {name: digest(ROOT / name) for name in sorted(names)},
        'quietGate': gate_path.name, 'quietGateSHA256': digest(gate_path),
    }
    (folder / 'authorization.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'gatePassed': True, 'stage': stage, 'attempt': attempt,
                      'maxHostCpuPercent': max(s['hostCpuPercent'] for s in gate['samples'])}))

if __name__ == '__main__':
    main()
