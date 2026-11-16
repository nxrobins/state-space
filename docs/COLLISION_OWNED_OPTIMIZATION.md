# Rigid admission optimization and CPU comparison

This change targets the defensive-copy and admission costs found in the
[CPU profile](COLLISION_CPU_PROFILE.md). It changes only
`engine/experimental/multiphysics/rigid.ts` in the engine. It preserves the
time-of-impact, integration, contact-solver and fracture calculations, the public
entry points, deterministic work counters and existing qualification gates.

## Completed results: November 8, 2026

The fresh review completed **19 stages, 63 comparison rows and 21 fresh baseline
controls**. All 71 boundary/ownership checks passed. All 21 optimized State Space
rows match both the historical baseline and the fresh original-engine control
exactly, including deterministic work counts. The full LEG-WORKER world replay
retains exact SHA-256 `14d562172192afc514d16b1728e414bed18683fac3901f9d47f0a17d42a5d029`.
All 42 MuJoCo integration states, model XML hashes, trajectories, replay receipts
and physical diagnostics match the original comparison.

All 21 State Space medians decreased. The geometric mean of the 21
baseline/optimized median ratios is **1.6705**, equivalent to **40.1% less median
time** by that aggregate. Individual median reductions range from 23.6% to 59.5%.
Each cell below shows fresh baseline → optimized median milliseconds per complete
48 ms trajectory, under the unchanged 6% aggregate CPU cap.

| Fixture | dt 16 ms | dt 8 ms | dt 2 ms | Geometric mean of median ratios |
| --- | ---: | ---: | ---: | ---: |
| Free drift | 1.328 → 0.786 | 2.590 → 1.367 | 8.864 → 4.614 | 1.832× |
| Thin wall | 5.986 → 4.079 | 9.851 → 5.552 | 28.221 → 16.966 | 1.630× |
| Occluded wall | 5.656 → 3.339 | 8.884 → 5.352 | 33.921 → 19.034 | 1.711× |
| Grazing clearance | 2.680 → 1.534 | 4.819 → 2.587 | 22.398 → 9.061 | 2.004× |
| Rotating plate | 6.449 → 4.772 | 8.030 → 5.489 | 25.239 → 13.841 | 1.533× |
| Impact chain | 10.693 → 6.007 | 14.788 → 10.455 | 51.525 → 23.684 | 1.763× |
| Resting stack | 8.398 → 6.401 | 15.110 → 11.495 | 55.538 → 42.450 | 1.312× |

These median improvements are not a tail-latency or normal-throughput claim.
Large samples remain in both cohorts: the baseline maximum was 362.025 ms and the
optimized maximum was 265.443 ms. In the 2 ms resting-stack row, a retained
249.806 ms optimized sample left the **mean worse: 55.889 → 71.978 ms**, despite
the lower median. Means decreased in the other 20 rows. The cause of individual
long samples is not established. All 588 measured samples in this fresh cohort
are retained; none was dropped or replaced.

The subsequent [stack timing investigation](COLLISION_STACK_TIMING.md) reproduced
long wall-time delays with little or no added CPU accounting and unchanged work.
It supports off-CPU waiting as the leading explanation for those new delays;
the exact cause of this original uninstrumented sample remains unknown. The
original timings and mean regression above remain unchanged.

The pattern is consistent with the earlier profile: removing repeated admission
helps every fixture's median, with a smaller relative effect in the resting
stack where contact work was prominent. This cohort does not isolate the saved
copy cost or establish a newly dominant bottleneck.

The rerun still shows a substantial end-to-end timing gap with MuJoCo. For the
matched thin-wall fixture:

| dt | Optimized State Space | MuJoCo discrete | MuJoCo speculative |
| ---: | ---: | ---: | ---: |
| 16 ms | 4.0794 ms | 0.0104 ms | 0.0239 ms |
| 8 ms | 5.5519 ms | 0.0217 ms | 0.0476 ms |
| 2 ms | 16.9661 ms | 0.0893 ms | 0.1218 ms |

