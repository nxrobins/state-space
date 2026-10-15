"""Validate and summarize retained timings. Pure receipt processing; no workloads."""
import math


def distribution(values):
    values = sorted(values)
    return {'count': len(values), 'median': values[len(values) // 2],
            'p95': values[math.ceil(len(values) * .95) - 1],
            'p99': values[math.ceil(len(values) * .99) - 1], 'max': values[-1]}


def summarize_latency(result):
    latency = result['latency']
    if not latency['enabled']:
        raise ValueError('Latency instrumentation was disabled.')
    records = latency['records']; samples = result['samples']
    if len(samples) != 600 or [r['tick'] for r in samples] != list(range(1, 601)):
        raise ValueError('Latency benchmark must retain all ticks 1..600.')
    resident=result.get('gameplayBackend')=='gpu'
    expected_records=600 if resident else 1200
    if len(records) != expected_records or len({r['id'] for r in records}) != expected_records:
        raise ValueError('Missing or duplicate latency records.')
    rows = {}; stages = {}
    def add(key, value):
        if not math.isfinite(value) or value < -1e-5:
            raise ValueError(f'Invalid latency duration: {key}={value}')
        stages.setdefault(key, []).append(max(0, value))
    for r in records:
        key = (r['kind'], r['tick'])
        if key in rows or r['kind'] not in (('gameplay',) if resident else ('step', 'render')):
            raise ValueError('Duplicate or unknown latency stage.')
        rows[key] = r; cpu = r['cpu']; kind = r['kind']
        for first, last, name in [('startedAt', 'preparedAt', 'prepare'),
                                  ('preparedAt', 'encodedAt', 'encode'),
                                  ('encodedAt', 'submittedAt', 'submit'),
                                  ('submittedAt', 'queueCompletedAt', 'queueCompletionWait'),
                                  ('queueCompletedAt', 'completedAt', 'afterQueueCompletion')]:
            add(f'{kind}.cpu.{name}', cpu[last] - cpu[first])
        if kind in ('step','gameplay'):
            add(f'{kind}.cpu.readbackReadyWait', cpu['readbacksReadyAt'] - cpu['submittedAt'])
        expected = 'complete' if latency['gpuTimestamps'] else 'unsupported' if latency.get('gpuTimingRequested', False) else 'disabled'
        if r['gpu']['status'] != expected:
            raise ValueError(f'Incomplete GPU diagnostic: {r["gpu"]["status"]}')
        if latency['gpuTimestamps']:
            required = ('tools','physicsPlanningAndCertification','collisionCache','controller','mesh','draw') if resident else ('physicsPlanningAndCertification', 'collisionQuery') if kind == 'step' else ('mesh', 'draw')
            if not all(k in r['gpu']['ms'] for k in required):
                raise ValueError('GPU stage timestamps missing.')
            for name, value in r['gpu']['ms'].items():
                add(f'{kind}.gpu.{name}', value)
    for s in samples:
        if resident:
            step=render=rows['gameplay',s['tick']]
            if (s.get('submissions'),s.get('completionBoundaries'),s.get('actorReadbackBytes'))!=(1,1,512):
                raise ValueError('Resident frame boundary/readback contract differs.')
        else:
            step = rows['step', s['tick']]; render = rows['render', s['tick']]
        if s['input']['source'] != 'scripted' or s['input']['event'] is not None:
            raise ValueError('Scripted benchmark claimed browser input latency.')
        add('inputSamplingToCompletion', s['completedAt'] - s['input']['sampledAt'])
        if resident:
            add('residentCommitToHudCompletion',s['completedAt']-step['cpu']['completedAt'])
        else:
            add('controllerAfterFieldCommit', s['controllerCompletedAt'] - step['cpu']['completedAt'])
            add('presentationBeforeRenderer', render['cpu']['startedAt'] - s['controllerCompletedAt'])
        add('cameraSampleToCompletion', s['completedAt'] - s['renderInputSampledAt'])
    return {'passed': True, 'frames': 600, 'records': len(records),
            'gpuTimestamps': latency['gpuTimestamps'],
            'note': 'CPU waits overlap GPU durations; percentiles must not be added. Scripted input excludes device/event-delivery latency and OS scanout. Physics GPU stage includes all planning and certification.',
            'milliseconds': {k: distribution(v) for k, v in stages.items()}}
