"""Bind completed CPU receipts and pending gates; never executes simulation."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json

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

target = OUT / 'progress-01.json'
require(not target.exists(), 'Refusing to overwrite partial evidence')
baseline = read(PREVIOUS / 'summary.json')
protected = baseline['protectedSourceHashes']
require(len(protected) == 96 and all(digest(ROOT / n) == h for n, h in protected.items()), 'Protected source changed')
hold = read(ROOT / 'dist/verification/safety-hold.json')
hold_hash = digest(ROOT / 'dist/verification/safety-hold.json')
require(hold_hash == baseline['holdSHA256'] and hold.get('blockRecovery') is True and 'recoveryPermit' not in hold, 'Runtime hold changed')
for name in ('run_tests.py', 'run_cpu_stage.py'):
    require(digest(OUT / name) == digest(PREVIOUS / name), 'Reviewed runner changed')
for key in ('sdkArtifactHashes', 'browserArtifactHashes'):
    require(all(digest(ROOT / n) == h for n, h in baseline[key].items()), 'Unbuilt artifacts changed')
stages = {}
for attempt, passed in [('typecheck-01', False), ('typecheck-02', True), ('attempt-01', True)]:
    folder = OUT / attempt
    report, auth, cleanup = read(folder / 'report.json'), read(folder / 'authorization.json'), read(folder / 'cleanup.json')
    require(report['passed'] is passed and (report['exitCode'] == 0) is passed and report['kind'] == 'cpu', 'Stage differs')
    require(report['cpuLimitPercent'] == 6 and report['memoryLimitMiB'] == 4096 and report['independentWatchdog']['armed'] and report['timeoutSeconds'] == 30, 'Containment changed')
    require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'] and cleanup['globalHoldAndSourceHashesUnchanged'], 'Cleanup incomplete')
    require(auth['userAuthorizationSHA256'] == digest(OUT / 'sdk-resume-authorization.json'), 'Authorization changed')
    gate = OUT / auth['quietGate']
    require(digest(gate) == auth['quietGateSHA256'] and read(gate)['passed'], 'Launch gate differs')
    if passed:
        for name, expected in auth['sourceHashes'].items():
            if owned(name):
                require(digest(ROOT / name) == expected, 'Source changed since passed check: ' + name)
    stages[attempt] = {'passed': passed, 'wallSeconds': round(report['finishedAt'] - report['startedAt'], 3), 'cleanupVerified': True,
        'evidenceSHA256': {p.name: digest(p) for p in folder.iterdir() if p.is_file()}}
result = read(OUT / 'attempt-01/vitest.json')
require(result['success'] and result['numTotalTests'] == result['numPassedTests'] == 40 and all(result[k] == 0 for k in ('numFailedTests', 'numPendingTests', 'numTodoTests')), 'Focused test results differ')
require(len(result['testResults']) == 1 and Path(result['testResults'][0]['name']).resolve() == ROOT / 'engine/experimental/reactive-worker-observations.test.ts', 'Test scope differs')
gates = {}
for path in OUT.glob('quiet-window-*.json'):
    gate = read(path)
    if not gate['passed']:
        attempt = path.stem.removeprefix('quiet-window-')
        require(not (OUT / attempt).exists(), 'Failed quiet gate launched work')
    else:
        require(len(gate['samples']) == 10 and all(s['hostCpuPercent'] is not None and s['hostCpuPercent'] <= 50 and s['freeMemoryMiB'] >= 8192 for s in gate['samples']), 'Quiet limits differ')
    gates[path.name] = {'passed': gate['passed'], 'samples': len(gate['samples']), 'maximumCpuPercent': max(s['hostCpuPercent'] for s in gate['samples']), 'SHA256': digest(path)}
require(len(gates) == 5 and sum(not g['passed'] for g in gates.values()) == 2, 'Preflight inventory differs')
manifest = read(OUT / 'attempt-01/authorization.json')
changed = {n for n, h in baseline['checkedSourceHashes'].items() if digest(ROOT / n) != h}
require(changed == {'engine/experimental/tactical-worker-queries.ts', 'engine/experimental/reactive-worker-wire.ts',
    'engine/experimental/reactive-worker-host.ts', 'engine/experimental/reactive-worker-client.ts', 'engine/experimental/reactive-materials.ts',
    'engine/lint_ts.mjs', 'scripts/check_reactive_materials_sdk.mjs'}, 'Unexpected prior source changes: ' + str(changed))
record = {
    'stage': 'wishlist-build-53-reactive-worker-observations', 'recordedAt': datetime.now(timezone.utc).isoformat(),
    'status': 'partial: full tactical types and 40 focused CPU tests passed; broader regressions, lint, SDK and public integration pending',
    'approvedCpuGatesComplete': False, 'fullyAccepted': False, 'fullWishlistComplete': False,
    'runtimeEquivalenceProven': False, 'nativeWorkerExecuted': False, 'physicalGpuReplayBenchmarks': 'held', 'legacyDemos': 'quarantined',
    'baselineSummary': str((PREVIOUS / 'summary.json').relative_to(ROOT).as_posix()), 'baselineSummarySHA256': digest(PREVIOUS / 'summary.json'),
    'historicalRegressionCount': 1655, 'currentTests': {'passed': 40, 'failed': 0, 'skipped': 0, 'files': ['engine/experimental/reactive-worker-observations.test.ts']},
    'stages': stages, 'preflightGates': gates,
    'pendingGates': ['previous selected CPU regressions', 'final type check', 'lint', 'SDK build', 'public-package integration'],
    'fixedIssue': 'Explicit query batch return type preserves its version literal',
    'reactiveWorkerProtocol': 'reactive-worker-2', 'physicalRulesAndSaveSchemasUnchanged': True,
    'newRules': ['reactive-changes-1', 'reactive-query-batches-1'],
    'localFixture': {'worldCells': 15, 'reservoirCells': 2, 'maximumExecutedTicksPerTrajectory': 1, 'nativeWorker': False, 'gpu': False},
    'holdSHA256': hold_hash, 'protectedSourcesUnchanged': len(protected), 'protectedSourceHashes': protected,
    'priorSourcesChanged': sorted(changed), 'checkedSourceHashes': {n: digest(ROOT / n) for n in manifest['sourceHashes'] if owned(n)},
    'sdkBuildPerformed': False, 'sdkArtifactHashes': baseline['sdkArtifactHashes'], 'browserArtifactHashes': baseline['browserArtifactHashes'],
    'documentationSHA256': {n: digest(ROOT / n) for n in ['docs/SDK.md', 'docs/checkpoints/TACTICAL_INTERVENTIONS.md']},
    'authorizationSHA256': digest(OUT / 'sdk-resume-authorization.json'), 'recorderSHA256': digest(Path(__file__)),
    'scopeLimits': ['Exact tiny CPU/mock-port evidence only; no native or performance claim',
        'Endpoint reports do not observe transient motion or fragment identity',
        'Global support is recomputed; preparation, validation and copying remain O(volume)',
        'Two failed quiet-window gates launched no workload; no further retries in this attempt',
        'The complete wishlist remains unfinished']}
target.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'status': 'partial', 'passedTests': 40, 'protectedSourcesUnchanged': 96, 'pendingGates': record['pendingGates']}))
