"""Exercise archive restoration and corruption/path refusal using tiny payloads."""

import gzip
import hashlib
import io
import tarfile
import tempfile
from pathlib import Path
import unittest
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
            root = Path(temp)
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
            root = Path(temp)
            archive, manifest = self.fixture(root)
            archive.write_bytes(archive.read_bytes() + b"x")
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                verify_archive(archive, manifest)
            archive, manifest = self.fixture(root, "../escape.json")
            with self.assertRaisesRegex(ValueError, "manifest"):
                verify_archive(archive, manifest, restore_root=root)
            self.assertFalse((root.parent / "escape.json").exists())
