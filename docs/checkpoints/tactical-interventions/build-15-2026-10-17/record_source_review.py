"""Source/receipt inspection only. Does not execute engine or verification workloads."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
PREVIOUS = OUT.parent / 'build-14-2026-10-17'


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def section(source, start, end):
    return source[source.index(start):source.index(end, source.index(start))]


def main():
    previous = json.loads((PREVIOUS / 'summary.json').read_text())
    protected = previous['protectedSourceHashes']
    for name, expected in protected.items():
        if digest(ROOT / name) != expected:
            raise RuntimeError('Protected source/configuration changed: ' + name)
    baseline = OUT / 'terrain-displacement.before.txt'
    if digest(baseline) != previous['reviewedSourceHashes']['engine/experimental/terrain-displacement.ts']:
        raise RuntimeError('Extraction baseline differs from reviewed Build 14 source')
    old = baseline.read_text()
    core_path = ROOT / 'engine/experimental/terrain-displacement-core.ts'
    core = core_path.read_text()
    helper_start, helper_end = 'function hit(', 'export function create'
    event_start, event_end = '        while (cmp(time, ONE) < 0)', '      const final = after.fit('
    chunks = {
        'exactIntersectionTouchAndOrdering': (section(old, helper_start, helper_end), section(core, helper_start, helper_end)),
        'contactEventLoopRelocationsAndPermutation': (section(old, event_start, event_end), section(core, event_start, event_end)),
    }
    equal_chunks = {}
    for name, (left, right) in chunks.items():
        if left != right:
            raise RuntimeError('Unexpected solver change in ' + name)
        equal_chunks[name] = {'equalText': True, 'SHA256': sha256(left.encode()).hexdigest(), 'characters': len(left)}
    for runner in ('run_tests.py', 'run_cpu_stage.py'):
        if digest(OUT / runner) != digest(PREVIOUS / runner):
            raise RuntimeError('Reviewed runner changed')
    names = set(previous['reviewedSourceHashes'])
    names.update(p.relative_to(ROOT).as_posix() for p in (ROOT / 'engine').rglob('*.ts'))
    names.update(p.relative_to(ROOT).as_posix() for p in OUT.glob('*.py'))
    names.update(['docs/SDK.md', 'docs/checkpoints/TACTICAL_INTERVENTIONS.md', 'engine/lint_ts.mjs', 'scripts/check_tactical_session_sdk.mjs'])
    count = len(re.findall(r"^\s*test\('", (ROOT / 'engine/experimental/translation-displacement.test.ts').read_text(), re.M))
    held = len(re.findall(r"^\s*test\('", (ROOT / 'engine/experimental/translation-displacement.runtime-cases.ts').read_text(), re.M))
    gate = PREVIOUS / 'quiet-window-attempt-01.json'
    gate_data = json.loads(gate.read_text())
    hold = ROOT / 'dist/verification/safety-hold.json'
    hold_data = json.loads(hold.read_text())
    if hold_data.get('blockRecovery') is not True or 'recoveryPermit' in hold_data:
        raise RuntimeError('Runtime hold is not intact')
    result = {
        'stage': 'wishlist-build-15-translation-driven-actors',
        'updatedAt': datetime.now(timezone.utc).isoformat(),
        'fullyAccepted': False, 'sourceOnly': True,
        'status': 'Source implementation/review complete; all current tests/types/lint pending',
        'previousSourceReviewSHA256': digest(PREVIOUS / 'summary.json'),
        'currentTests': {'authoredEditInertCases': count, 'expectedSelectedCases': 403 + count, 'executed': False, 'passed': None},
        'historicalPassingTests': {'cases': 367, 'directory': '../build-13-2026-10-17/attempt-02', 'appliesToCurrentSource': False},
        'typecheck': {'status': 'pending', 'workloadLaunched': False},
        'lint': {'status': 'pending', 'workloadLaunched': False},
        'latestGate': {'path': '../build-14-2026-10-17/' + gate.name, 'SHA256': digest(gate), 'passed': gate_data['passed'],
                       'hostCpuPercent': gate_data['samples'][-1]['hostCpuPercent'], 'launchLimitPercent': gate_data['maxHostCpuPercent'],
                       'authorizationCreated': False, 'workloadLaunched': False},
        'sharedSolverSourceEvidence': {'baselineSHA256': digest(baseline), 'currentCoreSHA256': digest(core_path),
                                      'preservedSections': equal_chunks, 'runtimeEquivalenceProven': False},
        'protectedSourceHashes': protected, 'protectedSourcesUnchanged': len(protected),
        'reviewedSourceHashes': {name: digest(ROOT / name) for name in sorted(names)},
        'runtimeHoldSHA256': digest(hold), 'legacyQuarantineSHA256': digest(ROOT / 'scripts/verify_checks.mjs'),
        'SDKChecks': 'User-deferred; no build or public-package execution',
        'physicalChecks': {'executed': False, 'newHeldCases': held, 'totalHeldCases': 29 + held},
        'GPUChecks': {'executed': False, 'telemetryRequested': False},
        'replayAndBenchmarks': {'executed': False},
        'reviewFocus': [
            'Same trusted geometry and live operation provenance, independent per-body resolve state',
            'All supporting faces must be controlled before carry; later passes use prior permutation occupancy',
            'Preserved exact contact arithmetic, event ordering, relocation handling and permutation installation',
            'Requested carry is distinct from final displacement, including wall-constrained slipping',
            'Incomplete responses clear all partial contact/crush/carry detail and preserve saved actor',
            'Tick adapter preserves existing rules identity, fallback carry, result shape and pass endpoint',
            'Physical continuation fixtures remain outside the edit-only test selector',
        ],
        'limitations': [
            'Source text equivalence is not runtime or physical replay proof',
            'Existing tick and new translation response regressions both need a future safe run',
            'Carry is a geometric game rule, not friction, force or load-capacity simulation',
            'Actor-actor collision, optional terrain loads and force feedback remain unimplemented',
            'Per-body work/detail caps do not establish whole-game latency or responsiveness',
            'Full wishlist acceptance and held SDK/runtime/replay/performance gates remain incomplete',
        ],
        'recordScriptSHA256': digest(Path(__file__).resolve()),
    }
    target = OUT / 'summary.json'
    if target.exists():
        raise RuntimeError('Refusing to overwrite source-review evidence')
    target.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'sourceOnly': True, 'newEditInertCases': count, 'expectedSelectedCases': 403 + count,
                      'physicalCasesHeld': 29 + held, 'protectedSourcesUnchanged': len(protected), 'preservedSolverSections': list(equal_chunks), 'testsExecuted': False}))


if __name__ == '__main__':
    main()
