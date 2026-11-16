"""Prepare/run individually reviewed, mode-bound containment cases on Windows.

Public CLI: --prepare BROWSER or --packet PACKET --case CASE. The private
supervisor invocation accepts only a spent capability owned by its live parent.
No mode changes safety-hold.json or accepts a workload command or budget override.
"""
import argparse
import ctypes
from ctypes import wintypes as W
import json
import math
import mmap
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import time
import uuid

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.prepare_terrain_validation import worktree_snapshot
from scripts.verification_guard import Lease, WindowsJob
from scripts.verification_health import GpuMonitor, HostHealth, gpu_sample, health_error
from scripts.verification_journal import durable_json
from scripts.verification_scope import (
    BASE, CASES, LIMITS, MODES, PYTHON, ROOT, JobObserver, browser_arguments, browser_files,
    command, exclusive_json, hold_identity, limits_for, read_json, sha, source_hashes,
    validate_capability, validate_review,
)
from scripts.verification_watchdog import IndependentWatchdog, MAGIC, REASON, REASONS, SIZE


def clean_environment():
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(('STATE_SPACE_', 'PYTHON'))}
    return {**env, 'OMP_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1',
            'OPENBLAS_NUM_THREADS': '1', 'PYTHONIOENCODING': 'utf-8'}


def healthy(host, *, quiet=False):
    error = health_error(host, preflight=quiet)
    cpu = host.get('hostCpuPercent')
    stamp = host.get('time')
    if (type(cpu) not in (float, int) or type(stamp) not in (float, int)
            or not 0 <= time.time() - stamp <= 2):
        return 'Missing or stale host telemetry'
    if quiet and cpu > LIMITS['quietCpuPercent']:
        return 'Host CPU exceeds the 30 percent quiet threshold'
    return error


def gpu_health(gpu, *, quiet=False):
    keys = ('time', 'temperatureC', 'utilizationPercent', 'freeMemoryMiB')
    if (not isinstance(gpu, dict)
            or any(type(gpu.get(k)) not in (int, float) or not math.isfinite(gpu[k]) for k in keys)
            or not 0 <= time.time() - gpu['time'] <= 6
            or not 0 <= gpu['temperatureC'] <= 150
            or not 0 <= gpu['utilizationPercent'] <= 100 or gpu['freeMemoryMiB'] < 0):
        return 'Invalid GPU telemetry or stale sample'
    return health_error({'freeMemoryMiB': 8192, 'hostCpuPercent': 0}, gpu, preflight=quiet)


def start_gpu_monitor(enabled):
    if not enabled:
        return None
    initial = gpu_sample()
    error = gpu_health(initial, quiet=True)
    if error:
        raise RuntimeError(error)
    return GpuMonitor(initial)


def monitor_gpu(monitor):
    if monitor is None:
        return None
    if monitor.error:
        raise RuntimeError(monitor.error)
    error = gpu_health(monitor.latest)
    if error:
        raise RuntimeError(error)
    return monitor.latest


def close_gpu_monitor(monitor):
    if monitor is not None:
        monitor.close()
        if monitor.thread.is_alive():
            raise RuntimeError('GPU telemetry worker did not stop')


def observer_gpu_sample(attempt, cap, *, quiet=False):
    if cap['mode'] != 'gpu-enabled' or cap['case'] == 'unit':
        return None
    value = read_json(attempt / 'observer-gpu.json')
    if value.get('runId') != cap['runId']:
        raise RuntimeError('GPU health sample has the wrong owner')
    error = gpu_health(value.get('sample'), quiet=quiet)
    if error:
        raise RuntimeError(error)
    return value['sample']


