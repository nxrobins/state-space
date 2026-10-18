"""Exercise only owned print/sleep process groups on POSIX hosts."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent


@unittest.skipUnless(os.name == 'posix', 'POSIX process-group containment')
class PosixVerificationTests(unittest.TestCase):
    def run_guard(self, root, payload, timeout=3):
        entry = (
            "import sys; from pathlib import Path; from scripts import verification_guard as g; "
            "g.ROOT=Path(sys.argv.pop(1)); "
            "g.HostHealth=lambda: type('Health',(),{'sample':lambda self: "
            "{'hostCpuPercent':1,'freeMemoryMiB':32768}})(); "
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
            self.assertIn('Timeout', report['error'])
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
