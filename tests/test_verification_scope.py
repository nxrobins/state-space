"""Isolated capability/sequence tests. No browser, process, or socket launches."""
import copy
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch, Mock

from scripts import verification_scope as scope
from scripts import verify_browser_containment as runner
from scripts.verification_guard import assert_runtime_not_blocked


class ScopeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.packet = self.base / ('a' * 32)
        self.attempt = self.packet / 'startup-close'
        self.attempt.mkdir(parents=True)
        self.addCleanup(patch.stopall)
        patch.object(scope, 'BASE', self.base).start()
        patch.object(scope, 'validate_review').start()
        scope.exclusive_json(self.packet / 'review.json', {'version': 2, 'mode': 'gpu-disabled'})
        self.cap = {'version': 2, 'mode': 'gpu-disabled', 'case': 'startup-close', 'limits': scope.LIMITS,
                    'reviewSha256': scope.sha(self.packet / 'review.json'),
                    'runId': 'b' * 32, 'command': scope.command(self.attempt, 'leaf'),
                    'supervisorCommand': scope.command(self.attempt, 'supervise'),
                    'browserArguments': scope.browser_arguments(self.attempt / 'profile'),
                    'issuedAt': 100, 'expiresAt': 160, 'ownerPid': 123}
        self.write_cap()

    def write_cap(self):
        (self.attempt / 'capability.json').write_text(json.dumps(self.cap))
        (self.attempt / 'claim.json').write_text(json.dumps({
            'capabilitySha256': scope.sha(self.attempt / 'capability.json'), 'ownerPid': 123}))
        (self.packet / 'execution.lock').write_text(json.dumps({
            'ownerPid': 123, 'case': 'startup-close', 'reviewSha256': self.cap['reviewSha256']}))

    def test_valid_consumed_capability(self):
        cap, _ = scope.validate_capability(self.attempt, now=110)
        self.assertEqual(cap, self.cap)

    def test_changed_scope_is_rejected(self):
        original = copy.deepcopy(self.cap)
        mutations = {'command': ['arbitrary.exe'], 'supervisorCommand': ['arbitrary.exe'],
                     'browserArguments': ['--enable-unsafe-webgpu'], 'limits': {'cpuPercent': 99},
                     'case': 'gpu', 'reviewSha256': 'wrong', 'runId': 'fake',
                     'expiresAt': float('inf'), 'issuedAt': 120, 'mode': 'gpu-enabled', 'version': 1}
        for field, value in mutations.items():
            with self.subTest(field=field):
                self.cap = {**copy.deepcopy(original), field: value}
                self.write_cap()
                with self.assertRaises(RuntimeError):
                    scope.validate_capability(self.attempt, now=110)

    def test_expired_and_overlong_grants_are_rejected(self):
        with self.assertRaises(RuntimeError):
            scope.validate_capability(self.attempt, now=160)
        self.cap['expiresAt'] = 161
        self.write_cap()
        with self.assertRaises(RuntimeError):
            scope.validate_capability(self.attempt, now=110)

    def test_claim_or_lock_cannot_be_missing_or_changed(self):
        for file in (self.attempt / 'claim.json', self.packet / 'execution.lock'):
            old = file.read_bytes()
            file.write_text('{}')
            with self.assertRaises(RuntimeError):
                scope.validate_capability(self.attempt, now=110)
            file.write_bytes(old)

    def test_consumption_is_exclusive_even_for_partial_claim(self):
        path = self.attempt / 'once.json'
        path.write_text('{')
        with self.assertRaises(FileExistsError):
            scope.exclusive_json(path, {})
        self.assertEqual(path.read_text(), '{')

    def test_leaf_requires_real_membership_before_claiming(self):
        scope.exclusive_json(self.attempt / 'supervisor.json', {
            'pid': os.getppid(), 'runId': self.cap['runId'],
            'capabilitySha256': scope.sha(self.attempt / 'capability.json')})
        with patch.object(scope.time, 'time', return_value=110), patch.object(scope, 'JobObserver') as job:
            job.return_value.require_membership.side_effect = RuntimeError('not a member')
            with self.assertRaisesRegex(RuntimeError, 'not a member'):
                scope.claim_leaf(self.attempt)
            self.assertFalse((self.attempt / 'leaf-claim.json').exists())
            job.return_value.close.assert_called_once()

    def test_leaf_claim_is_one_use(self):
        scope.exclusive_json(self.attempt / 'supervisor.json', {
            'pid': os.getppid(), 'runId': self.cap['runId'],
            'capabilitySha256': scope.sha(self.attempt / 'capability.json')})
        with patch.object(scope.time, 'time', return_value=110), patch.object(scope, 'JobObserver'):
            scope.claim_leaf(self.attempt)
            with self.assertRaises(FileExistsError):
                scope.claim_leaf(self.attempt)

    def test_wrong_parent_refuses_before_job_lookup(self):
        scope.exclusive_json(self.attempt / 'supervisor.json', {
            'pid': -1, 'runId': self.cap['runId'],
            'capabilitySha256': scope.sha(self.attempt / 'capability.json')})
        with patch.object(scope.time, 'time', return_value=110), patch.object(scope, 'JobObserver') as job:
            with self.assertRaises(RuntimeError):
                scope.claim_leaf(self.attempt)
            job.assert_not_called()

    def test_generic_guard_still_rejects_hard_hold(self):
        hold = self.base / 'dist/verification/safety-hold.json'
        hold.parent.mkdir(parents=True)
        hold.write_text(json.dumps({'blockRecovery': True}))
        before = hold.read_bytes()
        with patch.dict(os.environ, {'STATE_SPACE_VERIFICATION_JOB': 'b' * 32}):
            with self.assertRaises(RuntimeError):
                assert_runtime_not_blocked(self.base)
        self.assertEqual(hold.read_bytes(), before)

    def test_order_and_no_rerun(self):
        with self.assertRaises(FileNotFoundError):
            runner.require_sequence(self.packet, 'startup-close')
        unit = self.packet / 'unit'
        unit.mkdir()
        scope.exclusive_json(unit / 'report.json', {
            'passed': True, 'reviewSha256': scope.sha(self.packet / 'review.json')})
        with self.assertRaisesRegex(RuntimeError, 'already attempted'):
            runner.require_sequence(self.packet, 'startup-close')

    def test_missing_stale_busy_and_low_memory_telemetry(self):
        host = {'time': time.time(), 'hostCpuPercent': 1, 'freeMemoryMiB': 16000}
        self.assertIsNone(runner.healthy(host, quiet=True))
        for change in ({'hostCpuPercent': None}, {'hostCpuPercent': 31},
                       {'freeMemoryMiB': 8191}, {'time': time.time() - 10},
                       {'hostCpuPercent': float('nan')}):
            self.assertIsNotNone(runner.healthy({**host, **change}, quiet=True))

    def test_new_packet_cannot_bypass_an_old_execution_lock(self):
        with patch.object(runner, 'BASE', self.base):
            with self.assertRaisesRegex(RuntimeError, 'Unresolved containment'):
                runner.reject_stale_locks()
            (self.packet / 'execution.lock').unlink()
            runner.reject_stale_locks()

    def test_missing_quiet_telemetry_is_failure_not_busy_retry(self):
        with patch.object(runner, 'HostHealth') as health, \
                patch.object(runner.time, 'sleep'), patch.object(runner, 'durable_json'):
            health.return_value.sample.return_value = {
                'time': time.time(), 'hostCpuPercent': None, 'freeMemoryMiB': 16000}
            with self.assertRaisesRegex(RuntimeError, 'Missing or stale'):
                runner.quiet_window(self.base / 'quiet.json')


