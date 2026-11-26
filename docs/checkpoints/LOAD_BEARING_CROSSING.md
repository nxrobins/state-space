# Load-bearing crossing on the v2 CPU world

The fixture places a ceramic deck over four water parcels, with one end attached to an anchored abutment. A free ceramic ballast rests on top. The light and heavy cases use the same geometry, starting velocities, temperature, gravity (9.8), and support strength (50). Only ballast mass and the corresponding cuboid inertia change. An unloaded deck measures the dead load. A heavy ballast on a reinforced bond (strength 500) controls for the effect of fracture.

| Case | Ballast mass | Bond strength | Ballast reaction | Total abutment reaction | Fracture tick | Max water travel by tick 160 |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| Unloaded | 0 | 50 | 0 (tare) | 9.800000 | Intact | 0 |
| Light | 1 | 50 | 9.800001 | 19.600001 | Intact | 0 |
| Heavy | 10 | 50 | 98.000005 | 107.800005 | 1 | 0.253388 |
| Reinforced heavy | 10 | 500 | 98.000005 | 107.800005 | Intact | 0 |

Each control deck stayed at height 1.0251. The heavy case broke only the abutment-to-deck bond. Its deck reached height 0.598246 at tick 160. All four water centers first exceeded 0.001 outward travel relative to the reinforced control on tick 10. By tick 160 the *least* outward travel was 0.252624 length units. The largest absolute per-tick energy residual was 0.000509, below the default 0.01 limit. Figures are in model units. [Hosted measurement and trajectory capture](https://github.com/nxrobins/state-space/actions/runs/45877817261)

The table reports upward force at tick 1. Total reaction at the abutment includes deck weight. The runner removes the known weight of both fixed solids and the four resting water parcels from the aggregate boundary reading. It checks the remainder against deck plus ballast weight on every tick that starts with an intact bond, including the fracture tick. After separation the per-tick joint reading is null. The world receipt sums impulses received by every fixed boundary. Subtracting the unloaded reading removes the floor, water, deck and abutment contributions. Reversing the sign and dividing by the tick duration gives the upward force. The check compares that force with both the static weight and the ballast's measured vertical momentum change plus its weight, within 0.00001 force units. Subsequent raw linear and angular boundary impulses are available per tick.

Water displacement is measured at the four parcel centers. The runner pairs each heavy-case parcel with its counterpart under the reinforced deck and measures outward travel along the initial side of the deck. It also retains each parcel's full 3D position and displacement from its starting point. This measures load transfer through a bonded support into parcel motion over a third of a simulated second. Actor locomotion and displaced fluid volume would each need separate evidence.

## Exact replay

The uninterrupted reference advances public v2 tick jobs with a work budget of 256. An independent public world previews and commits one tick at a time with a work budget of 1, restoring JSON saves before ticks 1, 2 and 81. At every tick both complete snapshots and complete reports must match, including reported work. The published state is also compared after commit. Each initial state and ordered sequence of full-result hashes is pinned in the [fixture baseline](../../engine/test-support/fixtures/load-bearing-crossing-v2.json). The canonical digest preserves all finite Float64 bits, including signed zero.

The [workflow](../../.github/workflows/load-bearing-crossing.yml) runs on supervised Ubuntu x64, Node 22.22.3. Its artifact includes per-tick observations in `summary.json`, four gzip-compressed V8 packets containing the full initial snapshots and results, the engine bundle and source digest, and the supervisor receipt. Raw artifacts are retained for 14 days. Windows execution remains held.

## Prior fixture attempts

A higher deck starting at 1.25 broke under the heavy load on tick 1. Its drop into the water exceeded the production numerical-energy limit on tick 27 (residual −2.22130, limit 0.01). An initially tangent deck completed all four histories with exact replay, but its stationary controls pushed the water by about 0.00163 length units. The final fixture uses a 0.0001 vertical clearance above tangency and a 1/480-second step. It keeps the production energy limit and the resting-control tolerance of 0.00001 length units. [Elevated impact run](https://github.com/nxrobins/state-space/actions/runs/45877460983) · [Tangent deck run](https://github.com/nxrobins/state-space/actions/runs/45877620499)
