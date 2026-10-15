"""One verification process tree, bounded lifetime/memory, and durable receipts.

Windows jobs contain descendants, including detached browser helpers:
https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects
No processes outside this job are terminated. Physics and frame timing are unchanged.
"""
import argparse
from contextlib import ExitStack
import ctypes
from ctypes import wintypes as W
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid
from scripts.verification_health import HostHealth, GpuMonitor, gpu_sample, health_error, append_sample

ROOT = Path(__file__).resolve().parent.parent


def assert_verification_allowed(root=ROOT, *, command=None, kind=None, timeout=None):
    """A reported host freeze suspends every supervised runtime workload.

    Keep this local latch outside the OS lease: leases disappear on reboot,
    whereas an unresolved host-safety incident must survive one. Do not parse
    the file to decide whether it applies; a damaged hold must also fail closed.
    Static inspection and isolated supervisor unit tests need no runtime job.
    """
    hold = root / 'dist/verification/safety-hold.json'
    if hold.exists():
        # Recovery is one exact command, consumed before launch. The global hold
        # stays in place, including across failures and subsequent reboots.
        try:
            state = json.loads(hold.read_text(encoding='utf-8'))
            permit = state['recoveryPermit']
            if (command is not None and permit['command'] == command and permit['kind'] == kind
                    and time.time() < permit['expiresAt'] <= time.time() + 600
                    and timeout is not None and timeout <= permit['timeoutSeconds'] <= 1800):
                state['lastRecovery'] = {**state.pop('recoveryPermit'), 'consumedAt': time.time()}
                hold.write_text(json.dumps(state, indent=2) + '\n', encoding='utf-8')
                return
        except (ValueError, KeyError, TypeError):
            pass
        raise RuntimeError(f'Verification suspended after a reported host freeze. '
                           f'No workload was launched. Review {hold} before resuming.')


class Lease:
    def __enter__(self):
        path = ROOT / 'dist/verification/lease.lock'
        path.parent.mkdir(parents=True, exist_ok=True)
        self.file = path.open('a+b')
        if path.stat().st_size == 0:
            self.file.write(b'0')
            self.file.flush()
        self.file.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.file.close()
            raise RuntimeError('Another State Space verification owns the lease. Wait or cancel that run.') from None
        return self

    def __exit__(self, *_):
        self.file.close()  # The OS also releases the lease after a crash.


