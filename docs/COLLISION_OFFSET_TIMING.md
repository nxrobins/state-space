# Offset-cache resting-stack timing investigation

This follows the 8 ms median regression (9.553 to 11.933 ms) and retained
181.1903 ms sample at the 2 ms timestep in the
[contact-offset comparison](COLLISION_OFFSET_CACHE.md). Those elapsed times
measure complete 48 ms simulated trajectories. The original samples have no
per-step CPU or GC clocks and remain unchanged; their precise causes cannot be
assigned retrospectively.

## Findings

**The 8 ms result is sensitive to cohort and execution order; the reproduced
large spikes are dominated by elapsed time not charged as CPU.** Review
`9f411a5c1e714d649c5c5decb22dd359` completed all eleven stages, 30 rows, 210 measured
trajectories and 3,888 instrumented steps. All 108 differential checks, full world
replay, exact states/receipts, trajectories, diagnostics and work counts passed.

### The 8 ms regression

The original 24.9% median regression did not persist across the new comparisons.
The plain run and both AB instrumented runs had lower offset-cache medians;
both BA runs had higher offset-cache medians. At this timestep AB measures the
offset cache first, and BA measures the denominator-cache control first.

| Cohort              | Engine measured first | Control median | Offset-cache median | Offset-cache change |
| ------------------- | --------------------- | -------------: | ------------------: | ------------------: |
| Original comparison | Offset cache          |       9.553 ms |           11.933 ms |              +24.9% |
| New plain           | Offset cache          |      12.804 ms |            8.996 ms |              -29.7% |
| AB 1, instrumented  | Offset cache          |      12.227 ms |            9.991 ms |              -18.3% |
| BA 1, instrumented  | Control               |       9.482 ms |           10.285 ms |               +8.5% |
| AB 2, instrumented  | Offset cache          |      11.922 ms |           10.020 ms |              -16.0% |
| BA 2, instrumented  | Control               |      10.174 ms |           11.725 ms |              +15.2% |

The first measured engine has the lower median in all four new instrumented
cohorts. This association prevents assigning their differences solely to the
cache. The original cohort had the opposite result with the same AB order, so
order alone also does not explain its regression. Shared-process/JIT/heap state
and scheduling remain possible contributors; this experiment does not isolate
them or establish an intrinsic 8 ms engine regression or a qualified speedup.

The 8 ms measured steps contain no 50 ms spike: maxima are 5.624 ms for the
control and 3.602 ms for the offset cache. Every measured trajectory retains
2,400 work units. Across 28 instrumented trajectories per engine, GC overlap
totals are 19.417 ms for the control and 18.190 ms for the offset cache. The
per-trajectory means below show that higher offset-cache wall time is not
consistently accompanied by higher GC overlap or accounted CPU.

| Instrumented cohort | Control / offset mean wall | Control / offset mean thread CPU | Control / offset mean GC overlap |
| ------------------- | -------------------------: | -------------------------------: | -------------------------------: |
| AB 1                |          12.237 / 9.975 ms |                15.571 / 9.000 ms |                 0.528 / 0.524 ms |
| BA 1                |          9.469 / 10.937 ms |               11.143 / 13.429 ms |                 0.462 / 0.638 ms |
| AB 2                |         12.811 / 10.181 ms |               13.429 / 11.286 ms |                 1.076 / 0.811 ms |
| BA 2                |         10.307 / 11.741 ms |                13.571 / 6.714 ms |                 0.708 / 0.625 ms |

These CPU values are coarse counters, not exclusive engine costs. Of 168 measured
steps per engine at 8 ms, 144 control and 150 offset-cache steps record zero added
thread CPU; 24 control and 18 offset-cache steps have negative wall-minus-thread-CPU
gaps. Even the summed control thread CPU (376 ms) exceeds its summed wrapped wall
time (313.031 ms). These records cannot justify precise engine CPU percentages or
savings. All raw counters, including the negative gaps, remain retained.

### The large elapsed-time spikes