def quiet_window(path, *, gpu_enabled=False):
    health = HostHealth()
    health.sample()
    samples = []
    started = time.monotonic()
    for _ in range(LIMITS['quietSeconds']):
        time.sleep(1)
        gpu = gpu_sample() if gpu_enabled else None
        host = health.sample()
        samples.append({**host, 'gpu': gpu})
        error = healthy(host, quiet=True) or (gpu_health(gpu, quiet=True) if gpu_enabled else None)
        durable_json(path, {'passed': False, 'samples': samples, 'reason': error})
        if error:
            if error.startswith(('Missing or stale', 'Invalid host', 'Invalid GPU')):
                raise RuntimeError(error)
            return False
    passed = time.monotonic() - started >= LIMITS['quietSeconds']
    durable_json(path, {'passed': passed, 'samples': samples,
                        'elapsedSeconds': time.monotonic() - started})
    return passed


def prepare(browser, mode='gpu-disabled'):
    if os.name != 'nt':
        raise RuntimeError('Windows-only containment proposal')
    packet = BASE / uuid.uuid4().hex
    protected = ROOT.parent / 'state-space-cpu-performance'
    review = {'version': 2, 'root': str(ROOT), 'cases': list(CASES),
              'mode': mode, 'limits': limits_for(mode),
              'hold': hold_identity(), 'sources': source_hashes(),
              'browser': str(Path(browser).resolve(strict=True)),
              'browserFiles': browser_files(browser),
              'python': {'path': PYTHON, 'sha256': sha(PYTHON)},
              'arguments': browser_arguments('<owned-profile>', mode),
              'protectedWorktree': str(protected), 'preparedAt': time.time()}
    snapshot = worktree_snapshot(protected)
    packet.mkdir(parents=True)
    exclusive_json(packet / 'protected-worktree.json', snapshot)
    review['protectedSha256'] = sha(packet / 'protected-worktree.json')
    exclusive_json(packet / 'review.json', review)
    print(json.dumps({'prepared': str(packet), 'mode': mode,
                      'holdUnchanged': review['hold'] == hold_identity()}))


def require_sequence(packet, case):
    for previous in CASES[:CASES.index(case)]:
        report = read_json(packet / previous / 'report.json')
        if report.get('passed') is not True or report.get('reviewSha256') != sha(packet / 'review.json'):
            raise RuntimeError('Missing successful prerequisite: ' + previous)
    if (packet / case).exists():
        raise RuntimeError('Case already attempted; retained attempts are never rerun')


def reject_stale_locks():
    # Call under the global OS lease, before creating our own execution lock.
    # A new packet must not bypass unresolved cleanup from an earlier packet.
    stale = next(BASE.glob('*/execution.lock'), None)
    if stale is not None:
        raise RuntimeError('Unresolved containment execution lock: ' + str(stale))


class ProcessObserver:
    """Retain an OS process handle, avoiding PID reuse in cleanup evidence."""
    def __init__(self, pid):
        self.k = ctypes.WinDLL('kernel32', use_last_error=True)
        self.k.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]
        self.k.OpenProcess.restype = W.HANDLE
        self.k.GetExitCodeProcess.argtypes = [W.HANDLE, ctypes.POINTER(W.DWORD)]
        self.k.CloseHandle.argtypes = [W.HANDLE]
        self.handle = self.k.OpenProcess(0x1000, False, pid)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())

    def code(self):
        value = W.DWORD()
        if not self.k.GetExitCodeProcess(self.handle, ctypes.byref(value)):
            raise ctypes.WinError(ctypes.get_last_error())
        return value.value

    def close(self):
        if self.handle:
            if not self.k.CloseHandle(self.handle):
                raise ctypes.WinError(ctypes.get_last_error())
            self.handle = None


def remove_owned_profile(attempt):
    profile = attempt / 'profile'
    if not profile.exists():
        return
    if profile.resolve() != attempt.resolve() / 'profile':
        raise RuntimeError('Profile resolved outside its owned attempt')
    # Never follow a junction/symlink into a user profile or another directory.
    for directory, dirs, files in os.walk(profile, followlinks=False):
        for path in [Path(directory), *(Path(directory) / n for n in dirs + files)]:
            if path.lstat().st_file_attributes & 0x400:
                raise RuntimeError('Reparse point in owned profile; cleanup needs review')
    shutil.rmtree(profile)


