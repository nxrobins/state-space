# Resting-stack contact and solver profile

This investigation profiles the current owned-data optimization without changing
the engine. It identifies a next optimization for a separate implementation and
exact-replay review. It does not grant runtime or performance qualification.

The subsequent [normal-denominator cache implementation and CPU comparison](COLLISION_NORMAL_CACHE.md)
are now complete; the results below remain the unchanged pre-cache profile.

The [new profile with the cache enabled](COLLISION_CACHE_SOLVER_PROFILE.md) now
identifies per-contact offset reuse as the next candidate. That follow-up keeps
this historical profile intact.

## Fixed experiment

The frozen benchmark packet is
`dist/verification/collision-stack-solver-profile-20261108`; CPU review
`1f8f93269a2e435d82004d20ed366e39` binds nine stages: three containment probes,
71 ownership differential checks, the production world replay, three separate
resting-stack sampling jobs, then one separate call-count job.

Each sampling job uses the unchanged 16/8/2 ms benchmark: the full trajectory,
budgets 1/7/256, repeated execution, both partial restart formats, cancellation,
two warmups and seven measured repetitions. The profiler wraps the existing
public generator API; it does not insert counters or yields into the engine.
Complete exact-state encodings, deterministic phase work, diagnostics and replay
results must match the completed owned-data baseline.

Node's private in-process Inspector Session samples at a requested 1 ms interval.
It opens no port or browser. Attribution uses generated bundle module boundaries,
recognizes rigid stepping even when V8 omits the observation wrapper, and retains
all raw samples. Long inter-sample gaps are never multiplied into function CPU
cost. A second view includes only intervals at most 10 ms as a sensitivity check.
Inclusive categories overlap; the disjoint solver breakdown assigns a sample to
the nearest recognized helper or leaves it explicitly unresolved/inlined.

