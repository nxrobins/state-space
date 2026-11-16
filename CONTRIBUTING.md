# Contributing to State Space

Start with the [architecture map](docs/ARCHITECTURE.md) for file placement and the
[current support matrix](docs/VALIDATION_STATUS.md) for validation boundaries.
The [SDK guide](docs/SDK.md) is for application consumers; this page is for changes
to the repository itself. Coding agents start with [AGENTS.md](AGENTS.md), which
states the rules that are not visible in the code.

## Set up and check a change

Install Node.js (CI uses 22), Python 3.10+ and uv. `.python-version` selects
CPython 3.13 for `uv sync` and CI; the package itself still supports 3.10+.
From the repository root:

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

TypeScript 7 runs type checks and emits SDK declarations through its native CLI.
The pinned `@typescript/typescript6` compatibility package supplies the compiler
API for structural lint, generated browser assets, mutation tests and independent
CPU evaluation. Evaluation evidence hashes the compatibility shim and compiler.
Use the explicit native compiler path, as the package scripts do: the compatibility
dependency can shadow the bare `tsc` command with TypeScript 6.
When updating either package, also run `python -m engine.generate --check` under
the CPU supervisor and `npm run verify:packages` to check generated assets and
external declaration consumers.

The pinned `@typescript/lib-dom` alias supplies complete DOM/WebGPU declarations;
`libReplacement` selects it in the engine config. Do not reintroduce the legacy
`@webgpu/types` references, which conflict with TypeScript 6/7's browser types.
External clients should follow the [SDK browser-type setup](docs/sdk/core.md#typescript-browser-types).

`npm run format` applies Prettier to the hand-written engine, example, script
and test sources; `npm run format:check` is the CI gate. `.prettierignore`
lists what stays byte-exact: generated code, vendored files, built output,
archived evidence and the frozen material-law sources.

For a focused check, use the file's current path and the bounded CPU config:

```sh
uv run python -m scripts.verification_guard --kind cpu --timeout 30 -- \
  node node_modules/vitest/vitest.mjs run --reporter=dot engine/portable-data.test.ts \
  --config engine/vitest.bounded.config.ts
```

Pass `--reporter=dot` to a focused vitest run under the supervisor. The default
reporter prints nothing per test when stdout is a pipe, and the supervisor stops a
child that is silent for 40 seconds. The CPU suites that `npm test` selects already
use that reporter; the native macOS stages keep their own fixed commands.

A host that records an incident keeps an ignored `dist/verification/safety-hold.json`.
While its `blockRecovery` is anything but `false`, `npm test`, the supervisor, the
benchmarks and the direct verifiers refuse to start their workloads (`npm test` still
builds the SDK first); type checks, lint and formatting still run. The hold belongs to that checkout's `dist/`: another worktree on the same
host does not see it.

Run `npm run verify:packages` when changing public types, exports, build metadata,
or module placement. It installs both packages in independent projects and checks
all public npm entries. Rebuild affected examples with `npm run build:reactive-chamber`
or `npm run build:tactical-slab`. [CI](.github/workflows/verify.yml) also checks the
supervisor, archive restoration and the configured Python lint rules with
`uv run ruff check .`, then runs the whole Python suite and the engine structural
lint under the CPU supervisor:

```sh
uv run python -B -m scripts.verification_guard --kind cpu --timeout 300 --stall 120 -- \
  .venv/bin/python -B -m unittest discover -s tests -p 'test_*.py' -v
uv run python -B -m scripts.verification_guard --kind cpu --timeout 120 -- \
  .venv/bin/python -B -m engine.lint
```

A separate CI job runs `npm ci`, `npm test` and `npm run build` in `game/` and
`tower-defense-rogue/`; both prototypes import engine sources directly, so they
need the checkout but not a built SDK.

Python tests that need a native adapter skip on hosts without one. Set
`STATE_SPACE_REQUIRE_GPU=1` on a GPU host so a missing adapter fails instead;
`python -m engine.verify` sets it. Native checks use the explicit bounded stages
in the [macOS guide](docs/MACOS.md). Python test modules import shared helpers as
`tests.<module>`, so `python -m unittest tests.test_<name>` resolves them as well
as `unittest discover -s tests` does.
A passing CPU mock suite does not authorize a held runtime fixture. Keep native
fixtures and `.runtime-cases.ts` outside the normal CPU selection. A CPU-only case
that belongs with a native fixture's subject goes in the sibling `*.cpu.test.ts`
file (`engine/sdk.cpu.test.ts`, `engine/structure.cpu.test.ts`,
`engine/conformance.cpu.test.ts`), which the CPU config selects; the native file
names stay fixed because `npm run test:native -- --file` lists them.

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
