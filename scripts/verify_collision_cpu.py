"""Narrow CPU collision benchmark scope. The general incident hold stays intact.

Fixed recipes only: inert containment probes, world replay, then one fixture per
short Windows Job. The observer cleanup is derived from the reviewed repair in
verify_browser_containment.py; no browser or GPU operations are included.
"""
import argparse
import json
import mmap
import os
from pathlib import Path
import struct
import subprocess
import sys
import time
import uuid

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.prepare_terrain_validation import worktree_snapshot
from scripts.verification_guard import Lease, WindowsJob
from scripts.verification_health import HostHealth, health_error
from scripts.verification_journal import durable_json
from scripts.verify_browser_containment import ProcessObserver
from scripts.collision_cpu_scope import (
    ROOT, BASE, CASES, LIMITS, ORIGINAL_FAILURE, WINDOWS_COMMAND, QUIET_OBSERVATION_SECONDS, JobObserver,
    binary_hashes, dependency_hashes, benchmark_identity, source_hashes,
    command, exclusive_json, hold_identity, read_json, sha,
    validate_capability, validate_review,
    cases_for, profile_identity, optimization_identity, timing_identity, solver_identity, normal_cache_identity,
    cache_timing_identity, cache_solver_identity, offset_cache_identity, offset_timing_identity, ALL_CASES,
)
from scripts.verification_watchdog import IndependentWatchdog, MAGIC, REASON, REASONS, SIZE


def clean_environment():
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(('STATE_SPACE_', 'PYTHON', 'NODE_', 'MUJOCO_', 'MJ_'))
           and key.upper() != 'COMSPEC'}
    return {**env, 'OMP_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1',
            'OPENBLAS_NUM_THREADS': '1', 'NUMEXPR_NUM_THREADS': '1',
            'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONIOENCODING': 'utf-8',
            'MUJOCO_GL': 'disable', 'ComSpec': WINDOWS_COMMAND}


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


def quiet_window(path):
    health = HostHealth()
    health.sample()
    samples, observations = [], []
    started = time.monotonic()
    previous = started
    quiet_started = None
    while time.monotonic() - started < QUIET_OBSERVATION_SECONDS:
        time.sleep(1)
        host = health.sample()
        now = time.monotonic()
        error = healthy(host, quiet=True)
        # Missing polling intervals cannot be counted as observed quiet time.
        if now - previous > 2.1:
            error = 'Missing or stale host telemetry: preflight sampling gap'
        sample = {**host, 'gpu': None}
        observations.append({**sample, 'reason': error})
        if error:
            quiet_started = None
            samples = []
        else:
            if quiet_started is None:
                quiet_started = previous
            samples.append(sample)
        quiet_seconds = 0 if quiet_started is None else now - quiet_started
        expired = now - started > QUIET_OBSERVATION_SECONDS
        passed = (not expired and not error and quiet_seconds >= LIMITS['quietSeconds']
                  and len(samples) >= LIMITS['quietSeconds'])
        durable_json(path, {'passed': passed, 'samples': samples, 'observations': observations,
                           'reason': error or ('Quiet observation deadline reached'
                                      if now - started >= QUIET_OBSERVATION_SECONDS and not passed else None),
                           'elapsedSeconds': quiet_seconds,
                           'observationElapsedSeconds': now - started,
                           'observationLimitSeconds': QUIET_OBSERVATION_SECONDS})
        if error:
            if error.startswith(('Missing or stale', 'Invalid host', 'Invalid GPU')):
                raise RuntimeError(error)
        if passed:
            return True
        previous = now
    return False