class WindowsJob:
    def __init__(self, memory_bytes, cpu_percent):
        k = self.k = ctypes.WinDLL('kernel32', use_last_error=True)
        k.CreateJobObjectW.argtypes = [ctypes.c_void_p, W.LPCWSTR]
        k.CreateJobObjectW.restype = W.HANDLE
        k.SetInformationJobObject.argtypes = [W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD]
        k.AssignProcessToJobObject.argtypes = [W.HANDLE, W.HANDLE]
        k.TerminateJobObject.argtypes = [W.HANDLE, W.UINT]
        k.CloseHandle.argtypes = [W.HANDLE]
        class Basic(ctypes.Structure):
            _fields_ = [('processTime', ctypes.c_int64), ('jobTime', ctypes.c_int64), ('flags', W.DWORD),
                        ('minWorking', ctypes.c_size_t), ('maxWorking', ctypes.c_size_t), ('active', W.DWORD),
                        ('affinity', ctypes.c_size_t), ('priority', W.DWORD), ('scheduling', W.DWORD)]
        class Extended(ctypes.Structure):
            _fields_ = [('basic', Basic), ('io', ctypes.c_uint64 * 6), ('processMemory', ctypes.c_size_t),
                        ('jobMemory', ctypes.c_size_t), ('peakProcess', ctypes.c_size_t), ('peakJob', ctypes.c_size_t)]
        self.handle = k.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        info = Extended()
        self.extended_type = Extended
        info.basic.flags = 0x2000 | 0x200 | 0x8  # kill on close, job memory, active process limit
        info.basic.active = 64
        info.jobMemory = memory_bytes
        self.check(k.SetInformationJobObject(self.handle, 9, ctypes.byref(info), ctypes.sizeof(info)))
        if cpu_percent:
            rate = (W.DWORD * 2)(1 | 4, cpu_percent * 100)  # enabled hard cap, hundredths of a percent
            self.check(k.SetInformationJobObject(self.handle, 15, rate, ctypes.sizeof(rate)))

    def statistics(self):
        class Accounting(ctypes.Structure):
            _fields_ = [(name, ctypes.c_int64) for name in ('user', 'kernel', 'periodUser', 'periodKernel')] + [
                (name, W.DWORD) for name in ('pageFaults', 'totalProcesses', 'activeProcesses', 'terminatedProcesses')]
        accounting = Accounting()
        extended = self.extended_type()
        self.k.QueryInformationJobObject.argtypes = [W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD, ctypes.c_void_p]
        self.check(self.k.QueryInformationJobObject(self.handle, 1, ctypes.byref(accounting), ctypes.sizeof(accounting), None))
        self.check(self.k.QueryInformationJobObject(self.handle, 9, ctypes.byref(extended), ctypes.sizeof(extended), None))
        return {'cpuSeconds': (accounting.user + accounting.kernel) / 10**7,
                'activeProcesses': accounting.activeProcesses, 'peakMemoryMiB': extended.peakJob / 1024**2}

    @staticmethod
    def check(value):
        if not value:
            raise ctypes.WinError(ctypes.get_last_error())

    def assign_and_resume(self, child):
        self.check(self.k.AssignProcessToJobObject(self.handle, W.HANDLE(int(child._handle))))
        # Popen closes the original thread handle. The suspended child has exactly
        # one thread; enumerate and resume it only after containment is established.
        class Thread(ctypes.Structure):
            _fields_ = [('size', W.DWORD), ('usage', W.DWORD), ('tid', W.DWORD), ('pid', W.DWORD),
                        ('base', W.LONG), ('delta', W.LONG), ('flags', W.DWORD)]
        k = self.k
        k.CreateToolhelp32Snapshot.argtypes = [W.DWORD, W.DWORD]
        k.CreateToolhelp32Snapshot.restype = W.HANDLE
        k.Thread32First.argtypes = k.Thread32Next.argtypes = [W.HANDLE, ctypes.POINTER(Thread)]
        k.OpenThread.argtypes = [W.DWORD, W.BOOL, W.DWORD]
        k.OpenThread.restype = W.HANDLE
        k.ResumeThread.argtypes = [W.HANDLE]
        k.ResumeThread.restype = W.DWORD
        snapshot = k.CreateToolhelp32Snapshot(4, 0)
        if snapshot == W.HANDLE(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        resumed = False
        try:
            row = Thread(); row.size = ctypes.sizeof(row)
            more = k.Thread32First(snapshot, ctypes.byref(row))
            while more:
                if row.pid == child.pid:
                    thread = k.OpenThread(2, False, row.tid)
                    self.check(thread)
                    try:
                        if k.ResumeThread(thread) == 0xffffffff:
                            raise ctypes.WinError(ctypes.get_last_error())
                        resumed = True
                    finally:
                        k.CloseHandle(thread)
                more = k.Thread32Next(snapshot, ctypes.byref(row))
        finally:
            k.CloseHandle(snapshot)
        if not resumed:
            raise RuntimeError('Suspended verification thread was not found; refusing to run uncontained.')

    def close(self):
        if self.handle:
            self.k.TerminateJobObject(self.handle, 125)
            self.k.CloseHandle(self.handle)
            self.handle = None


def guarded_entry(kind, timeout=600, *, module=None):
    """Re-enter this Python module under the supervisor when invoked directly."""
    if not os.environ.get('STATE_SPACE_VERIFICATION_JOB'):
        module = module or 'scripts.' + Path(sys.argv[0]).stem
        command = [sys.executable, '-m', 'scripts.verification_guard', '--kind', kind,
                   '--timeout', str(timeout), '--', sys.executable, '-m', module, *sys.argv[1:]]
        raise SystemExit(subprocess.call(command, cwd=ROOT))


def main():
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kind', choices=['cpu', 'gpu', 'frames'], required=True)
    parser.add_argument('--timeout', type=float, default=600)
    parser.add_argument('--stall', type=float, default=40)
    parser.add_argument('--output', type=Path)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command or not 0 < args.timeout <= 1800 or not 0 < args.stall <= args.timeout:
        parser.error('A command and bounded timeout/stall interval are required.')
    run_id = uuid.uuid4().hex
    out = args.output or ROOT / 'dist/verification' / run_id
    out.mkdir(parents=True, exist_ok=True)
    cpu_limit = 6 if args.kind == 'cpu' else 12 if args.kind == 'gpu' else 0
    memory_limit = 4096 if args.kind == 'cpu' else 8192
    receipt = {'version': 2, 'id': run_id, 'kind': args.kind, 'command': command, 'startedAt': time.time(),
               'passed': False, 'memoryLimitMiB': memory_limit, 'cpuLimitPercent': cpu_limit or None,
               'timeoutSeconds': args.timeout, 'stallSeconds': args.stall, 'maxMonitorLagMs': 0,
               'containment': 'Windows job' if os.name == 'nt' else 'POSIX process group'}
    job = child = gpu_monitor = None
    def save():
        pending = out / 'report.tmp'
        with pending.open('w', encoding='utf-8') as stream:
            stream.write(json.dumps(receipt, indent=2) + '\n'); stream.flush(); os.fsync(stream.fileno())
        pending.replace(out / 'report.json')
    def stop():
        if job:
            job.close()
        elif child and child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
    try:
        with Lease(), ExitStack() as streams:
            assert_verification_allowed(ROOT, command=command, kind=args.kind, timeout=args.timeout)
            telemetry = streams.enter_context((out / 'telemetry.jsonl').open('w', encoding='utf-8'))
            health = HostHealth()
            health.sample()
            time.sleep(1)
            host = health.sample()
            gpu = gpu_sample() if args.kind in ('gpu', 'frames') else None
            append_sample(telemetry, {'stage': 'preflight', 'host': host, 'gpu': gpu})
            error = health_error(host, gpu, preflight=True)
            if error:
                raise RuntimeError(error)
            receipt['preflight'] = {'host': host, 'gpu': gpu}
            if gpu:
                gpu_monitor = GpuMonitor(gpu)
            stdout = streams.enter_context((out / 'stdout.log').open('wb'))
            stderr = streams.enter_context((out / 'stderr.log').open('wb'))
            env = {**os.environ, 'STATE_SPACE_VERIFICATION_JOB': run_id,
                   'STATE_SPACE_VERIFY_YIELD_MS': '20', 'PYTHONIOENCODING': 'utf-8',
                   'OMP_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1', 'OPENBLAS_NUM_THREADS': '1'}
            if os.name == 'nt':
                job = WindowsJob(memory_limit * 1024**2, cpu_limit)
                flags = 4 | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
                if args.kind != 'frames':
                    flags |= subprocess.BELOW_NORMAL_PRIORITY_CLASS
                child = subprocess.Popen(command, cwd=ROOT, env=env, stdout=stdout, stderr=stderr, creationflags=flags)
                try:
                    job.assign_and_resume(child)
                except BaseException:
                    child.kill()
                    raise
            else:
                child = subprocess.Popen(command, cwd=ROOT, env=env, stdout=stdout, stderr=stderr, start_new_session=True)
            receipt['childPid'] = child.pid
            save()
            start = last_output = previous = time.monotonic()
            sizes = (0, 0); offsets = [0, 0]
            last_sample = start; overloaded_since = None
            while child.poll() is None:
                time.sleep(.2)
                now = time.monotonic()
                lag = max(0, now - previous - .2)
                receipt['maxMonitorLagMs'] = max(receipt['maxMonitorLagMs'], round(lag * 1000, 3)); previous = now
                current = tuple((out / p).stat().st_size for p in ['stdout.log', 'stderr.log'])
                if current != sizes:
                    last_output = now; sizes = current
                    for i, (name, stream) in enumerate([('stdout.log', sys.stdout), ('stderr.log', sys.stderr)]):
                        with (out / name).open('rb') as reader:
                            reader.seek(offsets[i]); data = reader.read(); offsets[i] += len(data)
                            if data:
                                receipt['lastOutput'] = data.decode('utf-8', errors='replace').splitlines()[-1][-300:]
                                stream.write(data.decode('utf-8', errors='replace')); stream.flush()
                if now - last_sample >= 1:
                    host = health.sample(); gpu = gpu_monitor.latest if gpu_monitor else None
                    stats = job.statistics() if job else None
                    receipt['lastHealth'] = {'host': host, 'gpu': gpu, 'job': stats}
                    append_sample(telemetry, {'stage': 'running', **receipt['lastHealth']})
                    last_sample = now
                    error = health_error(host, gpu)
                    if gpu_monitor and (gpu_monitor.error or time.time() - gpu['time'] > 6):
                        error = gpu_monitor.error or 'GPU telemetry stopped responding'
                    busy = host.get('hostCpuPercent', 0) > 85
                    overloaded_since = (overloaded_since or now) if busy else None
                    if overloaded_since and now - overloaded_since >= 2:
                        error = 'Host CPU exceeded 85 percent for two seconds'
                    if error:
                        receipt['error'] = error; stop(); break
                save()
                if lag > 2 or now - start > args.timeout or now - last_output > args.stall or (out / 'cancel').exists():
                    receipt['error'] = 'Host monitor stalled' if lag > 2 else 'Cancelled' if (out / 'cancel').exists() else 'Timeout or missing progress'
                    stop(); break
            receipt['exitCode'] = child.wait(timeout=10)
            receipt['passed'] = receipt['exitCode'] == 0 and 'error' not in receipt
    except BaseException as error:
        receipt['error'] = repr(error)
        stop()
    finally:
        stop()
        if gpu_monitor:
            gpu_monitor.close()
        receipt['finishedAt'] = time.time()
        save()
    if 'error' in receipt:
        print('Verification stopped: ' + receipt['error'], file=sys.stderr, flush=True)
    print(f'Verification receipt: {out / "report.json"}', flush=True)
    return 0 if receipt['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
