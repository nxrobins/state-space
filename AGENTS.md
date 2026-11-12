# Instructions for coding agents

Read this before changing anything. It collects the rules an agent cannot infer
from the code. [CONTRIBUTING.md](CONTRIBUTING.md) has the full contributor
workflow, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) says where things live, and
[docs/VALIDATION_STATUS.md](docs/VALIDATION_STATUS.md) says what has been measured.

## 1. Check for an incident hold before running anything

A host that has recorded an incident keeps a git-ignored hold file at
`dist/verification/safety-hold.json`. Look for it first.

If it exists and its `blockRecovery` is anything but `false`:

- Do not run tests, benchmarks, verifiers, browsers, workers or GPU work on that
  host. Running vitest, `unittest` or a script directly to get around the
  supervisor counts.
- Do not set `STATE_SPACE_VERIFICATION_JOB` or any other supervisor variable by hand.
- Do not edit, move or delete the hold or anything else under `dist/verification/`.
- Do not run `git clean -fdx` or delete `dist/`. That removes the hold and every
  retained receipt.
- Static checks and compile-only builds are fine: `npm run typecheck`,
  `npm run lint`, `npm run format:check`, `uv run ruff check .`, `npm run build:sdk`.
  Run them one at a time; the host is under review.
- Get test results from CI: open a pull request and read its checks.

The hold file belongs to one checkout. If any checkout or worktree of this
repository on the host has one, treat it as applying to all of them.

## 2. Verify a change

Without a hold, the local sequence is in [CONTRIBUTING.md](CONTRIBUTING.md):
`uv sync --locked`, `npm ci`, `npm run build:sdk`, then type checks, lint, the
format check and `npm test`. Tests run under the supervisor
(`scripts/verification_guard.py`); use the focused supervised command from the
contributor guide for a single file.

- Build the SDK before type checking; the examples resolve the built declarations.
- Files named `*.runtime-cases.ts` and the three native fixtures
  (`engine/conformance.test.ts`, `engine/structure.test.ts`, `engine/sdk.test.ts`)
  are held or need a GPU. Never add them to the CPU selection.
- Say in the pull request exactly what you ran and what you did not.

## 3. Keep the engine exact

The product is a deterministic engine: the same state and inputs give the same
bits on every backend, energy is conserved exactly, and a saved state restores
and continues exactly.

- Simulation paths use integer arithmetic. No clocks, no randomness, nothing that
  depends on object-key, `Map` or `Set` iteration order, and no unstable sorts.
- A pass never writes its inputs. The structural lint enforces this.
- The TypeScript CPU reference, the WGSL kernels and the Python backend must agree.
  A change to the rules changes all three, and
  [ENGINE_CONTRACT.md](ENGINE_CONTRACT.md) says when the rules or schema version
  must change.
- Do not edit generated files by hand: `engine/generated/`, `engine/kernels/`,
  `engine/_generated_schema.py`, `web/*.generated.js` and `web/shaders/`. Change
  the source and run `python -m engine.generate`.
- "Bit-identical" is a claim. Back it with a differential check against the
  previous implementation, not with a passing unit suite.

## 4. Files whose bytes matter

- `.gitattributes` marks most trees `-text`, so files keep the line endings they
  have, and some are CRLF. Never normalize line endings. After an edit,
  `git diff --stat` should show only the lines you meant to change.
- Do not reformat or "fix" the frozen material-law sources
  (`engine/experimental/structural-material.ts` and its motion baseline), `locked/`,
  or anything under `docs/checkpoints/`. Their hashes are recorded in evidence.
- `.prettierignore` lists what Prettier must leave alone.

## 5. Evidence and claims

- New raw output goes under the ignored `dist/verification/`. Compact summaries go
  in `docs/checkpoints/`.
- Never commit host details: home-directory paths, usernames, hostnames or
  process lists.
- A failed run is evidence. Keep it; do not overwrite it or quietly retry.
- A result qualifies the source, host and workload that produced it and nothing
  wider. Change [docs/VALIDATION_STATUS.md](docs/VALIDATION_STATUS.md) only when
  evidence supports the exact claim. `CHANGELOG.md` says what changed, not what
  was measured.

## 6. Pull requests

- Every change reaches `main` through a pull request with passing checks, merged
  with a merge commit. Keep each one focused.
- Add a `CHANGELOG.md` entry under the current version that names the pull request.
- Pin GitHub Actions by commit, with the version in a comment.
- Examples import the public package entries, not engine internals.
- The hosted demo list lives in `scripts/build_site.mjs`. To add a demo, add it to
  `DEMOS` and to `site/index.html`. Nothing from a checkout's `dist/verification`
  is ever published.

## 7. Scope

The engine is the product; the examples and games show how clients use it. The
experimental 3D, structural, tactical, reactive and multiphysics APIs are
versioned separately from the public 2D engine.

The rigid-body and fluid kernels exist to serve the material engine. Use
established engines such as MuJoCo as references to compare against, not as
feature targets. What this engine offers and they do not is bit-exact replay,
exact restart and an exact energy ledger; a change that trades any of those for
speed needs the owner's decision.
