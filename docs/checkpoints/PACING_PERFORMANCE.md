# Browser frame pacing: 256 × 256 full frames

The browser now arms its next display callback before awaiting GPU work, bounds
pending work to one timestamp, and drops time from callbacks it could not serve.
This prevents a slow frame from starting a continuing multi-tick catch-up loop.
Executed physics ticks remain consecutive and exact. Rounded timestamps have a
0.5 ms tolerance, with any early phase carried forward. Paused, unchanged views
keep their image; status text updates four times per second.

Private readback and planner buffers, caller-owned rendering copies, uniforms,
and texture views persist between frames. This removes about 3.25 MiB of large
coordinate-array allocations per ordinary 256 × 256 `step(1)` plus render on the
Wasm-backed path. It still copies and validates complete GPU readbacks. Committed
storage swaps only after the full step and GPU error scope succeed; failures can
retry from the same state. Public getters and snapshots keep returning independent
copies. `copyStateInto` validates all destinations before writing and rejects
in-flight steps, including a step started by a caller's Proxy descriptor trap.

Ordinary browser ticks encode the same 18 ordered physics dispatches in one
compute pass. WebGPU defines [each compute dispatch as a usage scope](https://www.w3.org/TR/webgpu/#usage-scopes).
Inspection retains its per-kernel submissions and independent reports. Physical
kernels, solver arithmetic, shared rendering WGSL, effect quality, and resolution
are unchanged.

Successful continuations also retain the validated state in its GPU slot, avoiding
three redundant uploads: **0.75 MiB per 256 × 256 tick**. Every public edit, clear,
restore, or failed step invalidates residency. A retry uploads all three committed
coordinates before executing the same ticks. Readback and complete validation
remain mandatory.

## Acceptance and measurement

Windows x64, Intel i9-11900K, NVIDIA RTX 4090, driver 595.79; Python 3.10.16 /
wgpu 0.31.0 and hardware WebGPU in Headless Chrome 154. Native rendering is
offscreen. Simulation is 256 × 256; output is 1920 × 1080, with material shading,
heat glow, dynamic lighting, soft shadows, water reflections/refraction,
volumetric smoke/steam, heat distortion, and bloom enabled.

The production clock and callback pump drive five trajectories, each with 600
measured frames after 60 warmup frames. The gate requires 59.9–60.1 Hz callback,
completion, and physics cadence, every frame completed within 16.67 ms of its
callback, and zero missed display slots or coalesced callbacks. It checks GPU
completion rather than submission time. Raw callback/start/completion timestamps,
work distributions, and every failure are retained. Startup, reference replay,
hashing, screenshot readbacks, and operating-system scanout are outside timing.

## Current result: all five browser scenes pass the 60 Hz gate

The [qualification receipt](pacing-resident-quiet/frames.json) captures the final
implementation, including resident-state uploads, on an otherwise quiet GPU.
GPU utilization was **1% before and after the run**; the
[boundary readings](pacing-resident-quiet/gpu-load.json) are retained.

| Browser scene | Callback Hz | Completed Hz | Physics Hz | Median work | p95 work | Maximum work | Missed deadlines / 600 | Missed slots | Coalesced callbacks |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Burning bridge | 59.950 | 59.952 | 59.950 | 8.85 ms | 10.30 ms | 11.40 ms | 0 | 0 | 0 |
| Lighting gallery | 59.950 | 59.953 | 59.950 | 9.70 ms | 11.00 ms | 13.00 ms | 0 | 0 | 0 |
| Water lagoon | 59.950 | 59.955 | 59.950 | 8.90 ms | 10.00 ms | 12.60 ms | 0 | 0 | 0 |
| Haze chambers | 59.950 | 59.948 | 59.950 | 9.10 ms | 10.20 ms | 11.40 ms | 0 | 0 | 0 |
| Heat chambers | 59.950 | 59.956 | 59.950 | 9.10 ms | 10.10 ms | 11.50 ms | 0 | 0 | 0 |

**Zero of 3,000 frames missed their completion deadline.** All five individual
gates and the overall gate passed. The maximum callback-to-GPU-completion delay
was **13.20 ms**, leaving 3.47 ms before the 16.67 ms deadline. Counting only work
overruns would miss frames whose late start pushed completion past that deadline.
This qualifies the measured trajectories on this hardware with an otherwise
quiet GPU; it does not guarantee operating-system scanout or performance under
arbitrary competing workloads.

The receipt also retains 21 unpaced scene/view comparisons per backend, each
measuring 120 frames after 12 warmup ticks. The final run records **zero browser
and two native work overruns** among 2,520 samples per backend. These include
plain, styled, alternating, and individual water/haze/distortion-off comparisons.
The native backend was measured offscreen and is not covered by the browser
display-pacing gate. No outliers were discarded.

## Earlier full attempts

All earlier receipts remain available, including failures:

| Implementation / host | Receipt | GPU utilization before / after | Deadline misses / 3,000 | Missed slots | Coalesced callbacks |
| --- | --- | ---: | ---: | ---: | ---: |
| Before dispatch batching, contended | [Loaded baseline](pacing-loaded/frames.json) | 97% / 90% | 14 | 0 | 0 |
| Batched dispatches, contended | [Loaded run](pacing/frames.json) | 95% / 80% | 118 | 1 | 1 |
| Batched dispatches, quiet | [First quiet run](pacing-quiet/frames.json) | 1% / 2% | 2 | 0 | 0 |
| Resident state, quiet | [Qualification](pacing-resident-quiet/frames.json) | 1% / 1% | 0 | 0 | 0 |

The first quiet run had one 24.90 ms haze frame and a late following frame; its
other four scenes passed. A diagnostic profile did not reproduce that stall, so
its cause is unassigned. The redundant uploads were removed because the validated
state already resided on the GPU. Host conditions differed between attempts;
these runs alone cannot assign a causal speedup to dispatch batching or explain
the earlier stall. Isolated probes do not replace the five-scene qualification.

## Exact state and release evidence

All **47 rendered trajectories plus five longer native continuations** matched
the CPU reference, with zero energy drift. Each paced trajectory runs without
resets or injected sources; the four stress scenes retain finite lava, and the
gas scenes retain more than 1,024 smoke and steam cells at the end. All five paced
trajectories ended at absolute tick 660. Native and CPU references replay
those actual tick counts outside the frame clocks. The earlier contended bridge
run ended at 662 and retains its separate exact replay.

[Final verification](pacing-resident-verification.json) passed all **16 gates**:
146 native tests, 55 SDK tests, 11 browser scheduling/rendering tests, both game
suites/builds, installed SDK clients, the live lab, and adversarial evaluation.
[Hardware browser conformance](pacing-resident-verification-browser/conformance.json)
matched **31 scenes / 2,304 per-pass comparisons**. Injected second-readback
mapping failures and malformed coordinates prove multi-tick rollback and exact
retry after a resident continuation. Reusable copies reject concurrent/reentrant
access and preserve isolation. Upload counters and CPU parity exercise all seven
public edit/reset methods, inspection, and ordinary continuations: three state
uploads after an edit, zero on an unedited continuation.

Verification and the final frame benchmark captured identical source manifests;
each confirmed sources stayed unchanged during its run. The
[installed-package report](pacing-resident-verification-sdk.json) links the
content-addressed wheel and npm archives actually tested. Prior npm archives
are retained for the earlier benchmarks' bundle identities. The current
benchmark bundle matches the installed npm archive byte for byte.

## Reproduce

Run on an otherwise quiet GPU after building the SDK:

```powershell
npm run build:sdk
uv run python -m scripts.benchmark_frames --browser-cli <agent-browser-launcher> --output dist/performance/pacing --require-locked
```

`--require-locked` writes the complete receipt before returning a failure if any
scene misses the gate. Long CPU reference replays yield between exact batches,
and the harness retains command/error evidence if browser control fails.

![All effects enabled in the water showcase](pacing-resident-quiet/browser-water.png)
