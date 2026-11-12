# Normal effective-mass cache

The normal contact denominator is now computed once per contact per solve. It
uses the original `dotVec3(c.normal, effective(c, c.normal))` expression, after
the same progress yield and relative-velocity calculation. A private
`number | undefined` field and nullish assignment preserve zero/signed-zero
values. Every solve creates fresh contacts, so drift, geometric projection,
rollback trials and new generator jobs cannot reuse an earlier solve's cache.

Time-of-impact code, tangent/friction calculations, impulse and energy receipts,
iteration/convergence rules, progress yields, public input ownership and replay
formats are unchanged. No cache field is returned in public state or receipts.
The source-level proof removes just the field, initialization, comment and
nullish assignment and requires the entire remaining file to equal the frozen
pre-cache source. This preserves the previous owned-data optimization.

## Frozen comparison

Benchmark packet: `dist/verification/collision-normal-cache-20261109-v3`.
CPU review: `e3e46c48e46847a19a50477dee6c5f61`.
The fresh control is the previously measured owned-data engine bundle
`864cc291fc75ebfce7d6d53e6c15d1b13736679d0540c80c496298e991b19694`.
Thus any measured change here is incremental to that earlier optimization.

The fixed 21-stage sequence consists of three containment probes, 71 ownership
differential checks, 37 additional contact-cache differential checks, world
replay, 14 fixture stages (seven State Space/MuJoCo pairs), and one separate
call-count stage. Each State Space fixture runs both old and cached engines with fixed
alternating order at 16/8/2 ms, two warmups and seven repetitions. The original
budgets 1/7/256, complete exact-state/receipt comparisons, both benchmark restart
formats, cancellation, diagnostics and deterministic phase work are retained.

The additional checks cover sliding friction, inclined support, a frictional
stack, off-center rotated impact, a rotating rod reaching a floor, and geometric
projection. They compare full results and every progress yield across work
budgets, lossless continuation, JSON restart behavior, cancellation/retry, and
work/iteration/penetration rejections. Their signed-zero extension also checks
that the existing JSON normalization behavior is identical before and after;
the lossless route must equal uninterrupted execution. This does not change the
original benchmark's exact JSON restart requirements.

Progress is represented losslessly as consecutive runs of phases. Every original
yield must have exactly the original `phase`/`work` fields in order, a registered
phase and the next consecutive work number. Each run stores its phase, first
work number and length. Full sequence and cancellation-prefix equality therefore
preserve every yield, while avoiding a large duplicated encoded string inside
diagnostic snapshots. Exact-state size limits and the original replay harness
remain unchanged.

Precise coverage ran separately from timing. It confirmed normal `effective`
calls falling from 122,464 to 8,544 in the full 2 ms workload while the other
selected helper counts, exact state and phase work remained unchanged.
Coverage disables optimized execution, so its timings are excluded from
performance conclusions. This follows the [previous profile](COLLISION_STACK_SOLVER_PROFILE.md).

## Results

The subsequent [outlier investigation](COLLISION_CACHE_TIMING.md) is complete.
It reproduced a 234.856 ms cached step dominated by uncharged elapsed time, with
no recorded GC overlap. It retains the original measurements below and does not
retroactively assign the original 234.476 ms sample's cause.

The fresh review completed all **21 stages**, **63 comparison rows**, **21 fresh
pre-cache controls**, **71 ownership checks** and **37 contact checks**. It retains
588 benchmark timing samples plus seven separate coverage timings. All complete
State Space states/receipts, work, replay, trajectories and diagnostics match both
the historical owned-data engine and fresh controls. The world replay also
matches. All 42 MuJoCo integration states, replay outcomes, trajectories, model
hashes and derived diagnostics match the previous comparison.

The cached engine bundle is
`44a000628cfe99134fbf3cb39cd6a431f826bc3212560524d396bf54445e7de7`.
It is identical across all three attempts; both repairs were confined to
diagnostic recording/collection. The [checkpoint](checkpoints/COLLISION_NORMAL_CACHE.json)
binds the complete evidence and source versions.

Median kernel times below are for a **48 ms simulated resting-stack trajectory**,
with seven repetitions per implementation and timestep:

| Timestep | Pre-cache median | Cached median | Median reduction |
| -------- | ---------------: | ------------: | ---------------: |
| 16 ms    |         8.696 ms |      7.491 ms |            13.9% |
| 8 ms     |        13.590 ms |     10.053 ms |            26.0% |
| 2 ms     |        45.622 ms |     41.212 ms |             9.7% |

