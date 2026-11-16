# Resting-stack timing investigation

This investigation follows the 2 ms resting-stack mean regression in the
[owned-data optimization](COLLISION_OWNED_OPTIMIZATION.md). The engine is unchanged
from that completed comparison. All time-of-impact, integration and contact code,
the benchmark/replay implementation, fixtures and protocol are hash-pinned.

## Findings

**The reproduced long samples are dominated by time not charged as CPU execution,
not additional counted engine work.** The fresh review completed all ten stages,
30 version/timestep rows, 210 measured trajectories and 3,888 instrumented steps.
All exact replay, per-step work and 71 boundary/ownership checks passed. No engine
code was changed for this investigation.

Across the four instrumented jobs, all **15 measured steps lasting at least
50 ms** met the fixed large-wall/CPU-gap criterion. Fourteen recorded zero added
main-thread and process CPU time at the counters' resolution. The remaining
243.570 ms step recorded 16 ms of main-thread CPU and 31 ms of process CPU.
"Zero" here means no new accounting quantum was observed; it does not mean no
instructions executed. The elapsed gaps are much larger than ordinary short-step
clock uncertainty.

The optimized **2 ms** case reproduced two slow trajectories:

| Fixed job | Sample / tick indices (zero-based) | Full trajectory wall time | Long step wall time | Main-thread CPU | Process CPU | GC overlap |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| AB repeat 2 | 2 / 10 | 156.366 ms | 94.082 ms | 0 ms | 0 ms | 0.596 ms |
| BA repeat 2 | 2 / 0 | 215.565 ms | 175.292 ms | 0 ms | 0 ms | 0 ms |

Both long steps performed the same **368 deterministic work units** as their
reference steps. The original optimization's complete 2 ms exact hash is retained
throughout. A separate optimized 8 ms step reproduced a delay close to the
original outlier's size: **249.940 ms wall, 0 ms recorded thread/process CPU,
0.490 ms GC overlap**. Similar delays occurred in both engine versions and both
execution orders.

Eight of the 15 long measured steps had no GC overlap; another five overlapped
less than 0.62 ms of GC. The other two had long elapsed GC intervals but no added
thread or process CPU accounting. For example, a 366.194 ms baseline step
overlapped 363.245 ms of GC while both CPU deltas were zero. GC elapsed duration
alone would therefore misattribute waiting as computation in these traces.

The plain control's 2 ms mean improved from **63.852 to 47.962 ms**, and its
optimized samples ranged from 44.209 to 54.969 ms. It did not reproduce the
earlier mean regression. All four instrumented jobs also had lower optimized
2 ms means than their corresponding baseline means, with every outlier retained:

| Cohort | Baseline median / mean | Optimized median / mean | Optimized maximum |
| --- | ---: | ---: | ---: |
| Plain | 65.069 / 63.852 ms | 47.267 / 47.962 ms | 54.969 ms |
| Instrumented AB 1 | 86.496 / 105.414 ms | 62.715 / 63.163 ms | 67.841 ms |
| Instrumented BA 1 | 82.141 / 82.034 ms | 60.220 / 61.063 ms | 78.095 ms |
| Instrumented AB 2 | 88.938 / 107.731 ms | 62.804 / 75.377 ms | 156.366 ms |
| Instrumented BA 2 | 66.649 / 77.057 ms | 45.942 / 70.989 ms | 215.565 ms |

Instrumentation changes overhead and scheduling. These cohorts are diagnostic
observations, not replacement benchmark measurements or evidence for a qualified
speedup. Coarse CPU deltas accumulated across short steps can even exceed their
summed wall intervals; the raw values are retained and are not used for precise
CPU efficiency comparisons.

The evidence supports **off-CPU waiting/scheduling as the leading explanation for
the reproduced spikes**, with the unchanged Job hard cap a plausible source.
The final two instrumented jobs still captured pauses with observed host CPU
peaks of only 23.40% and 17.13%. Host saturation is therefore unnecessary for
this behavior, although one-second health sampling is not a scheduler trace.
There was no direct throttle-event or context-switch trace, so these measurements
do not distinguish quota suspension from other OS waits. They also cannot prove
the exact cause of the earlier uninstrumented 249.806 ms sample.

There is no evidence here to justify changing time-of-impact handling, solver
work, replay checks or admission behavior in response to the old mean. Retain
the optimization and the original tail sample; keep elapsed and CPU evidence
separate in future diagnostics. Do not relax the cap to make the result look
better or treat this run as performance qualification.

