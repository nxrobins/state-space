# Pacing diagnostics

These instrumented runs locate delays. They are not acceptance measurements;
profiling adds overhead. The full-frame receipts are stored separately.

- `native-stages-before.json` records unpooled native ticks. Deferred device
  reclamation coincides with generation-1 collections of roughly 111 and 253 ms
  inside subsequent fields' validation calls.
- `native-stages.json` repeats the three-scene probe after allocation reuse and
  explicit device retirement at `close()`. All measured frames fit the budget.
  This is a limited diagnostic, not seven-scene qualification.
- `stages-traced.json` records the browser's original, main-thread CPU reference
  workflow after readback/validation overlap and the exact planner optimization.
  `stages-trace.json.gz` is the Chrome trace. `stall-windows.json` extracts its
  three measured deadline misses with stage markers and surrounding events.
- Emissive sample 424 spends 4.5 ms stepping and 13.0 ms rendering/waiting. A
  10.91 ms `MajorGC` on `CrRendererMain` overlaps its completion wait. Its cause
  is reported by V8 as `finalize incremental marking via task`, following a
  memory-reducer timer. This proves a callback delay, not expensive emissive
  shader execution. Other misses in this trace do not have the same GC event.
- `passes-before.json` uses native GPU timestamp queries at tick 60, recording
  20 samples after four warmups per scene. Emissive pass medians sum to less than
  0.2 ms. These exclude host work and cannot establish full-frame performance.

The CPU reference now runs to completion in a dedicated worker, which is
terminated before measured GPU work. This keeps reference allocations off the
presentation heap without disabling collection, removing timing samples, or
changing the workload or deadline. Production allocation reuse and overlapping
completion waits remain subject to the complete-state and rollback checks.

Probe scripts are retained with their original task-local paths. They were run
from the repository root under `dist/performance/pacing-probe`; the browser probe
used the localhost server on port 8765. The manifest binds the retained files
and the uncompressed Chrome trace. Diagnostics precede the final source receipt.
