# State Space CPU collision profiling

The November 8 profiling cohort completed **21 rows and 11 containment/execution
stages**, retaining 21 raw profiles and 5,680 sampled stacks. Every row matched
the previous complete lossless state, observations and deterministic work counts.
The LEG-WORKER world reference also matched. The engine and benchmark
implementation were unchanged.

The clearest kernel hotspot is **defensive copying and repeated admission checks**.
The profile supports investigating that cost while preserving time-of-impact
handling. Contact solving is the larger cost in the resting-stack fixture.
These are observations from a bounded diagnostic cohort; all qualification
acceptance flags remain false.

## Measured results

Review `08671da1aaee4938bbe174b168fb6fca` uses benchmark packet
`collision-reference-profile-20261108`. The
[checkpoint](checkpoints/COLLISION_CPU_PROFILE.json) binds the source identities,
raw profiles, exact baseline matches, corrected analysis and containment receipts.

Of 5,680 sampled stacks, 3,041 were attributed to kernel API calls. The following
counts include descendants and overlap; they are **shares of sampled kernel
stacks, not exact CPU-time percentages or predicted speedups**.

| Kernel activity | Inclusive samples | Share of kernel samples |
| --- | ---: | ---: |
| Portable defensive copying | 1,228 | 40.4% |
| Parcel admission/read validation | 1,014 | 33.3% |
| Assembly admission/mass properties | 931 | 30.6% |
| Contact solving/projection | 812 | 26.7% |
| Time-of-impact search/advancement | 206 | 6.8% |

Copying is nested within admission checks, so those rows cannot be added together.
`copyPortableValue` and its recursive `copy` function also account for 1,225
exclusive leaf samples inside recognized kernel calls. This makes copying a
substantial direct cost, rather than merely a parent appearing above other work.

The distribution varies by fixture (all three timesteps combined):

| Fixture | Kernel samples | Copying | Contact solving | Time-of-impact |
| --- | ---: | ---: | ---: | ---: |
| Free drift | 141 | 48.2% | 0.0% | 0.7% |
| Thin wall | 377 | 46.7% | 21.0% | 5.3% |
| Occluded wall | 487 | 46.6% | 23.0% | 6.0% |
| Grazing clearance | 277 | 54.5% | 10.1% | 2.5% |
| Rotating plate | 366 | 41.0% | 16.7% | 20.2% |
| Impact chain | 582 | 39.7% | 29.9% | 5.5% |
| Resting stack | 811 | 27.7% | 44.1% | 5.3% |

The rotational fixture has a meaningful continuous-collision cost. The aggregate
6.8% should not be generalized to larger or more difficult collision scenes.
The time-of-impact category includes candidate searches even when no impact occurs.

## Kernel time versus benchmark bookkeeping

Summed wall time across the 21 complete `benchmarkRigid` calls was 12.954 seconds.
Kernel API calls occupied 6.974 seconds (53.8%); work outside those calls occupied
5.979 seconds (46.2%). Kernel creation accounted for 1.248 seconds, generator
advancement for 5.719 seconds and generator closure for 0.007 seconds. These
include profiling effects, scheduling and the CPU cap, and exclude the quiet
windows, process startup and outer containment checks.

Exact-state capture/comparison accounted for 2,267 samples (39.9% of the complete
profile). Those checks remain required, but most of that work is outside the
original benchmark's timed stepping region. It therefore explains a large part
of full verification cost without explaining the entire earlier State Space /
MuJoCo stepping-time difference. Garbage collection had 225 separate samples
(4.0%); those samples are not assigned to a guessed allocating caller.

The wrapper recorded 3,402 kernel creations and 256,842 generator advances across
references, budget checks, restarts, cancellation, warmups and measured repeats.
The resting stack contributed 182,950 of those advances. Counts are consistent
with the unchanged orchestration: 13 complete trajectories, two partial restarts
and one cancellation per row. They do not by themselves establish generator
dispatch as the cause of the measured cost.

