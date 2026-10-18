"""Read completed receipts and hash sources; never execute simulation or tests."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
PREVIOUS = OUT.parent / 'build-16-2026-10-17'

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def digest(path):
    return sha256(path.read_bytes()).hexdigest()

def require(condition, message):
    if not condition:
        raise ValueError(message)

destination = OUT / 'summary.json'
require(not destination.exists(), 'Refusing to overwrite existing evidence')
previous = read(PREVIOUS / 'sdk-validation.json')
protected = previous['protectedSourceHashes']
require(all(digest(ROOT / name) == value for name, value in protected.items()), 'Protected source changed')
expected_changes = {'engine/experimental/tactical-session.ts', 'engine/vitest.tactical-session.config.ts',
                    'engine/lint_ts.mjs', 'scripts/check_tactical_session_sdk.mjs'}
changed = {name for name, value in previous['checkedSourceHashes'].items() if digest(ROOT / name) != value}
require(changed == expected_changes, 'Unexpected changes to prior implementation')
stages = {}
for name in ('attempt-01', 'typecheck-01', 'lint-01', 'sdk-01', 'public-entry-01'):
    folder = OUT / name
    report, cleanup, auth = [read(folder / p) for p in ('report.json', 'cleanup.json', 'authorization.json')]
    require(report['passed'] is True and report['exitCode'] == 0 and report['kind'] == 'cpu', 'Failed stage')
    require(report['cpuLimitPercent'] == 6 and report['memoryLimitMiB'] == 4096 and report['independentWatchdog']['armed'], 'Limits changed')
    require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'] and cleanup['globalHoldAndSourceHashesUnchanged'], 'Cleanup failed')
    gate = OUT / auth['quietGate']
    require(digest(gate) == auth['quietGateSHA256'] and read(gate)['passed'], 'Quiet gate changed')
    for source, value in auth['sourceHashes'].items():
        if source.startswith(('engine/', 'scripts/', 'dist/')) or source in ('package.json', 'package-lock.json'):
            require(digest(ROOT / source) == value, 'Checked source or output changed: ' + source)
    stages[name] = {'passed': True, 'wallSeconds': round(report['finishedAt'] - report['startedAt'], 3),
                    'command': report['command'], 'timeoutSeconds': report['timeoutSeconds'], 'cleanupVerified': True,
                    'evidenceSHA256': {p.name: digest(p) for p in sorted(folder.iterdir()) if p.is_file()},
                    'quietGateSHA256': digest(gate)}
tests = read(OUT / 'attempt-01/vitest.json')
require(tests['success'] and tests['numPassedTests'] == tests['numTotalTests'] == 481
        and all(tests[k] == 0 for k in ('numFailedTests', 'numPendingTests', 'numTodoTests')), 'Test coverage differs')
public = read(OUT / 'public-entry-01/stdout.log')
require(public['passed'] and public['physicsTicks'] == 0 and public['gpu'] is False, 'Public check scope differs')
exports = read(ROOT / 'package.json')['exports']
require(len(exports) == 11 and all((ROOT / e[k]).is_file() for e in exports.values() for k in ('import', 'types')), 'SDK outputs incomplete')
runtime = ROOT / 'engine/experimental/tactical-previews.runtime-cases.ts'
require(len(re.findall(r"^\s*test\('", runtime.read_text(), re.M)) == 3, 'Held case count changed')
manifest = read(OUT / 'public-entry-01/authorization.json')
record = {
    'stage': 'wishlist-build-17-supersedable-previews', 'recordedAt': datetime.now(timezone.utc).isoformat(),
    'status': 'Edit/inert scheduling, types, lint, SDK and zero-tick public integration passed; physical acceptance held',
    'fullyAccepted': False, 'fullWishlistComplete': False, 'runtimeEquivalenceProven': False,
    'currentTests': {'passed': 481, 'newQueueCases': 23, 'failed': 0, 'skipped': 0}, 'stages': stages,
    'physicalCases': {'new': 3, 'totalHeld': 38, 'executed': False}, 'SDKChecks': 'passed within zero-tick scope',
    'physicalGpuReplayBenchmarks': 'held', 'legacyDemos': 'quarantined',
    'protectedSourcesUnchanged': len(protected), 'protectedSourceHashes': protected,
    'priorSourcesChanged': sorted(changed),
    'checkedSourceHashes': {name: value for name, value in manifest['sourceHashes'].items()
                            if name.startswith(('engine/', 'scripts/')) or name in ('package.json', 'package-lock.json')},
    'reviewedSourceHashes': {name: digest(ROOT / name) for name in manifest['sourceHashes'] if not name.startswith('dist/sdk/')},
    'sdkArtifactHashes': {p.relative_to(ROOT).as_posix(): digest(p) for p in sorted((ROOT / 'dist/sdk').rglob('*')) if p.is_file()},
    'scopeLimits': ['No worker offload', 'No preemption within a synchronous physical tick or snapshot copy',
                    'No physical replay or frame latency evidence', 'No installed external consumer check'],
    'recorderSHA256': digest(Path(__file__)),
}
destination.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'record': destination.name, 'testsPassed': 481, 'stagesPassed': len(stages),
                  'protectedSourcesUnchanged': len(protected), 'physicalCasesHeld': 38}))