def supervise(attempt):
    """Worker supervisor; killed deliberately only in the supervisor-loss case."""
    attempt = Path(attempt).resolve()
    cap, _ = validate_capability(attempt)
    if os.getppid() != cap['ownerPid']:
        raise RuntimeError('Supervisor does not descend from the lease owner')
    exclusive_json(attempt / 'supervisor.json', {'pid': os.getpid(), 'runId': cap['runId'],
                   'capabilitySha256': sha(attempt / 'capability.json')})
    job = watchdog = child = None
    receipt = {'passed': False, 'limits': cap['limits'], 'mode': cap['mode'], 'pid': os.getpid()}
    try:
        observer_gpu_sample(attempt, cap, quiet=True)
        job = WindowsJob(cap['limits']['memoryMiB'] * 1024**2, cap['limits']['cpuPercent'],
                         'Local\\StateSpaceVerify-' + cap['runId'])
        watchdog = IndependentWatchdog(cap['runId'], 30)
        exclusive_json(attempt / 'armed.json', {'watchdogPid': watchdog.child.pid, 'runId': cap['runId']})
        ack_deadline = time.monotonic() + 3
        while not (attempt / 'observer-ready.json').exists():
            watchdog.pulse()
            if time.monotonic() > ack_deadline:
                raise RuntimeError('Outer observer did not acquire the owned Job')
            time.sleep(.05)
        ack = read_json(attempt / 'observer-ready.json')
        if ack != {'ownerPid': cap['ownerPid'], 'runId': cap['runId']}:
            raise RuntimeError('Invalid outer observer acknowledgement')
        with (attempt / 'stdout.log').open('wb') as stdout, (attempt / 'stderr.log').open('wb') as stderr:
            flags = (4 | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
                     | subprocess.BELOW_NORMAL_PRIORITY_CLASS)
            child = subprocess.Popen(cap['command'], cwd=ROOT, env=clean_environment(),
                                     stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                     creationflags=flags, close_fds=True)
            def before_resume():
                watchdog.pulse()
                if not (attempt / 'child.json').exists():
                    exclusive_json(attempt / 'child.json', {'pid': child.pid})
                deadline = time.monotonic() + 2
                while not (attempt / 'child-observed.json').exists():
                    watchdog.pulse()
                    if time.monotonic() >= deadline:
                        raise RuntimeError('Observer did not retain the suspended child handle')
                    time.sleep(.02)
                if read_json(attempt / 'child-observed.json') != {'pid': child.pid, 'runId': cap['runId']}:
                    raise RuntimeError('Incorrect observed child identity')
            try:
                job.assign_and_resume(child, before_resume)
            except BaseException:
                child.kill()
                raise
            health = HostHealth()
            health.sample()
            started = previous = sampled = time.monotonic()
            overloaded = None
            receipt['independentWatchdog'] = {'pid': watchdog.child.pid, 'heartbeatSeconds': 3,
                                               'deadlineSeconds': 30}
            with (attempt / 'telemetry.jsonl').open('w', encoding='utf-8') as telemetry:
                while child.poll() is None:
                    watchdog.pulse()
                    time.sleep(.1)
                    now = time.monotonic()
                    if now - previous > 2.1:
                        raise RuntimeError('Supervisor monitor stalled')
                    previous = now
                    if (attempt / 'cancel').exists():
                        receipt['expectedCancellation'] = cap['case'] == 'stalled-cdp'
                        receipt['error'] = 'Cancelled pending CDP operation by owned Job termination'
                        break
                    if now - started > 25:
                        raise RuntimeError('Containment workload exceeded its supervisor deadline')
                    if now - sampled >= 1:
                        host = health.sample()
                        gpu = observer_gpu_sample(attempt, cap)
                        error = healthy(host)
                        overloaded = (overloaded or now) if host['hostCpuPercent'] > 85 else None
                        if overloaded and now - overloaded >= 2:
                            error = 'Host CPU exceeded 85 percent for two seconds'
                        stats = job.statistics()
                        telemetry.write(json.dumps({'host': host, 'gpu': gpu, 'job': stats}) + '\n')
                        telemetry.flush()
                        receipt['lastStatistics'] = stats
                        receipt['lastGpuSample'] = gpu
                        sampled = now
                        if error:
                            raise RuntimeError(error)
                        for name in ('stdout.log', 'stderr.log', 'browser.log'):
                            log = attempt / name
                            if log.exists() and log.stat().st_size > 1024 * 1024:
                                raise RuntimeError('Log budget exceeded')
            if child.poll() is not None:
                receipt['exitCode'] = child.returncode
                receipt['passed'] = child.returncode == 0
            receipt['statisticsBeforeClose'] = job.statistics()
    except BaseException as error:
        receipt['error'] = repr(error)
    finally:
        try:
            if job:
                job.close()
            if child:
                receipt['exitCode'] = child.wait(timeout=3)
            if watchdog:
                receipt['watchdogReason'] = watchdog.failure_reason()
                watchdog.close(disarm=job.handle is None)
        except BaseException as error:
            receipt['cleanupError'] = repr(error)
            receipt['passed'] = False
        receipt['passed'] = receipt['passed'] and not receipt.get('error') and not receipt.get('cleanupError')
        durable_json(attempt / 'supervisor-report.json', receipt)
    return 0 if receipt['passed'] else 1