The separate 2 ms precise-coverage job records function and block execution
counts. Precise coverage disables optimized code and resets counters, so its
timings cannot estimate optimized performance. Generator entry counts alone
cannot establish contact-iteration counts; those require inspecting block ranges.
See the [Node Inspector API](https://nodejs.org/docs/latest-v22.x/api/inspector.html#cpu-profiler)
and the [V8 Inspector protocol definition](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/js_protocol.json).

## Results

All nine stages passed: nine profiles, one coverage run, ten replay-checked rows,
63 sampled-run timing repetitions and seven coverage-run repetitions. All 71
ownership checks and the full world replay passed. The optimized engine bundle
remains `864cc291fc75ebfce7d6d53e6c15d1b13736679d0540c80c496298e991b19694`.
No engine changes or optimization implementation were made in this investigation.

The nine profiles contain 3,707 samples, including 2,032 recognized engine-step
samples, 1,374 exact-state harness samples, 194 GC samples and 14 engine samples
outside a recognized step. Harness encoding remains outside benchmark timing.
The following are inclusive stack counts, not CPU-time percentages; rows overlap.

| Work visible on a stack                           | Samples | Share of recognized engine samples |
| ------------------------------------------------- | ------: | ---------------------------------: |
| Contact solve, including its contact construction |   1,080 |                              53.1% |
| Contact geometry across all phases                |     347 |                              17.1% |
| Owned-data admission/physical validation          |     274 |                              13.5% |
| Relative/point velocity                           |     236 |                              11.6% |
| Effective-mass response                           |     229 |                              11.3% |
| Portable copying                                  |     224 |                              11.0% |
| Impulse application/receipt updates               |     220 |                              10.8% |
| Time of impact                                    |     117 |                               5.8% |
| Geometric projection                              |     113 |                               5.6% |

Within the 1,080 solver samples, the disjoint attribution is relative motion 231,
effective response 229, impulse updates 213, geometry 211, and unresolved/inlined
work 196. Effective response is a substantial, repeated hotspot, but not the
entire solver cost. The three passes put the solver at 52.0%, 51.6%, and 55.8%
of recognized engine samples; effective response varies from 8.3% to 13.1%.
At 2 ms alone, solving is 747/1,365 samples (54.7%).

There are 27 intervals longer than 10 ms, with a maximum of 364.725 ms. Removing
these intervals only in the sensitivity view changes solver share from 53.15%
to 53.17% and effective-response share from 11.27% to 11.33%. These are elapsed
sampling gaps, not measured engine CPU costs. All original samples remain.

The separate 2 ms coverage run changes the optimization recommendation:
**this fixture has zero friction**, and both tangent solving and `diskSolution`
have zero executions. The measured repeated work is the normal denominator.

| Instrumented full-workload count                      |        Executions |
| ----------------------------------------------------- | ----------------: |
| Created/completed rigid steps                         |         357 / 356 |
| Solves                                                |             1,068 |
| Constructed contact points                            |             8,544 |
| Solver iteration bodies                               |            15,308 |
| Contact-iteration bodies and normal `effective` calls |      122,464 each |
| Relative velocity / point velocity                    | 145,248 / 315,772 |
| Impulse applications / receipt records                | 244,928 / 247,064 |

The contact-construction and iteration counts come from exact block ranges in
the frozen bundle, corroborated by helper call counts. They imply eight contact
points per solve and 14.33 iterations per solve on average. For a completed 2 ms
step, the 359 contact work units are 9 contact-construction visits, 6 projection
visits and 344 solver contact visits. The full 48 ms trajectory retains exactly
72 assembly, 144 sweep, 8,616 contact and zero fracture work units, and exact
digest `89890909f934239cd42e1c425b4df83022cf61eaf8067b969cb4dcc5db79064e`.

Supervisor-loss cleanup emptied the Job in 2.945 s; cancellation took 2.150 s.
Every stage confirmed zero active processes and named-Job absence. Peak observed
host CPU across runtime health samples was 27.02%. No stage was retried or failed.
Static validation passed ten Node data-analysis tests, 28 Python scope/cleanup
tests, syntax checks and Python lint.

The [checkpoint](checkpoints/COLLISION_STACK_SOLVER_PROFILE.json) binds the raw
profiles, coverage, replay rows, review, sources and cleanup receipts. A prose-only
collector label correction after collection changes `2/4/8` to `16/8/2`; the
executed protocol and every stored row used 16/8/2 throughout. The original bound
collector and summary are retained alongside the corrected summary.

## Next optimization: cache only the normal denominator

The solver computes a contact's normal effective-mass denominator and three
tangent matrix entries inside every contact iteration. `effective` reads the
contact point, body centers, mass/anchor state and inverse inertia. Inside one
`solve` invocation, impulse application changes velocity, angular momentum and
receipts, but does not change those geometric/inertial inputs. `drift` and
`project` change geometry outside that solve.

A narrowly scoped next candidate is a lazy, per-contact cache of
`dotVec3(c.normal, effective(c, c.normal))`, valid only within one solve. This can
reduce this workload's 122,464 normal evaluations to 8,544: **113,920 fewer calls,
or 93.0% of these calls**. That is a source-and-count inference, not a measured
wall-time improvement; cache overhead, JIT behavior and inlining still need a
fresh controlled comparison.

The first evaluation should stay after the same progress yield and relative
velocity calculation, with the original expression and arithmetic order.
Subsequent iterations can reuse that scalar. Use an explicit uninitialized
sentinel rather than a truthiness test, preserving zero/signed-zero semantics.
Geometry drift, projection, rollback trials and subsequent solves require fresh
contacts/caches. Do not cache across generator jobs or expose this cache through
public state, receipts or restart formats.

Leave the tangent matrix and friction solve unchanged in that first patch: this
fixture provides no execution evidence for optimizing them. Geometry is another
visible cost, but sharing its caches across phases has more invalidation paths.
Relative motion and impulse updates depend on evolving velocities/momenta and
cannot simply be treated as constants.

Keep velocity-dependent work live, including relative velocity, normal/friction
impulses, convergence checks and `effective(c, change)` in the friction-work
receipt. Replacing that last expression with an algebraically equivalent matrix
combination could change floating-point rounding. Do not reassociate arithmetic,
reduce iterations, change yields, or alter the time-of-impact algorithm.

Implementation remains a separate step requiring complete bit-exact differential
states/receipts, identical work and cancellation boundaries, input isolation and
rejection behavior, all original collision fixtures and timestep refinements,
and fresh contained timing controls. Call-count reductions are not speedup claims.

## Safety and qualification

The unchanged limits are 6% aggregate Job CPU, 4 GiB, below-normal priority,
single-thread libraries, 25 s supervisor/30 s independent watchdog deadlines,
3 s heartbeat, 30 consecutive quiet seconds at host CPU at most 30% and at least
8192 MiB free RAM within a 90 s preflight. Existing host-health aborts, retained
process-handle cleanup, global lease and named-Job absence checks remain enforced.

The Windows incident cause remains undetermined. `blockRecovery: true`, the
original failed GPU report and protected performance worktree stay unchanged.
No GPU/browser workload, GPU query, recovery permit or generic verification
exception is introduced. Runtime, performance, GPU, Worker and R1 acceptance
remain false. The earlier [timing investigation](COLLISION_STACK_TIMING.md) and
[owned-data optimization](COLLISION_OWNED_OPTIMIZATION.md) retain their own evidence.
