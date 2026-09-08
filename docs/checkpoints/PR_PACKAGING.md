# Engine v3 PR packaging

The release packages the completed C1-C7 engine roadmap: coupled material,
energy and structural state; native GPU, CPU and browser SDKs; validated custom
materials; complete replay and inspection; an evolution acceptance pipeline;
and five live reference-lab experiments. The engine is the product. The games
serve as integration clients.

## Scope

Source commit: `5f38bc5dbbd61c52253187173a737144ec3697d2`.

The existing Relic Defense client is included because the complete verification
command requires its integration tests and build. Fighter changes include only
the engine snapshot bridge and its regression tests. Unrelated fighter gameplay
and art edits remain local; 535 local paths were checked against their recorded
contents during packaging.

Checkpoint reports from C1-C7 retain their original context. The PR verification
below was run from a separate checkout of the committed release scope, without
the unrelated fighter edits.

## Verification

[The full report](pr-verification.json) passed all 16 gates, finishing at
`2026-09-08T03:53:32.012813+00:00`. It includes:

- Structural lint, Ruff, TypeScript lint and type checking.
- 129 Python tests, 42 engine TypeScript tests, cascade and invariant scenarios.
- 78 fighter tests and 37 Relic tests, plus both production builds.
- Installed Python and JavaScript SDK clients with matching complete state.
- Five lab properties and hardware browser verification: 31 conformance cases,
  2,304 pass comparisons and all five live lab scenes.
- 32 evolution audit checks and 16 benchmark rows.

The verifier's 205 source hashes remained unchanged during the run. Packaging
compared every tested file with the committed source: 182 matched byte for byte;
23 pre-existing fighter files differed only by Git's CRLF checkout conversion.
[The packaging audit](pr-packaging-audit.json) records those paths, artifact
hashes and the final integration-client lockfile hashes.

The original game development lockfiles exposed dependency advisories during
fresh installation. Both were updated within the existing manifest ranges,
including Vite 6.4.3 and Vitest 3.2.7. After their original full-run gates,
both clients received fresh installs, passed their tests and builds again, and
reported zero audit vulnerabilities. Their package manifests and engine source
did not change. These targeted reruns validate the final lockfiles:

- [Fighter install, tests and build](pr-fighter-tools.txt),
  [dependency audit](pr-fighter-audit.json).
- [Relic install, tests and build](pr-relic-tools.txt),
  [dependency audit](pr-relic-audit.json).

The README and this packaging evidence were added after the full run. SDK package
artifacts are retained by content hash, and verification artifacts are copied
without modifying their original bytes. The evolution receipt is
`69f89035b8ea953cc156ab577e672bd61246de0a4632573a056052ce9458df86`.

## Review entry points

- [README](../../README.md) for running the lab and the full verifier.
- [Capabilities](../CAPABILITIES.md) for fidelity and extension boundaries.
- [SDK](../SDK.md), [structures](../STRUCTURES.md) and
  [evolution](../EVOLUTION.md) for implementation contracts.
- [Browser evidence](pr-verification-browser/report.json),
  [installed SDK evidence](pr-verification-sdk.json) and
  [evolution/benchmark evidence](pr-verification-evaluation/verification-with-benchmark.json).

This is a cellular material model with quasistatic structural planning, not a
calibrated continuum solver. Host planning and full-state GPU readback still
limit larger worlds. Packages remain local/private; this PR does not publish
them to a package registry.
