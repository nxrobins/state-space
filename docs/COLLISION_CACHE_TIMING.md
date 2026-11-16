# Cached resting-stack outlier investigation

This investigation follows the retained 234.4763 ms sample in the
[normal-denominator cache comparison](COLLISION_NORMAL_CACHE.md). That original
sample has no per-step CPU or GC clocks, so its precise cause cannot be assigned
retrospectively. The original cohort and every sample remain intact.

It was sample index 1 (the second of seven): the retained times are 44.5889,
234.4763, 37.2491, 35.8955, 39.5993, 41.2124 and 41.4877 ms. Every sample matched
exact digest `89890909f934239cd42e1c425b4df83022cf61eaf8067b969cb4dcc5db79064e`
and phase work 72 assembly, 144 sweep, 8,616 contact and zero fracture units.

## Findings

**The reproduced spikes are dominated by elapsed time not charged as CPU
execution.** Review `a8abb21b416f4547a4cd8bee9d9db8ae` completed all eleven stages,
30 comparison rows, 210 measured trajectories and 3,888 instrumented steps.
All 108 differential checks, full world replay, exact states/receipts, per-step
work counts and benchmark restart/cancellation checks passed. No engine code
changed during this investigation.

All **nine measured steps lasting at least 50 ms** met the fixed large wall/CPU
gap criterion. Seven recorded zero added main-thread and process CPU at the
host's accounting resolution; two recorded 15 ms in each counter. The same
criterion held for all 17 long steps when reference, restart and warmup runs
are included. The raw short-step counters also contain negative wall-minus-CPU
gaps, so they must not be used for precise CPU percentages.

The cached engine reproduced four long measured steps at the **2 ms timestep**:

| Cohort | Sample / tick (zero-based) | Full trajectory wall | Long step wall | Thread CPU | Process CPU | GC overlap |
| ------ | -------------------------- | -------------------: | -------------: | ---------: | ----------: | ---------: |
| BA 1   | 4 / 11                     |           147.752 ms |     113.588 ms |       0 ms |        0 ms | 112.115 ms |
| AB 2   | 4 / 12                     |           166.879 ms |     129.715 ms |      15 ms |       15 ms |   0.438 ms |
| BA 2   | 0 / 19                     |           276.503 ms | **234.856 ms** |   **0 ms** |    **0 ms** |   **0 ms** |
| BA 2   | 6 / 23                     |           192.463 ms |     143.763 ms |       0 ms |        0 ms |       0 ms |

Every listed step retained exactly **368 work units** and matched its reference
state. The new 234.856 ms value is one step inside a 276.503 ms trajectory;
the original 234.4763 ms value measured an entire trajectory. They are distinct
samples, not a replay or reclassification of the original measurement.

The evidence separates three observations:

- **Waiting:** the large wall/CPU gaps rule out hundreds of milliseconds of
  additional main-thread computation in these reproduced steps. The cached
  234.856 ms step had no GC interval at all. Its job's observed host CPU peak was
  20.89%, so sustained host saturation was not necessary; one-second host
  telemetry cannot exclude short bursts or identify a scheduling event.
- **GC:** four measured long steps had no GC overlap, three had less than 1 ms,
  and two had long elapsed GC intervals. Both long-GC cases recorded zero added
  thread/process CPU: the cached 113.588 ms step above and a pre-cache 386.582 ms
  step with 384.342 ms GC overlap. Treating those GC durations as GC CPU would
  misattribute uncharged elapsed time as computation.
- **Engine:** all engine and timing-wrapper source hashes are unchanged and
  every recorded work receipt matches the reference. Thread CPU includes engine
  and runtime work, so this experiment does not give exclusive engine/GC/JIT CPU
  costs. It does show that extra counted solver work or hundreds of milliseconds
  of engine computation do not explain these reproduced spikes.

Off-CPU waiting/scheduling is therefore the leading explanation for the
reproduced spikes. The unchanged hard CPU cap is a plausible contributor, but
there is no direct quota/context-switch trace. The exact cause of the original
uninstrumented 234.4763 ms sample remains unproven. This evidence does not justify
changing time-of-impact behavior, solver iterations, replay rules or the CPU cap.

## Timing cohorts retained

All values below measure the full 48 ms simulated trajectory at the 2 ms
timestep. The plain cohort did not reproduce the cached tail; three of four
instrumented cohorts had worse cached means despite lower cached medians.

| Cohort | Pre-cache median / mean | Cached median / mean | Cached maximum |
| ------ | ----------------------: | -------------------: | -------------: |
| Plain  |      48.314 / 46.986 ms |   39.826 / 40.288 ms |      44.740 ms |
| AB 1   |      46.817 / 77.041 ms |   40.130 / 40.854 ms |      44.810 ms |
| BA 1   |      51.134 / 49.266 ms |   43.009 / 58.055 ms |     147.752 ms |
| AB 2   |      45.292 / 46.071 ms |   42.001 / 59.206 ms |     166.879 ms |
| BA 2   |      50.215 / 49.174 ms |   39.397 / 95.366 ms |     276.503 ms |

The plain pre-cache 16 ms cohort also retained a 429.483 ms trajectory. All
timesteps and samples remain in the summary. None of these diagnostic cohorts
replaces the original benchmark or establishes qualified throughput. CPU
counter quantization and instrumentation overhead preclude precise CPU savings
from the short-step totals.

## Fixed experiment

The engine remains the completed cached bundle
`44a000628cfe99134fbf3cb39cd6a431f826bc3212560524d396bf54445e7de7`.
The fresh control is the pre-cache owned-data bundle
`864cc291fc75ebfce7d6d53e6c15d1b13736679d0540c80c496298e991b19694`.
All engine files, time-of-impact behavior, benchmark/replay code, fixtures,
protocol, ownership/contact differential checks and the existing timing wrapper
are pinned to the completed cache comparison.

