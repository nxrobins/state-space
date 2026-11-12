"""Fixed CPU benchmark capabilities under the unchanged incident hold.

Accidental-misuse boundary, not a sandbox against someone editing local code.
No arbitrary command, browser, GPU mode, recovery permit, or budget override.
"""
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import sys
import time

from scripts.verification_scope import (
    ROOT, LIMITS, JobObserver, exclusive_json, hold_identity, read_json, sha,
)

BASE = ROOT / 'dist/verification/collision-cpu'
DEPENDENCIES = ROOT / 'dist/verification/collision-python313'
PYTHON = str(Path(sys._base_executable).resolve())
NODE = str(Path(shutil.which('node') or '').resolve())
WINDOWS_COMMAND = str(Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/cmd.exe')
QUIET_OBSERVATION_SECONDS = 90  # Read-only preflight; workload deadlines stay unchanged.
SCENES = ('free-drift', 'thin-wall', 'occluded-wall', 'grazing-clearance',
          'rotating-plate', 'impact-chain', 'resting-stack')
CASES = ('startup-close', 'stalled-cpu', 'supervisor-loss', 'world-reference',
         *(case for scene in SCENES for case in ('ss-' + scene, 'mj-' + scene)))
PROFILE_CASES = CASES[:4] + tuple('ss-' + scene for scene in SCENES)
OPTIMIZATION_CASES = CASES[:3] + ('ss-owned-regression',) + CASES[3:]
TIMING_CASES = CASES[:3] + ('ss-owned-regression', 'world-reference', 'ss-stack-plain',
                          'ss-stack-clock-ab-1', 'ss-stack-clock-ba-1',
                          'ss-stack-clock-ab-2', 'ss-stack-clock-ba-2')
SOLVER_CASES = CASES[:3] + ('ss-owned-regression', 'world-reference',
                          'ss-stack-solver-profile-1', 'ss-stack-solver-profile-2',
                          'ss-stack-solver-profile-3', 'ss-stack-solver-counts')
NORMAL_CACHE_CASES = CASES[:3] + ('ss-owned-regression', 'ss-normal-cache-regression') + CASES[3:] + ('ss-normal-cache-counts',)
CACHE_TIMING_CASES = TIMING_CASES[:4] + ('ss-normal-cache-regression',) + TIMING_CASES[4:]
CACHE_SOLVER_CASES = SOLVER_CASES[:4] + ('ss-normal-cache-regression',) + SOLVER_CASES[4:]
OFFSET_CACHE_CASES = NORMAL_CACHE_CASES[:-1] + ('ss-offset-cache-counts',)
ALL_CASES = tuple(dict.fromkeys((*CASES, *OPTIMIZATION_CASES, *TIMING_CASES, *SOLVER_CASES, *NORMAL_CACHE_CASES, *OFFSET_CACHE_CASES)))
PROFILE_CONFIG = {
    'kind': 'state-space-cpu-profile-v1',
    'baseline': 'dist/verification/collision-cpu/e5929904a7a64fbb9e366695e16fcf24/comparison.json',
    'baselineSha256': 'c3472c0695a57016108eacf9c05bc6b5cb168f8f6e87c1d368d85fdb0a4e84ff',
    'baselinePacket': 'dist/verification/collision-reference-20261108-cpu-v2/packet.json',
    'baselinePacketSha256': '857e7e13317334c15f70a7923975d245c56601e5c27339bbaaa6d5ba459a15df',
    'bundleSha256': '1ad2665bec3d972673ddcddf0b505f25cff9ee47e7938d30a57b687777d8a196',
    'samplingIntervalMicros': 1000,
    'maxProfileBytes': 16 * 1024 * 1024,
}
OPTIMIZATION_CONFIG = {
    'kind': 'rigid-owned-optimization-v1',
    'baseline': PROFILE_CONFIG['baseline'],
    'baselineSha256': PROFILE_CONFIG['baselineSha256'],
    'baselinePacket': PROFILE_CONFIG['baselinePacket'],
    'baselinePacketSha256': PROFILE_CONFIG['baselinePacketSha256'],
    'baselineBundle': 'dist/verification/collision-reference-20261108-cpu-v2/engine.mjs',
    'baselineBundleSha256': PROFILE_CONFIG['bundleSha256'],
    'regressionBaseline': 'dist/verification/collision-owned-review-20261108/rigid-before.mjs',
    'regressionBaselineSha256': '5ad44f76d4da083c836ade08a1e8cf7fe4fcc764202298a1e1929089c16b77f0',
    'regressionManifest': 'dist/verification/collision-owned-review-20261108/baseline.json',
    'regressionManifestSha256': 'b397e3608aed96025608d7b6535bf7ac5b6269c8a54e45a750a7f48aa4d8b81f',
    'freshBaselineControls': True,
}
TIMING_CONFIG = {
    'kind': 'rigid-stack-timing-v1',
    'baseline': 'dist/verification/collision-cpu/b35049763d24429e86685ce0c0c6ba1d/comparison.json',
    'baselineSha256': '0be7ab135074ab762112db58b23af9fcd107198ca2544307fd50b8579806118b',
    'baselinePacket': 'dist/verification/collision-reference-owned-20261108/packet.json',
    'baselinePacketSha256': 'a8eee9fc652c10c44601f7cd81424d8c172c7342a8572355b42953ce8ab86a6c',
    'bundleSha256': '864cc291fc75ebfce7d6d53e6c15d1b13736679d0540c80c496298e991b19694',
    'originalBundle': OPTIMIZATION_CONFIG['baselineBundle'],
    'originalBundleSha256': OPTIMIZATION_CONFIG['baselineBundleSha256'],
    'regressionBaseline': OPTIMIZATION_CONFIG['regressionBaseline'],
    'regressionBaselineSha256': OPTIMIZATION_CONFIG['regressionBaselineSha256'],
    'scene': 'resting-stack',
    'maxStepRecords': 1200, 'maxGcEvents': 4096, 'maxDiagnosticBytes': 4 * 1024 * 1024,
}
SOLVER_CONFIG = {
    'kind': 'rigid-stack-solver-profile-v1',
    'baseline': TIMING_CONFIG['baseline'], 'baselineSha256': TIMING_CONFIG['baselineSha256'],
    'baselinePacket': TIMING_CONFIG['baselinePacket'],
    'baselinePacketSha256': TIMING_CONFIG['baselinePacketSha256'],
    'bundleSha256': TIMING_CONFIG['bundleSha256'],
    'regressionBaseline': TIMING_CONFIG['regressionBaseline'],
    'regressionBaselineSha256': TIMING_CONFIG['regressionBaselineSha256'],
    'scene': 'resting-stack', 'samplingIntervalMicros': 1000,
    'maxProfileBytes': 16 * 1024 * 1024,
    'coverageDt': 0.002, 'coverageCallCount': True, 'coverageDetailed': True,
}
NORMAL_CACHE_CONFIG = {
    'kind': 'rigid-normal-cache-v1',
    'baseline': TIMING_CONFIG['baseline'], 'baselineSha256': TIMING_CONFIG['baselineSha256'],
    'baselinePacket': TIMING_CONFIG['baselinePacket'],
    'baselinePacketSha256': TIMING_CONFIG['baselinePacketSha256'],
    'baselineBundle': 'dist/verification/collision-reference-owned-20261108/engine.mjs',
    'baselineBundleSha256': TIMING_CONFIG['bundleSha256'],
    'regressionBaseline': 'dist/verification/collision-reference-owned-20261108/engine.mjs',
    'regressionBaselineSha256': TIMING_CONFIG['bundleSha256'],
    'regressionManifest': TIMING_CONFIG['baselinePacket'],
    'regressionManifestSha256': TIMING_CONFIG['baselinePacketSha256'],
    'sourceBaseline': 'dist/verification/collision-normal-cache-review-20261109/rigid.ts.before',
    'sourceBaselineSha256': '2a9f951f01bb4b61d22dc5ccf416f7ef734f3072c6e1a936db52e5edb626dd7a',
    'coverageBaseline': 'dist/verification/collision-cpu/1f8f93269a2e435d82004d20ed366e39/ss-stack-solver-counts/coverage-0.002.json',
    'coverageBaselineSha256': '42e1d8a88d4ca15473644b1f494b8c0a5d631b1480a22a6f7e9417fc0f94dd0a',
    'freshBaselineControls': True, 'coverageDt': 0.002, 'maxCoverageBytes': 16 * 1024 * 1024,
}
CACHE_TIMING_CONFIG = {
    **TIMING_CONFIG,
    'kind': 'rigid-stack-cache-timing-v1',
    'baseline': 'dist/verification/collision-cpu/e3e46c48e46847a19a50477dee6c5f61/comparison.json',
    'baselineSha256': 'f177b534701e04e88265e4f41a941b8fa30737d026bcc13eece223e05b62a275',
    'baselinePacket': 'dist/verification/collision-normal-cache-20261109-v3/packet.json',
    'baselinePacketSha256': '33e34de643816c67ca39f6eeb14a30f811bd93102d2f68a008573b05a7067d3e',
    'bundleSha256': '44a000628cfe99134fbf3cb39cd6a431f826bc3212560524d396bf54445e7de7',
    'originalBundle': NORMAL_CACHE_CONFIG['baselineBundle'],
    'originalBundleSha256': NORMAL_CACHE_CONFIG['baselineBundleSha256'],
}
CACHE_SOLVER_CONFIG = {
    **SOLVER_CONFIG,
    'kind': 'rigid-stack-cache-solver-profile-v1',
    'baseline': CACHE_TIMING_CONFIG['baseline'],
    'baselineSha256': CACHE_TIMING_CONFIG['baselineSha256'],
    'baselinePacket': CACHE_TIMING_CONFIG['baselinePacket'],
    'baselinePacketSha256': CACHE_TIMING_CONFIG['baselinePacketSha256'],
    'bundleSha256': CACHE_TIMING_CONFIG['bundleSha256'],
    'originalBundle': CACHE_TIMING_CONFIG['originalBundle'],
    'originalBundleSha256': CACHE_TIMING_CONFIG['originalBundleSha256'],
    'priorProfile': 'dist/verification/collision-cpu/1f8f93269a2e435d82004d20ed366e39/solver-profile-summary-corrected.json',
    'priorProfileSha256': '8d405a776f13b2e328a2bad4f8c844000faf16065f11089a5d1e0654b74dce1b',
    'coverageBaseline': 'dist/verification/collision-cpu/e3e46c48e46847a19a50477dee6c5f61/ss-normal-cache-counts/coverage.json',
    'coverageBaselineSha256': 'f7092ab43849255c199a0e9d405a7c70648993840f438c9830707feafe073b21',
}
OFFSET_CACHE_CONFIG = {
    **NORMAL_CACHE_CONFIG,
    'kind': 'rigid-offset-cache-v1',
    'baseline': CACHE_TIMING_CONFIG['baseline'],
    'baselineSha256': CACHE_TIMING_CONFIG['baselineSha256'],
    'baselinePacket': CACHE_TIMING_CONFIG['baselinePacket'],
    'baselinePacketSha256': CACHE_TIMING_CONFIG['baselinePacketSha256'],
    'baselineBundle': 'dist/verification/collision-normal-cache-20261109-v3/engine.mjs',
    'baselineBundleSha256': CACHE_TIMING_CONFIG['bundleSha256'],
    'regressionBaseline': 'dist/verification/collision-normal-cache-20261109-v3/engine.mjs',
    'regressionBaselineSha256': CACHE_TIMING_CONFIG['bundleSha256'],
    'regressionManifest': CACHE_TIMING_CONFIG['baselinePacket'],
    'regressionManifestSha256': CACHE_TIMING_CONFIG['baselinePacketSha256'],
    'sourceBaseline': 'dist/verification/collision-offset-cache-review-20261109/rigid.ts.before',
    'sourceBaselineSha256': '645697f27090db717dd065873f674dce896560f5b4f9123472fa0ebc042f470b',
    'coverageBaseline': 'dist/verification/collision-cpu/cf46c60fbee34dfb8860326a6d27976c/ss-stack-solver-counts/coverage-0.002.json',
    'coverageBaselineSha256': 'c0a5764122a7cac50fc8c47a7427340b4d520aa8788ec85265df2c410b1eadc5',
}
OFFSET_TIMING_CONFIG = {
    **CACHE_TIMING_CONFIG,
    'kind': 'rigid-stack-offset-timing-v1',
    'baseline': 'dist/verification/collision-cpu/3de856c150ea41ac9de0e8b9601d341e/comparison.json',
    'baselineSha256': 'e0a1f7d213bada1d00bde4f8f794bdae2b7fa46c992b262fef675f1aa9196385',
    'baselinePacket': 'dist/verification/collision-offset-cache-20261109/packet.json',
    'baselinePacketSha256': 'bf0268fe4e4a43cd01688d46d3ae7b87713ea7de28581222d58242b3cc0842ec',
    'bundleSha256': 'f64bf7fd75f878a3a82d3a9fabe50daa384087efcc12f1285a6e70972466efa8',
    'originalBundle': OFFSET_CACHE_CONFIG['baselineBundle'],
    'originalBundleSha256': OFFSET_CACHE_CONFIG['baselineBundleSha256'],
}
SOURCES = (
    'scripts/collision_cpu_scope.py', 'scripts/verify_collision_cpu.py',
    'scripts/collision_cpu_leaf.py', 'scripts/verification_scope.py',
    'scripts/verify_browser_containment.py', 'scripts/verification_guard.py',
    'scripts/verification_health.py', 'scripts/verification_watchdog.py',
    'scripts/verification_journal.py', 'scripts/prepare_terrain_validation.py',
    'tests/test_collision_cpu_scope.py',
    'tests/collision_profile.test.mjs',
    'tests/collision_owned.test.mjs',
    'tests/collision_timing.test.mjs',
    'tests/collision_solver_profile.test.mjs',
    'tests/collision_normal_cache.test.mjs',
    'tests/collision_cache_timing.test.mjs',
    'tests/collision_cache_solver_profile.test.mjs',
    'tests/collision_offset_cache.test.mjs',
    'tests/collision_offset_timing.test.mjs',
)
ORIGINAL_FAILURE = ROOT / 'dist/verification/browser-containment/d40b35fb88374a749ef87c71add94948/supervisor-loss/report.json'


def source_hashes():
    return {name: sha(ROOT / name) for name in SOURCES}


def binary_hashes():
    python = Path(PYTHON)
    paths = [python, Path(NODE), Path(WINDOWS_COMMAND), Path(platform.__file__),
             python.with_name('python313.dll'),
             *python.parent.glob('vcruntime*.dll')]
    if python.name.lower() != 'python.exe' or not python.with_name('python313.dll').is_file():
        raise RuntimeError('Use the reviewed base Python 3.13 executable, not a venv redirector')
    return {str(path): sha(path) for path in sorted(set(paths))}


def dependency_hashes():
    if not DEPENDENCIES.is_dir():
        raise RuntimeError('Missing isolated CPU dependencies')
    files = {str(path.relative_to(DEPENDENCIES)): sha(path)
             for path in sorted(DEPENDENCIES.rglob('*'))
             if path.is_file() and path.suffix != '.pyc' and '__pycache__' not in path.parts}
    distributions = sorted(path.name for path in DEPENDENCIES.glob('*.dist-info'))
    if not files or distributions != ['mujoco_core-4.0.0.dist-info', 'numpy-2.3.4.dist-info']:
        raise RuntimeError('Unexpected graphics distribution in CPU dependencies')
    return files


def benchmark_identity(directory):
    directory = Path(directory).resolve(strict=True)
    if directory.parent != ROOT / 'dist/verification':
        raise RuntimeError('Benchmark packet must be directly under dist/verification')
    packet = read_json(directory / 'packet.json')
    digest = sha(directory / 'packet.json')
    if digest != (directory / 'packet.sha256').read_text().strip():
        raise RuntimeError('Benchmark packet digest mismatch')
    if packet['bundleSha256'] != sha(directory / 'engine.mjs'):
        raise RuntimeError('Benchmark bundle changed')
    for row in packet['files']:
        source = (ROOT / row['path']).resolve(strict=True)
        if not source.is_relative_to(ROOT) or sha(source) != row['sha256']:
            raise RuntimeError('Benchmark source drift: ' + row['path'])
    if [scene['id'] for scene in packet['fixtures']] != list(SCENES):
        raise RuntimeError('Unknown fixture cohort')
    return {'directory': str(directory), 'packetSha256': digest,
            'bundleSha256': packet['bundleSha256']}


def cases_for(review):
    profile = review.get('profile')
    optimization = review.get('optimization')
    timing = review.get('timing')
    solver = review.get('solver')
    normal_cache = review.get('normalCache')
    cache_timing = review.get('cacheTiming')
    cache_solver = review.get('cacheSolver')
    offset_cache = review.get('offsetCache')
    offset_timing = review.get('offsetTiming')
    if offset_timing is not None:
        if (any(mode is not None for mode in (profile, optimization, timing, solver, normal_cache, cache_timing, cache_solver, offset_cache))
                or offset_timing != OFFSET_TIMING_CONFIG):
            raise RuntimeError('Unknown or combined offset timing recipe')
        return CACHE_TIMING_CASES
    if offset_cache is not None:
        if (any(mode is not None for mode in (profile, optimization, timing, solver, normal_cache, cache_timing, cache_solver))
                or offset_cache != OFFSET_CACHE_CONFIG):
            raise RuntimeError('Unknown or combined offset cache recipe')
        return OFFSET_CACHE_CASES
    if cache_solver is not None:
        if (any(mode is not None for mode in (profile, optimization, timing, solver, normal_cache, cache_timing))
                or cache_solver != CACHE_SOLVER_CONFIG):
            raise RuntimeError('Unknown or combined cached solver profiling recipe')
        return CACHE_SOLVER_CASES
    if cache_timing is not None:
        if (any(mode is not None for mode in (profile, optimization, timing, solver, normal_cache))
                or cache_timing != CACHE_TIMING_CONFIG):
            raise RuntimeError('Unknown or combined cache timing recipe')
        return CACHE_TIMING_CASES
    if normal_cache is not None:
        if any(mode is not None for mode in (profile, optimization, timing, solver)) or normal_cache != NORMAL_CACHE_CONFIG:
            raise RuntimeError('Unknown or combined normal-cache recipe')
        return NORMAL_CACHE_CASES
    if solver is not None:
        if any(mode is not None for mode in (profile, optimization, timing)) or solver != SOLVER_CONFIG:
            raise RuntimeError('Unknown or combined solver profiling recipe')
        return SOLVER_CASES
    if timing is not None:
        if profile is not None or optimization is not None or timing != TIMING_CONFIG:
            raise RuntimeError('Unknown or combined timing recipe')
        return TIMING_CASES
    if optimization is not None:
        if profile is not None or optimization != OPTIMIZATION_CONFIG:
            raise RuntimeError('Unknown or combined optimization recipe')
        return OPTIMIZATION_CASES
    if profile is None:
        return CASES
    if profile != PROFILE_CONFIG:
        raise RuntimeError('Unknown fixed profiling recipe')
    return PROFILE_CASES


def profile_identity(benchmark):
    for path_key, hash_key in (('baseline', 'baselineSha256'), ('baselinePacket', 'baselinePacketSha256')):
        if sha(ROOT / PROFILE_CONFIG[path_key]) != PROFILE_CONFIG[hash_key]:
            raise RuntimeError('Completed profiling baseline changed')
    current = read_json(Path(benchmark['directory']) / 'packet.json')
    baseline = read_json(ROOT / PROFILE_CONFIG['baselinePacket'])
    if (benchmark['bundleSha256'] != PROFILE_CONFIG['bundleSha256']
            or current['protocol'] != baseline['protocol'] or current['fixtures'] != baseline['fixtures']):
        raise RuntimeError('Profiling must preserve the measured engine, fixtures and protocol')
    return dict(PROFILE_CONFIG)


def optimization_identity(benchmark):
    for path_key in ('baseline', 'baselinePacket', 'baselineBundle', 'regressionBaseline', 'regressionManifest'):
        if sha(ROOT / OPTIMIZATION_CONFIG[path_key]) != OPTIMIZATION_CONFIG[path_key + 'Sha256']:
            raise RuntimeError('Frozen optimization baseline changed')
    current = read_json(Path(benchmark['directory']) / 'packet.json')
    baseline = read_json(ROOT / OPTIMIZATION_CONFIG['baselinePacket'])
    if current['protocol'] != baseline['protocol'] or current['fixtures'] != baseline['fixtures']:
        raise RuntimeError('Optimization must preserve the measured fixtures and protocol')
    before = {row['path']: row['sha256'] for row in baseline['files'] if row['path'].startswith('engine/')}
    after = {row['path']: row['sha256'] for row in current['files'] if row['path'].startswith('engine/')}
    allowed = 'engine/experimental/multiphysics/rigid.ts'
    if set(before) != set(after) or any(before[path] != after[path] for path in before if path != allowed):
        raise RuntimeError('Optimization changes engine files outside the fixed rigid scope')
    return dict(OPTIMIZATION_CONFIG)


def timing_identity(benchmark):
    for key in ('baseline', 'baselinePacket', 'originalBundle', 'regressionBaseline'):
        if sha(ROOT / TIMING_CONFIG[key]) != TIMING_CONFIG[key + 'Sha256']:
            raise RuntimeError('Completed timing baseline changed')
    current = read_json(Path(benchmark['directory']) / 'packet.json')
    baseline = read_json(ROOT / TIMING_CONFIG['baselinePacket'])
    fixed = ('engine/', 'scripts/collision-reference/engine-entry.ts',
             'scripts/collision-reference/state-space.mjs', 'scripts/collision-reference/protocol.mjs',
             'scripts/collision-reference/replay.mjs', 'scripts/collision-reference/exact-state.mjs',
             'scripts/collision-reference/profile-data.mjs', 'scripts/collision-reference/owned-regression.mjs')
    before = {r['path']: r['sha256'] for r in baseline['files'] if r['path'].startswith(fixed)}
    after = {r['path']: r['sha256'] for r in current['files'] if r['path'].startswith(fixed)}
    if (before != after or benchmark['bundleSha256'] != TIMING_CONFIG['bundleSha256']
            or current['protocol'] != baseline['protocol'] or current['fixtures'] != baseline['fixtures']):
        raise RuntimeError('Timing diagnostics must preserve engine, replay harness, fixtures and protocol')
    return dict(TIMING_CONFIG)


def solver_identity(benchmark):
    # The timing identity already freezes every engine file and the replay/measurement harness.
    timing_identity(benchmark)
    return dict(SOLVER_CONFIG)


def cache_timing_identity(benchmark):
    for key in ('baseline', 'baselinePacket', 'originalBundle', 'regressionBaseline'):
        if sha(ROOT / CACHE_TIMING_CONFIG[key]) != CACHE_TIMING_CONFIG[key + 'Sha256']:
            raise RuntimeError('Completed cache timing baseline changed')
    current = read_json(Path(benchmark['directory']) / 'packet.json')
    baseline = read_json(ROOT / CACHE_TIMING_CONFIG['baselinePacket'])
    fixed = ('engine/', 'scripts/collision-reference/engine-entry.ts',
             'scripts/collision-reference/state-space.mjs', 'scripts/collision-reference/protocol.mjs',
             'scripts/collision-reference/replay.mjs', 'scripts/collision-reference/exact-state.mjs',
             'scripts/collision-reference/profile-data.mjs', 'scripts/collision-reference/owned-regression.mjs',
             'scripts/collision-reference/normal-cache-regression.mjs', 'scripts/collision-reference/timing-data.mjs')
    before = {r['path']: r['sha256'] for r in baseline['files'] if r['path'].startswith(fixed)}
    after = {r['path']: r['sha256'] for r in current['files'] if r['path'].startswith(fixed)}
    if (before != after or benchmark['bundleSha256'] != CACHE_TIMING_CONFIG['bundleSha256']
            or current['protocol'] != baseline['protocol'] or current['fixtures'] != baseline['fixtures']):
        raise RuntimeError('Cache timing must preserve engine, replay, timing wrapper, fixtures and protocol')
    return dict(CACHE_TIMING_CONFIG)


def cache_solver_identity(benchmark):
    cache_timing_identity(benchmark)
    for key in ('priorProfile', 'coverageBaseline'):
        if sha(ROOT / CACHE_SOLVER_CONFIG[key]) != CACHE_SOLVER_CONFIG[key + 'Sha256']:
            raise RuntimeError('Frozen cached solver evidence changed')
    current = read_json(Path(benchmark['directory']) / 'packet.json')
    baseline = read_json(ROOT / CACHE_SOLVER_CONFIG['baselinePacket'])
    target = 'scripts/collision-reference/solver-profile-data.mjs'
    before = [r for r in baseline['files'] if r['path'] == target]
    after = [r for r in current['files'] if r['path'] == target]
    if len(before) != 1 or before != after:
        raise RuntimeError('Cached solver profiling must preserve the attribution method')
    return dict(CACHE_SOLVER_CONFIG)


def normal_cache_identity(benchmark):
    for key in ('baseline', 'baselinePacket', 'baselineBundle', 'regressionBaseline',
                'regressionManifest', 'sourceBaseline', 'coverageBaseline'):
        if sha(ROOT / NORMAL_CACHE_CONFIG[key]) != NORMAL_CACHE_CONFIG[key + 'Sha256']:
            raise RuntimeError('Frozen normal-cache baseline changed')
    current = read_json(Path(benchmark['directory']) / 'packet.json')
    baseline = read_json(ROOT / NORMAL_CACHE_CONFIG['baselinePacket'])
    fixed = ('engine/', 'scripts/collision-reference/engine-entry.ts',
             'scripts/collision-reference/state-space.mjs', 'scripts/collision-reference/protocol.mjs',
             'scripts/collision-reference/replay.mjs', 'scripts/collision-reference/exact-state.mjs',
             'scripts/collision-reference/profile-data.mjs', 'scripts/collision-reference/owned-regression.mjs')
    before = {r['path']: r['sha256'] for r in baseline['files'] if r['path'].startswith(fixed)}
    after = {r['path']: r['sha256'] for r in current['files'] if r['path'].startswith(fixed)}
    allowed = 'engine/experimental/multiphysics/rigid.ts'
    if (set(before) != set(after) or any(before[p] != after[p] for p in before if p != allowed)
            or current['protocol'] != baseline['protocol'] or current['fixtures'] != baseline['fixtures']):
        raise RuntimeError('Normal cache must preserve all other engine, replay, fixtures and protocol sources')
    return dict(NORMAL_CACHE_CONFIG)


def offset_cache_identity(benchmark):
    for key in ('baseline', 'baselinePacket', 'baselineBundle', 'regressionBaseline',
                'regressionManifest', 'sourceBaseline', 'coverageBaseline'):
        if sha(ROOT / OFFSET_CACHE_CONFIG[key]) != OFFSET_CACHE_CONFIG[key + 'Sha256']:
            raise RuntimeError('Frozen offset cache baseline changed')
    current = read_json(Path(benchmark['directory']) / 'packet.json')
    baseline = read_json(ROOT / OFFSET_CACHE_CONFIG['baselinePacket'])
    fixed = ('engine/', 'scripts/collision-reference/engine-entry.ts',
             'scripts/collision-reference/state-space.mjs', 'scripts/collision-reference/protocol.mjs',
             'scripts/collision-reference/replay.mjs', 'scripts/collision-reference/exact-state.mjs',
             'scripts/collision-reference/profile-data.mjs', 'scripts/collision-reference/owned-regression.mjs',
             'scripts/collision-reference/normal-cache-regression.mjs', 'scripts/collision-reference/solver-profile-data.mjs')
    before = {r['path']: r['sha256'] for r in baseline['files'] if r['path'].startswith(fixed)}
    after = {r['path']: r['sha256'] for r in current['files'] if r['path'].startswith(fixed)}
    allowed = 'engine/experimental/multiphysics/rigid.ts'
    if (set(before) != set(after) or any(before[p] != after[p] for p in before if p != allowed)
            or current['protocol'] != baseline['protocol'] or current['fixtures'] != baseline['fixtures']):
        raise RuntimeError('Offset cache must preserve other engine code, replay, fixtures and protocol')
    return dict(OFFSET_CACHE_CONFIG)


def offset_timing_identity(benchmark):
    for key in ('baseline', 'baselinePacket', 'originalBundle', 'regressionBaseline'):
        if sha(ROOT / OFFSET_TIMING_CONFIG[key]) != OFFSET_TIMING_CONFIG[key + 'Sha256']:
            raise RuntimeError('Completed offset timing baseline changed')
    current = read_json(Path(benchmark['directory']) / 'packet.json')
    baseline = read_json(ROOT / OFFSET_TIMING_CONFIG['baselinePacket'])
    fixed = ('engine/', 'scripts/collision-reference/engine-entry.ts',
             'scripts/collision-reference/state-space.mjs', 'scripts/collision-reference/protocol.mjs',
             'scripts/collision-reference/replay.mjs', 'scripts/collision-reference/exact-state.mjs',
             'scripts/collision-reference/profile-data.mjs', 'scripts/collision-reference/owned-regression.mjs',
             'scripts/collision-reference/normal-cache-regression.mjs', 'scripts/collision-reference/timing-data.mjs',
             'scripts/collision-reference/cache-timing-data.mjs')
    before = {r['path']: r['sha256'] for r in baseline['files'] if r['path'].startswith(fixed)}
    after = {r['path']: r['sha256'] for r in current['files'] if r['path'].startswith(fixed)}
    if (before != after or benchmark['bundleSha256'] != OFFSET_TIMING_CONFIG['bundleSha256']
            or current['protocol'] != baseline['protocol'] or current['fixtures'] != baseline['fixtures']):
        raise RuntimeError('Offset timing must preserve engine, replay, timing wrapper, fixtures and protocol')
    return dict(OFFSET_TIMING_CONFIG)


def validate_review(review):
    if (os.name != 'nt' or review.get('schema') != 'collision-cpu-review-v1'
            or review.get('mode') != 'cpu-only' or review.get('limits') != LIMITS
            or review.get('quietObservationSeconds') != QUIET_OBSERVATION_SECONDS
            or review.get('cases') != list(cases_for(review)) or review.get('root') != str(ROOT)
            or review.get('hold') != hold_identity()
            or review.get('sources') != source_hashes()
            or review.get('binaries') != binary_hashes()
            or review.get('dependencies') != dependency_hashes()
            or review.get('benchmark') != benchmark_identity(review['benchmark']['directory'])
            or review.get('originalFailureSha256') != sha(ORIGINAL_FAILURE)):
        raise RuntimeError('CPU review, source, binary, dependency, or incident changed')
    if review.get('profile') is not None and review['profile'] != profile_identity(review['benchmark']):
        raise RuntimeError('Profiling baseline changed')
    if review.get('optimization') is not None and review['optimization'] != optimization_identity(review['benchmark']):
        raise RuntimeError('Optimization baseline changed')
    if review.get('timing') is not None and review['timing'] != timing_identity(review['benchmark']):
        raise RuntimeError('Timing baseline changed')
    if review.get('solver') is not None and review['solver'] != solver_identity(review['benchmark']):
        raise RuntimeError('Solver profiling baseline changed')
    if review.get('normalCache') is not None and review['normalCache'] != normal_cache_identity(review['benchmark']):
        raise RuntimeError('Normal-cache baseline changed')
    if review.get('cacheTiming') is not None and review['cacheTiming'] != cache_timing_identity(review['benchmark']):
        raise RuntimeError('Cache timing baseline changed')
    if review.get('cacheSolver') is not None and review['cacheSolver'] != cache_solver_identity(review['benchmark']):
        raise RuntimeError('Cached solver baseline changed')
    if review.get('offsetTiming') is not None and review['offsetTiming'] != offset_timing_identity(review['benchmark']):
        raise RuntimeError('Offset timing baseline changed')
    if review.get('offsetCache') is not None and review['offsetCache'] != offset_cache_identity(review['benchmark']):
        raise RuntimeError('Offset cache baseline changed')


def attempt_path(path):
    path = Path(path).resolve(strict=True)
    if (path.parent.parent != BASE.resolve() or path.name not in ALL_CASES
            or not re.fullmatch('[0-9a-f]{32}', path.parent.name)):
        raise RuntimeError('Attempt is outside its owned CPU packet')
    return path


def command(attempt, role):
    if role not in ('supervise', 'leaf'):
        raise RuntimeError('Unknown fixed CPU role')
    name = 'verify_collision_cpu.py' if role == 'supervise' else 'collision_cpu_leaf.py'
    return [PYTHON, '-I', '-B', '-u', str(ROOT / 'scripts' / name), str(attempt)]


def node_command(attempt):
    review = read_json(Path(attempt).parent / 'review.json')
    cases_for(review)
    entry = ('offset-timing-runner.mjs' if review.get('offsetTiming') else
             'offset-cache-runner.mjs' if review.get('offsetCache') else
             'cache-solver-profile-runner.mjs' if review.get('cacheSolver') else
             'cache-timing-runner.mjs' if review.get('cacheTiming') else
             'optimized-runner.mjs' if review.get('normalCache') else
             'solver-profile-runner.mjs' if review.get('solver') else
             'timing-runner.mjs' if review.get('timing') else
             'optimized-runner.mjs' if review.get('optimization') else
             'profile-runner.mjs' if review.get('profile') else 'scoped-runner.mjs')
    return [NODE, '--no-expose-wasm',
            str(ROOT / 'scripts/collision-reference' / entry), str(attempt)]


def validate_capability(attempt, *, now=None):
    attempt = attempt_path(attempt)
    review = read_json(attempt.parent / 'review.json')
    validate_review(review)
    if attempt.name not in cases_for(review):
        raise RuntimeError('Case is outside the fixed review recipe')
    cap = read_json(attempt / 'capability.json')
    now = time.time() if now is None else now
    if (cap.get('version') != 1 or cap.get('case') != attempt.name or cap.get('mode') != 'cpu-only'
            or cap.get('limits') != LIMITS
            or cap.get('reviewSha256') != sha(attempt.parent / 'review.json')
            or not re.fullmatch('[0-9a-f]{32}', cap.get('runId', ''))
            or cap.get('command') != command(attempt, 'leaf')
            or cap.get('supervisorCommand') != command(attempt, 'supervise')
            or type(cap.get('ownerPid')) is not int or cap['ownerPid'] <= 0
            or not all(type(cap.get(k)) in (int, float) and math.isfinite(cap[k])
                       for k in ('issuedAt', 'expiresAt'))
            or not cap['issuedAt'] <= now < cap['expiresAt'] <= cap['issuedAt'] + 60):
        raise RuntimeError('Invalid, altered, or expired CPU capability')
    if read_json(attempt / 'claim.json') != {
            'capabilitySha256': sha(attempt / 'capability.json'), 'ownerPid': cap['ownerPid']}:
        raise RuntimeError('Capability has not been consumed by its lease owner')
    if read_json(attempt.parent / 'execution.lock') != {
            'ownerPid': cap['ownerPid'], 'case': cap['case'], 'reviewSha256': cap['reviewSha256']}:
        raise RuntimeError('Capability is not attached to the current CPU execution lock')
    return cap, review


def claim_leaf(attempt):
    attempt = attempt_path(attempt)
    cap, review = validate_capability(attempt)
    supervisor = read_json(attempt / 'supervisor.json')
    if (supervisor['pid'] != os.getppid() or supervisor['runId'] != cap['runId']
            or supervisor['capabilitySha256'] != sha(attempt / 'capability.json')
            or read_json(attempt / 'child.json')['pid'] != os.getpid()):
        raise RuntimeError('CPU leaf does not descend from its capability owner')
    job = JobObserver(cap['runId'])
    try:
        job.require_membership()
        exclusive_json(attempt / 'leaf-claim.json', {
            'pid': os.getpid(), 'parentPid': os.getppid(),
            'capabilitySha256': sha(attempt / 'capability.json')})
    finally:
        job.close()
    return cap, review


def claim_node(attempt):
    attempt = attempt_path(attempt)
    cap, review = validate_capability(attempt)
    if cap['case'] != 'world-reference' and not cap['case'].startswith('ss-'):
        raise RuntimeError('This case does not authorize Node')
    deadline = time.monotonic() + 2
    while not (attempt / 'node-start.json').exists():
        if time.monotonic() > deadline:
            raise RuntimeError('No owned Node process')
        time.sleep(.02)
    node = read_json(attempt / 'node-start.json')
    leaf = read_json(attempt / 'leaf-claim.json')
    if (node != {'pid': os.getppid(), 'parentPid': leaf['pid'], 'command': node_command(attempt)}
            or leaf['capabilitySha256'] != sha(attempt / 'capability.json')):
        raise RuntimeError('Node process identity mismatch')
    job = JobObserver(cap['runId'])
    try:
        job.require_membership()
        if node['pid'] not in job.pids():
            raise RuntimeError('Node is outside the owned Job')
        exclusive_json(attempt / 'node-claim.json', {
            'pid': node['pid'], 'capabilitySha256': sha(attempt / 'capability.json')})
    finally:
        job.close()
    print(json.dumps({'case': cap['case'], 'benchmark': review['benchmark'],
                      'profile': review.get('profile'), 'optimization': review.get('optimization'),
                      'timing': review.get('timing'), 'solver': review.get('solver'),
                      'normalCache': review.get('normalCache'), 'cacheTiming': review.get('cacheTiming'),
                      'cacheSolver': review.get('cacheSolver'), 'offsetCache': review.get('offsetCache'),
                      'offsetTiming': review.get('offsetTiming')}))

