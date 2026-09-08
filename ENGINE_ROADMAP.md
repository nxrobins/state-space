# State Space engine roadmap

The engine is the product. Games are integration probes. The target is a
deterministic, composable material simulator with convincing interacting
phenomena, measured scalability, and a supported extension workflow.

## Completion policy

This roadmap is an execution contract, not a list of claims about existing code.
Every checkpoint requires implementation, behavioral verification, a targeted
bug sweep, reproduction of findings, fixes, and automated lint/property rules
that reject the discovered failure classes. Evidence belongs in
`docs/checkpoints/`. A green test count alone does not close a checkpoint.
Checkpoints remain open when any acceptance requirement lacks direct evidence.

Preserve the existing game experiments and unrelated local edits. Shared engine
changes may update their integration boundaries and regression checks. Do not
start paid mutation runs or publish artifacts as part of routine verification.

## Checkpoints

| ID | Deliverables and acceptance | State |
| --- | --- | --- |
| C1: Authoritative contracts | One validated material catalog; generated runtime definitions; explicit snapshot/version/tick/boundary contracts; reject malformed state before GPU dispatch; source and generated-asset drift lint; schema, roundtrip, and invalid-input properties; existing GPU and game regressions pass. | Verified: docs/checkpoints/C1.md and c1-verification.json |
| C2: Backend conformance | Browser CPU reference implements the actual conservative GPU schedule and reaction rules; common scenarios and seeded differential tests compare CPU/GPU state; cover competing fuel/air claims, gas baffles, odd/non-square/tiny grids, resumable ticks, and every movement pass; mutation checks demonstrate the conformance rules catch regressions. | Verified: docs/checkpoints/C2.md and c2-verification.json |
| C3: Fidelity and accounting | Explicit thermal/chemical/latent energy accounting and documented quantization; fix demonstrated drift and transition defects rather than expanding tolerances; long-horizon heat, phase-cycle, combustion, flow, and coupled-scene validation; conservation and positive-behavior properties become required gates. | Verified: docs/checkpoints/C3.md and c3-verification.json; ca-v2 production integration and actual WebGPU/native comparison. |
| C4: Embedding and extension | Portable Python and browser APIs for create/step/edit/sample/snapshot/restore; configurable validated material registries and documented compatibility; inspectable per-pass changes and accounting; working external-client examples and installed-package tests; reject incompatible snapshots and invalid extensions. | Verified: docs/checkpoints/C4.md, c4-verification.json, c4-packages.json, and c4-browser-native.json; installed SDK clients and live WebGPU agree. |
| C5: Trustworthy evolution and performance | Fail-closed phase-specific acceptance, composed candidate evaluation, no-op rejection, synchronized timing with warmup/distributions, reproducible seeds and immutable code/device/config evidence; historical archives cannot bypass new gates; bounded adversarial candidate tests and real baseline benchmark matrix. | Verified: docs/checkpoints/C5.md, c5-verification.json, c5-evaluation/verification-with-benchmark.json, and c5-performance-comparison.json; native host boundary improved 22-27x at 512x512 with identical states. |
| C6: Richer interacting physics | Implement structural cohesion/support and breakage as an explicit engine capability, including how it composes with movement, heat, phase changes, and combustion; conserve material and preserve deterministic component behavior; showcase unsupported collapse and heat/fire-driven structural failure with validated accounting. | Verified: docs/checkpoints/C6.md, c6-v3-final-verification.json, and c6-v3-browser-native.json. Schema/rules v3 runs in all public backends; 31 scenes / 2,304 exact pass comparisons, all 14 aggregate gates, 32 evolution checks and integrated scale evidence pass. |
| C7: Engine reference release | Standalone inspectable showcase scenarios; documented capability/approximation matrix; one verification entry point covering lint, properties, CPU/GPU conformance, long scenarios, SDK clients, games, and benchmark evidence; final requirement-by-requirement completion audit. | Verified: docs/checkpoints/C7.md, c7-verification.json and c7-completion-audit.json. All 16 gates pass against unchanged sources, including the live SDK lab, actual browser/native conformance, installed clients and fresh benchmark evidence. |

## Design commitments

- Determinism is checked at the exact packed-state level where backends implement
  the same contract. Cross-device claims require evidence from those devices.
- The current 32-bit cell encoding is a versioned compatibility boundary, not a
  prohibition on additional state when fidelity requires it. New state must be
  included in snapshots, replay, accounting, and backend conformance.
- Existing CA approximations must be named. Do not describe density sorting as
  a validated continuum fluid solver or repurpose reserved fields without a
  contract revision.
- Material properties, physical rules, scheduling, and renderer integration
  have distinct responsibilities. User-facing examples use the public engine
  API rather than copying physics.
- Performance improvements must retain required positive behavior, accounting,
  and composed results. Lower work counts alone are not evidence of improvement.
- Physics extensions are selected for interacting consequences. More material
  names or game progression systems do not satisfy the engine objective.

## Starting evidence and known gaps

Baseline commit: `1468125` (2026-05-18); implementation proceeds in the current
checkout, which also contains uncommitted fighter work and the untracked Relic
Line experiment. Existing suites cover the 200-tick cascade, 18 named GPU
scenarios, 49 seeded fuzz cases, and both game unit/build checks.

Verified during the preceding assessment: the CPU adapter permits two fuels to
claim one oxygen cell and lacks the GPU thermal buoyancy behavior. Evolution
acceptance omits necessary energy/reaction gates and physics trial timing does
not explicitly await GPU completion. These are starting hypotheses to reproduce
against current source at the relevant checkpoints, not completed fixes.
