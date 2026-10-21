"""Retain existing receipts and portable fixtures; never executes simulation."""
import gzip
import hashlib
import json
from pathlib import Path
import shutil
from scripts.verification_guard import ROOT


def main():
    out = ROOT / 'docs/checkpoints/volume-m4'
    out.mkdir(parents=True, exist_ok=True)
    base = ROOT / 'dist/volume-m4/recovery'
    manifest = {'format': 1, 'files': {}, 'frames': {}, 'referenceInputHashesMatch': True,
                'targetedGatesPassed': True, 'failedStages': [],
                'legacyDemoReleaseGate': 'quarantined; not passed by the recovery suite'}

    def retain(source, relative, compress=False):
        source = ROOT / source
        data = source.read_bytes()
        destination = out / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        payload = gzip.compress(data, compresslevel=1, mtime=0) if compress else data
        destination.write_bytes(payload)
        manifest['files'][relative] = {'source': source.relative_to(ROOT).as_posix(),
            'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload),
            **({'uncompressedSha256': hashlib.sha256(data).hexdigest()} if compress else {})}
        return destination

    reference = json.loads((ROOT / 'dist/volume-m4/node128/report.json').read_text(encoding='utf-8'))
    if not reference.get('passed') or not reference.get('sourceUnchanged'):
        raise ValueError('Dense CPU reference did not pass.')
    for name, expected in reference['referenceInputHashes'].items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
            raise ValueError('CPU reference input changed: ' + name)
    retain('dist/volume-m4/node128/latency-baseline-report.json', 'history/node-before-latency.json')
    retain('dist/volume-m4/latency-game-before.js', 'history/game-before-latency.js')
    retain('dist/volume-m4/node128/report.json', 'reference/node-original.json')
    portable = json.loads(json.dumps(reference))
    portable['originalReportSha256'] = hashlib.sha256((ROOT / 'dist/volume-m4/node128/report.json').read_bytes()).hexdigest()
    for name, fixture in portable['fixtures'].items():
        source = ROOT / fixture['path']
        data = source.read_bytes()
        if hashlib.sha256(data).hexdigest() != fixture['compressedSha256'] or hashlib.sha256(gzip.decompress(data)).hexdigest() != fixture['sha256']:
            raise ValueError('CPU fixture changed: ' + name)
        destination = retain(fixture['path'], 'reference/' + source.name)
        fixture['path'] = destination.relative_to(ROOT).as_posix()
    (out / 'reference/node.json').write_text(json.dumps(portable, indent=2) + '\n', encoding='utf-8')
    data = (out / 'reference/node.json').read_bytes()
    manifest['files']['reference/node.json'] = {'derivedFrom': 'reference/node-original.json',
        'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
    for source in sorted((out / 'safety').glob('*')):
        if source.is_file():
            retain(source.relative_to(ROOT), 'safety/' + source.name)
    for stage in ('gate64', 'continuation128', 'replay128'):
        original = f'dist/volume-m4/{stage}/report.json'
        record_path = base / (stage + '.json')
        if stage != 'replay128' and record_path.exists():
            record = json.loads(record_path.read_text(encoding='utf-8'))
            if not record['passed']:
                raise ValueError('Fresh exactness gate did not pass: ' + stage)
            retain(original, f'history/{stage}-initial.json.gz', True)
            retain(record['evidence'], f'{stage}.json.gz', True)
        else:
            retain(original, f'{stage}.json.gz', True)
    for stage in ('gameplay-probe', 'gameplay128', 'frames128gpu', 'timing128gpu', 'ui-gpu', 'cpu-smoke', 'cpu-reference', 'receipt-tests', 'unit', 'probe', 'gate64', 'continuation128', 'frames32', 'frames64', 'frames128', 'timing128', 'ui', 'lint', 'typecheck', 'build', 'sdk'):
        record = json.loads((base / (stage + '.json')).read_text(encoding='utf-8'))
        if not record['passed']:
            # Retaining a complete timing failure is evidence, not qualification.
            # Unsafe, incomplete or inexact runs still cannot supply current results.
            failed = json.loads((ROOT / record['evidence']).read_text(encoding='utf-8')) if record.get('evidence') else {}
            supervisor = json.loads((ROOT / record['supervisor']).read_text(encoding='utf-8'))
            if not stage.startswith('frames') or not failed.get('passed') or not supervisor.get('passed'):
                raise ValueError('Recovery stage did not complete safely and exactly: ' + stage)
            manifest['targetedGatesPassed'] = False
            manifest['failedStages'].append(stage)
        retain((base / (stage + '.json')).relative_to(ROOT), f'recovery/{stage}.json')
        if stage in ('gameplay-probe', 'gameplay128', 'frames128gpu', 'timing128gpu', 'probe', 'gate64', 'continuation128', 'frames32', 'frames64', 'frames128', 'timing128'):
            proof = json.loads((ROOT / record['evidence']).read_text(encoding='utf-8'))
            for path in ('engine/experimental/gameplay-gpu.ts','engine/experimental/gameplay-shader.ts','engine/experimental/gameplay-view.ts','engine/experimental/volume/world-renderer.ts','engine/experimental/volume/3d-gpu-core.ts', 'engine/experimental/volume/3d-shader.ts',
                         'engine/experimental/volume/active-shader.ts', 'dist/sdk/state-space-3d-gpu.js',
                         'dist/sdk/state-space-world-gpu.js', 'dist/sdk/state-space-active-world-gpu.js'):
                if proof['sourceHashes'].get(path) != hashlib.sha256((ROOT / path).read_bytes()).hexdigest():
                    raise ValueError(f'Stale GPU kernel proof: {stage}: {path}')
        if stage.startswith('frames'):
            evidence = json.loads((ROOT / record['evidence']).read_text(encoding='utf-8'))
            frame = evidence['result']
            manifest['frames'][stage] = {k: frame.get(k) for k in ('dimensions', 'resolution', 'userAgent',
                'backendInfo', 'physicsHz', 'callbackHz', 'completion', 'missedDeadlines', 'lostDisplaySlots',
                'performancePassed', 'gameplayBackend', 'sub8msTargetPassed', 'framesAtOrAbove8ms', 'energyBalance', 'nodeExact', 'initialHash', 'finalHash', 'activeGameplay')}
        if stage == 'sdk':
            sdk = json.loads((ROOT / record['evidence']).read_text(encoding='utf-8'))
            for name, expected in sdk['immutableArtifacts'].items():
                if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
                    raise ValueError('SDK artifact changed.')
                retain(name, 'packages/' + Path(name).name)
    # Keep failed attempts alongside successful runs, without rewriting receipts.
    for report in sorted(base.glob('*/supervisor/report.json')):
        r = json.loads(report.read_text(encoding='utf-8'))
        if not r.get('finishedAt'):
            continue
        run = report.parent.parent
        for source in sorted(run.rglob('*')):
            if not source.is_file() or source.suffix == '.tmp':
                continue
            relative = 'recovery/runs/' + run.name + '/' + source.relative_to(run).as_posix()
            compress = source.parent.name == 'evidence' and source.name in ('report.json', 'chrome-trace.json')
            retain(source.relative_to(ROOT), relative + ('.gz' if compress else ''), compress)
    ui = json.loads((base / 'ui.json').read_text(encoding='utf-8'))
    retain((Path(ui['evidence']).parent / 'cavern.png'), 'cavern.png')
    baseline_path = out / 'recovery/runs/frames128-b6a652dd/evidence/report.json.gz'
    if baseline_path.exists():
        before = json.loads(gzip.decompress(baseline_path.read_bytes()))
        record = json.loads((base / 'frames128.json').read_text(encoding='utf-8'))
        after = json.loads((ROOT / record['evidence']).read_text(encoding='utf-8'))
        keys = ('completion', 'physicsAndQuery', 'renderAndHud', 'physicsHz', 'missedDeadlines',
                'lostDisplaySlots', 'performancePassed', 'initialHash', 'finalHash', 'nodeExact')
        comparison = {'before': {k: before['result'].get(k) for k in keys},
                      'after': {k: after['result'].get(k) for k in keys},
                      'beforeReport': baseline_path.relative_to(ROOT).as_posix(),
                      'afterReport': f'docs/checkpoints/volume-m4/recovery/runs/{Path(record["evidence"]).parent.parent.name}/evidence/report.json.gz',
                      'endpointHashesIdentical': all(before['result'][k] == after['result'][k] for k in ('initialHash', 'finalHash')),
                      'timingIncludesFinalHudUpdates': True,
                      'startupBefore': before['result']['samples'][:2],
                      'startupAfter': after['result']['samples'][:2],
                      'referenceRuleSourcesUnchanged': {p: before['sourceHashes'][p] == hashlib.sha256((ROOT / p).read_bytes()).hexdigest()
                         for p in ('engine/experimental/3d-core.ts',
                                   'examples/active-cavern/scene.js')},
                      'gpuKernelOptimization': {
                         'beforeShaderSha256': before['sourceHashes']['engine/experimental/volume/3d-shader.ts'],
                         'afterShaderSha256': hashlib.sha256((ROOT / 'engine/experimental/volume/3d-shader.ts').read_bytes()).hexdigest(),
                         'proofs': ['recovery/probe.json', 'gate64.json.gz', 'continuation128.json.gz'],
                         'currentKernelHashesVerified': True},
                      'gameSetupRefactor': {'changedInputs': reference.get('changedInputs'),
                         'cpuFullReplayExact': reference['game']['cpuGpuExact'],
                         'reference': 'docs/checkpoints/volume-m4/reference/node.json'}}
        if not comparison['endpointHashesIdentical'] or not all(comparison['referenceRuleSourcesUnchanged'].values()):
            raise ValueError('Frame spike work changed the reference state or physical rules.')
        data = (json.dumps(comparison, indent=2) + '\n').encode('utf-8')
        (out / 'frame-spikes.json').write_bytes(data)
        manifest['files']['frame-spikes.json'] = {'derivedFrom': [comparison['beforeReport'], comparison['afterReport']],
            'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
    latency = {'defaultMode': 'CPU stage timings; GPU timing opt-in', 'worlds': {},
               'note': 'Separate sequential runs, not a controlled causal estimate of cleanup or instrumentation overhead. All retained attempts remain available.'}
    baselines = {32: 'frames32-d702c38c', 64: 'frames64-e10f588c', 128: 'frames128-4c4bfae8'}
    gpu_runs = {32: 'frames32-6e6b74c3', 64: 'frames64-235fd74d', 128: 'frames128-ccca2fa6'}
    prior_runs = {32: 'frames32-65bd9adc', 64: 'frames64-bb104c49', 128: 'frames128-5e944182'}
    before_kernel = {32: 'frames32-26ca7823', 64: 'frames64-1849068a', 128: 'frames128-1ed02ba6'}
    pass_specialization = {32: 'frames32-5ad7f164', 64: 'frames64-07feab35', 128: 'frames128-e362e1f2'}
    for size in (32, 64, 128):
        stage = 'frames' + str(size)
        record = json.loads((base / (stage + '.json')).read_text(encoding='utf-8'))
        current = json.loads((ROOT / record['evidence']).read_text(encoding='utf-8'))
        row = {'summary': current['latencySummary'], 'attempts': {}}
        attempts=[('baseline',baselines[size]),('gpuDiagnostic',gpu_runs[size]),('previousLatency',prior_runs[size])]
        if size==128: attempts += [('plannerOnly','frames128-2c8a36d9'),('fixedSolids','frames128-a11b1766'),('httpObserver','frames128-da189aec'),('gpuClears','frames128-714f66cc'),('gcDiagnostic','diagnostic128-9af7f613')]
        attempts.append(('beforeKernelOptimization',before_kernel[size]))
        attempts.append(('passSpecializationReverted',pass_specialization[size]))
        if size==128:
            timing = json.loads((base / 'timing128.json').read_text(encoding='utf-8'))
            attempts.extend([('beforeKernelGpuTiming','diagnostic128-120008c5'),('kernelGpuTiming',Path(timing['evidence']).parent.parent.name)])
        attempts.append(('current',Path(record['evidence']).parent.parent.name))
        for label, run in attempts:
            path = out / 'recovery/runs' / run / 'evidence/report.json.gz'
            receipt = json.loads(gzip.decompress(path.read_bytes()))
            value = receipt['result']
            row['attempts'][label] = {'report': path.relative_to(ROOT).as_posix(),
                **{k: value.get(k) for k in ('completion', 'physicsAndQuery', 'renderAndHud', 'physicsHz', 'missedDeadlines', 'performancePassed', 'nodeExact', 'initialHash', 'finalHash')},
                'latencySummary': receipt.get('latencySummary')}
        if any(row['attempts'][label][key] != row['attempts']['current'][key]
               for label in row['attempts'] for key in ('initialHash', 'finalHash')):
            raise ValueError('Latency follow-up changed a reference endpoint.')
        latency['worlds'][str(size)] = row
    payload = (json.dumps(latency, indent=2) + '\n').encode('utf-8')
    (out / 'latency.json').write_bytes(payload)
    manifest['files']['latency.json'] = {'derivedFrom': [a['report'] for w in latency['worlds'].values() for a in w['attempts'].values()],
        'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)}
    resident={'scope':'Sequential full-frame runs on identical CPU fixtures; all attempts retained.', 'modes':{}}
    for mode,stage in [('cpu','frames128'),('gpu','frames128gpu'),('gpuDiagnostic','timing128gpu')]:
        record=json.loads((base/(stage+'.json')).read_text(encoding='utf-8'))
        proof=json.loads((ROOT/record['evidence']).read_text(encoding='utf-8'));value=proof['result']
        resident['modes'][mode]={'report':f'docs/checkpoints/volume-m4/recovery/runs/{Path(record["evidence"]).parent.parent.name}/evidence/report.json.gz',
            **{k:value.get(k) for k in ('completion','physicsHz','missedDeadlines','lostDisplaySlots','performancePassed','sub8msTargetPassed','framesAtOrAbove8ms','nodeExact','initialHash','finalHash')},'latencySummary':proof['latencySummary']}
    manifest['residentSub8msGoal']={'metric':'full-frame completion p95 < 8 ms','met':resident['modes']['gpu']['sub8msTargetPassed'],'measuredP95Ms':resident['modes']['gpu']['completion']['p95']}
    resident['endpointsIdentical']=all(v[k]==resident['modes']['cpu'][k] for v in resident['modes'].values() for k in ('initialHash','finalHash'))
    if not resident['endpointsIdentical']:raise ValueError('Resident gameplay changed reference endpoints.')
    data=(json.dumps(resident,indent=2)+'\n').encode('utf-8');(out/'resident-gameplay.json').write_bytes(data)
    manifest['files']['resident-gameplay.json']={'derivedFrom':[v['report'] for v in resident['modes'].values()], 'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
    # Retain the unsuccessful certificate experiment and the original source,
    # alongside the qualifying scheduler result. Never replace an earlier run.
    sub8={'scope':'600 complete 1080p display-paced frames per sequential run; identical CPU fixtures.',
          'optimization':'One canonical planner dispatch per tick; append uniquely awakened tiles between immutable pass prefixes.',
          'attempts':{},'sources':[]}
    for name,frame_run,timing_run in [
        ('before','frames128gpu-f7cd8375','timing128gpu-2eee17cc'),
        ('fixedTileReductionReverted','frames128gpu-cd3373af','timing128gpu-265e29ae'),
        ('appendScheduler',Path(json.loads((base/'frames128gpu.json').read_text(encoding='utf-8'))['evidence']).parent.parent.name,
          Path(json.loads((base/'timing128gpu.json').read_text(encoding='utf-8'))['evidence']).parent.parent.name)]:
        row={}
        for label,run in [('fullFrame',frame_run),('gpuDiagnostic',timing_run)]:
            path=out/'recovery/runs'/run/'evidence/report.json.gz';proof=json.loads(gzip.decompress(path.read_bytes()));v=proof['result']
            if any(v[k]!=resident['modes']['gpu'][k] for k in ('initialHash','finalHash')) or not v['nodeExact']:
                raise ValueError('Sub-8 comparison changed a reference endpoint.')
            row[label]={'report':path.relative_to(ROOT).as_posix(),
                **{k:v.get(k) for k in ('completion','physicsHz','missedDeadlines','lostDisplaySlots','sub8msTargetPassed','framesAtOrAbove8ms','nodeExact')},
                'latencySummary':proof['latencySummary']}
        sub8['attempts'][name]=row
    for source in sorted((ROOT/'dist/volume-m4/latency-sub8').glob('*.ts')):
        destination=retain(source.relative_to(ROOT),'history/sub8/'+source.name)
        sub8['sources'].append(destination.relative_to(ROOT).as_posix())
    data=(json.dumps(sub8,indent=2)+'\n').encode('utf-8');(out/'sub8-latency.json').write_bytes(data)
    manifest['files']['sub8-latency.json']={'derivedFrom':[v['report'] for r in sub8['attempts'].values() for v in r.values()],
        'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
    ui_gpu=json.loads((base/'ui-gpu.json').read_text(encoding='utf-8'));retain(Path(ui_gpu['evidence']).parent/'cavern.png','resident-gameplay.png')
    files = list((ROOT / 'engine/experimental').glob('*.ts'))
    files += list((ROOT / 'examples/active-cavern').glob('*'))
    files += [ROOT / p for p in ('scripts/verification_guard.py', 'scripts/verification_health.py',
              'scripts/verification_guard.mjs', 'scripts/verify_checks.mjs', 'scripts/recover_m4_verification.py',
              'scripts/verify_volume_m4.mjs', 'scripts/verify_volume_m4_browser.py', 'scripts/verify_active_cavern_ui.py',
              'scripts/volume_latency_report.py', 'tests/test_volume_latency_report.py', 'scripts/verify_sdk.py', 'scripts/publish_volume_m4.py', 'tests/test_verification_guard.py',
              'engine/verify.py', 'engine/vitest.cpu.config.ts', 'web/rendering.test.mjs', 'web/demo-trajectory.test.mjs', 'package.json')]
    files += list((ROOT / 'dist/sdk').glob('*.js'))
    files += list((ROOT / 'web').glob('frame-*.js'))
    files += [ROOT / 'examples' / name / 'app.js' for name in ('first-person', 'cavern')]
    manifest['currentSourceHashes'] = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                                       for p in sorted(files) if p.is_file()}
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'Retained {len(manifest["files"])} evidence files; CPU inputs and all fixture hashes match.')


if __name__ == '__main__':
    main()