def prepare(benchmark, *, profile=False, optimization=False, timing=False, solver=False,
            normal_cache=False, cache_timing=False, cache_solver=False, offset_cache=False, offset_timing=False):
    if os.name != 'nt':
        raise RuntimeError('Windows-only CPU containment')
    packet = BASE / uuid.uuid4().hex
    protected = ROOT.parent / 'state-space-cpu-performance'
    review = {'schema': 'collision-cpu-review-v1', 'root': str(ROOT),
              'mode': 'cpu-only', 'cases': list(CASES), 'limits': dict(LIMITS),
              'quietObservationSeconds': QUIET_OBSERVATION_SECONDS,
              'hold': hold_identity(), 'sources': source_hashes(),
              'binaries': binary_hashes(), 'dependencies': dependency_hashes(),
              'benchmark': benchmark_identity(benchmark),
              'originalFailureSha256': sha(ORIGINAL_FAILURE),
              'protectedWorktree': str(protected), 'preparedAt': time.time(),
              'runtimeAcceptance': False, 'performanceAcceptance': False,
              'gpuAcceptance': False, 'workerAcceptance': False, 'r1Acceptance': False}
    if profile:
        review['profile'] = profile_identity(review['benchmark'])
        review['cases'] = list(cases_for(review))
    if optimization:
        review['optimization'] = optimization_identity(review['benchmark'])
        review['cases'] = list(cases_for(review))
    if timing:
        review['timing'] = timing_identity(review['benchmark'])
        review['cases'] = list(cases_for(review))
    if solver:
        review['solver'] = solver_identity(review['benchmark'])
        review['cases'] = list(cases_for(review))
    if normal_cache:
        review['normalCache'] = normal_cache_identity(review['benchmark'])
        review['cases'] = list(cases_for(review))
    if cache_timing:
        review['cacheTiming'] = cache_timing_identity(review['benchmark'])
        review['cases'] = list(cases_for(review))
    if cache_solver:
        review['cacheSolver'] = cache_solver_identity(review['benchmark'])
        review['cases'] = list(cases_for(review))
    if offset_cache:
        review['offsetCache'] = offset_cache_identity(review['benchmark'])
        review['cases'] = list(cases_for(review))
    if offset_timing:
        review['offsetTiming'] = offset_timing_identity(review['benchmark'])
        review['cases'] = list(cases_for(review))
    snapshot = worktree_snapshot(protected)
    packet.mkdir(parents=True)
    exclusive_json(packet / 'protected-worktree.json', snapshot)
    review['protectedSha256'] = sha(packet / 'protected-worktree.json')
    exclusive_json(packet / 'review.json', review)
    print(json.dumps({'prepared': str(packet), 'holdUnchanged': review['hold'] == hold_identity()}))


def require_sequence(packet, case):
    cases = cases_for(read_json(packet / 'review.json'))
    if case not in cases:
        raise RuntimeError('Case is outside the fixed review recipe')
    for previous in cases[:cases.index(case)]:
        report = read_json(packet / previous / 'report.json')
        if report.get('passed') is not True or report.get('reviewSha256') != sha(packet / 'review.json'):
            raise RuntimeError('Missing successful prerequisite: ' + previous)
    if (packet / case).exists():
        raise RuntimeError('Case already attempted; retained attempts are never rerun')


