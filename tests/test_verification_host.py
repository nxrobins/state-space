"""Incident and receipt preservation using temporary directories and mocked Git."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from unittest.mock import patch

from scripts import verification_guard
from scripts.verification_host import assert_host_allowed

ROOT = Path(__file__).resolve().parent.parent


class HostIncidentTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.base = Path(temp.name)
        self.workspace = self.base / 'work'
        self.checkout = self.workspace / 'old'
        self.checkout.mkdir(parents=True)
        self.sibling = self.base / 'sibling'
        self.sibling.mkdir()
        self.directory = self.base / 'incident'
        self.directory.mkdir()
        self.hold = self.directory / 'safety-hold.json'
        self.hold.write_text(json.dumps({'blockRecovery': False, 'checkoutRoots': [str(self.checkout)]}))
        self.receipt = self.directory / 'receipts/prior.json'
        self.receipt.parent.mkdir()
        self.receipt.write_text('{"passed": false}')
        env = {'STATE_SPACE_HOST_STATE_DIR': str(self.directory),
               'RUNNER_WORKSPACE': str(self.workspace), 'GITHUB_WORKSPACE': str(self.workspace),
               'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1',
               'GITHUB_ENV': str(self.base / 'env')}
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, env).start()
        output = f'worktree {self.checkout}\0\0worktree {self.sibling}\0\0'
        self.git = patch('scripts.verification_host.subprocess.run', return_value=
                         subprocess.CompletedProcess([], 0, stdout=output)).start()

    def bootstrap(self):
        workflow = (ROOT / '.github/workflows/gpu-verification.yml').read_text()
        code = workflow.split('        run: |\n', 1)[1].split('      - uses:', 1)[0]
        exec(compile(textwrap.dedent(code), 'gpu-workflow-bootstrap', 'exec'), {})

    def test_blocked_and_damaged_host_state_stop_before_checkout(self):
        for state in ('{"blockRecovery": true}', '{}', 'null', 'broken'):
            with self.subTest(state=state):
                self.hold.write_text(state)
                before = self.hold.read_bytes(), self.receipt.read_bytes()
                with self.assertRaises((RuntimeError, ValueError, AttributeError)):
                    self.bootstrap()
                self.assertEqual(before, (self.hold.read_bytes(), self.receipt.read_bytes()))
                self.assertFalse((self.workspace / 'gpu-runs').exists())
                self.git.assert_not_called()

    def test_missing_host_state_blocks(self):
        self.hold.unlink()
        with self.assertRaises(FileNotFoundError):
            self.bootstrap()
        with self.assertRaisesRegex(RuntimeError, 'Host verification blocked'):
            assert_host_allowed(self.checkout)

    def test_fresh_checkout_control_preserves_prior_receipts(self):
        self.bootstrap()
        assert_host_allowed(self.checkout)
        self.assertEqual(self.receipt.read_text(), '{"passed": false}')
        self.assertIn(str(self.directory), (self.base / 'env').read_text())

    def test_reused_target_is_refused_even_with_clean_false(self):
        old = self.workspace / 'gpu-runs/123-1/dist/verification'
        old.mkdir(parents=True)
        receipt = old / 'prior.json'
        receipt.write_text('retained')
        with self.assertRaisesRegex(RuntimeError, 'reuse or clean'):
            self.bootstrap()
        self.assertEqual(receipt.read_text(), 'retained')

    def test_host_state_inside_runner_workspace_is_refused(self):
        with patch.dict(os.environ, {'STATE_SPACE_HOST_STATE_DIR': str(self.checkout)}):
            with self.assertRaisesRegex(RuntimeError, 'outside the runner workspace'):
                self.bootstrap()

    def test_sibling_hold_blocks_supervisor_and_leaf_without_consuming_it(self):
        hold = self.sibling / 'dist/verification/safety-hold.json'
        hold.parent.mkdir(parents=True)
        hold.write_text('{"blockRecovery": true}')
        for check in (verification_guard.assert_verification_allowed, verification_guard.assert_runtime_not_blocked):
            with self.subTest(check=check.__name__), self.assertRaisesRegex(RuntimeError, 'checkout incident'):
                check(self.checkout)
        self.assertEqual(hold.read_text(), '{"blockRecovery": true}')
        self.assertEqual(self.receipt.read_text(), '{"passed": false}')

    def test_failed_inventory_blocks(self):
        self.git.side_effect = subprocess.CalledProcessError(1, ['git'])
        with self.assertRaisesRegex(RuntimeError, 'Host verification blocked'):
            assert_host_allowed(self.checkout)

    def test_new_host_hold_is_rechecked_after_bootstrap(self):
        self.bootstrap()
        self.hold.write_text('{"blockRecovery": true}')
        with self.assertRaisesRegex(RuntimeError, 'Host verification blocked'):
            verification_guard.assert_verification_allowed(self.checkout)

    def test_registered_previous_run_is_checked(self):
        previous = self.base / 'previous'
        previous.mkdir()
        registrations = self.directory / 'checkouts'
        registrations.mkdir()
        (registrations / 'previous.json').write_text(json.dumps(str(previous)))
        assert_host_allowed(self.checkout)
        self.assertIn(str(previous), [call.args[0][2] for call in self.git.call_args_list])

    def test_other_checkout_permit_retains_its_local_semantics(self):
        isolated = self.base / 'isolated'
        hold = isolated / 'dist/verification/safety-hold.json'
        hold.parent.mkdir(parents=True)
        hold.write_text(json.dumps({'blockRecovery': False, 'recoveryPermit': {
            'command': ['control'], 'kind': 'cpu', 'timeoutSeconds': 5,
            'expiresAt': time.time() + 30,
        }}))
        verification_guard.assert_verification_allowed(isolated, command=['control'], kind='cpu', timeout=5)
        self.assertIn('lastRecovery', json.loads(hold.read_text()))
        with self.assertRaises(RuntimeError):
            verification_guard.assert_verification_allowed(isolated, command=['control'], kind='cpu', timeout=5)

    def test_workflow_preserves_preflight_order_and_disables_cleaning(self):
        source = (ROOT / '.github/workflows/gpu-verification.yml').read_text()
        self.assertLess(source.index('Check durable host incident state'), source.index('uses: actions/checkout'))
        self.assertLess(source.index('Check legacy checkout holds'), source.index('uv sync'))
        self.assertIn('clean: false', source)
        self.assertIn('path: gpu-runs/${{ github.run_id }}-${{ github.run_attempt }}', source)

    def test_refused_launch_keeps_receipt_and_lease_outside_checkout(self):
        argv = ['verification_guard', '--kind', 'cpu', '--', 'unreachable']
        with patch.object(sys, 'argv', argv), patch.object(verification_guard, 'ROOT', self.checkout), \
             patch.object(verification_guard.HostHealth, 'sample', side_effect=RuntimeError('mock preflight refusal')), \
             patch.object(verification_guard.subprocess, 'Popen') as child:
            self.assertEqual(verification_guard.main(), 1)
            child.assert_not_called()
        records = list((self.directory / 'receipts/123-1').glob('*/report.json'))
        self.assertEqual(len(records), 1)
        self.assertFalse(json.loads(records[0].read_text())['passed'])
        self.assertTrue((self.directory / 'lease.lock').is_file())
        self.assertFalse((self.checkout / 'dist/verification').exists())
