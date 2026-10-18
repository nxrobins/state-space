"""Read stored CPU receipts and source hashes; launch no verification workload."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import importlib.util
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
DOCS = {'docs/SDK.md', 'docs/checkpoints/TACTICAL_INTERVENTIONS.md'}


def read(path):
    return json.loads(path.read_text())


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def stage(name, expected_tests=None):
    folder = OUT / name
    report, cleanup, auth = [read(folder / (part + '.json')) for part in ('report', 'cleanup', 'authorization')]
    assert report['passed'] and report['exitCode'] == 0 and report['kind'] == 'cpu'
    assert report['independentWatchdog']['armed'] and report['cpuLimitPercent'] == 6 and report['memoryLimitMiB'] == 4096
    assert not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'] and cleanup['globalHoldAndSourceHashesUnchanged']
    gate = read(OUT / auth['quietGate'])
    assert digest(OUT / auth['quietGate']) == auth['quietGateSHA256']
    assert gate['passed'] and len(gate['samples']) == 10 and all(s['hostCpuPercent'] <= 20 and s['freeMemoryMiB'] >= 8192 for s in gate['samples'])
    telemetry = [json.loads(line) for line in (folder / 'telemetry.jsonl').read_text().splitlines() if line.strip()]
    assert all(s.get('gpu') is None for s in telemetry)
    result = {'directory': name, 'passed': True, 'command': report['command'],
        'cpuLimitPercent': 6, 'memoryLimitMiB': 4096, 'timeoutSeconds': 30, 'stallSeconds': 20,
        'sampledPeakTreeMemoryMiB': max((s.get('job') or {}).get('peakMemoryMiB', 0) for s in telemetry),
        'maxMonitorLagMs': report['maxMonitorLagMs'], 'cleanup': cleanup, 'GPUContextOrTelemetry': False,
        'receiptHashes': {part: digest(folder / (part + '.json')) for part in ('report', 'cleanup', 'authorization')},
        'quietGate': auth['quietGate'], 'quietGateSHA256': auth['quietGateSHA256']}
    if expected_tests is not None:
        tests = read(folder / 'vitest.json')
        assert tests['success'] and tests['numTotalTests'] == tests['numPassedTests'] == expected_tests
        assert not any(tests.get(k, 0) for k in ('numFailedTests', 'numPendingTests', 'numTodoTests'))
        by_file = {}
        for suite in tests['testResults']:
            assert suite['status'] == 'passed' and all(a['status'] == 'passed' for a in suite['assertionResults'])
            by_file[Path(suite['name']).name] = len(suite['assertionResults'])
        assert len(by_file) == 10 and by_file['motion-paths.test.ts'] == expected_tests - 239
        result.update(testsPassed=expected_tests, filesPassed=10, testsSkipped=0, perFile=by_file, rawTestReportSHA256=digest(folder / 'vitest.json'))
    return result, auth


def main():
    first, first_auth = stage('attempt-01', 278)
    final, test_auth = stage('attempt-02', 279)
    types, type_auth = stage('typecheck-02')
    for auth in (test_auth, type_auth):
        changes = {name for name, expected in auth['sourceHashes'].items() if digest(ROOT / name) != expected}
        assert changes <= DOCS, changes
    changed_between_runs = {name for name in first_auth['sourceHashes'] if first_auth['sourceHashes'][name] != test_auth['sourceHashes'][name]}
    assert changed_between_runs == DOCS | {'engine/experimental/motion-paths.ts', 'engine/experimental/motion-paths.test.ts'}
    stopped = []
    for name in ('typecheck-01', 'lint-01'):
        file = OUT / ('quiet-window-' + name + '.json'); gate = read(file)
        assert not gate['passed'] and gate['samples'][-1]['hostCpuPercent'] > 20 and not (OUT / name).exists()
        stopped.append({'stage': name, 'workloadLaunched': False, 'receiptSHA256': digest(file), 'observedHostCpuPercent': gate['samples'][-1]['hostCpuPercent'], 'launchLimitPercent': 20})
    old = read(OUT.parent / 'build-09-2026-10-17/validation-03.json')
    current_protected = {name: digest(ROOT / name) for name in old['protectedSourceHashes']}
    changed = {name for name in current_protected if current_protected[name] != old['protectedSourceHashes'][name]}
    assert changed == {'engine/experimental/structural-world-core.ts', 'engine/experimental/structural-material.ts', 'engine/experimental/structural-world.ts'}
    spec = importlib.util.spec_from_file_location('review', OUT / 'review_instrumentation.py')
    review = importlib.util.module_from_spec(spec); spec.loader.exec_module(review); review.main()
    hold = read(ROOT / 'dist/verification/safety-hold.json')
    assert hold['blockRecovery'] is True and 'recoveryPermit' not in hold
    held = {name: len(re.findall(r"^\s*test\('", (ROOT / 'engine/experimental' / name).read_text(), re.M)) for name in ('change-reports.runtime-cases.ts', 'motion-trace.runtime-cases.ts', 'action-journal.runtime-cases.ts', 'motion-paths.runtime-cases.ts')}
    assert sum(held.values()) == 17
    current = {name: digest(ROOT / name) for name in type_auth['sourceHashes']}
    summary = {'stage': 'wishlist-build-10-observed-ordered-material-paths', 'updatedAt': datetime.now(timezone.utc).isoformat(),
        'fullyAccepted': False, 'status': '279 edit/mock cases and no-emit types passed; lint pending; physical and SDK acceptance held',
        'supersededPassingRun': first, 'finalSuccessfulStages': [final, types], 'stoppedQuietGates': stopped,
        'reviewCorrection': 'Reject local-pass excursions by intact structural members even if the forged path returns to the expected endpoint',
        'testedSourceHashes': test_auth['sourceHashes'], 'typecheckedSourceHashes': type_auth['sourceHashes'], 'currentSourceHashes': current,
        'postVerificationDocumentationOnly': sorted(name for name in current if current[name] != type_auth['sourceHashes'][name]),
        'protectedSourcesUnchanged': len(current_protected) - len(changed), 'protectedSourceHashes': current_protected,
        'reviewedChangedProtectedSources': sorted(changed), 'instrumentationBaselineSHA256': digest(OUT / 'baseline.json'),
        'physicalProjectionMatches': True, 'runtimeEquivalenceProven': False,
        'SDKChecks': 'User-deferred; no build/public-entry execution; prior SDK output remains incomplete',
        'lint': 'Pending; quiet gate blocked launch', 'runtimeHoldUnchanged': True, 'legacyDemosQuarantined': True,
        'physicalChecks': {'executed': False, 'heldCases': held, 'totalHeldCases': 17},
        'GPUChecks': {'executed': False, 'telemetryRequested': False}, 'replayAndBenchmarks': {'executed': False},
        'limitations': ['Synthetic executed permutations and decoder checks are not physical trajectory evidence',
                       'Linear transfer segments are a kinematic convention; structural occupant relocations must not be swept',
                       'Internal consistency checks do not authenticate caller-provided histories',
                       'Session-horizon paths, intervention trajectories and actor contact/carry remain future integration work',
                       'No performance claim follows from CPU containment measurements', 'Full wishlist acceptance remains incomplete'],
        'recordScriptSHA256': digest(Path(__file__))}
    (OUT / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({'testsPassed': 279, 'newPathCases': 40, 'skipped': 0, 'typecheckPassed': True, 'lintLaunched': False,
                      'allOwnedProcessesCleaned': True, 'protectedUnchanged': len(current_protected) - len(changed), 'reviewedPhysicalHookChanges': sorted(changed), 'heldPhysicalCases': 17}))


if __name__ == '__main__':
    main()
