"""Read and bind CPU/mock receipts only. Never imports or runs the engine."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
PREVIOUS = OUT.parent / 'build-27-2026-10-17'

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
                    'package.json', 'scripts/check_tactical_slab_sdk.mjs', 'examples/tactical-slab/index.ts',
                    'examples/tactical-slab/README.md'}, 'Unexpected prior source change: ' + str(changed))
require(all(digest(ROOT / n) == h for n, h in previous['sdkArtifactHashes'].items()), 'Existing SDK artifacts changed')
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
require(tests['success'] and tests['numPassedTests'] == tests['numTotalTests'] == 766 and all(tests[k] == 0 for k in ('numFailedTests', 'numPendingTests', 'numTodoTests')), 'Test count differs')
selected = re.findall(r"'(engine/[^']+\.test\.ts)'", (ROOT / 'engine/vitest.tactical-session.config.ts').read_text())
actual = [Path(r['name']).resolve().relative_to(ROOT).as_posix() for r in tests['testResults']]
require(len(selected) == len(actual) == 28 and set(selected) == set(actual), 'Selected test files differ')
new = next(r for r in tests['testResults'] if r['name'].endswith('tactical-slab-ui.test.ts'))
require(len(new['assertionResults']) == 33 and all(a['status'] == 'passed' for a in new['assertionResults']), 'UI cases differ')
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
    'stage': 'wishlist-build-28-worker-owned-tactical-ui', 'recordedAt': datetime.now(timezone.utc).isoformat(),
    'status': '766 selected CPU/inert/mock tests, full types, lint, SDK and browser bundles and zero-runtime public UI integration passed; native execution held',
    'approvedCpuGatesComplete': True, 'fullyAccepted': False, 'fullWishlistComplete': False, 'runtimeEquivalenceProven': False,
    'currentTests': {'passed': 766, 'newUICases': 33, 'failed': 0, 'skipped': 0, 'files': selected}, 'stages': stages, 'historicalAttempts': historical,
    'reviewFixes': ['Fix strict async closure narrowing and explicit mock port types after the first typecheck stopped',
                    'Dispose partial canvas observer/frame/timer resources when startup fails; add a mock DOM regression'],
    'publicPackageIntegration': {'status': 'passed', 'physicsTicks': 0, 'gpu': False, 'nativeWorker': False, 'slabReference': public['slabReference']},
    'referenceArtifactSHA256': digest(ROOT / 'dist/verification/tactical-slab-sdk-check.mjs'),
    'physicalCases': {'totalHeld': 42, 'executed': False}, 'SDKBuild': 'passed; twelve bundles and declarations',
    'physicalGpuReplayBenchmarks': 'held', 'nativeWorkerExecuted': False, 'legacyDemos': 'quarantined',
    'protectedSourcesUnchanged': len(protected), 'protectedSourceHashes': protected, 'priorSourcesChanged': sorted(changed),
    'priorSDKArtifactsUnchanged': len(previous['sdkArtifactHashes']),
    'checkedSourceHashes': {n: digest(ROOT / n) for n in manifest['sourceHashes'] if n.startswith(('engine/', 'scripts/', 'examples/tactical-worker/', 'examples/tactical-slab/')) or n in ('package.json', 'package-lock.json')},
    'reviewedSourceHashes': {n: digest(ROOT / n) for n in manifest['sourceHashes'] if not n.startswith('dist/sdk/')},
    'sdkArtifactHashes': {p.relative_to(ROOT).as_posix(): digest(p) for p in (ROOT / 'dist/sdk').rglob('*') if p.is_file()},
    'authorizationSHA256': digest(OUT / 'sdk-resume-authorization.json'), 'recorderSHA256': digest(Path(__file__)),
    'browserArtifactHashes': {p.relative_to(ROOT).as_posix(): digest(p) for p in browser.iterdir() if p.is_file()},
    'nativeUIAccepted': False,
    'renderContract': 'tactical-render-1', 'transportProtocol': 'tactical-worker-7',
    'scopeLimits': ['No native Worker, browser, GPU, physical stepping/support/replay or benchmark executed',
                    'DOM mocks prove control binding and blocked/failed startup, not pixels, interaction quality or native responsiveness',
                    'Browser compilation proves public-package resolution, not native shader compilation or runtime behavior',
                    'Nonzero scheduling tests use inert drivers; public integration advances zero physical ticks',
                    'Diagnostic materials and actor boxes; no naturalistic presentation or measured preview/frame latency',
                    'Full wishlist remains incomplete, including physical actors, structural reuse, efficient branches, loads and four elements']
}
target.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'record': target.name, 'passedTests': 766, 'stages': len(stages), 'protectedSourcesUnchanged': len(protected)}))
