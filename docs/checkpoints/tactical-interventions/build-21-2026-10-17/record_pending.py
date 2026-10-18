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

destination = OUT / 'summary.pending.json'
require(not destination.exists(), 'Refusing to overwrite evidence')
previous = read(OUT.parent / 'build-20-2026-10-17/summary.json')
protected = previous['protectedSourceHashes']
require(all(digest(ROOT / name) == value for name, value in protected.items()), 'Protected source changed')
expected_changes = {'engine/vitest.tactical-session.config.ts', 'engine/lint_ts.mjs',
                    'scripts/check_tactical_session_sdk.mjs', 'engine/experimental/tactical-previews.ts',
                    'engine/experimental/tactical-session.ts'}
changed = {name for name, value in previous['checkedSourceHashes'].items() if digest(ROOT / name) != value}
require(changed == expected_changes, 'Unexpected changes to prior implementation')
stages = {}
for name in ('attempt-01', 'typecheck-01', 'lint-01'):
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

tests = read(OUT / 'attempt-01/vitest.json')
require(tests['success'] and tests['numPassedTests'] == tests['numTotalTests'] == 578
        and all(tests[k] == 0 for k in ('numFailedTests', 'numPendingTests', 'numTodoTests')), 'Test coverage differs')
selected = re.findall(r"'(engine/[^']+\.test\.ts)'", (ROOT / 'engine/vitest.tactical-session.config.ts').read_text())
actual = [Path(result['name']).resolve().relative_to(ROOT).as_posix() for result in tests['testResults']]
require(len(selected) == 21 and len(actual) == 21 and set(selected) == set(actual), 'Selected test files differ')
worker_tests = next(result for result in tests['testResults'] if result['name'].endswith('tactical-preview-capture.test.ts'))
require(len(worker_tests['assertionResults']) == 22 and all(t['status'] == 'passed' for t in worker_tests['assertionResults']), 'Queue capture selection differs')
hold = read(ROOT / 'dist/verification/safety-hold.json')
require(hold.get('blockRecovery') is True and 'recoveryPermit' not in hold, 'Hold changed')
gate = OUT / 'quiet-window-sdk-01.json'
require(read(gate)['passed'] is False and not (OUT / 'sdk-01').exists() and not (OUT / 'public-entry-01').exists(), 'Expected unlaunched package stages')
manifest = read(OUT / 'lint-01/authorization.json')
record = {
    'stage': 'wishlist-build-21-queued-preview-observations', 'recordedAt': datetime.now(timezone.utc).isoformat(),
    'status': '578 edit/inert tests, types and lint passed; SDK build refused by quiet gate, package integration pending',
    'fullyAccepted': False, 'fullWishlistComplete': False, 'runtimeEquivalenceProven': False,
    'currentTests': {'passed': 578, 'previewCaptureCases': 22, 'failed': 0, 'skipped': 0, 'files': selected}, 'stages': stages,
    'pendingStages': ['sdk', 'public-entry'],
    'sdkLaunch': {'workloadLaunched': False, 'quietGate': gate.name, 'quietGateSHA256': digest(gate), 'maxHostCpuPercent': max(s['hostCpuPercent'] for s in read(gate)['samples']), 'launchLimitPercent': 20},
    'publicPackageIntegration': {'status': 'pending', 'workloadLaunched': False},
    'physicalCases': {'totalHeld': 38, 'executed': False}, 'physicalGpuReplayBenchmarks': 'held',
    'nativeWorkerExecuted': False, 'legacyDemos': 'quarantined',
    'protectedSourcesUnchanged': len(protected), 'protectedSourceHashes': protected, 'priorSourcesChanged': sorted(changed),
    'checkedSourceHashes': {name: value for name, value in manifest['sourceHashes'].items()
                            if name.startswith(('engine/', 'scripts/', 'examples/tactical-worker/')) or name in ('package.json', 'package-lock.json')},
    'reviewedSourceHashes': {name: digest(ROOT / name) for name in manifest['sourceHashes']},
    'scopeLimits': ['Synthetic permutations and inert support only; no physical equivalence claim', 'Queue observations are in-process only; no intra-action worker transport', 'SDK artifacts remain from Build 20', 'No native-worker replay GPU or latency acceptance'],
    'recorderSHA256': digest(Path(__file__)),
}
destination.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'record': destination.name, 'testsPassed': 578, 'stagesPassed': len(stages), 'protectedSourcesUnchanged': len(protected), 'pendingStages': record['pendingStages']}))
