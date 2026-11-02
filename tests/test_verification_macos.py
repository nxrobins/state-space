"""Mac qualification policy tests run without a browser, GPU or simulation."""

import sys
import json
from pathlib import Path
import tempfile
import unittest
from scripts.verification_macos import M6_PROBE_STAGES, M6_SCENES, M6_STAGES, STAGES, SANDBOX_STAGES, m6_stage, require_preceding_stage, stage_bounds, validate_qualification


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
            self.assertEqual((scope["maxDimension"], scope["maxReplayTicks"], scope["maxFrames"]), stage_bounds(stage))
            self.assertLessEqual(scope["maxDimension"], 128)
        # Every stage's bounds are a fixed table, never a request parameter.
        for stage, bounds in {
            "chamber-visible": (8, 128, 256),
            "sandbox-wax-visible": (16, 128, 512),
            "pilot": (64, 1024, 660),
            "structural-exact": (64, 1024, 660),
            "replay-32-cut": (64, 1024, 660),
            "scale-128-visible": (128, 1024, 8),
            "gameplay-128-visible": (128, 1024, 660),
            "gameplay-128-profile-visible": (128, 1024, 660),
            "gameplay-64-visible": (64, 1024, 660),
            "m6-gameplay-32-burning-bridge": (32, 32, 32),
            "m6-gameplay-64-thermal-valve": (64, 32, 32),
            "m6-replay-32-thermal-valve": (32, 1024, 660),
            "m6-replay-64-thermal-valve-ceramic": (64, 256, 660),
            "m6-tiny-dense": (16, 64, 0),
            "m6-tiny-active": (16, 64, 0),
        }.items():
            self.assertEqual(stage_bounds(stage), bounds, stage)
        self.assertEqual(len(M6_STAGES), 12)
        self.assertEqual(M6_PROBE_STAGES, ("m6-tiny-dense", "m6-tiny-active"))
        self.assertTrue(all(m6_stage(stage) is None for stage in M6_PROBE_STAGES))
        self.assertEqual(m6_stage("m6-replay-64-thermal-valve-ceramic"), ("replay", 64, "thermal-valve-ceramic"))
        self.assertIsNone(m6_stage("replay-64-cut-long"))
        self.assertTrue(all(scene in M6_SCENES for _, _, scene in map(m6_stage, M6_STAGES)))
        for timeout in [0, -1, 301, float("nan"), float("inf")]:
            with self.assertRaises(RuntimeError):
                validate_qualification(command, timeout, platform="darwin")
        for change in [
            command + ["--large"],
            command[:-1] + ["replay-128-cut"],
            command[:-1] + ["m6-replay-128-burning-bridge"],
            command[:-1] + ["m6-gameplay-32-cut"],
            command[:-1] + ["m6-tiny-32-dense"],
            command[:-1] + ["m6-tiny"],
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
            for stage in M6_STAGES:
                if m6_stage(stage)[1] == 32:
                    self.assertIsNone(require_preceding_stage(root, stage, hashes))
            for stage in M6_PROBE_STAGES:
                self.assertIsNone(require_preceding_stage(root, stage, hashes))
            m6_pairs = [(stage, stage.replace("-64-", "-32-")) for stage in M6_STAGES if m6_stage(stage)[1] == 64]
            for target, prior in [(target, "chamber-visible") for target in SANDBOX_STAGES] + [("scale-128-visible", "replay-64-cut-long"), ("gameplay-128-visible", "scale-128-visible"), ("gameplay-128-profile-visible", "scale-128-visible")] + m6_pairs:
                root = Path(folder) / target
                root.mkdir()
                with self.assertRaises(RuntimeError):
                    require_preceding_stage(root, target, hashes, now=100000)
                job = "a" * 32
                path = root / ("macos-" + prior + "-test") / "report.json"
                path.parent.mkdir()
                receipt_path = root / job / "report.json"
                receipt_path.parent.mkdir(exist_ok=True)
                result = {"passed": True, "done": True, "energyDriftQ": "0", "backendInfo": {"isFallbackAdapter": False}, "scenario": "cut"}
                m6 = m6_stage(prior)
                if m6:
                    result.update(size=32, scenario=m6[2], catalog="thermal", rulesVersion="ca-3d-m6")
                    if m6[0] == "replay":
                        result.update(ticks=1024, runs=[{"mode": mode, "start": 0, "end": 1024, "exact": True} for mode in ("dense", "active")])
                    else:
                        result.update(frames=32, physicsExact=True)
                elif prior == "chamber-visible":
                    result.update(size=8, journeys=[str(i) for i in range(13)], render={"frames": [1] * 120})
                elif target == "scale-128-visible":
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
                    (report, path, "result", {**result, "runs": [], "frames": [], "journeys": []}),
                    *([(report, path, "result", {**result, "catalog": None})] if m6 else []),
                    (receipt, receipt_path, "passed", False),
                    (receipt, receipt_path, "exitCode", 1),
                ]:
                    destination.write_text(json.dumps({**document, key: bad}))
                    with self.assertRaises(RuntimeError):
                        require_preceding_stage(root, target, hashes, now=100000)
                    destination.write_text(json.dumps(document))
