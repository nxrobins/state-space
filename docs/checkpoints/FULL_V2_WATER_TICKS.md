# Full v2 water tick profile

On the hosted Xeon, the 99-water tank used 219 ms of CPU per tick, the 63-water cup used 125 ms, and the 27-water resting control used 52 ms. All ten snapshots, reports and work counts matched the frozen v2 trajectories. The ten full result hashes also matched the independently retained results from PR #121. [Hosted profile and artifacts](https://github.com/nxrobins/state-space/actions/runs/45753421912) · [Prior trajectory evidence](https://github.com/nxrobins/state-space/actions/runs/45702717713)

| Frozen trajectory | Ticks | CPU ms/tick | Wall ms/tick | Range of round means, wall ms/tick | Work per tick |
| --- | ---: | ---: | ---: | ---: | --- |
| 63-water cup | 2 | 125.3 | 124.6 | 95.3–164.8 | 58,863 / 58,171 |
| 99-water tank with wax body | 2 | 219.2 | 219.2 | 179.6–231.3 | 118,700 / 117,738 |
| 27-water resting cup | 6 | 51.8 | 51.8 | 40.7–65.3 | 19,636 on five ticks, 19,918 on tick 2 |

CPU and wall figures are medians over nine repetitions of each full trajectory, divided by its tick count. Per-tick timers span admission, all advances at budget 256, validation and the public result copy. Each fixture runs in a fresh single-threaded Node process on one supervised Ubuntu runner. The fixtures, profile setup, digest checks and evidence writes sit outside the timers.

## Where the time goes

These are percentages of elapsed time attributed to stages in the separate diagnostic build. Each column uses one observed round with the median total across seven rounds. The listed groups are disjoint. The remainder includes neighbor construction, rigid sweeps, assemblies, admission, validation, publication and other stages.

| Stage group | 63-water cup | 99-water tank | Resting water |
| --- | ---: | ---: | ---: |
| World contacts plus rigid contact | 23.9% | 25.1% | 18.6% |
| Particle and boundary viscosity | 20.4% | 17.5% | 21.2% |
| Density/divergence projection updates and residual checks | 15.1% | 11.7% | 24.0% |
| Dense factor rows and forward solve | 3.6% | 11.7% | 0.9% |
| Dense Gram assembly | 4.7% | 6.6% | 1.8% |

The independent V8 sampler observed the *ordinary* tick. Of time sampled on an identifiable tick stack, 52.5%, 54.8% and 55.8% respectively included fluid coupling. The viscosity pair routine and its callees accounted for 16.6%, 13.0% and 18.1%. These stack percentages overlap their callers. In the tank, the dense Cholesky inner loop was the hottest individual engine source line. In the resting control, applying constraint impulses was a larger cost. Together these results support keeping the dense solver and investigating viscosity pair work as one shared optimization.

A small first experiment would compute the relative contact-point velocity once per viscosity axis, then reuse that exact vector in the work calculation before either endpoint receives an impulse. The trial must preserve the floating-point operation order, heat ownership, work and rejection behavior. Its benefit requires a paired comparison of the ordinary full ticks.

## Exactness and limits

The public engine and diagnostic bundle each receive a warm-up of at least 24 ticks with a six-CPU-second target and a 30-trajectory cap. Only the diagnostic bundle forwards the two inner fluid stage labels. The timer follows each completed one-work-unit advance, including the first unit after a stage transition. Every measured trajectory, sampled trajectory and diagnostic trajectory matches the full uninstrumented reference. The ordinary reference also has to match the frozen v2 catalogue. The stage work for each tick must add up to the published work.

The earlier hosted run used two diagnostic warm-ups and exaggerated the heavy fixtures’ factor-row costs. Its public timings and replay hashes remain available. Even after warming, one of seven cup diagnostic rounds attributed 30% to factor rows while the other six reported 3.3–4.3%. Use the public timings for latency and both the repeated stages and the ordinary stacks to choose an optimization. These measurements cover server CPU ticks. Browser Worker preview latency and minimum-PC performance need their own measurements. [Earlier run](https://github.com/nxrobins/state-space/actions/runs/45744479699)

The measured merge revision was `d2e0a8a38fc482ee830cfa1ce1f39b855a9341e6` on an Intel Xeon 6975P-C, Node 22.22.3 and V8 12.4.254.21-node.56. The artifact contains both engine bundles, source hashes, individual timings, all seven stage rounds, three standard V8 CPU profiles and the supervisor receipt. The workflow retains the artifact for 14 days. [Profiling workflow](../../.github/workflows/world-tick-profile.yml)