There were 44 sampling intervals longer than 10 ms, with a maximum of 331.691 ms.
They remain in the raw profiles. The analysis uses sample counts rather than
attributing these gaps to the last sampled function as continuous CPU execution.
The single capped cohort does not qualify normal throughput or establish an
optimization speedup.

## What to investigate next

The source explains why copying appears during both creation and advancement:
`createRigidStep3D` copies input parcels and calls `readParcel`, which copies again;
assembly admission calls mass-property and parcel readers that perform further
portable-data copies. These paths are in
[rigid.ts](../engine/experimental/multiphysics/rigid.ts),
[portable-data.ts](../engine/portable-data.ts), and
[conservation.ts](../engine/experimental/multiphysics/conservation.ts).

The first optimization candidate is reducing repeated copies/admission work on
data already owned and validated within a step. Public input isolation, rejection
of malformed values, ordering, cancellation, complete receipts and exact replay
must remain intact. A second candidate is contact-solver work in resting stacks,
guided by the existing deterministic work counters and another bounded profile.
The current evidence does not justify changing time-of-impact handling, lowering
solver limits, or removing replay checks. No optimization was implemented here.

The subsequent [owned-data optimization](COLLISION_OWNED_OPTIMIZATION.md) implements
the first candidate and uses new contained differential checks and fresh baseline
controls. The profiling measurements on this page remain the pre-change evidence.

All startup/cancellation/supervisor-loss checks passed. Cancellation emptied its
Job in 2.200 seconds; independently observed supervisor-loss recovery took 2.991
seconds, watchdog reason 1, with watchdog/leaf exits 125. All named Jobs are absent,
no execution lock remains, and the hold, original failed GPU report and protected
worktree were preserved. Static checks passed 19 Python tests and 23 Node tests;
Python lint passed. No GPU query, browser or graphics workload ran.

Local evidence (raw dist artifacts are ignored by Git):

- [Corrected profile analysis](../dist/verification/collision-cpu/08671da1aaee4938bbe174b168fb6fca/profile-analysis.json)
- [Raw collector summary and profile paths](../dist/verification/collision-cpu/08671da1aaee4938bbe174b168fb6fca/profile-summary.json)
- [Immutable review](../dist/verification/collision-cpu/08671da1aaee4938bbe174b168fb6fca/review.json)
- [Analysis source](../scripts/analyze_collision_profile.mjs)

The corrected analysis is the source for the tables above. It identifies 615
kernel samples whose stacks omitted the named wrapper. Both the initial
wrapper-only attribution and the unchanged raw profiles remain available.

## Fixed method

The profiling recipe uses the exact engine bundle from the completed
[collision comparison](COLLISION_REFERENCE_RESULTS.md): SHA-256
`1ad2665bec3d972673ddcddf0b505f25cff9ee47e7938d30a57b687777d8a196`.
It binds the original comparison JSON by SHA-256
`c3472c0695a57016108eacf9c05bc6b5cb168f8f6e87c1d368d85fdb0a4e84ff`.
The original benchmark implementation, fixtures and protocol are unchanged.

Every new review must pass normal startup, exact-Job cancellation, independently
observed supervisor loss, and the full LEG-WORKER world replay before any rigid
fixture. Seven State Space fixtures then run at dt 16, 8 and 2 ms. MuJoCo is not
rerun for this State Space profiling task. Each row retains the existing two
warmups/seven measured repetitions, budgets 1/7/256, lossless and JSON restart,
input isolation, complete receipts and cancellation checks.

After each profiled row, the complete lossless state encoding, work counts,
observations and replay results must match the original completed row. Float64
bits, including signed zero, are compared through the lossless encoding;
ordinary JSON's illustrative numeric values are not the authority for exact
state. A failure stops dependent work and is retained.

The profiler observes the existing API without changing its calculations:

