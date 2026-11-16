"""Prepare an inert, immutable terrain-native validation packet.

This command only reads source/hold/worktree bytes and writes fixture/evidence
files. It has no browser, adapter, server, permit, or runtime-launch path.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
import uuid

ROOT = Path(__file__).resolve().parent.parent
SHAPE = (16, 8, 16)
EDGE = 4
VIEWPORT = (384, 216)
MERGED_TERRAIN_COMMIT = '0af27b6c928cc3c5fbda7f66536d8b2ccb0c0cdb'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(root, *args):
    # Fixed read-only Git operations; no test or runtime command is accepted.
    return subprocess.check_output(['git', '-C', str(root), *args], timeout=10)


def worktree_snapshot(path):
    names = set(git(path, 'ls-files', '-c', '-o', '--exclude-standard', '-z')
                .decode('utf-8').split('\0')) - {''}
    return {
        'path': str(path),
        'head': git(path, 'rev-parse', 'HEAD').decode().strip(),
        'branch': git(path, 'branch', '--show-current').decode().strip(),
        'status': git(path, 'status', '--porcelain=v1', '-z').decode(),
        'files': {name: digest((path / name).read_bytes()) for name in sorted(names)
                  if (path / name).is_file()},
    }


def storage_index(x, y, z):
    nx, ny = SHAPE[0] // EDGE, SHAPE[1] // EDGE
    chunk = x // EDGE + nx * (y // EDGE + ny * (z // EDGE))
    return chunk * EDGE**3 + x % EDGE + EDGE * (y % EDGE + EDGE * (z % EDGE))


def fixture():
    """Packed presentation cells only; never construct or step a physical world."""
    cells = [0] * math.prod(SHAPE)

    def box(low, high, material, thermal=80):
        for z in range(low[2], high[2]):
            for y in range(low[1], high[1]):
                for x in range(low[0], high[0]):
                    cells[storage_index(x, y, z)] = material | thermal << 8

    box((1, 6, 3), (15, 7, 15), 1)  # Rock floor, including dry and wet banks.
    box((1, 1, 14), (15, 7, 15), 1)  # Back wall reveals material/lighting detail.
    box((2, 3, 9), (4, 6, 12), 1)
    box((12, 2, 10), (14, 6, 13), 1)
    box((4, 5, 8), (7, 6, 11), 2)  # Water touches rock without simulated flow.
    box((8, 5, 10), (10, 6, 13), 8)  # Ice.
    box((5, 5, 12), (7, 6, 14), 3)  # Sand.
    box((4, 5, 11), (5, 6, 12), 10, 240)  # Visible emitter.
    box((11, 5, 13), (12, 6, 14), 10, 230)  # Emitter behind a small wall.
    box((10, 3, 12), (12, 6, 13), 1)
    # Prove bijective addressing independently of the scene's material choices.
    indices = [storage_index(x, y, z) for z in range(SHAPE[2])
               for y in range(SHAPE[1]) for x in range(SHAPE[0])]
    if sorted(indices) != list(range(len(cells))):
        raise RuntimeError('Fixture addressing is not bijective.')
    counts = Counter(word & 255 for word in cells)
    if set(counts) != {0, 1, 2, 3, 8, 10} or counts[10] != 2:
        raise RuntimeError('Unexpected fixture materials or emitter count.')
    length = math.sqrt(1.04)
    return cells, {
        'version': 1, 'shape': SHAPE, 'chunkSize': EDGE,
        'cells': len(cells), 'chunks': len(cells) // EDGE**3,
        'storageOrder': 'chunk-major; x-fast within each chunk; little-endian u32',
        'wordLayout': 'material in bits 0..7; thermal byte in bits 8..15; other bits zero',
        'materialCounts': dict(sorted(counts.items())),
        'camera': {'eye': [8, 2, 1.5], 'forward': [0, .2 / length, 1 / length],
                   'right': [1, 0, 0], 'up': [0, -1 / length, .2 / length]},
        'viewport': VIEWPORT, 'presentationTick': 0,
        'lightingMode': 'reference', 'heatDistortion': False,
        'scope': 'Authored read-only presentation input; not a physical snapshot or energy ledger.',
        'features': ['dry/wet rock', 'water', 'ice', 'sand', 'visible/partly occluded hot sources'],
    }


def plan():
    return {
        'status': 'prepared-not-authorized-not-launch-ready',
        'nativeLaunchImplemented': False,
        'holdMustRemainTrue': True,
        'executionHost': None,
        'authorization': None,
        'requiredBeforeNative': [
            'Choose/review the GPU execution host; prefer a separate physical host.',
            'Implement and review an exact single-use capability without clearing blockRecovery.',
            'Implement a fixed-command browser transport, safe arguments and phase deadlines.',
            'Pass separate GPU-disabled browser startup/cancellation/supervisor-loss cases.',
            'Build/review the dedicated production-shader/probe bundle and pin its hashes.',
            'Obtain stage-specific human authorization after those prerequisites.',
        ],
        'quietWindow': {'seconds': 30, 'maxHostCpuPercent': 30,
                        'minHostFreeMemoryMiB': 8192, 'maxGpuUtilizationPercent': 15,
                        'gpuTemperatureBelowC': 65, 'minGpuFreeMemoryMiB': 1024},
        'proposedNativeContainment': {
            'kind': 'gpu', 'processTreeCpuPercent': 12, 'jobMemoryMiB': 8192,
            'hardDeadlineSeconds': 30, 'browserReadySeconds': 12,
            'setupSeconds': 8, 'operationSeconds': 2, 'cleanupSeconds': 3,
            'maxUnacknowledgedProgressSeconds': 5,
            'independentWatchdog': True, 'exclusiveLease': True,
            'note': 'Existing GPU policy, not the 6%/4 GiB CPU-only policy. '
                    'Phase limits overlap the hard deadline. GPU execution is not CPU-capped.',
        },
        'stages': [
            {'id': 'shaders', 'advance': 'separate authorization',
             'shaderVariants': ['reference'], 'maxDevices': 1, 'maxModules': 5,
             'maxPipelines': 5, 'queueSubmissions': 0, 'draws': 0, 'dispatches': 0,
             'pipelines': ['cavern extract', 'surface', 'haze', 'post', 'light-list collect'],
             'capture': ['WGSL hashes', 'compilation messages', 'pipeline descriptors',
                         'adapter/browser identity', 'uncaptured errors/device loss', 'cleanup']},
            {'id': 'images', 'advance': 'after reviewed shader success; separate authorization',
             'maxDevices': 1, 'maxFrames': 3, 'physicsTicks': 0,
             'maxModules': 8, 'maxPipelines': 10, 'maxDrawCalls': 132,
             'maxQueueSubmissions': 7, 'maxRenderPasses': 39,
             'maxComputeDispatchCalls': 12, 'maxComputeWorkgroups': 134,
             'maxExplicitGpuBufferBytes': 131072, 'maxExplicitTexturePayloadBytes': 33554432,
             'maxWriteBufferCalls': 12, 'maxWriteBufferPayloadBytes': 9440,
             'maxExternalImageCopies': 3, 'maxExternalImageCopyPixels': 3 * 1024**2,
             'maxReadbackPayloadBytes': 3 * math.prod(SHAPE) * 4,
             'maxPngBytesEach': 1048576, 'maxEvidenceBytes': 16777216,
             'frames': [
                 {'id': 'classic', 'style': {'profile': 'classic'}, 'png': '01-classic.png'},
                 {'id': 'geological', 'style': {'profile': 'geological'}, 'png': '02-geological.png'},
                 {'id': 'classic-return', 'style': {'profile': 'classic'}, 'png': '03-classic-return.png'},
             ],
             'acceptance': ['Three complete PNGs at exactly 384x216.',
                            'Decoded RGBA classic and classic-return bytes equal.',
                            'Geological decoded RGBA differs from classic.',
                            'At least 16 distinct RGB triples per image; all alpha bytes 255.',
                            'Input grid readback equals the 8192-byte fixture after every frame.',
                            'Resolved style exactly matches each requested profile.',
                            'No compilation, validation, device-loss, transport or cleanup error.'],
             'manualVisualAcceptance': 'Separate human/image review; pixel difference is not a quality score.'},
        ],
        'forbidden': ['automatic stage advancement or retry', 'cached lighting', 'physics steps',
                      'world trajectories/replay', 'animation loops/warmup/benchmarks',
                      'larger grids/viewports', 'fallback/software adapters', 'unsafe WebGPU flags',
                      'reuse of an existing browser/profile', 'generic eval/navigation',
                      'changing the safety hold or stopping unrelated processes'],
    }


def prepare(output, protected_worktree):
    hold = ROOT / 'dist/verification/safety-hold.json'
    original = hold.read_bytes()
    state = json.loads(original)
    if state.get('blockRecovery') is not True or 'recoveryPermit' in state:
        raise RuntimeError('Preparation requires an active hold without an unused permit.')
    before = worktree_snapshot(protected_worktree)
    output = output.resolve()
    allowed = (ROOT / 'dist/verification/terrain-native').resolve()
    if not output.is_relative_to(allowed) or output == allowed:
        raise ValueError('Use a fresh child directory of dist/verification/terrain-native.')
    output.mkdir(parents=True, exist_ok=False)
    cells, info = fixture()
    binary = struct.pack('<' + 'I' * len(cells), *cells)
    (output / 'grid.u32le').write_bytes(binary)
    info['gridSha256'] = digest(binary)
    info['gridBytes'] = len(binary)
    def write(name, value):
        (output / name).write_text(
            json.dumps(value, indent=2, allow_nan=False) + '\n', encoding='utf-8')

    write('fixture.json', info)
    write('plan.json', plan())
    sources = list((ROOT / 'engine').rglob('*.ts'))
    sources += [ROOT / name for name in (
        'package.json', 'package-lock.json', 'scripts/prepare_terrain_validation.py',
        'docs/TERRAIN_NATIVE_VALIDATION.md', 'scripts/verification_guard.py',
        'scripts/verification_guard.mjs', 'scripts/verification_browser.py',
        'scripts/verification_browser.mjs', 'scripts/verification_health.py',
        'scripts/verification_watchdog.py', 'scripts/verification_journal.py',
    )]
    hashes = {p.relative_to(ROOT).as_posix(): digest(p.read_bytes()) for p in sorted(sources)}
    write('protected-worktree.json', before)
    if hold.read_bytes() != original or worktree_snapshot(protected_worktree) != before:
        raise RuntimeError('Hold or protected worktree changed during preparation; retain packet for review.')
    if any(digest((ROOT / name).read_bytes()) != value for name, value in hashes.items()):
        raise RuntimeError('Source changed during preparation; retain packet for review.')
    manifest = {
        'version': 1, 'prepared': True, 'nativeRunPassed': False, 'nativeLaunchImplemented': False,
        'mergedTerrainCommit': MERGED_TERRAIN_COMMIT,
        'preparedAtHead': git(ROOT, 'rev-parse', 'HEAD').decode().strip(),
        'sourceSha256': hashes, 'holdSha256': digest(original),
        'currentIncident': state.get('currentIncident'),
        'protectedWorktreeFiles': len(before['files']),
        'holdAndProtectedWorktreeUnchanged': True,
        'artifactSha256': {p.name: digest(p.read_bytes()) for p in sorted(output.iterdir())},
        'scope': 'Offline fixture, budgets and source provenance only; no native execution or permit.',
    }
    write('manifest.json', manifest)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path,
                        default=ROOT / 'dist/verification/terrain-native' / ('prepared-' + uuid.uuid4().hex))
    parser.add_argument('--protected-worktree', type=Path,
                        default=ROOT.parent / (ROOT.name + '-cpu-performance'))
    args = parser.parse_args()
    output = prepare(args.output, args.protected_worktree.resolve())
    print(json.dumps({'prepared': str(output), 'nativeExecution': False,
                      'blockRecovery': True, 'launchReady': False}))


if __name__ == '__main__':
    main()