class ReviewTests(unittest.TestCase):
    def test_source_browser_and_incident_drift(self):
        current = {'version': 2, 'mode': 'gpu-disabled', 'limits': scope.LIMITS, 'cases': list(scope.CASES),
                   'root': str(scope.ROOT), 'hold': {'sha256': 'hold'},
                   'sources': {'source': 'hash'}, 'python': {'path': scope.PYTHON, 'sha256': 'exe'},
                   'browser': 'chrome.exe', 'browserFiles': {'chrome.exe': 'binary'},
                   'arguments': scope.browser_arguments('<owned-profile>')}
        with patch.object(scope, 'hold_identity', return_value=current['hold']), \
                patch.object(scope, 'source_hashes', return_value=current['sources']), \
                patch.object(scope, 'sha', return_value='exe'), \
                patch.object(scope, 'browser_files', return_value=current['browserFiles']):
            scope.validate_review(current)
            for field in ('hold', 'sources', 'browserFiles', 'arguments', 'mode'):
                with self.subTest(field=field), self.assertRaises(RuntimeError):
                    scope.validate_review({**current, field: {}})

    def test_cleanup_rejects_profile_outside_attempt(self):
        attempt = Mock()
        profile = Mock()
        attempt.__truediv__ = Mock(return_value=profile)
        profile.exists.return_value = True
        profile.resolve.return_value = Path('C:/unrelated')
        attempt.resolve.return_value = Path('C:/owned')
        with patch.object(runner.shutil, 'rmtree') as remove:
            with self.assertRaisesRegex(RuntimeError, 'outside'):
                runner.remove_owned_profile(attempt)
            remove.assert_not_called()


