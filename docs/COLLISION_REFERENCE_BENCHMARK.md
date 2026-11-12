# CPU collision reference benchmark

This is a bounded, opt-in diagnostic comparison of the existing State Space
private rigid kernel and MuJoCo 4.0.0 CPU collision modes. It does not change an
engine, public export, snapshot schema, tolerance, ordinary test selection, or
qualification gate. A prepared packet is **not a measured result**.

The Windows incident hold still has `blockRecovery: true`. Both general execution entry
points honor the existing verification supervisor. The preparation command only
bundles source and writes metadata; it does not import the bundle, instantiate
materials, advance physics, open a browser, or query a GPU. Do not move/delete the
hold, alter its fields, spoof supervisor environment variables, or run the leaf
adapter directly to get around it. Actual measurement needs an eligible host
under the existing supervision policy.

The separately reviewed [Windows CPU-only scope](COLLISION_CPU_SCOPE.md) keeps
that hold intact and gates fixed benchmark stages on containment probes. The
authorized November 8 retry completed all 18 stages: three CPU containment
probes, exact LEG-WORKER replay, 21 State Space rigid rows and 42 MuJoCo rows.
All within-backend replay checks passed. The
[results](COLLISION_REFERENCE_RESULTS.md) distinguish execution completion from
physical diagnostics: MuJoCo speculative contacts prevented full wall passage,
but still failed the unchanged strict barrier tolerance. The
[completion checkpoint](checkpoints/COLLISION_REFERENCE_RESULTS.json) binds the
full cohort. The [earlier retry](checkpoints/COLLISION_CPU_RETRY.json) and
[initial checkpoint](checkpoints/COLLISION_CPU_SCOPE.json) preserve the import
failure and host-health abort. No performance or other qualification is granted.

## Two independent scopes

1. The `LEG-WORKER` source recipe from `worker.test.ts` runs through the real
   private **world** API: copper parcel `a`, owner `start`, center `[0,2,0]`,
   angular velocity `[0,1,0]`, constructor defaults, and a 3 Q heat edit. The
   harness retains the original two-preview-tick plus one-continuation-tick
   horizon and work budgets 1, 7 and 256. It checks complete preview/commit
   equality, input/live-state isolation, stale/foreign rejection, cancellation
   during work and after readiness, lossless restore, application JSON restore,
   and exact continued results and revisions. Cleanup failures fail the check.
   A failed world check blocks the dependent collision cohort.
2. The comparison uses the production **rigid kernel**, not the full coupled
   world. It feeds identical finite cuboids, masses, initial poses and velocities
   into State Space and MuJoCo discrete/speculative modes. Each trajectory covers
   0.048 model seconds at dt 0.016, 0.008 and 0.002 (3, 6 and 24 ticks).
   It exercises free drift, a thin wall, an occluded second wall, grazing
   clearance, a rotating plate, an impact chain, and a resting stack.

Rigid-kernel continuation includes all kernel inputs and complete tick receipts.
It does not substitute for world accounting, fluid/thermal coupling, real Worker
transport or actor/session qualification. Physical dissipation receipts are kept
as kernel outputs; this harness does not invent a thermal deposition rule.

## What constitutes evidence

- State Space repeats and resumes complete results exactly, including Float64
  bits, signed zero, every field, key order and array order. The lossless codec is
  copied byte-for-byte from R1 preparation commit
  `40ce7d04f02ef45713615a825c22cdce30a0d0e3`, SHA-256
  `995d3ec8bd9d6fdb7eeb00fd42134cd76169c130f4d9645af79ccd392a13dd73`.
  The previous preparation-only runner and frozen R0 files remain unchanged.
- MuJoCo sleeping is disabled. Its complete `mjSTATE_INTEGRATION` vector,
  including solver warm-start state, is captured as little-endian Float64 bytes
  at every tick. Fresh repeats and restore-after-two-ticks must reproduce the
  remaining vectors exactly on the same host/build. No cross-host determinism
  claim follows from this.
- Cross-engine comparison reports position, velocity, angular velocity and
  orientation differences at equal simulated times. It never compares unlike
  engine saves for bitwise equality. Per-backend timestep refinements are
  retained separately. Free drift and grazing have analytical trajectory
  diagnostics; thin-wall cases require both a barrier-side check and observed
  contact. The other cases are observational, not newly qualified physics.
