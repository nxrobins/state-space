# Coupled solver investigation

Status: **all seven linear checks, the 8-particle pilot and all three larger
CPU profile cases passed** locally on 2026-10-25, against main `e19b8f0` plus
the private study changes. The 27/64-particle cases converged before dense
fallback; only the narrow-contact case supplied a captured face. Both alternative
linear solvers passed that face's residual/response gates, but no integrated
world or whole-case speedup has been established. Source hashes are unchanged,
the incident hold is restored to `blockRecovery: true`, and the completed
follow-ups are removed. Results and the revised implementation order are below.
The old `D:\state-space-cpu-performance` worktree is outside this investigation.

The optimization increment implements coordinate-projection and
zero-viscosity optimizations. Its 37 regression checks and two paired comparison
cases now pass. Median paired speedups for the combined implementation are
1.148x at 27 particles and 1.273x at 64 particles, with exact reference outputs
and work behavior in those cases. The earlier profile measurements below are
historical; the fresh paired comparison is recorded in the optimization section.

## Question and first boundary

Can the private liquid/rigid constraint projection get cheaper while retaining
the existing model, resolution, contact ownership, numerical work ledger, and
original residual tolerances?

The current solver performs up to 32 coordinate sweeps before building
`A = J M^-1 J^T`. It builds that matrix once at frozen geometry, but factors the
current active face repeatedly. It already caches row effective masses. None of
these costs should be assumed dominant before a profile.

The first experiment has three parts:

1. Time complete reference steps, separately attribute generator work stages, and
   count how often the dense fallback actually runs.
2. Capture the actual frozen Jacobian/response rows and active faces from the
   reference solver. Replay those faces using dense Cholesky, exact factor reuse,
   and a sparse matrix-free Jacobi-preconditioned conjugate-gradient prototype.
3. Use the result to choose the next integrated change. Fixed-face replays cannot
   establish nonlinear active-set convergence or a complete world speedup.

The only hook in the reference solver copies optional diagnostic data. Alternative
solvers cannot supply impulses to the world. The public SDK is unchanged.

## Concrete execution and safety review

`scripts/verification_guard.py:assert_verification_allowed` suspends **every**
supervised workload while an incident hold exists without a reviewed exact-command
permit. `assert_recovery_enabled` also rejects recovery when `blockRecovery` is
true. The current hold explicitly requires incident analysis and review of a
revised safety approach. A generic request to investigate performance does not
resolve the recorded unknown cause of the host freezes.

Preferred execution is a separate host without this workstation's unresolved
incident. If local CPU execution is reviewed, use separate one-shot permits for
the following stages; never delete the hold or enable a blanket verification run:

| Stage | Exact workload | Supervisor deadline | Scope |
| --- | --- | --- | --- |
| Linear checks | `node node_modules/vitest/vitest.mjs run --reporter=dot engine/experimental/multiphysics/projection-study.test.ts --config engine/vitest.bounded.config.ts` | 30 s, CPU | Tiny independent linear systems, redundancy, cache invalidation |
| Pilot | `node scripts/profile_coupled_solver.mjs pilot` | 30 s, CPU | One frozen step with 8 liquid parcels, one movable body, 4 samples/contacts; reference/capture/replay and cancellation |
| Profile, only after pilot review | `node scripts/profile_coupled_solver.mjs profile` | 90 s, CPU | Separate 27- and 64-liquid frozen steps plus the existing narrow duplicated-contact regression |

Each command must run inside the existing Python CPU supervisor, with its quiet
window, Windows 6% process-tree CPU / 4 GiB memory cap, independent watchdog,
missing-progress deadline and cleanup receipt. The experiment uses one Vitest
worker, no GPU/browser/Worker transport, no long trajectory and no size above 64
liquid particles. Each test has a 10-second timeout, but only the supervisor can
terminate a synchronous stalled test. No automatic retries or escalation after
a failed pilot. These controls limit workload; they do not diagnose the original
freeze or protect against an OS/driver hang.

