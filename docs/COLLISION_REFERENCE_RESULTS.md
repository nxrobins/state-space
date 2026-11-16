# CPU collision comparison: November 8, 2026

The bounded CPU cohort completed **63 rows**: seven fixtures, three timesteps,
and State Space rigid / MuJoCo discrete / MuJoCo speculative collision modes.
All 18 containment/execution stages and all within-backend exact replay checks
passed. **Diagnostic completion does not grant physics, runtime or performance
qualification.** Twelve strict barrier diagnostics failed and remain failed.

The source-bound review is `e5929904a7a64fbb9e366695e16fcf24`, using benchmark
packet `collision-reference-20261108-cpu-v2`, repository HEAD
`0af27b6c928cc3c5fbda7f66536d8b2ccb0c0cdb` plus the hashed private harness.
The [checkpoint](checkpoints/COLLISION_REFERENCE_RESULTS.json) binds the review,
source identities, raw evidence and derived summary. The engine was not changed.

The later [owned-data optimization and fresh comparison](COLLISION_OWNED_OPTIMIZATION.md)
preserves these exact states and physical diagnostics, with separately retained
timings and unchanged qualification gates. The results below remain the original
pre-optimization cohort.

## What ran

Each trajectory covers 48 ms of model time with dt 16, 8 or 2 ms. There are two
warmups and seven measured repeats per row: 441 retained timing samples in total.
The fixtures are free drift, thin wall, occluded wall, grazing clearance, rotating
plate, impact chain and resting stack. Full trajectories, 21 cross-engine
comparison cohorts and 42 within-backend timestep refinements are retained.

The host was an Intel Core i9-11900K, 16 logical CPUs, Windows 10.0.26300 x64,
Node 22.22.3 and CPython 3.13.2. The isolated comparator used mujoco-core 4.0.0 and
NumPy 2.3.4 with one-thread numerical libraries. Both MuJoCo collision modes used
Euler integration and Newton solving; “discrete” here describes collision
detection, not MuJoCo's separately named discrete integrator.

The [protocol](COLLISION_REFERENCE_BENCHMARK.md) retains complete State Space
repeats, budgets 1/7/256, lossless and JSON continuation, cancellation, isolation,
and token ownership checks. MuJoCo repeats and restart-after-two-ticks reproduce
complete `mjSTATE_INTEGRATION` vectors exactly, with sleeping disabled and solver
warm-start state preserved. The separate production-world LEG-WORKER reference
passed its two-preview-tick plus one-continuation-tick recipe. No tolerance-based
cross-engine equality replaced these requirements.

## Thin-wall behavior

A 20 mm-wide cube starts at x = -0.1 m, moving at 20 m/s toward a 10 mm-thick
stationary wall at x = 0. State Space stopped it at the near face for all tested
timesteps. MuJoCo discrete detection missed that wall and the cube ended at
x = 0.86 m. Speculative contacts prevented full passage at all three timesteps,
but permitted shallow intrusion under the configured soft-contact law.

| dt | State Space fully crossed | MuJoCo discrete fully crossed | MuJoCo speculative fully crossed | Speculative maximum sampled intrusion |
| ---: | --- | --- | --- | ---: |
| 16 ms | No | Yes | No | 2.374 mm |
| 8 ms | No | Yes | No | 0.758 mm |
| 2 ms | No | Yes | No | 4.091 mm |

Intrusion is derived from the oriented box extent beyond the near wall surface
at stored tick ends. It is not a continuous-time penetration maximum. State
Space's largest corresponding value was about 1.13e-17 m, at roundoff scale.
The unchanged barrier diagnostic requires the cube center to stay at or before
x = -0.015 m within 1e-5 m and requires observed contact. Both MuJoCo modes fail
that strict diagnostic at all three timesteps, for different physical reasons.
The speculative mode's no-full-passage result does not erase its tolerance failure.

