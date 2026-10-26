"""Build and install local packages outside the checkout; CPU by default.

--native additionally executes the tiny installed Python Metal client, under
its own fixed Mac profile. No registry publication or large rendering workloads.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import uuid
import zipfile

from scripts.verification_guard import ROOT, guarded_entry


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native", action="store_true")
    args = parser.parse_args()
    guarded_entry(
        "macos-qualification" if args.native else "cpu",
        300,
        module="scripts.verify_packages",
    )
    if args.native:
        os.environ["WGPU_BACKEND_TYPE"] = "Metal"
    out = ROOT / "dist/verification" / ("packages-" + uuid.uuid4().hex[:12])
    out.mkdir(parents=True)
    destination = ROOT / "dist/packages"
    destination.mkdir(parents=True, exist_ok=True)
    report = {
        "passed": False,
        "releaseAccepted": False,
        "native": args.native,
        "checks": [],
    }
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")

    def run(command, cwd=ROOT):
        index = len(report["checks"])
        print("Package check: " + " ".join(map(str, command[:5])), flush=True)
        row = {"command": list(map(str, command)), "cwd": str(cwd)}
        report["checks"].append(row)
        with (
            (out / f"{index}.stdout.log").open("wb") as stdout,
            (out / f"{index}.stderr.log").open("wb") as stderr,
        ):
            result = subprocess.run(
                command, cwd=cwd, stdout=stdout, stderr=stderr, timeout=90
            )
        row["exitCode"] = result.returncode
        if result.returncode:
            raise RuntimeError(f"Package check {index} failed; see retained logs.")
        return (out / f"{index}.stdout.log").read_text()

    try:
        run([shutil.which("uv"), "build", "--wheel", "--out-dir", str(destination)])
        packed = json.loads(
            run(
                [
                    npm,
                    "pack",
                    "--ignore-scripts",
                    "--pack-destination",
                    str(destination),
                    "--json",
                ]
            )
        )
        package = json.loads((ROOT / "package.json").read_text())
        wheel = destination / f"state_space-{package['version']}-py3-none-any.whl"
        tarball = destination / packed[0]["filename"]
        report["artifacts"] = {
            p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (wheel, tarball)
        }
        with zipfile.ZipFile(wheel) as archive:
            from engine.sources import KERNEL_FILES

            if {n for n in archive.namelist() if n.startswith("engine/kernels/")} != {
                f"engine/kernels/{n}" for n in KERNEL_FILES
            }:
                raise RuntimeError("Installed wheel lacks complete runtime kernels.")
        with tempfile.TemporaryDirectory(prefix="state-space-installed-") as folder:
            temp = Path(folder)
            environment = temp / "venv"
            run(
                [
                    shutil.which("uv"),
                    "venv",
                    "--python",
                    sys.executable,
                    str(environment),
                ],
                temp,
            )
            python = environment / (
                "Scripts/python.exe" if os.name == "nt" else "bin/python"
            )
            run(
                [
                    shutil.which("uv"),
                    "pip",
                    "install",
                    "--python",
                    str(python),
                    str(wheel),
                ],
                temp,
            )
            for name in [
                "native.py",
                "node.mjs",
                "materials.json",
                "package-client.mjs",
            ]:
                shutil.copyfile(ROOT / "examples/sdk" / name, temp / name)
            run(
                [
                    npm,
                    "install",
                    "--ignore-scripts",
                    "--no-audit",
                    "--no-fund",
                    "--prefix",
                    str(temp),
                    str(tarball),
                ],
                temp,
            )
            cpu = json.loads(run([shutil.which("node"), "node.mjs"], temp))
            if not cpu["replayEqual"] or any(p["deltaQ"] != "0" for p in cpu["passes"]):
                raise RuntimeError("Installed JavaScript conservation/restart failed.")
            (out / "installed-package-lock.json").write_text(
                (temp / "package-lock.json").read_text()
            )
            run([shutil.which("uv"), "pip", "freeze", "--python", str(python)], temp)
            report["cpu"] = {"passes": len(cpu["passes"]), "restartExact": True}
            report["experimental"] = json.loads(
                run([shutil.which("node"), "package-client.mjs"], temp)
            )
            source = (
                "import sys; from pathlib import Path; import engine; from engine import DEFAULT_REGISTRY; assert not Path(engine.__file__).resolve().is_relative_to(Path("
                + repr(str(ROOT))
                + ")), engine.__file__; assert 'engine.generate' not in sys.modules; print(DEFAULT_REGISTRY.hash)"
            )
            report["pythonImport"] = run(
                [str(python), "-I", "-c", source], temp
            ).strip()
            if args.native:
                source += (
                    "; import runpy; runpy.run_path('native.py',run_name='__main__')"
                )
                native = json.loads(
                    run([str(python), "-I", "-c", source], temp).splitlines()[-1]
                )
                if native != cpu:
                    raise RuntimeError(
                        "Installed native Metal and JavaScript clients differ."
                    )
                report["nativeMatchesCpu"] = True
            # Exercise declarations with both the native and compatibility compilers.
            compilers = [
                ROOT / "node_modules/typescript/bin/tsc",
                ROOT / "node_modules/@typescript/typescript6/bin/tsc6",
            ]
            report["typeCompilers"] = [
                run([shutil.which("node"), str(compiler), "--version"], temp).strip()
                for compiler in compilers
            ]
            for i, path in enumerate(package["exports"]):
                client = temp / f"client{i}.mts"
                specifier = "state-space-engine" + ("" if path == "." else path[1:])
                client.write_text(f"import * as entry from '{specifier}'; void entry;")
                if path == ".":
                    with client.open("a") as source:
                        source.write(
                            "\nconst context: GPUCanvasContext | null = "
                            "document.createElement('canvas').getContext('webgpu');\n"
                            "declare const device: GPUDevice;\n"
                            "const buffer = device.createBuffer({size: 16, usage: GPUBufferUsage.STORAGE});\n"
                            "device.queue.writeBuffer(buffer, 0, new Uint32Array(new SharedArrayBuffer(16)));\n"
                            "void entry.createGpuField(2, 2); void context;\n"
                        )
                if path in {
                    "./experimental/3d/gpu",
                    "./experimental/3d/world/gpu",
                    "./experimental/3d/active-world/gpu",
                    "./experimental/3d/structural-world/gpu",
                }:
                    with client.open("a") as source:
                        source.write(
                            "\nconst style: entry.TerrainStyleOptions = {profile: 'geological', "
                            "tone: {exposureEV: -0.5}, materials: {rockTint: [0.3, 0.4, 0.5]}};\n"
                            "declare const renderer: entry.TerrainRenderer;\n"
                            "void renderer.setStyle?.(style);\n"
                            "const settings: Promise<entry.TerrainStyleSettings> | undefined = "
                            "renderer.inspectStyle?.(); void settings;\n"
                        )
                for compiler in compilers:
                    run(
                        [
                            shutil.which("node"),
                            str(compiler),
                            "--noEmit",
                            "--strict",
                            "--target",
                            "ES2022",
                            "--module",
                            "NodeNext",
                            "--moduleResolution",
                            "NodeNext",
                            "--lib",
                            "ES2022,DOM",
                            "--libReplacement",
                            "true",
                            str(client),
                        ],
                        temp,
                    )
            report["externalTypes"] = True
        report["passed"] = True
    except Exception as error:
        report["error"] = str(error)
    finally:
        (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        print("Package report: " + str(out / "report.json"), flush=True)
        if not report["passed"]:
            print(report["error"], file=sys.stderr)
    return int(not report["passed"])


if __name__ == "__main__":
    raise SystemExit(main())
