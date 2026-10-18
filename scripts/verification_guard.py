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
from scripts.verification_watchdog import IndependentWatchdog
from scripts.verification_journal import durable_json

ROOT = Path(__file__).resolve().parent.parent


class DurableProgress:
    """Only consecutive writer acknowledgements count as structured progress."""
    def __init__(self, job):
        self.job = job
        self.sequence = 0
        self.tail = ''

    def feed(self, data):
        self.tail += data.decode('utf-8', errors='replace')
        lines = self.tail.split('\n')
        self.tail = lines.pop()
        if len(self.tail) > 8192 or any(len(line) > 8192 for line in lines):
            raise RuntimeError('Oversized progress record')
        changed = False
        for line in lines:
            if not line.startswith('STATE_SPACE_PROGRESS '):
                continue
            event = json.loads(line[len('STATE_SPACE_PROGRESS '):])
            if (not isinstance(event, dict) or event.get('job') != self.job
                    or type(event.get('sequence')) is not int or event['sequence'] != self.sequence + 1):
                raise RuntimeError('Invalid durable progress sequence')
            self.sequence = event['sequence']
            changed = True
        return changed

    def finish(self):
        if not self.sequence or self.tail:
            raise RuntimeError('Missing or truncated final durable progress')


def drain_output(out, offsets, progress=None, *, final=False, watchdog=None):
    """Bound each read, including output produced immediately before exit."""
    changed = False
    last_line = None
    for i, (name, stream) in enumerate((('stdout.log', sys.stdout), ('stderr.log', sys.stderr))):
        path = out / name
        size = path.stat().st_size
        if size > 64 * 1024 * 1024 or size < offsets[i]:
            raise RuntimeError('Verification output exceeds its bound or was truncated')
        with path.open('rb') as reader:
            reader.seek(offsets[i])
            while offsets[i] < size:
                if watchdog:
                    watchdog.pulse()
                data = reader.read(min(1024 * 1024, size - offsets[i]))
                if not data:
                    raise RuntimeError('Verification output was truncated')
                offsets[i] += len(data)
                if progress is None:
                    changed = True
                elif i == 0:
                    changed = progress.feed(data) or changed
                decoded = data.decode('utf-8', errors='replace')
                last_line = decoded.splitlines()[-1][-300:]
                stream.write(decoded)
                stream.flush()
                if not final:
                    break
    if final and progress:
        progress.finish()
    return changed, last_line


def assert_recovery_enabled(state):
    # A new incident can disable even otherwise-valid one-shot permits.
    # Only an explicit false value re-enables recovery after review.
    if state.get('blockRecovery', False) is not False:
        raise RuntimeError('Verification suspended: recovery launches are blocked after a new host freeze. '
                           'No workload was launched. Review the incident before re-enabling recovery.')


def assert_runtime_not_blocked(root=ROOT):
    """Leaf entries also honor a hard incident block, even inside a job."""
    hold = root / 'dist/verification/safety-hold.json'
    if hold.exists():
        try:
            assert_recovery_enabled(json.loads(hold.read_text(encoding='utf-8')))
        except (ValueError, TypeError, AttributeError):
            raise RuntimeError('Verification suspended: invalid incident hold') from None


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
            assert_recovery_enabled(state)
            permit = state['recoveryPermit']
            if (command is not None and permit['command'] == command and permit['kind'] == kind
                    and time.time() < permit['expiresAt'] <= time.time() + 600
                    and timeout is not None and timeout <= permit['timeoutSeconds'] <= 1800):
                state['lastRecovery'] = {**state.pop('recoveryPermit'), 'consumedAt': time.time()}
                durable_json(hold, state)
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
    def __init__(self, memory_bytes, cpu_percent, name=None):
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
        self.handle = k.CreateJobObjectW(None, name)
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

    def assign_and_resume(self, child, before_resume=None):
        self.check(self.k.AssignProcessToJobObject(self.handle, W.HANDLE(int(child._handle))))
        # Creation/assignment can block. Recheck only after assignment so an
        # expired watchdog can never be followed by resuming an unguarded child.
        if before_resume:
            before_resume()
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
            row = Thread()
            row.size = ctypes.sizeof(row)
            more = k.Thread32First(snapshot, ctypes.byref(row))
            while more:
                if row.pid == child.pid:
                    thread = k.OpenThread(2, False, row.tid)
                    self.check(thread)
                    try:
                        if before_resume:
                            before_resume()
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
            handle = self.handle
            try:
                self.check(self.k.TerminateJobObject(handle, 125))
            finally:
                # Kill-on-close is a second containment mechanism. A failed
                # termination or handle close must still make the receipt fail.
                if self.k.CloseHandle(handle):
                    self.handle = None
                else:
                    self.check(False)


