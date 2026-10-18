"""Audit and bind CPU receipts. Never imports or executes the simulation."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
PREVIOUS = OUT.parent / 'build-51-2026-10-17'

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
require(changed == {'engine/experimental/reactive-materials.ts', 'engine/lint_ts.mjs', 'scripts/check_reactive_materials_sdk.mjs'}, 'Unexpected prior source change: ' + str(changed))
sdk, browser = artifacts('dist/sdk'), artifacts('dist/tactical-slab')
sdk_changed = {n for n, h in previous['sdkArtifactHashes'].items() if sdk.get(n) != h}
require(sdk_changed == {'dist/sdk/state-space-reactive-materials.js', 'dist/sdk/types/experimental/reactive-materials.d.ts'}, 'Unexpected prior SDK changes: ' + str(sdk_changed))
new_sdk = set(sdk) - set(previous['sdkArtifactHashes'])
require(new_sdk == {'dist/sdk/types/experimental/' + n + '.d.ts' for n in ('reactive-worker-wire', 'reactive-worker-host', 'reactive-worker-client')}, 'Unexpected new SDK artifacts')
require(browser == previous['browserArtifactHashes'], 'Browser artifacts changed')
hold_hash = digest(ROOT / 'dist/verification/safety-hold.json')
hold = read(ROOT / 'dist/verification/safety-hold.json')
require(hold_hash == previous['holdSHA256'] and hold.get('blockRecovery') is True and 'recoveryPermit' not in hold, 'Runtime hold changed')
for name in ('run_tests.py', 'run_cpu_stage.py'):
    require(digest(OUT / name) == digest(PREVIOUS / name), 'Reviewed runner changed')

expected_suites = {'worker': {'passed': 44, 'files': ['engine/experimental/reactive-worker.test.ts']}, **previous['currentTests']['suites']}
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
    require(report['timeoutSeconds'] == (60 if label == 'sdk' else 30), 'Deadline changed')
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
require(sum(r['passed'] for r in results.values()) == 1655 and len(selected) == 56, 'Combined coverage differs')
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
    approvals = [p for p in OUT.glob('sdk-resume-authorization*.json') if digest(p) == auth['userAuthorizationSHA256']]
    require(len(approvals) == 1, 'Historical authorization was not preserved')
    history[path.parent.name] = {'passed': report['passed'], 'exitCode': report['exitCode'], 'cleanupVerified': True,
        'authorizationFile': approvals[0].name, 'authorizationSHA256': digest(approvals[0]),
        'evidenceSHA256': {p.name: digest(p) for p in path.parent.iterdir() if p.is_file()}}
public = read(final['public-entry'] / 'stdout.log')
expected_public = json.loads(json.dumps(previous['publicPackageIntegration']))
expected_public['reactiveMaterials'].update(reactiveWorker=True, reactiveWorkerProtocol='reactive-worker-1', workerCells=8, workerExecutedTicks=3,
    workerDirectEquivalence=True, workerJSONContinuation=True, workerBackpressure=True, workerSupersession=True, nativeWorker=False)
require(public == expected_public, 'Public package integration differs')
exports = read(ROOT / 'package.json')['exports']
require(len(exports) == 13 and all((ROOT / e[k]).is_file() for e in exports.values() for k in ('import', 'types')), 'SDK exports incomplete')
preflights = {}
for path in OUT.glob('quiet-window-*.json'):
    gate = read(path)
    if not gate['passed']:
        attempt = path.stem.removeprefix('quiet-window-')
        require(not (OUT / attempt / 'authorization.json').exists() and not (OUT / attempt / 'report.json').exists(), 'Failed preflight launched a workload')
    preflights[path.name] = {'passed': gate['passed'], 'samples': len(gate['samples']), 'maximumCpuPercent': max((s['hostCpuPercent'] or 0 for s in gate['samples']), default=None), 'SHA256': digest(path)}
manifest = read(final['public-entry'] / 'authorization.json')
record = {**previous,
    'stage': 'wishlist-build-52-reactive-worker-boundary', 'recordedAt': datetime.now(timezone.utc).isoformat(),
    'status': '1655 selected CPU tests in fifteen sequential bounded jobs, full types, lint, SDK and mock-port public integration passed',
    'baselineSummarySHA256': digest(PREVIOUS / 'summary.json'), 'approvedCpuGatesComplete': True, 'fullyAccepted': False,
    'fullWishlistComplete': False, 'runtimeEquivalenceProven': False,
    'currentTests': {'passed': 1655, 'newWorkerCases': 44, 'failed': 0, 'skipped': 0, 'files': selected, 'suites': results},
    'stages': stages, 'historicalAttempts': history, 'preflightGates': preflights,
    'reactiveWorkerProtocol': 'reactive-worker-1',
    'reactiveWorkerAcceptance': {'hostOwnedAuthority': True, 'catalogHandshake': True, 'oneOutstandingMessage': True,
        'latestIntentCoalescing': True, 'taskYield': True, 'sliceBudgets': True, 'completeCandidateOnly': True,
        'sameRevisionTicket': True, 'exactPreviewCommit': True, 'exactRestore': True, 'atomicPolicyRejection': True,
        'uncertainMutationNoRetry': True, 'retainedAcknowledgedSave': True, 'cancellation': True, 'shutdown': True,
        'directSessionEquivalence': True, 'sliceSizeIndependence': True, 'JSONContinuation': True},
    'localKernelExecution': {**previous['localKernelExecution'], 'publicWorkerCells': 8, 'publicWorkerExecutedTicks': 3,
        'newWorkerFixtureCells': 10, 'nativeWorker': False, 'gpu': False, 'performanceMeasured': False},
    'publicPackageIntegration': public, 'referenceArtifactSHA256': digest(ROOT / 'dist/verification/tactical-slab-sdk-check.mjs'),
    'physicalGpuReplayBenchmarks': 'held', 'nativeWorkerExecuted': False, 'legacyDemos': 'quarantined', 'holdSHA256': hold_hash,
    'protectedSourcesUnchanged': len(protected), 'protectedSourceHashes': protected, 'priorSourcesChanged': sorted(changed),
    'priorSDKArtifactsUnchanged': len(previous['sdkArtifactHashes']) - len(sdk_changed), 'priorSDKArtifactsChanged': sorted(sdk_changed), 'newSDKArtifacts': sorted(new_sdk),
    'publicAPIChanges': ['Add reactive worker host/client, data-only protocol, task scheduling and owned browser transport adapter'],
    'ExistingSDKRulesAndSaveSchemasUnchanged': True, 'newSaveSchema': None,
    'checkedSourceHashes': {n: digest(ROOT / n) for n in manifest['sourceHashes'] if owned(n)},
    'reviewedSourceHashes': {n: digest(ROOT / n) for n in manifest['sourceHashes'] if not n.startswith('dist/sdk/')},
    'sdkArtifactHashes': sdk, 'browserArtifactHashes': browser, 'browserArtifactChanges': [],
    'authorizationSHA256': digest(OUT / 'sdk-resume-authorization.json'), 'recorderSHA256': digest(Path(__file__)),
    'historicalAuthorizationSHA256': digest(OUT / 'sdk-resume-authorization-initial.json'),
    'scopeLimits': ['Mock-port reactive previews run real tiny CPU physics; native browser/Worker/GPU and large-world replay remain held',
        'One active branch, one waiting latest intent and one outstanding message; each advance executes one existing session slice',
        'Complete snapshots validate the same catalog and application identity; policies and private motion capabilities stay on the host',
        'Whole-domain copying, final validation and candidate transfer remain O(volume); native latency is unmeasured',
        'Force fields, external actor loads, structural dependency reuse, compact remote change reports and native rendering integration remain further work',
        'No GPU, native interaction or performance claim; legacy demos stay quarantined']}
target.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'passedTests': 1655, 'newWorkerCases': 44, 'stages': len(stages), 'protectedSourcesUnchanged': len(protected)}))
