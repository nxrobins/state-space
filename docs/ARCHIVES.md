# Historical evidence archives

Large, unlinked historical payloads are preserved in the
[2026-10-18 evidence release](https://github.com/nxrobins/state-space/releases/tag/historical-evidence-2026-10-18).
This is an evidence archive, not an engine release or a new qualification claim.
It preserves failed and interrupted runs as well as passing results.

[The manifest](checkpoints/ARCHIVE.json) lists each original path, byte count and
SHA-256, together with the compressed archive hash and source commit. It covers
1,926 files and 1,395,235,216 uncompressed bytes. Reports and images directly linked
from Markdown remain in Git. Git history has not been rewritten.

Download and verify before restoring historical evidence:

```sh
gh release download historical-evidence-2026-10-18 \
  --repo nxrobins/state-space --pattern checkpoint-evidence.tar.gz \
  --dir dist/evidence-download
uv run python -m scripts.evidence_archive verify \
  --archive dist/evidence-download/checkpoint-evidence.tar.gz
uv run python -m scripts.evidence_archive restore \
  --archive dist/evidence-download/checkpoint-evidence.tar.gz
```

Restoration verifies the archive and every member, rejects path traversal and
symlinks, and refuses to overwrite conflicting local files. Restored payloads are
ignored by Git. The archive is downloaded and fully verified before payloads are
removed from the source tree. Keep the manifest with any offline archive copy.

Historical audit/replay tools that refer to these files require restoration first,
including the older M3/M4 reference comparisons and M5 checkpoint audits. New
verification writes under ignored `dist/verification/`; publish compact summaries
and manifests with release assets rather than committing raw runtime payloads.

Removing files from the current tree reduces checkout size. Existing full Git
clones retain historical blobs; use a shallow clone when history is unnecessary.