The initially stale dependencies were restored with
`npm ci --ignore-scripts --no-audit --no-fund`. Main's TypeScript 7.0.2 and Vitest
5.0.5 are now installed. SDK declaration generation, both configured type checks,
and structural lint pass. Static checks do not execute a simulation.

The refused launch is retained at
`dist/verification/coupled-solver-study/review-linear-5b94b410d5584ee283204be13ad54cea/`.
Its supervisor receipt records `Host CPU is busy before launch`, with no child
PID. A separate read-only host sample reported 100% CPU and approximately 75 GiB
available memory; Windows processor telemetry also reported 100% load. No other
process was stopped and no safety threshold was changed.

### Conditional execution after CPU diagnosis

The user subsequently requested diagnosis and execution of the already approved
checks and pilot once the machine becomes quiet. Read-only process/container
inspection identified the dominant load as Docker/WSL's
`dagger-engine-v1.0.0-beta.21` container (`f67cf0cc3a18`), with many `rustc` and
`cc1` processes, a busy Python process and `interp_corpus-1`. Docker reported
`1693.87%` aggregate container CPU; Windows reported 99–100% host load. These
are different sampling windows/accounting systems, not directly comparable
single-core percentages. Native Claude processes and Nord security software
were secondary contributors. The ordinary Ubuntu WSL distribution was mostly
idle. No process or container was stopped.

Later host probes fell to approximately 32–39%, but had not established the
chosen quiet window. A thread follow-up checks every five minutes and runs only
the two approved stages after CPU stays at or below 30% for 30 seconds with at
least 8 GiB free memory. This stricter readiness check does not change the
supervisor's existing 50% launch threshold or any runtime safety threshold.

The local continuation is
`dist/verification/coupled-solver-study/run_approved_when_quiet.py`, with exact
command authorization and source hashes in `approved-quiet-run.json`. A passed
stage is not repeated. A launched failure, changed source/incident or interrupted
execution requires review; only a busy preflight with no child can wait for a
later attempt. Each stage uses a new retained supervisor receipt and restores
the hold. The follow-up stops after completion or a failure requiring attention.
At that stage the larger profile was not authorized; its subsequent approval
and separate continuation are recorded below.

### Approved pilot results (2026-10-25)

Both stages ran sequentially inside Windows jobs with the existing 6% CPU /
4 GiB limits, independent watchdogs and 30-second deadlines. Both supervisor
receipts passed with exit code zero and no recorded execution or cleanup error.
Preflight host CPU was approximately 22.4% for the linear checks and 11.7% for
the pilot; each followed its own 30-second quiet window at or below 30%.

| Check | Result | Retained local evidence |
| --- | --- | --- |
| Independent linear systems, redundant/inconsistent rows, exact cache reuse/invalidation and invalid input | 7 tests passed | `review-linear-f94e90f30402429fa7497cd60f8b03d5/supervisor/report.json` |
| 8-liquid, one moving rigid body, four samples and four contacts | 1 pilot test passed | `review-pilot-141a45c3828e48dbb7d87cb607bf96f1/supervisor/report.json` |
| Pilot data and source provenance | Complete; post-run source hashes unchanged | `8239fc1f-8677-4bbb-bcf6-615b322ed50b/` |

All paths in that table are beneath ignored
`dist/verification/coupled-solver-study/`.

The pilot completed 181 work units against its declared 55,856-unit bound, with
one density and one divergence sweep. Its single warmed reference sample took
approximately 2.59 ms, including validation/copies, solving and result cloning;
the initial setup run took approximately 7.70 ms. These are preliminary timings
for this small frozen CPU case, not a benchmark distribution or a world frame
rate. No alternative performance ratio can be inferred from them.

The completed reference results matched exactly at work budgets 1 and 256 and
with capture enabled. Input remained unchanged, and cancellation published no
result. Density, divergence and contact errors were zero. The impulse-work
accounting residual was zero, with no contact or viscous heat. Numerical
projection changed kinetic energy by approximately `-0.707073`, retained as
numerical work rather than relabeled as physical heat.

