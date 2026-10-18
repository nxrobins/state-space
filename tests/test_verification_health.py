"""Portable host telemetry, without launching simulation or GPU work."""
import math
import unittest
from unittest import mock
from scripts import verification_health as health


class PortableHostHealthTests(unittest.TestCase):
    def test_posix_samples_cpu_and_available_memory_without_windows_apis(self):
        portable = mock.Mock()
        portable.cpu_percent.side_effect = [0.0, 23.5]
        portable.virtual_memory.return_value.available = 12 * 1024**3
        with mock.patch.object(health.os, 'name', 'posix'), mock.patch.dict('sys.modules', {'psutil': portable}):
            monitor = health.HostHealth()
            sample = monitor.sample()
        self.assertEqual(sample['hostCpuPercent'], 23.5)
        self.assertEqual(sample['freeMemoryMiB'], 12288)
        self.assertTrue(math.isfinite(sample['time']))
        self.assertEqual(portable.cpu_percent.call_count, 2)
        self.assertIsNone(health.health_error(sample, preflight=True))

    def test_missing_portable_dependency_explains_the_setup_command(self):
        with mock.patch.object(health.os, 'name', 'posix'), mock.patch.dict('sys.modules', {'psutil': None}):
            with self.assertRaisesRegex(RuntimeError, 'uv sync'):
                health.HostHealth()

    def test_invalid_host_measurements_fail_closed(self):
        valid = {'freeMemoryMiB': 16384, 'hostCpuPercent': 10}
        for update in ({'freeMemoryMiB': float('nan')}, {'freeMemoryMiB': float('inf')},
                       {'hostCpuPercent': float('nan')}, {'hostCpuPercent': -1}, {'hostCpuPercent': 101}):
            with self.subTest(update=update):
                self.assertIsNotNone(health.health_error({**valid, **update}, preflight=True))

    def test_portable_samples_keep_existing_memory_and_cpu_thresholds(self):
        valid = {'freeMemoryMiB': 16384, 'hostCpuPercent': 10}
        self.assertIsNotNone(health.health_error({**valid, 'freeMemoryMiB': 8191}))
        self.assertIsNotNone(health.health_error({**valid, 'hostCpuPercent': 51}, preflight=True))
        self.assertIsNone(health.health_error({**valid, 'hostCpuPercent': 51}))