def reject_stale_locks():
    # A new packet cannot evade a previous incomplete cleanup.
    for base in (BASE, ROOT / 'dist/verification/browser-containment'):
        stale = next(base.glob('*/execution.lock'), None)
        if stale is not None:
            raise RuntimeError('Unresolved containment execution lock: ' + str(stale))


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
                        receipt['expectedCancellation'] = cap['case'] == 'stalled-cpu'
                        receipt['error'] = 'Cancelled pending CPU probe by owned Job termination'
                        break
                    if now - started > 25:
                        raise RuntimeError('Containment workload exceeded its supervisor deadline')
                    if now - sampled >= 1:
                        host = health.sample()
                        gpu = None
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
    job = mapping = child_handle = watchdog_handle = supervisor = None
    fault_at = None
    seen = set()
    try:
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
            if cap['case'] == 'stalled-cpu' and fault_at is not None and now - fault_at >= 2:
                if not (attempt / 'cancel').exists():
                    exclusive_json(attempt / 'cancel', {'reason': 'Approved pending-CPU cancellation test'})
            if now - sampled >= 1:
                host = health.sample()
                gpu = None
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
        elif cap['case'] == 'stalled-cpu':
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
        raise RuntimeError('Not an owned CPU review packet')
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
        exclusive_json(lock, {'ownerPid': os.getpid(), 'case': case,
                             'reviewSha256': sha(packet / 'review.json')})
        safe_cleanup = False
        attempt = packet / case
        try:
            if not quiet_window(packet / f'quiet-{case}.json'):
                safe_cleanup = True
                print(json.dumps({'waiting': True, 'case': case,
                                  'receipt': str(packet / f'quiet-{case}.json')}))
                return 75
            validate_review(review)
            attempt.mkdir()
            issued = time.time()
            cap = {'version': 1, 'runId': uuid.uuid4().hex, 'case': case, 'mode': 'cpu-only',
                   'limits': dict(LIMITS), 'ownerPid': os.getpid(),
                   'issuedAt': issued, 'expiresAt': issued + 60,
                   'reviewSha256': sha(packet / 'review.json'), 'command': command(attempt, 'leaf'),
                   'supervisorCommand': command(attempt, 'supervise')}
            exclusive_json(attempt / 'capability.json', cap)
            exclusive_json(attempt / 'claim.json', {'capabilitySha256': sha(attempt / 'capability.json'),
                                                  'ownerPid': os.getpid()})
            report = observe(attempt, cap)
            try:
                validate_review(review)
                if baseline != worktree_snapshot(Path(review['protectedWorktree'])):
                    raise RuntimeError('Protected worktree changed during attempt')
                report['holdUnchanged'] = report['sourcesUnchanged'] = report['protectedWorktreeUnchanged'] = True
                report['originalFailureUnchanged'] = True
                safe_cleanup = not report.get('cleanupError')
            except BaseException as error:
                report['preservationError'] = repr(error)
                report['passed'] = False
            for key in ('runtimeAcceptance', 'performanceAcceptance', 'gpuAcceptance',
                        'workerAcceptance', 'r1Acceptance'):
                report[key] = False
            durable_json(attempt / 'report.json', report)
            print(json.dumps({'case': case, 'passed': report['passed'],
                              'error': report.get('error'), 'report': str(attempt / 'report.json')}))
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
    parser.add_argument('--prepare-profile', type=Path)
    parser.add_argument('--prepare-optimization', type=Path)
    parser.add_argument('--prepare-timing', type=Path)
    parser.add_argument('--prepare-solver', type=Path)
    parser.add_argument('--prepare-normal-cache', type=Path)
    parser.add_argument('--prepare-cache-timing', type=Path)
    parser.add_argument('--prepare-cache-solver', type=Path)
    parser.add_argument('--prepare-offset-cache', type=Path)
    parser.add_argument('--prepare-offset-timing', type=Path)
    parser.add_argument('--packet', type=Path)
    parser.add_argument('--case', choices=ALL_CASES)
    args = parser.parse_args()
    preparations = [(args.prepare, {}), (args.prepare_profile, {'profile': True}),
                    (args.prepare_optimization, {'optimization': True}),
                    (args.prepare_timing, {'timing': True}), (args.prepare_solver, {'solver': True}),
                    (args.prepare_normal_cache, {'normal_cache': True}),
                    (args.prepare_cache_timing, {'cache_timing': True}),
                    (args.prepare_cache_solver, {'cache_solver': True}),
                    (args.prepare_offset_cache, {'offset_cache': True}),
                    (args.prepare_offset_timing, {'offset_timing': True})]
    selected = [(path, flags) for path, flags in preparations if path is not None]
    if len(selected) == 1 and not args.packet and not args.case:
        prepare(selected[0][0], **selected[0][1])
        return 0
    if args.packet and args.case and not selected:
        return run(args.packet, args.case)
    parser.error('Use one fixed preparation recipe or --packet CPU_PACKET --case CASE')


if __name__ == '__main__':
    raise SystemExit(main())

