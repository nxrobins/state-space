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
previous = read(OUT.parent / 'build-23-2026-10-17/summary.json')
protected = previous['protectedSourceHashes']
require(all(digest(ROOT / name) == value for name, value in protected.items()), 'Protected source changed')
expected_changes = {'engine/experimental/tactical-previews.ts', 'engine/experimental/tactical-session-core.ts',
                    'engine/experimental/tactical-session-view.ts', 'engine/experimental/tactical-session.test.ts',
                    'engine/experimental/tactical-session.ts', 'engine/experimental/tactical-worker-client.ts',
                    'engine/experimental/tactical-worker-host.ts', 'engine/experimental/tactical-worker-queries.test.ts',
                    'engine/experimental/tactical-worker-queries.ts', 'engine/experimental/tactical-worker-wire.ts',
                    'engine/lint_ts.mjs', 'engine/vitest.tactical-session.config.ts', 'scripts/check_tactical_session_sdk.mjs'}
changed = {name for name, value in previous['checkedSourceHashes'].items() if digest(ROOT / name) != value}
require(changed == expected_changes, 'Unexpected changes to prior implementation')
stages = {}
for name in ('attempt-03', 'typecheck-04', 'lint-02', 'sdk-02', 'public-entry-02'):
    folder = OUT / name
    report, cleanup, auth = [read(folder / p) for p in ('report.json', 'cleanup.json', 'authorization.json')]
    require(report['passed'] is True and report['exitCode'] == 0 and report['kind'] == 'cpu', 'Failed stage')
    require(report['cpuLimitPercent'] == 6 and report['memoryLimitMiB'] == 4096 and report['independentWatchdog']['armed'], 'Limits changed')
    require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'] and cleanup['globalHoldAndSourceHashesUnchanged'], 'Cleanup failed')
    require(auth.get('userAuthorization') == 'sdk-resume-authorization.json' and auth.get('userAuthorizationSHA256') == digest(OUT / 'sdk-resume-authorization.json'), 'Explicit CPU resumption approval differs')
    gate = OUT / auth['quietGate']
    require(digest(gate) == auth['quietGateSHA256'] and read(gate)['passed'], 'Quiet gate changed')
    quiet = read(gate)
    require(quiet['maxHostCpuPercent'] == 50 and quiet['requiredSamples'] == 10 and len(quiet['samples']) == 10 and all(s['hostCpuPercent'] is not None and s['hostCpuPercent'] <= 50 and s['freeMemoryMiB'] >= 8192 for s in quiet['samples']), 'CPU resumption gate differs')
    for source, value in auth['sourceHashes'].items():
        if source.startswith(('engine/', 'scripts/', 'dist/', 'examples/tactical-worker/')) and not source.endswith('/README.md') or source in ('package.json', 'package-lock.json'):
            require(digest(ROOT / source) == value, 'Checked source changed: ' + source)
    stages[name] = {'passed': True, 'wallSeconds': round(report['finishedAt'] - report['startedAt'], 3),
                    'command': report['command'], 'timeoutSeconds': report['timeoutSeconds'], 'cleanupVerified': True,
                    'evidenceSHA256': {p.name: digest(p) for p in sorted(folder.iterdir()) if p.is_file()},
                    'quietGateSHA256': digest(gate), 'launchCpuCeilingPercent': 50, 'maxLaunchCpuPercent': max(s['hostCpuPercent'] for s in quiet['samples'])}

tests = read(OUT / 'attempt-03/vitest.json')
require(tests['success'] and tests['numPassedTests'] == tests['numTotalTests'] == 648
        and all(tests[k] == 0 for k in ('numFailedTests', 'numPendingTests', 'numTodoTests')), 'Test coverage differs')
selected = re.findall(r"'(engine/[^']+\.test\.ts)'", (ROOT / 'engine/vitest.tactical-session.config.ts').read_text())
actual = [Path(result['name']).resolve().relative_to(ROOT).as_posix() for result in tests['testResults']]
require(len(selected) == 24 and len(actual) == 24 and set(selected) == set(actual), 'Selected test files differ')
worker_tests = next(result for result in tests['testResults'] if result['name'].endswith('tactical-worker-preview-queries.test.ts'))
require(len(worker_tests['assertionResults']) == 26 and all(t['status'] == 'passed' for t in worker_tests['assertionResults']), 'Preview query selection differs')
exports = read(ROOT / 'package.json')['exports']
require(len(exports) == 11 and all((ROOT / e[k]).is_file() for e in exports.values() for k in ('import', 'types')), 'SDK outputs incomplete')
hold = read(ROOT / 'dist/verification/safety-hold.json')
require(hold.get('blockRecovery') is True and 'recoveryPermit' not in hold, 'Hold changed')
manifest = read(OUT / 'public-entry-02/authorization.json')
public = read(OUT / 'public-entry-02/stdout.log')
require(public['passed'] is True and public['physicsTicks'] == 0 and public['gpu'] is False, 'Public integration scope differs')
failed = read(OUT / 'public-entry-01/report.json')
require(failed['passed'] is False and failed['exitCode'] != 0, 'Prior integration failure missing')
failed_cleanup = read(OUT / 'public-entry-01/cleanup.json')
require(not failed_cleanup['workloadStillRunning'] and not failed_cleanup['namedJobStillExists'], 'Prior failure cleanup incomplete')
for runner in ('run_tests.py', 'run_cpu_stage.py'):
    require(digest(OUT / runner) == digest(OUT.parent / 'build-23-2026-10-17' / runner), 'Reviewed runner changed')
