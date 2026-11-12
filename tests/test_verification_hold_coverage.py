"""The incident hold reaches unsupervised entry points, and the release gate stays observable.

Mock-only: no test here launches a workload. Every entry point is called with a hard
hold in a temporary root and no arguments, so a missing check fails on argument
parsing (SystemExit) instead of running anything.
"""
import importlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

UNSUPERVISED = ('benchmark_gpu', 'benchmark_frames', 'benchmark_browser', 'benchmark_spillway',
                'verify_browser', 'verify_volume_browser')


def hard_hold(root):
    hold = Path(root) / 'dist/verification/safety-hold.json'
    hold.parent.mkdir(parents=True)
    hold.write_text(json.dumps({'blockRecovery': True}), encoding='utf-8')
    return hold


class HoldCoverageTests(unittest.TestCase):
    def test_unsupervised_entry_points_refuse_before_argument_parsing(self):
        for name in UNSUPERVISED:
            with self.subTest(module=name), tempfile.TemporaryDirectory() as temp:
                module = importlib.import_module('scripts.' + name)
                hold = hard_hold(temp)
                before = hold.read_bytes()
                with mock.patch.object(module, 'ROOT', Path(temp)), mock.patch.object(sys, 'argv', [name]), \
                     mock.patch.object(subprocess, 'run') as run, mock.patch.object(subprocess, 'Popen') as popen:
                    with self.assertRaisesRegex(RuntimeError, 'blocked'):
                        module.main()
                run.assert_not_called()
                popen.assert_not_called()
                self.assertEqual(hold.read_bytes(), before)

    def test_m4_recovery_refuses_without_rewriting_a_hard_hold(self):
        from scripts import recover_m4_verification
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            hold = hard_hold(root)
            before = hold.read_bytes()
            with mock.patch.object(recover_m4_verification, 'ROOT', root), \
                 mock.patch.object(sys, 'argv', ['recovery', 'lint']), \
                 mock.patch.object(subprocess, 'run') as child:
                with self.assertRaisesRegex(RuntimeError, 'blocked'):
                    recover_m4_verification.main()
                child.assert_not_called()
            self.assertEqual(hold.read_bytes(), before)
            self.assertFalse((root / 'dist/volume-m4').exists())


class ReleaseGateTests(unittest.TestCase):
    def test_heartbeat_reports_progress_while_a_step_is_silent(self):
        from engine.verify import run_with_heartbeat
        stream = io.StringIO()
        self.assertEqual(run_with_heartbeat(lambda: time.sleep(0.45) or 7, heartbeat=0.1, stream=stream), 7)
        self.assertGreaterEqual(stream.getvalue().count('still running'), 2)
        quiet = io.StringIO()
        self.assertEqual(run_with_heartbeat(lambda: 3, heartbeat=5, stream=quiet), 3)
        self.assertEqual(quiet.getvalue(), '')

    def test_heartbeat_raises_step_errors_in_the_caller(self):
        from engine.verify import run_with_heartbeat
        def fail(error):
            raise error
        for error in (subprocess.TimeoutExpired(['step'], 1), SystemExit(9)):
            with self.subTest(error=type(error).__name__), self.assertRaises(type(error)):
                run_with_heartbeat(lambda: fail(error), heartbeat=0.05, stream=io.StringIO())

    def test_stopped_gate_keeps_finished_steps_marked_incomplete(self):
        from engine.verify import main as verify_main
        calls = []

        def run(command, **_kwargs):
            calls.append(command)
            if len(calls) == 3:
                raise SystemExit(125)  # Stands in for the supervisor stopping the gate.
            return subprocess.CompletedProcess(command, 0, stdout='passed', stderr='')

        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'report.json'
            with mock.patch('sys.argv', ['verify', '--report', str(path)]), \
                 mock.patch('engine.verify.source_hashes', return_value={}), \
                 mock.patch('engine.verify.shutil.which', return_value='npm'), \
                 mock.patch('engine.verify.subprocess.run', side_effect=run), \
                 mock.patch('scripts.verification_guard.guarded_entry'), mock.patch.dict('os.environ'):
                with self.assertRaises(SystemExit):
                    verify_main()
            report = json.loads(path.read_text(encoding='utf-8'))
            self.assertEqual(len(report['checks']), 2)
            self.assertIs(report['complete'], False)
            self.assertIs(report['passed'], False)
            self.assertNotIn('finishedAt', report)


if __name__ == '__main__':
    unittest.main()
