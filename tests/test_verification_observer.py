"""Fault injection for observer diagnostics and independent cleanup; no OS jobs."""
import ctypes
import json
from pathlib import Path
import struct
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

from scripts import verification_scope as scope
from scripts import verify_browser_containment as runner


class InventoryTests(unittest.TestCase):
    def observer(self, snapshots):
        job = scope.JobObserver.__new__(scope.JobObserver)
        job.handle = 1
        job.k = Mock()
        values = iter(snapshots)

        def query(handle, kind, pointer, size, returned):
            assigned, count, pids = next(values)
            pointer._obj.assigned = assigned
            pointer._obj.count = count
            for index, pid in enumerate(pids):
                pointer._obj.ids[index] = pid
            if returned is not None:
                returned._obj.value = 8 + len(pids) * ctypes.sizeof(ctypes.c_size_t)
            return 1
        job.k.QueryInformationJobObject.side_effect = query
        return job

    def test_transient_incomplete_snapshot_requires_complete_requery(self):
        job = self.observer([(2, 1, [111]), (0, 0, [])])
        with patch.object(scope.time, 'sleep'):
            self.assertEqual(job.pids(), [])
        self.assertEqual(job.k.QueryInformationJobObject.call_count, 2)
        self.assertEqual(job.inventory_samples[0]['assigned'], 2)
        self.assertEqual(job.inventory_samples[0]['count'], 1)

    def test_persistent_mismatch_retains_every_raw_snapshot(self):
        job = self.observer([(9, 0, [])] * 3)
        with patch.object(scope.time, 'sleep'), self.assertRaises(RuntimeError) as failure:
            job.pids()
        samples = getattr(failure.exception, 'samples', [])
        self.assertEqual(len(samples), 3)
        self.assertTrue(all(s['assigned'] == 9 and s['count'] == 0 for s in samples))

    def test_out_of_envelope_count_is_not_retried_or_accepted(self):
        job = self.observer([(65, 65, [])])
        with self.assertRaises(RuntimeError):
            job.pids()
        self.assertEqual(job.k.QueryInformationJobObject.call_count, 1)

    def test_duplicate_process_ids_do_not_count_as_complete_inventory(self):
        job = self.observer([(2, 2, [111, 111])])
        with self.assertRaises(RuntimeError):
            job.pids()

    def test_api_failure_preserves_win32_error_without_accepting_partial_data(self):
        job = self.observer([])
        job.k.QueryInformationJobObject.side_effect = None
        job.k.QueryInformationJobObject.return_value = 0
        with patch.object(scope.ctypes, 'get_last_error', return_value=234), \
                self.assertRaises(scope.JobInventoryError) as failure:
            job.pids()
        self.assertEqual(failure.exception.samples[0]['win32Error'], 234)
        self.assertFalse(failure.exception.samples[0]['apiSucceeded'])
        self.assertEqual(job.k.QueryInformationJobObject.call_count, 1)

    def test_zero_pid_and_incomplete_byte_count_fail_closed(self):
        for snapshot in ((1, 1, [0]), (2, 2, [111])):
            with self.subTest(snapshot=snapshot), self.assertRaises(scope.JobInventoryError):
                self.observer([snapshot]).pids()

    def test_cleanup_accounting_does_not_query_the_process_list(self):
        job = self.observer([])

        def accounting(handle, kind, pointer, size, returned):
            self.assertEqual(kind, 1)
            pointer._obj.activeProcesses = 3
            return 1
        job.k.QueryInformationJobObject.side_effect = accounting
        self.assertEqual(job.active_processes(), 3)


class FakeMapping(bytearray):
    def __init__(self):
        super().__init__(runner.SIZE)
        self[:8] = runner.MAGIC
        struct.pack_into('<I', self, runner.REASON, 1)
        self.closed = False

    def close(self):
        self.closed = True


