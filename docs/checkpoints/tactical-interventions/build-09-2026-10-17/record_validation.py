"""Record the bounded Build 9 retry and types; lint did not pass its launch gate."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
DOCS = {'docs/SDK.md', 'docs/checkpoints/TACTICAL_INTERVENTIONS.md'}


def read(path):
    return json.loads(path.read_text())


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def stage(name):
    folder = OUT / name
    report, cleanup, authorization = [read(folder / (part + '.json')) for part in ('report', 'cleanup', 'authorization')]
    assert report['passed'] and report['exitCode'] == 0 and report['kind'] == 'cpu'
    assert report['independentWatchdog']['armed'] and report['cpuLimitPercent'] == 6 and report['memoryLimitMiB'] == 4096
    assert not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'] and cleanup['globalHoldAndSourceHashesUnchanged']
    changed = {name for name, expected in authorization['sourceHashes'].items() if digest(ROOT / name) != expected}
    assert changed <= DOCS, changed
    telemetry = [json.loads(line) for line in (folder / 'telemetry.jsonl').read_text().splitlines() if line.strip()]
    assert all(sample.get('gpu') is None for sample in telemetry)
    gate = read(OUT / authorization['quietGate'])
    assert digest(OUT / authorization['quietGate']) == authorization['quietGateSHA256']
    assert gate['passed'] and len(gate['samples']) == 10 and all(sample['hostCpuPercent'] <= 20 and sample['freeMemoryMiB'] >= 8192 for sample in gate['samples'])
    return {
        'directory': name, 'passed': True, 'command': report['command'],
        'wallSeconds': report['finishedAt'] - report['startedAt'],
        'sampledPeakTreeMemoryMiB': max((s.get('job') or {}).get('peakMemoryMiB', 0) for s in telemetry),
        'maxMonitorLagMs': report['maxMonitorLagMs'], 'cpuLimitPercent': 6, 'memoryLimitMiB': 4096,
        'timeoutSeconds': 30, 'stallSeconds': 20, 'independentWatchdogArmed': True,
        'cleanup': cleanup, 'GPUContextOrTelemetry': False,
        'receiptHashes': {part: digest(folder / (part + '.json')) for part in ('report', 'cleanup', 'authorization')},
        'quietGate': authorization['quietGate'], 'quietGateSHA256': authorization['quietGateSHA256'],
    }, authorization


def main():
    tests, test_auth = stage('attempt-03')
    types, type_auth = stage('typecheck-01')
    result = read(OUT / 'attempt-03/vitest.json')
    assert result['success'] and result['numTotalTests'] == result['numPassedTests'] == 239
    assert not any(result.get(key, 0) for key in ('numFailedTests', 'numPendingTests', 'numTodoTests'))
    per_file = {}
    for suite in result['testResults']:
        assert suite['status'] == 'passed' and all(a['status'] == 'passed' for a in suite['assertionResults'])
        per_file[Path(suite['name']).name] = len(suite['assertionResults'])
    assert len(per_file) == 9 and per_file['terrain-body.test.ts'] == 38
    tests.update(testsPassed=239, testsSkipped=0, filesPassed=9, perFile=per_file,
                 rawTestReportSHA256=digest(OUT / 'attempt-03/vitest.json'))
    lint_gate = read(OUT / 'quiet-window-lint-01.json')
    assert not lint_gate['passed'] and lint_gate['samples'][-1]['hostCpuPercent'] > 20
    assert not (OUT / 'lint-01').exists()
    previous = read(OUT / 'summary.json')
    protected = {name: digest(ROOT / name) for name in previous['protectedSourceHashes']}
    assert protected == previous['protectedSourceHashes']
    hold = read(ROOT / 'dist/verification/safety-hold.json')
    assert hold['blockRecovery'] is True and 'recoveryPermit' not in hold
    current = {name: digest(ROOT / name) for name in type_auth['sourceHashes']}
    summary = {
        'stage': 'wishlist-build-09-bounded-edit-inert-and-static-validation',
        'updatedAt': datetime.now(timezone.utc).isoformat(), 'fullyAccepted': False,
        'status': '239 edit/static/inert cases and no-emit type checking passed; lint launch gate failed',
        'successfulStages': [tests, types],
        'lint': {'executed': False, 'status': 'pending', 'quietGate': 'quiet-window-lint-01.json',
                 'quietGateSHA256': digest(OUT / 'quiet-window-lint-01.json'),
                 'observedHostCpuPercent': lint_gate['samples'][-1]['hostCpuPercent'], 'launchLimitPercent': 20},
        'priorFailureAndStoppedRetry': {'record': 'summary.json', 'sha256': digest(OUT / 'summary.json')},
        'testedSourceHashes': test_auth['sourceHashes'], 'typecheckedSourceHashes': type_auth['sourceHashes'],
        'currentSourceHashes': current, 'postVerificationDocumentationOnly': sorted(name for name in current if current[name] != type_auth['sourceHashes'][name]),
        'protectedSourcesUnchanged': len(protected), 'protectedSourceHashes': protected,
        'SDKChecks': 'User-deferred; no SDK build/public-entry command; existing SDK output incomplete',
        'runtimeHoldUnchanged': True, 'legacyDemosQuarantined': True,
        'physicalChecks': previous['physicalChecks'], 'GPUChecks': previous['GPUChecks'],
        'replayAndBenchmarks': previous['replayAndBenchmarks'],
        'limitations': previous['limits'] + ['No gameplay performance claim follows from containment timing/memory samples'],
        'recordScriptSHA256': digest(Path(__file__)),
    }
    (OUT / 'validation-02.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({'testsPassed': 239, 'files': 9, 'skipped': 0, 'typecheckPassed': True,
                      'lintLaunched': False, 'protectedUnchanged': len(protected), 'allOwnedProcessesCleaned': True,
                      'peakSampledMemoryMiB': [tests['sampledPeakTreeMemoryMiB'], types['sampledPeakTreeMemoryMiB']]}))


if __name__ == '__main__':
    main()
