"""Independent Windows deadline watchdog. No disk, logging, or telemetry in its loop.

The supervisor creates a random named Job and pagefile-backed control mapping.
This process opens only that Job, before the workload is resumed. It remains
outside the workload's CPU cap. It cannot recover a whole-kernel/driver stall.
"""
import argparse
import ctypes
from ctypes import wintypes as W
import math
import mmap
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import time

MAGIC = b'SSVWD001'
SIZE = 64
DEADLINE, HEARTBEAT, WATCHBEAT, STOP, REASON = 8, 16, 24, 32, 36
REASONS = {1: 'Supervisor heartbeat expired', 2: 'Independent job deadline expired',
           3: 'Invalid watchdog control state', 4: 'Watchdog could not open its job',
           5: 'Independent job termination failed'}


def deadline_reason(now, heartbeat, deadline):
    if not all(math.isfinite(v) for v in (now, heartbeat, deadline)) or heartbeat > now + 1:
        return 3
    if now >= deadline:
        return 2
    if now - heartbeat > 3:
        return 1
    return 0


class IndependentWatchdog:
    def __init__(self, run_id, timeout):
        if os.name != 'nt' or not re.fullmatch('[0-9a-f]{32}', run_id):
            raise RuntimeError('Independent verification watchdog requires Windows and a fresh run ID')
        self.job_name = 'Local\\StateSpaceVerify-' + run_id
        self.mapping = mmap.mmap(-1, SIZE, tagname='Local\\StateSpaceWatch-' + run_id)
        self.mapping[:] = bytes(SIZE)
        self.mapping[:8] = MAGIC
        now = time.monotonic()
        struct.pack_into('<dd', self.mapping, DEADLINE, now + timeout, now)
        self.child = None
        try:
            self.child = subprocess.Popen([sys.executable, '-m', 'scripts.verification_watchdog',
                '--run-id', run_id], cwd=Path(__file__).resolve().parent.parent,
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW, close_fds=True)
            ready_by = now + 3
            while struct.unpack_from('<d', self.mapping, WATCHBEAT)[0] == 0:
                if self.child.poll() is not None or time.monotonic() >= ready_by:
                    raise RuntimeError('Independent watchdog did not arm; workload was not resumed')
                time.sleep(.02)
            self.pulse()
        except BaseException:
            self.close()
            raise

    def pulse(self):
        reason = struct.unpack_from('<I', self.mapping, REASON)[0]
        if reason:
            raise RuntimeError(REASONS.get(reason, 'Independent watchdog failed'))
        now = time.monotonic()
        beat = struct.unpack_from('<d', self.mapping, WATCHBEAT)[0]
        if self.child.poll() is not None or not math.isfinite(beat) or now - beat > 1:
            raise RuntimeError('Independent watchdog stopped responding')
        struct.pack_into('<d', self.mapping, HEARTBEAT, now)

    def failure_reason(self):
        reason = struct.unpack_from('<I', self.mapping, REASON)[0]
        return REASONS.get(reason, 'Independent watchdog failed') if reason else None

    def close(self, *, disarm=True):
        # Call only after terminating/closing the owned workload Job.
        if disarm:
            struct.pack_into('<I', self.mapping, STOP, 1)
        try:
            if self.child:
                try:
                    self.child.wait(timeout=1 if disarm else 4)
                except subprocess.TimeoutExpired:
                    if not disarm:
                        # Leave the independent deadline armed if cleanup could
                        # not close the workload Job. Never silence it here.
                        raise RuntimeError('Watchdog remains armed after failed Job cleanup') from None
                    self.child.kill()
                    self.child.wait(timeout=1)
        finally:
            self.mapping.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-id', required=True)
    run_id = parser.parse_args().run_id
    if os.name != 'nt' or not re.fullmatch('[0-9a-f]{32}', run_id):
        raise RuntimeError('Invalid watchdog identity')
    control = mmap.mmap(-1, SIZE, tagname='Local\\StateSpaceWatch-' + run_id)
    if control[:8] != MAGIC:
        control.close()
        raise RuntimeError('Supervisor did not initialize watchdog')
    k = ctypes.WinDLL('kernel32', use_last_error=True)
    k.OpenJobObjectW.argtypes = [W.DWORD, W.BOOL, W.LPCWSTR]
    k.OpenJobObjectW.restype = W.HANDLE
    k.TerminateJobObject.argtypes = [W.HANDLE, W.UINT]
    k.CloseHandle.argtypes = [W.HANDLE]
    job = k.OpenJobObjectW(0x8, False, 'Local\\StateSpaceVerify-' + run_id)
    if not job:
        struct.pack_into('<I', control, REASON, 4)
        control.close()
        return 1
    try:
        while True:
            now = time.monotonic()
            struct.pack_into('<d', control, WATCHBEAT, now)
            if struct.unpack_from('<I', control, STOP)[0]:
                return 0
            deadline, heartbeat = struct.unpack_from('<dd', control, DEADLINE)
            reason = deadline_reason(now, heartbeat, deadline)
            if reason:
                struct.pack_into('<I', control, REASON, reason)
                if not k.TerminateJobObject(job, 125):
                    struct.pack_into('<I', control, REASON, 5)
                return 125
            time.sleep(.05)
    finally:
        k.CloseHandle(job)
        control.close()


if __name__ == '__main__':
    raise SystemExit(main())
