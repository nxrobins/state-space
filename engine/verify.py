"""Run checkpoint gates and retain their commands, output, and source hashes."""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def source_hashes() -> dict[str, str]:
    paths = []
    for directory in ("engine", "eval", "tests", "locked", "web", "scripts", "examples", "game/src", "tower-defense-rogue/src"):
        paths.extend(path for path in (ROOT / directory).rglob("*")
                     if path.suffix in (".py", ".ts", ".js", ".mjs", ".json", ".wgsl", ".html", ".css")
                     and not any(part in ("node_modules", "__pycache__", ".ruff_cache") for part in path.parts))
    paths.extend(ROOT / name for name in ("pyproject.toml", "package.json", "package-lock.json", "uv.lock",
                                         "evolve_ss.py", "test_invariants.py", "test_cascade.py",
                                         "ENGINE_CONTRACT.md", "ENGINE_INVARIANTS.md", "docs/SDK.md", "docs/EVOLUTION.md", "docs/STRUCTURES.md", "docs/CAPABILITIES.md"))
    return {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(paths) if path.is_file()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, default=ROOT / "docs/checkpoints/latest-verification.json")
    parser.add_argument("--browser-cli", default=os.environ.get("STATE_SPACE_BROWSER_CLI"), help="agent-browser executable or JavaScript launcher; otherwise use PATH")
    args = parser.parse_args()
    npm = shutil.which("npm.cmd" if sys.platform == "win32" else "npm")
    if npm is None:
        raise RuntimeError("npm is required to verify the browser engine and integration clients")
    commands = [
        (".", [sys.executable, "-m", "engine.lint"]),
        (".", [sys.executable, "-m", "ruff", "check", "."]),
        (".", [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"]),
        (".", [sys.executable, "test_cascade.py"]),
        (".", [sys.executable, "test_invariants.py"]),
        (".", [npm, "test"]),
        (".", [npm, "run", "lint"]),
        (".", [npm, "run", "typecheck"]),
        ("game", [npm, "test"]),
        ("game", [npm, "run", "build"]),
        ("tower-defense-rogue", [npm, "test"]),
        ("tower-defense-rogue", [npm, "run", "build"]),
        (".", [sys.executable, "scripts/verify_sdk.py", "--report", str(args.report.with_name(args.report.stem + "-sdk.json"))]),
        (".", [shutil.which("node"), "--test", "examples/lab/lab.test.mjs"]),
        (".", [sys.executable, "-m", "scripts.verify_browser", "--output", str(args.report.with_name(args.report.stem + "-browser")),
               "--sdk-report", str(args.report.with_name(args.report.stem + "-sdk.json")), *(["--browser-cli", args.browser_cli] if args.browser_cli else [])]),
        (".", [sys.executable, "-m", "eval.verify", "--benchmark", "--output", str(args.report.with_name(args.report.stem + "-evaluation"))]),
    ]
    before = source_hashes()
    report = {"reportVersion": 1, "startedAt": datetime.now(timezone.utc).isoformat(),
              "python": sys.version, "sourceHashes": before, "checks": []}
    for cwd, command in commands:
        print(f"Verify ({cwd}): {' '.join(command[1:])}", flush=True)
        deadline = 600 if "eval.verify" in command or "scripts.verify_browser" in command else 180
        try:
            result = subprocess.run(command, cwd=ROOT / cwd, capture_output=True, text=True,
                                    encoding="utf-8", errors="replace", timeout=deadline, check=False)
            check = {"cwd": cwd, "command": command, "exitCode": result.returncode,
                     "stdout": result.stdout, "stderr": result.stderr}
        except subprocess.TimeoutExpired as error:
            def captured(value):
                return value.decode("utf-8", errors="replace") if isinstance(value, bytes) else value or ""
            check = {"cwd": cwd, "command": command, "exitCode": None, "error": str(error),
                     "stdout": captured(error.stdout), "stderr": captured(error.stderr)}
        report["checks"].append(check)
        print("  PASS" if check["exitCode"] == 0 else "  FAIL", flush=True)
    report["sourceUnchangedDuringVerification"] = before == source_hashes()
    report["passed"] = all(check["exitCode"] == 0 for check in report["checks"]) and report["sourceUnchangedDuringVerification"]
    report["finishedAt"] = datetime.now(timezone.utc).isoformat()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"Report: {args.report}")
    return int(not report["passed"])


if __name__ == "__main__":
    raise SystemExit(main())
