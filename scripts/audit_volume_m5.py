"""Audit retained M5 evidence and source bindings. No simulation or GPU workload."""
import base64
import gzip
import hashlib
import json
import math
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / 'docs/checkpoints/volume-m5'
# Keep the compatibility reference fixed when M5 itself is committed or merged.
LEGACY_BASELINE = '56ef91286fff4c4bca1920fead59ca7789aaafd8'
MATRIX = {
    'control': ('e8973b8a', '067be455', '3c4520f6', '43b00cfe'),
    'cut': ('f57d0aca', '0d075690', '36cf5380', 'c56d90e4'),
    'heat': ('63bd7838', '739479de', '001c3133', 'afdb3a74'),
    'ice-control': ('723ad9bf', 'b58c69ce', 'a799bae1', 'c2516023'),
    'ice-heat': ('42c448a0', '23f14995', '74e69658', '851f729d'),
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf8'))


def main():
    records = {r['id']: r for r in read(BASE/'development/index.json')['records']}
    selected = {}
    report = {'passed': False, 'scope': 'M5 release criteria, retained evidence and current source audit; no new workload',
              'matrix': [], 'frames': [], 'requirements': [], 'receipts': selected}

    def receipt(name, cpu=False):
        record = records[name]
        directory = ROOT/record['archivedDirectory']
        for path, expected in record['files'].items():
            assert sha((directory/path).read_bytes()) == expected, f'Archive differs: {name}/{path}'
        r = read(directory/'report.json')
        supervisor = read(directory/'supervisor/report.json')
        assert r['passed'] and r['sourceUnchanged'] and supervisor['passed'] and supervisor['exitCode'] == 0, name
        assert supervisor['containment'] == 'Windows job' and supervisor['timeoutSeconds'] <= 120 and supervisor['stallSeconds'] <= 15
        # CPU reference validity is tied to its complete public bundle. GPU
        # evidence additionally binds every production TS source and SDK bundle.
        names = ['dist/sdk/state-space-structural-world.js', 'examples/structural-cavern/scene.js', 'examples/structural-cavern/state-evidence.js'] if cpu else [p for p in r['sourceHashes']
            if p.startswith('engine/') and p.endswith('.ts') and not p.endswith(('.test.ts', 'structural-probe.ts')) or p.startswith('dist/sdk/')]
        if not cpu:
            names += [p for p in r['sourceHashes'] if p in ('examples/structural-cavern/app.js', 'examples/structural-cavern/scene.js',
                'examples/structural-cavern/state-evidence.js', 'examples/structural-cavern/index.html', 'examples/structural-cavern/style.css', 'web/frame-pump.js', 'web/frame-clock.js')]
        if name.startswith(('gpu-tiny-', 'gpu-active-tiny-', 'gpu-order-', 'gpu-fallback-')):
            names += ['engine/experimental/structural-probe.ts', 'dist/volume-m5/structural-probe.js']
        for path in names:
            assert sha((ROOT/path).read_bytes()) == r['sourceHashes'][path], f'Runtime changed: {name}/{path}'
        selected[name] = {'directory': record['archivedDirectory'], 'receiptSHA256': sha((directory/'report.json').read_bytes()),
                          'evidenceSHA256': record['files'].get('evidence/report.json'), 'runtimeBindingsChecked': names}
        evidence = read(directory/'evidence/report.json') if (directory/'evidence/report.json').exists() else None
        if evidence is not None:
            assert evidence['passed'], name
        return evidence, supervisor

    def trajectory(name, node, mode, part):
        evidence, _ = receipt(name)
        g = evidence['result']
        assert g['mode'] == mode and g['part'] == part and g['size'] == node['size'] and g['scenario'] == node['scenario']
        assert g['energyDriftQ'] == '0' and g['ticks'] == 1024
        ranges = [(0, 1024)] if part == 'main' else [(3, 31), (179, 183), (509, 1024)]
        if part == 'all':
            ranges = [(0, 1024), *ranges]
        expected = [(start, tick) for start, end in ranges for tick in range(start+1, end+1)]
        assert [(c['start'], c['tick']) for c in g['checks']] == expected
        assert [(r['start'], r['end']) for r in g['runs']] == ranges
        for c in g['checks']:
            assert c['digest'] == node['stateDigests'][c['tick']], f'{name}: tick {c["tick"]}'
        assert g['finalHash'] == node['stateDigests'][1024]
        assert g['chunkSize'] == (16 if mode == 'dense' else 8)

    try:
        for scene, (node_id, repeat_id, dense, active) in MATRIX.items():
            node, _ = receipt('level-pilot-'+node_id, cpu=True)
            repeat, _ = receipt('level-pilot-'+repeat_id, cpu=True)
            assert node['size'] == 32 and node['ticks'] == 1024 and node['energyDriftQ'] == '0'
            assert len(node['stateDigests']) == 1025 and node['stateDigests'] == repeat['stateDigests']
            assert node['fullDeckStableTicks'] == (1024 if scene.endswith('control') else 179)
            assert node['coherentFirstFallCells'] == (0 if scene.endswith('control') else 55)
            assert node['firstFall'] == (None if scene.endswith('control') else 181 if scene == 'ice-heat' else 180)
            if scene == 'ice-heat':
                assert node['supportMelt'] == 180
            for mode, suffix in [('dense', dense), ('active', active)]:
                trajectory('level-trajectory-'+suffix, node, mode, 'all')
            report['matrix'].append({'size': 32, 'scene': scene, 'cpu': node_id, 'repeat': repeat_id, 'dense': dense, 'active': active,
                'ticks': 1024, 'fullDeckStableTicks': node['fullDeckStableTicks'], 'firstFall': node['firstFall'],
                'coherentFirstFallCells': node['coherentFirstFallCells'], 'finalDigest': node['stateDigests'][-1]})
        node, _ = receipt('level-pilot-b35044a7', cpu=True)
        assert node['segments'] == [{'start': i, 'end': i+256, 'energyDriftQ': '0'} for i in range(0, 1024, 256)]
        for mode, main_id, restart_id in [('dense', 'e8c9e8b4', '36877e9a'), ('active', '7865a13e', '556beba8')]:
            trajectory('level-trajectory-'+main_id, node, mode, 'main')
            trajectory('level-trajectory-'+restart_id, node, mode, 'restarts')
        report['matrix'].append({'size': 64, 'scene': 'ice-heat', 'cpu': 'b35044a7', 'cpuSegments': node['segments'],
            'dense': ['e8c9e8b4', '36877e9a'], 'active': ['7865a13e', '556beba8'], 'ticks': 1024, 'finalDigest': node['stateDigests'][-1]})

        for name in ['gpu-tiny-24cd6618', 'gpu-active-tiny-b1f11c7d']:
            evidence, _ = receipt(name)
            assert evidence['result']['atomicEdits'] and evidence['result']['rootPredicateCacheExact']
            assert any(r['scene'] == 'overload' and r['exact'] and r['restart'] == 3 for r in evidence['result']['results'])
        for name in ['gpu-fallback-780647fb', 'gpu-order-fe622442']:
            evidence, _ = receipt(name)
            assert {r['axis'] for r in evidence['result']['results']} == {'x', 'z'}
            assert all(r['chunksAlongBeam'] == 8 and r['fallbackCount'] > 0 and r['exact'] and r['fellAt'] == 13 for r in evidence['result']['results'])
        assert evidence['result']['mechanicsPermutations'] >= 28 and evidence['result']['listPermutations'] == 4
        gameplay, _ = receipt('gameplay-pilot-f4c72694')
        assert all(gameplay['result'][key] for key in ['physicsExact', 'actorRestartExact', 'presentationIsolated'])
        receipt('ui-pilot-95e11ee6')

        fix = read(BASE/'frame-reporting-fix.json')
        before = gzip.decompress((BASE/'benchmark-before-reporting-fix.js.gz').read_bytes())
        after = (ROOT/'examples/structural-cavern/benchmark.js').read_bytes()
        marker = fix['prefixEndsBefore'].encode()
        assert sha(before) == fix['beforeBenchmarkSHA256'] and sha(after) == fix['afterBenchmarkSHA256']
        assert before.split(marker)[0] == after.split(marker)[0] and sha(after.split(marker)[0]) == fix['unchangedTimedPrefixSHA256']
        for item in fix['records']:
            evidence, supervisor = receipt(item['id'])
            assert selected[item['id']]['evidenceSHA256'] == item['evidenceSHA256']
            f = evidence['result']
            assert supervisor['kind'] == 'frames' and supervisor['cpuLimitPercent'] is None
            assert f['complete'] and not f['cancelled'] and len(f['warmup']) == 60 and len(f['samples']) == 600
            assert f['resolution'] == [1920, 1080] and f['appearance'] == 'naturalistic' and f['heatDistortion']
            assert f['energyBalance']['driftQ'] == '0' and f['finalTick'] == 660 and f['scenario'] == 'cut'
            assert sha(gzip.decompress(base64.b64decode(f['finalCheckpoint']['data']))) == f['finalHash']
            samples = f['samples']
            assert [s['tick'] for s in samples] == list(range(61, 661))
            assert samples[119]['editCount'] == 10 and samples[118]['player']['grounded'] and not samples[119]['player']['grounded']
            lost = sum(max(0, math.floor((b['timestamp']-a['timestamp'])/(1000/60)+.5)-1) for a, b in zip(samples, samples[1:]))
            misses = sum(s['completionMs'] > 1000/60 for s in samples)
            assert lost == item['lostDisplaySlots'] and misses == f['missedDeadlines']
            durations = sorted(s['completionMs'] for s in samples)
            assert all(f['completion'][key] == durations[math.ceil(len(durations)*p)-1] for key, p in [('p50', .5), ('p95', .95), ('p99', .99), ('worst', 1)])
            assert math.isclose(f['physicsHz'], 599000/(samples[-1]['completedAt']-samples[0]['completedAt']))
            if f['size'] <= 64:
                assert f['physicsHz'] >= 59.9 and misses == lost == f['measuredPump']['coalesced'] == 0 and f['performancePassed']
            report['frames'].append({'size': f['size'], 'receipt': item['id'], 'physicsHz': f['physicsHz'],
                'completion': f['completion'], 'missedDeadlines': misses, 'lostDisplaySlots': lost, 'required60Hz': f['size'] <= 64})

        required_tests = {'contracts', 'cpu_physics', 'fidelity', 'mutations', 'pressure', 'structure_compiled', 'structure_public', 'validation',
                          'experimental/3d', 'experimental/world', 'experimental/active-world', 'experimental/gameplay', 'experimental/latency'}
        tested = set()
        for name in records:
            if not name.startswith('compatibility-unit-') or not records[name]['passed']:
                continue
            _, supervisor = receipt(name)
            match = next(a for a in supervisor['command'] if a.startswith('engine/') and a.endswith('.test.ts'))
            tested.add(match[len('engine/'):-len('.test.ts')])
        assert tested == required_tests
        for name in ['cpu-unit-7ea676fe', 'declarations-5a3e603a', 'typecheck-44a78015', 'lint-78dc5f64', 'build-2e603f41', 'gpu-build-0b48ce18']:
            receipt(name)
        built = set()
        for name in records:
            if name.startswith('sdk-build-') and records[name]['passed']:
                _, supervisor = receipt(name)
                built.add(supervisor['command'][-1])
        assert built == {f'engine/vite.{entry}.config.ts' for entry in ['sdk', 'volume', 'volume-gpu', 'world', 'world-gpu', 'active-world', 'active-world-gpu']}
        for value in read(ROOT/'package.json')['exports'].values():
            assert (ROOT/value['import']).is_file() and (ROOT/value['types']).is_file()
        changed = subprocess.check_output(['git', 'diff', '--no-renames', '--diff-filter=MDT', '--name-only', LEGACY_BASELINE, '--', 'engine'], cwd=ROOT, text=True).splitlines()
        assert set(changed) <= {'engine/lint_ts.mjs', 'engine/tsconfig.sdk.json'}, changed
        assert 'STATE_SPACE_RUN_LEGACY_DEMOS' in (ROOT/'scripts/verify_checks.mjs').read_text()
        hold = read(ROOT/'dist/verification/safety-hold.json')
        assert hold['status'] == 'suspended'
        report['legacyEngineRuntimeUnchangedFrom'] = LEGACY_BASELINE
        report['legacyDemosQuarantined'] = True
        report['incidentHoldActive'] = True
        report['requirements'] = [
            {'id': 1, 'passed': True, 'evidence': '16 structural unit tests; eight-chunk X/Z support redistribution; complete-state matrix'},
            {'id': 2, 'passed': True, 'evidence': 'CPU permutation, contact and boundary tests; CPU/dense/active overload; 55-cell coherent first-fall assertions'},
            {'id': 3, 'passed': True, 'evidence': '65-cell intact deck checks for 1024 ticks; cut/heat fall at 180; ice melts at 180 and falls at 181; current paused UI'},
            {'id': 4, 'passed': True, 'evidence': 'Five repeated 32-cubed Node trajectories and all GPU tick digests; 64-cubed uninterrupted GPU and odd-restart matrix'},
            {'id': 5, 'passed': True, 'evidence': 'Eight-chunk dependencies; reversed invocation ownership/worklists; partitions 8/16; presentation isolation; forced complete fallback'},
            {'id': 6, 'passed': True, 'evidence': 'Source-bound 60+600 full-frame cut trajectories at 1080p, 32/64 strict passes; 128 measurement reported without 60Hz gate'},
            {'id': 7, 'passed': True, 'evidence': 'Version/atomicity tests, 61 older-contract CPU tests, all SDK entries/types/lint, unchanged older runtime, bounded stage receipts and quarantine'},
        ]
        report['passed'] = True
    except Exception as error:
        report['error'] = repr(error)
        raise
    finally:
        report['auditSourceSHA256'] = sha(Path(__file__).read_bytes())
        (BASE/'release-audit.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf8')
    print(json.dumps({'passed': report['passed'], 'receipts': len(selected), 'requirements': len(report['requirements']), 'frames': report['frames']}))


if __name__ == '__main__':
    main()
