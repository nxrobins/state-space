# State Space

[![License](https://img.shields.io/github/license/nxrobins/state-space)](LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/nxrobins/state-space/main)](https://github.com/nxrobins/state-space/commits/main)
[![Open issues](https://img.shields.io/github/issues/nxrobins/state-space)](https://github.com/nxrobins/state-space/issues)
[![GitHub stars](https://img.shields.io/github/stars/nxrobins/state-space)](https://github.com/nxrobins/state-space/stargazers)

State Space is a deterministic cellular material engine for games and simulation
tools. Movement, heat, phase changes, combustion, and structural failure share one
replayable state: water freezes into bonded ice, fuel releases stored energy, and
burning supports can break and drop the fragments they were holding.

Version **0.3** provides native Python GPU, browser WebGPU, and browser/Node.js CPU
backends with a shared state contract. The engine is the core product; the lab and
game prototypes demonstrate how clients can build on it.

- **Exact energy accounting.** Integer energy tracks sensible, latent, and
  chemical stores. Closed-system ticks conserve their total; edits are recorded
  as external input or output.
- **Persistent structures.** Bonds, integrity, and anchors govern support,
  damage, breakage, and coherent fragment movement. Global support paths are
  solved to completion.
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

Open the [engine lab](http://127.0.0.1:8765/examples/lab/). Five experiments cover
support, coherent fragments, burning supports, phase changes, and custom
materials. Inspect cells and bonds, change the scene, switch backends, and export
or restore complete sessions.

The lab starts on the CPU backend. Select WebGPU to use a compatible GPU adapter;
WebGPU requires a secure browser context, including localhost. The lab's small
interactive scenes are separate from the performance workloads below.

For the visual showcase, open the [burning bridge](http://127.0.0.1:8765/web/):
built-in material shading, energy-derived heat glow, and bloom, with an A/B toggle
over the same deterministic field. [Rendering guide and native Python API](docs/RENDERING.md).

## 256 × 256 at 60 Hz

On an **Intel i9-11900K / NVIDIA RTX 4090**, both GPU APIs completed seven
256 × 256 workloads within the **16.67 ms** budget for a 60 Hz simulation. The
workloads cover sparse and dense movement, heat, combustion, supported metal,
a falling bonded plate, and a long support path.

Rounded timings for complete public `step(1)` calls:

| Backend | Median across workloads | Highest p95 | Slowest recorded tick |
| --- | ---: | ---: | ---: |
| Native Python GPU | 4.9–7.0 ms | 8.5 ms | 9.3 ms |
| Browser WebGPU | 5.2–6.8 ms | 9.2 ms | 11.5 ms |

Each workload measured 60 successive calls after four warmup ticks. Timing
includes global support planning, validation, transfers, all 18 physics passes,
and complete state readback. Startup, rendering, and optional pass inspection
have additional costs. These results describe the measured hardware and scenes;
they do not establish the same budget for every device or the CPU backend.

Native and browser complete-state hashes matched on all seven workloads, with
zero energy drift. The GPU path batches each ordinary tick into one command
submission and one contiguous readback; an exact compiled host solver handles
global support without truncating the graph or changing the physics.

See the [performance report](docs/checkpoints/GPU_PERFORMANCE.md) for reproduction
commands, adapter details, and the [native](docs/checkpoints/gpu-tick-optimized.json)
and [browser](docs/checkpoints/gpu-browser-ticks.json) timing receipts.

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

- [Capabilities and limitations](docs/CAPABILITIES.md)
- [State, energy, and snapshot contract](ENGINE_CONTRACT.md)
- [Structural model and diagnostics](docs/STRUCTURES.md)
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

The [GPU release verification](docs/checkpoints/gpu-verification.json) passed all
16 gates, including 31 conformance scenes and 2,304 per-pass comparisons.
Checkpoint evidence and content-addressed package artifacts are retained in Git;
generated evidence is collapsed by default in GitHub review.

## License

[MIT](LICENSE).