Crucially, all eight liquid rows were free-surface rows: there were no resolved
bulk divergence rows and **zero captured dense-fallback faces**. Thus the pilot
checks the small-case harness and reference behavior, but does not exercise the
capture callback or evaluate matrix-free/factor-reuse performance on a real
fluid face. Empty replay timings are not optimization results. The next useful
experiment at that stage was the separately reviewed 27/64-liquid profile and
the narrow, duplicated-contact case. Its subsequent results are recorded below;
an integrated physical comparison remains a separate gate.

After completion, `blockRecovery` is true, the incident record is unchanged, and
there is no unused permit or execution lock. The quiet-window follow-up is no
longer needed and is removed. No GPU/browser, larger profile or world trajectory
was run, and none of the existing runtime qualification holds is cleared.

### Larger CPU profile authorization (2026-10-25)

After reviewing the successful pilot, the user explicitly authorized the
27-particle, 64-particle and narrow-contact cases once the machine is quiet,
under the agreed safety limits. The pilot's receipts and original reviewed
source hashes were rechecked before preparing this continuation.

The exact approved workload is `node scripts/profile_coupled_solver.mjs profile`.
It runs the three cases serially with one test worker under the existing CPU
supervisor, with a 6% process-tree CPU cap, 4 GiB memory cap, independent watchdog
and 90-second deadline for the profile. The same at-or-below-30% CPU window for
30 seconds and 8 GiB free-memory prerequisite applies. No supervisor threshold
is changed, and the existing per-test 10-second bound remains.

The separate, local one-shot continuation is
`dist/verification/coupled-solver-study/run_approved_profile_when_quiet.py`, with
exact command, source hashes and prior successful stage receipts recorded in
`approved-profile-quiet-run.json`. Status is retained separately in
`approved-profile-quiet-run-status.json`; the completed pilot is not rerun.
Each launched attempt receives a new supervisor receipt and restores the incident
hold. A launched failure or changed incident/source requires review rather than
an automatic retry.

The first readiness probe reported approximately 76% host CPU, so no profile
workload was launched. A separate thread follow-up checks every five minutes,
stays quiet while the host is busy, and stops after completion or a failure
requiring attention. Results must distinguish fixed-face replay performance
from complete reference-step timings and retain every numerical rejection.
The general runtime hold, GPU/browser restrictions and world-trajectory gates
remain in force.

### Larger CPU profile results (2026-10-25)

All three cases passed after the sustained quiet window. The supervisor retained
the 6% CPU / 4 GiB caps, independent watchdog, one-worker execution and 90-second
deadline. Its preflight reported approximately 14.6% host CPU and 62.8 GiB free
memory. The job peaked at approximately 277 MiB, ended with zero active processes,
and passed with no recorded execution or cleanup error.

The supervisor receipt is
`dist/verification/coupled-solver-study/review-profile-25a0519e0a59418fb527715e8798a3a3/supervisor/report.json`.
Case reports and source provenance are in
`dist/verification/coupled-solver-study/0293098f-9379-423c-a824-10d38589117c/`.
`completion.json` records exit code zero and no changed sources.

| Case | Whole-reference median, 3 warmed samples | Sample range | Divergence sweeps | Captured fallback faces |
| --- | --- | --- | --- | --- |
| 27 liquids, shared movable floor, 9 samples/contacts | 9.015 ms | 6.714–10.185 ms | 17 | 0 |
| 64 liquids, shared movable floor, 16 samples/contacts | 15.696 ms | 15.607–18.917 ms | 27 | 0 |
| Duplicated narrow-contact wedge | 0.543 ms | 0.419–0.990 ms | 33 | 1, with 3 active rows |

These reference timings include input validation/copies, solving and result
cloning. Three samples on one constrained host are exploratory data, not a
stable performance distribution or a frame-rate claim.