def observation_outcome(supervisor, child_handle, watchdog_handle, mapping):
    """Read retained handles/mapping without depending on Job enumeration."""
    value = {'time': time.time(), 'supervisorExitCode': None, 'leafExitCode': None,
             'watchdogExitCode': None, 'watchdogReasonCode': None, 'watchdogReason': None}
    for key, handle in (('supervisorExitCode', supervisor), ('leafExitCode', child_handle),
                        ('watchdogExitCode', watchdog_handle)):
        if handle is not None:
            try:
                value[key] = handle.poll() if key == 'supervisorExitCode' else handle.code()
            except BaseException as error:
                value.setdefault('errors', []).append({'field': key, 'error': repr(error)})
    if mapping is not None:
        try:
            if mapping[:8] != MAGIC:
                raise RuntimeError('Watchdog mapping identity mismatch')
            value['watchdogReasonCode'] = struct.unpack_from('<I', mapping, REASON)[0]
            value['watchdogReason'] = REASONS.get(value['watchdogReasonCode'])
        except BaseException as error:
            value.setdefault('errors', []).append({'field': 'watchdogReasonCode', 'error': repr(error)})
    return value


def observe(attempt, cap):
    """Out-of-job observer keeps the lease and verifies negative-case outcomes."""
    report = {'passed': False, 'case': cap['case'], 'mode': cap['mode'], 'limits': cap['limits'],
              'reviewSha256': cap['reviewSha256'], 'runId': cap['runId'], 'startedAt': time.time()}
    job = mapping = child_handle = watchdog_handle = supervisor = gpu_monitor = None
    fault_at = None
    seen = set()
    try:
        gpu_monitor = start_gpu_monitor(cap['mode'] == 'gpu-enabled' and cap['case'] != 'unit')
        if gpu_monitor:
            durable_json(attempt / 'observer-gpu.json', {'runId': cap['runId'], 'sample': monitor_gpu(gpu_monitor)})
        with (attempt / 'controller-stdout.log').open('wb') as out, (attempt / 'controller-stderr.log').open('wb') as err:
            supervisor = subprocess.Popen(cap['supervisorCommand'], cwd=ROOT, env=clean_environment(),
                                          stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                                          creationflags=subprocess.CREATE_NO_WINDOW, close_fds=True)
        report['supervisorPid'] = supervisor.pid
        start = time.monotonic()
        while not (attempt / 'armed.json').exists():
            if supervisor.poll() is not None or time.monotonic() - start > 10:
                raise RuntimeError('Supervisor did not arm before launch')
            time.sleep(.05)
        armed = read_json(attempt / 'armed.json')
        if armed['runId'] != cap['runId']:
            raise RuntimeError('Wrong watchdog identity')
        job = JobObserver(cap['runId'])
        watchdog_handle = ProcessObserver(armed['watchdogPid'])
        mapping = mmap.mmap(-1, SIZE, tagname='Local\\StateSpaceWatch-' + cap['runId'])
        if mapping[:8] != MAGIC:
            raise RuntimeError('Watchdog mapping identity mismatch')
        exclusive_json(attempt / 'observer-ready.json', {'ownerPid': os.getpid(), 'runId': cap['runId']})
        health = HostHealth()
        health.sample()
        sampled = time.monotonic()
        overloaded = None
        while True:
            now = time.monotonic()
            if now - start > 35:
                raise RuntimeError('Outer containment deadline exceeded')
            if child_handle is None and (attempt / 'child.json').exists():
                child_pid = read_json(attempt / 'child.json')['pid']
                child_handle = ProcessObserver(child_pid)
                exclusive_json(attempt / 'child-observed.json', {'pid': child_pid, 'runId': cap['runId']})
            report['lastOutcomeBeforeInventory'] = observation_outcome(
                supervisor, child_handle, watchdog_handle, mapping)
            pids = job.pids()
            seen.update(pids)
            if (attempt / 'fault-ready.json').exists() and fault_at is None:
                fault_at = now
                report['faultReady'] = read_json(attempt / 'fault-ready.json')
                if cap['case'] == 'supervisor-loss':
                    report['supervisorLossRequestedAt'] = time.time()
                    supervisor.kill()  # This exact Popen child only; no PID search.
                    report['injectedSupervisorLoss'] = True
            if cap['case'] == 'stalled-cdp' and fault_at is not None and now - fault_at >= 2:
                if not (attempt / 'cancel').exists():
                    exclusive_json(attempt / 'cancel', {'reason': 'Approved pending-CDP cancellation test'})
            if now - sampled >= 1:
                host = health.sample()
                gpu = monitor_gpu(gpu_monitor)
                if gpu_monitor:
                    durable_json(attempt / 'observer-gpu.json', {'runId': cap['runId'], 'sample': gpu})
                report.setdefault('healthSamples', []).append({'host': host, 'gpu': gpu})
                error = healthy(host)
                overloaded = (overloaded or now) if host['hostCpuPercent'] > 85 else None
                if overloaded and now - overloaded >= 2:
                    error = 'Host CPU exceeded 85 percent for two seconds'
                if error:
                    raise RuntimeError(error)
                sampled = now
            if supervisor.poll() is not None and not pids and watchdog_handle.code() != 259:
                break
            time.sleep(.05)
        report['supervisorExitCode'] = supervisor.wait(timeout=1)
        report['leafExitCode'] = child_handle.code() if child_handle else None
        report['watchdogExitCode'] = watchdog_handle.code()
        report['watchdogReasonCode'] = struct.unpack_from('<I', mapping, REASON)[0]
        report['watchdogReason'] = REASONS.get(report['watchdogReasonCode'])
        report['remainingJobPids'] = job.pids()
        if report['remainingJobPids']:
            raise RuntimeError('Owned descendants remained at acceptance')
        report['observedJobPids'] = sorted(seen)
        if fault_at:
            report['faultToEmptyJobSeconds'] = time.monotonic() - fault_at
        if cap['case'] == 'supervisor-loss':
            passed = (report.get('injectedSupervisorLoss') is True
                      and report['watchdogReasonCode'] == 1 and report['watchdogExitCode'] == 125
                      and report['leafExitCode'] == 125 and report['faultToEmptyJobSeconds'] <= 5)
        elif cap['case'] == 'stalled-cdp':
            worker = read_json(attempt / 'supervisor-report.json')
            passed = (worker.get('expectedCancellation') is True and not worker.get('cleanupError')
                      and report['leafExitCode'] == 125 and report['watchdogReasonCode'] == 0
                      and report['watchdogExitCode'] == 0 and report['faultToEmptyJobSeconds'] <= 5)
        else:
            worker = read_json(attempt / 'supervisor-report.json')
            leaf = read_json(attempt / 'leaf-report.json')
            passed = (worker.get('passed') is True and leaf.get('passed') is True
                      and report['supervisorExitCode'] == 0 and report['leafExitCode'] == 0
                      and report['watchdogReasonCode'] == 0 and report['watchdogExitCode'] == 0)
        if not passed:
            raise RuntimeError('Observed containment outcome did not meet case acceptance')
        report['passed'] = True
    except BaseException as error:
        report['error'] = repr(error)
        if hasattr(error, 'samples'):
            report['inventoryFailureSamples'] = error.samples
    finally:
        report['observedJobPids'] = sorted(seen)
        if job is not None and isinstance(getattr(job, 'inventory_samples', None), list):
            report['recentInventorySamples'] = job.inventory_samples
        report['outcomeBeforeCleanup'] = observation_outcome(
            supervisor, child_handle, watchdog_handle, mapping)
        if report['outcomeBeforeCleanup'].get('errors'):
            report.setdefault('error', 'Failed to capture pre-cleanup process outcome')
            report['passed'] = False
        cleanup_errors = []

        def cleanup_step(name, action):
            try:
                action()
            except BaseException as error:
                cleanup_errors.append({'step': name, 'error': repr(error)})

        def require_empty_job():
            deadline = time.monotonic() + 3
            active = job.active_processes()
            while active and time.monotonic() < deadline:
                time.sleep(.05)
                active = job.active_processes()
            report['cleanupActiveProcesses'] = active
            if active:
                raise RuntimeError('Owned descendants survived cleanup')

        def stop_supervisor():
            if supervisor and supervisor.poll() is None:
                supervisor.kill()
                supervisor.wait(timeout=2)

        def require_exited(handle, seconds):
            deadline = time.monotonic() + seconds
            while handle.code() == 259 and time.monotonic() < deadline:
                time.sleep(.05)
            if handle.code() == 259:
                raise RuntimeError('Owned process remained live')

        def require_job_absent():
            probe = JobObserver(cap['runId'], optional=True)
            try:
                if probe.handle:
                    raise RuntimeError('Named job still exists after cleanup')
            finally:
                probe.close()
            report['namedJobAbsent'] = True

        def remove_profile():
            remove_owned_profile(attempt)
            report['profileRemoved'] = not (attempt / 'profile').exists()

        # Termination must never depend on the query that may have failed.
        # Acceptance above uses only observations before these forced actions.
        if job is not None:
            cleanup_step('terminate-owned-job', job.terminate)
            cleanup_step('confirm-empty-job', require_empty_job)
            cleanup_step('close-job-handle', job.close)
        cleanup_step('stop-supervisor', stop_supervisor)
        if watchdog_handle is not None:
            cleanup_step('wait-watchdog', lambda: require_exited(watchdog_handle, 4))
        if child_handle is not None:
            cleanup_step('wait-leaf', lambda: require_exited(child_handle, 1))
        report['outcomeAfterCleanupActions'] = observation_outcome(
            supervisor, child_handle, watchdog_handle, mapping)
        cleanup_errors.extend(report['outcomeAfterCleanupActions'].get('errors', []))
        if child_handle is not None:
            cleanup_step('close-leaf-handle', child_handle.close)
        if watchdog_handle is not None:
            cleanup_step('close-watchdog-handle', watchdog_handle.close)
        if mapping is not None:
            cleanup_step('close-watchdog-mapping', mapping.close)
        cleanup_step('confirm-job-absent', require_job_absent)
        # Never remove a profile while process teardown is uncertain.
        if report.get('namedJobAbsent') is True and not cleanup_errors:
            cleanup_step('remove-owned-profile', remove_profile)
        cleanup_step('close-gpu-monitor', lambda: close_gpu_monitor(gpu_monitor))
        if cleanup_errors:
            report['cleanupErrors'] = cleanup_errors
            report['cleanupError'] = repr(cleanup_errors)
            report['passed'] = False
        report['durationSeconds'] = time.time() - report['startedAt']
        durable_json(attempt / 'report.json', report)
    return report


