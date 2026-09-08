"""Content-addressed evidence; scores never stand alone as admission authority."""

import importlib.metadata
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

import wgpu

from engine.catalog import unique_object
from eval.policy import POLICY_VERSION, canonical, digest


ROOT = Path(__file__).resolve().parent.parent


def read_json(path: Path):
    def reject(value):
        raise ValueError(f"Non-finite JSON value: {value}")
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object, parse_constant=reject)


def device_identity(adapter=None) -> dict:
    adapter = adapter if adapter is not None else wgpu.gpu.request_adapter_sync(power_preference="high-performance")
    if adapter is None:
        raise RuntimeError("Evaluation requires a native GPU adapter")
    return {"info": dict(adapter.info), "features": sorted(adapter.features), "limits": dict(adapter.limits)}


def context_sources() -> dict[str, str]:
    paths = []
    for directory in ("engine", "eval"):
        paths.extend(path for path in (ROOT / directory).rglob("*")
                     if path.suffix in (".py", ".ts", ".mjs", ".wgsl", ".json")
                     and not any(part in ("__pycache__", "node_modules") for part in path.parts))
    paths.extend((ROOT / "locked").glob("*.wgsl"))
    paths.extend(ROOT / name for name in ("evolve_ss.py", "package.json", "package-lock.json", "pyproject.toml", "uv.lock"))
    return {str(path.relative_to(ROOT)).replace("\\", "/"): path.read_text(encoding="utf-8") for path in sorted(paths)}


def capture_context() -> dict:
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("Node.js and checkout npm dependencies are required for independent CPU evaluation")
    node_version = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=10, check=True).stdout.strip()
    compiler_version = subprocess.run([node, "-p", "require('typescript').version"], cwd=ROOT,
                                      capture_output=True, text=True, timeout=10, check=True).stdout.strip()
    compiler_hash = digest((ROOT / "node_modules/typescript/lib/typescript.js").read_bytes())
    host = {"node": platform.node(), "processor": platform.processor(), "logicalCpus": os.cpu_count()}
    return {"policy": POLICY_VERSION, "sourceHashes": {name: digest(source) for name, source in context_sources().items()},
            "device": device_identity(), "runtime": {"python": sys.version, "platform": platform.platform(), "node": node_version,
              "typescript": compiler_version, "typescriptHash": compiler_hash,
              "hostHash": digest(canonical(host)), "processor": host["processor"], "logicalCpus": host["logicalCpus"],
              **{name: importlib.metadata.version(name) for name in ("numpy", "wgpu")}}}


def write_immutable(directory: Path, value, suffix: str = ".json") -> str:
    data = canonical(value) if suffix == ".json" else value.encode("utf-8")
    key = digest(data)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (key + suffix)
    try:
        with path.open("xb") as output:
            output.write(data)
    except FileExistsError:
        if path.read_bytes() != data:
            raise ValueError(f"Content-addressed evidence was modified: {path}")
    return key


def read_immutable(directory: Path, key: str, suffix: str = ".json"):
    if type(key) is not str or len(key) != 64 or any(c not in "0123456789abcdef" for c in key):
        raise ValueError("Malformed evidence identity")
    data = (directory / (key + suffix)).read_bytes()
    if digest(data) != key:
        raise ValueError("Evidence content hash does not match its identity")
    return read_json(directory / (key + suffix)) if suffix == ".json" else data.decode("utf-8")
