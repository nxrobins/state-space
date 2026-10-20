"""One bounded owned-browser Metal qualification stage, with retained evidence."""

import argparse
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import shutil
from pathlib import Path
import threading
import time
import uuid
from urllib.parse import urlencode

from scripts.verification_guard import ROOT, guarded_entry
from scripts.verification_browser import PersistentBrowser
from scripts.verification_macos import STAGES, require_preceding_stage


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=STAGES, required=True)
    args = parser.parse_args()
    guarded_entry(
        "macos-qualification", 300, module="scripts.verify_macos_qualification"
    )
    if os.environ.get("STATE_SPACE_VERIFICATION_KIND") != "macos-qualification":
        raise RuntimeError("Fixed Mac supervisor profile required.")
    out = (
        ROOT
        / "dist/verification"
        / ("macos-" + args.stage + "-" + uuid.uuid4().hex[:12])
    )
    out.mkdir(parents=True)
    paths = [
        *(ROOT / "engine").rglob("*.ts"),
        ROOT / "engine/sdk-build.mjs",
        ROOT / "engine/sdk-entries.json",
        ROOT / "scripts/build_sdk.mjs",
        *ROOT.glob("dist/sdk/*"),
        *ROOT.glob("dist/volume-m5/*.js"),
        *ROOT.glob("examples/sdk/*"),
        *ROOT.glob("examples/structural-cavern/*"),
        *ROOT.glob("examples/reactive-chamber/*"),
        *ROOT.glob("examples/shared/*"),
        *ROOT.glob("dist/reactive-chamber/*"),
        ROOT / "scripts/build_reactive_chamber.mjs",
        ROOT / "web/frame-pump.js", ROOT / "web/frame-clock.js",
        *ROOT.glob("scripts/verification*"),
        ROOT / "package.json",
        ROOT / "package-lock.json",
        ROOT / "uv.lock",
        Path(__file__),
    ]

    def hashes():
        return {
            str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in paths
            if p.is_file()
        }

    before = hashes()
    report = {
        "passed": False,
        "releaseAccepted": False,
        "stage": args.stage,
        "sourceHashes": before,
        "gpuTelemetryAvailable": False,
        "supervisorJob": os.environ["STATE_SPACE_VERIFICATION_JOB"],
    }
    browser = server = None
    try:
        report["prerequisite"] = require_preceding_stage(
            ROOT / "dist/verification", args.stage, before
        )
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(ROOT))
        )
        threading.Thread(target=server.serve_forever, daemon=True).start()
        if args.stage.endswith("visible"):
            os.environ["STATE_SPACE_BROWSER_HEADED"] = "1"
        browser = PersistentBrowser(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", out
        )
        report["browser"] = browser.metadata
        is_gameplay = args.stage.startswith("gameplay-")
        is_scale = args.stage == "scale-128-visible"
        if args.stage == "chamber-visible":
            page = "dist/reactive-chamber/"
        elif args.stage == "client" or is_gameplay or is_scale:
            query = {"lighting": "cached" if "cached" in args.stage else "reference"}
            if is_gameplay or is_scale:
                size = "128" if "-128-" in args.stage else "64" if "-64-" in args.stage else "32"
                query.update({"scene": "cut", "size": size})
            if "profile" in args.stage:
                query["profile"] = "gpu"
            page = "examples/structural-cavern/?" + urlencode(query)
        else:
            page = "examples/sdk/macos-qualification.html"
        browser.call("open", url=f"http://127.0.0.1:{server.server_port}/" + page)
        if args.stage == "client" or is_gameplay or is_scale:
            client_module = (
                "playable-scale.js" if is_scale else "playable-benchmark.js" if is_gameplay else "playable-check.js"
            )
            client_function = (
                "probePlayableScale" if is_scale else "benchmarkPlayableClient" if is_gameplay else "verifyPlayableClient"
            )
            prepare = """void (async()=>{
              try {
                await window.structuralCavern.ready;
                await window.structuralCavern.stop();
                const output=document.createElement('pre');output.id='report';document.body.append(output);
                window.macQualification={ready:true,run(){
                  void import(MODULE).then(m=>m[FUNCTION]());return true;
                }};
              } catch(error) {console.error(error);}
            })()"""
            browser.call(
                "eval",
                expression=prepare.replace(
                    "MODULE", json.dumps("/examples/sdk/" + client_module)
                ).replace("FUNCTION", json.dumps(client_function)),
            )
        deadline = time.monotonic() + 260
        while not browser.call(
            "eval", expression="window.macQualification?.ready === true"
        ):
            if time.monotonic() > deadline:
                raise RuntimeError("Page startup deadline")
            time.sleep(0.1)
        browser.call(
            "eval",
            expression="window.macQualification.run(" + json.dumps(args.stage) + ")",
        )
        previous = None
        captured_chamber = False
        while time.monotonic() < deadline:
            state = browser.call(
                "eval",
                expression="JSON.parse(document.getElementById('report').textContent || '{}')",
            )
            if state:
                report["result"] = state
                (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
                if state.get("progress") != previous:
                    previous = state.get("progress")
                    print(previous, flush=True)
            if args.stage == "chamber-visible" and state.get("captureReady") and not captured_chamber:
                browser.call("screenshot")
                shutil.copyfile(out / "view.png", out / "chamber-view.png")
                report["viewSha256"] = hashlib.sha256((out / "chamber-view.png").read_bytes()).hexdigest()
                browser.call("eval", expression="window.chamberCaptureAck = true")
                captured_chamber = True
            if state.get("done"):
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("Mac browser stage deadline; partial report retained")
        browser.call("screenshot")
        report["consoleErrors"] = browser.call("errors")
        if not state.get("passed") or report["consoleErrors"]:
            raise RuntimeError(state.get("error") or "Browser console error")
        report["sourceUnchanged"] = hashes() == before
        if not report["sourceUnchanged"]:
            raise RuntimeError("Source changed during qualification")
        report["passed"] = True
    except Exception as error:
        report["error"] = str(error)
    finally:
        if browser:
            browser.close()
            if browser.fault:
                report["passed"] = False
                report["cleanupError"] = browser.fault
        if server:
            server.shutdown()
            server.server_close()
        (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        print("Mac qualification report: " + str(out / "report.json"), flush=True)
        if report.get("error"):
            print(report["error"], flush=True)
    return int(not report["passed"])


if __name__ == "__main__":
    raise SystemExit(main())
