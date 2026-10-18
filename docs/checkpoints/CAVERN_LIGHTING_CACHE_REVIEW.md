# Lighting cache source review

Status: **17 non-GPU tests, SDK build, type checks and lint passed on their first
attempts**. GPU checks, replay, benchmarks and legacy demos remain blocked. The
original source review ran no tests; subsequent authorized stages are recorded
below. No native shader compilation, browser, replay or benchmark ran. The SDK
artifacts and declarations have now been regenerated.

## Findings fixed

1. **Reference mode depended on experimental cache setup.** Creating naturalistic
   appearance previously compiled and allocated B even when A was selected.
   A cache failure could prevent the reference renderer from starting. Reference
   shaders now have no cache bindings/traversal implementation; B's shaders and
   allocations are prepared lazily and published together after success. Failed
   setup can retry without replacing A. Mode changes clear pipeline-specific
   bind groups, and close-during-setup disposes late cache resources.
2. **Rebuild decisions could be overwritten or lost on failure.** Each encode
   wrote the same uniform buffer and consumed invalidation immediately. Recording
   several encodes before submission could make an earlier pass see a later
   value; an encoding exception could consume a required rebuild. Immutable
   forced/steady uniform buffers now capture each decision. Binding setup occurs
   before opening the compute pass; exceptions retain invalidation and opened
   passes are ended. Renderer encoding failures invalidate the cache. Close is
   idempotent and a closed cache refuses further work.
3. **The client unconditionally called an optional, newly added SDK method.**
   With the deliberately unrebuilt SDK, loading even reference mode could throw.
   Reference mode now tolerates the missing method and disables B with an SDK
   update message. An explicit unsupported cached request still fails clearly.
   Appearance selection commits after the setter succeeds. Mock UI tests await
   operation completion rather than guessing microtask counts for reset/toggles.

## Scope and static evidence

The review covered emitter candidate invalidation, temperature-only refresh,
canonical emitter selection, regional radius/overflow behavior, hierarchy masks
and partial leaves, draw/fog/optical consumers, API forwarding and client controls.
Physics kernels, rules, snapshots, conserved state and solver logic were not
edited. Protected-source hashes and the incident hold are checked against the
saved implementation baseline. [Static receipt](cavern-lighting-cache/static-review.json)
records current source hashes and syntax parsing; it is not GPU validation.

Source inspection still cannot prove WGSL validity, automatic pipeline layouts,
GPU memory ordering, ray edge behavior, complete replay equivalence or speed.
The GPU/replay/frame stages in [the implementation checkpoint](CAVERN_LIGHTING_CACHE.md)
remain required before runtime acceptance. No historical benchmark is promoted.

## Non-GPU stage (passed 2026-10-17)

`engine/vitest.lighting.config.ts` selects exactly three files, with one worker,
sequential files, no concurrent tests, fail-on-first-failure and bounded test/hook
timeouts. The selected suite currently contains 17 tests:

| File | Tests | Boundaries |
|---|---:|---|
| `lighting-cache.test.ts` | 7 | Small pure layout/math fixtures and inert device objects; no native device, shader compiler or submission. |
| `cavern-appearance.test.ts` | 4 | Renderer orchestration with inert device methods and empty mocked texture assets; no image decoding or network. |
| `structural-client.test.ts` | 6 | Real UI handlers/clock with mocked SDK, scene, DOM and frame callbacks; no physics execution or browser. |

This configuration has no lifecycle build hook, browser launcher or native test
fixtures. It grants no recovery permit. The authorized run used the reviewed
supervisor with live host CPU/memory checks, the real OS lease and Windows Job,
6% CPU/4 GiB Job limits, a 256 MiB Node heap limit, a 30-second independent watchdog
and a 20-second missing-progress bound. One worker ran the exact three-file suite
with `bail: 1`. All 17 tests passed; none failed or were skipped. No fixes or retries
were required. Vitest reported 1.48 seconds; the supervisor receipt spans 5.578
seconds including setup, preflight and cleanup. These are test-run durations, not
gameplay performance results.

Because the global hold also blocks CPU jobs, the evidence launcher supplied a
process-local, one-use authorization callback for this exact CPU command, timeout,
source hashes and short expiry. It kept the actual workspace/lease and telemetry;
it did not modify the hold, harness sources, legacy gate or leaf runtime gates.
The recorded authorization has been consumed and the attempt refuses overwrite.
The workload process and named Job were absent afterward; a separate read-only
process check found no owned watchdog remaining.

[Retained evidence](cavern-lighting-cache/non-gpu-tests-2026-10-17/summary.json)
links the supervisor receipt, test report, raw output, health samples, cleanup,
exact scoped authorization and source hashes. The helper check is retained in
[helper-cleanup.json](cavern-lighting-cache/non-gpu-tests-2026-10-17/helper-cleanup.json).
These tests exercise inert device/DOM/SDK objects; they do not validate native
WGSL compilation, GPU execution, replay conformance or full-frame latency.

The actual safety hold remains `blockRecovery: true`, with no recovery permit,
and its hash matches before and after the run. GPU checks, replay and benchmarks
remain blocked; legacy demos remain quarantined.

## SDK build, type checks and lint (passed 2026-10-17)

Under separate user authorization, these CPU stages ran one at a time. Each
receipt and cleanup result was checked before starting the next command.

| Stage | Result | Supervisor wall time |
|---|---|---:|
| `npm run build:sdk` (nine Vite bundles, then SDK declarations) | Passed | 17.157 s |
| `tsc --noEmit -p engine/tsconfig.json` | Passed | 6.890 s |
| `node engine/lint_ts.mjs` | Passed | 2.901 s |

No stage failed or required a retry. Source inspection found that structural
lint's explicit file list omitted the new lighting-cache source/tests, appearance
test and dedicated Vitest configuration; those four files were added before the
checks. No simulation or renderer behavior changed in this stage. The full type
check includes the new tests. Vite bundles GPU-facing modules as JavaScript; it
does not execute physics or compile WGSL on a GPU.

All stages used the real live-health checks, OS lease, 6% CPU cap, 4 GiB Job limit,
512 MiB Node heap limit and independent watchdog. The build had a 60-second
deadline; type checking and lint had 30-second deadlines. The same process-local,
exact-command authorization pattern preserved the hard hold and legacy gate.
Workload processes and named Jobs were absent after each stage, and the final
read-only process check found no owned watchdogs remaining.

[CPU check evidence](cavern-lighting-cache/cpu-checks-2026-10-17/summary.json)
retains commands, input hashes, rebuilt SDK hashes, stdout/stderr, live telemetry,
watchdog/cleanup receipts and the protected-source comparison. Build and check
durations are not gameplay performance evidence. Native shader validation,
GPU behavior, exact replay comparisons and frame measurements remain pending
and blocked until separately authorized.

## Tiny GPU smoke proposal (reviewed 2026-10-17; not run)

[The bounded smoke plan](CAVERN_LIGHTING_GPU_SMOKE_PLAN.md) specifies a 128-cell,
three-submission compute-only probe, exact reference-light comparisons, hierarchy
readback and input immutability checks. Safety review identified prerequisites:
real browser cancellation/cleanup coverage, a safe launch mode without the current
unsafe-WebGPU flag, tighter phase deadlines, and a narrowly scoped authorization
that preserves the hard hold at all other entry points. Prefer a separate physical
GPU test host while workstation freezes remain unexplained. No browser or GPU
work was launched; replay/benchmarks remain blocked and legacy demos quarantined.
