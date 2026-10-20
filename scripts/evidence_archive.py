"""Content-verified historical evidence archives. No Git history rewriting.

Build and verify before publication; prune only after separately verifying the
published asset. Restore refuses traversal, symlinks and conflicting local files.
"""

import argparse
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "docs/checkpoints/ARCHIVE.json"


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def entries(manifest):
    values = {}
    for row in manifest["files"]:
        path = PurePosixPath(row["path"])
        if (
            path.is_absolute()
            or ".." in path.parts
            or path.parts[:2] != ("docs", "checkpoints")
            or str(path) in values
            or type(row["bytes"]) is not int
            or not 0 <= row["bytes"] <= 128 * 1024**2
            or len(row["sha256"]) != 64
            or any(c not in "0123456789abcdef" for c in row["sha256"])
        ):
            raise ValueError("Invalid evidence manifest entry")
        values[str(path)] = row
    return values


def verify_archive(archive, manifest, *, restore_root=None):
    expected = entries(manifest)
    if digest(archive) != manifest["archive"]["sha256"]:
        raise ValueError("Archive SHA-256 differs from manifest")
    found = set()
    with tarfile.open(archive, "r|gz") as bundle:
        for member in bundle:
            row = expected.get(member.name)
            if (
                row is None
                or member.name in found
                or not member.isfile()
                or member.size != row["bytes"]
            ):
                raise ValueError("Unexpected, duplicate or non-file archive member")
            stream = bundle.extractfile(member)
            data = stream.read(row["bytes"] + 1)
            if (
                len(data) != row["bytes"]
                or hashlib.sha256(data).hexdigest() != row["sha256"]
            ):
                raise ValueError("Evidence member hash differs: " + member.name)
            found.add(member.name)
            if restore_root is not None:
                root = Path(restore_root).resolve()
                target = root / member.name
                if not target.resolve().is_relative_to(root / "docs/checkpoints"):
                    raise ValueError("Unsafe restoration target")
                if target.exists():
                    if target.is_symlink() or digest(target) != row["sha256"]:
                        raise ValueError(
                            "Refusing to replace conflicting evidence: " + member.name
                        )
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with target.open("xb") as output:
                        output.write(data)
    if found != set(expected):
        raise ValueError("Archive lacks manifest entries")
    return {
        "files": len(found),
        "bytes": sum(row["bytes"] for row in expected.values()),
        "verified": True,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["build", "verify", "restore", "prune"])
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--paths", type=Path)
    parser.add_argument("--release", default="historical-evidence-2026-10-18")
    args = parser.parse_args()
    if args.action == "build":
        paths = sorted(json.loads(args.paths.read_text()))
        manifest = {
            "version": 1,
            "sourceCommit": subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
            ).strip(),
            "archive": {
                "name": args.archive.name,
                "url": f"https://github.com/nxrobins/state-space/releases/download/{args.release}/{args.archive.name}",
            },
            "files": [
                {
                    "path": path,
                    "bytes": (ROOT / path).stat().st_size,
                    "sha256": digest(ROOT / path),
                }
                for path in paths
            ],
        }
        entries(manifest)
        args.archive.parent.mkdir(parents=True, exist_ok=True)
        with (
            args.archive.open("xb") as raw,
            gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed,
            tarfile.open(fileobj=compressed, mode="w|") as bundle,
        ):
            for row in manifest["files"]:
                item = tarfile.TarInfo(row["path"])
                item.size = row["bytes"]
                item.mode = 0o644
                with (ROOT / row["path"]).open("rb") as stream:
                    bundle.addfile(item, stream)
        manifest["archive"].update(
            {"sha256": digest(args.archive), "bytes": args.archive.stat().st_size}
        )
        args.manifest.write_text(json.dumps(manifest, indent=2) + "\n")
    else:
        manifest = json.loads(args.manifest.read_text())
    result = verify_archive(
        args.archive, manifest, restore_root=ROOT if args.action == "restore" else None
    )
    if args.action == "prune":
        # Publication/download verification is a separate operator step. This
        # action still refuses to delete any bytes that changed since archiving.
        for row in manifest["files"]:
            target = ROOT / row["path"]
            if (
                not target.resolve().is_relative_to(ROOT / "docs/checkpoints")
                or not target.is_file()
                or target.is_symlink()
                or digest(target) != row["sha256"]
            ):
                raise ValueError("Evidence changed before pruning: " + row["path"])
        for row in manifest["files"]:
            (ROOT / row["path"]).unlink()
        ignore = ROOT / "docs/checkpoints/.gitignore"
        previous = (
            ignore.read_text()
            if ignore.exists()
            else (
                "# Archived payloads restore locally; keep new runtime evidence under dist/.\n"
            )
        )
        patterns = {
            "/" + row["path"][len("docs/checkpoints/") :] for row in manifest["files"]
        }
        additions = sorted(patterns - set(previous.splitlines()))
        ignore.write_text(
            previous.rstrip("\n") + "\n" + "".join(p + "\n" for p in additions)
        )
    print(json.dumps(result))


if __name__ == "__main__":
    main()
