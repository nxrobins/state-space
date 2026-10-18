"""Bind existing bounded CPU receipts. Never imports or executes the engine."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
PREVIOUS = OUT.parent / 'build-37-2026-10-17'

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def digest(path):
    return sha256(path.read_bytes()).hexdigest()

def require(condition, message):
    if not condition:
        raise ValueError(message)

def owned_source(name):
    return name.startswith(('engine/', 'scripts/', 'examples/tactical-worker/', 'examples/tactical-slab/')) or name in ('package.json', 'package-lock.json')

def artifacts(folder):
    return {p.relative_to(ROOT).as_posix(): digest(p) for p in (ROOT / folder).rglob('*') if p.is_file()}

target = OUT / 'summary.json'
require(not target.exists(), 'Refusing to overwrite evidence')
previous = read(PREVIOUS / 'summary.json')
protected = previous['protectedSourceHashes']
require(len(protected) == 96 and all(digest(ROOT / n) == h for n, h in protected.items()), 'Protected sources differ')
changed = {n for n, h in previous['checkedSourceHashes'].items() if digest(ROOT / n) != h}
require(changed == {'engine/experimental/reactive-materials.ts', 'engine/lint_ts.mjs', 'engine/vitest.tactical-session.config.ts',
                    'scripts/check_reactive_materials_sdk.mjs'}, 'Unexpected previous source changes: ' + str(changed))
sdk = artifacts('dist/sdk')
sdk_changed = {n for n, h in previous['sdkArtifactHashes'].items() if sdk.get(n) != h}
require(sdk_changed == {'dist/sdk/state-space-reactive-materials.js', 'dist/sdk/types/experimental/reactive-materials.d.ts'}, 'Unexpected previous SDK artifact change')
new_sdk = set(sdk) - set(previous['sdkArtifactHashes'])
require(new_sdk == {'dist/sdk/types/experimental/reactive-movement.d.ts', 'dist/sdk/types/experimental/reactive-evolution.d.ts'}, 'Unexpected new artifacts')
browser = artifacts('dist/tactical-slab')
require(browser == previous['browserArtifactHashes'], 'Existing browser artifact changed')
hold_hash = digest(ROOT / 'dist/verification/safety-hold.json')
require(hold_hash == '3444c8e505e3dd47bfacecfcc4411b8ca1196c818600044d375481f235610f5b', 'Runtime hold bytes changed')
hold = read(ROOT / 'dist/verification/safety-hold.json')
require(hold.get('blockRecovery') is True and 'recoveryPermit' not in hold, 'Runtime hold scope differs')
for runner in ('run_tests.py', 'run_cpu_stage.py'):
    require(digest(OUT / runner) == digest(PREVIOUS / runner), 'Reviewed runner changed')
require(digest(ROOT / 'engine/tsconfig.tactical-check.json') == previous['checkedSourceHashes']['engine/tsconfig.tactical-check.json'], 'Full typecheck scope changed')

stages, final_paths = {}, {}
for prefix in ('attempt', 'typecheck', 'lint', 'sdk', 'public-entry'):
    candidates = list(OUT.glob(prefix + '-*/report.json'))
    require(bool(candidates), 'Missing stage ' + prefix)
    path = max(candidates, key=lambda p: read(p)['startedAt'])
    report, folder = read(path), path.parent
    cleanup, auth = read(folder / 'cleanup.json'), read(folder / 'authorization.json')
    require(report['passed'] and report['exitCode'] == 0 and report['kind'] == 'cpu', 'Final stage failed')
    require(report['cpuLimitPercent'] == 6 and report['memoryLimitMiB'] == 4096 and report['independentWatchdog']['armed'], 'Containment changed')
    require(report['timeoutSeconds'] == (60 if prefix == 'sdk' else 30), 'Deadline changed')
    require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'] and cleanup['globalHoldAndSourceHashesUnchanged'], 'Cleanup failed')
    require(auth['userAuthorizationSHA256'] == digest(OUT / 'sdk-resume-authorization.json'), 'Authorization changed')
    gate_path = OUT / auth['quietGate']
    gate = read(gate_path)
    require(digest(gate_path) == auth['quietGateSHA256'] and gate['passed'] and gate['maxHostCpuPercent'] == 50 and len(gate['samples']) == 10, 'Quiet gate changed')
    require(all(s['hostCpuPercent'] is not None and s['hostCpuPercent'] <= 50 and s['freeMemoryMiB'] >= 8192 for s in gate['samples']), 'Quiet limits differ')
    for name, expected in auth['sourceHashes'].items():
        if owned_source(name) or name.startswith('dist/'):
            require(digest(ROOT / name) == expected, 'Source/artifact changed since final check: ' + name)
    stages[folder.name] = {'passed': True, 'command': report['command'], 'wallSeconds': round(report['finishedAt'] - report['startedAt'], 3),
        'timeoutSeconds': report['timeoutSeconds'], 'cleanupVerified': True, 'maxLaunchCpuPercent': max(s['hostCpuPercent'] for s in gate['samples']),
        'quietGateSHA256': digest(gate_path), 'evidenceSHA256': {p.name: digest(p) for p in folder.iterdir() if p.is_file()}}
    final_paths[prefix] = folder

tests = read(final_paths['attempt'] / 'vitest.json')
require(tests['success'] and tests['numPassedTests'] == tests['numTotalTests'] == 1111 and
        all(tests[k] == 0 for k in ('numFailedTests', 'numPendingTests', 'numTodoTests')), 'Test result differs')
selected = re.findall(r"'(engine/[^']+\.test\.ts)'", (ROOT / 'engine/vitest.tactical-session.config.ts').read_text())
actual = [Path(r['name']).resolve().relative_to(ROOT).as_posix() for r in tests['testResults']]
require(len(selected) == len(actual) == 42 and set(selected) == set(actual), 'Test selection differs')
for name, count in [('reactive-movement.test.ts', 30), ('reactive-evolution.test.ts', 21)]:
    result = next(r for r in tests['testResults'] if r['name'].endswith(name))
    require(len(result['assertionResults']) == count and all(a['status'] == 'passed' for a in result['assertionResults']), 'New cases differ')
held = {p.relative_to(ROOT).as_posix(): len(re.findall(r'\btest\(', p.read_text())) for p in (ROOT / 'engine/experimental').glob('*.runtime-cases.ts')}
require(len(held) == 13 and sum(held.values()) == 48 and not set(held).intersection(selected), 'Held case inventory differs')
copies = [json.loads(line.split('SNAPSHOT_REUSE_EVIDENCE ', 1)[1]) for line in (final_paths['attempt'] / 'stdout.log').read_text(encoding='utf-8').splitlines() if line.startswith('SNAPSHOT_REUSE_EVIDENCE ')]
require(len(copies) == 1 and copies[0] == previous['priorCopyRegressionEvidence'], 'Prior logical copy evidence changed')
historical = {}
for path in OUT.glob('*/report.json'):
    if path.parent in final_paths.values():
        continue
    report, cleanup = read(path), read(path.parent / 'cleanup.json')
    require(not cleanup['workloadStillRunning'] and not cleanup['namedJobStillExists'] and cleanup['globalHoldAndSourceHashesUnchanged'], 'Historical cleanup failed')
    historical[path.parent.name] = {'passed': report['passed'], 'exitCode': report['exitCode'], 'cleanupVerified': True,
        'evidenceSHA256': {p.name: digest(p) for p in path.parent.iterdir() if p.is_file()}}
exports = read(ROOT / 'package.json')['exports']
require(len(exports) == 13 and all((ROOT / e[k]).is_file() for e in exports.values() for k in ('import', 'types')), 'SDK exports incomplete')
public = read(final_paths['public-entry'] / 'stdout.log')
require(public['passed'] and public['physicsTicks'] == 0 and public['gpu'] is False and public['terrainPeerContacts'] is True, 'Public integration differs')
require(public['slabReference'] == previous['publicPackageIntegration']['slabReference'], 'Prior chamber integration changed')
require(public['reactiveMaterials'] == {'passed': True, 'entry': 'state-space-engine/experimental/3d/reactive-materials', 'cells': 3, 'customMaterial': 200,
    'atomicEdits': True, 'accountedChemicalEnergy': True, 'portableContinuation': True, 'physicsTicks': 0, 'gpu': False, 'localReactionCycle': True, 'stagedPublication': True,
    'cancellation': True, 'reactionStateCycle': 4, 'conservativeEvolution': True, 'transportedSmoke': True, 'evolutionTick': 2}, 'Public reactive integration incomplete')
bundle = read(ROOT / 'dist/tactical-slab/bundle-inputs.json')
require(len(bundle['outputs']) == 2 and any(n.startswith('dist/sdk/') for n in bundle['inputs']) and not any(n.startswith('engine/') for n in bundle['inputs']), 'Browser SDK boundary changed')
manifest = read(final_paths['public-entry'] / 'authorization.json')
record = {
    'stage': 'wishlist-build-38-conservative-reactive-evolution', 'recordedAt': datetime.now(timezone.utc).isoformat(),
    'status': '1111 selected CPU/tiny-kernel/edit/geometry/inert/mock tests, full types, lint, thirteen SDK bundles/declarations, browser bundles and zero-M5-tick public integration passed',
    'approvedCpuGatesComplete': True, 'fullyAccepted': False, 'fullWishlistComplete': False, 'runtimeEquivalenceProven': False,
    'currentTests': {'passed': 1111, 'newMovementEvolutionCases': 51, 'failed': 0, 'skipped': 0, 'files': selected},
    'stages': stages, 'historicalAttempts': historical, 'priorCopyRegressionEvidence': copies[0],
    'reviewRefinements': ['Keep noncohesive solid/frozen phases as obstacles despite their zero structural words',
        'Record executed swaps and original identities so return-to-origin movement is not erased by endpoint comparison'],
    'reactiveMaterialContract': 'reactive-materials-1', 'reactiveBlockContract': 'reactive-material-block-1',
    'reactiveReactionContract': 'reactive-reactions-1', 'reactiveMovementContract': 'reactive-movement-1',
    'reactiveEvolutionContract': 'reactive-evolution-1', 'reactiveEvolutionSchema': 1,
    'reactiveEvolutionAcceptance': {'conservativeAllCoordinateMovement': True, 'oddRectangularAndSingletonBoundaries': True,
        'threeAxisGravityAndLateralFlow': True, 'exactGasRanking': True, 'customDensity': True,
        'mechanicalOwnership': True, 'actualMatterProvenance': True, 'returnToOriginHistory': True,
        'burningAndSmokeTransport': True, 'movementBeforeFreezing': True, 'completeTickPublication': True,
        'allIncompleteBoundaryCancellation': True, 'oddTickAndRotationContinuation': True,
        'globalSupport': False, 'actorCoupling': False, 'nativeExecution': False},
    'localKernelExecution': {'maximumFixtureCells': 125, 'maximumTrajectoryTicks': 8,
        'publicFixtureCells': 3, 'publicReactionCompleteCycles': 2, 'publicReactionCancelledPasses': 1,
        'publicEvolutionCompleteTicks': 3, 'publicEvolutionCancelledPasses': 21,
        'M5Ticks': 0, 'globalSupportSolves': 0, 'nativeWorker': False, 'gpu': False, 'performanceMeasured': False},
    'publicPackageIntegration': public,
    'referenceArtifactSHA256': digest(ROOT / 'dist/verification/tactical-slab-sdk-check.mjs'),
    'physicalCases': {'totalHeld': 48, 'newAuthoredPhysicalCases': 0, 'inventory': held, 'executed': False},
    'SDKBuild': 'passed; thirteen bundles and declarations', 'physicalGpuReplayBenchmarks': 'held', 'nativeWorkerExecuted': False,
    'legacyDemos': 'quarantined', 'holdSHA256': hold_hash, 'protectedSourcesUnchanged': len(protected), 'protectedSourceHashes': protected,
    'priorSourcesChanged': sorted(changed), 'priorSDKArtifactsUnchanged': len(previous['sdkArtifactHashes']) - len(sdk_changed),
    'priorSDKArtifactsChanged': sorted(sdk_changed), 'newSDKArtifacts': sorted(new_sdk),
    'publicAPIChanges': ['Add frozen conservative movement passes and staged complete evolution ticks with executed matter provenance'],
    'ExistingSDKRulesAndSaveSchemasUnchanged': True, 'applicationSaveSchemaChanged': False, 'applicationRules': 'hot-slab-game-4',
    'checkedSourceHashes': {n: digest(ROOT / n) for n in manifest['sourceHashes'] if owned_source(n)},
    'reviewedSourceHashes': {n: digest(ROOT / n) for n in manifest['sourceHashes'] if not n.startswith('dist/sdk/')},
    'sdkArtifactHashes': sdk, 'browserArtifactHashes': browser,
    'authorizationSHA256': digest(OUT / 'sdk-resume-authorization.json'), 'recorderSHA256': digest(Path(__file__)),
    'nativeUIAccepted': False, 'renderContract': 'tactical-render-1', 'transportProtocol': 'tactical-worker-7',
    'scopeLimits': ['Tiny movement-plus-reaction trajectories ran; global structural integration and full gameplay replay remain unverified',
        'No native Worker/browser/GPU, M5 material stepping, global support solve, full world replay or benchmark executed',
        'Reactive blocks are separate from existing M5 worlds and saves; no implicit migration',
        'Actor loads, physical coupling, native interaction, measured latency and structural dependency reuse remain pending']
}
target.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'record': target.name, 'passedTests': 1111, 'stages': len(stages), 'protectedSourcesUnchanged': len(protected),
                  'existingSDKArtifactsUnchanged': len(previous['sdkArtifactHashes']) - len(sdk_changed), 'newMovementEvolutionCases': 51}))
