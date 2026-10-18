"""Record unlaunched checks and current sources; execute no engine code."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
PREVIOUS = OUT.parent / 'build-23-2026-10-17'

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def digest(path):
    return sha256(path.read_bytes()).hexdigest()

def require(condition, message):
    if not condition:
        raise ValueError(message)

destination = OUT / 'summary.pending.json'
require(not destination.exists(), 'Refusing to overwrite evidence')
previous = read(PREVIOUS / 'summary.json')
protected = previous['protectedSourceHashes']
require(all(digest(ROOT / name) == value for name, value in protected.items()), 'Protected source changed')
for runner in ('run_tests.py', 'run_cpu_stage.py'):
    require(digest(OUT / runner) == digest(PREVIOUS / runner), 'Reviewed runner changed')
hold = read(ROOT / 'dist/verification/safety-hold.json')
require(hold.get('blockRecovery') is True and 'recoveryPermit' not in hold, 'Runtime hold changed')
require(not list(OUT.glob('*/authorization.json')) and not list(OUT.glob('*/report.json')), 'Unexpected workload authorization or report')
gate = OUT / 'quiet-window-attempt-01.json'
require(read(gate)['passed'] is False and not (OUT / 'attempt-01').exists(), 'Expected refused launch')
count = len(re.findall(r"^\s*test\('", (ROOT / 'engine/experimental/tactical-worker-preview-queries.test.ts').read_text(), re.M))
require(count == 26, 'Authored coverage differs')
names = set(previous['checkedSourceHashes']) | set(protected)
names.update(p.relative_to(ROOT).as_posix() for p in (ROOT / 'engine').rglob('*.ts'))
names.update(p.relative_to(ROOT).as_posix() for p in OUT.glob('*.py'))
names.update(['docs/SDK.md', 'docs/checkpoints/TACTICAL_INTERVENTIONS.md', 'examples/tactical-worker/README.md'])
changed = {name for name, value in previous['checkedSourceHashes'].items() if digest(ROOT / name) != value}
expected = {'engine/experimental/tactical-previews.ts', 'engine/experimental/tactical-session-core.ts',
            'engine/experimental/tactical-session-view.ts', 'engine/experimental/tactical-session.test.ts',
            'engine/experimental/tactical-session.ts', 'engine/experimental/tactical-worker-client.ts',
            'engine/experimental/tactical-worker-host.ts', 'engine/experimental/tactical-worker-queries.test.ts',
            'engine/experimental/tactical-worker-queries.ts', 'engine/experimental/tactical-worker-wire.ts',
            'engine/lint_ts.mjs', 'engine/vitest.tactical-session.config.ts', 'scripts/check_tactical_session_sdk.mjs'}
require(changed == expected, 'Unexpected prior source changes')
record = {
    'stage': 'wishlist-build-24-preview-queries', 'recordedAt': datetime.now(timezone.utc).isoformat(),
    'status': 'Source and 26 regression cases authored; first selected-test gate refused launch; all five stages pending',
    'fullyAccepted': False, 'fullWishlistComplete': False, 'runtimeEquivalenceProven': False,
    'currentTests': {'authoredNew': count, 'expectedSelection': 622 + count, 'executed': False, 'passed': None},
    'stages': {}, 'pendingStages': ['tests', 'typecheck', 'lint', 'sdk', 'public-entry'],
    'testLaunch': {'workloadLaunched': False, 'quietGate': gate.name, 'quietGateSHA256': digest(gate),
                   'maxHostCpuPercent': max(s['hostCpuPercent'] for s in read(gate)['samples']), 'launchLimitPercent': 20},
    'priorBuild': {'summary': '../build-23-2026-10-17/summary.json', 'sha256': digest(PREVIOUS / 'summary.json'),
                   'verifiedTestCount': 622, 'allFiveStagesPassed': True, 'notEvidenceForCurrentChanges': True},
    'sourceHashes': {name: digest(ROOT / name) for name in sorted(names)},
    'protectedSourcesUnchanged': len(protected), 'protectedSourceHashes': protected, 'priorSourcesChanged': sorted(changed),
    'transportProtocol': 'tactical-worker-6', 'builtArtifacts': 'Build 23 with protocol 5',
    'physicalCases': {'totalHeld': 38, 'executed': False}, 'physicalGpuReplayBenchmarks': 'held',
    'nativeWorkerExecuted': False, 'legacyDemos': 'quarantined',
    'scopeLimits': ['Current source has not run selected tests or type checking', 'Preview geometry with private candidate validation; action-history transport remains pending', 'No native-worker physical replay GPU or latency evidence'],
    'recorderSHA256': digest(Path(__file__)),
}
destination.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'record': destination.name, 'newCasesAuthored': count, 'workloadLaunched': False,
                  'protectedSourcesUnchanged': len(protected), 'pendingStages': record['pendingStages']}))
