"""Build/install real packages outside the checkout and compare external clients."""

import hashlib
import argparse
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, default=ROOT / "docs/checkpoints/latest-sdk-verification.json")
    args = parser.parse_args()
    report = {"checks": []}
    def run(command, cwd=ROOT):
        result = subprocess.run(command, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
        report["checks"].append({"command": [str(arg) for arg in command], "cwd": str(cwd), "exitCode": result.returncode,
                                 "stdout": result.stdout, "stderr": result.stderr})
        if result.returncode:
            raise RuntimeError(f"Package check failed: {command}\n{result.stdout}\n{result.stderr}")
        return result.stdout

    destination = ROOT / "dist/packages"
    destination.mkdir(parents=True, exist_ok=True)
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    try:
        run([shutil.which("uv"), "build", "--wheel", "--out-dir", str(destination)])
        run([npm, "pack", "--pack-destination", str(destination), "--json"])
        package = json.loads((ROOT / "package.json").read_text())
        version = package["version"]
        wheel = destination / f"state_space-{version}-py3-none-any.whl"
        tarball = destination / f"{package['name']}-{version}.tgz"
        report["artifacts"] = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in (wheel, tarball)}
        immutable = destination / "evidence"
        immutable.mkdir(parents=True, exist_ok=True)
        report["immutableArtifacts"] = {}
        for artifact in (wheel, tarball):
            data = artifact.read_bytes()
            key = hashlib.sha256(data).hexdigest()
            preserved = immutable / (key + artifact.suffix)
            try:
                with preserved.open("xb") as output:
                    output.write(data)
            except FileExistsError:
                if preserved.read_bytes() != data:
                    raise ValueError("SDK artifact hash collision or modified evidence")
            report["immutableArtifacts"][str(preserved.relative_to(ROOT))] = key
        with zipfile.ZipFile(wheel) as archive:
            report["wheelKernels"] = [name for name in archive.namelist() if name.startswith("engine/kernels/")]
            if len(report["wheelKernels"]) != 11:
                raise RuntimeError("Wheel is missing the complete runtime kernel set")
        with tarfile.open(tarball, "r:gz") as archive:
            bundle = archive.extractfile("package/dist/sdk/state-space.js").read()
            report["browserBundleHash"] = hashlib.sha256(bundle).hexdigest()
        with tempfile.TemporaryDirectory(prefix="state-space-sdk-client-") as folder:
            temp = Path(folder)
            site = temp / "python-site"
            run([shutil.which("uv"), "pip", "install", "--no-deps", "--target", str(site), str(wheel)])
            for name in ("native.py", "node.mjs", "materials.json"):
                shutil.copyfile(ROOT / "examples/sdk" / name, temp / name)
            native_client = (
                "import sys,runpy; from pathlib import Path; "
                f"sys.path.insert(0, {str(site)!r}); runpy.run_path('native.py',run_name='__main__'); "
                f"bad=[name for name,module in sys.modules.items() if (name=='engine' or name.startswith('engine.')) and getattr(module,'__file__',None) and not Path(module.__file__).resolve().is_relative_to(Path({str(site)!r}).resolve())]; "
                "\nif bad: raise RuntimeError('Checkout imports leaked into installed client: '+repr(bad))\n"
                "if 'engine.generate' in sys.modules: raise RuntimeError('Runtime imported development generator')\n"
            )
            native = json.loads(run([sys.executable, "-I", "-c", native_client], temp))
            run([npm, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", str(temp), str(tarball)], temp)
            browser_cpu = json.loads(run([shutil.which("node"), "node.mjs"], temp))
            if browser_cpu != native:
                raise RuntimeError("Installed CPU/native clients disagree on catalog, state, pass changes, or replay")
            report["clientsMatch"] = True
            report["nativeClient"] = native
            client = temp / "client.mts"
            client.write_text("import {createStateSpaceField,createGpuField,MAT,DEFAULT_REGISTRY,type PackedSnapshot} from 'state-space-engine';\n"
                              "const field=createStateSpaceField(2,1,MAT.STONE,DEFAULT_REGISTRY);\n"
                              "const snapshot: PackedSnapshot=field.packedSnapshot(); field.restore(snapshot);\n"
                              "const gpu: ReturnType<typeof createGpuField>=createGpuField(2,1); void gpu;\n")
            for compiler in (ROOT / "node_modules/typescript/bin/tsc", ROOT / "tower-defense-rogue/node_modules/typescript/bin/tsc"):
                run([shutil.which("node"), str(compiler), "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext",
                     "--moduleResolution", "NodeNext", "--lib", "ES2022,DOM", str(client)], temp)
        report["passed"] = True
        print(f"Installed SDK clients match: {len(native['passes'])} pass deltas, exact state/replay, both TypeScript compilers.")
    except Exception as error:
        report["passed"] = False
        report["error"] = str(error)
        print(error, file=sys.stderr)
    data = json.dumps(report, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    key = hashlib.sha256(data).hexdigest()
    evidence = ROOT / "docs/checkpoints/sdk-evidence"
    evidence.mkdir(parents=True, exist_ok=True)
    try:
        with (evidence / (key + ".json")).open("xb") as output:
            output.write(data)
    except FileExistsError:
        if (evidence / (key + ".json")).read_bytes() != data:
            raise ValueError("SDK report evidence was modified")
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps({**report, "evidenceHash": key}, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return int(not report["passed"])


if __name__ == "__main__":
    raise SystemExit(main())
