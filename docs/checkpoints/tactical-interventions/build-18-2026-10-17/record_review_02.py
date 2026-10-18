"""Retain a preflight refusal and current source hashes; execute no engine code."""
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

destination = OUT / 'source-review-02.json'
require(not destination.exists(), 'Refusing to overwrite evidence')
gate = OUT / 'quiet-window-attempt-02.json'
receipt = read(gate)
require(not receipt['passed'] and not (OUT / 'attempt-02').exists(), 'Workload unexpectedly authorized')
require(not list(OUT.glob('*/report.json')), 'A workload was already launched')
previous = read(OUT.parent / 'build-17-2026-10-17/summary.json')
protected = previous['protectedSourceHashes']
require(all(digest(ROOT / name) == value for name, value in protected.items()), 'Protected source changed')
expected_changes = {'engine/experimental/tactical-session.ts', 'engine/vitest.tactical-session.config.ts',
                    'engine/lint_ts.mjs', 'scripts/check_tactical_session_sdk.mjs'}
changed = {name for name, value in previous['checkedSourceHashes'].items() if digest(ROOT / name) != value}
require(changed == expected_changes, 'Unexpected prior source changes')
for name in ('run_tests.py', 'run_cpu_stage.py'):
    require(digest(OUT / name) == digest(OUT.parent / 'build-17-2026-10-17' / name), 'Reviewed runner changed')
hold = read(ROOT / 'dist/verification/safety-hold.json')
require(hold.get('blockRecovery') is True and 'recoveryPermit' not in hold, 'Runtime hold changed')
test = ROOT / 'engine/experimental/tactical-worker.test.ts'
count = len(re.findall(r"^\s*test\('", test.read_text(encoding='utf-8'), re.M))
require(count == 36, 'Authored test count differs')
names = expected_changes | {'docs/SDK.md', 'docs/checkpoints/TACTICAL_INTERVENTIONS.md'}
names.update(p.relative_to(ROOT).as_posix() for p in (ROOT / 'engine/experimental').glob('tactical-worker*.ts'))
names.update(p.relative_to(ROOT).as_posix() for p in (ROOT / 'examples/tactical-worker').iterdir() if p.is_file())
names.update(p.relative_to(ROOT).as_posix() for p in OUT.glob('*.py'))
record = {
    'stage': 'wishlist-build-18-worker-preview-service', 'recordedAt': datetime.now(timezone.utc).isoformat(),
    'status': 'Reservoir identity and host cleanup repaired by source review; second quiet gate refused before workload launch',
    'fullyAccepted': False, 'fullWishlistComplete': False, 'runtimeEquivalenceProven': False,
    'authoredWorkerTests': count, 'expectedSelectedTests': 481 + count, 'testsExecuted': 0,
    'verification': {name: 'pending' for name in ('tests', 'typecheck', 'lint', 'sdk', 'public-entry')},
    'quietGate': gate.name, 'quietGateSHA256': digest(gate), 'quietGatePassed': False,
    'maxObservedHostCpuPercent': max(sample['hostCpuPercent'] for sample in receipt['samples']),
    'requiredMaxHostCpuPercent': 20, 'workloadLaunched': False, 'additionalWorkloadRetryInThisContinuation': False,
    'priorSuccessfulEvidence': '../build-17-2026-10-17/summary.json', 'sdkArtifactsMatchNewSources': False,
    'physicalCasesHeld': 38, 'physicalGpuReplayBenchmarks': 'held', 'nativeWorkerExecuted': False,
    'legacyDemos': 'quarantined', 'protectedSourcesUnchanged': len(protected), 'protectedSourceHashes': protected,
    'priorSourcesChanged': sorted(changed), 'unverifiedSourceHashes': {name: digest(ROOT / name) for name in sorted(names)},
}
destination.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'record': destination.name, 'authoredTests': count, 'testsExecuted': 0,
                  'protectedSourcesUnchanged': len(protected), 'workloadLaunched': False}))
