"""Bind bounded receipts only. Never imports or executes simulation code."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
PREVIOUS = OUT.parent / 'build-42-2026-10-17'

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
sdk = artifacts('dist/sdk')
sdk_changed = {n for n, h in previous['sdkArtifactHashes'].items() if sdk.get(n) != h}
require(sdk_changed == {'dist/sdk/state-space-reactive-materials.js', 'dist/sdk/types/experimental/reactive-materials.d.ts'}, 'Unexpected prior SDK changes')
new_sdk = set(sdk) - set(previous['sdkArtifactHashes'])
require(new_sdk == {'dist/sdk/types/experimental/reactive-domain-state.d.ts', 'dist/sdk/types/experimental/reactive-domains.d.ts', 'dist/sdk/types/experimental/reactive-transfer.d.ts'}, 'Unexpected new SDK artifacts')
browser = artifacts('dist/tactical-slab')
require(browser == previous['browserArtifactHashes'], 'Browser artifacts changed')
hold_hash = digest(ROOT / 'dist/verification/safety-hold.json')
require(hold_hash == previous['holdSHA256'], 'Runtime hold changed')
hold = read(ROOT / 'dist/verification/safety-hold.json')
require(hold.get('blockRecovery') is True and 'recoveryPermit' not in hold, 'Runtime hold scope changed')
for runner in ('run_tests.py', 'run_cpu_stage.py'):
    require(digest(OUT / runner) == digest(PREVIOUS / runner), 'Reviewed runner changed')

stages, final = {}, {}
for label, prefix, suite in [('core', 'attempt', 'core'), ('world', 'attempt', 'world'), ('translation', 'attempt', 'translation'), ('holds', 'attempt', 'holds'), ('domains', 'attempt', 'domains'), ('typecheck', 'typecheck', None),
                            ('lint', 'lint', None), ('sdk', 'sdk', None), ('public-entry', 'public-entry', None)]:
    paths = [p for p in OUT.glob(prefix + '-*/report.json') if suite is None or read(p.parent / 'authorization.json').get('testSuite') == suite]
    require(bool(paths), 'Missing stage ' + label)
    path = max(paths, key=lambda p: read(p)['startedAt'])
    folder, report = path.parent, read(path)
    auth, cleanup = read(folder / 'authorization.json'), read(folder / 'cleanup.json')
    require(report['passed'] and report['exitCode'] == 0 and report['kind'] == 'cpu', 'Stage failed: ' + label)
    require(report['cpuLimitPercent'] == 6 and report['memoryLimitMiB'] == 4096 and report['independentWatchdog']['armed'], 'Containment changed')
    require(report['timeoutSeconds'] == (60 if label == 'sdk' else 30), 'Deadline changed')
    require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'] and cleanup['globalHoldAndSourceHashesUnchanged'], 'Cleanup failed')
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

selected, results = [], {}
for suite, expected, config, files in [('core', 1146, 'engine/vitest.tactical-session.config.ts', 43),
                                     ('world', 36, 'engine/vitest.reactive-world.config.ts', 1),
                                     ('translation', 40, 'engine/vitest.reactive-translation.config.ts', 1),
                                     ('holds', 36, 'engine/vitest.reactive-holds.config.ts', 1),
                                     ('domains', 45, 'engine/vitest.reactive-domains.config.ts', 1)]:
    result = read(final[suite] / 'vitest.json')
    require(result['success'] and result['numPassedTests'] == result['numTotalTests'] == expected and
            all(result[k] == 0 for k in ('numFailedTests', 'numPendingTests', 'numTodoTests')), 'Test result differs: ' + suite)
    scope = re.findall(r"'(engine/[^']+\.test\.ts)'", (ROOT / config).read_text())
    actual = [Path(r['name']).resolve().relative_to(ROOT).as_posix() for r in result['testResults']]
    require(len(scope) == len(actual) == files and set(scope) == set(actual), 'Suite selection differs')
    require(not set(selected).intersection(scope), 'Duplicate test coverage in combined count')
    selected.extend(scope); results[suite] = {'passed': expected, 'files': scope}
held = {p.relative_to(ROOT).as_posix(): len(re.findall(r'\btest\(', p.read_text())) for p in (ROOT / 'engine/experimental').glob('*.runtime-cases.ts')}
require(len(held) == 13 and sum(held.values()) == 48 and not set(held).intersection(selected), 'Held cases changed')
copies = [json.loads(line.split('SNAPSHOT_REUSE_EVIDENCE ', 1)[1]) for line in (final['core'] / 'stdout.log').read_text(encoding='utf-8').splitlines() if line.startswith('SNAPSHOT_REUSE_EVIDENCE ')]
require(len(copies) == 1 and copies[0] == previous['priorCopyRegressionEvidence'], 'Prior copy evidence changed')
history = {}
for path in OUT.glob('*/report.json'):
    if path.parent in final.values():
        continue
    report, cleanup = read(path), read(path.parent / 'cleanup.json')
    require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'] and cleanup['globalHoldAndSourceHashesUnchanged'], 'Historical cleanup incomplete')
    history[path.parent.name] = {'passed': report['passed'], 'exitCode': report['exitCode'], 'cleanupVerified': True,
        'evidenceSHA256': {p.name: digest(p) for p in path.parent.iterdir() if p.is_file()}}
exports = read(ROOT / 'package.json')['exports']
require(len(exports) == 13 and all((ROOT / e[k]).is_file() for e in exports.values() for k in ('import', 'types')), 'SDK exports incomplete')
public = read(final['public-entry'] / 'stdout.log')
require(public['passed'] and public['physicsTicks'] == 0 and public['gpu'] is False, 'Public M5 scope changed')
expected_public = dict(previous['publicPackageIntegration'])
expected_public['reactiveMaterials'] = {**expected_public['reactiveMaterials'], 'reactiveTranslation': True,
    'translationRules': 'reactive-translation-1', 'translationCells': 4, 'translationWorldTicks': 2,
    'preservesMaterialHistory': True, 'reactiveHolds': True, 'constrainedWorldRules': 'reactive-world-2',
    'holdRules': 'reactive-holds-1', 'holdCells': 4, 'holdWorldTicks': 5, 'holdExpiryContinuation': True, 'noTemporaryAnchorResidue': True, 'reactiveDomains': True, 'domainRules': 'reactive-domains-1', 'transferRules': 'reactive-transfer-1',
    'domainCells': 8, 'completedDomainSetTicks': 2, 'containedWorldTicks': 4, 'storedMaterialHistory': True, 'synchronizedReservoirContinuation': True}
require(public == expected_public, 'Public integration differs')
bundle = read(ROOT / 'dist/tactical-slab/bundle-inputs.json')
require(len(bundle['outputs']) == 2 and any(n.startswith('dist/sdk/') for n in bundle['inputs']) and not any(n.startswith('engine/') for n in bundle['inputs']), 'Browser boundary changed')
manifest = read(final['public-entry'] / 'authorization.json')
preflights = {}
for path in OUT.glob('quiet-window-*.json'):
    gate = read(path)
    if not gate['passed']:
        attempt = path.stem.removeprefix('quiet-window-')
        require(not (OUT / attempt / 'authorization.json').exists() and not (OUT / attempt / 'report.json').exists(), 'Failed preflight authorized work')
    preflights[path.name] = {'passed': gate['passed'], 'samples': len(gate['samples']),
        'maximumCpuPercent': max((s['hostCpuPercent'] or 0 for s in gate['samples']), default=None), 'SHA256': digest(path)}
record = {
    'stage': 'wishlist-build-43-conservative-reactive-reservoirs', 'recordedAt': datetime.now(timezone.utc).isoformat(),
    'status': '1303 selected CPU tests in five sequential bounded jobs, full types, lint, SDK/browser compilation and public integration passed',
    'approvedCpuGatesComplete': True, 'fullyAccepted': False, 'fullWishlistComplete': False, 'runtimeEquivalenceProven': False,
    'currentTests': {'passed': 1303, 'newDomainCases': 45, 'failed': 0, 'skipped': 0, 'files': selected, 'suites': results},
    'stages': stages, 'historicalAttempts': history, 'preflightGates': preflights, 'priorCopyRegressionEvidence': copies[0],
    'reactiveWorldContract': 'reactive-world-1', 'reactiveWorldSchema': 1,
    'domainSetContract': 'reactive-domains-1', 'transferContract': 'reactive-transfer-1',
    'domainAcceptance': {'allCoordinateConservation': True, 'customMaterialHistory': True, 'internalBondPreservation': True,
        'explicitCutsAndReleases': True, 'holdProtection': True, 'synchronizedTicks': True, 'lateFailureAtomicity': True,
        'revisionBoundCommits': True, 'cancellation': True, 'JSONContinuation': True, 'externalAccounting': True},
    'constrainedWorldContract': 'reactive-world-2', 'constrainedWorldSchema': 2, 'holdContract': 'reactive-holds-1',
    'holdAcceptance': {'absoluteExpiry': True, 'oddTickRestart': True, 'sameTickTransformRetirement': True,
        'identicalPlacementRetirement': True, 'permanentAnchorPreservation': True, 'privateOverlays': True,
        'damagedMatterAndInternalBondsPreserved': True, 'revisionAtomicity': True, 'cancellation': True, 'isolatedReports': True},
    'reactiveTranslationContract': 'reactive-translation-1',
    'translationAcceptance': {'allAxesAndSigns': True, 'overlapAndDisconnectedRuns': True,
        'exactAllCoordinatePermutation': True, 'internalBondDamageAndHeatPreservation': True,
        'customCatalogDisplacement': True, 'explicitCutsAndReleases': True, 'noAutoWeld': True,
        'perStepExecutedProvenance': True, 'roundTripHistory': True, 'lateFailureAtomicity': True,
        'sameRevisionCommit': True, 'cancellation': True, 'JSONContinuation': True,
        'liftThenFallHistory': True, 'movedFuelThenCombustion': True,
        'temporaryHolds': True, 'reservoirIntegration': True, 'tacticalActorTransaction': False},
    'localKernelExecution': {'maximumFixtureCells': 125, 'maximumTranslationPathSteps': 8, 'maximumPriorTrajectoryTicks': 8,
        'publicDomainCells': 8, 'publicDomainSetTicks': 2, 'publicContainedWorldTicks': 4, 'maximumDomainTrajectoryTicks': 6,
        'publicHoldCells': 4, 'publicHeldWorldTicks': 5, 'maximumHoldTrajectoryTicks': 6,
        'publicTranslationCells': 4, 'publicTranslatedWorldTicks': 2, 'publicPriorWorldTicks': 3,
        'M5Ticks': 0, 'M5SupportSolves': 0, 'newReactiveWorldExecuted': True,
        'nativeWorker': False, 'gpu': False, 'performanceMeasured': False},
    'publicPackageIntegration': public, 'referenceArtifactSHA256': digest(ROOT / 'dist/verification/tactical-slab-sdk-check.mjs'),
    'physicalCases': {'totalHeld': 48, 'newAuthoredPhysicalCases': 0, 'inventory': held, 'executed': False},
    'SDKBuild': 'passed; thirteen bundles and declarations', 'physicalGpuReplayBenchmarks': 'held', 'nativeWorkerExecuted': False,
    'legacyDemos': 'quarantined', 'holdSHA256': hold_hash, 'protectedSourcesUnchanged': len(protected), 'protectedSourceHashes': protected,
    'priorSourcesChanged': sorted(changed), 'priorSDKArtifactsUnchanged': len(previous['sdkArtifactHashes']) - len(sdk_changed),
    'priorSDKArtifactsChanged': sorted(sdk_changed), 'newSDKArtifacts': sorted(new_sdk),
    'publicAPIChanges': ['Add finite reactive domain sets, conservative transfer jobs and synchronized atomic tick publication'],
    'ExistingSDKRulesAndSaveSchemasUnchanged': True, 'newSaveSchema': 'reactive-domains-1; explicit primary and companion world wrapper', 'applicationSaveSchemaChanged': False, 'applicationRules': 'hot-slab-game-4',
    'checkedSourceHashes': {n: digest(ROOT / n) for n in manifest['sourceHashes'] if owned(n)},
    'reviewedSourceHashes': {n: digest(ROOT / n) for n in manifest['sourceHashes'] if not n.startswith('dist/sdk/')},
    'sdkArtifactHashes': sdk, 'browserArtifactHashes': browser,
    'authorizationSHA256': digest(OUT / 'sdk-resume-authorization.json'), 'recorderSHA256': digest(Path(__file__)),
    'nativeUIAccepted': False, 'renderContract': 'tactical-render-1', 'transportProtocol': 'tactical-worker-7',
    'scopeLimits': ['Tiny synchronized domain ticks, conservative transfers and reactive physical continuation ran; M5/native/GPU and large-world replay remain held',
        'Transfer swap slices are capped at 256 pairs; domain ticks advance one kernel slice or preparation/publication boundary per call',
        'Validation, cloning and publication remain O(total cells); latency is unmeasured',
        'Cross-domain exchange reports handoff correspondence, not swept travel through intervening terrain',
        'Reactive branch scheduling and tactical actor/resource transactions still need integration',
        'No GPU, native interaction or performance claim; legacy demos stay quarantined']
}
target.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'passedTests': 1303, 'newDomainCases': 45, 'stages': len(stages), 'protectedSourcesUnchanged': len(protected),
                  'previousSDKArtifactsUnchanged': len(previous['sdkArtifactHashes']) - len(sdk_changed)}))