All three reference results matched exactly between work budgets 1 and 256 and
with capture enabled. Inputs were unchanged and cancellation published no
result. The large cases had 11 and 40 resolved divergence rows, respectively.
Their final divergence errors were approximately `2.11e-8` and `1.88e-8`;
contact errors were `4.71e-9` and `7.53e-9`. The wedge contact error was
`3.82e-14`. All stayed within the original tolerances. Impulse-work accounting
residuals were zero, with numerical projection losses retained separately from
physical heat. This is reference behavior plus observational capture, not an
integrated test of alternative solver trajectories.

The captured wedge face gave the following replay observations:

| Method | Cold replay | Repeated frozen operator | Original residual | Generalized-response relative error | Relevant work |
| --- | --- | --- | --- | --- | --- |
| Dense | 0.840 ms | 0.122 ms | `1.14e-13` | 0 | Factors once on each replay |
| Dense with exact factor reuse | 0.218 ms | 0.070 ms | `1.14e-13` | 0 | One factor build cold; one cache hit and zero factor builds on repeat |
| Matrix-free Jacobi PCG | 0.201 ms | 0.060 ms | 0 | `3.80e-11` | 3 iterations, 7 operator applications, 3 diagonal entries; no dense Gram matrix or factorization |

Every replay passed the original-operator residual and response-equivalence gates.
The repeated frozen replay shows that exact reuse works and PCG can solve this
redundant, narrow face. It does **not** establish a reliable speed ratio: there
is only one tiny face, each timing is one observation, the methods ran in a fixed
order with unequal JIT warm-up, and lookup/conversion overhead is substantial.
Cold dense timing must not be compared to a later warmed method as a speedup.

There was no opportunity for factor reuse inside any original job: the large
cases never factored, and the wedge factored once. The one cache hit came only
from the explicitly repeated frozen replay. No alternative linear solve was
substituted into the reference world/kernel, so the whole-reference table cannot
be used to claim an alternative-solver speedup.

The stage profile instead points toward the coordinate/pair paths. For 64
liquids, divergence projection plus residual checks took approximately 5.57 ms
of the 12.98 ms instrumented stage total. Viscosity traversal took 2.60 ms even
though the authored viscosities were zero; neighbor traversal took 1.59 ms.
The 27-liquid case spent 1.87 ms in divergence projection/residual work out of
4.13 ms of attributed stages. These separately instrumented runs include
per-yield timing overhead and different JIT state; their totals are not a
decomposition of the uninstrumented sample medians. The stage named `validate`
also includes work performed before that yield, so it is not isolated validation
cost.

**Revised implementation order:**

1. Investigate the coordinate projection's repeated rate/impulse evaluation and
   allocation, alongside a zero-viscosity fast path that preserves validation,
   canonical arithmetic, yields and cancellation semantics. The profile provides
   no reason to start by caching a factor these large cases never build.
2. Establish the shared sparse mass-metric operator and obtain actual larger
   coupled active systems. Compare earlier matrix-free dispatch against the
   current 32-sweep policy as a separate experiment, preserving the full original
   KKT checks and dense fallback. Do not force the current baseline to factor
   merely to manufacture a comparison.
3. Consider exact factor reuse only where measured workloads show repeated
   identical operators/faces. Nearby factors as preconditioners require separate
   current-operator residual checks and measured refresh/invalidation cost.
4. The thin-tree paper's spectral splitting/preconditioning overlap remains a
   later possibility if larger matrix-free systems show conditioning problems.
   This three-iteration, three-row solve does not demonstrate that need.
   Crouzeix still has no advantage over symmetric spectral analysis for this
   projection; transport/coarsening and kinetic gas models remain separate
   representation/model changes.

No production solver or fidelity setting was changed. The incident identity is
unchanged, `blockRecovery` is true, and there is no unused permit or execution
lock. The larger-profile follow-up is deleted because its authorized run is
complete. Further integrated experiments remain subject to their own bounded
execution review.

### Coordinate and zero-viscosity optimization (2026-10-25)

