"""Read source and saved receipts only. Never import or execute engine/harness code."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
PREVIOUS = OUT.parent / 'build-13-2026-10-17'


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def main():
    previous = json.loads((PREVIOUS / 'summary.json').read_text())
    protected = previous['protectedSourceHashes']
    mismatches = [name for name, expected in protected.items() if digest(ROOT / name) != expected]
    if mismatches:
        raise RuntimeError('Protected source changed: ' + ', '.join(mismatches))
    hold = ROOT / 'dist/verification/safety-hold.json'
    quarantine = ROOT / 'scripts/verify_checks.mjs'
    if digest(hold) != '3444c8e505e3dd47bfacecfcc4411b8ca1196c818600044d375481f235610f5b':
        raise RuntimeError('Runtime hold changed')
    if digest(quarantine) != 'b3ef0acf0af83786865b70664f144adf2f2f65452a7764cadd97a966333bcfaf':
        raise RuntimeError('Legacy quarantine changed')
    for runner in ('run_tests.py', 'run_cpu_stage.py'):
        if digest(OUT / runner) != digest(PREVIOUS / runner):
            raise RuntimeError('Reviewed runner changed')
    names = set(previous['testedSourceHashes'])
    names.update(p.relative_to(ROOT).as_posix() for p in (ROOT / 'engine').rglob('*.ts'))
    names.update(p.relative_to(ROOT).as_posix() for p in OUT.glob('*.py'))
    names.update(['docs/SDK.md', 'docs/checkpoints/TACTICAL_INTERVENTIONS.md', 'scripts/check_tactical_session_sdk.mjs', 'engine/lint_ts.mjs'])
    test_file = ROOT / 'engine/experimental/translation-paths.test.ts'
    case_count = len(re.findall(r"^\s*test\('", test_file.read_text(), re.M))
    runtime_file = ROOT / 'engine/experimental/translation-paths.runtime-cases.ts'
    held_count = len(re.findall(r"^\s*test\('", runtime_file.read_text(), re.M))
    gate = PREVIOUS / 'quiet-window-typecheck-02.json'
    gate_data = json.loads(gate.read_text())
    result = {
        'stage': 'wishlist-build-14-translation-paths-game-reduction',
        'updatedAt': datetime.now(timezone.utc).isoformat(),
        'fullyAccepted': False,
        'status': 'Source reviewed; all new tests/types/lint pending. No runtime workload launched.',
        'sourceOnly': True,
        'previousValidationSHA256': digest(PREVIOUS / 'summary.json'),
        'earlierPassingTests': {'cases': 367, 'directory': '../build-13-2026-10-17/attempt-02', 'appliesToCurrentSource': False},
        'currentTests': {'authoredEditInertCases': case_count, 'expectedSelectedCases': 367 + case_count, 'executed': False, 'passed': None},
        'typecheck': {'status': 'pending', 'workloadLaunched': False},
        'lint': {'status': 'pending', 'workloadLaunched': False},
        'latestGate': {'path': '../build-13-2026-10-17/' + gate.name, 'SHA256': digest(gate), 'passed': gate_data['passed'],
                       'hostCpuPercent': gate_data['samples'][-1]['hostCpuPercent'], 'launchLimitPercent': gate_data['maxHostCpuPercent']},
        'SDKChecks': 'User-deferred; no build or package execution',
        'physicalChecks': {'executed': False, 'newHeldCases': held_count, 'totalHeldCases': 26 + held_count},
        'GPUChecks': {'executed': False, 'telemetryRequested': False},
        'replayAndBenchmarks': {'executed': False},
        'runtimeEquivalenceProven': False,
        'protectedSourceHashes': protected,
        'protectedSourcesUnchanged': len(protected),
        'reviewedSourceHashes': {name: digest(ROOT / name) for name in sorted(names)},
        'runtimeHoldSHA256': digest(hold), 'legacyQuarantineSHA256': digest(quarantine),
        'reviewFindingsAddressed': [
            'Use explicit captured-result narrowing without changing the uncaptured translation route',
            'Check output identity and coordinate lengths in addition to every transported value',
            'Give policy and returned action independent receipt copies before journaling',
            'Retain immutable operation stamps and private canonical before/after snapshot provenance',
            'Keep held physical cases outside the edit-only test selector',
        ],
        'limitations': [
            'Source review is not a passing test, type or lint receipt',
            'Receipt expansion describes the v1 intervention contract, not a measured physical trajectory',
            'Actor carry/push consumption of translation paths is not implemented',
            'Full snapshot copies and reconstruction scans have no measured latency guarantee',
            'Retained observations keep boundary snapshots alive until released by their caller',
            'Physical/replay/GPU/performance acceptance and full wishlist remain incomplete',
        ],
        'recordScriptSHA256': digest(Path(__file__).resolve()),
    }
    target = OUT / 'summary.json'
    if target.exists():
        raise RuntimeError('Refusing to overwrite a source-review record')
    target.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'sourceOnly': True, 'authoredEditInertCases': case_count, 'expectedSelectedCases': 367 + case_count,
                      'newPhysicalCasesHeld': held_count, 'protectedSourcesUnchanged': len(protected), 'testsExecuted': False}))


if __name__ == '__main__':
    main()
