"""Private CPU-only leaf: validates ownership before importing either engine."""
import importlib.abc
import importlib.util
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time
import traceback

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.collision_cpu_scope import (
    ROOT, DEPENDENCIES, WINDOWS_COMMAND, claim_leaf, claim_node, node_command, exclusive_json,
)
from scripts.verification_journal import durable_json


class NoGraphics(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if (fullname.split('.')[0] in ('glfw', 'OpenGL', 'moderngl', 'wgpu')
                or fullname == 'mujoco._render'
                or fullname.startswith(('mujoco.rendering', 'mujoco.renderer', 'mujoco.viewer',
                                        'mujoco.studio', 'mujoco.glfw', 'mujoco.egl', 'mujoco.osmesa'))):
            raise ImportError('Graphics imports are outside the reviewed CPU scope: ' + fullname)
        return None


def deny_external(event, args):
    if event.startswith('socket.') or event in ('subprocess.Popen', 'os.system', 'os.startfile'):
        raise RuntimeError('External operation outside the fixed CPU scope: ' + event)


def platform_metadata():
    # This fixed stdlib query runs only after live Job ownership is claimed.
    # CPython on Windows reads the local hostname and may invoke cmd /c ver.
    # Pin platform.py and cmd.exe, fix ComSpec, then populate uname's cache
    # before denying all socket/process events during dependency import/use.
    if sys.platform != 'win32' or os.environ.get('ComSpec') != WINDOWS_COMMAND:
        raise RuntimeError('Expected the pinned Windows metadata command')
    info = platform.uname()
    if info.system != 'Windows':
        raise RuntimeError('Unexpected operating system identity')
    return {key: getattr(info, key) for key in ('system', 'release', 'version', 'machine')}


def mujoco_rows(attempt, review, case):
    host = platform_metadata()
    durable_json(attempt / 'platform.json', host)
    sys.meta_path.insert(0, NoGraphics())
    sys.addaudithook(deny_external)
    sys.path[:] = [path for path in sys.path if 'site-packages' not in Path(path).parts]
    sys.path.insert(0, str(DEPENDENCIES))
    import importlib.metadata
    import numpy as np
    import mujoco as mj
    packet = json.loads((Path(review['benchmark']['directory']) / 'packet.json').read_text())
    protocol = packet['protocol']
    if (np.__version__ != protocol['numpyVersion']
            or mj.__version__ != protocol['mujocoVersion']
            or importlib.metadata.version('mujoco-core') != protocol['mujocoVersion']
            or not hasattr(mj.mjtEnableBit, 'mjENBL_SPECULATIVE')):
        raise RuntimeError('Pinned CPU dependency version/capability mismatch')
    spec = importlib.util.spec_from_file_location(
        'collision_mujoco', ROOT / 'scripts/collision-reference/mujoco_runner.py')
    adapter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(adapter)
    scene = next(s for s in packet['fixtures'] if s['id'] == case.removeprefix('mj-'))
    rows = []
    result = {'packetSha256': review['benchmark']['packetSha256'], 'rows': rows,
              'environment': {'python': sys.version, 'mujoco': mj.__version__, 'numpy': np.__version__,
                              'cpuOnly': True, 'graphicsImportsBlocked': True, 'host': host}}
    for dt in protocol['timesteps']:
        for speculative in (False, True):
            evidence = {}
            try:
                row = adapter.run_case(mj, np, scene, dt, protocol, speculative, evidence)
            except Exception as error:
                row = {'status': 'failed', 'scene': scene['id'], 'dt': dt,
                       'backend': 'mujoco-speculative' if speculative else 'mujoco-discrete',
                       'error': repr(error), 'partial': evidence, 'timing': None}
            rows.append(row)
            durable_json(attempt / 'result.json', result)
            if row['status'] != 'completed':
                return False
    return True


def main():
    if len(sys.argv) == 3 and sys.argv[1] == '--claim-node':
        claim_node(sys.argv[2])
        return 0
    if len(sys.argv) != 2:
        raise RuntimeError('Private fixed CPU invocation only')
    attempt = Path(sys.argv[1]).resolve(strict=True)
    cap, review = claim_leaf(attempt)
    receipt = {'passed': False, 'case': cap['case'], 'cpuOnly': True,
               'runtimeAcceptance': False, 'performanceAcceptance': False}
    try:
        for name in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
            if os.environ.get(name) != '1':
                raise RuntimeError('Single-thread CPU dependency environment required')
        case = cap['case']
        if case in ('stalled-cpu', 'supervisor-loss'):
            exclusive_json(attempt / 'fault-ready.json', {'pid': os.getpid(), 'case': case})
            while True:
                time.sleep(.1)  # Inert, not a stress test. The owned Job must terminate this process.
        elif case == 'startup-close':
            receipt['passed'] = True
        elif case == 'world-reference' or case.startswith('ss-'):
            fixed_command = node_command(attempt)
            child = subprocess.Popen(fixed_command, cwd=ROOT, stdin=subprocess.DEVNULL,
                                     creationflags=subprocess.CREATE_NO_WINDOW, close_fds=True)
            exclusive_json(attempt / 'node-start.json', {
                'pid': child.pid, 'parentPid': os.getpid(), 'command': fixed_command})
            receipt['nodeExitCode'] = child.wait(timeout=22)
            receipt['passed'] = receipt['nodeExitCode'] == 0
        elif case.startswith('mj-'):
            receipt['passed'] = mujoco_rows(attempt, review, case)
        else:
            raise RuntimeError('Unknown CPU case')
    except BaseException as error:
        receipt['error'] = repr(error)
        receipt['traceback'] = traceback.format_exc()
    durable_json(attempt / 'leaf-report.json', receipt)
    return 0 if receipt['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())

