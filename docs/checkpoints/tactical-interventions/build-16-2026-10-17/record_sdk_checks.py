"""Record completed SDK stages using existing receipts and file hashes only."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def digest(path):
    return sha256(path.read_bytes()).hexdigest()

def require(condition, message):
    if not condition:
        raise ValueError(message)

destination = OUT / 'sdk-validation.json'
require(not destination.exists(), 'Refusing to overwrite existing evidence')
protected = read(OUT / 'summary.json')['protectedSourceHashes']
require(all(digest(ROOT / name) == value for name, value in protected.items()), 'Protected source changed')
stages = {}
for name in ('typecheck-03', 'lint-01', 'sdk-01', 'public-entry-interventions-01', 'public-entry-tactical-01'):
    folder = OUT / name
    report, cleanup, authorization = [read(folder / leaf) for leaf in ('report.json', 'cleanup.json', 'authorization.json')]
    require(report['passed'] is True and report['exitCode'] == 0 and report['kind'] == 'cpu', 'Stage failed: ' + name)
    require(report['cpuLimitPercent'] == 6 and report['memoryLimitMiB'] == 4096
            and report['independentWatchdog']['armed'], 'Containment limits changed')
    require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists']
            and cleanup['globalHoldAndSourceHashesUnchanged'] and cleanup['authorizationConsumed'], 'Cleanup failed')
    gate = OUT / authorization['quietGate']
    require(digest(gate) == authorization['quietGateSHA256'] and read(gate)['passed'], 'Gate evidence changed')
    for source, value in authorization['sourceHashes'].items():
        if source.startswith(('engine/', 'scripts/', 'dist/')) or source in ('package.json', 'package-lock.json'):
            require(digest(ROOT / source) == value, 'Checked source/artifact changed: ' + source)
    stages[name] = {
        'passed': True, 'wallSeconds': round(report['finishedAt'] - report['startedAt'], 3),
        'timeoutSeconds': report['timeoutSeconds'], 'command': report['command'], 'cleanupVerified': True,
        'evidenceSHA256': {p.name: digest(p) for p in sorted(folder.iterdir()) if p.is_file()},
        'gateSHA256': digest(gate),
    }
    if name.startswith('public-entry-'):
        result = read(folder / 'stdout.log')
        require(result['passed'] is True and result['physicsTicks'] == 0 and result['gpu'] is False, 'Public scope/result differs')
        stages[name]['publicResult'] = result
exports = read(ROOT / 'package.json')['exports']
require(len(exports) == 11, 'Unexpected export count')
for entry in exports.values():
    require(all((ROOT / entry[key]).is_file() for key in ('import', 'types')), 'SDK export artifact missing')
tested = read(OUT / 'attempt-02/vitest.json')
require(tested['success'] and tested['numPassedTests'] == tested['numTotalTests'] == 458, 'Prior test evidence differs')
repair = read(OUT / 'resumption.json')['repair']
require(digest(ROOT / repair['path']) == repair['afterSHA256'] and repair['exactTypeOnlySourceComparison'], 'Type repair changed')
manifest = read(OUT / 'sdk-01/authorization.json')
record = {
    'recordedAt': datetime.now(timezone.utc).isoformat(), 'scope': 'bounded CPU SDK/static acceptance only',
    'sdkAndStaticChecksPassed': True, 'stages': stages, 'exports': exports,
    'checkedSourceHashes': {name: value for name, value in manifest['sourceHashes'].items()
                            if name.startswith(('engine/', 'scripts/')) or name in ('package.json', 'package-lock.json')},
    'sdkArtifactHashes': {p.relative_to(ROOT).as_posix(): digest(p) for p in sorted((ROOT / 'dist/sdk').rglob('*')) if p.is_file()},
    'protectedSourceHashes': protected, 'protectedSourcesUnchanged': len(protected),
    'priorUnitTests': {'passed': 458, 'executedBeforeTypeOnlyRepair': True, 'receipt': 'attempt-02/vitest.json',
                       'receiptSHA256': digest(OUT / 'attempt-02/vitest.json'), 'typeOnlyRepairRecord': 'resumption.json'},
    'physicalCases': {'count': 35, 'status': 'held'}, 'physicalGpuReplayBenchmarks': 'held',
    'legacyDemos': 'quarantined', 'installedConsumerTested': False,
    'fullWishlistComplete': False, 'runtimeEquivalenceProven': False,
    'documentationSHA256': {name: digest(ROOT / name) for name in ('docs/SDK.md', 'docs/checkpoints/TACTICAL_INTERVENTIONS.md')},
    'recorderSHA256': digest(Path(__file__)),
}
destination.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'record': destination.name, 'stagesPassed': len(stages), 'exports': len(exports),
                  'protectedSourcesUnchanged': len(protected), 'runtimeHoldIntact': True}))