The timing boundaries and contact laws differ as described in the
[original results](COLLISION_REFERENCE_RESULTS.md); these values cannot isolate
solver speed. The physical outcome is unchanged: State Space passes 12
analytical/barrier checks, each MuJoCo mode passes six and fails six strict
barrier checks, and nine rows per backend remain observational. State Space
still stops the thin-wall projectile at all three timesteps. MuJoCo discrete
still tunnels; speculative contacts still prevent full passage but fail the
strict shallow-intrusion tolerance. No failed diagnostic was relabeled.

Containment cancellation emptied its Job in 2.150 seconds, and independent
supervisor-loss recovery took 3.002 seconds. All named Jobs are absent and no
execution lock remains. Every stage preserved the hold bytes, original failed
GPU receipt, bound sources and protected worktree. All runtime, performance,
GPU, Worker and R1 acceptance flags remain **false**.

Validation also passed 25 static/synthetic Node checks, 22 Python scope tests,
Python lint, the targeted strict TypeScript 6.0.2 bridge typecheck, formatting
checks and `git diff --check`. No general runtime, browser or GPU suite was run.

Evidence:

- [Source-bound checkpoint](checkpoints/COLLISION_OWNED_OPTIMIZATION.json)
- [Full comparison](../dist/verification/collision-cpu/b35049763d24429e86685ce0c0c6ba1d/comparison.json)
- [Fresh baseline controls and timing summary](../dist/verification/collision-cpu/b35049763d24429e86685ce0c0c6ba1d/optimization-summary.json)
- [71 differential checks](../dist/verification/collision-cpu/b35049763d24429e86685ce0c0c6ba1d/ss-owned-regression/result.json)

The checkpoint binds benchmark packet SHA-256
`a8eee9fc652c10c44601f7cd81424d8c172c7342a8572355b42953ce8ab86a6c`,
review SHA-256 `1886fc9437e558b8d0e74f1d1fa731e91b0761bc9536b81242cc953d88c234f4`
and comparison SHA-256 `0be7ab135074ab762112db58b23af9fcd107198ca2544307fd50b8579806118b`.
Raw `dist` artifacts are local and ignored by Git; retain them with the checkpoint.

## Implementation

`validateOwnedParcel` checks parcel fields after its caller has acquired a
portable-data copy. `admitAssembly` keeps the public assembly readers' bounded
ownership/admission boundary. Two private helpers compute mass properties and
validate assembly motion from the resulting canonical, sorted, unique parcels.

`createRigidStep3D` still owns raw parcels, bonds, anchors and options before it
returns a generator. It still validates parcel/material fields, identities,
geometry, options and bond references. Its assembly loop now uses its already
owned and admitted members directly, avoiding repeated portable copies and
repeated parcel admission. The motion and stationary-anchor checks and arithmetic
order remain intact. Final output parcel validation remains in place.

The new helpers are private to the rigid module. They provide no unchecked public
entry point. The existing assembly readers continue to copy caller input,
validate it, sort IDs and reject duplicates before calling internal arithmetic.
Extra portable fields, canonical key order, input isolation and existing error
messages are retained by the differential checks.

Static TypeScript AST checks compare the pre-change and changed source for
`translationImpact`, `boundedContactAdvance`, `contactWithinTolerance`, `manifold`,
`effective`, `nextImpact`, `solve`, `project`, `kick`, `drift` and `restoreTrial`:
their function text is unchanged. The set of exported rigid functions is also
unchanged. The private benchmark bridge exposes existing assembly readers only
for the contained differential checks; package exports are unchanged.

## Fixed validation and benchmark recipe

Review `b35049763d24429e86685ce0c0c6ba1d` uses benchmark packet
`collision-reference-owned-20261108`. The new recipe has 19 sequential stages:
three containment probes, a targeted boundary/ownership regression stage, the
full LEG-WORKER world replay, then the original seven paired State Space/MuJoCo
fixtures. Every stage needs all earlier successful receipts from the same review.

The regression stage compares against a statically bundled, frozen copy of the
pre-change rigid module. It covers public mass-property and motion readers,
rigid stepping, extra fields and signed zero, malformed values, hidden fields,
accessors without getter execution, sparse/cyclic data, duplicate IDs, bounds,
moving anchors and non-rigid bonds. It also mutates caller data before/after a
progress yield and checks cancellation and returned-data isolation.

