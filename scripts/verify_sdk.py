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
    from scripts.verification_guard import guarded_entry
    guarded_entry('gpu', 600)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, default=ROOT / "docs/checkpoints/latest-sdk-verification.json")
    args = parser.parse_args()
    report = {"checks": []}
    def run(command, cwd=ROOT):
        print("Installed SDK check: " + " ".join(str(x) for x in command[:4]), flush=True)
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
            from engine.sources import KERNEL_FILES
            if set(report["wheelKernels"]) != {f"engine/kernels/{name}" for name in KERNEL_FILES}:
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
            render_client = (
                "import sys,contextlib,json; "
                f"sys.path.insert(0, {str(site)!r}); "
                "from engine import MaterialRenderer,create_field\n"
                "with contextlib.redirect_stdout(sys.stderr):\n"
                " with create_field(4,4) as field, MaterialRenderer(4,4,output_size=(64,64)) as renderer:\n"
                "  field.set_cell(2,2,5,20); field.set_energy(2,2,700*256)\n"
                "  before=field.snapshot().to_dict(); renderer.render(field); pixels=renderer.read_pixels()\n"
                "  if before!=field.snapshot().to_dict() or len(pixels)!=64*64*4: raise RuntimeError('Installed renderer failed')\n"
                " with create_field(16,16) as field, MaterialRenderer(16,16,output_size=(64,64)) as renderer:\n"
                "  for y in range(8,16):\n"
                "   for x in range(16): field.set_cell(x,y,2,20)\n"
                "  field.set_cell(8,5,4,255); field.set_energy(8,5,650*256)\n"
                "  before=field.snapshot().to_dict(); renderer.render(field,lighting=False,bloom=False,water=False); dry=renderer.read_pixels()\n"
                "  renderer.render(field,lighting=False,bloom=False,refraction=False); wet=renderer.read_pixels()\n"
                "  if dry==wet or before!=field.snapshot().to_dict(): raise RuntimeError('Installed water optics failed')\n"
                "  pixel=(42*64+34)*4\n"
                "  if wet[pixel]<=dry[pixel]+30: raise RuntimeError('Installed fire reflection missing')\n"
                " for gas,thermal in ((14,40),(9,180)):\n"
                "  with create_field(32,32) as field, MaterialRenderer(32,32,output_size=(128,128)) as renderer:\n"
                "   for y in range(12,28):\n"
                "    for x in range(14,24): field.set_cell(x,y,gas,thermal)\n"
                "   for y in range(18,23): field.set_cell(6,y,4,255); field.set_energy(6,y,650*256)\n"
                "   before=field.snapshot().to_dict(); renderer.render(field,lighting=False,bloom=False,water=False); unlit=renderer.read_pixels()\n"
                "   renderer.render(field,bloom=False,water=False); lit=renderer.read_pixels(); pixel=(82*128+74)*4\n"
                "   if lit[pixel]<=unlit[pixel]+20 or before!=field.snapshot().to_dict(): raise RuntimeError('Installed haze scattering failed')\n"
                "   renderer.render(field,haze=False)\n"
                "   if before!=field.snapshot().to_dict(): raise RuntimeError('Installed haze toggle mutated state')\n"
                " with create_field(32,32) as field, MaterialRenderer(32,32,output_size=(128,128)) as renderer:\n"
                "  for y in range(4,27):\n"
                "   for x in range(8,24):\n"
                "    if x%3: field.set_cell(x,y,14,40)\n"
                "  for y in range(27,31):\n"
                "   for x in range(10,22): field.set_cell(x,y,4,255); field.set_energy(x,y,1000*256)\n"
                "  before=field.snapshot().to_dict(); options=dict(lighting=False,bloom=False,water=False,haze=False)\n"
                "  renderer.render(field,distortion=False,**options); steady=renderer.read_pixels()\n"
                "  renderer.render(field,**options); shimmer=renderer.read_pixels()\n"
                "  if sum(abs(a-b)>2 for a,b in zip(steady[:104*128*4],shimmer[:104*128*4]))<64 or before!=field.snapshot().to_dict(): raise RuntimeError('Installed heat shimmer failed')\n"
                "print(json.dumps({'renderIsolation':True,'rgbaBytes':len(pixels),'waterOptics':True,'litSmokeAndSteam':True,'heatDistortion':True}))\n"
            )
            report["nativeRendering"] = json.loads(run([sys.executable, "-I", "-c", render_client], temp))
            world_client = temp / "world.mjs"
            world_client.write_text(
                "import assert from 'node:assert/strict';\n"
                "import {createStateSpaceWorld3D} from 'state-space-engine/experimental/3d/world';\n"
                "import {createGpuWorld3D} from 'state-space-engine/experimental/3d/world/gpu';\n"
                "const w=createStateSpaceWorld3D({width:8,height:8,depth:8,chunkSize:4});\n"
                "w.setCell(3,3,3,2,25);w.step(3);const saved=w.snapshot();w.step(7);const end=w.snapshot();\n"
                "w.restore(saved);w.step(7);assert.deepEqual(w.snapshot(),end);assert.equal(w.energyBalance().driftQ,0n);\n"
                "await assert.rejects(()=>createGpuWorld3D({width:8,height:8,depth:8,chunkSize:4}),/WebGPU/);\n"
                "console.log(JSON.stringify({chunks:end.chunks.length,tick:w.tick,replayExact:true,nodeGpuRejected:true}));\n",
                encoding="utf-8")
            report["experimentalWorld"] = json.loads(run([shutil.which("node"), str(world_client)], temp))
            client = temp / "client.mts"
            client.write_text("import {createStateSpaceField,createGpuField,MAT,DEFAULT_REGISTRY,type PackedSnapshot} from 'state-space-engine';\n"
                              "const field=createStateSpaceField(2,1,MAT.STONE,DEFAULT_REGISTRY);\n"
                              "const snapshot: PackedSnapshot=field.packedSnapshot(); field.restore(snapshot);\n"
                              "const gpu: ReturnType<typeof createGpuField>=createGpuField(2,1); void gpu;\n"
                              "import {createStateSpaceWorld3D,type WorldSnapshot3D} from 'state-space-engine/experimental/3d/world';\n"
                              "import {createGpuWorld3D,type GpuWorld3D} from 'state-space-engine/experimental/3d/world/gpu';\n"
                              "const world=createStateSpaceWorld3D();const saved:WorldSnapshot3D=world.snapshot();world.restore(saved);\n"
                              "const pending:Promise<GpuWorld3D>=createGpuWorld3D();void pending;\n")
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
