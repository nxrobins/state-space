"""Read saved receipts and hash source; no build, test or runtime is launched."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]


def read(path):
    return json.loads(path.read_text())


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def main():
    folder = OUT / 'attempt-01'
    report, cleanup, authorization, tests = [read(folder / (name + '.json')) for name in ('report', 'cleanup', 'authorization', 'vitest')]
    assert report['kind'] == 'cpu' and report['passed'] is False and report['exitCode'] == 1
    assert report['independentWatchdog']['armed'] and report['cpuLimitPercent'] == 6 and report['memoryLimitMiB'] == 4096
    assert not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'] and cleanup['globalHoldAndSourceHashesUnchanged']
    assert tests['numPassedTests'] == 165 and tests['numFailedTests'] == 1 and not tests['success']
    failed = [a for s in tests['testResults'] for a in s['assertionResults'] if a['status'] == 'failed']
    assert len(failed) == 1 and 'prospective volume budget' in failed[0]['title'] and '512 chunks' in failed[0]['failureMessages'][0]
    samples = [json.loads(line) for line in (folder / 'telemetry.jsonl').read_text().splitlines() if line.strip()]
    assert all(s.get('gpu') is None for s in samples)
    first_gate, stopped_gate = [read(OUT / ('quiet-window-' + name + '.json')) for name in ('attempt-01', 'attempt-02')]
    assert first_gate['passed'] and len(first_gate['samples']) == 10
    assert all(s['hostCpuPercent'] <= 20 and s['freeMemoryMiB'] >= 8192 for s in first_gate['samples'])
    assert not stopped_gate['passed'] and stopped_gate['samples'][-1]['hostCpuPercent'] > 20
    assert not (OUT / 'attempt-02').exists()
    assert all(not (OUT / name).exists() for name in ('typecheck-01', 'lint-01', 'sdk-01', 'public-entry-01'))
    prior = read(OUT.parent / 'validation-08-2026-10-17/summary.json')
    protected = {name: digest(ROOT / name) for name in prior['protectedSourceHashes']}
    assert protected == prior['protectedSourceHashes']
    hold = read(ROOT / 'dist/verification/safety-hold.json')
    assert hold['blockRecovery'] is True and 'recoveryPermit' not in hold
    current = {name: digest(ROOT / name) for name in authorization['sourceHashes']}
    changed = sorted(name for name in current if current[name] != authorization['sourceHashes'][name])
    expected_changes = ['docs/SDK.md', 'docs/checkpoints/TACTICAL_INTERVENTIONS.md', 'engine/experimental/tactical-session-core.ts', 'engine/experimental/terrain-body.test.ts']
    assert changed == expected_changes, changed
    assert digest(OUT / 'run_tests.py') == digest(OUT.parent / 'validation-08-2026-10-17/run_tests.py')
    body_cases = len(re.findall(r"^\s*test\('", (ROOT / 'engine/experimental/terrain-body.test.ts').read_text(), re.M)) + 12
    assert body_cases == 38 and authorization['expectedTests'] == 239
    held = {name: len(re.findall(r"^\s*test\('", (ROOT / 'engine/experimental' / name).read_text(), re.M)) for name in ['change-reports.runtime-cases.ts', 'motion-trace.runtime-cases.ts', 'action-journal.runtime-cases.ts']}
    receipts = ['attempt-01/' + name for name in ['authorization.json', 'report.json', 'cleanup.json', 'vitest.json', 'telemetry.jsonl']]
    receipts += ['quiet-window-attempt-01.json', 'quiet-window-attempt-02.json']
    summary = {
        'stage': 'wishlist-build-09-kinematic-bodies-exposure-and-complete-tick-queries',
        'updatedAt': datetime.now(timezone.utc).isoformat(), 'accepted': False,
        'status': 'Source implemented; fixture corrected after first-failure stop; quiet gate blocked retry',
        'authoredSelectedSuite': {'files': 9, 'tests': 239, 'newBodyExposureAndInertIntegrationCases': body_cases},
        'failedAttempt': {
            'directory': 'attempt-01', 'passed': False, 'testsPassedBeforeStop': 165, 'testsFailed': 1,
            'diagnosis': 'Oversized exposure fixture exceeded the existing 512-chunk constructor limit before testing its query budget',
            'sourceFix': 'Use chunkSize 8 instead of 4 for the same 64x32x64 static volume; no physics or query behavior changed',
            'retryStatus': 'Not launched; four-sample quiet gate failed at 20.29% host CPU',
            'command': report['command'], 'cpuLimitPercent': 6, 'memoryLimitMiB': 4096,
            'timeoutSeconds': 30, 'stallSeconds': 20, 'maxMonitorLagMs': report['maxMonitorLagMs'],
            'sampledPeakTreeMemoryMiB': max((s.get('job') or {}).get('peakMemoryMiB', 0) for s in samples),
            'cleanup': cleanup, 'independentWatchdog': report['independentWatchdog'],
        },
        'attemptedSourceHashes': authorization['sourceHashes'], 'currentSourceHashes': current,
        'postRunChangesPendingValidation': changed,
        'postRunProductionReview': 'Retained lazy tick queries capture only terrain and reservoir domains, not previous game/AP data',
        'protectedSourcesUnchanged': len(protected), 'protectedSourceHashes': protected,
        'receiptHashes': {name: digest(OUT / name) for name in receipts},
        'pending': ['Corrected 239-case edit/static/inert suite', 'No-emit TypeScript check', 'Structural lint'],
        'SDKChecks': 'User-deferred; no build/public-entry execution; existing SDK output remains incomplete',
        'runtimeHoldUnchanged': True, 'legacyDemosQuarantined': True,
        'physicalChecks': {'executed': False, 'heldCases': held},
        'GPUChecks': {'executed': False, 'telemetryRequested': False},
        'replayAndBenchmarks': {'executed': False},
        'limits': ['Kinematic bodies resolve only against one static complete terrain boundary',
                   'Endpoint exposure does not integrate movement-path exposure or thermal dose',
                   'Moving platforms, debris paths, actor-actor contacts and structural loads remain unimplemented',
                   'Pure actor continuation on static terrain is not physical replay evidence',
                   'Full wishlist acceptance remains incomplete'],
        'recordScriptSHA256': digest(Path(__file__)),
    }
    (OUT / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({'accepted': False, 'authoredTests': 239, 'failedAttemptRetained': True, 'retryLaunched': False, 'ownedProcessesCleaned': True, 'protectedUnchanged': len(protected), 'postRunChanges': changed, 'SDKRuntimeHoldIntact': True}))


if __name__ == '__main__':
    main()