class ObserverCleanupTests(unittest.TestCase):
    def run_fault(self, *, close_fails=False, terminate_fails=False, named_job_survives=False,
                  watchdog_changes_during_cleanup=False, mapping_close_fails=False):
        with tempfile.TemporaryDirectory() as directory:
            attempt = Path(directory)
            run_id = 'a' * 32
            (attempt / 'armed.json').write_text(json.dumps({'runId': run_id, 'watchdogPid': 123}))
            (attempt / 'child.json').write_text(json.dumps({'pid': 456}))
            job = Mock(handle=1)
            job.pids.side_effect = RuntimeError('Incomplete owned-process inventory')
            job.active_processes.return_value = 0
            if terminate_fails:
                job.terminate.side_effect = RuntimeError('Injected termination failure')
            if close_fails:
                job.close.side_effect = RuntimeError('Injected close failure')
            else:
                job.close.side_effect = lambda: setattr(job, 'handle', None)
            probe = Mock(handle=99 if named_job_survives else None)
            supervisor = Mock(pid=12)
            supervisor.poll.return_value = 1
            supervisor.wait.return_value = 1
            watchdog, child = Mock(), Mock()
            watchdog.code.return_value = child.code.return_value = 125
            mapping = FakeMapping()
            if mapping_close_fails:
                mapping.close = Mock(side_effect=RuntimeError('Injected mapping close failure'))
            if watchdog_changes_during_cleanup:
                watchdog.code.return_value = 259
                struct.pack_into('<I', mapping, runner.REASON, 0)

                def later_watchdog_exit():
                    watchdog.code.return_value = 125
                    struct.pack_into('<I', mapping, runner.REASON, 1)
                job.terminate.side_effect = later_watchdog_exit
            cap = {'runId': run_id, 'mode': 'gpu-disabled', 'case': 'supervisor-loss',
                   'limits': scope.LIMITS, 'reviewSha256': 'review', 'supervisorCommand': ['mock-only']}
            with patch.object(runner.subprocess, 'Popen', return_value=supervisor), \
                    patch.object(runner, 'JobObserver', side_effect=[job, probe]), \
                    patch.object(runner, 'ProcessObserver', side_effect=[watchdog, child]), \
                    patch.object(runner.mmap, 'mmap', return_value=mapping), \
                    patch.object(runner, 'HostHealth') as health, \
                    patch.object(runner, 'remove_owned_profile') as remove, \
                    patch.object(runner, 'close_gpu_monitor') as close_gpu:
                health.return_value.sample.return_value = {
                    'time': time.time(), 'hostCpuPercent': 1, 'freeMemoryMiB': 32768}
                report = runner.observe(attempt, cap)
                close_gpu.assert_called_once()
            return report, job, watchdog, child, mapping, remove

    def test_inventory_failure_cannot_erase_watchdog_or_skip_cleanup(self):
        report, job, watchdog, child, mapping, remove = self.run_fault()
        self.assertFalse(report['passed'])
        self.assertIn('Incomplete owned-process inventory', report['error'])
        self.assertEqual(report['outcomeBeforeCleanup']['watchdogReasonCode'], 1)
        self.assertEqual(report['outcomeBeforeCleanup']['watchdogExitCode'], 125)
        job.terminate.assert_called_once()
        job.close.assert_called_once()
        watchdog.close.assert_called_once()
        child.close.assert_called_once()
        self.assertTrue(mapping.closed)
        remove.assert_called_once()

    def test_termination_failure_does_not_skip_other_cleanup(self):
        report, job, watchdog, child, mapping, _ = self.run_fault(terminate_fails=True)
        self.assertFalse(report['passed'])
        self.assertIn('Injected termination failure', str(report['cleanupErrors']))
        job.close.assert_called_once()
        watchdog.close.assert_called_once()
        child.close.assert_called_once()
        self.assertTrue(mapping.closed)

    def test_close_failure_does_not_skip_other_handles_or_claim_success(self):
        report, job, watchdog, child, mapping, remove = self.run_fault(close_fails=True, named_job_survives=True)
        self.assertFalse(report['passed'])
        self.assertIn('Injected close failure', str(report['cleanupErrors']))
        watchdog.close.assert_called_once()
        child.close.assert_called_once()
        self.assertTrue(mapping.closed)
        remove.assert_not_called()

    def test_forced_cleanup_cannot_retroactively_qualify_watchdog(self):
        report, _, _, _, _, _ = self.run_fault(watchdog_changes_during_cleanup=True)
        self.assertFalse(report['passed'])
        self.assertEqual(report['outcomeBeforeCleanup']['watchdogReasonCode'], 0)
        self.assertEqual(report['outcomeBeforeCleanup']['watchdogExitCode'], 259)
        self.assertEqual(report['outcomeAfterCleanupActions']['watchdogReasonCode'], 1)
        self.assertEqual(report['outcomeAfterCleanupActions']['watchdogExitCode'], 125)

    def test_mapping_close_failure_keeps_profile_but_still_closes_other_handles(self):
        report, job, watchdog, child, _, remove = self.run_fault(mapping_close_fails=True)
        self.assertFalse(report['passed'])
        self.assertIn('Injected mapping close failure', str(report['cleanupErrors']))
        job.close.assert_called_once()
        watchdog.close.assert_called_once()
        child.close.assert_called_once()
        remove.assert_not_called()

    def test_one_unreadable_handle_does_not_hide_the_watchdog_reason(self):
        supervisor, child, watchdog = Mock(), Mock(), Mock()
        supervisor.poll.side_effect = RuntimeError('Injected process query failure')
        child.code.return_value = watchdog.code.return_value = 125
        outcome = runner.observation_outcome(supervisor, child, watchdog, FakeMapping())
        self.assertIsNone(outcome['supervisorExitCode'])
        self.assertEqual(outcome['watchdogReasonCode'], 1)
        self.assertEqual(outcome['watchdogExitCode'], 125)
        self.assertIn('Injected process query failure', str(outcome['errors']))


if __name__ == '__main__':
    unittest.main()
