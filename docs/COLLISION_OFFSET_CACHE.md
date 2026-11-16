# Contact-offset cache and CPU comparison

The separate [timing investigation](COLLISION_OFFSET_TIMING.md) follows the 8 ms
regression and 181 ms outlier recorded here. It finds order-sensitive 8 ms timing
and off-CPU dominated reproduced spikes, while leaving this comparison, its
samples and the engine unchanged. The original sample's exact cause remains unproven.

Each contact now owns two lazy `point - body.center` vectors for one solve.
The original componentwise subtraction occurs at its first existing use, after
the same contact yield, in B-then-A point-velocity order and after each `omega`
calculation. Subsequent relative-velocity, effective-response and dynamic impulse
updates reuse those private vectors. The general point-velocity path used by
contact construction, time of impact and synchronization is unchanged.

Every solve constructs fresh contacts with undefined offsets. Drift, projection,
rollback and new jobs cannot reuse an earlier solve's cached geometry. Velocities,
angular momenta, normal/tangent impulses, friction work, convergence and receipts
remain live. There is no arithmetic reassociation, zero-impulse shortcut, changed
yield or public state/restart field. External and anchored angular receipts still
use `cross(point, impulse)` in world coordinates.

The [cached-solver profile](COLLISION_CACHE_SOLVER_PROFILE.md) identified 491,280
targeted offset evaluations in the full 2 ms workload. The separate coverage pass
confirmed that two offsets for each of 8,544 contacts require 17,088 evaluations,
removing **474,192 redundant evaluations (96.5% of the targeted expressions)**.
Total `subtractVec3` calls fell from 816,664 to 342,472, exactly the predicted
difference. Other selected solver/helper counts and replay remain unchanged.
Coverage timings are excluded because precise coverage disables optimized
execution; these counts are not a measured heap-allocation reduction.

## Results

Review `3de856c150ea41ac9de0e8b9601d341e` completed all 21 stages: 63 comparison
rows, 21 fresh denominator-cache controls, 108 differential checks, full world
replay and the separate coverage check. All 588 benchmark timing samples and
seven separate coverage samples are retained.

Resting-stack elapsed times below cover the **complete 48 ms simulated trajectory**,
not one engine step. Each median is from seven unprofiled measurements under the
unchanged CPU cap.

| Timestep | Denominator-cache median | Offset-cache median | Median change |
| -------- | -----------------------: | ------------------: | ------------: |
| 16 ms    |                 8.199 ms |            7.750 ms |    5.5% lower |
| 8 ms     |                 9.553 ms |           11.933 ms |  24.9% higher |
| 2 ms     |                35.356 ms |           34.067 ms |    3.6% lower |

This is a mixed timing result. Fourteen of the 21 State Space medians were lower
and seven higher; the geometric mean of control/new median ratios was 1.0065,
near parity (about 0.6% lower elapsed time). For resting-stack alone that ratio
was 0.9579, about 4.4% higher elapsed time across its three rows. The 8 ms
regression is retained and unresolved by this uninstrumented cohort.

The new 2 ms stack row includes a **181.190 ms** sample, versus a control maximum
of 37.895 ms. Consequently its mean rose from 35.626 to 55.281 ms despite the
lower median. The 16 ms means were 8.538 to 7.755 ms; the 8 ms means were 9.702
to 13.037 ms. No samples are removed. This run has no per-step CPU/GC clocks,
so it cannot assign the new long sample to scheduling, GC or engine work. The
earlier [outlier investigation](COLLISION_CACHE_TIMING.md) does not prove this
sample's cause. Reduced repeated work is verified; a general speedup is not.

Every State Space row matches both the stored denominator-cache result and its
fresh control exactly, including full states/receipts, trajectories, diagnostics,
deterministic work, replay, cancellation and restart checks. The 2 ms stack digest
remains `89890909f934239cd42e1c425b4df83022cf61eaf8067b969cb4dcc5db79064e`, with
72 assembly, 144 sweep, 8,616 contact and zero fracture work units per trajectory.

