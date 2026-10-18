"""Validate stored bounded CPU receipts; never launch a verification workload."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
DOCS = {'docs/SDK.md', 'docs/checkpoints/TACTICAL_INTERVENTIONS.md'}


def read(path):
    return json.loads(path.read_text())


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def stage(name, expected_tests=None, earlier=False):
    folder = OUT / name
    report, cleanup, auth = [read(folder / (part + '.json')) for part in ('report', 'cleanup', 'authorization')]
    assert report['passed'] and report['exitCode'] == 0 and report['kind'] == 'cpu'
    assert report['independentWatchdog']['armed'] and report['containment'] == 'Windows job'
    assert report['cpuLimitPercent'] == 6 and report['memoryLimitMiB'] == 4096
    assert report['timeoutSeconds'] == 30 and report['stallSeconds'] == 20
    assert not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists']
    assert cleanup['globalHoldAndSourceHashesUnchanged'] and cleanup['authorizationConsumed']
    assert cleanup['GPUReplayBenchmarksAllowed'] is False
    gate = read(OUT / auth['quietGate'])
    assert digest(OUT / auth['quietGate']) == auth['quietGateSHA256']
    assert gate['passed'] and len(gate['samples']) == 10
    assert all(s['hostCpuPercent'] <= 20 and s['freeMemoryMiB'] >= 8192 for s in gate['samples'])
    telemetry = [json.loads(line) for line in (folder / 'telemetry.jsonl').read_text().splitlines() if line.strip()]
    assert telemetry and all(s.get('gpu') is None for s in telemetry)
    changes = {name for name, expected in auth['sourceHashes'].items() if digest(ROOT / name) != expected}
    assert changes <= DOCS | ({'engine/experimental/terrain-displacement.test.ts'} if earlier else set()), changes
    result = {'directory': name, 'passed': True, 'command': report['command'],
        'cpuLimitPercent': 6, 'memoryLimitMiB': 4096, 'timeoutSeconds': 30, 'stallSeconds': 20,
        'sampledPeakTreeMemoryMiB': max((s.get('job') or {}).get('peakMemoryMiB', 0) for s in telemetry),
        'maxMonitorLagMs': report['maxMonitorLagMs'], 'cleanup': cleanup, 'GPUContextOrTelemetry': False,
        'receiptHashes': {part: digest(folder / (part + '.json')) for part in ('report', 'cleanup', 'authorization')},
        'quietGate': auth['quietGate'], 'quietGateSHA256': auth['quietGateSHA256'],
        'postVerificationDocumentationOnly': sorted(changes)}
    if expected_tests is not None:
        tests = read(folder / 'vitest.json')
        assert tests['success'] and tests['numTotalTests'] == tests['numPassedTests'] == expected_tests
        assert not any(tests.get(k, 0) for k in ('numFailedTests', 'numPendingTests', 'numTodoTests'))
        by_file = {}
        for suite in tests['testResults']:
            assert suite['status'] == 'passed' and all(a['status'] == 'passed' for a in suite['assertionResults'])
            by_file[Path(suite['name']).name] = len(suite['assertionResults'])
        assert len(by_file) == 13 and by_file['terrain-displacement.test.ts'] == expected_tests - 332
        result.update(testsPassed=expected_tests, filesPassed=13, testsSkipped=0, perFile=by_file,
                      rawTestReportSHA256=digest(folder / 'vitest.json'))
    return result, auth


def main():
    assert not (OUT / 'summary.json').exists(), 'Never overwrite a retained receipt'
    first, first_auth = stage('attempt-01', 366, earlier=True)
    final, test_auth = stage('attempt-02', 367)
    changed = {name for name in first_auth['sourceHashes'] if first_auth['sourceHashes'][name] != test_auth['sourceHashes'][name]}
    assert changed == {'engine/experimental/terrain-displacement.test.ts'}, changed
    gate_path = OUT / 'quiet-window-typecheck-01.json'
    gate = read(gate_path)
    assert not gate['passed'] and gate['samples'][-1]['hostCpuPercent'] > 20
    assert not (OUT / 'typecheck-01').exists() and not (OUT / 'lint-01').exists()
    previous = read(OUT.parent / 'build-12-2026-10-17/summary.json')
    protected = previous['protectedSourceHashes']
    assert len(protected) == 96
    assert all(digest(ROOT / name) == expected for name, expected in protected.items())
    hold = read(ROOT / 'dist/verification/safety-hold.json')
    assert hold['blockRecovery'] is True and 'recoveryPermit' not in hold
    held = {name: len(re.findall(r"^\s*test\('", (ROOT / 'engine/experimental' / name).read_text(), re.M))
            for name in ('change-reports.runtime-cases.ts', 'motion-trace.runtime-cases.ts',
                         'action-journal.runtime-cases.ts', 'motion-paths.runtime-cases.ts',
                         'path-journal.runtime-cases.ts', 'terrain-motion.runtime-cases.ts',
                         'terrain-displacement.runtime-cases.ts')}
    assert sum(held.values()) == 26 and held['terrain-displacement.runtime-cases.ts'] == 3
    summary = {'stage': 'wishlist-build-13-terrain-driven-body-displacement',
        'updatedAt': datetime.now(timezone.utc).isoformat(), 'fullyAccepted': False,
        'status': '367 edit/mock cases passed; types/lint pending; SDK deferred and physical runtime held',
        'earlierPassingTestStage': first, 'successfulStages': [final], 'testedSourceHashes': test_auth['sourceHashes'],
        'reviewAddition': 'Added exact later opposing impact at 2031/2048 after the initial passing 366-case run',
        'currentSourceHashes': {name: digest(ROOT / name) for name in test_auth['sourceHashes']},
        'protectedSourcesUnchanged': len(protected), 'protectedSourceHashes': protected,
        'previousValidationSHA256': digest(OUT.parent / 'build-12-2026-10-17/summary.json'),
        'typecheck': {'status': 'pending', 'workloadLaunched': False, 'gateSHA256': digest(gate_path),
                      'hostCpuPercent': gate['samples'][-1]['hostCpuPercent'], 'launchLimitPercent': 20},
        'lint': {'status': 'pending', 'workloadLaunched': False},
        'SDKChecks': 'User-deferred; no build/public-entry execution; prior SDK output remains incomplete',
        'runtimeHoldUnchanged': True, 'legacyDemosQuarantined': True,
        'physicalChecks': {'executed': False, 'heldCases': held, 'totalHeldCases': 26},
        'GPUChecks': {'executed': False, 'telemetryRequested': False},
        'replayAndBenchmarks': {'executed': False}, 'runtimeEquivalenceProven': False,
        'limitations': ['Synthetic observed permutations do not prove actual physical trajectories or replay',
                       'Crush means conflicting chosen kinematic constraints, not a proof about every rigid-body escape',
                       'Actor-actor response, terrain loads, force feedback and intervention coupling remain unimplemented',
                       'Per-body work bounds do not establish whole-game latency or scheduling responsiveness',
                       'Full wishlist acceptance remains incomplete'],
        'recordScriptSHA256': digest(Path(__file__))}
    (OUT / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({'testsPassed': 367, 'newDisplacementCases': 35, 'skipped': 0,
                      'typecheck': 'pending', 'lint': 'pending', 'allOwnedProcessesCleaned': True,
                      'protectedSourcesUnchanged': 96, 'heldPhysicalCases': 26}))


if __name__ == '__main__':
    main()


