"""Audit final bounded CPU receipts without importing or executing simulation."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
PREVIOUS = OUT.parent / 'build-52-2026-10-17'

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def digest(path):
    return sha256(path.read_bytes()).hexdigest()

def require(ok, message):
    if not ok:
        raise ValueError(message)

def owned(name):
    return name.startswith(('engine/', 'scripts/', 'examples/tactical-worker/', 'examples/tactical-slab/')) or name in ('package.json', 'package-lock.json')

def artifacts(folder):
    return {p.relative_to(ROOT).as_posix(): digest(p) for p in (ROOT / folder).rglob('*') if p.is_file()}

target = OUT / 'summary.json'
require(not target.exists(), 'Refusing to overwrite evidence')
previous = read(PREVIOUS / 'summary.json')
protected = previous['protectedSourceHashes']
require(len(protected) == 96 and all(digest(ROOT / n) == h for n, h in protected.items()), 'Protected source changed')
changed = {n for n, h in previous['checkedSourceHashes'].items() if digest(ROOT / n) != h}
require(changed == {'engine/experimental/tactical-worker-queries.ts', 'engine/experimental/reactive-worker-wire.ts',
    'engine/experimental/reactive-worker-host.ts', 'engine/experimental/reactive-worker-client.ts', 'engine/experimental/reactive-materials.ts',
    'engine/lint_ts.mjs', 'scripts/check_reactive_materials_sdk.mjs'}, 'Unexpected prior source change: ' + str(changed))
sdk, browser = artifacts('dist/sdk'), artifacts('dist/tactical-slab')
sdk_changed = {n for n, h in previous['sdkArtifactHashes'].items() if sdk.get(n) != h}
require(sdk_changed == {'dist/sdk/state-space-reactive-materials.js', 'dist/sdk/state-space-tactical-session.js',
    'dist/sdk/types/experimental/reactive-materials.d.ts', 'dist/sdk/types/experimental/reactive-worker-client.d.ts',
    'dist/sdk/types/experimental/reactive-worker-wire.d.ts'}, 'Unexpected SDK changes: ' + str(sdk_changed))
new_sdk = set(sdk) - set(previous['sdkArtifactHashes'])
require(new_sdk == {'dist/sdk/types/experimental/' + n + '.d.ts' for n in ('geometry-query-wire', 'reactive-changes', 'reactive-worker-changes', 'reactive-worker-queries')}, 'Unexpected new declarations')
require(len(sdk) == 146, 'SDK artifact inventory differs')
browser_changed = {n for n, h in previous['browserArtifactHashes'].items() if browser.get(n) != h}
require(set(browser) == set(previous['browserArtifactHashes']) and browser_changed == {'dist/tactical-slab/app.js', 'dist/tactical-slab/worker.js', 'dist/tactical-slab/bundle-inputs.json'}, 'Unexpected browser artifact changes')
bundle = read(ROOT / 'dist/tactical-slab/bundle-inputs.json')
require(all(not n.startswith('engine/') for n in bundle['inputs']) and 'dist/sdk/state-space-tactical-session.js' in bundle['inputs'], 'Browser client crossed public SDK boundary')
hold_hash = digest(ROOT / 'dist/verification/safety-hold.json')
hold = read(ROOT / 'dist/verification/safety-hold.json')
require(hold_hash == previous['holdSHA256'] and hold.get('blockRecovery') is True and 'recoveryPermit' not in hold, 'Runtime hold changed')
for name in ('run_tests.py', 'run_cpu_stage.py'):
    require(digest(OUT / name) == digest(PREVIOUS / name), 'Reviewed runner changed')

expected_suites = {'observations': {'passed': 40, 'files': ['engine/experimental/reactive-worker-observations.test.ts']}, **previous['currentTests']['suites']}
stages, final, results, selected = {}, {}, {}, []
for label in [*expected_suites, 'typecheck', 'lint', 'sdk', 'public-entry']:
    suite = label if label in expected_suites else None
    prefix = 'attempt' if suite else label
    paths = [p for p in OUT.glob(prefix + '-*/report.json') if not suite or read(p.parent / 'authorization.json').get('testSuite') == suite]
    require(bool(paths), 'Missing stage ' + label)
    path = max(paths, key=lambda p: read(p)['startedAt'])
    folder, report = path.parent, read(path)
    auth, cleanup = read(folder / 'authorization.json'), read(folder / 'cleanup.json')
    require(report['passed'] and report['exitCode'] == 0 and report['kind'] == 'cpu', 'Stage failed: ' + label)
    require(report['cpuLimitPercent'] == 6 and report['memoryLimitMiB'] == 4096 and report['independentWatchdog']['armed'], 'Containment changed')
    require(report['timeoutSeconds'] == (60 if label == 'sdk' else 30) and report['stallSeconds'] == 20, 'Deadline changed')
    require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'] and cleanup['globalHoldAndSourceHashesUnchanged'], 'Cleanup incomplete')
    require(auth['userAuthorizationSHA256'] == digest(OUT / 'sdk-resume-authorization.json'), 'Authorization changed')
    gate_path = OUT / auth['quietGate']; gate = read(gate_path)
    require(digest(gate_path) == auth['quietGateSHA256'] and gate['passed'] and gate['maxHostCpuPercent'] == 50 and len(gate['samples']) == 10, 'Quiet gate changed')
    require(all(s['hostCpuPercent'] is not None and s['hostCpuPercent'] <= 50 and s['freeMemoryMiB'] >= 8192 for s in gate['samples']), 'Quiet limits differ')
    for name, expected in auth['sourceHashes'].items():
        if owned(name) or name.startswith('dist/'):
            require(digest(ROOT / name) == expected, 'Source/artifact changed since acceptance: ' + name)
    final[label] = folder
    stages[label] = {'attempt': folder.name, 'passed': True, 'command': report['command'], 'timeoutSeconds': report['timeoutSeconds'],
        'wallSeconds': round(report['finishedAt'] - report['startedAt'], 3), 'cleanupVerified': True,
        'maxLaunchCpuPercent': max(s['hostCpuPercent'] for s in gate['samples']), 'quietGateSHA256': digest(gate_path),
        'evidenceSHA256': {p.name: digest(p) for p in folder.iterdir() if p.is_file()}}
    if suite:
        result, expected = read(folder / 'vitest.json'), expected_suites[suite]
        require(result['success'] and result['numPassedTests'] == result['numTotalTests'] == expected['passed'] and
            all(result[k] == 0 for k in ('numFailedTests', 'numPendingTests', 'numTodoTests')), 'Test counts differ: ' + suite)
        actual = [Path(r['name']).resolve().relative_to(ROOT).as_posix() for r in result['testResults']]
        require(len(actual) == len(expected['files']) and set(actual) == set(expected['files']), 'Test scope differs: ' + suite)
        require(not set(actual).intersection(selected), 'Duplicate test coverage')
        selected.extend(actual); results[suite] = {'passed': expected['passed'], 'files': actual}
require(sum(r['passed'] for r in results.values()) == 1695 and len(selected) == 57 and len(stages) == 20, 'Combined coverage differs')
held = {p.relative_to(ROOT).as_posix(): len(re.findall(r'\btest\(', p.read_text())) for p in (ROOT / 'engine/experimental').glob('*.runtime-cases.ts')}
require(held == previous['physicalCases']['inventory'] and not set(held).intersection(selected), 'Held cases changed')
copies = [json.loads(line.split('SNAPSHOT_REUSE_EVIDENCE ', 1)[1]) for part in ('core-a', 'core-b') for line in (final[part] / 'stdout.log').read_text(encoding='utf-8').splitlines() if line.startswith('SNAPSHOT_REUSE_EVIDENCE ')]
require(copies == [previous['priorCopyRegressionEvidence']], 'Copy regression changed')

history = {}
for path in OUT.glob('*/report.json'):
    if path.parent in final.values():
        continue
    report, cleanup = read(path), read(path.parent / 'cleanup.json')
    require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'] and cleanup['globalHoldAndSourceHashesUnchanged'], 'Historical cleanup incomplete')
    auth = read(path.parent / 'authorization.json')
    require(auth['userAuthorizationSHA256'] == digest(OUT / 'sdk-resume-authorization.json'), 'Historical authorization changed')
    history[path.parent.name] = {'passed': report['passed'], 'exitCode': report['exitCode'], 'cleanupVerified': True,
        'evidenceSHA256': {p.name: digest(p) for p in path.parent.iterdir() if p.is_file()}}
require(set(history) == {'typecheck-01', 'typecheck-02'}, 'Historical attempt inventory differs')
public = read(final['public-entry'] / 'stdout.log')
expected_public = json.loads(json.dumps(previous['publicPackageIntegration']))
expected_public['reactiveMaterials'].update(reactiveWorkerProtocol='reactive-worker-2', workerQueryBatches=True,
    workerChangeReports=True, workerObservationDirectEquivalence=True, queryRules='reactive-query-batches-1',
    changeRules='reactive-changes-1', endpointMotionObserved=False)
require(public == expected_public, 'Public package integration differs')
exports = read(ROOT / 'package.json')['exports']
require(len(exports) == 13 and all((ROOT / e[k]).is_file() for e in exports.values() for k in ('import', 'types')), 'SDK exports incomplete')
preflights = {}
for path in OUT.glob('quiet-window-*.json'):
    gate = read(path)
    if not gate['passed']:
        attempt = path.stem.removeprefix('quiet-window-')
        require(not (OUT / attempt).exists(), 'Failed preflight launched a workload')
    preflights[path.name] = {'passed': gate['passed'], 'samples': len(gate['samples']), 'maximumCpuPercent': max((s['hostCpuPercent'] or 0 for s in gate['samples']), default=None), 'SHA256': digest(path)}
require(len(preflights) == 26 and sum(not g['passed'] for g in preflights.values()) == 4, 'Preflight inventory differs')
manifest = read(final['public-entry'] / 'authorization.json')
record = {**previous,
    'stage': 'wishlist-build-53-reactive-worker-observations', 'recordedAt': datetime.now(timezone.utc).isoformat(),
    'status': '1695 selected CPU tests in sixteen sequential bounded jobs, full types, lint, SDK and public-package integration passed',
    'baselineSummarySHA256': digest(PREVIOUS / 'summary.json'), 'approvedCpuGatesComplete': True, 'featureCpuAccepted': True,
    'fullyAccepted': False, 'fullWishlistComplete': False, 'runtimeEquivalenceProven': False,
    'currentTests': {'passed': 1695, 'newObservationCases': 40, 'failed': 0, 'skipped': 0, 'files': selected, 'suites': results},
    'stages': stages, 'historicalAttempts': history, 'preflightGates': preflights,
    'reactiveWorkerProtocol': 'reactive-worker-2', 'newRules': ['reactive-changes-1', 'reactive-query-batches-1'],
    'reactiveObservationAcceptance': {'fiveGeometryKinds': True, 'committedAndPreviewStamps': True,
        'customMaterialsAndReservoirs': True, 'globalSupportReach': True, 'holdsIncluded': True,
        'sharedRunBudget': True, 'overflowFallback': True, 'ownedReports': True, 'taskYield': True,
        'oneOutstandingMessage': True, 'inspectionCancellation': True, 'readyPreviewPreservedOnReadError': True,
        'latestOriginalHandlesOnly': True, 'directWorkerEquivalence': True, 'oneTickCollapse': True,
        'endpointReportsObserveMotion': False, 'nativeWorker': False},
    'localKernelExecution': {**previous['localKernelExecution'], 'newObservationWorldCells': 15, 'newObservationReservoirCells': 2,
        'newObservationMaximumTicks': 1, 'nativeWorker': False, 'gpu': False, 'performanceMeasured': False},
    'publicPackageIntegration': public, 'referenceArtifactSHA256': digest(ROOT / 'dist/verification/tactical-slab-sdk-check.mjs'),
    'physicalGpuReplayBenchmarks': 'held', 'nativeWorkerExecuted': False, 'legacyDemos': 'quarantined', 'holdSHA256': hold_hash,
    'protectedSourcesUnchanged': len(protected), 'protectedSourceHashes': protected, 'priorSourcesChanged': sorted(changed),
    'priorSDKArtifactsUnchanged': len(previous['sdkArtifactHashes']) - len(sdk_changed), 'priorSDKArtifactsChanged': sorted(sdk_changed), 'newSDKArtifacts': sorted(new_sdk),
    'publicAPIChanges': ['Add reactive committed/preview query batches and global endpoint change reports',
        'Add resumable local endpoint diagnostics and inspection cancellation/progress', 'Upgrade reactive worker transport protocol from version 1 to 2'],
    'ExistingPhysicalRulesAndSaveSchemasUnchanged': True, 'newSaveSchema': None,
    'checkedSourceHashes': {n: digest(ROOT / n) for n in manifest['sourceHashes'] if owned(n)},
    'reviewedSourceHashes': {n: digest(ROOT / n) for n in manifest['sourceHashes'] if not n.startswith('dist/sdk/')},
    'sdkArtifactHashes': sdk, 'browserArtifactHashes': browser, 'browserArtifactChanges': sorted(browser_changed),
    'browserArtifactChangeReason': 'Existing public client compilation includes the shared geometry-reply validator extraction; no browser execution',
    'authorizationSHA256': digest(OUT / 'sdk-resume-authorization.json'), 'recorderSHA256': digest(Path(__file__)),
    'historicalProgressSHA256': {n: digest(OUT / n) for n in ('progress-01.json', 'progress-02.json', 'blocked-audit-01.json')},
    'diagnosticEvidenceSHA256': {p.relative_to(OUT).as_posix(): digest(p) for p in (OUT / 'cpu-attribution-01').iterdir() if p.is_file()},
    'resumeCpuSampleSHA256': digest(OUT / 'cpu-resume-sample-01.json'),
    'scopeLimits': ['Tiny CPU/mock-port correctness only; native Worker/browser/GPU and large-world replay/benchmarks remain held',
        'Query batches run one existing bounded geometry operation per advancement; reports slice scan and global support work',
        'Endpoint reports cannot identify fragments or transient paths; executed movement capabilities remain separate',
        'Snapshot preparation, copying, final validation and support-job setup remain O(volume)',
        'Global support is recomputed; structural dependency reuse, force fields, external actor loads and native rendering integration remain further work',
        'No native interaction, performance or full-wishlist completion claim; legacy demos stay quarantined']}
record.pop('ExistingSDKRulesAndSaveSchemasUnchanged', None)
record.pop('historicalAuthorizationSHA256', None)
require(len(record['checkedSourceHashes']) == 305, 'Checked source inventory differs')
target.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'passedTests': 1695, 'newObservationCases': 40, 'stages': len(stages), 'protectedSourcesUnchanged': len(protected), 'sdkArtifacts': len(sdk)}))