def guarded_entry(kind, timeout=600, *, module=None, structured_progress=False):
    """Re-enter this Python module under the supervisor when invoked directly."""
    assert_runtime_not_blocked(ROOT)
    if not os.environ.get('STATE_SPACE_VERIFICATION_JOB'):
        module = module or 'scripts.' + Path(sys.argv[0]).stem
        command = [sys.executable, '-m', 'scripts.verification_guard', '--kind', kind,
                   '--timeout', str(timeout), *(['--structured-progress'] if structured_progress else []),
                   '--', sys.executable, '-m', module, *sys.argv[1:]]
        raise SystemExit(subprocess.call(command, cwd=ROOT))


def main():
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kind', choices=['cpu', 'gpu', 'frames', 'metal-smoke', 'macos-qualification'], required=True)
    parser.add_argument('--timeout', type=float, default=600)
    parser.add_argument('--stall', type=float, help='Missing-progress deadline; defaults to min(40, timeout)')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--structured-progress', action='store_true')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.stall is None:
        args.stall = min(40, args.timeout)
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command or not 0 < args.timeout <= 1800 or not 0 < args.stall <= args.timeout:
        parser.error('A command and bounded timeout/stall interval are required.')
    metal_scope = None
    if args.kind == 'metal-smoke':
        from scripts.verification_metal import validate_metal_smoke
        metal_scope = validate_metal_smoke(command, args.timeout)
    if args.kind == 'macos-qualification':
        from scripts.verification_macos import validate_qualification
        metal_scope = validate_qualification(command, args.timeout)
    run_id = uuid.uuid4().hex
    out = args.output or ROOT / 'dist/verification' / run_id
    out.mkdir(parents=True, exist_ok=True)
    cpu_limit = 6 if args.kind == 'cpu' else 12 if args.kind == 'gpu' else 0
    memory_limit = 4096 if args.kind == 'cpu' else 8192
    receipt = {'version': 3, 'id': run_id, 'kind': args.kind, 'command': command, 'startedAt': time.time(),
               'passed': False, 'memoryLimitMiB': memory_limit if os.name == 'nt' else None,
               'cpuLimitPercent': (cpu_limit or None) if os.name == 'nt' else None,
               'timeoutSeconds': args.timeout, 'stallSeconds': args.stall, 'maxMonitorLagMs': 0,
               'containment': 'Windows job' if os.name == 'nt' else 'POSIX process group'}
    if metal_scope:
        receipt['metalSmokeScope'] = metal_scope
    job = child = gpu_monitor = watchdog = None
    posix_stopped = False
    def save():
        pending = out / 'report.tmp'
        with pending.open('w', encoding='utf-8') as stream:
            stream.write(json.dumps(receipt, indent=2) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        pending.replace(out / 'report.json')
    def stop():
        nonlocal posix_stopped
        try:
            if job:
                job.close()
            elif child and not posix_stopped:
                # A successfully exited leader may still have living descendants.
                # The child owns a new session; never target the caller's group.
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                posix_stopped = True
        except Exception as error:
            receipt['cleanupError'] = 'Workload termination failed: ' + str(error)
            receipt['passed'] = False
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
                   'STATE_SPACE_PYTHON': os.environ.get('STATE_SPACE_PYTHON', sys.executable),
                   'STATE_SPACE_VERIFICATION_KIND': args.kind,
                   'STATE_SPACE_VERIFY_YIELD_MS': '20', 'PYTHONIOENCODING': 'utf-8',
                   'OMP_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1', 'OPENBLAS_NUM_THREADS': '1'}
            if os.name == 'nt':
                job = WindowsJob(memory_limit * 1024**2, cpu_limit, 'Local\\StateSpaceVerify-' + run_id)
                watchdog = IndependentWatchdog(run_id, args.timeout)
                receipt['independentWatchdog'] = {'armed': True, 'heartbeatSeconds': 3,
                    'deadlineSeconds': args.timeout, 'transport': 'pagefile-backed mapping'}
                flags = 4 | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
                if args.kind != 'frames':
                    flags |= subprocess.BELOW_NORMAL_PRIORITY_CLASS
                child = subprocess.Popen(command, cwd=ROOT, env=env, stdout=stdout, stderr=stderr, creationflags=flags)
                try:
                    job.assign_and_resume(child, watchdog.pulse)
                except BaseException:
                    child.kill()
                    raise
            else:
                child = subprocess.Popen(command, cwd=ROOT, env=env, stdout=stdout, stderr=stderr, start_new_session=True)
                from scripts.verification_posix_watchdog import PosixWatchdog
                # A very short process may already have exited; no live workload
                # needs a watchdog, but stop() still cleans up its owned group.
                if child.poll() is None:
                    watchdog = PosixWatchdog(child, args.timeout, out, memory_limit)
                    receipt['independentWatchdog'] = {'armed': True, 'heartbeatSeconds': 3,
                        'deadlineSeconds': args.timeout, 'sampledRssLimitMiB': memory_limit,
                        'transport': 'owned pipe', 'kernelMemoryCap': False}
            receipt['childPid'] = child.pid
            save()
            start = last_output = previous = time.monotonic()
            offsets = [0, 0]
            progress = DurableProgress(run_id) if args.structured_progress else None
            last_sample = start
            overloaded_since = None
            while child.poll() is None:
                if watchdog:
                    watchdog.pulse()
                time.sleep(.2)
                now = time.monotonic()
                lag = max(0, now - previous - .2)
                receipt['maxMonitorLagMs'] = max(receipt['maxMonitorLagMs'], round(lag * 1000, 3))
                previous = now
                changed, last_line = drain_output(out, offsets, progress)
                if changed:
                    last_output = now
                if progress:
                    receipt['durableProgressSequence'] = progress.sequence
                if last_line is not None:
                    receipt['lastOutput'] = last_line
                if now - last_sample >= 1:
                    host = health.sample()
                    gpu = gpu_monitor.latest if gpu_monitor else None
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
                        receipt['error'] = error
                        stop()
                        break
                save()
                if lag > 2 or now - start > args.timeout or now - last_output > args.stall or (out / 'cancel').exists():
                    receipt['error'] = 'Host monitor stalled' if lag > 2 else 'Cancelled' if (out / 'cancel').exists() else 'Timeout or missing progress'
                    stop()
                    break
            receipt['exitCode'] = child.wait(timeout=10)
            if watchdog:
                watchdog.pulse()
            stop()
            _, last_line = drain_output(out, offsets, progress, final=True, watchdog=watchdog)
            if last_line is not None:
                receipt['lastOutput'] = last_line
            if progress:
                receipt['durableProgressSequence'] = progress.sequence
            receipt['passed'] = receipt['exitCode'] == 0 and 'error' not in receipt and 'cleanupError' not in receipt
    except BaseException as error:
        receipt['error'] = repr(error)
        stop()
    finally:
        stop()
        if watchdog:
            reason = watchdog.failure_reason()
            if reason:
                receipt['error'] = reason
                receipt['passed'] = False
            try:
                watchdog.close(disarm=not job or job.handle is None)
            except Exception as error:
                receipt['error'] = 'Independent watchdog cleanup failed: ' + str(error)
                receipt['passed'] = False
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
