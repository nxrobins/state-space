"""Mac qualification policy tests run without a browser, GPU or simulation."""

import sys
import unittest
from scripts.verification_macos import STAGES, validate_qualification


class MacQualificationPolicyTests(unittest.TestCase):
    def test_only_fixed_commands_and_finite_deadlines_are_accepted(self):
        for stage in STAGES:
            command = [
                sys.executable,
                "-m",
                "scripts.verify_macos_qualification",
                "--stage",
                stage,
            ]
            scope = validate_qualification(command, 300, platform="darwin")
            self.assertEqual(scope["stage"], stage)
            self.assertFalse(scope["gpuTelemetryAvailable"])
            self.assertTrue(scope["independentWatchdog"])
        for timeout in [0, -1, 301, float("nan"), float("inf")]:
            with self.assertRaises(RuntimeError):
                validate_qualification(command, timeout, platform="darwin")
        for change in [
            command + ["--large"],
            command[:-1] + ["replay-128-cut"],
            [sys.executable, "-c", "print(1)"],
        ]:
            with self.assertRaises(RuntimeError):
                validate_qualification(change, 300, platform="darwin")
        with self.assertRaises(RuntimeError):
            validate_qualification(command, 300, platform="linux")

    def test_native_packages_are_an_explicit_separate_command(self):
        scope = validate_qualification(
            [sys.executable, "-m", "scripts.verify_packages", "--native"],
            300,
            platform="darwin",
        )
        self.assertEqual(scope["stage"], "installed-native-package")
