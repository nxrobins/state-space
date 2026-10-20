# Checkpoint evidence

For current support, start with [validation status](../VALIDATION_STATUS.md).
Reports below preserve the implementation and host measured at their checkpoint.

| Evidence | Scope |
| --- | --- |
| [Thermal material pack](THERMAL_MATERIALS.md) | Five opt-in materials, three new 16³ scenes and all four original native regressions |
| [Reactive sandbox](REACTIVE_SANDBOX.md) | Three 16³ scenarios, measured responsiveness, exact Worker/replay agreement and the retained 8³ regression |
| [Reactive chamber](REACTIVE_CHAMBER.md) | 8³ real Worker, CPU reactive evolution, WebGPU presentation and save/replay |
| [Mac 128³ performance](MACOS_128.md) | Fixed cut-scene frame budget and bounded exactness checks |
| [Mac optimization](MACOS_OPTIMIZATION.md) | Structural worklist optimization and 32³/64³ comparisons |
| [Tactical/reactive history](TACTICAL_INTERVENTIONS.md) | Original build-by-build API development and runtime limits |
| [Maintainability](MAINTAINABILITY.md) | Ownership, tooling and validation refinements |
| [C7](C7.md) | Original 2D reference-release aggregate |

Use [archive restoration](../ARCHIVES.md) when an older audit requires bulk
payloads. A historical pass does not establish qualification for a changed source.

Each completed checkpoint records its requirements, implemented changes,
commands/results, targeted sweep scope, reproduced bugs, fixes, prevention rules,
and remaining limitations. Evidence must distinguish tests of the checker from
tests of actual engine behavior. Record failed intermediate checks honestly.

No checkpoint is complete solely because its documentation says it is complete.
The source and reproducible verification commands are authoritative.

The completed reference release is [C7](C7.md). Its final aggregate report is
`c7-verification.json`, with the full requirement and artifact audit in
`c7-completion-audit.json`. The live lab is `examples/lab/`; its usage, physical
scope and extension paths are documented in [CAPABILITIES.md](../CAPABILITIES.md).

The [2026-10-10 CPU optimization](CPU_PERFORMANCE.md) records the subsequent
complete-tick changes, paired timings, exact-state checks and remaining budgets.

The subsequent [GPU and global-support optimization](GPU_PERFORMANCE.md) records
256×256 native and browser public ticks within the 60 Hz simulation budget,
complete-state parity and the full release verification.
