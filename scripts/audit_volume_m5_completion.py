"""Read-only audit of source-bound M5 replay and full-frame completion evidence."""
import base64
import gzip
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT/'docs/checkpoints/volume-m5'
BASELINE = '6938bc319150eb753f8aeb0abd5741d50102df38'


def read(path):
    return json.loads(path.read_text(encoding='utf8'))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    spec = read(BASE/'completion/manifest.json')
    assert spec['status'] == 'complete', f"M5 completion remains {spec['status']}"
    assert spec['baselineRevision'] == BASELINE
    records = {r['id']: r for r in read(BASE/'development/index.json')['records']}
    verified = {}

    def receipt(name, stage):
        record = records[name]
        directory = ROOT/record['archivedDirectory']
        for path, expected in record['files'].items():
            assert sha((directory/path).read_bytes()) == expected, f'{name}: {path}'
        r, s = read(directory/'report.json'), read(directory/'supervisor/report.json')
        assert r['stage'] == stage and r['passed'] and r['sourceUnchanged'] and r['holdRemainsActive']
        assert s['passed'] and s['exitCode'] == 0 and s['containment'] == 'Windows job'
        assert s['timeoutSeconds'] <= 120 and s['stallSeconds'] <= 15
        for path, expected in r['sourceHashes'].items():
            runtime = path.startswith(('engine/', 'dist/sdk/', 'examples/structural-cavern/')) and path.endswith(('.ts', '.js', '.html', '.css'))
            if runtime or path in ('dist/volume-m5/structural-probe.js', 'web/frame-pump.js', 'web/frame-clock.js', 'scripts/recover_m5_verification.py', 'scripts/verify_volume_m5_browser.py'):
                assert sha((ROOT/path).read_bytes()) == expected, f'{name}: stale {path}'
        verified[name] = sha((directory/'report.json').read_bytes())
        if not (directory/'evidence/report.json').exists():
            return None
        e = read(directory/'evidence/report.json')
        assert e['passed'] and e['result']['passed'] and not e['errors']
        assert e['result']['backendInfo']['isFallbackAdapter'] is False
        return e['result']

    for path, expected in spec['unchangedSourceHashes'].items():
        baseline = subprocess.check_output(['git', 'show', f'{BASELINE}:{path}'], cwd=ROOT)
        assert sha((ROOT/path).read_bytes()) == sha(baseline) == expected, path
    # The mechanical equations remain byte-for-byte the baseline template.
    # Only list construction, final membership counting, and a work flag change.
    shader_path = 'engine/experimental/structural/structural-shader.ts'
    before = subprocess.check_output(['git', 'show', f'{BASELINE}:{shader_path}'], cwd=ROOT).decode().replace('\r\n', '\n')
    after = (ROOT/shader_path).read_text()
    def mechanics(text):
        return text.split('  const mechanics=prefix+`\n', 1)[1].split('\n`;\n', 1)[0]
    expected = mechanics(before).replace(
        'solveDispatch[0]=(p.shape.w+63u)/64u;', 'solveDispatch[0]=select(0u,1u,atomicLoad(&work[13])!=0u);')
    expected = expected.replace('let s=nextStructures[i];\n',
        'let s=nextStructures[i];\n let wasIntact=(structures[i]&INTEGRITY)!=0u;let isIntact=(s&INTEGRITY)!=0u;\n'
        ' if(wasIntact!=isIntact){atomicAdd(&work[14],select(0xffffffffu,1u,isIntact));}\n')
    expected = expected.replace('planWrite(0u,i,d);planWrite(1u,i,0u);\n}',
        'planWrite(0u,i,d);planWrite(1u,i,0u);\n'
        ' // Every intact cell is appended exactly once. The list remains a superset\n'
        ' // after damage; removed cells are rejected by the unchanged stage predicates.\n'
        ' if(intact(i)){let ordinal=atomicAdd(&work[13],1u);planWrite(4u,ordinal,i);}\n}')
    assert mechanics(after) == expected, 'Mechanical equations changed'
    allowed = {shader_path, 'engine/experimental/structural-world-gpu.ts', 'engine/experimental/structural/structural-probe.ts'}
    changed = subprocess.check_output(['git', 'diff', '--name-only', BASELINE, '--', 'engine'], cwd=ROOT, text=True).splitlines()
    assert set(changed) <= allowed
    required = {'cpu-unit', 'review-unit', 'typecheck', 'declarations', 'lint', 'gpu-build', 'probe-build',
                'gpu-tiny', 'gpu-active-tiny', 'gpu-order', 'gpu-fallback', 'seams-dense', 'seams-active'}
    assert set(spec['checks']) == required
    for label, name in spec['checks'].items():
        result = receipt(name, 'gpu-seams' if label.startswith('seams-') else label)
        if label in ('gpu-tiny', 'gpu-active-tiny'):
            assert len(result['listCoverage']) == 2 and all(r['exact'] for r in result['listCoverage'])

    references = {}
    cpu_paths = ['engine/experimental/structural/structural-world-core.ts', 'engine/experimental/structural-mechanics.ts',
                 'engine/experimental/structural-material.ts', 'engine/thermal.ts', 'examples/structural-cavern/scene.js',
                 'examples/structural-cavern/state-evidence.js', 'dist/sdk/state-space-structural-world.js']
    for name in spec['references']:
        directory = ROOT/records[name]['archivedDirectory']
        r, e = read(directory/'report.json'), read(directory/'evidence/report.json')
        assert r['passed'] and e['passed'] and e['ticks'] == 1024 and len(e['stateDigests']) == 1025
        for path in cpu_paths:
            assert sha((ROOT/path).read_bytes()) == r['sourceHashes'][path], f'Stale CPU reference: {path}'
        references[e['size'], e['scenario']] = e
    seen = set()
    for name in spec['trajectories']:
        r = receipt(name, 'level-trajectory')
        key = r['size'], r['scenario'], r['mode'], r['part']
        assert key not in seen
        seen.add(key)
        ref = references[r['size'], r['scenario']]
        ranges = [[0, 1024]] if r['part'] == 'main' else [[3, 31], [179, 183], [509, 1024]]
        if r['part'] == 'all':
            ranges = [[0, 1024], *ranges]
        expected = [{'start': start, 'tick': tick, 'digest': ref['stateDigests'][tick]}
                    for start, end in ranges for tick in range(start + 1, end + 1)]
        assert r['checks'] == expected and r['energyDriftQ'] == '0'
        assert r['finalHash'] == ref['stateDigests'][1024]
    matrix = {(32, scene, mode, 'all') for scene in ('control', 'cut', 'heat', 'ice-control', 'ice-heat') for mode in ('dense', 'active')}
    matrix |= {(64, 'ice-heat', mode, part) for mode in ('dense', 'active') for part in ('main', 'restarts')}
    assert seen == matrix
    scale = receipt(spec['scale'], 'scale-pilot')
    assert scale['size'] == 128 and scale['scenario'] == 'cut' and len(scale['frames']) == 8 and scale['energyDriftQ'] == '0'

    results = []
    assert set(spec['frames']) == {'32', '64', '128'}
    for size, name in spec['frames'].items():
        r = receipt(name, 'frames')
        assert r['size'] == int(size) and r['scenario'] == 'cut' and r['execution'] == 'active'
        assert r['complete'] and not r['cancelled'] and r['finalTick'] == 660 and r['energyBalance']['driftQ'] == '0'
        assert r['resolution'] == r['viewport'] == [1920, 1080] and r['appearance'] == 'naturalistic' and r['heatDistortion'] is True
        assert len(r['warmup']) == 60 and len(r['samples']) == 600
        rows = r['samples']
        assert [row['tick'] for row in rows] == list(range(61, 661))
        missed = sum(row['completionMs'] > 1000/60 for row in rows)
        lost = sum(max(0, round((b['timestamp']-a['timestamp'])/(1000/60))-1) for a, b in zip(rows, rows[1:]))
        hz = 599000/(rows[-1]['completedAt']-rows[0]['completedAt'])
        assert missed == r['missedDeadlines'] and lost == r['lostDisplaySlots'] and abs(hz-r['physicsHz']) < 1e-8
        ordered = sorted(row['completionMs'] for row in rows)
        assert r['completion']['p95'] == ordered[569] and r['completion']['p99'] == ordered[593] and r['completion']['worst'] == ordered[-1]
        final = gzip.decompress(base64.b64decode(r['finalCheckpoint']['data']))
        assert sha(final) == r['finalHash'] == spec['baselineFinalHashes'][size]
        assert r['performancePassed'] and hz >= 59.9 and missed == lost == r['measuredPump']['coalesced'] == 0
        assert not any(row['solve'].get('fallbackMask') and not row['solve']['planReused'] for row in rows)
        results.append({'size': int(size), 'physicsHz': hz, 'completion': r['completion'], 'missedDeadlines': missed,
                        'lostDisplaySlots': lost, 'finalHash': r['finalHash'], 'exactBaselineCheckpoint': True})
    assert read(ROOT/'dist/verification/safety-hold.json')['status'] == 'suspended'
    print(json.dumps({'passed': True, 'scope': 'Source-bound exact replay and complete gameplay frames',
        'frames': results, 'trajectories': len(seen), 'receipts': verified,
        'legacyDemosQuarantined': True, 'incidentHoldActive': True}, indent=2))


if __name__ == '__main__':
    main()
