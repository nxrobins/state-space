"""Validate the PR22 repair receipts and their relationship to retained M5 evidence.

Metadata only. Original trajectory/frame receipts remain bound to their original
revision. A narrow source comparison proves the material/structural tick path is
unchanged; new bounded regressions cover the repaired gameplay/client behavior.
"""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT/'docs/checkpoints/volume-m5'
BASELINE = '2f974b69408e7669857a9070fcc51743df46c1ad'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def baseline(path):
    return subprocess.check_output(['git', 'show', f'{BASELINE}:{path}'], cwd=ROOT)


def audit_review():
    spec = json.loads((BASE/'review-fixes/manifest.json').read_text())
    assert spec['baselineRevision'] == BASELINE
    changes = spec['runtimeChanges']
    assert set(changes) == {'engine/experimental/structural-world-gpu.ts', 'examples/structural-cavern/app.js', 'dist/sdk/state-space-structural-world-gpu.js'}
    for path, item in changes.items():
        before = gzip.decompress((BASE/'review-fixes/baseline-structural-world-gpu.js.gz').read_bytes()) if path.startswith('dist/') else baseline(path)
        assert sha(before) == item['beforeSHA256'] and sha((ROOT/path).read_bytes()) == item['afterSHA256'], path

    # The only GPU-world change is M5 goal bookkeeping after decoding. Reject
    # any other host scheduling, solver, shader, thermal, movement or edit change.
    gpu_path = 'engine/experimental/structural-world-gpu.ts'
    current = (ROOT/gpu_path).read_text()
    current = current.replace("import { commitStructuralGoal } from './structural-gameplay.js';\n", '')
    current = current.replace('const result=resources.decode(rows[command?1:0],c.tick),decoded=command?commitStructuralGoal(result,checkedRules):result,submissions=this.#submissions-start;',
                              'const decoded=resources.decode(rows[command?1:0],c.tick),submissions=this.#submissions-start;')
    assert current == baseline(gpu_path).decode().replace('\r\n', '\n'), 'Unexpected GPU tick-path change'
    changed = subprocess.check_output(['git', 'diff', '--name-only', BASELINE, '--', 'engine'], cwd=ROOT, text=True).splitlines()
    allowed = {gpu_path, 'engine/lint_ts.mjs', 'engine/experimental/structural-gameplay.ts',
               'engine/experimental/structural-gameplay.test.ts', 'engine/experimental/structural-client.test.ts'}
    assert set(changed) <= allowed, changed
    # Also cover files added after this audit is first run, before commit.
    additions = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '--', 'engine'], cwd=ROOT, text=True).splitlines()
    assert set(additions) <= allowed, additions
    for path in spec['physicsSourceHashes']:
        assert sha((ROOT/path).read_bytes()) == sha(baseline(path)) == spec['physicsSourceHashes'][path], path

    records = {r['id']: r for r in json.loads((BASE/'development/index.json').read_text())['records']}
    required = {'review-unit', 'review-gpu', 'cpu-unit', 'typecheck', 'declarations', 'lint', 'gpu-build'}
    assert set(spec['receipts']) == required
    checked = {}
    for stage, name in spec['receipts'].items():
        record = records[name]
        directory = ROOT/record['archivedDirectory']
        for path, expected in record['files'].items():
            assert sha((directory/path).read_bytes()) == expected, f'{name}/{path}'
        receipt = json.loads((directory/'report.json').read_text())
        supervisor = json.loads((directory/'supervisor/report.json').read_text())
        assert receipt['stage'] == stage and receipt['passed'] and receipt['sourceUnchanged']
        assert supervisor['passed'] and supervisor['exitCode'] == 0 and supervisor['containment'] == 'Windows job'
        assert supervisor['timeoutSeconds'] <= 60 and supervisor['stallSeconds'] <= 15
        assert supervisor['kind'] == ('gpu' if stage == 'review-gpu' else 'cpu')
        for path, expected in receipt['sourceHashes'].items():
            # Runtime sources, tests and probe modules are current; descriptions
            # and metadata audit code do not participate in the timed workload.
            relevant = path.startswith(('engine/', 'dist/sdk/', 'examples/structural-cavern/')) and path.endswith(('.ts', '.js', '.html', '.css'))
            if relevant or path in ('web/frame-pump.js', 'web/frame-clock.js') or (stage == 'review-unit' and path == 'examples/structural-cavern/README.md'):
                assert sha((ROOT/path).read_bytes()) == expected, f'{stage}: {path}'
        if stage == 'review-gpu':
            result = json.loads((directory/'evidence/report.json').read_text())
            assert result['passed'] and result['result']['passed'] and not result['errors']
            assert result['result']['backendInfo']['isFallbackAdapter'] is False
            rows = result['result']['results']
            assert {row['mode'] for row in rows} == {'dense', 'active'}
            for row in rows:
                assert row['ticks'] == 8 and row['crossedAt'] == 4 and row['restart'] == 3 and row['energyDriftQ'] == '0'
                assert all(row[k] for k in ('physicsExact', 'actorEventsExact', 'presentationIsolated', 'goalBounds', 'lossPreserved'))
            assert rows[0]['stateDigests'] == rows[1]['stateDigests']
        checked[stage] = {'id': name, 'receiptSHA256': sha((directory/'report.json').read_bytes())}
    assert json.loads((ROOT/'dist/verification/safety-hold.json').read_text())['status'] == 'suspended'
    assert (ROOT/'scripts/verify_checks.mjs').read_bytes() == baseline('scripts/verify_checks.mjs')
    return {**spec, 'passed': True, 'checkedReceipts': checked, 'physicsTickPathUnchanged': True,
            'legacyDemosQuarantined': True, 'incidentHoldActive': True,
            'frameEvidenceScope': 'Retained measurements at baselineRevision; no post-repair frame benchmark claimed'}


if __name__ == '__main__':
    print(json.dumps(audit_review(), indent=2))
