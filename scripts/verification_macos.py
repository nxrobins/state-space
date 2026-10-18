"""Fixed Mac qualification commands; no engine, browser or GPU imports."""

from pathlib import Path
import sys

REPLAY_STAGES = tuple(
    f"replay-{size}-{case}"
    for size in (32, 64)
    for case in ("control", "cut", "heat", "ice-control", "ice-heat")
)
STAGES = (
    "pilot",
    "client",
    "lighting",
    *REPLAY_STAGES,
    "frames-reference",
    "frames-cached",
    "frames-visible",
    "gameplay-visible",
    "gameplay-cached-visible",
    "gameplay-64-visible",
    "gameplay-64-cached-visible",
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
        "maxDimension": 64,
        "maxReplayTicks": 1024,
        "maxFrames": 660,
        "gpuTelemetryAvailable": False,
        "independentWatchdog": True,
        "sampledRssLimitMiB": 8192,
    }