The user authorized this next implementation and comparison against the unchanged
27/64-particle cases once the host is quiet, with fidelity and the existing safety
limits retained. This is a separate continuation from the completed profiles.

The source changes are deliberately arithmetic-preserving:

- Each constraint lazily caches parcel ownership/inverse mass and frozen wall
  lever arms for its job. Scalar rate/impulse operations avoid temporary vectors
  and endpoint objects. Particle terms, wall terms and shared-body impulses keep
  their original order; gradients are not pre-multiplied by inverse mass, and
  torques are not aggregated across terms. The particle zero-lever spin update is
  retained, including signed-zero arithmetic and nonfinite rejection behavior.
- A zero pair relaxation rate skips viscosity kernel/weight evaluation. The
  boundary path likewise skips that calculation when the particle viscosity is
  zero. Both paths still yield the same stage for every original pair. Nonzero
  viscosity, gas pressure work, heat ownership, constraints, residual tolerances,
  the 32-sweep fallback policy and total work limits are unchanged. Gas support
  radius validation remains at input and each pressure volume update; fixed
  neighbor offsets are validated before this phase.
- Private comparison controls retain the former coordinate path and viscosity
  traversal for ablation checks. They are not public SDK or serialized world
  settings. Both optimizations are currently enabled in the private
  implementation. The bounded reference equivalence and typical-step performance
  results below support retaining both; wider runtime qualification remains open.

Before editing the solver, its original implementation and transitive sources
were copied and bundled with the lockfile's esbuild into
`dist/verification/coupled-solver-study/coordinate-baseline-e7cb5a31-0216-4265-b333-efafcc68344e/`.
Its bundle SHA-256 is
`df91808660770c46ea8bbcbbc2b1479c6cd26c499fd93eb25dcd923a43fdceed`.
The manifest includes original source hashes, compiler version and bundle options.
The comparison verifies that immutable manifest/bundle and uses the same compiler
options for the optimized modules. This permits a fresh paired comparison rather
than subtracting noisy measurements taken at different times.

`node scripts/compare_fluid_optimizations.mjs` first runs the existing fluid
reference tests and new exact differential regressions. Those regressions cover
off-diagonal inertia, shared moving/fixed boundaries, unequal masses, mixed and
zero viscosity, gas pressure, finite spin, duplicated narrow contacts, signed
zeros, gravity prediction, canonical reversal, work budgets, cancellation and
invalid input/singular support. The paired comparison then tests the original
27/64-particle inputs against four independently bundled variants: immutable
baseline, coordinate-only, zero-viscosity-only and combined.

Each case gets five rotating warmup rounds and fifteen rotating paired timing
rounds. Timed windows include input validation/copying, the full frozen solver
step and result cloning; equality assertions run afterward. Every measured result
and completed progress record must exactly equal the immutable baseline. The
run also compares every work stage at budget 1, checks budget 256, canonical input
reversal, input immutability and cancellation without partial publication.
Reports retain raw paired samples, medians/interquartile ranges, per-round ratios,
work/convergence/energy data and separately instrumented stage attribution.

The approved one-shot continuation is
`dist/verification/coupled-solver-study/run_approved_optimization_when_quiet.py`.
Its exact command, reviewed source hashes, immutable baseline and incident
identity are recorded in `approved-optimization-quiet-run.json`. It uses the
existing 6% CPU / 4 GiB supervisor cap, one test worker, independent watchdog and
90-second total deadline. It waits for CPU at or below 30% for 30 seconds with
at least 8 GiB free memory. A follow-up checks every five minutes and stays quiet
while busy. A launched failure or changed source/incident requires review; the
hold is restored after every attempt. No GPU/browser or world trajectory is
included, and no other process is stopped.

The initial readiness probes reported 100% CPU and launched no workload. After
the user asked to continue, Docker's daemon was stopped and its compiler load
was absent; this agent did not stop a process or container. A subsequent quiet
window allowed the approved run. Both configured type checks, structural lint,
formatting and diff hygiene also pass.