## Completed validation and evidence

All named Jobs disappeared and no execution lock remains. Cancellation emptied
its Job in 2.149 seconds; supervisor-loss containment took 3.043 seconds. Hold
bytes, the original failed GPU report, source identities and protected worktree
were preserved. Runtime, performance, Worker, GPU and R1 acceptance remain false.

Six synthetic/static Node checks and 25 Python scope tests passed, along with
Python lint, syntax/formatting checks and `git diff --check`. Synthetic tests cover
transparent delegation, exception/cancellation behavior, clock attribution,
GC interval union, replay invocation counts and unchanged engine/harness hashes.
The real engine checks ran only within the fixed contained recipe.

- [Source-bound checkpoint](checkpoints/COLLISION_STACK_TIMING.json)
- [Full timing summary, all cohorts and long-step records](../dist/verification/collision-cpu/f563007cdba34c539ff275d33ad28a00/timing-summary.json)
- [Plain control](../dist/verification/collision-cpu/f563007cdba34c539ff275d33ad28a00/ss-stack-plain/result.json)
- [AB 1 raw steps and GC intervals](../dist/verification/collision-cpu/f563007cdba34c539ff275d33ad28a00/ss-stack-clock-ab-1/result.json)
- [BA 1 raw steps and GC intervals](../dist/verification/collision-cpu/f563007cdba34c539ff275d33ad28a00/ss-stack-clock-ba-1/result.json)
- [AB 2 raw steps and GC intervals](../dist/verification/collision-cpu/f563007cdba34c539ff275d33ad28a00/ss-stack-clock-ab-2/result.json)
- [BA 2 raw steps and GC intervals](../dist/verification/collision-cpu/f563007cdba34c539ff275d33ad28a00/ss-stack-clock-ba-2/result.json)

The checkpoint binds review SHA-256
`ac46c2422ff5ff964fd82c3718aa01fe6ecd7ead6a3c70d3f2653cf7e56415cd`
and benchmark packet SHA-256
`08dbf80850a9587a07a6291c9d31141bfd30c2a91debb0941a95f012faae4163`.
The optimized engine bundle remains
`864cc291fc75ebfce7d6d53e6c15d1b13736679d0540c80c496298e991b19694`.
Raw `dist` artifacts are local and ignored by Git; retain them with the checkpoint.

## Original evidence and its limits

The optimized seven samples were 42.4502, **249.8061**, 41.3315, 40.7786, 42.0948,
43.5591 and 43.8224 ms per 48 ms trajectory. Fresh original-engine controls were
56.0382, 52.4082, 55.5377, 53.6043, 58.0206, 55.4228 and 60.1913 ms. The optimized
median improved, but its mean rose from 55.8890 to 71.9775 ms. All samples remain
retained; this investigation does not replace or discard the long sample.

Every repeat matched exact state SHA-256
`89890909f934239cd42e1c425b4df83022cf61eaf8067b969cb4dcc5db79064e`.
The deterministic phase counts were 72 assembly, 144 sweep, 8,616 contact and zero
fracture units. These counts rule out changed counted work in that sample, but
cannot measure garbage collection, JIT compilation or time waiting to execute.

The original stage's one-second host readings were low (the supervisor's samples
peaked at 25.10% CPU), with ample available memory. Those readings neither locate
nor explain a 250 ms sample. That run did not record per-sample CPU counters,
garbage-collection intervals or scheduling events. Its exact cause cannot be
assigned retrospectively.

## Fixed diagnostic recipe

Review `f563007cdba34c539ff275d33ad28a00`, benchmark packet
`collision-stack-timing-20261108`, requires ten sequential stages:

1. Startup/close, stalled-child cancellation and supervisor-loss containment.
2. The same 71 differential ownership/admission checks and full LEG-WORKER replay.
3. One plain stack comparison using the unchanged benchmark function.
4. Four instrumented stack comparisons, alternating which engine version runs
   first. Each retains all three timesteps, the original replay/budget/restart/
   cancellation checks, two warmups and seven measured repetitions per version.

Both frozen pre-optimization and current bundles must reproduce the historical
exact states, receipts and deterministic work. The instrumented wrapper measures
each synchronous rigid step from creation through generator closure; it does not
change yielded values, inputs, return identities or advancement order. Recorded
per-step work is checked against the exact reference frame. Invocation counts
also check that no budget, restart, warmup or measured trajectory was omitted.

