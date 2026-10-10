"""Run the public WebGPU performance matrix on a real hardware browser."""
import argparse
import functools
import http.server
import json
import shutil
import threading
import time
import uuid
from pathlib import Path

from engine.verify import ROOT, source_hashes
from scripts.verify_browser import digest, run_captured


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser-cli", type=Path, required=True)
    parser.add_argument("--native-report", type=Path, required=True)
    parser.add_argument("--scenes", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    before = source_hashes()
    prefix = [shutil.which("node"), str(args.browser_cli.resolve())] if args.browser_cli.suffix in (".js", ".mjs") else [str(args.browser_cli.resolve())]
    session = "state-space-benchmark-" + uuid.uuid4().hex[:12]
    commands = []

    def cli(*arguments, stdin=None):
        command = [*prefix, "--session", session, "--json", *arguments]
        code, stdout, stderr = run_captured(command, stdin=stdin, timeout=60)
        commands.append({"command": command, "exitCode": code, "stderr": stderr})
        if code:
            raise RuntimeError(f"Browser failed: {stdout}\n{stderr}")
        result = json.loads(stdout)
        if result.get("success") is not True:
            raise RuntimeError(f"Browser operation failed: {result}")
        return result["data"]

    class Handler(http.server.SimpleHTTPRequestHandler):
        def translate_path(self, path):
            if path == "/evidence/scenes.json":
                return str(args.scenes.resolve())
            if path == "/evidence/native.json":
                return str(args.native_report.resolve())
            return super().translate_path(path)

        def log_message(self, *_args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        cli("open", f"http://127.0.0.1:{server.server_address[1]}/examples/sdk/browser.html")
        script = ('window.__benchmark={done:false}; window.__benchmarkProgress=null; '
                  'void import("/scripts/browser_benchmark.js").then(module => module.benchmarkBrowserGpu("/evidence/scenes.json", "/evidence/native.json", '
                  'progress => {window.__benchmarkProgress=progress;})).then(result => {window.__benchmark={done:true,result};}, '
                  'error => {window.__benchmark={done:true,error:String(error.stack || error)};}); "started"')
        cli("eval", "--stdin", stdin=script)
        deadline, seen = time.monotonic() + 240, 0
        while True:
            state = cli("eval", "({done:window.__benchmark.done,error:window.__benchmark.error,progress:window.__benchmarkProgress})")["result"]
            if state.get("progress") and state["progress"]["completed"] != seen:
                seen = state["progress"]["completed"]
                print("Browser benchmark:", state["progress"]["scene"], flush=True)
            if state["done"]:
                if state.get("error"):
                    raise RuntimeError(state["error"])
                result = cli("eval", "window.__benchmark.result")["result"]
                break
            if time.monotonic() > deadline:
                raise TimeoutError("Browser benchmark did not finish")
            time.sleep(1)
        errors = cli("errors")
        if errors.get("errors"):
            raise RuntimeError(f"Browser errors: {errors}")
        if before != source_hashes():
            raise ValueError("Sources changed during browser measurement")
        report = {"reportVersion": 1, "sourceHashes": before, "sourceUnchangedDuringBenchmark": True,
                  "browserBundleHash": digest(ROOT / "dist/sdk/state-space.js"), "nativeReportHash": digest(args.native_report),
                  "browserCliHash": digest(args.browser_cli), "commands": commands, **result}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    finally:
        try:
            cli("close")
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
