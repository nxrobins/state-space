"""User-authorized Build 48 CPU resumption; original receipts and runtime hold stay intact."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re
import sys
import time

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
PREVIOUS = OUT.parent / 'build-47-2026-10-17'
sys.path.insert(0, str(ROOT))
from scripts.verification_health import HostHealth

def digest(path):
    return sha256(path.read_bytes()).hexdigest()

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def require(condition, message):
    if not condition:
        raise ValueError(message)

def prerequisite(prefix, suite=None):
    candidates = [p for p in OUT.glob(prefix + '-*/report.json') if suite is None or read(p.parent / 'authorization.json').get('testSuite') == suite]
    require(bool(candidates), 'Missing prerequisite: ' + prefix)
    path = max(candidates, key=lambda p: read(p)['startedAt'])
    report = read(path)
    cleanup = read(path.parent / 'cleanup.json')
    require(report['passed'] and report['exitCode'] == 0, 'Prerequisite failed: ' + prefix)
    require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists']
            and cleanup['globalHoldAndSourceHashesUnchanged'], 'Cleanup incomplete')
    for name, expected in read(path.parent / 'authorization.json')['sourceHashes'].items():
        if name.startswith(('engine/', 'scripts/', 'examples/tactical-worker/', 'examples/tactical-slab/')) or name in ('package.json', 'package-lock.json'):
            require(digest(ROOT / name) == expected, 'Source changed after prerequisite: ' + name)

def main():
    stage, attempt, *extra = sys.argv[1:]
    require(not extra or stage == 'tests' and extra in (['focus-command-actors'], ['focus-actors'], ['focus-motion'], ['focus-world'], ['focus-translation'], ['focus-holds'], ['focus-domains'], ['focus-session'], ['focus-geometry'], ['focus-core-a'], ['focus-core-b']), 'Unknown focus selection')
    approval_path = OUT / 'sdk-resume-authorization.json'
    approval = read(approval_path)
    require(approval['maxHostCpuPercent'] == 50 and approval['requiredSamples'] == 10 and approval['GPUReplayBenchmarksAuthorized'] is False, 'CPU-only authorization differs')
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
    if stage == 'typecheck':
        prerequisite('attempt', 'command-actors')
        prerequisite('attempt', 'actors')
        prerequisite('attempt', 'motion')
        prerequisite('attempt', 'geometry')
        prerequisite('attempt', 'session')
        prerequisite('attempt', 'domains')
        prerequisite('attempt', 'holds')
        prerequisite('attempt', 'translation')
        prerequisite('attempt', 'world')
        prerequisite('attempt', 'core-a')
        prerequisite('attempt', 'core-b')
    elif stage in preceding:
        prerequisite(preceding[stage])
    node = r'C:\Program Files\nodejs\node.exe'
    commands = {
        'tests': [node, '--max-old-space-size=256', str(ROOT / 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'engine/vitest.tactical-session.config.ts', '--bail=1', '--reporter=verbose', '--reporter=json', '--outputFile.json=' + str(folder / 'vitest.json')],
        'typecheck': [node, '--max-old-space-size=512', str(ROOT / 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'engine/tsconfig.tactical-check.json'],
        'lint': [node, '--max-old-space-size=512', 'engine/lint_ts.mjs'],
        'sdk': [node, '--max-old-space-size=512', r'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js', 'run', 'build:sdk'],
        'public-entry': [node, '--max-old-space-size=512', 'scripts/check_tactical_session_sdk.mjs'],
    }
    core_part = extra in (['focus-core-a'], ['focus-core-b'])
    selected_files = None
    if core_part:
        core_files = re.findall(r"'(engine/[^']+\.test\.ts)'", (ROOT / 'engine/vitest.tactical-session.config.ts').read_text())
        require(len(core_files) == 43 and len(set(core_files)) == 43, 'Core selection changed')
        selected_files = core_files[0 if extra == ['focus-core-a'] else 1::2]
        commands['tests'].extend(selected_files)
    elif extra:
        commands['tests'][commands['tests'].index('engine/vitest.tactical-session.config.ts')] = {'focus-command-actors': 'engine/vitest.reactive-command-actors.config.ts', 'focus-actors': 'engine/vitest.reactive-actors.config.ts', 'focus-motion': 'engine/vitest.reactive-motion.config.ts', 'focus-geometry': 'engine/vitest.reactive-geometry.config.ts', 'focus-translation': 'engine/vitest.reactive-translation.config.ts', 'focus-world': 'engine/vitest.reactive-world.config.ts', 'focus-holds': 'engine/vitest.reactive-holds.config.ts', 'focus-domains': 'engine/vitest.reactive-domains.config.ts', 'focus-session': 'engine/vitest.reactive-session.config.ts'}[extra[0]]
    names = set(previous['checkedSourceHashes']) | set(previous['protectedSourceHashes'])
    names.add(approval_path.relative_to(ROOT).as_posix())
    names.add('scripts/check_tactical_slab_sdk.mjs')
    names.add('scripts/build_tactical_slab.mjs')
    names.add('scripts/check_reactive_materials_sdk.mjs')
    names.add('engine/tsconfig.tactical-check.json')
    names.update(p.relative_to(ROOT).as_posix() for p in (ROOT / 'examples/tactical-slab').rglob('*') if p.is_file())
    names.update(p.relative_to(ROOT).as_posix() for p in (ROOT / 'engine').rglob('*.ts'))
    names.update(p.relative_to(ROOT).as_posix() for p in OUT.glob('*.py'))
    names.update(['docs/checkpoints/TACTICAL_INTERVENTIONS.md', 'docs/SDK.md', 'examples/tactical-worker/client.js', 'examples/tactical-worker/worker.js'])
    if stage == 'public-entry':
        for entry in read(ROOT / 'package.json')['exports'].values():
            require(all((ROOT / entry[key]).is_file() for key in ('import', 'types')), 'SDK artifacts incomplete')
        names.update(p.relative_to(ROOT).as_posix() for p in (ROOT / 'dist/sdk').rglob('*') if p.is_file())
    gate = {'purpose': 'Build 48 user-authorized CPU resumption ' + stage, 'requiredSamples': 10, 'maxHostCpuPercent': 50,
            'minFreeMemoryMiB': 8192, 'samples': [], 'passed': False}
    health = HostHealth()
    health.sample()
    for _ in range(10):
        time.sleep(1)
        sample = health.sample()
        gate['samples'].append(sample)
        if sample['hostCpuPercent'] is None or sample['hostCpuPercent'] > 50 or sample['freeMemoryMiB'] < 8192:
            break
    gate['passed'] = len(gate['samples']) == 10 and all(s['hostCpuPercent'] is not None and s['hostCpuPercent'] <= 50 and s['freeMemoryMiB'] >= 8192 for s in gate['samples'])
    gate['finishedAt'] = time.time()
    gate_path.write_text(json.dumps(gate, indent=2) + '\n', encoding='utf-8')
    require(gate['passed'], 'Quiet gate failed; no workload authorized or launched')
    folder.mkdir()
    count = sum(len(re.findall(r"^\s*test\('", (ROOT / ('engine/experimental/' + name)).read_text(), re.M)) for name in ('reactive-session.test.ts',))
    manifest = {
        'scope': approval['scope'],
        'userAuthorization': approval_path.name, 'userAuthorizationSHA256': digest(approval_path),
        'stage': 'selected-tiny-cpu-kernel-tests' if stage == 'tests' else stage,
        'issuedAt': datetime.now(timezone.utc).isoformat(), 'expiresAt': time.time() + 300,
        'timeoutSeconds': 60 if stage == 'sdk' else 30, 'command': commands[stage],
        'sourceHashes': {name: digest(ROOT / name) for name in sorted(names)},
        'quietGate': gate_path.name, 'quietGateSHA256': digest(gate_path),
    }
    if stage == 'tests':
        manifest['expectedTests'] = 38 if extra == ['focus-command-actors'] else 37 if extra == ['focus-actors'] else 34 if extra == ['focus-motion'] else 34 if extra == ['focus-geometry'] else 566 if extra == ['focus-core-a'] else 580 if extra == ['focus-core-b'] else count if extra == ['focus-session'] else 45 if extra == ['focus-domains'] else 36 if extra == ['focus-holds'] else 40 if extra == ['focus-translation'] else 36 if extra else 1146
        manifest['testSuite'] = 'command-actors' if extra == ['focus-command-actors'] else 'actors' if extra == ['focus-actors'] else 'motion' if extra == ['focus-motion'] else 'geometry' if extra == ['focus-geometry'] else 'core-a' if extra == ['focus-core-a'] else 'core-b' if extra == ['focus-core-b'] else 'session' if extra == ['focus-session'] else 'domains' if extra == ['focus-domains'] else 'holds' if extra == ['focus-holds'] else 'translation' if extra == ['focus-translation'] else 'world' if extra else 'core'
        if selected_files is not None:
            manifest['selectedFiles'] = selected_files
    (folder / 'authorization.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'gatePassed': True, 'maxHostCpuPercent': max(s['hostCpuPercent'] for s in gate['samples']),
                      'stage': stage, 'attempt': attempt, 'expectedTests': manifest.get('expectedTests')}))

if __name__ == '__main__':
    main()
