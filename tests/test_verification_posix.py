"""Exercise only owned print/sleep process groups on POSIX hosts."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent


@unittest.skipUnless(os.name == 'posix', 'POSIX process-group containment')
class PosixVerificationTests(unittest.TestCase):
    # The supervisor's pre-close status read may land while the watchdog is still
    # publishing; this stands in for the half-written file that read used to see.
    FIRST_STATUS_READ_FAILS = (
        "from scripts import verification_posix_watchdog as w\n"
        "original_reason = w.PosixWatchdog.failure_reason\n"
        "first = [True]\n"
        "def reason(self):\n"
        "    if first:\n"
        "        first.pop()\n"
        "        raise json.JSONDecodeError('Expecting value', '', 0)\n"
        "    return original_reason(self)\n"
        "w.PosixWatchdog.failure_reason = reason\n"
    )

    def run_guard(self, root, payload, timeout=3, prelude=""):
        entry = (
            "import json, sys; from pathlib import Path; from scripts import verification_guard as g; "
            "g.ROOT=Path(sys.argv.pop(1)); "
            "g.HostHealth=lambda: type('Health',(),{'sample':lambda self: "
            "{'hostCpuPercent':1,'freeMemoryMiB':32768}})()\n"
            + prelude +
            "raise SystemExit(g.main())"
        )
        env = dict(os.environ)
        for name in ('STATE_SPACE_VERIFICATION_JOB', 'STATE_SPACE_TEST_CONTAINMENT', 'STATE_SPACE_PYTHON'):
            env.pop(name, None)
        return subprocess.run([sys.executable, '-B', '-c', entry, str(root), '--kind', 'cpu',
            '--timeout', str(timeout), '--output', str(root / 'run'),
            '--', sys.executable, '-B', '-u', '-c', payload], cwd=ROOT, env=env,
            capture_output=True, text=True, timeout=15)

    def test_success_and_short_default_deadline_do_not_claim_windows_caps(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            result = self.run_guard(root, "import os,sys; print('owned tiny workload'); print(os.environ['STATE_SPACE_PYTHON']==sys.executable)", timeout=2)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            report = json.loads((root / 'run/report.json').read_text())
            self.assertTrue(report['passed'])
            self.assertEqual(report['stallSeconds'], 2)
            self.assertEqual(report['containment'], 'POSIX process group')
            self.assertIsNone(report['cpuLimitPercent'])
            self.assertIsNone(report['memoryLimitMiB'])
            self.assertIn('owned tiny workload', (root / 'run/stdout.log').read_text())
            self.assertIn('True', (root / 'run/stdout.log').read_text())

    def test_timeout_terminates_the_owned_group(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            result = self.run_guard(root, "import time; print('started'); time.sleep(10)", timeout=.5)
            self.assertNotEqual(result.returncode, 0)
            report = json.loads((root / 'run/report.json').read_text())
            self.assertFalse(report['passed'])
            self.assertTrue('Timeout' in report['error'] or 'deadline expired' in report['error'], report['error'])
            with self.assertRaises(ProcessLookupError):
                os.killpg(report['childPid'], 0)

    def test_supervisor_deadline_survives_a_status_read_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            result = self.run_guard(root, "import time; print('started'); time.sleep(10)", timeout=.5,
                                    prelude=self.FIRST_STATUS_READ_FAILS)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('Traceback', result.stderr, result.stderr)
            report = json.loads((root / 'run/report.json').read_text())
            self.assertFalse(report['passed'])
            # Both enforcers share the deadline, so either may supply the reason; one always must.
            self.assertTrue('Timeout' in report['error'] or 'deadline expired' in report['error'], report['error'])
            self.assertEqual(report['exitCode'], -signal.SIGKILL)
            self.assertIn('finishedAt', report)
            with self.assertRaises(ProcessLookupError):
                os.killpg(report['childPid'], 0)

    def test_watchdog_deadline_before_the_supervisor_is_recorded_not_lost(self):
        # The watchdog is armed with a shorter deadline than the supervisor, so it
        # kills the owned group first; the receipt must still name that reason.
        shorter_watchdog = (
            "original_init = w.PosixWatchdog.__init__\n"
            "def init(self, child, timeout, output, memory_mib=8192, heartbeat=3):\n"
            "    original_init(self, child, .3, output, memory_mib, heartbeat)\n"
            "w.PosixWatchdog.__init__ = init\n"
        )
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            started = time.monotonic()
            result = self.run_guard(root, "import time; print('started'); time.sleep(10)", timeout=5,
                                    prelude=self.FIRST_STATUS_READ_FAILS + shorter_watchdog)
            self.assertLess(time.monotonic() - started, 4)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('Traceback', result.stderr, result.stderr)
            report = json.loads((root / 'run/report.json').read_text())
            self.assertFalse(report['passed'])
            self.assertIn('deadline expired', report['error'])
            self.assertEqual(report['exitCode'], -signal.SIGKILL)
            self.assertIn('finishedAt', report)
            with self.assertRaises(ProcessLookupError):
                os.killpg(report['childPid'], 0)

    def test_exited_leader_does_not_leave_a_sleeping_descendant(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            payload = ("import subprocess,sys; child=subprocess.Popen([sys.executable,'-c',"
                       "'import time; time.sleep(10)']); print(child.pid,flush=True)")
            result = self.run_guard(root, payload)
            report = json.loads((root / 'run/report.json').read_text())
            try:
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                # psutil distinguishes a killed, unreaped zombie from a living process.
                import psutil
                pid = int((root / 'run/stdout.log').read_text().strip())
                try:
                    child = psutil.Process(pid)
                    child.wait(timeout=2)
                except (psutil.NoSuchProcess, psutil.TimeoutExpired):
                    if psutil.pid_exists(pid):
                        self.assertEqual(psutil.Process(pid).status(), psutil.STATUS_ZOMBIE)
            finally:
                try:
                    os.killpg(report['childPid'], signal.SIGKILL)
                except ProcessLookupError:
                    pass


@unittest.skipUnless(os.name == 'posix', 'POSIX watchdog')
class IndependentPosixWatchdogTests(unittest.TestCase):
    def test_lost_heartbeat_terminates_owned_group_without_supervisor(self):
        import psutil
        from scripts.verification_posix_watchdog import PosixWatchdog
        with tempfile.TemporaryDirectory() as temp:
            child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(15)'], start_new_session=True)
            watchdog = PosixWatchdog(child, 10, temp, heartbeat=.4)
            try:
                child.wait(timeout=4)
                self.assertEqual(child.returncode, -signal.SIGKILL)
                watchdog.process.wait(timeout=3)
                self.assertIn('heartbeat expired', watchdog.failure_reason())
            finally:
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
                watchdog.process.stdin.close()
                self.assertFalse(psutil.pid_exists(child.pid))

    def test_supervisor_pipe_loss_terminates_owned_group(self):
        from scripts.verification_posix_watchdog import PosixWatchdog
        with tempfile.TemporaryDirectory() as temp:
            child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(15)'], start_new_session=True)
            watchdog = PosixWatchdog(child, 10, temp)
            try:
                watchdog.process.stdin.close()
                child.wait(timeout=4)
                watchdog.process.wait(timeout=3)
                self.assertEqual(child.returncode, -signal.SIGKILL)
                self.assertIn('lost supervisor', watchdog.failure_reason())
            finally:
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()


@unittest.skipUnless(os.name == 'posix', 'POSIX watchdog status')
class PosixWatchdogStatusTests(unittest.TestCase):
    def test_status_is_published_by_replace_never_truncated_in_place(self):
        from scripts.verification_posix_watchdog import write_status
        with tempfile.TemporaryDirectory() as temp:
            status = Path(temp) / 'posix-watchdog.json'
            status.write_text('{"disarmed": false}')
            with mock.patch('scripts.verification_posix_watchdog.os.replace', wraps=os.replace) as replace:
                write_status(status, {'disarmed': False, 'error': 'Independent POSIX watchdog deadline expired', 'peakRssMiB': 1})
            replace.assert_called_once()
            source, destination = replace.call_args.args
            self.assertEqual(Path(destination), status)
            self.assertNotEqual(Path(source), status)
            self.assertFalse(Path(source).exists())
            self.assertEqual(json.loads(status.read_text())['error'], 'Independent POSIX watchdog deadline expired')
            self.assertEqual(sorted(path.name for path in Path(temp).iterdir()), ['posix-watchdog.json'])


@unittest.skipUnless(os.name == 'posix', 'POSIX watchdog sampled RSS')
class PosixWatchdogMemoryTests(unittest.TestCase):
    def test_sampled_memory_budget_terminates_only_owned_workload(self):
        from scripts.verification_posix_watchdog import PosixWatchdog
        with tempfile.TemporaryDirectory() as temp:
            child = subprocess.Popen([sys.executable, '-c', 'import time; data=bytearray(8*1024*1024); time.sleep(10)'], start_new_session=True)
            watchdog = PosixWatchdog(child, 10, temp, memory_mib=1)
            try:
                child.wait(timeout=4)
                watchdog.process.wait(timeout=3)
                self.assertEqual(child.returncode, -signal.SIGKILL)
                self.assertIn('RSS budget exceeded', watchdog.failure_reason())
            finally:
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
                watchdog.process.stdin.close()
