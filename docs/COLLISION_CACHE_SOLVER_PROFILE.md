# Contact and solver profile with the denominator cache

This investigation profiles the unchanged cached engine to identify the next
optimization. It implements no new engine optimization and preserves the
time-of-impact algorithm, exact replay, work/yield boundaries and qualification
requirements.

The identified cache has since been implemented and checked in a separate
[contact-offset comparison](COLLISION_OFFSET_CACHE.md). That follow-up confirms
474,192 fewer subtractions and exact replay, with mixed timing results. The
profile and recommendations below retain their original denominator-cache scope.

## Findings

The next candidate is a **private, per-contact cache of the two
`point - body.center` vectors within one solve**, reused by relative velocity,
impulse application and effective response. The engine is unchanged; this is a
recommendation for a separate implementation and exact-replay comparison.

Review `cf46c60fbee34dfb8860326a6d27976c` completed all ten stages, nine sampled
profiles, one separate coverage run and ten exact-replay rows. All 108 ownership
and contact checks and the full world replay passed. There are 63 sampled-run
timing repetitions plus seven coverage repetitions; the latter are excluded
from performance interpretation.

The nine profiles contain 3,320 samples: 1,751 recognized engine samples, 1,326
exact-state harness samples, 142 GC samples, ten engine samples outside recognized
steps and 91 other/harness/profiler samples. Exact-state encoding remains outside
the benchmark timing boundary. The table uses **inclusive stack sample shares**,
not CPU-time percentages; rows overlap.

| Work visible on a stack                       | Current samples | Current share | Pre-cache share |
| --------------------------------------------- | --------------: | ------------: | --------------: |
| Contact solve, including contact construction |             827 |         47.2% |           53.1% |
| Contact geometry across phases                |             350 |         20.0% |           17.1% |
| Relative/point velocity                       |             244 |         13.9% |           11.6% |
| Owned-data admission/physical validation      |             241 |         13.8% |           13.5% |
| Portable copying                              |             185 |         10.6% |           11.0% |
| Impulse application/receipt updates           |             183 |         10.5% |           10.8% |
| Time of impact                                |             133 |          7.6% |            5.8% |
| Geometric projection                          |             114 |          6.5% |            5.6% |
| Effective-mass response                       |              26 |      **1.5%** |       **11.3%** |

The effective-response reduction is consistent with the confirmed 93% call-count
reduction. The higher shares of other categories do not establish regressions:
the denominator and JIT/inlining distribution changed, and these are separate
sampling cohorts. The profile does not establish an overall speedup.

Within the 827 solver samples, disjoint attribution is relative motion 234,
geometry 200, impulse updates 180, unresolved/inlined 187 and effective response 26. Relative motion plus impulse updates account for **414/827 (50.1%)** of
solver samples. Only a subset of that work is the proposed cache target.
`pointVelocity` has 122 self / 202 inclusive samples and `apply` has 73 self /
166 inclusive samples. Standalone `subtractVec3` has 22 self samples, but inlined
work cannot be separately assigned; the cache must not be advertised as removing
the full cost of either helper.

Across the three passes, solver share is 46.8%, 46.2% and 48.7%, while effective
response is 1.0%, 1.6% and 1.9%. At 2 ms alone the solver is 585/1,198 (48.8%)
recognized engine samples. There are 24 sampling intervals over 10 ms, with a
maximum of 367.700 ms. The short-interval sensitivity view changes solver share
only from 47.23% to 47.27% and effective response from 1.48% to 1.49%. All raw
samples and long intervals remain retained.

## Exact counts and next optimization

The separate full-workload 2 ms coverage pass confirmed all selected helper counts
against the previous cached run. It retains 357 created / 356 completed steps,
1,068 solves, 8,544 constructed contacts, 15,308 iteration bodies and 122,464
contact-iteration visits. `effective` runs 8,544 times; friction disk solving
runs zero times. Relative velocity runs 145,248 times, point velocity 315,772,
angular velocity 325,028, impulse application 244,928 and receipt recording
247,064. Of the impulse applications, 183,696 update a dynamic body and 61,232
take the anchored branch.

These counts identify repeated fixed geometry inside the remaining hot helpers:

| Contact-offset use                               | Current vector subtractions |
| ------------------------------------------------ | --------------------------: |
| Two point-velocity calls per `relative(c)`       |                     290,496 |
| Dynamic-body angular impulse update              |                     183,696 |
| Two offsets per cached normal effective response |                      17,088 |
| **Total targeted expressions**                   |                 **491,280** |

Two offsets for each of 8,544 contacts would require **17,088 evaluations**.
Reusing them could remove **474,192 repeated evaluations (96.5% of these targeted
expressions)**. This excludes other point-velocity calls in contact construction,
TOI and synchronization. It is a source-level operation/vector-construction
estimate, not a measured speedup or heap-allocation count; V8 may already remove
some allocations.

The [current rigid solver](../engine/experimental/multiphysics/rigid.ts) keeps
contact points and body centers fixed within `solve`. `apply` changes velocities
and angular momenta; drift and geometric projection change centers outside that
solve. This gives the offsets the same narrow lifetime as the normal denominator.
Geometry is also a substantial cost, but caching across geometry/TOI/projection
phases would require additional invalidation paths. The contact offsets provide
a smaller next scope supported by both sampling and execution counts.

Implementation requirements for that candidate:

- Cache only the original componentwise `subtractVec3(point, body.center)`
  results, privately per contact. Preserve first-use/post-yield evaluation order
  and signed-zero behavior. Keep the general point-velocity path used by contact
  setup, TOI and synchronization unchanged.
