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
SANDBOX_STAGES = tuple(f"sandbox-{scene}-visible" for scene in ("collapse", "flow", "chain", "conduction", "insulation", "wax"))
# The structural cavern's ca-3d-m6 chambers: a 32-frame gameplay pilot and a CPU-versus-GPU replay
# (1,024 ticks at 32^3, 256 at 64^3, action tick 16) per chamber and size, bound to the thermal catalog.
M6_SCENES = ("burning-bridge", "thermal-valve", "thermal-valve-ceramic")
M6_STAGES = tuple(
    f"m6-{kind}-{size}-{scene}"
    for kind in ("gameplay", "replay")
    for size in (32, 64)
    for scene in M6_SCENES
)
# The ca-3d-m6 tiny parity probes from the structural probe bundle (dist/volume-m5/structural-probe.js):
# every reactive fixture at 8^3 and 16^3 (at most 64 ticks), the GPU snapshot equal to the CPU oracle
# after every tick, one stage per storage mode, no frames.
M6_PROBE_STAGES = tuple(f"m6-tiny-{mode}" for mode in ("dense", "active"))
# The private multiphysics module Worker (dist/multiphysics/), headless: per scene, direct versus Worker
# exactness across work budgets, cancel/retry and save/restart, plus two-tick preview and cancellation
# latency over 24 samples. The five demonstrations and the 99-sample resolved tank; no frames.
MULTIPHYSICS_WORKER_SCENES = (
    "wax-valve", "rotating-contact", "fluid-switch", "falling-battery", "combined-failure", "resolved-tank",
)
MULTIPHYSICS_WORKER_STAGES = tuple(f"multiphysics-worker-{scene}" for scene in MULTIPHYSICS_WORKER_SCENES)
STAGES = (
    *SANDBOX_STAGES,
    "chamber-visible",
    "pilot",
    "client",
    "lighting",
    "structural-exact",
    "replay-64-cut-long",
    "scale-128-visible",
    "gameplay-128-visible",
    "gameplay-128-profile-visible",
    *REPLAY_STAGES,
    "frames-reference",
    "frames-cached",
    "frames-visible",
    "gameplay-visible",
    "gameplay-cached-visible",
    "gameplay-64-visible",
    "gameplay-64-cached-visible",
    "gameplay-64-profile-visible",
    *M6_STAGES,
    *M6_PROBE_STAGES,
    *MULTIPHYSICS_WORKER_STAGES,
)


def m6_stage(stage):
    """(kind, size, scene) for a ca-3d-m6 cavern stage, else None."""
    if stage not in M6_STAGES:
        return None
    _, kind, size, scene = stage.split("-", 3)
    return kind, int(size), scene


def stage_bounds(stage):
    """(maxDimension, maxReplayTicks, maxFrames) that one fixed stage may reach."""
    m6 = m6_stage(stage)
    if stage in M6_PROBE_STAGES:
        return 16, 64, 0
    if stage in MULTIPHYSICS_WORKER_STAGES:
        return 16, 64, 0
    if m6:
        kind, size, _ = m6
        return size, 32 if kind == "gameplay" else 1024 if size == 32 else 256, 32 if kind == "gameplay" else 660
    if stage == "chamber-visible":
        return 8, 128, 256
    if stage in SANDBOX_STAGES:
        return 16, 128, 512
    if stage == "scale-128-visible":
        return 128, 1024, 8
    if stage in ("gameplay-128-visible", "gameplay-128-profile-visible"):
        return 128, 1024, 660
    return 64, 1024, 660


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
    dimension, ticks, frames = stage_bounds(stage)
    return {
        "stage": stage,
        "maxDimension": dimension,
        "maxReplayTicks": ticks,
        "maxFrames": frames,
        "gpuTelemetryAvailable": False,
        "independentWatchdog": True,
        "sampledRssLimitMiB": 8192,
    }


def require_preceding_stage(root, stage, source_hashes, *, now=None):
    """Bind scale increases to a recent completed, source-identical prior stage."""
    m6 = m6_stage(stage)
    required = {
        "scale-128-visible": "replay-64-cut-long",
        "gameplay-128-visible": "scale-128-visible",
        "gameplay-128-profile-visible": "scale-128-visible",
    }.get(stage, "chamber-visible" if stage in SANDBOX_STAGES else None)
    # A 64^3 ca-3d-m6 stage follows the same chamber's passing 32^3 stage.
    if m6 and m6[1] == 64:
        required = stage.replace("-64-", "-32-")
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
                and result.get("backendInfo", result.get("render", {}).get("backendInfo", {})).get("isFallbackAdapter") is False
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
            elif required == "chamber-visible":
                if result.get("size") != 8 or len(result.get("journeys", [])) != 13 or len(result.get("render", {}).get("frames", [])) != 120:
                    continue
            elif m6:
                if result.get("size") != 32 or result.get("scenario") != m6[2] or result.get("catalog") != "thermal" or result.get("rulesVersion") != "ca-3d-m6":
                    continue
                if m6[0] == "replay" and not all(
                    {"mode": mode, "start": 0, "end": 1024, "exact": True} in result.get("runs", [])
                    for mode in ("dense", "active")
                ):
                    continue
                if m6[0] == "gameplay" and (result.get("frames") != 32 or result.get("physicsExact") is not True):
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
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            continue
    raise RuntimeError(f"{stage} requires a passing {required} receipt from the same sources within 24 hours.")
