"""Independent POSIX deadline/heartbeat guard for one owned process group.

Never attaches to a user process. The supervisor passes a fresh session leader
and its creation time; only that group can be signalled. RSS is a sampled bound,
not a kernel memory cap. A GPU/OS hang remains outside userspace containment.
"""

import argparse
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import time

import psutil


class PosixWatchdog:
    def __init__(self, child, timeout, output, memory_mib=8192, heartbeat=3):
        self.status = Path(output) / "posix-watchdog.json"
        with (Path(output) / "posix-watchdog.log").open("wb") as stderr:
            self.process = subprocess.Popen(
                [
                    sys.executable,
                    "-B",
                    "-m",
                    "scripts.verification_posix_watchdog",
                    str(child.pid),
                    str(psutil.Process(child.pid).create_time()),
                    str(timeout),
                    str(memory_mib),
                    str(heartbeat),
                    str(self.status),
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=stderr,
                start_new_session=True,
            )
        os.set_blocking(self.process.stdin.fileno(), False)
        self.pulse()

    def pulse(self):
        if self.process.poll() is not None:
            raise RuntimeError(
                self.failure_reason() or "Independent POSIX watchdog exited"
            )
        os.write(self.process.stdin.fileno(), b".")

    def failure_reason(self):
        if self.status.exists():
            return json.loads(self.status.read_text()).get("error")
        return None

    def close(self, *, disarm=True):
        try:
            if self.process.poll() is None and disarm:
                os.write(self.process.stdin.fileno(), b"D")
        finally:
            self.process.stdin.close()
        self.process.wait(timeout=3)
        reason = self.failure_reason()
        if reason:
            raise RuntimeError(reason)
        if not self.status.exists() or not json.loads(self.status.read_text()).get(
            "disarmed"
        ):
            raise RuntimeError("Independent POSIX watchdog did not acknowledge cleanup")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pid", type=int)
    parser.add_argument("birth", type=float)
    parser.add_argument("timeout", type=float)
    parser.add_argument("memory", type=float)
    parser.add_argument("heartbeat", type=float)
    parser.add_argument("status", type=Path)
    args = parser.parse_args()
    start = last = time.monotonic()
    known = {}
    peak = 0
    # Verify the registered identity before taking ownership. A child may have
    # already exited; its group is still owned until the supervisor disarms it.
    try:
        leader = psutil.Process(args.pid)
        if leader.create_time() != args.birth or os.getpgid(args.pid) != args.pid:
            raise RuntimeError("Independent POSIX watchdog identity mismatch")
        known[args.pid] = leader
    except (psutil.NoSuchProcess, ProcessLookupError):
        leader = None
    reason = None
    try:
        while True:
            ready, _, _ = select.select([sys.stdin.buffer], [], [], 0.2)
            if ready:
                message = os.read(sys.stdin.fileno(), 4096)
                if b"D" in message:
                    args.status.write_text(
                        json.dumps({"disarmed": True, "peakRssMiB": peak})
                    )
                    return 0
                if not message:
                    raise RuntimeError("Independent POSIX watchdog lost supervisor")
                last = time.monotonic()
            now = time.monotonic()
            if now - start > args.timeout:
                raise RuntimeError("Independent POSIX watchdog deadline expired")
            if now - last > args.heartbeat:
                raise RuntimeError("Independent POSIX watchdog heartbeat expired")
            if leader is not None:
                try:
                    for process in leader.children(recursive=True):
                        known[process.pid] = process
                except (psutil.NoSuchProcess, ProcessLookupError):
                    pass
            rss = 0
            for pid, process in list(known.items()):
                try:
                    if process.is_running() and os.getpgid(pid) == args.pid:
                        rss += process.memory_info().rss
                    else:
                        del known[pid]
                except (psutil.NoSuchProcess, ProcessLookupError):
                    del known[pid]
            peak = max(peak, rss / 1024**2)
            if peak > args.memory:
                raise RuntimeError("Independent POSIX watchdog RSS budget exceeded")
    except BaseException as error:
        reason = str(error)
        try:
            os.killpg(args.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        args.status.write_text(
            json.dumps({"disarmed": False, "error": reason, "peakRssMiB": peak})
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