- Reuse the offsets without reassociating subsequent matrix, cross, scale, add
  or dot arithmetic. Velocity, angular momentum/`omega`, impulses, friction work
  and convergence remain live. Do not skip zero impulses or reduce iterations.
- Preserve **world-space points** in `record` and boundary angular receipts:
  `cross(point, impulse)` must not become `cross(point - center, impulse)`.
- Create fresh caches for every solve, including after drift/projection,
  rollback trials and new generator jobs. Do not expose them in public state,
  receipts or either restart format.
- Require complete bit-exact differential states/receipts, work and cancellation
  boundaries, rejection/input-isolation checks, all collision fixtures/timesteps,
  and fresh contained timing controls before accepting the implementation.

The zero-friction stack gives no execution evidence for a tangent/friction
performance change. Keep that algorithm and all TOI/admission rules intact.

## Fixed experiment

The measured bundle remains
`44a000628cfe99134fbf3cb39cd6a431f826bc3212560524d396bf54445e7de7`.
All engine files, replay/benchmark code, differential suites and the sampling
attribution method are pinned to the completed denominator-cache comparison.
The ten sequential stages retain three containment probes, 71 ownership checks,
37 contact-cache checks, full world replay, three sampling passes and one
separate precise-coverage pass.

Each sampling pass runs the unchanged resting-stack benchmark at 16/8/2 ms:
the full 48 ms trajectory, budgets 1/7/256, both restart formats, cancellation,
two warmups and seven measured repetitions. Every state, receipt, diagnostic and
work count must match the completed exact baseline.

Sampling uses a private in-process Node Inspector Session at the existing 1 ms
requested interval. It opens no listener or browser. Counts are attributed by
stack and generated bundle source boundaries. Inclusive categories overlap;
the solver breakdown uses the nearest recognized helper and explicitly retains
unresolved/inlined samples. Long elapsed sampling gaps never become attributed
CPU time. The full evidence and the existing at-most-10-ms sensitivity view are
both retained, following the [outlier investigation](COLLISION_CACHE_TIMING.md).
The profiler follows the pinned
[Node 22.22.3 Inspector API](https://nodejs.org/download/release/v22.22.3/docs/api/inspector.html#cpu-profiler).

The separate 2 ms precise-coverage pass measures calls and blocks for the full
replay/warmup/measurement workload. It disables optimized execution, so its
timings are not performance evidence. Selected helper counts must match the
completed cached baseline, including 8,544 normal effective-mass calls. The
historical pre-cache profile is retained for descriptive sample-share comparison;
different sampling totals and JIT/inlining prevent treating differences as a
measured speedup.
The [bundled V8 protocol](https://github.com/nodejs/node/blob/v22.22.3/deps/v8/include/js_protocol.pdl)
specifies that precise coverage prevents optimized execution and resets counters.

## Safety and qualification

The limits remain 6% aggregate Job CPU, 4 GiB, below-normal priority, single-thread
dependencies, 25 s supervisor/30 s independent watchdog, 3 s heartbeat and 22 s
Node leaf wait. Each stage requires 30 consecutive quiet seconds at host CPU at
most 30% and at least 8192 MiB free RAM within the existing 90 s preflight.
Health aborts, exclusive lease, retained-handle cleanup and named-Job absence
checks remain enforced. Profile artifacts retain the existing 16 MiB bound.

GPU/browser workloads, GPU queries and generic runtime verification remain held.
The Windows incident hold stays `blockRecovery: true` with no recovery permit.
The original failed GPU receipt and protected performance worktree are preserved.
Runtime, performance, GPU, Worker and R1 acceptance remain false.

## Validation and evidence

Static preparation passed ten Node source/data tests, 36 mocked Python
scope/cleanup checks, JavaScript syntax checks and Python lint. The collector
verified the fixed sequence, all states/receipts, diagnostics, work counts,
coverage identity, source hashes and cleanup reports.

All stages passed their full quiet windows and all owned Jobs were emptied and
confirmed absent. No execution lock remains. Cancellation cleanup took 2.203 s;
supervisor-loss cleanup took 2.942 s. Peak observed runtime host CPU was 52.67%,
below the unchanged health-abort threshold; runtime readings do not change the
separate 30% quiet-admission rule. The original GPU failure, incident hold and
protected worktree remain preserved, with all acceptance flags false.

The exact 2 ms digest remains
`89890909f934239cd42e1c425b4df83022cf61eaf8067b969cb4dcc5db79064e`, with 72 assembly,
144 sweep, 8,616 contact and zero fracture work units per 48 ms trajectory.

- [Checkpoint and source bindings](checkpoints/COLLISION_CACHE_SOLVER_PROFILE.json)
- [All profiles, coverage, replay rows and containment receipts](../dist/verification/collision-cpu/cf46c60fbee34dfb8860326a6d27976c/solver-profile-summary.json)
- [Candidate calculation, per-pass shares and helper counts](../dist/verification/collision-cpu/cf46c60fbee34dfb8860326a6d27976c/solver-candidate-analysis.json)

Benchmark packet `dist/verification/collision-cache-solver-profile-20261109`
has SHA-256 `51a913f734d3ff3ddc0f81ac7a14a71df2bcb65782ac27f2fc3214cccffc090b`.
The review SHA-256 is
`1714857596a2276214bb3b8e8e277047ecec0031da7bbfe155ab6b53029bf85f`.
Raw artifacts are local and ignored by Git; retain them with the checkpoint.

A fresh packet uses `--prepare-cache-solver`; only the ten fixed cases are
permitted. `scripts/collision-reference/collect-cache-solver-profile.mjs` collects
the retained evidence without executing either engine. Attempted stages are not
reused or automatically retried.
