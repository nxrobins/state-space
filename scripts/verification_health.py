"""Lightweight host telemetry; never creates a graphics context or runs a load."""
import ctypes
from ctypes import wintypes as W
import json
import math
import os
import shutil
import subprocess
import threading
import time


class HostHealth:
    def __init__(self):
        self.previous = None
        self.portable = None
        if os.name != 'nt':
            try:
                import psutil
            except ImportError as error:
                raise RuntimeError('Portable host telemetry requires development dependencies; run uv sync.') from error
            self.portable = psutil
            psutil.cpu_percent(interval=None)  # Prime the first nonblocking interval.
            return
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.kernel.GetSystemTimes.argtypes = [ctypes.c_void_p] * 3

    def sample(self):
        if self.portable is not None:
            return {'time': time.time(), 'hostCpuPercent': self.portable.cpu_percent(interval=None),
                    'freeMemoryMiB': self.portable.virtual_memory().available / 1024**2}
        class Memory(ctypes.Structure):
            _fields_ = [('length', W.DWORD), ('load', W.DWORD)] + [
                (name, ctypes.c_uint64) for name in ('total', 'available', 'pageTotal', 'pageAvailable',
                                                   'virtualTotal', 'virtualAvailable', 'extended')]
        idle, kernel, user = ctypes.c_uint64(), ctypes.c_uint64(), ctypes.c_uint64()
        if not self.kernel.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
            raise ctypes.WinError(ctypes.get_last_error())
        current = (idle.value, kernel.value + user.value)
        cpu = None
        if self.previous:
            total = current[1] - self.previous[1]
            if total > 0:
                cpu = max(0, min(100, 100 * (1 - (current[0] - self.previous[0]) / total)))
        self.previous = current
        memory = Memory()
        memory.length = ctypes.sizeof(memory)
        if not self.kernel.GlobalMemoryStatusEx(ctypes.byref(memory)):
            raise ctypes.WinError(ctypes.get_last_error())
        return {'time': time.time(), 'hostCpuPercent': cpu, 'freeMemoryMiB': memory.available / 1024**2}


def gpu_sample():
    executable = shutil.which('nvidia-smi')
    if not executable:
        raise RuntimeError('NVIDIA telemetry unavailable; refusing a hardware verification run.')
    result = subprocess.run([executable, '--query-gpu=temperature.gpu,utilization.gpu,memory.free,power.draw',
                             '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=2,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    if result.returncode:
        raise RuntimeError('NVIDIA telemetry query failed.')
    rows = [[float(v.strip()) for v in line.split(',')] for line in result.stdout.strip().splitlines()]
    if len(rows) != 1 or len(rows[0]) != 4:
        raise RuntimeError('Expected one GPU with complete telemetry.')
    temperature, utilization, memory, power = rows[0]
    return {'time': time.time(), 'temperatureC': temperature, 'utilizationPercent': utilization,
            'freeMemoryMiB': memory, 'powerW': power}


def health_error(host, gpu=None, *, preflight=False):
    memory, cpu = host.get('freeMemoryMiB'), host.get('hostCpuPercent')
    if not isinstance(memory, (int, float)) or not math.isfinite(memory) or memory < 0:
        return 'Invalid host memory telemetry'
    if cpu is not None and (not isinstance(cpu, (int, float)) or not math.isfinite(cpu) or not 0 <= cpu <= 100):
        return 'Invalid host CPU telemetry'
    if host['freeMemoryMiB'] < 8192:
        return 'Less than 8 GiB system memory available'
    if preflight and host.get('hostCpuPercent') is not None and host['hostCpuPercent'] > 50:
        return 'Host CPU is busy before launch'
    if gpu:
        if gpu['temperatureC'] >= (65 if preflight else 75):
            return 'GPU temperature exceeds the verification budget'
        if gpu['freeMemoryMiB'] < 1024:
            return 'Less than 1 GiB GPU memory available'
        if preflight and gpu['utilizationPercent'] > 15:
            return 'GPU is busy before launch'
    return None


class GpuMonitor:
    def __init__(self, initial):
        self.latest = initial
        self.error = None
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def run(self):
        while not self.stopped.wait(2):
            try:
                self.latest = gpu_sample()
            except Exception as error:
                self.error = str(error)
                return

    def close(self):
        self.stopped.set()
        self.thread.join(timeout=3)


def append_sample(stream, sample):
    stream.write(json.dumps(sample, separators=(',', ':')) + '\n')
    stream.flush()