- MuJoCo uses Euler/Newton, fixed `solref`/`solimp`, zero contact margin, no
  sleeping, and automatic numerical reset disabled. Its soft regularized contact
  law is **not** an exact restitution mapping to State Space's impulse law.
  Differences can reflect these model choices, not just detection algorithms.
  MuJoCo mechanical-energy changes are not labeled physical heat or numerical
  error without a separate accounting derivation.
- Two warmups and seven measured trajectories form a small diagnostic cohort.
  Each measured trajectory must reproduce its reference. Keep all raw timings;
  failed samples fail the row and are not replaced. Median and nearest-rank p95
  are reported, including milliseconds per simulated second. This does not
  replace R1's five-session profiling protocol or grant performance acceptance.
- State Space timing includes private rigid stepping, owned kernel input/output,
  generator advancement and bounded progress counting. MuJoCo timing includes
  `mj_step` through its Python binding. Compilation, initialization, state
  encoding, comparisons, observation extraction and restart tests are excluded.
  Different language/binding/ownership overhead prevents a solver-only speedup
  claim. State Space phase counts are work counts, not stage timings.

The MuJoCo [speculative contact documentation](https://mujoco.readthedocs.io/en/stable/computation/speculative.html)
explains the pre-step-velocity limitation and occluded-contact filtering.
Its [sleeping documentation](https://mujoco.readthedocs.io/en/stable/programming/simulation.html#sleeping-islands)
explains why ordinary state restoration is insufficient with sleeping enabled.

## Prepare and inspect without running physics

From the repository root, with existing npm dependencies installed:

```sh
node scripts/benchmark_collision_reference.mjs prepare --output dist/verification/collision-reference-v1
```

Use a new directory each time; preparation refuses to overwrite an existing
packet. It records source hashes, current commit, fixed fixtures/protocol,
esbuild's actual bridge input graph, bundle hash and the incident-hold hash.
The output includes `packet.json`, `packet.sha256` and an unevaluated `engine.mjs`.
Execution rejects changed source, bundle, fixtures or protocol. The output path's
parent must already exist.

Synthetic/translation checks require no engine or MuJoCo execution:

```sh
node --test tests/collision_reference.test.mjs
python -m unittest discover -s tests -p test_collision_reference.py -v
```

## Execute on an eligible supervised host

Use a separate Python 3.13 environment for the optional comparator. For example:

```sh
uv venv --python 3.13 dist/collision-mujoco-venv
uv pip install --python dist/collision-mujoco-venv/bin/python -r scripts/collision-reference/requirements.txt
node scripts/benchmark_collision_reference.mjs run --packet dist/verification/collision-reference-v1 --python dist/collision-mujoco-venv/bin/python
```

On Windows use `dist/collision-mujoco-venv/Scripts/python.exe`. The supervisor
uses the repository environment (or its existing `STATE_SPACE_PYTHON` setting);
the `--python` argument selects only the comparator interpreter. The ordinary
repository supervisor dependencies must be installed on the execution host.

Both MuJoCo 4.0.0 and NumPy 2.3.4 are pinned and checked. MuJoCo's actual
speculative flag must exist and bind successfully; older versions cannot
silently substitute discrete detection. No viewer, GPU adapter, MJX or Warp is
used. Native-library threading is fixed to one for the Python comparator.

Each run gets a fresh directory under its packet. Evidence includes Node and
Python executable hashes, installed MuJoCo/NumPy file hashes, host details,
supervisor identity, full State Space captures, generated MJCF, MuJoCo integration
states, replay results, failures, raw timings and a comparison report. The
supervisor retains its own containment/health receipt. Interrupted cohorts remain
incomplete; their retained rows must not be described as a completed benchmark.

Every report keeps runtime, R1, performance, GPU and Worker acceptance false.
Existing source-bound qualification and the CPU-reference-first roadmap remain
unchanged.

The subsequent [CPU profiling recipe](COLLISION_CPU_PROFILE.md) observes this
unchanged benchmark implementation and requires exact equality to the completed
baseline. It separates full benchmark bookkeeping from the timed kernel API
region and does not replace these original timing samples.