All MuJoCo integration states, replay, trajectories, model hashes and derived
diagnostics match the historical comparison. Physical diagnostic results are
unchanged: State Space has 12 passed and nine observational rows; each MuJoCo
mode has six passed, six failed strict-barrier and nine observational rows.
Passing the comparison/containment checks preserves those diagnostic failures;
it does not turn either engine's observational rows into qualification evidence.

## Fixed comparison

The control is the completed denominator-cache bundle
`44a000628cfe99134fbf3cb39cd6a431f826bc3212560524d396bf54445e7de7`.
The new recipe retains 21 sequential stages: three containment probes, 71
ownership checks, 37 contact-cache differential checks, full world replay,
seven State Space/MuJoCo fixture pairs, then a separate offset-count check.

Each State Space fixture runs both engines in the existing alternating order at
16/8/2 ms, with two warmups and seven measurements. Budgets 1/7/256, complete
exact states and receipts, both restart formats, cancellation, diagnostics,
trajectories and deterministic work must match the historical baseline and fresh
controls. The contact suite retains friction, inclined/stacked support, rotated
and angular impacts, geometric projection, cancellation/retry and rejection
checks. MuJoCo integration state, replay, trajectories, model hashes and derived
diagnostics must match the previous full comparison.

## Safety and qualification

The unchanged limits are 6% aggregate Job CPU, 4 GiB, below-normal priority,
single-thread dependencies, 25 s supervisor/30 s independent watchdog, 3 s
heartbeat and 22 s Node leaf wait. Each stage requires 30 consecutive quiet
seconds at host CPU at most 30% and at least 8192 MiB free RAM within 90 s.
Host-health aborts, exclusive lease, retained-handle cleanup and named-Job absence
checks remain enforced. Attempted stages are never reused or automatically
retried. No GPU/browser workload or GPU query is included.

The Windows incident hold stays `blockRecovery: true`, with no recovery permit.
The original failed GPU report and protected worktree remain preserved. Runtime,
performance, GPU, Worker and R1 qualification flags remain false.

## Validation and evidence

The implementation passed 12 source/data/synthetic-helper checks, 38 mocked
Python scope/cleanup checks, engine TypeScript checking, JavaScript syntax checks
and Python lint. The whole-file source proof limits the engine change to the
two caches and their three private solver uses. Historical source proofs now
reference the preserved denominator-cache source and compose with the new proof.

All executed stages passed their complete quiet windows and all owned Jobs were
emptied and confirmed absent. No execution lock remains. The first rotating-plate
preflight returned 75 after 90 seconds without a sufficient quiet window; no
workload launched. Its original receipt was preserved, and the absent stage
directory and locks were verified before resuming. No attempted stage was reused.
Cancellation cleanup took 2.148 s and supervisor-loss cleanup took 2.990 s.
Peak runtime host CPU was 64.02%, below the unchanged health-abort threshold;
this does not relax the separate 30% quiet-admission rule. Hold bytes, the
original failed GPU report, bound sources and protected worktree are preserved.

- [Checkpoint, source bindings and retained preflight refusal](checkpoints/COLLISION_OFFSET_CACHE.json)
- [Comparison and physical diagnostics](../dist/verification/collision-cpu/3de856c150ea41ac9de0e8b9601d341e/comparison.md)
- [Fresh timing controls and confirmed call counts](../dist/verification/collision-cpu/3de856c150ea41ac9de0e8b9601d341e/optimization-summary.json)

The new engine bundle SHA-256 is
`f64bf7fd75f878a3a82d3a9fabe50daa384087efcc12f1285a6e70972466efa8`.
Benchmark packet `dist/verification/collision-offset-cache-20261109` has SHA-256
`bf0268fe4e4a43cd01688d46d3ae7b87713ea7de28581222d58242b3cc0842ec`.
The review SHA-256 is
`c3bdc278cff89ff29b9cfbebbf54c62a5dd303731b30960ef0ec720144bf8b21`.
Raw artifacts are local and ignored by Git; retain them with the checkpoint.

A fresh packet uses `--prepare-offset-cache`; only the 21 fixed cases are
permitted. `scripts/collision-reference/collect-offset-cache.mjs` collects the
retained evidence without executing either engine. Runtime, performance, GPU,
Worker and R1 acceptance all remain false.
