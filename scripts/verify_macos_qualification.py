"""One bounded owned-browser Metal qualification stage, with retained evidence."""

import argparse
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
import time
import uuid
from urllib.parse import urlencode

from scripts.verification_guard import ROOT, guarded_entry
from scripts.verification_browser import PersistentBrowser
from scripts.verification_macos import STAGES


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
        *ROOT.glob("engine/experimental/*.ts"),
        *ROOT.glob("dist/sdk/*"),
        *ROOT.glob("examples/sdk/*"),
        *ROOT.glob("examples/structural-cavern/*"),
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
        if args.stage == "client" or is_gameplay:
            query = {"lighting": "cached" if "cached" in args.stage else "reference"}
            if is_gameplay:
                query.update(
                    {"scene": "cut", "size": "64" if "-64-" in args.stage else "32"}
                )
            if "profile" in args.stage:
                query["profile"] = "gpu"
            page = "examples/structural-cavern/?" + urlencode(query)
        else:
            page = "examples/sdk/macos-qualification.html"
        browser.call("open", url=f"http://127.0.0.1:{server.server_port}/" + page)
        if args.stage == "client" or is_gameplay:
            client_module = (
                "playable-benchmark.js" if is_gameplay else "playable-check.js"
            )
            client_function = (
                "benchmarkPlayableClient" if is_gameplay else "verifyPlayableClient"
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
