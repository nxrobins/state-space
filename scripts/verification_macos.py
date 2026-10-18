"""Fixed Mac qualification commands; no engine, browser or GPU imports."""

from pathlib import Path
import hashlib
import json
import re
import sys
import time

REPLAY_STAGES = tuple(
    f"replay-{size}-{case}"
    for size in (32, 64)
    for case in ("control", "cut", "heat", "ice-control", "ice-heat")
)
STAGES = (
    "pilot",
    "client",
    "lighting",
    "structural-exact",
    "replay-64-cut-long",
    "scale-128-visible",
    "gameplay-128-visible",
    *REPLAY_STAGES,
    "frames-reference",
    "frames-cached",
    "frames-visible",
    "gameplay-visible",
    "gameplay-cached-visible",
    "gameplay-64-visible",
    "gameplay-64-cached-visible",
    "gameplay-64-profile-visible",
)


def validate_qualification(command, timeout, *, platform=None, executable=None):
    if (platform or sys.platform) != "darwin" or not 0 < timeout <= 300:
        raise RuntimeError(
            "Mac qualification requires macOS and a deadline of at most 300 seconds."
        )
    if (
        not command
        or Path(command[0]).resolve() != Path(executable or sys.executable).resolve()
    ):
        raise RuntimeError("Mac qualification requires the supervisor interpreter.")
    if command[1:] == ["-m", "scripts.verify_packages", "--native"]:
        stage = "installed-native-package"
    elif (
        len(command) == 5
        and command[1:4] == ["-m", "scripts.verify_macos_qualification", "--stage"]
        and command[4] in STAGES
    ):
        stage = command[4]
    else:
        raise RuntimeError("Mac qualification permits only fixed bounded stages.")
    return {
        "stage": stage,
        "maxDimension": 128 if stage in ("scale-128-visible", "gameplay-128-visible") else 64,
        "maxReplayTicks": 1024,
        "maxFrames": 8 if stage == "scale-128-visible" else 660,
        "gpuTelemetryAvailable": False,
        "independentWatchdog": True,
        "sampledRssLimitMiB": 8192,
    }


def require_preceding_stage(root, stage, source_hashes, *, now=None):
    """Bind 128-cubed work to a recent completed, source-identical prior stage."""
    required = {
        "scale-128-visible": "replay-64-cut-long",
        "gameplay-128-visible": "scale-128-visible",
    }.get(stage)
    if required is None:
        return None
    now = time.time() if now is None else now
    for path in sorted(root.glob(f"macos-{required}-*/report.json"), reverse=True):
        try:
            report = json.loads(path.read_text())
            result = report["result"]
            job = report["supervisorJob"]
            if not isinstance(job, str) or not re.fullmatch(r"[0-9a-f]{32}", job):
                continue
            receipt_path = root / job / "report.json"
            receipt = json.loads(receipt_path.read_text())
            if not (
                report.get("passed") is True
                and report.get("sourceUnchanged") is True
                and report.get("stage") == required
                and report.get("sourceHashes") == source_hashes
                and result.get("passed") is True
                and result.get("done") is True
                and result.get("energyDriftQ") == "0"
                and result.get("backendInfo", {}).get("isFallbackAdapter") is False
                and receipt.get("passed") is True
                and receipt.get("id") == job
                and receipt.get("kind") == "macos-qualification"
                and receipt.get("command", [])[-1:] == [required]
                and receipt.get("exitCode") == 0
                and 0 <= now - receipt["finishedAt"] <= 86400
            ):
                continue
            if required == "replay-64-cut-long":
                if result.get("size") != 64 or result.get("ticks") != 1024 or result.get("scenario") != "cut":
                    continue
                if not all(
                    {"mode": mode, "start": 0, "end": 1024, "exact": True} in result.get("runs", [])
                    for mode in ("dense", "active")
                ):
                    continue
            elif result.get("size") != 128 or result.get("scenario") != "cut" or len(result.get("frames", [])) != 8:
                continue
            return {
                "stage": required,
                "report": str(path.relative_to(root)),
                "reportSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "receipt": str(receipt_path.relative_to(root)),
                "receiptSha256": hashlib.sha256(receipt_path.read_bytes()).hexdigest(),
            }
        except (OSError, ValueError, KeyError, TypeError):
            continue
    raise RuntimeError(f"{stage} requires a passing {required} receipt from the same sources within 24 hours.")