Both measured steps lasting at least 50 ms meet the fixed large wall/CPU gap
criterion. The same criterion holds for all 21 long steps when reference,
budget, restart and warmup phases are included.

| Cohort / timestep          | Full trajectory wall | Long step wall | Thread CPU | Process CPU | GC overlap |
| -------------------------- | -------------------: | -------------: | ---------: | ----------: | ---------: |
| Offset cache, AB 1 / 2 ms  |           151.032 ms |     110.034 ms |       0 ms |        0 ms |   0.445 ms |
| Offset cache, BA 2 / 16 ms |           330.536 ms |     325.171 ms |      16 ms |       31 ms |       0 ms |

The first is measured sample 4, tick 5; the second is sample 3, tick 1 (zero-based).
They retain exactly 368 and 416 work units respectively and match their complete
reference state. Hundreds of milliseconds of additional main-thread computation
or elapsed GC overlap do not explain these reproduced measured spikes.

Long GC intervals elsewhere illustrate why elapsed GC is not GC CPU: a 215.525 ms
offset-cache warmup step overlapped 214.064 ms of GC, and a 364.953 ms restart step
overlapped 363.224 ms of GC. Both recorded zero added thread and process CPU.
The long elapsed intervals include substantial time not charged as execution.

Off-CPU waiting/scheduling is the leading explanation for the reproduced spikes.
The unchanged hard CPU cap is a plausible contributor, but there is no scheduler
or quota-event trace to identify the wait reason. Runtime host CPU peaked at
25.73% across the review; sustained host saturation was not needed to reproduce
the delays. One-second telemetry cannot exclude short host bursts.

The original **181.1903 ms trajectory** and the new plain cohort's **204.7575 ms
trajectory** have no CPU/GC clocks. Their exact causes remain unproven. The new
instrumented spikes are separate observations, not retroactive measurements of
either plain sample. No sample is dropped or replaced.

At 2 ms, plain control/offset medians were 43.529/39.443 ms, but the retained
204.758 ms tail raised the offset-cache mean to 63.750 ms versus 43.404 ms for the
control. Instrumented 2 ms offset-cache medians were lower in three cohorts and
higher in one. Full medians, means, maxima, CPU counters and GC intervals for all
timesteps remain in the linked summaries. No timing result closes qualification.

The evidence supports leaving the engine and safety limits unchanged. A useful
next measurement would isolate engine order and shared-process state in a new
fixed recipe with matched replay gates; these results do not select an engine
code change or identify a specific GC/JIT cost to optimize.

## Fixed experiment

The offset-cache engine stays
`f64bf7fd75f878a3a82d3a9fabe50daa384087efcc12f1285a6e70972466efa8`.
Its fresh denominator-cache control stays
`44a000628cfe99134fbf3cb39cd6a431f826bc3212560524d396bf54445e7de7`.
Every engine file, replay/benchmark source, fixture, protocol, ownership/contact
differential suite and the existing clock wrapper is pinned to the completed
offset-cache comparison. No engine code changes in this investigation.

The separate fixed recipe has eleven sequential stages: three containment
probes, 71 ownership checks, 37 contact checks, full world replay, one plain
resting-stack comparison and four instrumented comparisons in AB/BA/AB/BA order.
Each comparison retains 16/8/2 ms timesteps, the 48 ms simulated trajectory,
budgets 1/7/256, both restart formats, cancellation, two warmups and seven measured
repetitions per engine. Complete exact states, receipts, diagnostics, trajectories
and deterministic work must match the completed offset-cache result. Every
instrumented step's work and yield count must match its exact reference frame.

AB denotes the existing per-timestep alternating order: control first at 16/2 ms,
offset cache first at 8 ms. BA reverses that order. Plain retains AB order.
All samples, including long and coarse-clock negative-gap samples, are retained.
The plain and instrumented cohorts remain separate.

## Attribution boundaries

The unchanged transparent wrapper records elapsed time and native current-thread
and process CPU counters around each synchronous rigid step. Deferred GC entries
use the same performance clock. The wrapper preserves generator calls, values,
yields and close/cancellation behavior. It forces no GC, opens no inspector or
browser, and makes no priority, affinity or CPU-cap changes.

