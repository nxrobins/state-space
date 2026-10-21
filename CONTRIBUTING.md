# Contributing to State Space

Start with the [architecture map](docs/ARCHITECTURE.md) for file placement and the
[current support matrix](docs/VALIDATION_STATUS.md) for validation boundaries.
The [SDK guide](docs/SDK.md) is for application consumers; this page is for changes
to the repository itself.

## Set up and check a change

Install Node.js (CI uses 22), Python 3.10+ and uv. From the repository root:

```sh
uv sync --locked
npm ci
npm run build:sdk
npm run typecheck
npm run lint
npm run format:check
npm test
```

Build the SDK before type checking or building examples: their imports resolve
through the public package declarations. Do not run SDK rebuilding concurrently
with those consumers. `npm test` rebuilds the SDK and runs the supervised CPU
suite; it does not start native workloads or the quarantined legacy demos.

For a focused check, use the file's current path and the bounded CPU config:

```sh
uv run python -m scripts.verification_guard --kind cpu --timeout 30 -- \
  node node_modules/vitest/vitest.mjs run engine/portable-data.test.ts \
  --config engine/vitest.bounded.config.ts
```

Run `npm run verify:packages` when changing public types, exports, build metadata,
or module placement. It installs both packages in independent projects and checks
all public npm entries. Rebuild affected examples with `npm run build:reactive-chamber`
or `npm run build:tactical-slab`. [CI](.github/workflows/verify.yml) also checks the
supervisor, archive restoration and configured Python lint rules.

Python tests that need a native adapter skip on hosts without one. Set
`STATE_SPACE_REQUIRE_GPU=1` on a GPU host so a missing adapter fails instead;
`python -m engine.verify` sets it. Native checks use the explicit bounded stages
in the [macOS guide](docs/MACOS.md).
A passing CPU mock suite does not authorize a held runtime fixture. Keep native
fixtures and `.runtime-cases.ts` outside the normal CPU selection.

## Place and review changes

- Keep tests beside the implementation they exercise. Shared test-only fixtures
  belong in `engine/test-support/`; domain assertions stay in their suites.
- Application examples import public package entries. Keep `package.json` exports
  stable during internal moves; build separate entries so private identities remain
  consistent with existing clients.
- Update the relevant API guide when behavior or compatibility changes. Update
  current status only when evidence supports the exact scope of the claim.
- Review changes adversarially: exercise ownership, invalid input, cancellation,
  continuation and failure paths relevant to the change. Assert observable behavior
  rather than implementation strings. Choose checks that address the actual risk.
- Record historical measurements with source hashes and limits. New raw output goes
  under ignored `dist/verification/`; use the [archive workflow](docs/ARCHIVES.md)
  for retained bulk evidence. Preserve failed evidence and existing manifests.

Keep pull requests focused and state the behavior, validation and remaining limits.
Repository organization changes should preserve import paths exposed to consumers,
selected test cases, runtime boundaries and historical evidence provenance.
