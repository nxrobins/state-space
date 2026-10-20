"""Exercise archive restoration and corruption/path refusal using tiny payloads."""

import gzip
import hashlib
import io
import json
import subprocess
import sys
from unittest.mock import patch
import tarfile
import tempfile
from pathlib import Path
import unittest
from scripts import evidence_archive
from scripts.evidence_archive import verify_archive


class EvidenceArchiveTests(unittest.TestCase):
    def fixture(
        self,
        root,
        name="docs/checkpoints/history/payload.json",
        data=b'{"passed":false}',
    ):
        path = root / "payload.tar.gz"
        with (
            gzip.open(path, "wb") as compressed,
            tarfile.open(fileobj=compressed, mode="w|") as bundle,
        ):
            item = tarfile.TarInfo(name)
            item.size = len(data)
            bundle.addfile(item, io.BytesIO(data))
        return path, {
            "archive": {"sha256": hashlib.sha256(path.read_bytes()).hexdigest()},
            "files": [
                {
                    "path": name,
                    "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                }
            ],
        }

    def test_roundtrip_preserves_failed_evidence_and_conflicts_are_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            archive, manifest = self.fixture(root)
            result = verify_archive(archive, manifest, restore_root=root)
            self.assertTrue(result["verified"])
            target = root / manifest["files"][0]["path"]
            self.assertEqual(target.read_bytes(), b'{"passed":false}')
            verify_archive(archive, manifest, restore_root=root)
            target.write_bytes(b"local changes")
            with self.assertRaisesRegex(ValueError, "conflicting"):
                verify_archive(archive, manifest, restore_root=root)

    def test_corrupt_archive_and_traversal_are_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            archive, manifest = self.fixture(root)
            archive.write_bytes(archive.read_bytes() + b"x")
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                verify_archive(archive, manifest)
            archive, manifest = self.fixture(root, "../escape.json")
            with self.assertRaisesRegex(ValueError, "manifest"):
                verify_archive(archive, manifest, restore_root=root)
            self.assertFalse((root.parent / "escape.json").exists())

    def test_successive_archives_preserve_ignores_and_restore_original_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(
                [
                    "git",
                    "-c",
                    "user.name=Test",
                    "-c",
                    "user.email=test@example.invalid",
                    "commit",
                    "--allow-empty",
                    "-qm",
                    "archive fixture",
                ],
                cwd=root,
                check=True,
            )
            commit = subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=root, text=True
            ).strip()
            checkpoint = root / "docs/checkpoints"
            checkpoint.mkdir(parents=True)
            (checkpoint / ".gitignore").write_text(
                "# Preserve existing policy\n/local/\n"
            )
            for number in range(2):
                name = f"docs/checkpoints/history-{number}.json"
                payload = json.dumps({"passed": False, "run": number}).encode()
                (root / name).write_bytes(payload)
                paths = root / "paths.json"
                paths.write_text(json.dumps([name]))
                archive, manifest = (
                    root / f"evidence-{number}.tar.gz",
                    root / f"manifest-{number}.json",
                )

                def run(action):
                    with (
                        patch.object(evidence_archive, "ROOT", root),
                        patch.object(
                            sys,
                            "argv",
                            [
                                "evidence_archive",
                                action,
                                "--archive",
                                str(archive),
                                "--manifest",
                                str(manifest),
                                "--paths",
                                str(paths),
                                "--release",
                                "fixture-release",
                            ],
                        ),
                    ):
                        evidence_archive.main()

                run("build")
                data = json.loads(manifest.read_text())
                self.assertEqual(data["sourceCommit"], commit)
                self.assertTrue(
                    data["archive"]["url"].endswith(
                        f"/fixture-release/evidence-{number}.tar.gz"
                    )
                )
                run("prune")
                self.assertFalse((root / name).exists())
                run("restore")
                self.assertEqual((root / name).read_bytes(), payload)
            ignored = subprocess.check_output(
                [
                    "git",
                    "check-ignore",
                    "docs/checkpoints/local/scratch.json",
                    "docs/checkpoints/history-0.json",
                    "docs/checkpoints/history-1.json",
                ],
                cwd=root,
                text=True,
            ).splitlines()
            self.assertEqual(len(ignored), 3)
