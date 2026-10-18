"""Read saved receipts and current hashes; no verification workload is launched."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re


FOLDER = Path(__file__).resolve().parent
ROOT = FOLDER.parents[3]
DOCS = {'docs/SDK.md', 'docs/checkpoints/TACTICAL_INTERVENTIONS.md'}


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def stage(name, expected_pass):
    folder = FOLDER / name
    report, cleanup, authorization = [read(folder / f'{filename}.json') for filename in ('report', 'cleanup', 'authorization')]
    if report['passed'] is not expected_pass or (report['exitCode'] == 0) is not expected_pass:
        raise ValueError('Unexpected stage result: ' + name)
    if cleanup['workloadStillRunning'] or cleanup['namedJobStillExists'] or not cleanup['globalHoldAndSourceHashesUnchanged']:
        raise ValueError('Incomplete cleanup: ' + name)
    if report['kind'] != 'cpu' or not report['independentWatchdog']['armed']:
        raise ValueError('Wrong containment mode: ' + name)
    samples = [json.loads(line) for line in (folder / 'telemetry.jsonl').read_text().splitlines() if line.strip()]
    if any(sample.get('gpu') is not None for sample in samples):
        raise ValueError('Unexpected GPU telemetry')
    peak = max((sample.get('job') or {}).get('peakMemoryMiB', 0) for sample in samples)
    entry = {
        'directory': name, 'passed': expected_pass, 'receiptSHA256': digest(folder / 'report.json'),
        'authorizationSHA256': digest(folder / 'authorization.json'), 'cleanupSHA256': digest(folder / 'cleanup.json'),
        'command': report['command'], 'wallSeconds': report['finishedAt'] - report['startedAt'],
        'sampledPeakTreeMemoryMiB': peak, 'maxMonitorLagMs': report['maxMonitorLagMs'],
        'cpuLimitPercent': report['cpuLimitPercent'], 'memoryLimitMiB': report['memoryLimitMiB'],
        'timeoutSeconds': report['timeoutSeconds'], 'stallSeconds': report['stallSeconds'],
        'cleanup': cleanup, 'gpuTelemetry': False,
    }
    return entry, authorization


def main():
    failure, failed_auth = stage('attempt-01', False)
    tests, test_auth = stage('attempt-02', True)
    types, type_auth = stage('typecheck-01', True)
    lint, lint_auth = stage('lint-01', True)
    result = read(FOLDER / 'attempt-02/vitest.json')
    if not result['success'] or result['numTotalTests'] != 201 or result['numPassedTests'] != 201 or any(result.get(k, 0) for k in ('numFailedTests', 'numPendingTests', 'numTodoTests')):
        raise ValueError('Incomplete selected suite')
    by_file = {}
    for suite in result['testResults']:
        if suite['status'] != 'passed' or any(a['status'] != 'passed' for a in suite['assertionResults']):
            raise ValueError('Suite did not fully pass')
        by_file[Path(suite['name']).name] = len(suite['assertionResults'])
    if len(by_file) != 8 or sum(by_file.values()) != 201:
        raise ValueError('Wrong file selection')
    tests.update(testsPassed=201, testsSkipped=0, filesPassed=8, perFile=by_file,
                 rawTestReportSHA256=digest(FOLDER / 'attempt-02/vitest.json'))
    failed = read(FOLDER / 'attempt-01/vitest.json')
    failure.update(testsPassed=failed['numPassedTests'], testsFailed=failed['numFailedTests'],
        diagnosis='Whole commit-handle equality compared distinct retained callback functions; canonical snapshots/receipt data were not reported as differing',
        fix='Compare full snapshots, receipts and returned motion/action journal data instead of function identities',
        changedSource='engine/experimental/material-reservoirs.test.ts', productionBehaviorChanged=False)
    changed_between_tests = [name for name in test_auth['sourceHashes']
                             if test_auth['sourceHashes'][name] != failed_auth['sourceHashes'][name]]
    if changed_between_tests != ['engine/experimental/material-reservoirs.test.ts']:
        raise ValueError('Unexpected retry changes')
    current = {name: digest(ROOT / name) for name in lint_auth['sourceHashes']}
    for authorization in (test_auth, type_auth, lint_auth):
        differences = {name for name, value in authorization['sourceHashes'].items() if digest(ROOT / name) != value}
        if not differences <= DOCS:
            raise ValueError('Verified code changed: ' + str(differences - DOCS))
    previous = read(FOLDER.parent / 'build-08-2026-10-17/summary.json')
    protected = {name: digest(ROOT / name) for name in previous['protectedSourceHashes']}
    if protected != previous['protectedSourceHashes']:
        raise ValueError('Protected physics/configuration source changed')
    hold = read(ROOT / 'dist/verification/safety-hold.json')
    if not hold['blockRecovery'] or 'recoveryPermit' in hold:
        raise ValueError('Global hold changed')
    gates = []
    for name in ['quiet-window-01.json', 'quiet-window-02.json', 'quiet-window-typecheck-01.json', 'quiet-window-lint-01.json']:
        gate = read(FOLDER / name)
        if not gate['passed'] or len(gate['samples']) != 10 or any(s['hostCpuPercent'] > 20 or s['freeMemoryMiB'] < 8192 for s in gate['samples']):
            raise ValueError('Quiet-window prerequisite failed')
        gates.append({'receipt': name, 'sha256': digest(FOLDER / name), 'samples': 10,
                      'maxHostCpuPercent': max(s['hostCpuPercent'] for s in gate['samples'])})
    held_cases = {}
    for name in ['change-reports.runtime-cases.ts', 'motion-trace.runtime-cases.ts', 'action-journal.runtime-cases.ts']:
        held_cases[name] = len(re.findall(r"^\s*test\('", (ROOT / 'engine/experimental' / name).read_text(), re.M))
    if sum(held_cases.values()) != 13:
        raise ValueError('Held case count changed')
    summary = {
        'stage': 'wishlist-builds-04-through-08-bounded-edit-inert-and-static-validation',
        'updatedAt': datetime.now(timezone.utc).isoformat(),
        'status': '201 edit/inert cases, no-emit type checking and lint passed; full wishlist acceptance remains incomplete',
        'failedAttemptRetained': failure, 'successfulStages': [tests, types, lint], 'quietGates': gates,
        'testedSourceHashes': test_auth['sourceHashes'], 'typecheckedSourceHashes': type_auth['sourceHashes'],
        'lintedSourceHashes': lint_auth['sourceHashes'], 'currentSourceHashes': current,
        'postVerificationDocumentationOnly': sorted(name for name in current if current[name] != lint_auth['sourceHashes'][name]),
        'protectedSourcesUnchanged': len(protected), 'protectedSourceHashes': protected,
        'runtimeHoldUnchanged': True, 'legacyDemosQuarantined': True,
        'SDKChecks': 'User-deferred; no SDK/public-entry command launched; previous SDK output remains incomplete',
        'physicalChecks': {'executed': False, 'heldCases': held_cases, 'totalHeldCases': 13},
        'GPUChecks': {'executed': False, 'telemetryRequested': False},
        'replayAndBenchmarks': {'executed': False},
        'scopeLimits': [
            'Real edits, portable validation, geometry queries, pure provenance fixtures and inert driver/support protocols only',
            'No actual structural support solve or physical tick trajectory is proven by this suite',
            'Full-state capture equivalence, exact replay/restart and CPU/GPU parity remain held',
            'Type checking and static lint do not validate SDK bundles or runtime behavior',
            'Containment timing/memory samples are not gameplay performance measurements',
            'Actor/elemental integration, bounded execution/rendering, efficient branching and exact support reuse remain open',
        ],
        'recordScriptSHA256': digest(Path(__file__)),
    }
    (FOLDER / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'testsPassed': 201, 'skipped': 0, 'typecheckPassed': True, 'lintPassed': True,
                      'allOwnedWorkloadsCleaned': True, 'protectedUnchanged': len(protected),
                      'postCheckEdits': summary['postVerificationDocumentationOnly'], 'heldPhysicalCases': 13}))


if __name__ == '__main__':
    main()