class GpuScopeTests(unittest.TestCase):
    def test_mode_selects_only_reviewed_limits_and_unit_stays_cpu_only(self):
        self.assertEqual(scope.limits_for('gpu-disabled')['cpuPercent'], 6)
        self.assertEqual(scope.limits_for('gpu-enabled')['cpuPercent'], 12)
        self.assertEqual(scope.limits_for('gpu-enabled')['memoryMiB'], 8192)
        self.assertEqual(scope.limits_for('gpu-enabled', 'unit'), scope.LIMITS)
        with self.assertRaises(RuntimeError):
            scope.limits_for('arbitrary')

    def test_cpu_monitor_never_queries_gpu(self):
        with patch.object(runner, 'gpu_sample') as query:
            self.assertIsNone(runner.start_gpu_monitor(False))
            self.assertIsNone(runner.observer_gpu_sample(Path('unused'),
                              {'mode': 'gpu-enabled', 'case': 'unit'}))
            query.assert_not_called()

    def test_gpu_health_rejects_missing_stale_hot_busy_and_low_memory(self):
        gpu = {'time': time.time(), 'temperatureC': 40, 'utilizationPercent': 1,
               'freeMemoryMiB': 4096}
        self.assertIsNone(runner.gpu_health(gpu, quiet=True))
        self.assertIsNotNone(runner.gpu_health(None, quiet=True))
        for change in ({'time': time.time() - 7}, {'temperatureC': float('nan')},
                       {'temperatureC': 65}, {'utilizationPercent': 16},
                       {'utilizationPercent': 101}, {'freeMemoryMiB': 1023}):
            self.assertIsNotNone(runner.gpu_health({**gpu, **change}, quiet=True))
        self.assertIsNone(runner.gpu_health({**gpu, 'temperatureC': 74, 'utilizationPercent': 99}))
        self.assertIsNotNone(runner.gpu_health({**gpu, 'temperatureC': 75}))

    def test_wrong_gpu_sample_owner_and_stopped_monitor_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            scope.exclusive_json(path / 'observer-gpu.json', {'runId': 'wrong'})
            with self.assertRaisesRegex(RuntimeError, 'wrong owner'):
                runner.observer_gpu_sample(path, {'mode': 'gpu-enabled', 'case': 'startup-close', 'runId': 'right'})
        monitor = Mock(error='telemetry stopped')
        with self.assertRaisesRegex(RuntimeError, 'telemetry stopped'):
            runner.monitor_gpu(monitor)
        monitor.thread.is_alive.return_value = True
        with self.assertRaisesRegex(RuntimeError, 'did not stop'):
            runner.close_gpu_monitor(monitor)


if __name__ == '__main__':
    unittest.main()
