# Historical evidence archives

Large, unlinked historical payloads are preserved in the releases below.
This is an evidence archive, not an engine release or a new qualification claim.
It preserves failed and interrupted runs as well as passing results.

Each manifest lists original paths, byte counts and SHA-256 hashes, together with
its compressed archive hash and source commit. The batches contain different
files; restore each batch needed by a historical audit.

| Release | Manifest | Files | Uncompressed bytes |
| --- | --- | ---: | ---: |
| [2026-10-18](https://github.com/nxrobins/state-space/releases/tag/historical-evidence-2026-10-18) | [Original archive](checkpoints/ARCHIVE.json) | 1,926 | 1,395,235,216 |
| [2026-10-20](https://github.com/nxrobins/state-space/releases/tag/historical-evidence-2026-10-20) | [Organization archive](checkpoints/ARCHIVE_2026-10-20.json) | 6,295 | 63,995,956 |

Reports, summaries and files directly linked from Markdown remain in Git. The
second archive retains all named `summary.json` and `report.json` files in the
checkout as well. Historical documents keep their original paths and measurements;
follow their manifest when an audit needs a raw payload. Git history is unchanged.

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

For the second archive, choose its manifest explicitly:

```sh
gh release download historical-evidence-2026-10-20 \
  --repo nxrobins/state-space --pattern state-space-checkpoint-evidence-2026-10-20.tar.gz \
  --dir dist/evidence-download
uv run python -m scripts.evidence_archive verify \
  --manifest docs/checkpoints/ARCHIVE_2026-10-20.json \
  --archive dist/evidence-download/state-space-checkpoint-evidence-2026-10-20.tar.gz
uv run python -m scripts.evidence_archive restore \
  --manifest docs/checkpoints/ARCHIVE_2026-10-20.json \
  --archive dist/evidence-download/state-space-checkpoint-evidence-2026-10-20.tar.gz
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

To retain another batch, pass a new `--manifest`, `--archive` and `--release` to
`build`, with `--paths` naming a JSON array of tracked checkpoint paths. Publish
both archive and manifest, download a fresh copy, and run `verify` on that copy
before `prune`. Pruning refuses changed local evidence and preserves earlier
ignore rules. Never replace an existing release asset or provenance manifest.
