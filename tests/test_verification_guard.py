"""CPU-only regression checks for containment, exclusion and cancellation."""
import ctypes
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from scripts.verification_guard import Lease, ROOT


class VerificationGuardTests(unittest.TestCase):
    def run_guard(self, folder, script, timeout=5):
        return subprocess.run([sys.executable, '-m', 'scripts.verification_guard', '--kind', 'cpu',
                               '--timeout', str(timeout), '--stall', str(timeout), '--output', str(folder),
                               '--', sys.executable, '-u', '-c', script], cwd=ROOT,
                              capture_output=True, text=True, timeout=15)

    def test_contained_success(self):
        with tempfile.TemporaryDirectory() as temp:
            result = self.run_guard(Path(temp), 'print("bounded child " + chr(10003), flush=True)')
            report = json.loads((Path(temp) / 'report.json').read_text())
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertTrue(report['passed'])
            self.assertIn('bounded child', (Path(temp) / 'stdout.log').read_text())

    def test_second_verification_never_starts(self):
        with tempfile.TemporaryDirectory() as temp, Lease():
            result = self.run_guard(Path(temp), 'print("must not run")')
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('owns the lease', (Path(temp) / 'report.json').read_text())
            self.assertFalse((Path(temp) / 'stdout.log').exists())

    def test_timeout_kills_descendants(self):
        with tempfile.TemporaryDirectory() as temp:
            script = 'import subprocess,sys,time; p=subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"]); print(p.pid,flush=True); time.sleep(30)'
            result = self.run_guard(Path(temp), script, timeout=1)
            report = json.loads((Path(temp) / 'report.json').read_text())
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(report['passed'])
            pid = int((Path(temp) / 'stdout.log').read_text().strip())
            if os.name == 'nt':
                kernel = ctypes.WinDLL('kernel32', use_last_error=True)
                kernel.OpenProcess.restype = ctypes.c_void_p
                kernel.CloseHandle.argtypes = [ctypes.c_void_p]
                handle = kernel.OpenProcess(0x1000, False, pid)
                if handle:
                    code = ctypes.c_ulong()
                    kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
                    kernel.GetExitCodeProcess(handle, ctypes.byref(code))
                    kernel.CloseHandle(handle)
                    self.assertNotEqual(code.value, 259, 'Descendant survived containment timeout')


if __name__ == '__main__':
    unittest.main()
