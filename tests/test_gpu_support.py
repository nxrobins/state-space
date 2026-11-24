"""CPU discovery must never touch a native adapter."""
import os
from pathlib import Path
import subprocess
import sys
import textwrap
import unittest
from unittest.mock import patch

from tests import gpu_support


class GpuSelectionTests(unittest.TestCase):
    def test_cpu_mode_skips_before_adapter_discovery(self):
        for required in ('', '0'):
            with self.subTest(required=required), patch.dict(os.environ, {
                'STATE_SPACE_VERIFICATION_KIND': 'cpu', 'STATE_SPACE_REQUIRE_GPU': required,
            }), patch.object(gpu_support, 'adapter_error') as probe:
                test = gpu_support.requires_gpu(lambda: None)
                self.assertTrue(test.__unittest_skip__)
                probe.assert_not_called()

    def test_cpu_gpu_conflict_and_invalid_policy_fail_before_adapter_discovery(self):
        for required in ('1', 'invalid'):
            with self.subTest(required=required), patch.dict(os.environ, {
                'STATE_SPACE_VERIFICATION_KIND': 'cpu', 'STATE_SPACE_REQUIRE_GPU': required,
            }), patch.object(gpu_support, 'adapter_error') as probe:
                with self.assertRaises(RuntimeError):
                    gpu_support.requires_gpu(lambda: None)
                probe.assert_not_called()

    def test_explicit_gpu_mode_keeps_success_and_missing_adapter_failure(self):
        with patch.dict(os.environ, {
            'STATE_SPACE_VERIFICATION_KIND': 'gpu', 'STATE_SPACE_REQUIRE_GPU': '1',
        }), patch.object(gpu_support, 'adapter_error', return_value=None) as probe:
            def target():
                pass
            self.assertIs(gpu_support.requires_gpu(target), target)
            probe.assert_called_once()
            probe.return_value = 'unavailable'
            with self.assertRaisesRegex(RuntimeError, 'no WebGPU adapter'):
                gpu_support.requires_gpu(target)

    def test_optional_adapter_behavior_outside_cpu_job(self):
        with patch.dict(os.environ, {
            'STATE_SPACE_VERIFICATION_KIND': '', 'STATE_SPACE_REQUIRE_GPU': '0',
        }), patch.object(gpu_support, 'adapter_error', return_value='unavailable'):
            self.assertTrue(gpu_support.requires_gpu(lambda: None).__unittest_skip__)

    def test_whole_cpu_discovery_does_not_request_an_adapter(self):
        root = Path(__file__).resolve().parent.parent
        code = textwrap.dedent('''
            import unittest
            from unittest.mock import patch
            import wgpu
            with patch.object(wgpu.gpu, 'request_adapter_sync', side_effect=AssertionError('GPU requested')) as probe:
                loader = unittest.TestLoader()
                suite = loader.discover('tests')
                assert suite.countTestCases() > 300
                assert not loader.errors, loader.errors
                probe.assert_not_called()
        ''')
        env = {**os.environ,
            'STATE_SPACE_VERIFICATION_KIND': 'cpu', 'STATE_SPACE_REQUIRE_GPU': '0',
        }
        subprocess.run([sys.executable, '-B', '-c', code], cwd=root, env=env, check=True, timeout=20)