record = {
    'stage': 'wishlist-build-24-preview-queries', 'recordedAt': datetime.now(timezone.utc).isoformat(),
    'status': '648 edit/inert tests, types, lint, SDK build and zero-tick preview queries package integration passed; physical acceptance held',
    'approvedCpuGatesComplete': True, 'fullyAccepted': False, 'fullWishlistComplete': False, 'runtimeEquivalenceProven': False,
    'currentTests': {'passed': 648, 'previewQueryCases': 26, 'existingWorkerPathCases': 22, 'existingWorkerMotionCases': 22, 'existingPreviewCaptureCases': 22, 'existingReportCases': 19, 'existingQueryCases': 20, 'existingWorkerCases': 36, 'failed': 0, 'skipped': 0, 'files': selected}, 'stages': stages,
    'publicPackageIntegration': {'status': 'passed', 'workloadLaunched': True, 'physicsTicks': 0, 'gpu': False, 'nativeWorker': False, 'transport': 'structured-clone mock'},
    'verificationResumption': {'userInstruction': read(OUT / 'sdk-resume-authorization.json')['userInstruction'], 'authorizationSHA256': digest(OUT / 'sdk-resume-authorization.json'), 'launchCpuCeilingPercent': 50, 'priorCpuCeilingPercent': 20, 'supervisorAndRunnersUnchanged': True},
    'repairedIntegrationFailure': {'attempt': 'public-entry-01', 'cause': 'Assertion omitted the newly required branchId and operation metadata; now checks exact values', 'reportSHA256': digest(OUT / 'public-entry-01/report.json'), 'stderrSHA256': digest(OUT / 'public-entry-01/stderr.log'), 'cleanupSHA256': digest(OUT / 'public-entry-01/cleanup.json')},
    'earlierRefusedGates': {p.name: digest(p) for p in OUT.glob('quiet-window-*.json') if not read(p)['passed']},
    'physicalCases': {'totalHeld': 38, 'executed': False}, 'SDKBuild': 'passed; eleven bundles plus declarations',
    'physicalGpuReplayBenchmarks': 'held', 'nativeWorkerExecuted': False, 'legacyDemos': 'quarantined',
    'protectedSourcesUnchanged': len(protected), 'protectedSourceHashes': protected,
    'priorSourcesChanged': sorted(changed),
    'checkedSourceHashes': {name: value for name, value in manifest['sourceHashes'].items()
                            if name.startswith(('engine/', 'scripts/', 'examples/tactical-worker/')) or name in ('package.json', 'package-lock.json')},
    'reviewedSourceHashes': {name: digest(ROOT / name) for name in manifest['sourceHashes'] if not name.startswith('dist/sdk/')},
    'sdkArtifactHashes': {p.relative_to(ROOT).as_posix(): digest(p) for p in sorted((ROOT / 'dist/sdk').rglob('*')) if p.is_file()},
    'queryRulesVersion': 'tactical-query-batches-1', 'previewQueryRulesVersion': 'tactical-preview-query-batches-1', 'transportProtocol': 'tactical-worker-6', 'reportRulesVersion': 'gameplay-changes-1', 'previewRulesVersion': 'tactical-previews-1',
    'captureScope': 'Latest ready preview geometry including reservoirs; private candidate validation and invalidation',
    'scopeLimits': ['Mock transport only; no native Worker execution', 'Ready preview geometry is available; support is geometric footing, not capacity; action-journal transport remains pending', 'Full CPU geometry copies and global support solves remain; no latency or GPU readback claim', 'No preemption inside a synchronous physical tick or snapshot copy',
                    'No physical replay or frame latency evidence', 'No installation into an external consumer project'],
    'recorderSHA256': digest(Path(__file__)),
}
destination.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'record': destination.name, 'testsPassed': 648, 'stagesPassed': len(stages),
                  'protectedSourcesUnchanged': len(protected), 'publicIntegration': 'passed'}))
