"""Validate selected-test receipts and retain the refused next gate; no engine execution."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def digest(p): return sha256(p.read_bytes()).hexdigest()
def require(ok, reason):
    if not ok: raise ValueError(reason)

destination = OUT / 'summary.pending-02.json'
require(not destination.exists(), 'Refusing to overwrite evidence')
previous = read(OUT.parent / 'build-23-2026-10-17/summary.json')
protected = previous['protectedSourceHashes']
require(all(digest(ROOT / p) == h for p, h in protected.items()), 'Protected source changed')
folder = OUT / 'attempt-02'
report, cleanup, auth = [read(folder / p) for p in ('report.json', 'cleanup.json', 'authorization.json')]
require(report['passed'] and report['exitCode'] == 0 and report['kind'] == 'cpu', 'Tests did not pass')
require(report['cpuLimitPercent'] == 6 and report['memoryLimitMiB'] == 4096 and report['timeoutSeconds'] == 30 and report['independentWatchdog']['armed'], 'Containment differs')
require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'] and cleanup['globalHoldAndSourceHashesUnchanged'], 'Cleanup incomplete')
for name, expected in auth['sourceHashes'].items():
    if name.startswith(('engine/', 'scripts/', 'examples/tactical-worker/')) or name in ('package.json', 'package-lock.json'):
        require(digest(ROOT / name) == expected, 'Checked source changed: ' + name)
for runner in ('run_tests.py', 'run_cpu_stage.py'):
    require(digest(OUT / runner) == digest(OUT.parent / 'build-23-2026-10-17' / runner), 'Reviewed runner changed')
gate = OUT / auth['quietGate']
require(read(gate)['passed'] and digest(gate) == auth['quietGateSHA256'], 'Test quiet gate differs')
tests = read(folder / 'vitest.json')
require(tests['success'] and tests['numPassedTests'] == tests['numTotalTests'] == 648 and all(tests[k] == 0 for k in ('numFailedTests', 'numPendingTests', 'numTodoTests')), 'Test count differs')
selected = re.findall(r"'(engine/[^']+\.test\.ts)'", (ROOT / 'engine/vitest.tactical-session.config.ts').read_text())
actual = [Path(t['name']).resolve().relative_to(ROOT).as_posix() for t in tests['testResults']]
require(len(selected) == len(actual) == 24 and set(selected) == set(actual), 'Selection differs')
new = next(t for t in tests['testResults'] if t['name'].endswith('tactical-worker-preview-queries.test.ts'))
require(len(new['assertionResults']) == 26 and all(t['status'] == 'passed' for t in new['assertionResults']), 'New coverage differs')
refused = OUT / 'quiet-window-typecheck-01.json'
require(not read(refused)['passed'] and not (OUT / 'typecheck-01').exists(), 'Expected unlaunched typecheck')
hold = read(ROOT / 'dist/verification/safety-hold.json')
require(hold.get('blockRecovery') is True and 'recoveryPermit' not in hold, 'Hold changed')
record = {
    'stage': 'wishlist-build-24-preview-queries', 'recordedAt': datetime.now(timezone.utc).isoformat(),
    'status': '648 selected edit/inert tests passed; fresh typecheck gate refused launch',
    'fullyAccepted': False, 'fullWishlistComplete': False, 'runtimeEquivalenceProven': False,
    'currentTests': {'passed': 648, 'previewQueryCases': 26, 'failed': 0, 'skipped': 0, 'files': selected},
    'stages': {'attempt-02': {'passed': True, 'wallSeconds': round(report['finishedAt'] - report['startedAt'], 3), 'command': report['command'],
               'timeoutSeconds': 30, 'cleanupVerified': True, 'evidenceSHA256': {p.name: digest(p) for p in sorted(folder.iterdir()) if p.is_file()},
               'quietGateSHA256': digest(gate)}},
    'pendingStages': ['typecheck', 'lint', 'sdk', 'public-entry'],
    'typecheckLaunch': {'workloadLaunched': False, 'quietGate': refused.name, 'quietGateSHA256': digest(refused),
                       'maxHostCpuPercent': max(s['hostCpuPercent'] for s in read(refused)['samples']), 'launchLimitPercent': 20},
    'checkedSourceHashes': {name: value for name, value in auth['sourceHashes'].items() if name.startswith(('engine/', 'scripts/', 'examples/tactical-worker/')) or name in ('package.json', 'package-lock.json')},
    'protectedSourceHashes': protected, 'protectedSourcesUnchanged': len(protected),
    'transportProtocol': 'tactical-worker-6', 'builtArtifacts': 'Last verified Build 23/protocol 5; current build pending',
    'physicalCases': {'totalHeld': 38, 'executed': False}, 'physicalGpuReplayBenchmarks': 'held', 'nativeWorkerExecuted': False,
    'legacyDemos': 'quarantined', 'recorderSHA256': digest(Path(__file__)),
}
destination.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'record': destination.name, 'testsPassed': 648, 'protectedSourcesUnchanged': len(protected), 'pendingStages': record['pendingStages']}))