The intrusion sequence is not monotonic under timestep refinement. In addition
to differing contact laws, MuJoCo's default `refsafe` safeguard is enabled. For
Euler it clamps the requested `solref[0] = 0.002` to at least twice the timestep:
effective time constants are 0.032, 0.016 and 0.004 seconds in these rows. The
refinement therefore changes effective contact stiffness as well as integration
resolution. This follows the pinned MuJoCo 4.0 documentation shipped in the wheel
and the [refsafe reference](https://mujoco.readthedocs.io/en/stable/XMLreference.html#option-flag-refsafe).
No safeguard or contact parameter was changed to improve the result.

## Other physical observations

Adding a second wall behind the first produced exactly the same sampled moving
body positions as the single-wall fixture for every backend/timestep. MuJoCo
speculative rows recorded no contact with the occluded second wall. Discrete
rows recorded second-wall contacts at 8 and 2 ms after missing the first wall,
without changing the sampled moving trajectory. These results are consistent
with useful occlusion filtering in this fixture; they do not prove its behavior
for other geometries or distinguish filtering from other causes of no contact.

All nine grazing rows followed the analytical trajectory with zero contacts;
all nine free-drift rows also passed their analytical diagnostic. Thus this
clearance fixture did not expose speculative false contacts.

The rotating-plate fixture had no sampled floor intrusion in State Space or
MuJoCo speculative mode. MuJoCo discrete mode reached approximately 143.9 mm at
16 ms and 15.0 mm at 8/2 ms. These are tick-end geometric observations, not new
pass/fail gates. The resting stack's sampled floor intrusion was at most
1.73e-10 m for State Space and 1.45e-15 m for MuJoCo during this short horizon.
Impact-chain and energy/velocity differences remain recorded observations.
Forty-eight milliseconds does not establish long-term stack stability or a
complete energy budget; mechanical-energy loss is not automatically physical heat.

| Backend | Analytical/barrier passed | Strict barrier failed | Observational |
| --- | ---: | ---: | ---: |
| State Space rigid | 12 | 0 | 9 |
| MuJoCo discrete | 6 | 6 | 9 |
| MuJoCo speculative | 6 | 6 | 9 |

## Timing evidence and interpretation

Measured median wall time per complete 48 ms trajectory ranged from 1.436 to
53.950 ms for State Space, 0.0098 to 0.4885 ms for MuJoCo discrete, and 0.0106 to
0.4984 ms for MuJoCo speculative across the fixtures/timesteps. One State Space
sample took 358.968 ms; it remains in the raw evidence and was not replaced.

For a matched thin-wall fixture, the per-row medians were:

| dt | State Space | MuJoCo discrete | MuJoCo speculative |
| ---: | ---: | ---: | ---: |
| 16 ms | 4.911 ms | 0.0103 ms | 0.0241 ms |
| 8 ms | 7.463 ms | 0.0217 ms | 0.0476 ms |
| 2 ms | 23.585 ms | 0.1040 ms | 0.1771 ms |

These are actual timings under a **6% aggregate Windows Job CPU cap**. State
Space includes generator advancement, owned input/output and bounded progress
counting; MuJoCo measures `mj_step` through Python. Compilation, setup, state
capture and replay checks are excluded. Native code, binding overhead, workload
granularity, scheduling and the CPU cap all affect these measurements. The data
shows a substantial end-to-end harness cost difference, but cannot isolate the
collision solver's cost or support a normal-throughput speedup claim. Two warmups
and seven samples do not fulfill R1's five-session performance protocol.

State Space already performs continuous collision handling: swept candidate
bounds feed translation time-of-impact or bounded rotational contact advance,
with accepted subintervals and trial rollback. See
[the production rigid kernel](../engine/experimental/multiphysics/rigid.ts).
MuJoCo's [speculative approach](https://mujoco.readthedocs.io/en/stable/computation/speculative.html)
uses swept broad-phase bounds, directional conservative advancement, occlusion
filtering and synthetic contact distances for its solver. Its predictions use
pre-step velocities and do not cover every acceleration-induced impact.

The practical lesson is to preserve State Space's time-of-impact and exact replay
contracts while investigating the measured cost. Candidate pruning and the cost
of generator/ownership handling are useful profiling questions, not established
bottlenecks. This evidence does not justify replacing time-of-impact handling with
speculative constraints or weakening replay to obtain a faster result.

## Safety and qualification

Every stage obtained 30 consecutive quiet seconds at no more than 30% host CPU
and at least 8 GiB available RAM. Preflight could observe for at most 90 seconds;
busy samples reset the quiet window and all observations/refusals were retained.
Workloads kept the 6% CPU cap, 4 GiB Job memory cap, 25-second supervisor deadline,
30-second independent watchdog and existing host-health abort policy.

Normal startup, exact-Job cancellation and supervisor-loss containment all passed.
Cancellation reached an empty Job in 2.148 seconds; independent watchdog recovery
after supervisor loss took 2.994 seconds, reason 1, with watchdog/leaf exit 125.
All named Jobs disappeared and no execution lock remains. The original failed
GPU receipt, bound sources and protected CPU performance worktree were preserved.
The incident hold is byte-for-byte unchanged with `blockRecovery: true` and no
recovery permit. No GPU query, graphics context or browser workload ran in this retry.

Earlier host-load refusals, the earlier failed probe and the MuJoCo platform-import
failure remain retained. The successful CPU cohort does not establish the cause
of the Windows freezes or qualify browser/GPU recovery. Runtime, performance,
native Worker, GPU and R1 acceptance remain **false**; the existing roadmap gates
remain open.

Raw local artifacts (the dist directory is ignored by Git):

- [Full comparison JSON](../dist/verification/collision-cpu/e5929904a7a64fbb9e366695e16fcf24/comparison.json)
- [All rows and timing table](../dist/verification/collision-cpu/e5929904a7a64fbb9e366695e16fcf24/comparison.md)
- [Derived summary and containment receipts](../dist/verification/collision-cpu/e5929904a7a64fbb9e366695e16fcf24/summary.json)
- [Immutable review](../dist/verification/collision-cpu/e5929904a7a64fbb9e366695e16fcf24/review.json)

The repository checkpoint contains artifact hashes and compact results;
transfer the local packet as well if another machine needs to independently
inspect the complete measured state and timing evidence.
