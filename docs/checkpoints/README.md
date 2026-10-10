# Checkpoint evidence

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
