"""Read and bind CPU/mock receipts only. Never imports or runs the engine."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
PREVIOUS = OUT.parent / 'build-28-2026-10-17'

def read(p):
    return json.loads(p.read_text(encoding='utf-8'))

def digest(p):
    return sha256(p.read_bytes()).hexdigest()

def require(value, message):
    if not value:
        raise ValueError(message)

target = OUT / 'summary.json'
require(not target.exists(), 'Refusing to overwrite evidence')
previous = read(PREVIOUS / 'summary.json')
protected = previous['protectedSourceHashes']
require(all(digest(ROOT / n) == h for n, h in protected.items()), 'Protected sources changed')
changed = {n for n, h in previous['checkedSourceHashes'].items() if digest(ROOT / n) != h}
require(changed == {'engine/lint_ts.mjs', 'engine/vitest.tactical-session.config.ts',
                    'engine/experimental/tactical-session-core.ts', 'scripts/check_tactical_session_sdk.mjs'},
        'Unexpected prior source change: ' + str(changed))
sdk_changed = {n for n, h in previous['sdkArtifactHashes'].items() if digest(ROOT / n) != h}
require(sdk_changed == {'dist/sdk/state-space-tactical-session.js', 'dist/sdk/state-space-tactical-renderer.js',
                        'dist/sdk/types/experimental/tactical-session-core.d.ts'}, 'Unexpected SDK artifact change: ' + str(sdk_changed))
sdk_new = {p.relative_to(ROOT).as_posix() for p in (ROOT / 'dist/sdk').rglob('*') if p.is_file()} - set(previous['sdkArtifactHashes'])
require(sdk_new == {'dist/sdk/types/experimental/tactical-snapshot-reuse.d.ts'}, 'Unexpected new SDK artifacts: ' + str(sdk_new))
config = read(ROOT / 'engine/tsconfig.tactical-check.json')
require(config == {'extends': './tsconfig.json', 'compilerOptions': {'paths': {
    'state-space-engine/experimental/3d/tactical-renderer': ['./experimental/tactical-renderer.ts']}}}, 'Full typecheck scope changed')
stages, final_paths = {}, {}
for prefix in ('attempt', 'typecheck', 'lint', 'sdk', 'public-entry'):
    paths = list(OUT.glob(prefix + '-*/report.json'))
    require(bool(paths), 'Missing stage ' + prefix)
    path = max(paths, key=lambda p: read(p)['startedAt'])
    folder, report = path.parent, read(path)
    cleanup, auth = read(folder / 'cleanup.json'), read(folder / 'authorization.json')
    require(report['passed'] and report['exitCode'] == 0 and report['kind'] == 'cpu', 'Stage failed: ' + prefix)
    require(report['cpuLimitPercent'] == 6 and report['memoryLimitMiB'] == 4096 and report['independentWatchdog']['armed'], 'Containment differs')
    require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'] and cleanup['globalHoldAndSourceHashesUnchanged'], 'Cleanup failed')
    require(auth['userAuthorizationSHA256'] == digest(OUT / 'sdk-resume-authorization.json'), 'CPU authorization changed')
    gate = OUT / auth['quietGate']; quiet = read(gate)
    require(digest(gate) == auth['quietGateSHA256'] and quiet['passed'] and quiet['maxHostCpuPercent'] == 50 and len(quiet['samples']) == 10, 'Launch gate differs')
    require(all(s['hostCpuPercent'] is not None and s['hostCpuPercent'] <= 50 and s['freeMemoryMiB'] >= 8192 for s in quiet['samples']), 'Launch limits differ')
    for n, h in auth['sourceHashes'].items():
        if n.startswith(('engine/', 'scripts/', 'dist/', 'examples/tactical-worker/', 'examples/tactical-slab/')) and not n.endswith('/README.md') or n in ('package.json', 'package-lock.json'):
            require(digest(ROOT / n) == h, 'Checked source changed: ' + n)
    final_paths[prefix] = folder
    stages[folder.name] = {'passed': True, 'command': report['command'], 'wallSeconds': round(report['finishedAt'] - report['startedAt'], 3),
                          'timeoutSeconds': report['timeoutSeconds'], 'cleanupVerified': True, 'maxLaunchCpuPercent': max(s['hostCpuPercent'] for s in quiet['samples']),
                          'quietGateSHA256': digest(gate), 'evidenceSHA256': {p.name: digest(p) for p in folder.iterdir() if p.is_file()}}
tests = read(final_paths['attempt'] / 'vitest.json')
require(tests['success'] and tests['numPassedTests'] == tests['numTotalTests'] == 788 and all(tests[k] == 0 for k in ('numFailedTests', 'numPendingTests', 'numTodoTests')), 'Test count differs')
selected = re.findall(r"'(engine/[^']+\.test\.ts)'", (ROOT / 'engine/vitest.tactical-session.config.ts').read_text())
actual = [Path(r['name']).resolve().relative_to(ROOT).as_posix() for r in tests['testResults']]
require(len(selected) == len(actual) == 29 and set(selected) == set(actual), 'Selected test files differ')
new = next(r for r in tests['testResults'] if r['name'].endswith('tactical-snapshot-reuse.test.ts'))
require(len(new['assertionResults']) == 22 and all(a['status'] == 'passed' for a in new['assertionResults']), 'Snapshot reuse cases differ')
copies = [json.loads(line.split('SNAPSHOT_REUSE_EVIDENCE ', 1)[1]) for line in (final_paths['attempt'] / 'stdout.log').read_text(encoding='utf-8').splitlines() if line.startswith('SNAPSHOT_REUSE_EVIDENCE ')]
require(len(copies) == 1, 'Logical copy evidence missing or repeated')
require(copies[0] == {'primaryCells': 512, 'reservoirCells': 64, 'branches': 12, 'advances': 12,
                     'shared': {'mode': 'shared', 'forks': 24, 'copiedCellCoordinates': 0, 'sharedCellCoordinates': 41472, 'saturated': False},
                     'copy': {'mode': 'copy', 'forks': 24, 'copiedCellCoordinates': 41472, 'sharedCellCoordinates': 0, 'saturated': False},
                     'avoidedCoordinatorCoordinateArrays': 144, 'physicsTicks': 0, 'timingMeasured': False}, 'Logical copy evidence differs')
historical = {}
for path in OUT.glob('*/report.json'):
    if path.parent in final_paths.values():
        continue
    report, cleanup = read(path), read(path.parent / 'cleanup.json')
    require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'] and cleanup['globalHoldAndSourceHashesUnchanged'], 'Historical cleanup failed')
    historical[path.parent.name] = {'passed': report['passed'], 'exitCode': report['exitCode'], 'cleanupVerified': True,
                                  'evidenceSHA256': {p.name: digest(p) for p in path.parent.iterdir() if p.is_file()}}
exports = read(ROOT / 'package.json')['exports']
require(len(exports) == 12 and all((ROOT / e[k]).is_file() for e in exports.values() for k in ('import', 'types')), 'SDK artifacts incomplete')
public = read(final_paths['public-entry'] / 'stdout.log')
require(public['passed'] and public['physicsTicks'] == 0 and public['gpu'] is False, 'Public integration scope differs')
require(public['slabReference'] == {'passed': True, 'worldCells': 512, 'physicsTicks': 0, 'nativeWorker': False, 'gpu': False, 'presentation': True, 'uiCoordinator': True, 'browserBundles': True}, 'UI public integration differs')
for p in (ROOT / 'examples/tactical-slab').glob('*.ts'):
    require(all(n.startswith(('state-space-engine/', './')) for n in re.findall(r"from\s+['\"]([^'\"]+)['\"]", p.read_text())), 'Example imports private engine sources')
hold = read(ROOT / 'dist/verification/safety-hold.json')
require(hold.get('blockRecovery') is True and 'recoveryPermit' not in hold, 'Runtime hold changed')
for runner in ('run_tests.py', 'run_cpu_stage.py'):
    require(digest(OUT / runner) == digest(PREVIOUS / runner), 'Reviewed runner changed')
browser = ROOT / 'dist/tactical-slab'
require(all((browser / n).is_file() for n in ('index.html', 'style.css', 'app.js', 'worker.js', 'bundle-inputs.json')), 'Browser outputs missing')
bundle = read(browser / 'bundle-inputs.json')
require(len(bundle['outputs']) == 2 and any(n.startswith('dist/sdk/') for n in bundle['inputs']) and not any(n.startswith('engine/') for n in bundle['inputs']), 'Browser bundle bypassed public SDK')
manifest = read(final_paths['public-entry'] / 'authorization.json')
record = {
    'stage': 'wishlist-build-29-private-snapshot-reuse', 'recordedAt': datetime.now(timezone.utc).isoformat(),
    'status': '788 selected CPU/inert/mock tests, full types, lint, SDK and browser bundles and zero-runtime public integration passed; physical replay and native execution held',
    'approvedCpuGatesComplete': True, 'fullyAccepted': False, 'fullWishlistComplete': False, 'runtimeEquivalenceProven': False,
    'currentTests': {'passed': 788, 'newSnapshotReuseCases': 22, 'failed': 0, 'skipped': 0, 'files': selected}, 'stages': stages, 'historicalAttempts': historical,
    'logicalCopyEvidence': copies[0],
    'reviewFixes': ['Correct the new test to inspect the existing translation movement report',
                    'Bound asynchronous test boundary polling to 400 microtasks before running verification'],
    'publicPackageIntegration': {'status': 'passed', 'physicsTicks': 0, 'gpu': False, 'nativeWorker': False, 'slabReference': public['slabReference']},
    'referenceArtifactSHA256': digest(ROOT / 'dist/verification/tactical-slab-sdk-check.mjs'),
    'physicalCases': {'totalHeld': 42, 'executed': False}, 'SDKBuild': 'passed; twelve bundles and declarations',
    'physicalGpuReplayBenchmarks': 'held', 'nativeWorkerExecuted': False, 'legacyDemos': 'quarantined',
    'protectedSourcesUnchanged': len(protected), 'protectedSourceHashes': protected, 'priorSourcesChanged': sorted(changed),
    'priorSDKArtifactsUnchanged': len(previous['sdkArtifactHashes']) - len(sdk_changed),
    'priorSDKArtifactsChanged': sorted(sdk_changed), 'newSDKArtifacts': sorted(sdk_new),
    'publicDeclarationsAndVersionsUnchanged': True,
    'checkedSourceHashes': {n: digest(ROOT / n) for n in manifest['sourceHashes'] if n.startswith(('engine/', 'scripts/', 'examples/tactical-worker/', 'examples/tactical-slab/')) or n in ('package.json', 'package-lock.json')},
    'reviewedSourceHashes': {n: digest(ROOT / n) for n in manifest['sourceHashes'] if not n.startswith('dist/sdk/')},
    'sdkArtifactHashes': {p.relative_to(ROOT).as_posix(): digest(p) for p in (ROOT / 'dist/sdk').rglob('*') if p.is_file()},
    'authorizationSHA256': digest(OUT / 'sdk-resume-authorization.json'), 'recorderSHA256': digest(Path(__file__)),
    'browserArtifactHashes': {p.relative_to(ROOT).as_posix(): digest(p) for p in browser.iterdir() if p.is_file()},
    'nativeUIAccepted': False,
    'renderContract': 'tactical-render-1', 'transportProtocol': 'tactical-worker-7',
    'scopeLimits': ['No native Worker, browser, GPU, physical stepping/support/replay or benchmark executed',
                    'Copy counters cover only the removed branch and advance-setup coordinate copies; no measured heap or timing improvement',
                    'Edited-domain, driver, query, validation, public-output and transport copies remain',
                    'Nonzero strategy comparisons use inert drivers; public integration advances zero physical ticks',
                    'Native UI, physical replay, chunk-level copy-on-write and incremental structural solving remain unverified or unimplemented',
                    'Full wishlist remains incomplete, including physical actors, loads and four elements']
}
target.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'record': target.name, 'passedTests': 788, 'stages': len(stages), 'protectedSourcesUnchanged': len(protected), 'avoidedCoordinateCopies': copies[0]['copy']['copiedCellCoordinates']}))
