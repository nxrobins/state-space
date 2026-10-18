"""Validate the Metal smoke launch and work bounds without creating a GPU."""
import sys
import subprocess
import json
from pathlib import Path
import tempfile
from unittest import mock
import unittest
from scripts.verification_metal import bounded_corpus, validate_metal_smoke


class MetalSmokePolicyTests(unittest.TestCase):
    def command(self, stage='adapter'):
        return [sys.executable, '-m', 'scripts.verify_macos_native', '--stage', stage]

    def test_only_fixed_probe_stages_are_accepted(self):
        for stage in ('adapter', 'sdk', 'conformance'):
            self.assertEqual(validate_metal_smoke(self.command(stage), 30, platform='darwin')['stage'], stage)
        for command in ([sys.executable, '-c', 'print(1)'], self.command('benchmark'),
                        [*self.command(), '--extra'], ['node', *self.command()[1:]]):
            with self.subTest(command=command), self.assertRaises(RuntimeError):
                validate_metal_smoke(command, 30, platform='darwin')

    def test_other_platforms_and_long_deadlines_refuse(self):
        for platform in ('linux', 'win32'):
            with self.assertRaises(RuntimeError):
                validate_metal_smoke(self.command(), 30, platform=platform)
        for timeout in (0, -1, 61, float('nan'), float('inf')):
            with self.assertRaises(RuntimeError):
                validate_metal_smoke(self.command(), timeout, platform='darwin')

    def case(self, width=1, height=1, ticks=1):
        return {'width': width, 'height': height, 'ticks': ticks, 'cells': [0] * (width * height)}

    def test_small_complete_corpus_reports_its_actual_work(self):
        self.assertEqual(bounded_corpus([self.case(24, 24, 16), self.case()]),
                         {'cases': 2, 'maxCells': 576, 'totalTicks': 17})

    def test_oversize_incomplete_or_long_corpus_refuses(self):
        cases = [[], [self.case()] * 41, [self.case(25)], [self.case(ticks=17)],
                 [{**self.case(), 'cells': []}], [self.case(ticks=16)] * 17,
                 [{**self.case(), 'width': True}]]
        for corpus in cases:
            with self.subTest(corpusSize=len(corpus)), self.assertRaises(ValueError):
                bounded_corpus(corpus)


class MetalSmokeHoldTests(unittest.TestCase):
    def test_incident_hold_stops_the_fixed_probe_before_gpu_or_child_creation(self):
        from scripts import verification_guard as guard
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            hold = root / 'dist/verification/safety-hold.json'
            hold.parent.mkdir(parents=True)
            hold.write_text('{"blockRecovery":true}')
            argv = ['guard', '--kind', 'metal-smoke', '--timeout', '30', '--output', str(root / 'run'),
                    '--', sys.executable, '-m', 'scripts.verify_macos_native', '--stage', 'adapter']
            with mock.patch.object(guard, 'ROOT', root), mock.patch.object(sys, 'argv', argv), \
                 mock.patch.object(sys, 'platform', 'darwin'), mock.patch.object(guard.subprocess, 'Popen') as child, \
                 mock.patch('builtins.print'):
                self.assertEqual(guard.main(), 1)
                child.assert_not_called()
            report = json.loads((root / 'run/report.json').read_text())
            self.assertFalse(report['passed'])
            self.assertNotIn('childPid', report)
            self.assertIn('blocked', report['error'])


class MetalEvidenceTests(unittest.TestCase):
    def test_partial_reference_output_survives_a_timeout(self):
        from scripts.verify_macos_native import reference
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaises(subprocess.TimeoutExpired):
                reference([sys.executable, '-u', '-c', "import time; print('retained checkpoint',flush=True); time.sleep(10)"],
                          root, 'probe', 2)
            self.assertIn('retained checkpoint', (root / 'probe.stdout.log').read_text())
            self.assertEqual((root / 'probe.stderr.log').read_text(), '')