### Exact regression and paired comparison results (2026-10-25)

The existing fluid tests plus new differential regressions passed **37 checks**.
The two paired timing/fidelity cases then passed. The supervisor receipt is
`dist/verification/coupled-solver-study/review-comparison-7f52e2b9e0fc43c582ca1e8df04c8db5/supervisor/report.json`.
Source/bundle provenance, raw rounds, comparison reports and completion record
are under
`dist/verification/coupled-solver-study/coordinate-comparison-0111f91c-f1dc-4d4c-a87a-a9e56222f8d9/`.
The run ended with unchanged source/bundle hashes, zero active processes and no
recorded execution or cleanup error.

The job retained the 6% CPU / 4 GiB limits and independent watchdog, completing
within its 90-second deadline. Host preflight CPU was 15.9%, with approximately
105.8 GiB free memory. Peak process-tree memory for the complete build/test/compare
job was approximately 423 MiB; this is not an isolated solver memory comparison.

Each row below contains 15 timed samples after five rotating warmup rounds.
Variants ran in rotating order inside each paired round. Times cover complete
frozen CPU steps, including validation/copies and result cloning. The speedup is
the median of each round's `baseline time / variant time`, so it need not equal
the ratio of the two independently computed time medians. Equality assertions
were outside the timed window. The fresh baseline timings are used here rather
than the earlier noisier three-sample profile.

| Particles | Variant | Median ms | Interquartile range ms | Median paired speedup | Faster than paired baseline |
| --- | --- | --- | --- | --- | --- |
| 27 | Immutable baseline | 4.472 | 4.251–4.583 | 1.000x | — |
| 27 | Coordinate only | 4.248 | 4.162–4.428 | 1.051x | 9/15 |
| 27 | Zero-viscosity only | 4.266 | 4.078–4.386 | 1.031x | 10/15 |
| 27 | Combined | 3.720 | 3.678–3.854 | **1.148x** | **14/15** |
| 64 | Immutable baseline | 13.510 | 12.774–14.380 | 1.000x | — |
| 64 | Coordinate only | 11.915 | 11.605–12.653 | 1.158x | 13/15 |
| 64 | Zero-viscosity only | 10.890 | 10.742–11.374 | 1.213x | 14/15 |
| 64 | Combined | 10.616 | 10.391–11.373 | **1.273x** | **14/15** |

The small isolated effects at 27 particles overlap substantially with timing
noise; the combined result was more consistent in this run. Effects must not be
added or multiplied to predict a combined gain. The 64-particle case shows the
larger benefit from avoiding the otherwise quadratic zero-viscosity kernel work.

All variants matched the immutable original solver **exactly** in the measured
27/64-particle cases: complete result objects, every budget-1 progress stage,
budget-256 results and work records, reversed canonical inputs, convergence,
body reactions and energy accounting. Cancellation published no result and input
objects stayed unchanged. Work counts remain 2,521 and 10,641, with original total
bounds 170,791 and 392,976; divergence sweeps remain 17 and 27. Divergence/contact
errors and signed numerical projection losses are unchanged, and impulse-work
accounting residuals remain zero. The additional regression cases cover mixed
nonzero viscosity, gas pressure, off-center torque, finite spin, unequal masses,
off-diagonal inertia, fixed boundaries, signed zero, invalid viscosity and singular
support. This establishes the tested reference envelope, not arbitrary-world
model correctness or native/GPU equivalence.

The separately instrumented 64-particle run attributed 4.08 ms to baseline
divergence projection/residual work versus 2.59 ms combined, and 2.72 ms to
baseline viscosity traversal versus 0.83 ms combined. These observations are
consistent with the targeted changes, but instrumentation/JIT effects mean they
are not an additive decomposition of the timed medians.