- Wall clocks bracket `createRigidStep3D`, generator `next`, and generator
  `return`. Original arguments, receiver, results and exceptions are forwarded.
- A separate clock covers the full `benchmarkRigid` invocation. The remainder
  outside those API calls includes evidence capture, exact comparisons, replay
  orchestration, observation extraction and instrumentation overhead.
- V8 samples stacks at a requested 1,000 microsecond interval for each complete
  benchmark row. All raw `.cpuprofile` files are retained, including long
  scheduling intervals and garbage-collection samples. Per-row output is bounded
  to 16 MiB; no heap snapshot or extended stress workload is requested.

The in-process [Node Inspector Session](https://nodejs.org/docs/latest-v22.x/api/inspector.html#cpu-profiler)
starts only after live Job membership is attested. It opens no listener, port,
browser or external debugger. An already-open inspector listener is rejected.
The session is stopped and disconnected on success or failure.

## Interpretation

The original benchmark's timed region contains kernel creation and advancement.
It excludes most exact evidence/replay bookkeeping. A hotspot in the complete
profiling run therefore does not automatically explain the earlier stepping
timings. Both scopes must be reported separately.

Wall clocks include scheduling, throttling and instrumentation. Process CPU
counters include the Node process and its threads. Sample counts identify
frequently observed call stacks; they are not exact CPU-time percentages.
Inclusive function counts overlap and must not be summed as disjoint costs.
Long sampling gaps are retained rather than charged to the last sampled function
as if the process were executing for the entire gap.

Generated function start lines are mapped to the frozen esbuild bundle's module
boundaries. Reported generated lines refer to that bundle, not original TypeScript
line numbers. Work phase counts remain work counts; a yield label is not used as
a timer for a whole collision algorithm.

Some observed stacks omit the named profiling wrapper while retaining the rigid
generator. The raw collector preserves its initial wrapper-based attribution.
The final data-only analyzer also recognizes `createRigidStep3D` and the `run`
generator in the rigid module, and records how many samples needed this fallback.
Engine frames outside recognized stepping roots remain separate. Synthetic
checks require equivalent attribution with and without a wrapper. This correction
changes neither raw measurements nor the executed workload.

## Safety and reproducibility

The [CPU scope](COLLISION_CPU_SCOPE.md) retains the 6% aggregate Windows Job CPU
cap, 4 GiB Job memory, 25-second supervisor deadline, 30-second independent
watchdog, 30 consecutive quiet seconds, at least 8 GiB available RAM, and existing
host-health aborts. The 90-second preflight observation deadline is unchanged.
There are no caller-supplied commands, sampling budgets or workload extensions.

The generic hold remains `blockRecovery: true`, with no recovery permit. GPU and
browser workloads remain blocked. All runtime, performance, GPU, native Worker
and R1 acceptance flags stay false. CPU profiling does not resolve the Windows
freeze cause or fulfill the multi-session performance qualification protocol.

Preparation is static and requires a fresh destination. Use the base Python 3.13
executable already bound by the CPU scope:

```powershell
node scripts/benchmark_collision_reference.mjs prepare --output dist/verification/NEW_PROFILE_BENCHMARK
& $basePython -B scripts/verify_collision_cpu.py --prepare-profile dist/verification/NEW_PROFILE_BENCHMARK
& $basePython -B scripts/verify_collision_cpu.py --packet dist/verification/collision-cpu/REVIEW_ID --case startup-close
```

Follow the exact cases in the review, stopping on a nonzero exit. Preserve quiet
refusals before retrying an unattempted stage. Never rerun an attempted stage or
remove a retained execution lock. Aggregate existing artifacts without executing
physics:

```powershell
node scripts/collision-reference/collect-profile.mjs dist/verification/collision-cpu/REVIEW_ID
```

Prior scope/controller/test versions were preserved against the completed review
hashes in `dist/verification/collision-profile-review-20261108` before adding the
fixed profiling recipe. Earlier measured packets and failed attempts are retained.
