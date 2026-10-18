"""One explicitly authorized CPU edit-only stage; production recovery stays blocked.

Uses the real supervisor, lease, health checks, Job and independent watchdog.
Only its authorization callback is scoped to the recorded exact command/hashes.
No persistent permit, substituted telemetry, root override or GPU job is used.
"""
import ctypes
from ctypes import wintypes as W
import hashlib
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path.cwd()
OUT = Path(__file__).resolve().parent / sys.argv[1]
assert OUT.parent == Path(__file__).resolve().parent and OUT.name.startswith('attempt-')
manifest = json.loads((OUT / 'authorization.json').read_text(encoding='utf-8'))
if (OUT / 'report.json').exists():
    raise RuntimeError('Refusing to overwrite an existing attempt')

def check_sources():
    for name, expected in manifest['sourceHashes'].items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
            raise RuntimeError('Source changed since authorization: ' + name)
    state = json.loads((ROOT / 'dist/verification/safety-hold.json').read_text(encoding='utf-8'))
    if state.get('blockRecovery') is not True or 'recoveryPermit' in state:
        raise RuntimeError('The global hold must remain blocked with no permit')

check_sources()
sys.path.insert(0, str(ROOT))
from scripts import verification_guard as guard

consumed = False
def authorize_this_cpu_stage(root=ROOT, *, command=None, kind=None, timeout=None):
    global consumed
    check_sources()
    if (consumed or root != ROOT or kind != 'cpu' or timeout != 30
            or command != manifest['command'] or time.time() >= manifest['expiresAt']):
        raise RuntimeError('Outside the exact user-authorized CPU edit-only intervention stage')
    consumed = True

# A process-local, one-use exception implements this turn's explicit approval.
# All on-disk runtime/leaf entry points continue to see the unchanged hard hold.
guard.assert_verification_allowed = authorize_this_cpu_stage
for key in ('STATE_SPACE_VERIFICATION_JOB', 'STATE_SPACE_TEST_CONTAINMENT',
            'STATE_SPACE_RUN_LEGACY_DEMOS', 'NODE_V8_COVERAGE'):
    os.environ.pop(key, None)
os.environ['NODE_OPTIONS'] = '--max-old-space-size=256'
os.environ['NO_COLOR'] = '1'
os.environ.pop('FORCE_COLOR', None)
sys.argv = ['verification_guard', '--kind', 'cpu', '--timeout', '30', '--stall', '20',
            '--output', str(OUT), '--', *manifest['command']]
result = guard.main()
check_sources()
report = json.loads((OUT / 'report.json').read_text(encoding='utf-8'))

# Inspect only the owned workload and named Job. Never kill unrelated processes.
k = ctypes.WinDLL('kernel32', use_last_error=True)
k.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]; k.OpenProcess.restype = W.HANDLE
k.OpenJobObjectW.argtypes = [W.DWORD, W.BOOL, W.LPCWSTR]; k.OpenJobObjectW.restype = W.HANDLE
k.GetExitCodeProcess.argtypes = [W.HANDLE, ctypes.POINTER(W.DWORD)]
k.CloseHandle.argtypes = [W.HANDLE]
running = False
if report.get('childPid'):
    handle = k.OpenProcess(0x1000, False, report['childPid'])
    if handle:
        try:
            status = W.DWORD()
            if not k.GetExitCodeProcess(handle, ctypes.byref(status)):
                raise ctypes.WinError(ctypes.get_last_error())
            running = status.value == 259
        finally:
            k.CloseHandle(handle)
handle = k.OpenJobObjectW(4, False, 'Local\\StateSpaceVerify-' + report['id'])
job_exists = bool(handle)
if handle:
    k.CloseHandle(handle)
cleanup = {'workloadStillRunning': running, 'namedJobStillExists': job_exists,
           'globalHoldAndSourceHashesUnchanged': True, 'authorizationConsumed': consumed,
           'GPUReplayBenchmarksAllowed': False}
(OUT / 'cleanup.json').write_text(json.dumps(cleanup, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'cleanup': cleanup}), flush=True)
if running or job_exists:
    raise RuntimeError('Containment cleanup did not finish; stop')
raise SystemExit(result)