**Latency and memory limits:** raw timing outliers are retained without filtering.
At 64 particles, maxima were 360.164 ms for the baseline, 239.315 ms for coordinate
only, 16.850 ms for zero-viscosity only and 26.793 ms combined. Their causes were
not instrumented; no tail-latency or real-time guarantee is established. This is
one capped host/run with 15 paired rounds per size. The geometry cache retains
bounded per-job ownership/lever data in exchange for less repeated construction;
its incremental memory cost was not measured separately.

Both changes remain enabled in the private implementation because they preserved
exact tested behavior and improved the combined typical-step measurements. The
old coordinate path and viscosity traversal remain available only as private
comparison controls. No physical resolution, timestep, convergence threshold,
iteration cap, contact/heat ownership or fallback policy was relaxed. The
spectral-preconditioning papers remain a later step; this gain required no new
approximation and does not establish a need to change that implementation order.

The incident identity is unchanged, `blockRecovery` is true, and no unused permit
or execution lock remains. The optimization follow-up has been deleted because
its authorized run is complete. The old performance worktree is untouched. No
GPU/browser workload or whole-world trajectory was performed for this increment.

### Packaged evidence and reproduction

The compact, tracked [CPU checkpoint](checkpoints/COUPLED_SOLVER_CPU.json) contains
all four variant summaries, fidelity/convergence/work records, measured source
and bundle hashes, artifact hashes and the supervisor limits. Raw captures remain
under ignored `dist/verification/`; they are not added to the source tree.

The exact pre-optimization solver is retained in baseline commit
`7fa4e20968898d4bed4803b9773a019c00c2f1e8`. Its four source hashes match the
measurement manifest. A fresh checkout with lockfile dependencies can prepare
the same baseline without running physics:

```sh
node scripts/prepare_fluid_baseline.mjs
```

Shallow checkouts must first fetch the pinned baseline revision if it is absent.
Preparation checks every Git source hash and requires the rebuilt bundle to match
the measured SHA-256. It never replaces an existing capture, changes a safety
hold, or starts a numerical workload. Packaging verified a reconstruction from
this commit with the exact measured bundle hash.

Only on an approved CPU host/window, run the bounded comparison:

```sh
node scripts/compare_fluid_optimizations.mjs
```

This entry point still honors the incident hold and existing supervisor. Keep an
unresolved local hold intact; reproducing a benchmark does not authorize clearing
it. The normal CPU suite independently selects the coordinate regression tests;
the timing cases stay explicitly selected outside that suite.

Packaging moved the shared input builders into
`engine/test-support/multiphysics-fluid-fixtures.ts`, following the contributor
layout. The checkpoint records the old and new paths/hashes. Reversing only the
fixture import/provenance-path substitutions reproduces the measured source
hashes, and the fixture function bodies are byte-identical. The numerical solver
source itself is byte-identical to the passing measured implementation. These
packaging changes received static checks; the retained numerical results were
not rerun and the workstation hold was not changed.

The launcher retains source hashes, mode, Node/platform and supervisor ID in a
unique `dist/verification/coupled-solver-study/<UUID>/` directory. Each case writes
an initial receipt, then success or failure. The outer supervisor retains its own
independent receipt. Failed evidence is not overwritten.

## What the measurements mean

- Uninstrumented whole-reference timings include input validation, copying,
  solving and result cloning. Per-stage timings use one generator work unit per
  call and include instrumentation overhead; do not substitute their sum for the
  ordinary step timing.
- Reference output must be exactly identical with capture enabled and with work
  budgets of 1 and 256. Cancellation must publish no result and input must remain
  unchanged.
- Fixed-face replays check the **unfloored** original operator residual to
  `1e-11 * max(1, ||rhs||_infinity)`. Generalized velocity response must agree with
  the dense candidate to relative `1e-8`. Impulses need not be unique for redundant
  constraints. Failure is a result to investigate, not permission to relax a gate.
- The dense baseline retains its Gram matrix across faces, as the actual solver
  already does. Factor reuse retains at most four ordered faces for one exactly
  matched finite operator. Changed RHS permits reuse; changed operator coefficients
  clear the cache. Identity comparison and conversion are included in solver cost.
