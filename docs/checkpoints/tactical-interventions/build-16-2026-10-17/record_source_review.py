"""Source hashes and saved gate evidence only. Never execute engine/harness code."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
PREVIOUS = OUT.parent / 'build-15-2026-10-17'


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def main():
    previous = json.loads((PREVIOUS / 'summary.json').read_text())
    protected = previous['protectedSourceHashes']
    for name, expected in protected.items():
        if digest(ROOT / name) != expected:
            raise RuntimeError('Protected source/configuration changed: ' + name)
    dependencies = ['engine/experimental/terrain-displacement.ts', 'engine/experimental/terrain-displacement-core.ts',
                    'engine/experimental/translation-displacement.ts', 'engine/experimental/translation-paths.ts',
                    'engine/experimental/tactical-session-core.ts', 'engine/experimental/terrain-body.ts']
    unchanged = {}
    for name in dependencies:
        current = digest(ROOT / name)
        if current != previous['reviewedSourceHashes'][name]:
            raise RuntimeError('Unexpected underlying implementation change: ' + name)
        unchanged[name] = current
    runners = {}
    for name in ('run_tests.py', 'run_cpu_stage.py'):
        current = digest(OUT / name)
        if current != digest(PREVIOUS / name):
            raise RuntimeError('Reviewed runner changed')
        runners[name] = current
    hold = ROOT / 'dist/verification/safety-hold.json'
    state = json.loads(hold.read_text())
    if state.get('blockRecovery') is not True or 'recoveryPermit' in state:
        raise RuntimeError('Runtime hold changed')
    names = set(previous['reviewedSourceHashes'])
    names.update(p.relative_to(ROOT).as_posix() for p in (ROOT / 'engine').rglob('*.ts'))
    names.update(p.relative_to(ROOT).as_posix() for p in OUT.glob('*.py'))
    names.update(['docs/SDK.md', 'docs/checkpoints/TACTICAL_INTERVENTIONS.md', 'engine/lint_ts.mjs', 'scripts/check_tactical_session_sdk.mjs'])
    count = len(re.findall(r"^\s*test\('", (ROOT / 'engine/experimental/terrain-body-group.test.ts').read_text(), re.M))
    held = len(re.findall(r"^\s*test\('", (ROOT / 'engine/experimental/terrain-body-group.runtime-cases.ts').read_text(), re.M))
    gate = PREVIOUS / 'quiet-window-attempt-01.json'
    gate_data = json.loads(gate.read_text())
    result = {
        'stage': 'wishlist-build-16-bounded-atomic-actor-groups',
        'updatedAt': datetime.now(timezone.utc).isoformat(), 'fullyAccepted': False, 'sourceOnly': True,
        'status': 'Source implementation/review complete; current tests/types/lint pending',
        'previousSourceReviewSHA256': digest(PREVIOUS / 'summary.json'),
        'currentTests': {'authoredEditInertCases': count, 'expectedSelectedCases': 436 + count, 'executed': False, 'passed': None},
        'historicalPassingTests': {'cases': 367, 'directory': '../build-13-2026-10-17/attempt-02', 'appliesToCurrentSource': False},
        'typecheck': {'status': 'pending', 'workloadLaunched': False}, 'lint': {'status': 'pending', 'workloadLaunched': False},
        'latestGate': {'path': '../build-15-2026-10-17/' + gate.name, 'SHA256': digest(gate), 'passed': gate_data['passed'],
                       'hostCpuPercent': gate_data['samples'][-1]['hostCpuPercent'], 'launchLimitPercent': gate_data['maxHostCpuPercent'],
                       'authorizationCreated': False, 'workloadLaunched': False},
        'protectedSourceHashes': protected, 'protectedSourcesUnchanged': len(protected),
        'underlyingImplementationsUnchanged': unchanged, 'reviewedRunnerHashes': runners,
        'reviewedSourceHashes': {name: digest(ROOT / name) for name in sorted(names)},
        'runtimeHoldSHA256': digest(hold), 'legacyQuarantineSHA256': digest(ROOT / 'scripts/verify_checks.mjs'),
        'SDKChecks': 'User-deferred; no build or public-package execution',
        'physicalChecks': {'executed': False, 'newHeldCases': held, 'totalHeldCases': 32 + held},
        'GPUChecks': {'executed': False, 'telemetryRequested': False}, 'replayAndBenchmarks': {'executed': False},
        'runtimeEquivalenceProven': False,
        'reviewFocus': [
            'Validate every input row and saved-body binding before any actor response',
            'Use exact identifier order for evaluation and first-failure selection',
            'Pass remaining work/event/contact/carry allowances rather than fresh per-actor limits',
            'Return all original bodies and no successful prefix after a later failure',
            'Keep actual evaluated-body/work/event accounting separate from publication',
            'Preserve input/output ownership and retained live-boundary provenance',
            'Keep physical group cases outside selected edit/mock validation',
        ],
        'limitations': [
            'No new tests, no-emit types or lint ran after the quiet-gate refusal',
            'Underlying shared-solver and translation changes remain unvalidated on current hashes',
            'Actor groups do not introduce actor-actor collision, loads or force feedback',
            'Hard actor counts bound repeated setup but work counters do not prove wall-clock responsiveness',
            'SDK/runtime/replay/performance acceptance and the full wishlist remain incomplete',
        ],
        'recordScriptSHA256': digest(Path(__file__).resolve()),
    }
    target = OUT / 'summary.json'
    if target.exists():
        raise RuntimeError('Refusing to overwrite source-review evidence')
    target.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'sourceOnly': True, 'newCases': count, 'expectedSelectedCases': 436 + count,
                      'physicalCasesHeld': 32 + held, 'protectedSourcesUnchanged': len(protected),
                      'unchangedImplementations': len(unchanged), 'testsExecuted': False}))


if __name__ == '__main__':
    main()
