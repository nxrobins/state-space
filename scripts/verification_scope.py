"""One-use, mode-bound browser containment capabilities. Never changes the hold.

This is an accidental-misuse boundary, not a sandbox against a malicious local
user who can edit the supervisor. Generic verification never accepts this grant.
"""
import ctypes
from ctypes import wintypes as W
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
HOLD = ROOT / 'dist/verification/safety-hold.json'
BASE = ROOT / 'dist/verification/browser-containment'
PYTHON = str(Path(sys._base_executable).resolve())
CASES = ('unit', 'startup-close', 'stalled-cdp', 'supervisor-loss')
LIMITS = {'cpuPercent': 6, 'memoryMiB': 4096, 'deadlineSeconds': 30,
          'quietSeconds': 30, 'quietCpuPercent': 30, 'freeMemoryMiB': 8192}
MODES = ('gpu-disabled', 'gpu-enabled')
SOURCES = (
    'scripts/verification_scope.py', 'scripts/verification_restricted_browser.py',
    'scripts/verify_browser_containment.py', 'scripts/verification_guard.py',
    'scripts/verification_health.py', 'scripts/verification_watchdog.py',
    'scripts/verification_journal.py', 'scripts/prepare_terrain_validation.py',
    'tests/test_verification_scope.py', 'tests/test_restricted_browser.py',
    'tests/test_verification_observer.py',
)


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def read_json(path):
    path = Path(path)
    if path.stat().st_size > 1024 * 1024:
        raise RuntimeError('Oversized control file')
    return json.loads(path.read_text(encoding='utf-8'))


