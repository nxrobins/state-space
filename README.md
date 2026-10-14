# State Space

[![License](https://img.shields.io/github/license/nxrobins/state-space)](LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/nxrobins/state-space/main)](https://github.com/nxrobins/state-space/commits/main)
[![Open issues](https://img.shields.io/github/issues/nxrobins/state-space)](https://github.com/nxrobins/state-space/issues)
[![GitHub stars](https://img.shields.io/github/stars/nxrobins/state-space)](https://github.com/nxrobins/state-space/stargazers)

State Space is a deterministic cellular material engine for games and simulation
tools. Movement, heat, phase changes, combustion, and structural failure share one
replayable state: water freezes into bonded ice, fuel releases stored energy, and
burning supports can break and drop the fragments they were holding.

Version **0.4** provides native Python GPU, browser WebGPU, and browser/Node.js CPU
backends with a shared state contract. The engine is the core product; the lab and
game prototypes demonstrate how clients can build on it.

- **Exact energy accounting.** Integer energy tracks sensible, latent, and
  chemical stores. Closed-system ticks conserve their total; edits are recorded
  as external input or output.
- **Persistent structures.** Bonds, integrity, and anchors govern support,
  damage, breakage, and coherent fragment movement. Global support paths are
  solved to completion.
- **Pressure and velocity.** Water loads dams; trapped hot gas can break walls.
  Persistent integer pressure and quantized velocity drive flow after a breach.
  [The cellular model](docs/PRESSURE.md) defines its units and limits.
- **Portable continuation.** Complete snapshots carry cells, energy, structure,
  the absolute tick, and material-registry identity. Restore across backends with
  the same registry and continue the same simulation.
- **Inspectable and extensible.** Edit and sample fields, inspect individual
  passes, and define custom materials through validated registries.

## Try the engine lab

Install Python **3.10+**, Node.js/npm, and `uv`. From the repository root:

```powershell
uv sync
npm ci
npm run build:sdk
uv run python -m http.server 8765 --bind 127.0.0.1
```

For a playable developer reference, open [Spillway](http://127.0.0.1:8765/examples/spillway/).
Move a character across shared-engine terrain, cut a barricade, heat the bridge
support, swim through the aftermath, and reach the relay. The example includes
integer character collision, gameplay events, complete input recording, exact
replay/import/export, and a full-frame benchmark with independent CPU replay.
All visual effects and game sprites share the renderer's GPU completion boundary.
See the [integration guide](examples/spillway/README.md) for the client/engine
boundary and how to reuse it.

For the experimental 3D CPU engine, open [Volume Lab](http://127.0.0.1:8765/examples/volume-lab/).
Orbit a 32³ world, inspect cutaways, edit cells and energy, and export exact
snapshots. Sand, water, steam and phase changes run in a worker; solids remain
fixed until transformed. The separate `state-space-engine/experimental/3d`
entry runs in browsers and Node. [Rules, limitations and evidence](docs/checkpoints/3D_M1.md).

For a playable 3D integration, open [The Crossing](http://127.0.0.1:8765/examples/first-person/).
Carve a dam, release water, freeze a crossing and walk across. The experimental
`state-space-engine/experimental/3d/gpu` backend runs the exact CPU rules on WebGPU;
terrain faces are generated and rendered on the GPU, with bounded collision
readback for the integer character controller. Save or replay the complete
player and terrain state. [Integration guide](examples/first-person/README.md) ·
[M2 verification and full-frame benchmark](docs/checkpoints/3D_M2.md).

For the finite chunked world, open [The Cavern](http://127.0.0.1:8765/examples/cavern/).
Its seeded 64³ terrain uses eight 32³ chunks, exact global physics, cached GPU
terrain, and a first-person water/freezing challenge.
[World SDK and controls](examples/cavern/README.md) · [M3 evidence](docs/checkpoints/3D_M3.md).

Open the [engine lab](http://127.0.0.1:8765/examples/lab/). Five experiments cover
support, coherent fragments, burning supports, phase changes, and custom
materials. Inspect cells and bonds, change the scene, switch backends, and export
or restore complete sessions.

The lab starts on the CPU backend. Select WebGPU to use a compatible GPU adapter;
WebGPU requires a secure browser context, including localhost. The lab's small
interactive scenes are separate from the performance workloads below.

For the visual showcase, open the [burning bridge](http://127.0.0.1:8765/web/):
built-in material shading, energy-derived heat glow, dynamic fire/lava lighting,
soft terrain shadows, lit volumetric smoke/steam, water reflections/refraction,
heat distortion, and bloom. All presentation toggles use the same deterministic field.
Demos open paused: use **Step 1 tick**, **0.1× playback**, and the scene-specific
viewing notes to catch brief burns and pressure ruptures. The scene selector
returns to any of the six showcases.
Try the [smoke and steam bays](http://127.0.0.1:8765/web/?scene=haze&paused)
and press **H** to compare the volume effect.
Try the [heat shimmer bays](http://127.0.0.1:8765/web/?scene=heat&paused)
and press **D** to compare distortion.
Try the [dams and pressure vessels](http://127.0.0.1:8765/web/?scene=pressure&paused)
to compare wooden/metal dams and sealed/vented steam containers.
[Rendering guide and native Python API](docs/RENDERING.md) ·
[Demo refresh and full-frame measurements](docs/checkpoints/DEMO_REFRESH.md).

## 256 × 256 at 60 Hz

The current **ca-v4** benchmark measures complete 1920 × 1080 rendered frames on
an **Intel i9-11900K / NVIDIA RTX 4090**, with every effect enabled and a 256 × 256
physics grid. Seven scenes each run 600 measured display-paced frames after 60
warmup frames, including the dense emissive stress scene.

The latest run **passes the strict 60 Hz gate**: zero deadline misses across
**4,200 frames**, with a worst callback-to-GPU-completion time of **14.4 ms**.
Callback, completion and physics cadence all stayed within 59.9–60.1 Hz; no
display slots or callbacks were lost or coalesced. The separate browser and native
throughput runs also recorded zero work overruns across 2,916 samples each.

Timing includes all 23 physics passes, global support/pressure planning,
validation, state transfers, every rendering pass and GPU completion. Startup,
reference hashing and OS scanout are excluded. CPU reference replay finishes in
a separate worker before measurement, keeping its allocations off the timed
presentation thread. Production GPU readback and validation waits overlap;
native scratch buffers and render attachments are reused with explicit cleanup.

The initial pressure ruptures are also timed from tick zero: browser styled p95
was 11.6 ms and native styled p95 was 9.38 ms. All **62 rendered/replayed
trajectories** matched the CPU reference, including pressure and velocity, with
zero thermal/latent/chemical energy drift.
See the [demo refresh report](docs/checkpoints/DEMO_REFRESH.md) for the revised
fixtures, raw results, and reproduction. The [earlier pressure performance
report](docs/checkpoints/PRESSURE_PERFORMANCE.md) retains the pre-refresh workloads
and pacing diagnostics; the demo changes alter those workloads.
The earlier [GPU tick](docs/checkpoints/GPU_PERFORMANCE.md) and
[browser pacing](docs/checkpoints/PACING_PERFORMANCE.md) reports describe ca-v3.

## Use the SDK

| Runtime | Entry point | Stepping |
| --- | --- | --- |
| Python, native GPU | `engine.create_field` | Synchronous |
| Browser, WebGPU | `createGpuField` | Asynchronous |
| Browser or Node.js, CPU | `createStateSpaceField` | Synchronous |

Python, from the checkout or an installed local wheel:

```python
from engine import create_field

with create_field(64, 48) as world:
    world.set_cell(20, 10, 2, thermal=25)  # Water.
    world.step(16)
    print(world.energy_balance().drift_q)  # 0

    saved = world.snapshot().to_dict()
    world.restore(saved)
```

JavaScript CPU, after installing the local npm package in your project:

```javascript
import { createStateSpaceField, MAT } from 'state-space-engine';

const world = createStateSpaceField(64, 48, MAT.AIR);
world.setCell(20, 10, MAT.WATER, 25);
world.step(16);
console.log(world.energyBalance().driftQ); // 0n

const saved = world.packedSnapshot();
world.restore(saved);
world.close();
```

For browser GPU execution, use `await createGpuField(width, height)` and
`await world.step(ticks)`. Await each step before editing, sampling, saving, or
closing that field. Request pass reports with Python `inspect=True` or JavaScript
`{ inspect: true }` when debugging; inspection adds synchronization and memory
costs.

The [SDK guide](docs/SDK.md) covers local wheel/npm packaging, browser imports,
custom registries, and complete installed-client examples. Packages are currently
built and installed locally; this repository does not publish them automatically
to a package registry.

## Model and documentation

State Space uses uncalibrated cellular units. Movement exchanges cells, and the
structural model resolves support, damage, and translation of bonded fragments.
Continuum fluid pressure, momentum, elasticity, and structural rotation are not
implemented. Material extensions configure existing rules; new physical laws
require engine changes.

Pressure in 0.4 is a cellular approximation: connected gas temperature and liquid
depth set a bounded target; persistent pressure loads walls and drives quantized
flow. Thermal/latent/chemical energy remains exact. Mechanical energy and momentum
are outside that conservation guarantee. Schema 4 / `ca-v4` snapshots reject older
versions rather than silently applying new physics to old saves.

- [Capabilities and limitations](docs/CAPABILITIES.md)
- [State, energy, and snapshot contract](ENGINE_CONTRACT.md)
- [Structural model and diagnostics](docs/STRUCTURES.md)
- [Pressure, velocity, and failure model](docs/PRESSURE.md)
- [Evolution acceptance and benchmark protocol](docs/EVOLUTION.md)
- [Roadmap and checkpoint history](ENGINE_ROADMAP.md)

The repository also includes [Element Fighter](game/README.md) and
[Relic Line](tower-defense-rogue/README.md), two Phaser/Vite game prototypes with
their own gameplay simulations and engine snapshot integrations.

## Verify the engine

After the root dependency installation above, install the game dependencies:

```powershell
npm --prefix game ci
npm --prefix tower-defense-rogue ci
```

With `agent-browser` on `PATH`, run the complete verification suite:

```powershell
uv run python -m engine.verify --report docs/checkpoints/local-verification.json
```

Alternatively, set `STATE_SPACE_BROWSER_CLI` to the browser tool's executable or
JavaScript launcher path. Full verification requires native GPU and hardware
WebGPU. It checks lint, properties, long scenarios, native/CPU/browser
conformance, installed SDK clients, the live lab, game regressions, adversarial
evolution checks, and benchmarks. Reports retain failures and source hashes.

The [merged-catalog verification](docs/checkpoints/pressure-merged-verification.json)
records the 16 release gates, including 35 conformance scenes and 4,416 per-pass comparisons.
Checkpoint evidence and content-addressed package artifacts are retained in Git;
generated evidence is collapsed by default in GitHub review.

## License

[MIT](LICENSE).
