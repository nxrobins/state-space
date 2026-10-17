"""Audit the bounded M5 solver-budget repair. Metadata only; no benchmarks.

The release/review audits describe their frozen revisions. This audit binds the
new host scheduling change and regressions without promoting old frame timings.
"""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT/'docs/checkpoints/volume-m5'
REVISION = '7332c30c7d12deace04fdfad5ba88ea872628f5c'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf8'))


def baseline(path):
    return subprocess.check_output(['git', 'show', f'{REVISION}:{path}'], cwd=ROOT)


def main():
    spec = read(BASE/'latency/manifest.json')
    assert spec['baselineRevision'] == REVISION
    assert spec['performanceStatus'] == 'deferred-by-user'
    # Permit precisely the two attempt-budget changes. The kernels, CPU law,
    # validation, state publication, and complete-convergence fallback stay exact.
    path = 'engine/experimental/structural-world-gpu.ts'
    expected = baseline(path).decode().replace('\r\n', '\n')
    expected = expected.replace(
        '      const budget=slot===4?Math.min(this.#solveBatchLimit,4):this.#solveBatchLimit;',
        '      // Blocking is a fixed-point solve too: four iterations can be exhausted\n'
        '      // by stacked disconnected components even when the other families fit.\n'
        '      const budget=this.#solveBatchLimit;')
    expected = expected.replace("  const {mode='dense',solveBatchLimit=16,...geometry}=options;",
        '  // Thirty-two is an attempt budget, not a simulation horizon. Indirect work\n'
        '  // stops at the exact fixed point; exhaustion still runs general convergence.\n'
        "  const {mode='dense',solveBatchLimit=32,...geometry}=options;")
    assert (ROOT/path).read_text() == expected, 'Unexpected runtime change'
    allowed = {path, 'engine/experimental/structural-probe.ts'}
    changed = subprocess.check_output(['git', 'diff', '--name-only', REVISION, '--', 'engine'], cwd=ROOT, text=True).splitlines()
    assert set(changed) <= allowed, changed
    additions = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '--', 'engine'], cwd=ROOT, text=True).splitlines()
    assert set(additions) <= allowed, additions
    for path, expected in spec['unchangedSourceHashes'].items():
        assert sha((ROOT/path).read_bytes()) == sha(baseline(path)) == expected, path
    records = {r['id']: r for r in read(BASE/'development/index.json')['records']}
    required = {'cpu-unit', 'review-unit', 'typecheck', 'declarations', 'lint', 'gpu-build', 'probe-build',
                'seams-active', 'seams-dense', 'gpu-fallback', 'gpu-order', 'gpu-tiny', 'gpu-active-tiny'}
    assert set(spec['receipts']) == required
    results = {}
    for label, name in spec['receipts'].items():
        record = records[name]
        directory = ROOT/record['archivedDirectory']
        for path, expected in record['files'].items():
            assert sha((directory/path).read_bytes()) == expected, f'{name}/{path}'
        receipt, supervisor = read(directory/'report.json'), read(directory/'supervisor/report.json')
        stage = 'gpu-seams' if label.startswith('seams-') else label
        assert receipt['stage'] == record['stage'] == stage
        assert receipt['passed'] and receipt['sourceUnchanged'] and receipt['holdRemainsActive']
        assert supervisor['passed'] and supervisor['exitCode'] == 0 and supervisor['containment'] == 'Windows job'
        assert supervisor['timeoutSeconds'] <= 60 and supervisor['stallSeconds'] <= 15
        assert supervisor['kind'] == ('gpu' if stage in ('gpu-seams', 'gpu-fallback', 'gpu-order', 'gpu-tiny', 'gpu-active-tiny') else 'cpu')
        for path, expected in receipt['sourceHashes'].items():
            relevant = path.startswith(('engine/', 'dist/sdk/', 'examples/structural-cavern/')) and path.endswith(('.ts', '.js', '.html', '.css'))
            if relevant or path in ('dist/volume-m5/structural-probe.js', 'web/frame-pump.js', 'web/frame-clock.js'):
                assert sha((ROOT/path).read_bytes()) == expected, f'{label}: {path}'
        if supervisor['kind'] == 'gpu':
            evidence = read(directory/'evidence/report.json')
            assert evidence['passed'] and evidence['result']['passed'] and not evidence['errors']
            result = evidence['result']
            assert result['backendInfo']['isFallbackAdapter'] is False
            results[label] = result
    labels = ('seams-active', 'seams-dense', 'gpu-fallback', 'gpu-order')
    for label in labels:
        result = results[label]
        assert {r['axis'] for r in result['results']} == {'x', 'y', 'z'}
        for row in result['results']:
            assert row['ticks'] == 24 and row['restart'] == 3 and row['exact']
            assert row['fellAt'] == 13 and row['reuseCount'] > 0
            assert row['unbondedContactStack'] == (row['axis'] == 'y')
            if label in ('gpu-fallback', 'gpu-order'):
                assert row['fallbackCount'] > 0
            else:
                assert row['fallbackCount'] == 0
        # Chunk partition, execution order, and budget cannot alter final bytes.
        assert [r['finalHash'] for r in result['results']] == [r['finalHash'] for r in results['seams-active']['results']]
    assert json.loads((ROOT/'dist/verification/safety-hold.json').read_text())['status'] == 'suspended'
    assert (ROOT/'scripts/verify_checks.mjs').read_bytes() == baseline('scripts/verify_checks.mjs')
    print(json.dumps({'passed': True, 'scope': 'Bounded exact regression checks only',
        'baselineRevision': REVISION, 'receipts': spec['receipts'],
        'physicsKernelsUnchanged': True, 'legacyDemosQuarantined': True, 'incidentHoldActive': True,
        'performanceStatus': 'deferred-by-user', 'performancePassed': None,
        'pending': ['32/64 full trajectory and odd-restart checks', '128 scale pilot', '32/64/128 full gameplay benchmarks']}, indent=2))


if __name__ == '__main__':
    main()
