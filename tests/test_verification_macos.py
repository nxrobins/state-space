"""Mac qualification policy tests run without a browser, GPU or simulation."""

import sys
import json
from pathlib import Path
import tempfile
import unittest
from scripts.verification_macos import STAGES, require_preceding_stage, validate_qualification


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
            self.assertEqual(scope["maxDimension"], 128 if stage in ("scale-128-visible", "gameplay-128-visible") else 64)
            self.assertEqual(scope["maxFrames"], 8 if stage == "scale-128-visible" else 660)
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


class MacScalePrerequisiteTests(unittest.TestCase):
    def test_scale_stages_require_recent_source_bound_completed_receipts(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            hashes = {"physics": "current"}
            self.assertIsNone(require_preceding_stage(root, "pilot", hashes))
            for target, prior in [("scale-128-visible", "replay-64-cut-long"), ("gameplay-128-visible", "scale-128-visible")]:
                with self.assertRaises(RuntimeError):
                    require_preceding_stage(root, target, hashes, now=100000)
                job = "a" * 32
                path = root / ("macos-" + prior + "-test") / "report.json"
                path.parent.mkdir()
                receipt_path = root / job / "report.json"
                receipt_path.parent.mkdir(exist_ok=True)
                result = {"passed": True, "done": True, "energyDriftQ": "0", "backendInfo": {"isFallbackAdapter": False}, "scenario": "cut"}
                if target == "scale-128-visible":
                    result.update(size=64, ticks=1024, runs=[{"mode": mode, "start": 0, "end": 1024, "exact": True} for mode in ("dense", "active")])
                else:
                    result.update(size=128, frames=[{}] * 8)
                report = {"passed": True, "sourceUnchanged": True, "stage": prior, "sourceHashes": hashes, "supervisorJob": job, "result": result}
                receipt = {"passed": True, "id": job, "kind": "macos-qualification", "command": ["--stage", prior], "exitCode": 0, "finishedAt": 99999}
                path.write_text(json.dumps(report))
                receipt_path.write_text(json.dumps(receipt))
                proof = require_preceding_stage(root, target, hashes, now=100000)
                self.assertEqual(proof["stage"], prior)
                self.assertEqual(len(proof["reportSha256"]), 64)
                for bad_hashes, now in [({"physics": "changed"}, 100000), (hashes, 200000), (hashes, 99998)]:
                    with self.assertRaises(RuntimeError):
                        require_preceding_stage(root, target, bad_hashes, now=now)
                for document, destination, key, bad in [
                    (report, path, "passed", False),
                    (report, path, "sourceUnchanged", False),
                    (report, path, "supervisorJob", "../outside"),
                    (report, path, "result", {**result, "energyDriftQ": "1"}),
                    (report, path, "result", {**result, "runs": [], "frames": []}),
                    (receipt, receipt_path, "passed", False),
                    (receipt, receipt_path, "exitCode", 1),
                ]:
                    destination.write_text(json.dumps({**document, key: bad}))
                    with self.assertRaises(RuntimeError):
                        require_preceding_stage(root, target, hashes, now=100000)
                    destination.write_text(json.dumps(document))