The new, separately bound recipe requires eleven sequential stages:

1. Startup/close, stalled-child cancellation and supervisor-loss containment.
2. The 71 ownership checks, 37 contact-cache checks and full world replay.
3. One plain resting-stack comparison.
4. Four instrumented resting-stack comparisons in fixed AB/BA/AB/BA order.

Each comparison retains all three timesteps (16/8/2 ms), budgets 1/7/256,
lossless and JSON restart checks, cancellation, two warmups and seven samples
per engine. Every complete state, receipt and deterministic work count must
match the historical cached comparison. Instrumented per-step work must also
match each exact reference frame. No sample is dropped or replaced.

## Attribution boundaries

The unchanged transparent wrapper records elapsed wall time and native
main-thread/process CPU counters around each synchronous rigid step. A
PerformanceObserver records GC intervals on the same performance clock and
drains them after the synchronous fixture. It does not force GC, open an
inspector, or change yield order or public values.

CPU counters are coarse on this host. Zero recorded CPU means that no accounting
quantum was added, not that no instructions executed. Raw negative wall-minus-CPU
differences remain in the data. Main-thread CPU includes engine, wrapper, GC and
JIT work; process CPU also includes other threads. These counters do not isolate
exclusive engine CPU time.
The counter meanings follow the pinned
[Node 22.22.3 process API](https://nodejs.org/download/release/v22.22.3/docs/api/process.html#processthreadcpuusagepreviousvalue).

GC overlap is the union of elapsed GC intervals, not GC CPU time. Those intervals
can include off-CPU waits. CPU, elapsed GC and wall time must not be combined as
three additive cost buckets. A large wall/CPU gap establishes uncharged elapsed
time, but cannot identify quota suspension, preemption or another OS wait.
Node defines performance-entry duration as
[elapsed milliseconds](https://github.com/nodejs/node/blob/v22.22.3/doc/api/perf_hooks.md#performanceentryduration).

The unchanged Windows Job uses hard CPU rate control. Microsoft documents that
threads in a Job cannot run after reaching its quota until the next scheduling
interval. This makes quota waiting a plausible explanation for a large wall/CPU
gap, without proving it occurred in a particular sample; this experiment does
not record scheduler events or change the cap.
See [Windows Job CPU rate control](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_cpu_rate_control_information).

The fixed summary includes every step lasting at least 50 ms. A large wall/CPU
gap means at least 50 ms uncharged as main-thread CPU and main-thread CPU at most
25% of wall time. These are descriptive thresholds only; they do not alter
samples, safety admission or qualification.

## Safety and qualification

The existing 6% aggregate CPU cap, 4 GiB Job memory cap, below-normal priority,
single-thread dependencies, 25 s supervisor, 30 s independent watchdog, 3 s
heartbeat and 22 s Node leaf wait remain unchanged. Each stage requires 30
consecutive quiet seconds at host CPU at most 30% and at least 8192 MiB free RAM
within 90 s. Host-health aborts, exclusive lease, retained-handle cleanup and
named-Job absence checks remain enforced.

The diagnostic bounds remain 1,200 step records, 4,096 GC entries and 4 MiB per
artifact. No GPU/browser workload or GPU query is included. The incident hold
stays `blockRecovery: true`, with no recovery permit; runtime, performance,
Worker, GPU and R1 acceptance remain false.

## Validation and evidence

Static preparation passed eight Node synthetic/source checks, 33 Python mocked
scope/cleanup checks, Python lint and JavaScript syntax checks. Runtime collection
then independently verified all stored raw clock deltas, GC intervals, exact
states, work receipts, fixed row counts, source identities and containment reports.
The earlier timing source proof now reads the retained pre-cache rigid source;
the new source proof pins the current cached engine and unchanged timing wrapper.

Every stage passed its full quiet window. All owned Jobs were emptied and
confirmed absent, with no execution lock remaining. Cancellation cleanup took
2.148 s and supervisor-loss cleanup 3.042 s. Runtime host CPU peaked at 31.29%
across the entire review and 26.90% across instrumented jobs; these runtime
readings do not change the separate 30% quiet-admission rule. The incident hold,
original failed GPU receipt and protected performance worktree are preserved.

- [Checkpoint and source bindings](checkpoints/COLLISION_CACHE_TIMING.json)
- [Full timing summary](../dist/verification/collision-cpu/a8abb21b416f4547a4cd8bee9d9db8ae/timing-summary.json)
- [Attribution summary and all measured long steps](../dist/verification/collision-cpu/a8abb21b416f4547a4cd8bee9d9db8ae/attribution-summary.json)
- [BA 2 raw clocks and GC intervals](../dist/verification/collision-cpu/a8abb21b416f4547a4cd8bee9d9db8ae/ss-stack-clock-ba-2/result.json)

The benchmark packet is `dist/verification/collision-cache-timing-20261109`,
SHA-256 `708b51974728b8eb8124a6c8ecaedf1525856df75c8b0d909baea0f4d419d1ae`.
The review SHA-256 is `51553d7186d0d1c05c5d2098998c6e1cd1bfed3c4681c62f017954d8bd45e9c1`.
Raw artifacts are local and ignored by Git; retain them with the checkpoint.

Preparation of a fresh packet uses `--prepare-cache-timing`; it permits only the
fixed eleven cases. Collection uses `scripts/collision-reference/collect-cache-timing.mjs`
and executes no engine. Attempted stages are never reused or automatically retried.
