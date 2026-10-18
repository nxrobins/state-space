"""Validate saved bounded receipts and current hashes; execute no engine code."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
PREVIOUS = OUT.parent / 'build-24-2026-10-17'
def read(p):
    return json.loads(p.read_text(encoding='utf-8'))
def digest(p):
    return sha256(p.read_bytes()).hexdigest()
def require(value, message):
    if not value:
        raise ValueError(message)

target = OUT / 'summary.json'
require(not target.exists(), 'Refusing to overwrite evidence')
previous = read(PREVIOUS / 'summary.json')
protected = previous['protectedSourceHashes']
require(all(digest(ROOT / n) == h for n, h in protected.items()), 'Protected source changed')
changed = {n for n, h in previous['checkedSourceHashes'].items() if digest(ROOT / n) != h}
expected = {'engine/experimental/tactical-worker-changes.ts', 'engine/experimental/tactical-worker-client.ts',
            'engine/experimental/tactical-worker-host.ts', 'engine/experimental/tactical-worker-wire.ts',
            'engine/lint_ts.mjs', 'engine/vitest.tactical-session.config.ts', 'scripts/check_tactical_session_sdk.mjs'}
require(changed == expected, 'Unexpected prior source change')
stages = {}
for attempt in ('attempt-03', 'typecheck-01', 'lint-01', 'sdk-01', 'public-entry-01'):
    folder = OUT / attempt
    report, cleanup, auth = [read(folder / n) for n in ('report.json', 'cleanup.json', 'authorization.json')]
    require(report['passed'] and report['exitCode'] == 0 and report['kind'] == 'cpu', 'Stage failed')
    require(report['cpuLimitPercent'] == 6 and report['memoryLimitMiB'] == 4096 and report['independentWatchdog']['armed'], 'Containment differs')
    require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'] and cleanup['globalHoldAndSourceHashesUnchanged'], 'Cleanup failed')
    require(auth['userAuthorizationSHA256'] == digest(OUT / 'sdk-resume-authorization.json'), 'CPU scope differs')
    gate = OUT / auth['quietGate']; quiet = read(gate)
    require(digest(gate) == auth['quietGateSHA256'] and quiet['passed'] and quiet['maxHostCpuPercent'] == 50 and len(quiet['samples']) == 10,
            'Quiet gate differs')
    require(all(s['hostCpuPercent'] is not None and s['hostCpuPercent'] <= 50 and s['freeMemoryMiB'] >= 8192 for s in quiet['samples']), 'Launch limits differ')
    for n, h in auth['sourceHashes'].items():
        if n.startswith(('engine/', 'scripts/', 'dist/', 'examples/tactical-worker/')) and not n.endswith('/README.md') or n in ('package.json', 'package-lock.json'):
            require(digest(ROOT / n) == h, 'Checked source changed: ' + n)
    stages[attempt] = {'passed': True, 'command': report['command'], 'wallSeconds': round(report['finishedAt'] - report['startedAt'], 3),
                       'timeoutSeconds': report['timeoutSeconds'], 'cleanupVerified': True,
                       'launchCpuCeilingPercent': 50, 'maxLaunchCpuPercent': max(s['hostCpuPercent'] for s in quiet['samples']),
                       'quietGateSHA256': digest(gate), 'evidenceSHA256': {p.name: digest(p) for p in folder.iterdir() if p.is_file()}}
tests = read(OUT / 'attempt-03/vitest.json')
require(tests['success'] and tests['numPassedTests'] == tests['numTotalTests'] == 674 and all(tests[k] == 0 for k in ('numFailedTests', 'numPendingTests', 'numTodoTests')), 'Selected tests differ')
selected = re.findall(r"'(engine/[^']+\.test\.ts)'", (ROOT / 'engine/vitest.tactical-session.config.ts').read_text(encoding='utf-8'))
actual = [Path(r['name']).resolve().relative_to(ROOT).as_posix() for r in tests['testResults']]
require(len(selected) == len(actual) == 25 and set(actual) == set(selected), 'Selected files differ')
new = next(r for r in tests['testResults'] if r['name'].endswith('tactical-worker-journal.test.ts'))
require(len(new['assertionResults']) == 26 and all(a['status'] == 'passed' for a in new['assertionResults']), 'New regression count differs')
historical = {}
for attempt, passed in [('attempt-01', False), ('attempt-02', True)]:
    folder = OUT / attempt; report = read(folder / 'report.json'); cleanup = read(folder / 'cleanup.json')
    require(report['passed'] is passed and not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'], 'Historical receipt differs')
    historical[attempt] = {'passed': passed, 'cleanupVerified': True, 'evidenceSHA256': {p.name: digest(p) for p in folder.iterdir() if p.is_file()}}
exports = read(ROOT / 'package.json')['exports']
require(len(exports) == 11 and all((ROOT / e[k]).is_file() for e in exports.values() for k in ('import', 'types')), 'SDK artifacts incomplete')
public = read(OUT / 'public-entry-01/stdout.log')
require(public['passed'] and public['physicsTicks'] == 0 and public['gpu'] is False, 'Public package scope differs')
hold = read(ROOT / 'dist/verification/safety-hold.json')
require(hold.get('blockRecovery') is True and 'recoveryPermit' not in hold, 'Runtime hold changed')
for runner in ('run_tests.py', 'run_cpu_stage.py'):
    require(digest(OUT / runner) == digest(PREVIOUS / runner), 'Reviewed runner changed')
manifest = read(OUT / 'public-entry-01/authorization.json')
record = {
    'stage': 'wishlist-build-25-worker-action-history', 'recordedAt': datetime.now(timezone.utc).isoformat(),
    'status': '674 selected edit/inert tests, types, lint, SDK and zero-tick package integration passed; physical acceptance held',
    'approvedCpuGatesComplete': True, 'fullyAccepted': False, 'fullWishlistComplete': False, 'runtimeEquivalenceProven': False,
    'currentTests': {'passed': 674, 'newActionHistoryCases': 26, 'failed': 0, 'skipped': 0, 'files': selected}, 'stages': stages,
    'historicalAttempts': historical, 'repair': 'Test expected budget wording; decoder correctly rejected with Invalid bounded action array. Assertion now checks exact error.',
    'additionalReview': 'Bound the aggregate action energy to private preview or acknowledged commit accounting; added forged-balanced-receipt regression and reran all gates.',
    'publicPackageIntegration': {'status': 'passed', 'physicsTicks': 0, 'gpu': False, 'nativeWorker': False, 'transport': 'structured-clone mock'},
    'physicalCases': {'totalHeld': 38, 'executed': False}, 'SDKBuild': 'passed; eleven bundles and declarations',
    'physicalGpuReplayBenchmarks': 'held', 'nativeWorkerExecuted': False, 'legacyDemos': 'quarantined',
    'protectedSourcesUnchanged': len(protected), 'protectedSourceHashes': protected, 'priorSourcesChanged': sorted(changed),
    'checkedSourceHashes': {n: h for n, h in manifest['sourceHashes'].items() if n.startswith(('engine/', 'scripts/', 'examples/tactical-worker/')) or n in ('package.json', 'package-lock.json')},
    'reviewedSourceHashes': {n: digest(ROOT / n) for n in manifest['sourceHashes'] if not n.startswith('dist/sdk/')},
    'sdkArtifactHashes': {p.relative_to(ROOT).as_posix(): digest(p) for p in (ROOT / 'dist/sdk').rglob('*') if p.is_file()},
    'authorizationSHA256': digest(OUT / 'sdk-resume-authorization.json'), 'recorderSHA256': digest(Path(__file__)),
    'readmeSHA256': digest(ROOT / 'examples/tactical-worker/README.md'),
    'transportProtocol': 'tactical-worker-7', 'actionJournalRulesVersion': 'action-boundaries-1',
    'captureScope': 'Latest ready preview and latest acknowledged commit; bounded portable action histories, no physical stepping during reads',
    'scopeLimits': ['Mock transport only; no native Worker execution', 'Global support observations still required when capturing changed terrain',
                    'Transport validates observations, not independent physical reexecution or truth of intermediate states',
                    'No physical replay or frame latency evidence', 'No GPU branches, copy-on-write or structural dependency reuse',
                    'No preemption within a synchronous physical tick or snapshot copy']
}
target.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'record': target.name, 'passedTests': 674, 'stages': len(stages), 'protectedSourcesUnchanged': len(protected)}))