The world replay must match the original complete lossless baseline. Each State
Space row runs both the frozen original engine bundle and the changed bundle,
using the unchanged `benchmarkRigid` function. Baseline-first and optimized-first
order alternate by the fixed fixture/timestep indices. Each side retains all
original budget, restart, cancellation, isolation, warmup and repetition checks.
Complete states, receipts, deterministic work counts and observations must match
the historical baseline and each other before the row can complete.

The primary comparison remains 63 rows: seven fixtures, dt 16/8/2 ms, and three
backends. An additional 21 State Space baseline controls retain their own raw
results and timing samples. Every trajectory still covers 48 ms, with two warmups
and seven measured repetitions. No sample is discarded or replaced. MuJoCo's
versions, collision modes, contact parameters and integration-state replay
requirements are unchanged.

Both versions execute sequentially within the same owned Job; no extra parallel
load is launched. The 6% aggregate CPU cap, 4 GiB memory cap, 25-second supervisor,
30-second independent watchdog, 22-second Node-leaf wait, 30-second quiet window,
90-second preflight observation deadline and host-health aborts remain unchanged.
Exceeding a limit or failing exact equality stops the dependent sequence.

This is an unprofiled diagnostic comparison under the CPU cap. Fixed alternating
order and fresh controls improve the comparison with the older engine, but one
small cohort does not qualify normal throughput or fulfill the multi-session
performance protocol. Ratios summarize per-row medians, not guaranteed application
speedups. The incident hold stays `blockRecovery: true` and no recovery permit is
issued. Runtime, performance, GPU, native Worker and R1 acceptance remain false.

## Retained interrupted run

The first review, `c72b46a576bb4071b9d3ccf6a6582fff`, remains **incomplete**.
Thirteen stages passed, including all 71 regression checks and the full world
replay. It retained 36 comparison rows and 12 fresh baseline controls for free
drift, thin wall, occluded wall and grazing clearance; those State Space rows
matched the historical and fresh baselines exactly.

The controller aborted `ss-rotating-plate` when host CPU exceeded 85% for two
seconds. The receipt records readings up to 92.23%. Cleanup confirmed zero active
Job processes, disappearance of the named Job, no remaining execution lock and
unchanged hold, bound sources, original GPU failure and protected worktree. No
rotating-plate result was produced, and dependent stages were not launched.

An earlier 90-second quiet-window refusal before `mj-free-drift` is also retained.
The later workload abort was not treated as a preflight refusal or retried in
place. The fresh review uses the identical benchmark packet and unchanged limits,
starts again with containment probes, and keeps its measurements separate. A
later low-CPU process snapshot did not establish the cause of the earlier spike.

Retained evidence: [incomplete comparison](../dist/verification/collision-cpu/c72b46a576bb4071b9d3ccf6a6582fff/comparison.json),
[host-load abort and cleanup](../dist/verification/collision-cpu/c72b46a576bb4071b9d3ccf6a6582fff/ss-rotating-plate/report.json),
and [quiet refusal](../dist/verification/collision-cpu/c72b46a576bb4071b9d3ccf6a6582fff/quiet-mj-free-drift-refused-01.json).

## Reproduction

The prior rigid source, private bridge and scope/controller/test files are
preserved in `dist/verification/collision-owned-review-20261108`. Its baseline
manifest binds the pre-change rigid bundle and source graph. The completed
comparison and profiling packets remain retained.

```powershell
node scripts/benchmark_collision_reference.mjs prepare --output dist/verification/NEW_OWNED_BENCHMARK
& $basePython -B scripts/verify_collision_cpu.py --prepare-optimization dist/verification/NEW_OWNED_BENCHMARK
& $basePython -B scripts/verify_collision_cpu.py --packet dist/verification/collision-cpu/REVIEW_ID --case startup-close
```

Follow the review's fixed cases, stopping on nonzero exit. Preserve quiet refusals
before retrying an unattempted stage. An attempted stage is never reused, and an
unresolved cleanup lock cannot be removed to advance work. After completion,
collect retained evidence without executing either engine:

```powershell
node scripts/collision-reference/collect-optimized.mjs dist/verification/collision-cpu/REVIEW_ID
```