def exclusive_json(path, value):
    # Exclusive creation: even an incomplete claim is spent and needs review.
    with Path(path).open('x', encoding='utf-8') as stream:
        json.dump(value, stream, allow_nan=False, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


def hold_identity():
    state = read_json(HOLD)
    if state.get('blockRecovery') is not True or 'recoveryPermit' in state:
        raise RuntimeError('Expected intact hard hold without a recovery permit')
    incident = state['currentIncident']
    return {'sha256': sha(HOLD), 'incident': incident}


def limits_for(mode, case='startup-close'):
    if mode not in MODES or case not in CASES:
        raise RuntimeError('Unknown containment mode or case')
    if mode == 'gpu-enabled' and case != 'unit':
        return {**LIMITS, 'cpuPercent': 12, 'memoryMiB': 8192}
    return dict(LIMITS)


def browser_arguments(profile, mode='gpu-disabled'):
    # No external URL, flags, extensions, JavaScript, or user profile accepted.
    if mode not in MODES:
        raise RuntimeError('Unknown browser mode')
    graphics = ['--enable-gpu', '--disable-software-rasterizer'] if mode == 'gpu-enabled' else [
        '--disable-gpu', '--disable-gpu-compositing',
        '--disable-software-rasterizer', '--disable-3d-apis', '--disable-webgl',
        '--disable-accelerated-2d-canvas', '--disable-webgpu',
        '--disable-blink-features=WebGPU',
    ]
    return [
        '--headless=new', *graphics,
        '--disable-background-networking', '--disable-component-update',
        '--disable-sync', '--disable-extensions', '--disable-default-apps',
        '--disable-component-extensions-with-background-pages',
        '--disable-domain-reliability', '--no-pings', '--metrics-recording-only',
        '--disable-features=OptimizationHints,MediaRouter,AutofillServerCommunication,WebUIOmniboxPopup,WebUIOmniboxAimPopup',
        '--host-resolver-rules=MAP * ~NOTFOUND',
        '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
        '--no-first-run', '--no-default-browser-check', '--noerrdialogs', '--enable-automation',
        '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
        '--window-size=384,216', f'--user-data-dir={profile}', 'about:blank',
    ]


def browser_files(browser):
    browser = Path(browser).resolve(strict=True)
    if browser.name != 'chrome.exe':
        raise RuntimeError('This reviewed launcher supports installed Chrome only')
    # chrome.exe dispatches into a versioned DLL. Pin all installed versions so
    # an auto-update or old/new version selection cannot escape the review.
    files = [browser]
    for directory in sorted(browser.parent.iterdir()):
        if directory.is_dir() and re.fullmatch(r'\d+(\.\d+){3}', directory.name):
            files.extend(directory / name for name in ('chrome.dll', 'chrome_elf.dll'))
    if len(files) < 3 or not all(path.is_file() for path in files):
        raise RuntimeError('Incomplete installed browser identity')
    return {str(path): sha(path) for path in files}


def source_hashes():
    return {name: sha(ROOT / name) for name in SOURCES}


def validate_review(review):
    mode = review.get('mode')
    if (review['version'] != 2 or review['limits'] != limits_for(mode)
            or review['cases'] != list(CASES) or review['root'] != str(ROOT)
            or review['hold'] != hold_identity()
            or review['sources'] != source_hashes()
            or review['python'] != {'path': PYTHON, 'sha256': sha(PYTHON)}
            or review['browserFiles'] != browser_files(review['browser'])
            or review['arguments'] != browser_arguments('<owned-profile>', mode)):
        raise RuntimeError('Reviewed scope, sources, browser, or incident changed')


def attempt_path(path):
    path = Path(path).resolve(strict=True)
    if (path.parent.parent != BASE.resolve() or path.name not in CASES
            or not re.fullmatch('[0-9a-f]{32}', path.parent.name)):
        raise RuntimeError('Attempt is outside its fresh owned packet')
    return path


def command(attempt, role):
    if role not in ('supervise', 'leaf'):
        raise RuntimeError('Unknown containment role')
    module = ('scripts.verify_browser_containment' if role == 'supervise'
              else 'scripts.verification_restricted_browser')
    # Bypass the Windows venv redirector so Popen PID and actual supervisor/leaf
    # PID are identical. These helpers use only the standard library.
    return [PYTHON, '-I', '-u', str(ROOT / (module.replace('.', '/') + '.py')),
            str(attempt)]


def validate_capability(attempt, *, now=None):
    attempt = attempt_path(attempt)
    review = read_json(attempt.parent / 'review.json')
    validate_review(review)
    cap = read_json(attempt / 'capability.json')
    now = time.time() if now is None else now
    if (cap['version'] != 2 or cap['case'] != attempt.name or cap['mode'] != review['mode']
            or cap['limits'] != limits_for(review['mode'], attempt.name)
            or cap['reviewSha256'] != sha(attempt.parent / 'review.json')
            or not re.fullmatch('[0-9a-f]{32}', cap['runId'])
            or cap['command'] != command(attempt, 'leaf')
            or cap['supervisorCommand'] != command(attempt, 'supervise')
            or cap['browserArguments'] != browser_arguments(attempt / 'profile', review['mode'])
            or not all(type(cap[k]) in (int, float) and math.isfinite(cap[k])
                       for k in ('issuedAt', 'expiresAt'))
            or not cap['issuedAt'] <= now < cap['expiresAt'] <= cap['issuedAt'] + 60):
        raise RuntimeError('Invalid, altered, or expired containment capability')
    claim = read_json(attempt / 'claim.json')
    if claim != {'capabilitySha256': sha(attempt / 'capability.json'),
                 'ownerPid': cap['ownerPid']}:
        raise RuntimeError('Capability has not been consumed by its lease owner')
    lock = read_json(attempt.parent / 'execution.lock')
    if lock != {'ownerPid': cap['ownerPid'], 'case': cap['case'],
                'reviewSha256': cap['reviewSha256']}:
        raise RuntimeError('Capability is not attached to the current execution lock')
    return cap, review


class JobInventoryError(RuntimeError):
    def __init__(self, message, samples):
        super().__init__(message)
        self.samples = samples


class JobObserver:
    """Query the exact named job; a job ID environment variable is insufficient."""
    def __init__(self, run_id, *, optional=False):
        if os.name != 'nt' or not re.fullmatch('[0-9a-f]{32}', run_id):
            raise RuntimeError('Windows containment identity required')
        self.k = ctypes.WinDLL('kernel32', use_last_error=True)
        self.k.OpenJobObjectW.argtypes = [W.DWORD, W.BOOL, W.LPCWSTR]
        self.k.OpenJobObjectW.restype = W.HANDLE
        self.k.CloseHandle.argtypes = [W.HANDLE]
        self.k.QueryInformationJobObject.argtypes = [W.HANDLE, ctypes.c_int,
                                                     ctypes.c_void_p, W.DWORD, ctypes.c_void_p]
        self.k.IsProcessInJob.argtypes = [W.HANDLE, W.HANDLE, ctypes.POINTER(W.BOOL)]
        self.k.GetCurrentProcess.restype = W.HANDLE
        self.k.TerminateJobObject.argtypes = [W.HANDLE, W.UINT]
        self.inventory_samples = []
        self.handle = self.k.OpenJobObjectW(0x4 | 0x8, False, 'Local\\StateSpaceVerify-' + run_id)
        if not self.handle and (not optional or ctypes.get_last_error() != 2):
            raise ctypes.WinError(ctypes.get_last_error())

    def require_membership(self):
        result = W.BOOL()
        if (not self.handle or not self.k.IsProcessInJob(self.k.GetCurrentProcess(), self.handle,
                                                       ctypes.byref(result)) or not result.value):
            raise RuntimeError('Leaf is not a member of the authorized Windows Job')

    def pids(self):
        class ProcessList(ctypes.Structure):
            _fields_ = [('assigned', W.DWORD), ('count', W.DWORD), ('ids', ctypes.c_size_t * 64)]
        samples = []
        for attempt in range(3):
            value, returned = ProcessList(), W.DWORD()
            ok = self.k.QueryInformationJobObject(self.handle, 3, ctypes.byref(value),
                                                  ctypes.sizeof(value), ctypes.byref(returned))
            error = ctypes.get_last_error() if not ok else 0
            pids = list(value.ids[:min(value.count, 64)])
            sample = {'time': time.time(), 'apiSucceeded': bool(ok), 'win32Error': error,
                      'returnedBytes': returned.value, 'capacity': 64,
                      'assigned': value.assigned, 'count': value.count, 'pids': pids}
            samples.append(sample)
            # Keep bounded recent history even if a later complete query succeeds.
            self.inventory_samples = (getattr(self, 'inventory_samples', []) + [sample])[-32:]
            if not ok:
                raise JobInventoryError('Owned-process inventory API failed', samples)
            if value.assigned > 64 or value.count > 64 or value.count > value.assigned:
                raise JobInventoryError('Owned-process inventory exceeds its envelope', samples)
            required = ProcessList.ids.offset + value.count * ctypes.sizeof(ctypes.c_size_t)
            if not required <= returned.value <= ctypes.sizeof(value):
                raise JobInventoryError('Invalid owned-process inventory byte count', samples)
            if any(pid <= 0 for pid in pids) or len(set(pids)) != len(pids):
                raise JobInventoryError('Invalid owned-process identifiers', samples)
            if value.count == value.assigned:
                return pids
            # Never treat a partial list as empty. Only a fresh complete query
            # can recover an in-envelope mismatch; persistent mismatch fails.
            if attempt < 2:
                time.sleep(.02)
        raise JobInventoryError('Incomplete owned-process inventory', samples)

    def active_processes(self):
        """Independent accounting query for cleanup, not PID-list acceptance."""
        class Accounting(ctypes.Structure):
            _fields_ = [(name, ctypes.c_int64) for name in ('user', 'kernel', 'periodUser', 'periodKernel')] + [
                (name, W.DWORD) for name in ('pageFaults', 'totalProcesses', 'activeProcesses', 'terminatedProcesses')]
        value = Accounting()
        if not self.k.QueryInformationJobObject(self.handle, 1, ctypes.byref(value),
                                               ctypes.sizeof(value), None):
            raise ctypes.WinError(ctypes.get_last_error())
        return value.activeProcesses

    def terminate(self):
        if not self.k.TerminateJobObject(self.handle, 125):
            raise ctypes.WinError(ctypes.get_last_error())

    def close(self):
        if self.handle:
            if not self.k.CloseHandle(self.handle):
                raise ctypes.WinError(ctypes.get_last_error())
            self.handle = None


def claim_leaf(attempt):
    cap, review = validate_capability(attempt)
    supervisor = read_json(Path(attempt) / 'supervisor.json')
    if (supervisor['pid'] != os.getppid() or supervisor['runId'] != cap['runId']
            or supervisor['capabilitySha256'] != sha(Path(attempt) / 'capability.json')):
        raise RuntimeError('Leaf parent does not own this capability')
    job = JobObserver(cap['runId'])
    try:
        job.require_membership()
        exclusive_json(Path(attempt) / 'leaf-claim.json', {'pid': os.getpid(),
                       'parentPid': os.getppid(), 'capabilitySha256': sha(Path(attempt) / 'capability.json')})
    finally:
        job.close()
    return cap, review
