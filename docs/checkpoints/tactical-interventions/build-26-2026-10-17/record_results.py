"""Validate retained CPU receipts and source hashes. No engine execution."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
PREVIOUS = OUT.parent / 'build-25-2026-10-17'
def read(p):
    return json.loads(p.read_text(encoding='utf-8'))
def digest(p):
    return sha256(p.read_bytes()).hexdigest()
def require(value, message):
    if not value:
        raise ValueError(message)

target = OUT / 'summary.json'
require(not target.exists(), 'Refusing to overwrite evidence')
previous = read(PREVIOUS / 'summary.json'); protected = previous['protectedSourceHashes']
require(all(digest(ROOT / n) == h for n, h in protected.items()), 'Protected source changed')
changed = {n for n, h in previous['checkedSourceHashes'].items() if digest(ROOT / n) != h}
require(changed == {'engine/lint_ts.mjs', 'engine/vitest.tactical-session.config.ts', 'scripts/check_tactical_session_sdk.mjs'}, 'Unexpected prior source change')
require(all(digest(ROOT / n) == h for n, h in previous['sdkArtifactHashes'].items()), 'Existing SDK artifacts changed')
stages = {}
for attempt in ('attempt-02', 'typecheck-02', 'lint-02', 'sdk-02', 'public-entry-02'):
    folder = OUT / attempt
    report, cleanup, auth = [read(folder / n) for n in ('report.json', 'cleanup.json', 'authorization.json')]
    require(report['passed'] and report['exitCode'] == 0 and report['kind'] == 'cpu', 'Stage failed')
    require(report['cpuLimitPercent'] == 6 and report['memoryLimitMiB'] == 4096 and report['independentWatchdog']['armed'], 'Containment differs')
    require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'] and cleanup['globalHoldAndSourceHashesUnchanged'], 'Cleanup failed')
    require(auth['userAuthorizationSHA256'] == digest(OUT / 'sdk-resume-authorization.json'), 'CPU scope differs')
    gate = OUT / auth['quietGate']; quiet = read(gate)
    require(digest(gate) == auth['quietGateSHA256'] and quiet['passed'] and quiet['maxHostCpuPercent'] == 50 and len(quiet['samples']) == 10, 'Quiet gate differs')
    require(all(s['hostCpuPercent'] is not None and s['hostCpuPercent'] <= 50 and s['freeMemoryMiB'] >= 8192 for s in quiet['samples']), 'Launch limits differ')
    for n, h in auth['sourceHashes'].items():
        if n.startswith(('engine/', 'scripts/', 'dist/', 'examples/tactical-worker/', 'examples/tactical-slab/')) and not n.endswith('/README.md') or n in ('package.json', 'package-lock.json'):
            require(digest(ROOT / n) == h, 'Checked source changed: ' + n)
    stages[attempt] = {'passed': True, 'command': report['command'], 'wallSeconds': round(report['finishedAt'] - report['startedAt'], 3),
                       'timeoutSeconds': report['timeoutSeconds'], 'cleanupVerified': True,
                       'launchCpuCeilingPercent': 50, 'maxLaunchCpuPercent': max(s['hostCpuPercent'] for s in quiet['samples']),
                       'quietGateSHA256': digest(gate), 'evidenceSHA256': {p.name: digest(p) for p in folder.iterdir() if p.is_file()}}
tests = read(OUT / 'attempt-02/vitest.json')
require(tests['success'] and tests['numPassedTests'] == tests['numTotalTests'] == 699 and all(tests[k] == 0 for k in ('numFailedTests', 'numPendingTests', 'numTodoTests')), 'Selected tests differ')
selected = re.findall(r"'(engine/[^']+\.test\.ts)'", (ROOT / 'engine/vitest.tactical-session.config.ts').read_text(encoding='utf-8'))
actual = [Path(r['name']).resolve().relative_to(ROOT).as_posix() for r in tests['testResults']]
require(len(selected) == len(actual) == 26 and set(actual) == set(selected), 'Selected files differ')
new = next(r for r in tests['testResults'] if r['name'].endswith('tactical-slab.test.ts'))
require(len(new['assertionResults']) == 25 and all(a['status'] == 'passed' for a in new['assertionResults']), 'Reference coverage differs')
historical = {}
for attempt in ('attempt-01', 'typecheck-01', 'lint-01', 'sdk-01', 'public-entry-01'):
    folder = OUT / attempt; report = read(folder / 'report.json'); cleanup = read(folder / 'cleanup.json')
    require(report['passed'] and not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'], 'Historical receipt differs')
    historical[attempt] = {'passed': True, 'cleanupVerified': True, 'evidenceSHA256': {p.name: digest(p) for p in folder.iterdir() if p.is_file()}}
exports = read(ROOT / 'package.json')['exports']
require(len(exports) == 11 and all((ROOT / e[k]).is_file() for e in exports.values() for k in ('import', 'types')), 'SDK artifacts incomplete')
public = read(OUT / 'public-entry-02/stdout.log')
require(public['passed'] and public['physicsTicks'] == 0 and public['gpu'] is False, 'Public package scope differs')
require(public['slabReference'] == {'passed': True, 'worldCells': 512, 'physicsTicks': 0, 'nativeWorker': False, 'gpu': False}, 'Reference package coverage differs')
runtime = (ROOT / 'engine/experimental/tactical-slab.runtime-cases.ts').read_text(encoding='utf-8')
require(len(re.findall(r"^\s*test\('", runtime, re.M)) == 4, 'Held cases differ')
for p in (ROOT / 'examples/tactical-slab').glob('*.ts'):
    imports = re.findall(r"from\s+['\"]([^'\"]+)['\"]", p.read_text(encoding='utf-8'))
    require(all(n.startswith(('state-space-engine/', './')) for n in imports), 'Example imports engine internals')
hold = read(ROOT / 'dist/verification/safety-hold.json')
require(hold.get('blockRecovery') is True and 'recoveryPermit' not in hold, 'Runtime hold changed')
for runner in ('run_tests.py', 'run_cpu_stage.py'):
    require(digest(OUT / runner) == digest(PREVIOUS / runner), 'Reviewed runner changed')
manifest = read(OUT / 'public-entry-02/authorization.json')
record = {
    'stage': 'wishlist-build-26-hot-slab-reference', 'recordedAt': datetime.now(timezone.utc).isoformat(),
    'status': '699 selected edit/inert tests, types, lint, SDK and built-package zero-tick reference integration passed; physical acceptance held',
    'approvedCpuGatesComplete': True, 'fullyAccepted': False, 'fullWishlistComplete': False, 'runtimeEquivalenceProven': False,
    'currentTests': {'passed': 699, 'newReferenceCases': 25, 'failed': 0, 'skipped': 0, 'files': selected}, 'stages': stages,
    'historicalAttempts': historical,
    'additionalReview': 'Apply the eight-tick horizon limit inside shared preparation so worker requests cannot bypass local controller policy; test a nine-tick mock request rejecting before physics. Author held comparisons sequentially. Reran all five CPU gates.',
    'publicPackageIntegration': {'status': 'passed', 'physicsTicks': 0, 'gpu': False, 'nativeWorker': False, 'slabReference': public['slabReference']},
    'referenceArtifactSHA256': digest(ROOT / 'dist/verification/tactical-slab-sdk-check.mjs'),
    'physicalCases': {'totalHeld': 42, 'newReferenceCases': 4, 'executed': False}, 'SDKBuild': 'passed; eleven bundles and declarations',
    'physicalGpuReplayBenchmarks': 'held', 'nativeWorkerExecuted': False, 'legacyDemos': 'quarantined',
    'protectedSourcesUnchanged': len(protected), 'protectedSourceHashes': protected, 'priorSourcesChanged': sorted(changed),
    'priorSDKArtifactsUnchanged': len(previous['sdkArtifactHashes']),
    'checkedSourceHashes': {n: digest(ROOT / n) for n in manifest['sourceHashes'] if n.startswith(('engine/', 'scripts/', 'examples/tactical-worker/', 'examples/tactical-slab/')) or n in ('package.json', 'package-lock.json')},
    'reviewedSourceHashes': {n: digest(ROOT / n) for n in manifest['sourceHashes'] if not n.startswith('dist/sdk/')},
    'sdkArtifactHashes': {p.relative_to(ROOT).as_posix(): digest(p) for p in (ROOT / 'dist/sdk').rglob('*') if p.is_file()},
    'authorizationSHA256': digest(OUT / 'sdk-resume-authorization.json'), 'recorderSHA256': digest(Path(__file__)),
    'transportProtocol': 'tactical-worker-7', 'applicationRulesVersion': 'hot-slab-game-1',
    'scopeLimits': ['Headless reference model; no UI or renderer acceptance', 'Zero physical ticks in production SDK integration; nonzero unit cases use inert drivers',
                    'Disconnected bond graph is not proof of actual structural strength or collapse', 'No native Worker or browser execution',
                    'No GPU, replay or frame latency evidence', 'Completed-pose unit overlap rejection is not general swept actor-actor collision',
                    'No external actor loads, damage, knockdown or four-element content completion']
}
target.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'record': target.name, 'passedTests': 699, 'stages': len(stages), 'protectedSourcesUnchanged': len(protected)}))