The geometric mean of the three stack median ratios is 1.202 pre-cache/cached,
equivalent to 16.8% less time on that summary measure. Across all 21 State Space
rows the result is mixed: 11 medians decrease and 10 increase, with geometric-mean
ratio 1.013 (1.3% less time). Free drift and grazing clearance improve on their
per-scene summaries; thin wall, occluded wall, rotating plate and impact chain
are slower on those summaries. This is a targeted stack improvement, not evidence
of a general engine speedup.

All timing tails are retained. At 2 ms, the cached cohort contains a **234.476 ms**
sample, so its mean increases from **47.206 to 67.787 ms** despite the lower
median. The pre-cache 16 and 8 ms cohorts also contain long samples (402.191 and
323.314 ms). This run does not have per-step CPU/GC clocks and cannot assign the
new tail to scheduling, GC or engine work. The prior
[timing investigation](COLLISION_STACK_TIMING.md) does not establish this sample's
cause. No samples, thresholds or repetitions were changed to improve the result.

The isolated count check confirms **113,920 fewer normal effective-mass calls
(93.0%)**. The complete 2 ms state digest remains
`89890909f934239cd42e1c425b4df83022cf61eaf8067b969cb4dcc5db79064e`, with 72 assembly,
144 sweep, 8,616 contact and zero fracture work units per trajectory. Relative
velocity, impulse, receipt, contact geometry and other selected helper counts
match the pre-cache coverage run exactly. The coverage timing is excluded from
the comparison above.

Physical diagnostic outcomes are unchanged: State Space has 12 passing checks
and nine observational rows. Each MuJoCo mode has six passing checks, six failed
strict barrier checks and nine observational rows. Completion of the comparison
does not convert these outcomes into qualification.

All owned Jobs were emptied and confirmed absent; no execution lock remains.
Cancellation cleanup took 2.139 s and supervisor-loss cleanup 2.994 s. Peak
observed host CPU during runtime was 64.20%, below the unchanged health-abort
threshold; each stage separately passed its full quiet window before launch.

Static preparation passed TypeScript checking, 15 Node source/data checks,
30 Python scope/cleanup tests, JavaScript syntax checks and Python lint. The
historical ownership/profile source proofs now reference the retained pre-cache
source; the new whole-file proof links that source to the current engine.

Post-run collection also required a data-only correction: raw MuJoCo rows do not
contain `diagnostic`, which the report assembler derives. The corrected collector
uses the unchanged, pinned `evaluate(scene, trajectory)` function and compares
its result against the historical diagnostic. It preserves the other checks and
all raw data. The bound collector, repaired collector, source verification record
and current correction are hashed in the checkpoint; no runtime stage was rerun
or reclassified for this collection fix.

## Earlier attempts retained

Review `e6b12ca962f34f29906ef80c41076d57` retained two prelaunch quiet-window
refusals. After other CPU-heavy work was paused it passed containment and the
71 ownership checks, then stopped on the new frictional-stack diagnostic.
Review `bf1908c2518840c4a0117a01c5025ecd` repeated the prerequisites and retained
the detailed old/new failure. Both engines completed the first step with 31,096
work units, then the diagnostic recorder exceeded the exact-state character
bound while duplicating its stored progress trace. This was a recorder failure;
it was not a physics exception or a change to the cache.

Both reviews remain failed/incomplete with zero benchmark rows. Their raw
results, cleanup receipts, source versions and quiet refusals are retained.
Every attempted Job was emptied and confirmed absent. The lossless progress
encoding fixes only that diagnostic storage issue; it does not increase a bound
or convert either failed review to a pass. The current review reruns all
containment and replay prerequisites from scratch.

## Safety and qualification

All limits remain unchanged: 6% aggregate Job CPU, 4 GiB, below-normal priority,
single-thread dependencies, 25 s supervisor/30 s independent watchdog deadlines,
3 s heartbeat and 22 s Node leaf wait. Every stage requires 30 consecutive quiet
seconds at host CPU at most 30% and at least 8192 MiB free RAM within the existing
90 s preflight. Host-health aborts, exclusive lease, retained process-handle
cleanup and named-Job absence checks stay enforced.

The Windows incident hold remains `blockRecovery: true`; the cause is still
undetermined. The failed GPU receipt and protected performance worktree remain
preserved. GPU/browser workloads and generic runtime verification remain held.
This diagnostic comparison grants no runtime, performance, GPU, Worker or R1
acceptance, even if all replay and physical checks pass.
