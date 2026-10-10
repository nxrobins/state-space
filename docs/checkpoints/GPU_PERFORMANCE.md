# 256×256 GPU and global support performance

On 2026-10-10 the public GPU APIs ran seven 256×256 workloads within the 16.67 ms
budget for a 60 Hz simulation, on an i9-11900K and NVIDIA RTX 4090. The scope is
ordinary complete physics ticks; startup, rendering and inspected passes have
separate costs. Timings include support planning, validation, uploads, all 18
passes and the complete state readback. Game constants and ca-v3 physics are
unchanged.

## Changes

- Encode all 18 normal passes and the three coordinate copies into one command
  buffer. Map one contiguous staging buffer per tick. Inspection still reads
  every pass and retains independent structural diagnostics.
- Share the native binding layout and create two ping-pong bind groups per run,
  replacing 72 groups. Buffers retain deterministic cleanup on success/failure.
- Compile global support, exact validation and native energy accounting into a
  bundled import-free Wasm module. Python uses Wasmtime; browser/Node use native
  WebAssembly. Runtime never invokes a compiler. Browser CSP restrictions fall
  back to the independent JavaScript planner and validator.
- Solve BFS support, reverse loads with ordered quotient/remainder splitting,
  thermal damage, connected components and contact dependencies to completion.
  Products and accounting use integer 64-bit intermediates where required.
  There is no local iteration horizon, approximate temperature or truncated graph.
- Keep public inputs/outputs isolated, validate every committed coordinate, and
  preserve atomic retry after map/read errors. Capture async inspection options
  before the first await.

## Performance evidence

`gpu-tick-optimized.json` records paired four-tick samples against the preserved
previous compositor: two warmups, seven samples, identical input and final hashes,
identical tick schedule and zero energy drift. The preserved compositor's hash is
in the receipt. The original baseline also remains in `gpu-tick-baseline.json`.
Typical synchronized tick medians fell from 34–49 ms to 3.0–4.8 ms. Global planning
fell from 23–40 ms to roughly 0.9–1.9 ms. Those internal tick times exclude run
setup, so the release target uses the whole public call below.

The native receipt and `gpu-browser-ticks.json` also record 60 successive public
`step(1)` calls after four warmup ticks, starting at absolute tick 17. Both check
the first complete tick and the final complete state at tick 81, and require zero
energy drift. Supported metal fills the entire world, the falling plate contains
28,672 bonded cells, and the long support path spans alternating rows across the
world. First-tick timings are retained to expose initial support cost before any
damage or collapse changes the graph.

The measured native public medians were about 4.8–7.1 ms, with p95 below 8.6 ms.
Browser public medians were about 5.2–6.9 ms, with p95 below 9.3 ms and maximum
11.5 ms. Browser/native hashes match for all seven workloads. These are measured
workload/device results, not a bound for every machine, host load or game renderer.
The exact per-scene distributions, runtime identity, sources and adapter identity
are in the receipts.

## Exactness and release gates

- Compiled planning matches all 101 independent structural corpus steps: source
  permutation, transported damage, loads, capacities, reactions, distances and
  components. Additional seeded damage/contact cases and a support distance over
  900 cells exercise propagation beyond local horizons.
- Compiled validation/accounting is checked across the full energy range,
  fractional Q, phase boundaries, sums above u32, random corruption, growth and
  non-aliasing. Browser CSP fallback is checked against inspected reference ticks.
- Actual batched GPU ticks match every coordinate of inspected ticks; four normal
  ticks perform four mappings, compared with 72 inspected mappings. Injected map
  and mapped-read failures preserve the field and permit exact retry.
- Native, CPU and hardware WebGPU conformance covers 31 scenes and 2,304 passes,
  including uninspected stepping, complete reports, custom materials and restart.
  The installed wheel contains the Wasm asset and runs outside the checkout.
- `gpu-verification.json` records the complete release gates: lint, Python and
  TypeScript properties, long scenarios, both game integrations, installed SDK
  clients, live hardware browser checks and adversarial composed evaluation.
  Source and compiled Wasm hashes are part of the verification/evaluation identity.

Intermediate findings were resolved before claiming the target: early internal
8 ms tick measurements hid a roughly 35 ms public native call; repeated host
validation/binding setup caused that gap. Browser fully supported metal initially
averaged 17 ms; compiled complete-state validation removed its JavaScript bond
normalization bottleneck. The browser distribution helper's default lexical sort
was replaced with numeric sorting before retaining final performance evidence.

## Reproduction

Install dependencies with `uv sync` and the repository's npm install commands.
The bundled Wasm needs no development compiler. To rebuild it after modifying the
C source or its generated constants, use Clang with wasm32 support:

```powershell
python -m scripts.build_structure_solver --clang 'C:\Program Files\LLVM\bin\clang.exe'
python -m engine.generate --check
python -m scripts.benchmark_gpu --output dist/performance/gpu.json --browser-scenes dist/performance/gpu-scenes.json
python -m scripts.benchmark_browser --browser-cli <agent-browser-launcher> --native-report dist/performance/gpu.json --scenes dist/performance/gpu-scenes.json --output dist/performance/browser-gpu.json
python -m engine.verify --report docs/checkpoints/gpu-verification.json --browser-cli <agent-browser-launcher>
```

Optional `--baseline-compositor <preserved-compositor.py>` performs the paired
baseline comparison. It must use the same independent bulk planner as the previous
compositor. Retain source hashes instead of comparing unrelated timing reports.

Next work can target rendering/transfer copies, reusable GPU resources and broader
device coverage. Incremental support caches need their own invalidation proof;
they are unnecessary for the measured 60 Hz result and are not implemented here.
