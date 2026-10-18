"""Check completed receipts and hash current sources; execute no engine code."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def digest(path):
    return sha256(path.read_bytes()).hexdigest()

def require(condition, message):
    if not condition:
        raise ValueError(message)

destination = OUT / 'summary.json'
require(not destination.exists(), 'Refusing to overwrite evidence')
previous = read(OUT.parent / 'build-17-2026-10-17/summary.json')
protected = previous['protectedSourceHashes']
require(all(digest(ROOT / name) == value for name, value in protected.items()), 'Protected source changed')
expected_changes = {'engine/experimental/tactical-session.ts', 'engine/vitest.tactical-session.config.ts',
                    'engine/lint_ts.mjs', 'scripts/check_tactical_session_sdk.mjs'}
changed = {name for name, value in previous['checkedSourceHashes'].items() if digest(ROOT / name) != value}
require(changed == expected_changes, 'Unexpected changes to prior implementation')
stages = {}
for name in ('attempt-03', 'typecheck-01', 'lint-01', 'sdk-01', 'public-entry-02'):
    folder = OUT / name
    report, cleanup, auth = [read(folder / p) for p in ('report.json', 'cleanup.json', 'authorization.json')]
    require(report['passed'] is True and report['exitCode'] == 0 and report['kind'] == 'cpu', 'Failed stage')
    require(report['cpuLimitPercent'] == 6 and report['memoryLimitMiB'] == 4096 and report['independentWatchdog']['armed'], 'Limits changed')
    require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'] and cleanup['globalHoldAndSourceHashesUnchanged'], 'Cleanup failed')
    gate = OUT / auth['quietGate']
    require(digest(gate) == auth['quietGateSHA256'] and read(gate)['passed'], 'Quiet gate changed')
    for source, value in auth['sourceHashes'].items():
        if source.startswith(('engine/', 'scripts/', 'dist/', 'examples/tactical-worker/')) and not source.endswith('/README.md') or source in ('package.json', 'package-lock.json'):
            require(digest(ROOT / source) == value, 'Checked source changed: ' + source)
    stages[name] = {'passed': True, 'wallSeconds': round(report['finishedAt'] - report['startedAt'], 3),
                    'command': report['command'], 'timeoutSeconds': report['timeoutSeconds'], 'cleanupVerified': True,
                    'evidenceSHA256': {p.name: digest(p) for p in sorted(folder.iterdir()) if p.is_file()},
                    'quietGateSHA256': digest(gate)}

tests = read(OUT / 'attempt-03/vitest.json')
require(tests['success'] and tests['numPassedTests'] == tests['numTotalTests'] == 517
        and all(tests[k] == 0 for k in ('numFailedTests', 'numPendingTests', 'numTodoTests')), 'Test coverage differs')
selected = re.findall(r"'(engine/[^']+\.test\.ts)'", (ROOT / 'engine/vitest.tactical-session.config.ts').read_text())
actual = [Path(result['name']).resolve().relative_to(ROOT).as_posix() for result in tests['testResults']]
require(len(selected) == 18 and len(actual) == 18 and set(selected) == set(actual), 'Selected test files differ')
worker_tests = next(result for result in tests['testResults'] if result['name'].endswith('tactical-worker.test.ts'))
require(len(worker_tests['assertionResults']) == 36 and all(t['status'] == 'passed' for t in worker_tests['assertionResults']), 'Worker selection differs')
exports = read(ROOT / 'package.json')['exports']
require(len(exports) == 11 and all((ROOT / e[k]).is_file() for e in exports.values() for k in ('import', 'types')), 'SDK outputs incomplete')
blocked_gate = OUT / 'quiet-window-public-entry-01.json'
refusal = read(blocked_gate)
require(not refusal['passed'] and not (OUT / 'public-entry-01').exists(), 'Public check unexpectedly launched')
hold = read(ROOT / 'dist/verification/safety-hold.json')
require(hold.get('blockRecovery') is True and 'recoveryPermit' not in hold, 'Hold changed')
manifest = read(OUT / 'public-entry-02/authorization.json')
public = read(OUT / 'public-entry-02/stdout.log')
require(public['passed'] is True and public['physicsTicks'] == 0 and public['gpu'] is False, 'Public integration scope differs')
record = {
    'stage': 'wishlist-build-18-worker-preview-service', 'recordedAt': datetime.now(timezone.utc).isoformat(),
    'status': '517 edit/inert tests, types, lint, SDK build and zero-tick package integration passed; physical acceptance held',
    'fullyAccepted': False, 'fullWishlistComplete': False, 'runtimeEquivalenceProven': False,
    'currentTests': {'passed': 517, 'workerCases': 36, 'failed': 0, 'skipped': 0, 'files': selected}, 'stages': stages,
    'publicPackageIntegration': {'status': 'passed', 'workloadLaunched': True, 'physicsTicks': 0, 'gpu': False, 'nativeWorker': False, 'transport': 'structured-clone mock'},
    'earlierRefusedGates': {p.name: digest(p) for p in OUT.glob('quiet-window-*.json') if not read(p)['passed']},
    'physicalCases': {'totalHeld': 38, 'executed': False}, 'SDKBuild': 'passed; eleven bundles plus declarations',
    'physicalGpuReplayBenchmarks': 'held', 'nativeWorkerExecuted': False, 'legacyDemos': 'quarantined',
    'protectedSourcesUnchanged': len(protected), 'protectedSourceHashes': protected,
    'priorSourcesChanged': sorted(changed),
    'checkedSourceHashes': {name: value for name, value in manifest['sourceHashes'].items()
                            if name.startswith(('engine/', 'scripts/', 'examples/tactical-worker/')) or name in ('package.json', 'package-lock.json')},
    'reviewedSourceHashes': {name: digest(ROOT / name) for name in manifest['sourceHashes'] if not name.startswith('dist/sdk/')},
    'sdkArtifactHashes': {p.relative_to(ROOT).as_posix(): digest(p) for p in sorted((ROOT / 'dist/sdk').rglob('*')) if p.is_file()},
    'scopeLimits': ['Mock transport only; no native Worker execution', 'No preemption inside a synchronous physical tick or snapshot copy',
                    'No physical replay or frame latency evidence', 'No installation into an external consumer project'],
    'recorderSHA256': digest(Path(__file__)),
}
destination.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'record': destination.name, 'testsPassed': 517, 'stagesPassed': len(stages),
                  'protectedSourcesUnchanged': len(protected), 'publicIntegration': 'passed'}))