CPU accounting is coarse on this host. Zero added CPU means no accounting quantum
was added, not zero instructions. Short intervals can have negative wall-minus-CPU
gaps and do not support precise CPU fractions. Thread CPU includes engine,
wrapper, GC and JIT work; it is not exclusive engine CPU time. Process CPU also
includes other process threads.

GC overlap is the union of elapsed GC intervals intersecting each step. It may
include off-CPU waits and is not GC CPU time. CPU, GC elapsed overlap and wall time
are overlapping measurements, not additive or subtractable cost buckets. A large
wall/CPU gap shows uncharged elapsed time, but does not identify quota suspension,
preemption or another OS wait. The prior
[denominator-cache timing investigation](COLLISION_CACHE_TIMING.md) explains these
same measurement limits and the unchanged Job hard-cap semantics.

The fixed long-step summary retains every step lasting at least 50 ms. A large
wall/CPU gap means at least 50 ms uncharged as main-thread CPU and thread CPU at
most 25% of elapsed time. These descriptive thresholds never change samples,
safety admission or qualification. The 8 ms analysis separately reports each
cohort's full timing samples, medians, means, coarse CPU totals, GC overlap and
work counts; it is not limited to the long-step threshold.

## Safety and qualification

The limits remain 6% aggregate Job CPU, 4 GiB, below-normal priority, single-thread
dependencies, 25 s supervisor/30 s independent watchdog, 3 s heartbeat and 22 s
Node leaf wait. Each stage requires 30 consecutive quiet seconds at host CPU at
most 30% and at least 8192 MiB free RAM within 90 s. Health aborts, exclusive lease,
retained-handle cleanup and named-Job absence checks remain enforced.

Diagnostic bounds remain 1,200 step records, 4,096 GC entries and 4 MiB per
artifact. No GPU/browser workload or GPU query is included. The incident hold
stays `blockRecovery: true`, with no recovery permit. Runtime, performance, GPU,
Worker and R1 acceptance remain false. Attempted stages are never reused or
automatically retried.

## Validation and evidence

Static preparation passed eleven Node synthetic/source checks, 41 mocked Python
scope/cleanup checks, Python lint and JavaScript syntax checks. The runner source
proof permits only a fixed recipe-identity change from the existing clock runner.
The data-only collector independently verified raw counter deltas, GC intervals,
all exact states and per-step work, source identities and containment reports.

Every launched stage passed its full quiet window. The first stalled-child
preflight was refused before launch after 90 seconds, with 36 observations above
30% host CPU (maximum 81.07%). Its receipt was preserved; the absent stage directory
and execution locks were verified before a fresh preflight. No attempted stage
was reused. Cancellation cleanup took 2.193 s and supervisor-loss cleanup took
3.046 s. All Jobs were emptied and confirmed absent; no execution lock remains.
The original failed GPU receipt, hold bytes, bound sources and protected worktree
are preserved, and all qualification flags remain false.

- [Checkpoint and source bindings](checkpoints/COLLISION_OFFSET_TIMING.json)
- [All cohorts and clock attribution](../dist/verification/collision-cpu/9f411a5c1e714d649c5c5decb22dd359/attribution-summary.json)
- [Full timing summary and all long steps](../dist/verification/collision-cpu/9f411a5c1e714d649c5c5decb22dd359/timing-summary.json)

Benchmark packet `dist/verification/collision-offset-timing-20261109` has SHA-256
`48596c665a49ad018142fb56524b84f2691b9e72f045b09d8d00d2002eba6d90`.
The review SHA-256 is
`c801efc53cc644962e22d6aedfc2ab9b480194fe34bc3c2dcfe3ad77ef6247ab`.
Raw artifacts are local and ignored by Git; retain them with the checkpoint.

Fresh preparation uses `--prepare-offset-timing`; only the eleven fixed cases
are permitted. `scripts/collision-reference/collect-offset-timing.mjs` collects
the retained evidence without executing an engine. Historical comparisons and
their archived source versions remain intact.
