# Frozen collision test inputs

`collision-history.json.gz` is a read-only copy of the bytes needed by the historical
collision source proofs. It makes those checks runnable from a clean checkout;
it does not create a new benchmark result or qualify the current engine.

Archive SHA-256:
`625a4c744a8721da4260a852891fbbfe01d7b35087858820a051bf003cc13cd6`.

The gzip payload is JSON (`collision-test-history-v1`) containing 40 files encoded
as base64, with each original path, SHA-256, and Git revision where applicable in
`origins`. Decompression is bounded and the archive digest is checked before use.

- The original owned, normal-cache, and offset-cache packet bytes still match
  `benchmark.sha256` in their unchanged `docs/checkpoints/COLLISION_*.json` records.
- The common engine graph and selected harness sources come from Git revision
  `2397a7f08d9e100e65604cabaecff576b3f817ca`, the first commit retaining this work.
  Every included source was matched against the original packet hash before
  archiving. This revision is an archival source, not the measured checkout ID.
- The owned and normal-cache rigid variants are the original workstation
  `rigid.ts.before` files, matched to their corresponding packet hashes. The
  original pre-ownership snapshot and its packet are retained too.
- The normal-cache engine bundle and coverage bytes retain their original hashes.
  Tests parse these as data; they never execute the historical engine bundle.

The original measured checkout ID was `0af27b6c928cc3c5fbda7f66536d8b2ccb0c0cdb`,
with uncommitted changes. A checkout of that commit alone cannot reproduce the
measured source. The packet hashes, not an assumption about that commit, identify
the measured inputs.

Historical tests read this archive instead of `dist/verification` or the current
working tree. Current kernel checks continue reading the shipped `rigid.ts` and
compare its cache behavior and wiring separately. Updating the current engine
must not update these original hashes or recast old timing as a new measurement.
The original workstation packets, failed receipts, and checkpoint records were
not modified when adding this fixture.
