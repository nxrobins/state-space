"""Release-boundary regressions: complete evidence, source coverage and daemon capture."""

import ast
import copy
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from engine import verify
from engine.lint import lint_lab_css, lint_release_boundary
from scripts.verify_browser import run_captured, validate_browser_evidence


class ReleaseProperties(unittest.TestCase):
    def test_cascade_gate_rejects_structure_only_replay_difference(self):
        source = (verify.ROOT / 'test_cascade.py').read_text(encoding='utf-8')
        expression = next(node.test for node in ast.walk(ast.parse(source)) if isinstance(node, ast.If)
                          and 'np.array_equal(final_grid' in ast.unparse(node.test))
        first = {'final_grid': np.array([5]), 'final_energy': np.array([5120]), 'final_structure': np.array([255])}
        second = {**first, 'final_structure': np.array([0])}
        variables = {'np': np, 'final_grid': first['final_grid'], 'result': first, 'result2': second}
        self.assertFalse(eval(compile(ast.Expression(expression), 'cascade-test', 'eval'), variables))
        variables['result2'] = first
        self.assertTrue(eval(compile(ast.Expression(expression), 'cascade-test', 'eval'), variables))
        self.assertEqual(lint_release_boundary(source, 'test_cascade.py'), [])
        self.assertTrue(lint_release_boundary("if np.array_equal(result['final_energy'], other): pass", 'test_cascade.py'))

    def test_lab_and_presentation_changes_invalidate_source_manifest(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(verify, 'ROOT', Path(folder)):
            css = Path(folder) / 'examples/lab/style.css'
            css.parent.mkdir(parents=True)
            css.write_text('canvas{height:auto}', encoding='utf-8')
            first = verify.source_hashes()
            self.assertIn('examples/lab/style.css', first)
            css.write_text('canvas{height:200px}', encoding='utf-8')
            self.assertNotEqual(first, verify.source_hashes())
        hashes = verify.source_hashes()
        for path in ('examples/lab/app.js', 'examples/lab/controller.js', 'examples/lab/verify.js', 'examples/lab/index.html',
                     'examples/lab/lab.test.mjs', 'scripts/verify_browser.py', 'docs/CAPABILITIES.md'):
            self.assertIn(path, hashes)
        self.assertTrue(lint_lab_css('canvas{width:100%;max-height:520px;object-fit:contain;}'))
        self.assertEqual(lint_lab_css((verify.ROOT / 'examples/lab/style.css').read_text(encoding='utf-8')), [])

    def test_daemon_capture_returns_after_launcher_without_waiting_for_descendant(self):
        command = [sys.executable, '-c', 'import subprocess,sys; subprocess.Popen([sys.executable,"-c","import time; time.sleep(3)"]); print("launcher complete")']
        started = time.monotonic()
        code, output, _ = run_captured(command, timeout=2)
        self.assertEqual(code, 0)
        self.assertIn('launcher complete', output)
        self.assertLess(time.monotonic() - started, 2)
        with self.assertRaises(subprocess.TimeoutExpired):
            run_captured([sys.executable, '-c', 'import time; time.sleep(2)'], timeout=0.1)
        self.assertTrue(lint_release_boundary('subprocess.run(command, capture_output=True)', 'verify_browser.py'))
        self.assertEqual(lint_release_boundary((verify.ROOT / 'scripts/verify_browser.py').read_text(encoding='utf-8'), 'verify_browser.py'), [])

    def test_browser_release_requires_complete_hardware_behavior_evidence(self):
        corpus = [{'name': str(i), 'passes': [{'cells': [5], 'energyQ': [5120], 'structure': [255]}]} for i in range(31)]
        adapter = {'isFallbackAdapter': False}
        rows = [{'name': case['name'], 'passComparisons': 1, 'completeReportsMatch': True, 'uninspectedMatch': True,
                 'restartMatch': True, 'final': {'packedCells': [5], 'energyQ': [5120], 'structure': [255]}} for case in corpus]
        sdk = {'nativeClient': {'catalogHash': 'test', 'initial': {}, 'final': {}, 'energyQ': '5120', 'replayEqual': True, 'passes': []}}
        results = {'conformance': {'passed': True, 'rows': rows, 'caseCount': 31, 'passComparisons': 31, 'backendInfo': adapter},
                   'lab': {'passed': True, 'sceneCount': 5, 'rows': [{'scene': name, 'backendInfo': adapter, 'reportsMatch': True,
                           'restartMatch': True, 'invalidImportRejected': True, 'concurrentStepsSerialized': True} for name in ('span', 'fragment', 'fire', 'phase', 'extension')]},
                   'ui': {'passed': True, 'snapshotControls': True, 'customFileImport': True, 'playback': True, 'inspectedPasses': 18},
                   'sdk': {**sdk['nativeClient'], 'passDeltasMatch': True, 'invalidRestoreRejected': True,
                           'concurrentAccessRejected': True, 'backendInfo': adapter}}
        validate_browser_evidence(results, corpus, sdk)
        mutants = []
        bad = copy.deepcopy(results)
        bad['conformance']['rows'][0]['final']['structure'] = [0]
        mutants.append(bad)
        bad = copy.deepcopy(results)
        del bad['conformance']['rows'][0]['final']['structure']
        mutants.append(bad)
        bad = copy.deepcopy(results)
        bad['conformance']['backendInfo']['isFallbackAdapter'] = True
        mutants.append(bad)
        bad = copy.deepcopy(results)
        bad['lab']['rows'].pop()
        mutants.append(bad)
        bad = copy.deepcopy(results)
        bad['ui']['playback'] = False
        mutants.append(bad)
        bad = copy.deepcopy(results)
        bad['sdk']['concurrentAccessRejected'] = False
        mutants.append(bad)
        for bad in mutants:
            with self.subTest(bad=bad), self.assertRaises((ValueError, KeyError)):
                validate_browser_evidence(bad, corpus, sdk)
        with self.assertRaises(ValueError):
            validate_browser_evidence(results, [], sdk)

    def test_single_entry_point_requires_browser_and_live_lab(self):
        source = (verify.ROOT / 'engine/verify.py').read_text(encoding='utf-8')
        literals = {node.value for node in ast.walk(ast.parse(source)) if isinstance(node, ast.Constant) and isinstance(node.value, str)}
        for required in ('scripts.verify_browser', '--sdk-report', 'examples/lab/lab.test.mjs', 'eval.verify', '--benchmark'):
            self.assertIn(required, literals)


if __name__ == '__main__':
    unittest.main()