def run(packet, case):
    packet = Path(packet).resolve(strict=True)
    if packet.parent != BASE.resolve() or len(packet.name) != 32:
        raise RuntimeError('Not an owned review packet')
    review = read_json(packet / 'review.json')
    validate_review(review)
    if sha(packet / 'protected-worktree.json') != review['protectedSha256']:
        raise RuntimeError('Protected worktree manifest changed')
    baseline = read_json(packet / 'protected-worktree.json')
    if baseline != worktree_snapshot(Path(review['protectedWorktree'])):
        raise RuntimeError('Protected worktree changed before launch')
    with Lease():
        reject_stale_locks()
        require_sequence(packet, case)
        lock = packet / 'execution.lock'
        exclusive_json(lock, {'ownerPid': os.getpid(), 'case': case, 'reviewSha256': sha(packet / 'review.json')})
        safe_cleanup = False
        attempt = packet / case
        try:
            if not quiet_window(packet / f'quiet-{case}.json',
                                gpu_enabled=review['mode'] == 'gpu-enabled' and case != 'unit'):
                safe_cleanup = True
                print(json.dumps({'waiting': True, 'case': case, 'receipt': str(packet / f'quiet-{case}.json')}))
                return 75
            validate_review(review)
            attempt.mkdir()
            issued = time.time()
            cap = {'version': 2, 'runId': uuid.uuid4().hex, 'case': case, 'mode': review['mode'],
                   'limits': limits_for(review['mode'], case),
                   'ownerPid': os.getpid(), 'issuedAt': issued, 'expiresAt': issued + 60,
                   'reviewSha256': sha(packet / 'review.json'), 'command': command(attempt, 'leaf'),
                   'supervisorCommand': command(attempt, 'supervise'),
                   'browserArguments': browser_arguments(attempt / 'profile', review['mode'])}
            exclusive_json(attempt / 'capability.json', cap)
            exclusive_json(attempt / 'claim.json', {'capabilitySha256': sha(attempt / 'capability.json'),
                                                  'ownerPid': os.getpid()})
            report = observe(attempt, cap)
            try:
                validate_review(review)
                if baseline != worktree_snapshot(Path(review['protectedWorktree'])):
                    raise RuntimeError('Protected worktree changed during attempt')
                report['holdUnchanged'] = report['sourcesUnchanged'] = report['protectedWorktreeUnchanged'] = True
                safe_cleanup = not report.get('cleanupError')
            except BaseException as error:
                report['preservationError'] = repr(error)
                report['passed'] = False
            durable_json(attempt / 'report.json', report)
            print(json.dumps(report))
            return 0 if report['passed'] else 1
        finally:
            if safe_cleanup:
                lock.unlink()


def main():
    if os.name != 'nt':
        raise RuntimeError('Real containment requires Windows')
    if len(sys.argv) == 2 and not sys.argv[1].startswith('--'):
        return supervise(sys.argv[1])
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare', type=Path)
    parser.add_argument('--packet', type=Path)
    parser.add_argument('--case', choices=CASES)
    parser.add_argument('--mode', choices=MODES)
    args = parser.parse_args()
    if args.prepare and not args.packet and not args.case:
        prepare(args.prepare, args.mode or 'gpu-disabled')
        return 0
    if args.packet and args.case and not args.prepare and args.mode is None:
        return run(args.packet, args.case)
    parser.error('Use --prepare BROWSER or --packet PACKET --case CASE')


if __name__ == '__main__':
    raise SystemExit(main())