- Matrix-free solving uses the same `J` and `M^-1 J^T`, including aggregated rigid
  translation and torque. It changes no particle count, timestep, physical law or
  unilateral constraint. It does not build a dense Gram matrix, but stores sparse
  Jacobian/response rows and uses a diagonal preconditioner.
- A repeated frozen operator gives an upper bound on reuse opportunity. Moving
  geometry, changing inertia, phase, anchors, neighbor/contact topology or active
  faces may eliminate real-world hits. A nearby factor can later be investigated
  as a **preconditioner**, never accepted as the exact current solve by assumption.
- Alternative timings are linear-face timings, not full-fluid or world timings.
  No fallback faces means this case supplies no evidence for either optimization.

## Order of implementation and paper overlap

The papers were inspected at the pinned `openai/math` revision
`1581d4cbdd69a0faf34b2089614fe2a814316a6a`; the survey cache and screening inventory
are under ignored `dist/research/openai-math-2026-10-25/`.

| Work | Relationship to this solver | Order |
| --- | --- | --- |
| Exact mass-metric operator and baseline profile | Shared foundation for matrix-free evaluation, residuals and any future preconditioner | First; retain independent physical and closest-point regressions |
| Exact factor reuse | Same operator and ordered active face, possibly different RHS | Evaluate separately before adding approximate reuse; measure lookup/invalidation cost and actual hit rate |
| Matrix-free PCG | Symmetric positive semidefinite operator; redundancy and conditioning can defeat simple CG | Replay first, then integrate behind a private option only if justified; retain dense fallback and original KKT acceptance |
| [Strong thin trees / spectral splitting](https://github.com/openai/math/blob/1581d4cbdd69a0faf34b2089614fe2a814316a6a/lean/docs/174.md) | Potential spectral preconditioner design/certification; a thin tree does not preserve exact fluid/solid loads, and this matrix is not automatically a graph Laplacian | After conditioning and iteration counts show a need; retain every physical constraint in residual checks |
| [Complete Crouzeix inequality](https://github.com/openai/math/blob/1581d4cbdd69a0faf34b2089614fe2a814316a6a/lean/docs/325.md) | Bounds matrix functions of general, possibly nonnormal operators; ordinary spectral bounds suffice for this symmetric projection | Later, if a nonnormal coupled propagator or polynomial regional response is introduced |
| [Sharp Brenier transport stability](https://github.com/openai/math/blob/1581d4cbdd69a0faf34b2089614fe2a814316a6a/lean/docs/374.md) | Possible error guard for a future optimal-transport remapping scheme under its source/support assumptions; not a bound for this SPH projection | After selecting an adaptive representation; coarsening changes operator/cache semantics and needs separate fidelity gates |
| [Boltzmann-Grad derivation](https://github.com/openai/math/blob/1581d4cbdd69a0faf34b2089614fe2a814316a6a/lean/docs/364.md) | A possible future dilute-gas model direction, with its own assumptions | Separate model investigation, no dependency for the current projection optimization |

Matrix-free solving and factor reuse attack overlapping work. Their speedups must
not be added. A factor can precondition a current matrix-free solve, but building,
validating and refreshing it may cost more than it saves at the current 128-fluid
limit. Broader gains may instead require neighbor construction, rate/impulse
evaluation or fewer nonlinear sweeps; let the profile decide.

Promotion requires a subsequent integrated comparison: complete coupled steps
and trajectories, original KKT and numerical-energy budgets, momentum/torque,
contact heat ownership, independent closest-point cases including narrow and
redundant faces, canonical ordering, work-budget independence, cancellation,
failure atomicity and restart. Existing held world/runtime gates remain separate.
Do not change temporal resolution or merge coarsening into this solver experiment.
An integrated matrix-free solve must also yield bounded work for cancellation and
account for its inner iterations in the total work limit; the synchronous replay
prototype is not a replacement for the resumable world job.
