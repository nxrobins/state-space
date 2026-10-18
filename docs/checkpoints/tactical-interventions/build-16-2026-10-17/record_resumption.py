"""Read saved evidence and source hashes; do not execute tests or engine code."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]

def read(name):
    return json.loads((OUT / name).read_text(encoding='utf-8'))

def digest(path):
    return sha256(path.read_bytes()).hexdigest()

def require(condition, message):
    if not condition:
        raise ValueError(message)

destination = OUT / 'resumption.json'
require(not destination.exists(), 'Refusing to overwrite a prior record')
tests = read('attempt-02/vitest.json')
require(tests['success'] and tests['numTotalTests'] == tests['numPassedTests'] == 458
        and all(tests[k] == 0 for k in ('numFailedTests', 'numPendingTests', 'numTodoTests')), 'Test counts differ')
require(read('attempt-02/report.json')['passed'] is True, 'Test supervisor failed')
require(read('typecheck-01/report.json')['passed'] is False, 'Compiler failure receipt missing')
for attempt in ('attempt-02', 'typecheck-01'):
    cleanup = read(attempt + '/cleanup.json')
    require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists']
            and cleanup['globalHoldAndSourceHashesUnchanged'], 'Cleanup incomplete')
require(not read('quiet-window-typecheck-02.json')['passed']
        and not (OUT / 'typecheck-02').exists(), 'Retry must have stopped before workload')
baseline = OUT / 'tactical-session-core.before-type-fix.ts.txt'
core = ROOT / 'engine/experimental/tactical-session-core.ts'
manifest = read('attempt-02/authorization.json')
require(digest(baseline) == manifest['sourceHashes']['engine/experimental/tactical-session-core.ts'], 'Wrong tested baseline')
before = baseline.read_text(encoding='utf-8')
after = core.read_text(encoding='utf-8')
expected = before.replace('GEOMETRY_RULES_VERSION_3D }', 'GEOMETRY_RULES_VERSION_3D, type GeometryStamp3D }', 1)
expected = expected.replace('const to = {rulesVersion: GEOMETRY_RULES_VERSION_3D',
                            'const to: GeometryStamp3D = {rulesVersion: GEOMETRY_RULES_VERSION_3D', 1)
require(expected != before and after == expected, 'Repair is not the two expected type-only changes')
protected = read('summary.json')['protectedSourceHashes']
require(all(digest(ROOT / name) == value for name, value in protected.items()), 'Protected source changed')
changed = [name for name, value in manifest['sourceHashes'].items() if digest(ROOT / name) != value]
require(set(changed) == {'engine/experimental/tactical-session-core.ts', 'docs/checkpoints/TACTICAL_INTERVENTIONS.md'}, 'Unexpected change since tests')
evidence = ['attempt-02/authorization.json', 'attempt-02/report.json', 'attempt-02/vitest.json', 'attempt-02/cleanup.json',
            'typecheck-01/authorization.json', 'typecheck-01/report.json', 'typecheck-01/cleanup.json',
            'quiet-window-attempt-02.json', 'quiet-window-typecheck-01.json', 'quiet-window-typecheck-02.json',
            'tactical-session-core.before-type-fix.ts.txt', 'record_resumption.py']
record = {
    'recordedAt': datetime.now(timezone.utc).isoformat(), 'scope': 'bounded CPU verification resumption',
    'tests': {'passed': 458, 'failed': 0, 'skipped': 0, 'executedBeforeTypeOnlyRepair': True},
    'repair': {'path': core.relative_to(ROOT).as_posix(), 'beforeSHA256': digest(baseline),
               'afterSHA256': digest(core), 'exactTypeOnlySourceComparison': True, 'compilerAcceptance': 'pending'},
    'typecheck': 'initial compile failed; source repaired; retry gate refused before launch',
    'lint': 'not launched; pending', 'SDKChecks': 'user-deferred', 'physicalGpuReplayBenchmarks': 'held',
    'legacyDemos': 'quarantined', 'protectedSourcesUnchanged': len(protected),
    'fullyAccepted': False, 'fullWishlistComplete': False, 'runtimeEquivalenceProven': False,
    'nextAction': 'Fresh quiet gate, no-emit type check of the repair, then lint; stop on first failure.',
    'evidenceSHA256': {name: digest(OUT / name) for name in evidence},
}
destination.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'record': destination.name, 'testsPassed': 458, 'protectedSourcesUnchanged': len(protected),
                  'typecheck': record['typecheck'], 'lint': record['lint']}))
