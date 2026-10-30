# State Space

[Documentation index](docs/README.md) · [Contributor guide](CONTRIBUTING.md) · [Architecture](docs/ARCHITECTURE.md) · [Changelog](CHANGELOG.md)

[Current validation and support status](docs/VALIDATION_STATUS.md) · [SDK guide](docs/SDK.md) · [macOS setup](docs/MACOS.md) · [Historical evidence archives](docs/ARCHIVES.md)

[![Engine verification](https://github.com/nxrobins/state-space/actions/workflows/verify.yml/badge.svg)](https://github.com/nxrobins/state-space/actions/workflows/verify.yml)
[![License](https://img.shields.io/github/license/nxrobins/state-space)](LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/nxrobins/state-space/main)](https://github.com/nxrobins/state-space/commits/main)
[![Open issues](https://img.shields.io/github/issues/nxrobins/state-space)](https://github.com/nxrobins/state-space/issues)
[![GitHub stars](https://img.shields.io/github/stars/nxrobins/state-space)](https://github.com/nxrobins/state-space/stargazers)

State Space is a deterministic cellular material engine for games and simulation
tools. Movement, heat, phase changes, combustion, and structural failure share one
replayable state: water freezes into bonded ice, fuel releases stored energy, and
burning supports can break and drop the fragments they were holding.

Version **0.4** (rules `ca-v4`) provides native Python GPU, browser WebGPU, and
browser/Node.js CPU backends with a shared state contract. Separately versioned
experimental 3D, structural, tactical, reactive, and multiphysics APIs build on
the same engine. The engine is the core product; the examples and game prototypes
demonstrate how clients can build on it. No Git tag marks a release yet; the
[changelog](CHANGELOG.md) records what landed and when.

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
- **Experimental 3D line.** Volume worlds (M1), WebGPU terrain (M2), chunked
  worlds (M3), active worlds with resident GPU gameplay (M4), and bonded
  structural terrain (M5), plus reactive materials with real Worker previews and
  exact replay. Each entry has its own rules identity and snapshot format.

## Quick start

Install Python **3.10+**, Node.js (CI uses 22), and [uv](https://docs.astral.sh/uv/).
The checkout pins CPython 3.13 for development; the package itself supports 3.10+.
From the repository root:

```sh
uv sync --locked
npm ci
npm run build:sdk
npm run lab
```

The launcher prints the lab address, normally
`http://127.0.0.1:8765/examples/lab/`, and refuses to start when `dist/sdk/` is
missing. `uv run python -m http.server 8765 --bind 127.0.0.1` serves the same
repository root, from which every client below is opened. Rebuild the SDK and
reload after engine changes; the static server does not hot reload.

The [engine lab](examples/lab/README.md) is the live reference client for the
public 2D SDK. Five experiments cover support, coherent fragments, burning
supports, phase changes, and custom materials. Inspect cells and bonds, change
the scene, switch backends, and export or restore complete sessions. The lab
starts on the CPU backend. Select WebGPU to use a compatible GPU adapter; WebGPU
requires a secure browser context, including localhost. The lab's small
interactive scenes are separate from the performance workloads below.

On macOS, follow the [local setup and bounded verification guide](docs/MACOS.md)
for the explicit native stages.

## Runnable clients

Open each page under `http://127.0.0.1:8765/`. The 2D clients use the public
v0.4 SDK. The 3D clients use experimental entries with their own rules and save
formats; their checkpoints record the measured scope and remaining limits.

| Client | Open | What it shows | Guide · evidence |
| --- | --- | --- | --- |
| Burning bridge showcase | `web/` | Six 2D showcase scenes with built-in material shading, energy-derived heat glow, dynamic fire/lava lighting, soft terrain shadows, lit volumetric smoke/steam, water reflections/refraction, heat distortion, and bloom. All presentation toggles use the same deterministic field. | [Rendering guide](docs/RENDERING.md) · [Demo refresh](docs/checkpoints/DEMO_REFRESH.md) |
| Spillway | `examples/spillway/` | Playable 2D reference: move a character across shared-engine terrain, cut a barricade, heat the bridge support, swim through the aftermath. Integer character collision, gameplay events, complete input recording, exact replay/import/export, and a full-frame benchmark with independent CPU replay. | [Integration guide](examples/spillway/README.md) · [Checkpoint](docs/checkpoints/SPILLWAY.md) |
| Volume Lab | `examples/volume-lab/` | Experimental 3D CPU engine (M1). Orbit a 32³ world, inspect cutaways, edit cells and energy, and export exact snapshots. Physics runs in a worker; the same entry runs in Node. | [Rules and evidence](docs/checkpoints/3D_M1.md) |
| The Crossing | `examples/first-person/` | M2 WebGPU terrain. Carve a dam, release water, freeze a crossing, and walk across. The exact CPU rules run on the GPU with bounded collision readback and complete save/replay. | [Guide](examples/first-person/README.md) · [M2](docs/checkpoints/3D_M2.md) |
| The Cavern | `examples/cavern/` | M3 finite chunked world: seeded 64³ terrain in eight 32³ chunks, exact global physics, cached GPU terrain, and a first-person water/freezing challenge. | [Guide](examples/cavern/README.md) · [M3](docs/checkpoints/3D_M3.md) |
| The Living Cavern | `examples/active-cavern/` | M4 finite 128³ world with exact active tiles, a live activity inspector, and CPU/dense-GPU/sparse-GPU replay checks. `?gameplay=gpu` keeps collision and movement resident behind one completion boundary. | [Guide](examples/active-cavern/README.md) · [M4](docs/checkpoints/3D_M4.md) |
| The Structural Cavern | `examples/structural-cavern/` | M5 bonds, load transfer, thermal weakening, and coherent downward collapse over lava. Starts paused at 32³; 64³ and 128³ are explicit choices. Includes the opt-in geological material style and exposure controls. | [Guide](examples/structural-cavern/README.md) · [M5](docs/checkpoints/3D_M5.md) · [Terrain appearance](docs/TERRAIN_APPEARANCE.md) |
| Reactive sandbox | `dist/reactive-chamber/` after `npm run build:reactive-chamber` | Six fixed 16³ scenarios and the original 8³ reference chamber on the reactive-materials SDK. CPU physics runs in a browser Worker; WebGPU presents the acknowledged scene; save and replay are exact. | [Guide](examples/reactive-chamber/README.md) · [Thermal pack](docs/checkpoints/THERMAL_MATERIALS.md) |
| Hot slab tactical reference | `dist/tactical-slab/` after `npm run build:tactical-slab` | SDK-only tactical sessions: previews, atomic commits, targeting queries, and temporary control. The page checks the runtime safety hold; do not run it before native review permits it. | [Guide](examples/tactical-slab/README.md) · [History](docs/checkpoints/TACTICAL_INTERVENTIONS.md) |
| SDK clients | `examples/sdk/` | Installed-package Node and Python clients, a browser CPU/GPU comparison, and the bounded 3D smoke probes. | [Guide](examples/sdk/README.md) |

Showcase demos open paused. Use **Step 1 tick**, **0.1× playback**, and the
scene-specific viewing notes to catch brief burns and pressure ruptures. The
scene selector returns to any of the six scenes. Try the
[smoke and steam bays](http://127.0.0.1:8765/web/?scene=haze&paused) and press
**H** to compare the volume effect, the
[heat shimmer bays](http://127.0.0.1:8765/web/?scene=heat&paused) and press
**D** to compare distortion, and the
[dams and pressure vessels](http://127.0.0.1:8765/web/?scene=pressure&paused)
to compare wooden/metal dams and sealed/vented steam containers.

The reactive sandbox's six 16³ scenarios are burning support, melt/flow/freeze,
distant collapse, and the three opt-in thermal-pack scenes: copper heat path,
ceramic heat barrier, and wax release valve. On macOS, each scenario has a fixed
owned-browser acceptance stage; run `npm run verify:macos -- --stage chamber-visible`
first, then the `sandbox-*-visible` stages listed in the sandbox guide.

The repository also includes [Element Fighter](game/README.md) and
[Relic Line](tower-defense-rogue/README.md), two Phaser/Vite game prototypes with
their own gameplay simulations, engine snapshot integrations, and package files.

## Measured performance

The retained results below belong to the recorded source, host, and workload.
Hosted CI runs no GPU workload. See [validation status](docs/VALIDATION_STATUS.md)
before generalizing any of them.

### 2D: 256 × 256 at 60 Hz

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
presentation thread. All **62 rendered/replayed trajectories** matched the CPU
reference, including pressure and velocity, with zero thermal/latent/chemical
energy drift. See the [demo refresh report](docs/checkpoints/DEMO_REFRESH.md)
for the fixtures, raw results, and reproduction. The earlier
[pressure](docs/checkpoints/PRESSURE_PERFORMANCE.md),
[GPU tick](docs/checkpoints/GPU_PERFORMANCE.md) and
[browser pacing](docs/checkpoints/PACING_PERFORMANCE.md) reports retain the
workloads they measured.

### 3D: fixed 128³ cut scene at 60 Hz

On an **Apple M3 Ultra** (macOS 26.6.2, visible Chrome at 1920 × 1080), three
consecutive runs of the Structural Cavern cut scene completed all **1,800
measured frames** within 16.667 ms, with zero missed deadlines, zero lost display
slots, and zero energy drift. Completion includes input, exact physics, actor,
mesh, rendering, HUD, validation and GPU completion. This is a result for that
scene and host, not full 128³ replay qualification or a universal frame-rate
guarantee. See [Mac 128³ frame performance](docs/checkpoints/MACOS_128.md).

The reactive sandbox's seven native acceptance stages (the 8³ chamber and the six
16³ scenarios) passed on the same host with real browser Workers and zero energy
drift. The [thermal pack report](docs/checkpoints/THERMAL_MATERIALS.md) records
preview, cancellation, and frame timings per scene.

## Use the SDK

| Family | Purpose | Starting point |
| --- | --- | --- |
| Core 2D (public v0.4) | Shared CPU, WebGPU and native state/energy contract | [Installation, fields and custom materials](docs/sdk/core.md) |
| M1–M5 3D | Finite, active and structural worlds with separate versioned contracts | [Worlds and backends](docs/sdk/worlds.md) |
| Tactical | Speculative edits, game transactions, geometry, provenance and workers over structural worlds | [Sessions and previews](docs/sdk/tactical/sessions.md) |
| Reactive | Catalog-aware materials, bounded CPU evolution, gameplay and worker previews | [Materials and worlds](docs/sdk/reactive/materials.md) |
| Multiphysics foundation | Independent conservation, finite-cuboid and DC reference calculations; the world runtime is not exported | [Physical contracts and release gates](docs/MULTIPHYSICS.md) |

The core 2D API has three runtimes:

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

The npm package exposes 15 entry points: the public 2D engine at the package
root and the experimental families under `state-space-engine/experimental/3d/…`,
as listed in [package.json](package.json). TypeScript clients install the pinned
`@typescript/lib-dom` alias for complete DOM/WebGPU declarations; see the
[browser type setup](docs/sdk/core.md#typescript-browser-types).

The [SDK guide](docs/SDK.md) covers local wheel/npm packaging, browser imports,
custom registries, and complete installed-client examples. Packages are built
and installed locally with `uv build --wheel` and `npm pack`; this repository
does not publish them to a package registry.

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

Experimental entries keep their own boundaries. Reactive snapshots do not convert
into M5 snapshots. Combustion, pressure, stored velocity, rotation, elasticity and
reciprocal player forces are outside M5. The opt-in geological terrain style has
passed static and CPU/mock checks but not native visual acceptance. The
[coupled solver study](docs/COUPLED_SOLVER_STUDY.md) is a CPU-only investigation
of the private multiphysics projection; it changes no public API and establishes
no integrated world speedup.

- [Capabilities and limitations](docs/CAPABILITIES.md)
- [State, energy, and snapshot contract](ENGINE_CONTRACT.md)
- [Structural model and diagnostics](docs/STRUCTURES.md)
- [Pressure, velocity, and failure model](docs/PRESSURE.md)
- [Multiphysics contracts and release gates](docs/MULTIPHYSICS.md)
- [Terrain materials, exposure and direct lighting](docs/TERRAIN_APPEARANCE.md)
- [Rendering guide and native Python API](docs/RENDERING.md)
- [Evolution acceptance and benchmark protocol](docs/EVOLUTION.md) and the [original research brief](ss_program.md)
- [Checkpoint evidence index](docs/checkpoints/README.md) and [roadmap history](ENGINE_ROADMAP.md)
- [Third-party assets](docs/THIRD_PARTY.md)

## Verify the engine

### Bounded CPU checks

After the quick-start installation, from the repository root:

```sh
npm run typecheck
npm run lint
npm run format:check
uv run ruff check .
npm run test:smoke
npm test
npm run verify:packages
```

`npm test` rebuilds the SDK and runs the CPU unit and controller suites
sequentially under the verification supervisor; it starts no native workload and
none of the quarantined legacy demos. `npm run test:smoke` is a small bounded
first run. `npm run verify:packages` builds the wheel and npm tarball, installs
them in independent projects, and checks every public entry and its
declarations. TypeScript 7 performs type checks and declaration emit; Prettier
formats the hand-written sources. The [contributor guide](CONTRIBUTING.md)
explains the build order and focused runs.

### Native checks

Native parity fixtures need a GPU adapter and run one file at a time:

```sh
npm run test:native -- --file engine/conformance.test.ts
```

The other fixtures are `engine/structure.test.ts` and `engine/sdk.test.ts`. The
`gpu` supervisor kind needs NVIDIA telemetry. Mac hosts use the bounded Metal
stages instead: `npm run verify:macos:native -- --stage adapter`, then `sdk` and
`conformance`, followed by the owned-browser 3D and reactive stages of
`npm run verify:macos -- --stage <name>` listed in the [macOS guide](docs/MACOS.md).
Python tests that need an adapter skip without one; set `STATE_SPACE_REQUIRE_GPU=1`
to fail instead. Every supervised workload respects an existing incident hold
under `dist/verification/`.

### Full release gate

The complete gate also runs the game prototypes' tests and builds, so install
their dependencies first:

```sh
npm --prefix game ci
npm --prefix tower-defense-rogue ci
```

The legacy 256 × 256 demo trajectories are quarantined after a workstation freeze
and run only with an explicit opt-in. On an isolated verification host, with
`agent-browser` on `PATH`, the complete verification entry is:

```sh
export STATE_SPACE_RUN_LEGACY_DEMOS=isolated-host
uv run python -m engine.verify --report docs/checkpoints/local-verification.json
```

In PowerShell, use `$env:STATE_SPACE_RUN_LEGACY_DEMOS = 'isolated-host'` for the
first line. Alternatively, set `STATE_SPACE_BROWSER_CLI` to the browser tool's
executable or JavaScript launcher path. Full verification requires native GPU and
hardware WebGPU. It checks lint, properties, long scenarios, native/CPU/browser
conformance, installed SDK clients, the live lab, game regressions, adversarial
evolution checks, and benchmarks. Reports retain failures and source hashes. See
the [incident diagnosis and staged recovery](docs/checkpoints/3D_M4.md#safe-verification)
for the quarantine.

The [merged-catalog verification](docs/checkpoints/pressure-merged-verification.json)
records the 16 release gates, including 35 conformance scenes and 4,416 per-pass
comparisons. Compact checkpoint reports and provenance manifests are retained in
Git. Large historical payloads are preserved in a content-verified release
archive; see the [restoration guide](docs/ARCHIVES.md). Generated evidence is
collapsed in review.

### Continuous integration

[Engine verification](.github/workflows/verify.yml) runs on every pull request
and push: SDK and reactive chamber builds, types, lint, formatting, Python lint,
the smoke and unit suites, compiler API consumers, supervisor and archive
restoration regressions, the installed CPU package client, and a Python 3.10
floor import check. It runs on Ubuntu 24.04 with Node.js 22, retains receipts
and package artifacts for 14 days including failures, and runs no GPU workload.
[GPU verification](.github/workflows/gpu-verification.yml) is a manual workflow
for a self-hosted runner with the `gpu` label; no such runner is registered yet,
so it records no result until one is.

## License

[MIT](LICENSE).
