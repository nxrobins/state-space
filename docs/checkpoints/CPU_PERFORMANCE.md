# Complete CPU tick optimization — 2026-10-10

The shared JavaScript CPU engine completes the same ca-v3 ticks faster. This
change does not alter the physical schedule, snapshot schema, game tick rates,
or native GPU kernels.

## Changes

- Validate the cold table once per complete tick and use a private registry
  copy, so an observer cannot change physics through caller-owned cold data.
- The initial structural pass validates and copies the complete input. Subsequent
  private passes consume engine-produced state. Public `runCpuPass` still
  validates every supplied input; field commits still validate completed state.
- Alternate two private state buffers through the local passes. Each pass's
  input is immutable while it executes; observers receive independent copies.
- Copy actual Uint32Array storage directly rather than checking every integer
  again. The intrinsic typed-array tag rejects forged unsigned prototypes;
  ordinary arrays still receive strict range/coercion checks before conversion.
- Construct per-cell validation error labels only on failure.
- Skip thermal pairs with equal energy in the same material, including latent
  intervals. Their full temperatures are equal and exact flux is zero.
- Add a public-API benchmark that compares complete snapshots and energy, keeps
  setup and inspection outside timing, and records runtime, CPU, configuration,
  bundle hash, benchmark hash and raw samples. Comparisons reject changed
  configurations, runtime/hardware metadata, benchmark source or trajectories.

## Measurements

The baseline SDK was built from the clean starting commit `11b3d32`. The optimized
receipt identifies the changed working-tree ESM bundle by SHA-256. Both ran on
Windows x64, Node v22.22.3, Intel i9-11900K, on one JavaScript thread. No verifier,
profiler or client build ran concurrently with the retained measurements.

Five workloads cover empty space, flow, supported metal, falling fragments and
coupled heat/fire/phase changes. Runs start at absolute tick 17, use two warmups,
then seven measured samples of four ticks. Every sample restores the same complete
input. Full output coordinates/tick/catalog hash match the baseline for all 15
trajectories; each run retains exactly the initial total energy and zero drift.

| Shape | Baseline median range | Optimized median range | Speedup range |
| --- | ---: | ---: | ---: |
| 72 × 48 | 6.76–8.23 ms/tick | 1.58–2.81 ms/tick | 2.73–4.27× |
| 160 × 90 | 25.23–29.83 ms/tick | 6.87–11.46 ms/tick | 2.56–3.68× |
| 256 × 256 | 179.50–202.79 ms/tick | 32.04–57.62 ms/tick | 3.50–5.75× |

Ranges contain the medians of the five workloads, not distribution tails. The
worst retained four-tick sample average was respectively 5.77, 13.15 and
58.90 ms/tick. `p95Ms` in the receipts is the nearest-rank percentile of the seven
sample averages, not an individual-tick latency percentile. Actual individual
ticks, rendering, inspection, browser/runtime differences and rollback can add
cost. Throughput spans about 1.1–2.2 million cell-ticks/s in this matrix; these
figures cannot be substituted for native or browser GPU throughput.

Raw evidence: [baseline](cpu-tick-baseline.json),
[optimized](cpu-tick-optimized.json). See [CAPABILITIES.md](../CAPABILITIES.md)
for the corresponding bounded CPU budget envelope.

## Reproduce

For fresh current-code timings:

```powershell
npm run benchmark:cpu
```

This builds the SDK and writes `dist/performance/cpu.json`. For the paired run,
build the SDK from `11b3d32` in a separate checkout and copy its ESM bundle into
`dist/performance/baseline-sdk.mjs`. The original bundle remains cached at that
ignored path in the working checkout used for these measurements.

```powershell
node scripts/benchmark_cpu.mjs --sdk dist/performance/baseline-sdk.mjs --report docs/checkpoints/cpu-tick-baseline.json
node scripts/benchmark_cpu.mjs --report docs/checkpoints/cpu-tick-optimized.json --compare docs/checkpoints/cpu-tick-baseline.json
```

`--shapes`, `--ticks`, `--warmups` and `--samples` configure a new matrix. A
comparison requires both receipts to use the same settings and benchmark source.

## Verification and limits

- `npm test`: 50 engine tests passed, including 31 native-GPU scenes / 2,304
  exact per-pass comparisons through both the public single-pass and complete
  tick paths. Retained observer snapshots are checked after later ticks finish.
  The structural corpus additionally checks 25 scenes / 101 complete planner
  and native-transport comparisons.
- Invalid complete inputs, all 36 public pass boundaries, caller/observer alias
  mutation, custom registries, edits, exact restart, energy and positive behavior
  remain covered. Four validation tests cover copies, coercion, length spoofing
  and forged unsigned prototypes.
- Fighter: 105 tests and production build passed. Tower defense: 37 tests and
  production build passed. Lab: five Node tests passed, including all five live
  scenario behaviors, accounting and restart.
- TypeScript structural lint, typecheck, SDK build, Python engine structural
  lint, generated-asset check and patch whitespace check passed.
- An intermediate mutation-suite run failed because its no-op injection searched
  for the old buffer-allocation statement. Its injection now returns a complete
  cloned state before local physics; the same positive-motion rejection passes.

This is CPU optimization evidence, not a rerun of the aggregate release verifier
or actual browser WebGPU verification. No GPU speedup is claimed. Global support
planning still runs to completion each tick; GPU backends still use host planning
and full readback. The next scaling work needs measurements of those costs and
exact graph invalidation or GPU residence without a shortened support horizon.