Each step records elapsed wall time, user/system CPU counters for the main thread
and whole Node process, and an interval on the process performance clock. The
observer records GC intervals on that same clock and drains notifications only
after the full synchronous fixture. It does not force GC or open an inspector.
All plain and instrumented timings remain separate from the prior benchmark.

Node's [thread CPU API](https://nodejs.org/docs/latest-v22.x/api/process.html#processthreadcpuusagepreviousvalue)
reports CPU charged to the current thread. The
[process CPU API](https://nodejs.org/docs/latest-v22.x/api/process.html#processcpuusagepreviousvalue)
also includes other threads, so it can exceed elapsed time. Counter units do not
establish their effective resolution: short Windows intervals can have coarse
accounting. Raw negative wall-minus-CPU differences remain in the evidence;
individual 2 ms steps do not support precise CPU percentages.

GC overlap is a union of elapsed intervals, as exposed by Node's
[pinned performance-hook API](https://github.com/nodejs/node/blob/v22.22.3/doc/api/perf_hooks.md).
It is not exclusive GC CPU time and may itself include scheduling delay. A large
wall/CPU gap shows time not charged as thread execution, but cannot by itself
identify a CPU quota event, OS preemption, page wait or another wait reason.

The data-only summary lists every step lasting at least 50 ms, including reference,
restart, warmup and measured runs. It marks a large wall/CPU gap when at least
50 ms is unaccounted as main-thread CPU and main-thread CPU is at most 25% of the
step's wall time. These fixed descriptive thresholds do not filter samples or
change any acceptance gate; every raw step is retained.

The existing Windows Job uses an enabled 6% hard CPU cap. Microsoft's
[hard-cap specification](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_cpu_rate_control_information)
states that a Job reaching its quota cannot run again until the next scheduling
interval. This makes quota scheduling a plausible explanation even with low
overall host CPU. The experiment keeps that cap intact; it does not attempt an
uncapped intervention or claim direct observation of a throttle event.

The 4 GiB memory cap, below-normal priority, 25-second supervisor, 30-second
independent watchdog, 22-second Node-leaf wait, 30 consecutive quiet seconds,
90-second preflight deadline and host-health aborts remain unchanged. The recipe
bounds each fixture to 1,200 step records, 4,096 GC entries and 4 MiB per diagnostic
artifact. It never retries an attempted stage or replaces failed samples.

No browser/GPU workload or GPU query is authorized by this diagnostic. The
incident hold remains `blockRecovery: true` with no recovery permit. Runtime,
performance, Worker, GPU and R1 qualification flags remain false.

## Retained preflight interruption

The first timing review, `5d1017ecf838476c90efcb67f5c7181d`, passed startup/close
and cancellation, then stopped during supervisor-loss preflight when Windows
denied replacement of the quiet-window JSON file (`WinError 5`). No supervisor-loss
attempt directory or capability had been created, and no physics ran. A concurrent
read of that live receipt overlapped the replacement failure; file sharing is a
plausible cause, but has not been established as the exclusive cause.

The lock was left intact until a fixed audit acquired the global lease, confirmed
the preflight owner was absent, independently queried both previous named Jobs
as absent, checked that no attempt existed, and revalidated the hold, sources and
protected worktree. A separate retirement repeated those checks under the lease
and archived the exact lock bytes. Nothing was terminated and no safety setting
changed. The quiet JSON and its failed temporary replacement are retained.

The [audit](../dist/verification/collision-cpu/5d1017ecf838476c90efcb67f5c7181d/preflight-audit.json)
and [resolution](../dist/verification/collision-cpu/5d1017ecf838476c90efcb67f5c7181d/preflight-resolution.json)
record this as a retired, incomplete preflight. The fresh review starts from the
first containment probe. Monitoring now uses command output and completed
receipts, without reading files while the controller replaces them.

## Reproduction

The pre-extension scope/controller/test files and unchanged source identities
are retained in `dist/verification/collision-stack-timing-review-20261108`.
Static preparation does not import an engine:

```powershell
node scripts/benchmark_collision_reference.mjs prepare --output dist/verification/NEW_STACK_TIMING
& $basePython -B scripts/verify_collision_cpu.py --prepare-timing dist/verification/NEW_STACK_TIMING
& $basePython -B scripts/verify_collision_cpu.py --packet dist/verification/collision-cpu/REVIEW --case startup-close
```

Run the review's fixed sequence, stopping on any nonzero exit. After the sequence,
collect retained evidence without executing either engine:

```powershell
node scripts/collision-reference/collect-timing.mjs dist/verification/collision-cpu/REVIEW
```
