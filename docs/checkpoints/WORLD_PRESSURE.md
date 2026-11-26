# Dense and matrix-free pressure on frozen v2 world ticks

Keep the production dense solver. In the first hosted run, the diagonal-preconditioned matrix-free solver spent 2.62–3.05 times as much CPU time on the captured pressure systems. It also changed how five fixed supports shared load in resting water. Both methods met the original equation residual on every solve. [Hosted run and raw evidence](https://github.com/nxrobins/state-space/actions/runs/45702068361)

| Frozen v2 fixture | Ticks | Faces (first / post-drift) | Active rows per face | Dense CPU ms | Matrix-free CPU ms | Accepted dense / matrix-free |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 63-water cup | 2 | 9 / 8 | 145–149 | 73.70 | 224.81 | 17/17 · 17/17 |
| 99-water tank with wax body | 2 | 27 / 26 | 197–210 | 364.45 | 955.92 | 53/53 · 53/53 |
| 27-water resting cup | 6 | 15 / 16 | 69–72 | 32.10 | 86.67 | 31/31 · 0/31 |

Each timing is the median CPU time to replay **all faces across the listed ticks**. A face is one trial solve on the constraints the active-set algorithm selected together. Each solver ran first and second in fresh Node processes, with one warm-up and three timed repetitions per process. Timings include solver setup, conversion, factorization or iteration. Decoding and checking the answers take place outside the timer. Dense won in both orders for every fixture. These timings cover the private study implementations. The production world solver also reuses matching Cholesky factor prefixes. Whole-tick timings and GPU performance require separate measurements.

## What the resting control caught

Velocity response met the tolerance on all 31 resting-water faces. Every one exceeded both the per-body force and torque tolerances. The worst normalized errors were 0.086881 for force and 0.004275 for torque against a limit of 1e-8. A fixed support can carry a different reaction without changing velocity. The force and torque here are **trial** impulses divided by the world timestep, measured about each assembly's center. The outer active set can discard a trial.

The captured v2 world itself stayed at rest within the six-tick bounds. Peak water speed was 3.67e-8, peak displacement was 1.82e-9, accumulated heat was 5.70e-19, and the largest absolute numerical-energy ledger was 2.90e-8. The matrix-free answers were evaluated offline. In the moving tank, the largest matrix-free torque error was 9.48e-9, close to the 1e-8 limit.

## Reproduction and acceptance

The **World pressure comparison** workflow uses the existing CPU supervisor on hosted Ubuntu and pins Node to the frozen catalogue runtime. The initial run used Node 22.22.3, an AMD EPYC 9V74, and merge revision `3f2062634ada4e20e6eb112bccd722cb14b5ace9`. The machine-readable summary records the revision, runtime, source hashes, packet hashes, raw CPU and wall samples, and child-process peak RSS. Peak RSS includes decoding and warm-up. GitHub retains the raw artifact for 14 days. [Workflow](../../.github/workflows/world-pressure.yml)

- The ordinary public tick runs against the pre-existing v2 catalogue with a work budget of 256. The same fixtures run with capture enabled at a budget of 1. Compare the complete snapshot, report, published work and untouched input. The compressed-liquid rejection must reproduce its stage, work and reason on retry and restore.
- The artifact contains each scene's ordered pressure systems, right-hand sides, reference multipliers, and fluid/body column identities. The current harness also saves the initial world and each complete tick result in a separate `.ticks.v8.gz` packet. Decode packets with gzip and the pinned Node runtime's V8 deserializer. The study verifies the SHA-256 before replay.
- Apply each answer to the original operator. Require the infinity norm of its residual to be at most `1e-11 * max(1, ||rhs||∞)`. Compare generalized velocity and each body's force and torque against the captured production dense trial. Each vector's error is `||actual - expected||∞ / max(1, ||expected||∞)` with a limit of `1e-8`.
- Each timed answer must reproduce its warm-up. The reference dense replay must pass every face. The report retains individual matrix-free failures and raw body loads so a completed study can report an unsuccessful candidate.
