# State Space SDK

Version 0.4 exposes the ca-v4 material engine in Python, browser WebGPU, and
browser/Node CPU. These backends use the same catalog identity, complete snapshot
format, and pass schedule. The GPU backends require a usable GPU adapter.

## Install and run an external client

From the development checkout:

```powershell
uv build --wheel --out-dir dist/packages
npm pack --pack-destination dist/packages
```

Install the resulting wheel in a Python environment, or the npm tarball in a
JavaScript project. The npm package is private to prevent accidental publication;
local packing and installation are supported. Python runtime requirements are
NumPy and wgpu 0.31.x. Evolution tools and the GLFW viewer are optional extras.
Generation and package building use the development checkout; runtime clients
do not need Node.js for Python, source WGSL paths, or the generator.

`examples/sdk/native.py` and `examples/sdk/node.mjs`, together with `materials.json`,
are complete external clients. `python scripts/verify_sdk.py` builds and installs
both packages into temporary directories outside the checkout, executes the
clients, compares every reported change and final state, and compiles external
TypeScript clients with both installed compiler versions.

## Python field

```python
from engine import create_field

with create_field(64, 48) as world:
    world.set_cell(20, 10, 2, thermal=25)  # water
    world.set_cell(21, 10, 4, thermal=255)  # finite fire
    reports = world.step(16, inspect=True)
    print(world.sample(20, 10), world.energy_balance().drift_q)
    saved = world.snapshot().to_dict()
    world.restore(saved)
```

`create_field` accepts `fill_material` and a validated `registry`. `set_cell`,
`paint_circle`, and `set_energy` record the actual replacement energy as external
input/output. Energy can exceed the display byte's range. `clear` and `restore`
establish a fresh accounting baseline. Mutations are validated before commitment.
`snapshot()` returns immutable storage; `grid`, `energy_q`, and `structure` return independent
copies. Use a context manager or `close()` to release an owned GPU device. An
explicitly supplied `CompositionEngine` is borrowed and remains its owner's
responsibility. Read-only inspection of the last state remains available after
close; further mutations fail.

## Browser and Node fields

```typescript
import { createStateSpaceField, createGpuField, MAT } from 'state-space-engine';

const cpu = createStateSpaceField(64, 48, MAT.AIR);
const gpu = await createGpuField(64, 48);
gpu.setCell(20, 10, MAT.WATER, 25);
await gpu.step(16);
cpu.restore(gpu.packedSnapshot());
console.log(cpu.sample(20, 10), cpu.energyBalance().driftQ);
gpu.close();
cpu.close();
```

The CPU field's `step` is synchronous. WebGPU `step` is asynchronous: await it
before editing, sampling, saving, closing, or stepping the same field again.
Concurrent access is rejected. A failed GPU step retains the last committed
host state; each retry uploads that complete state. WebGPU errors propagate to
the caller. There is no automatic switch of backend.

WebGPU snapshots and samples reflect the last completed step. This SDK currently
reads all three GPU coordinates after every tick for the host structural planner.
Inspection adds readbacks after every pass. This is a hybrid host/GPU backend;
complete tick timing includes planning and transfers. C6 records its supported
scale, and C5 measurements describe the earlier ca-v2 contract.

The standalone ESM build is `dist/sdk/state-space.js`. An HTML import map can map
`state-space-engine` to that file without a bundler. Serve
`examples/sdk/browser.html` over localhost to try the public API and compare the
CPU and GPU implementations. WebGPU and custom-registry hashing need browser
secure-context APIs; Node's CPU backend uses its built-in Web Crypto.

## Extend materials without forking physics

Python `MaterialRegistry(catalog)` and asynchronous JavaScript
`createMaterialRegistry(catalog)` validate complete catalogs. Start from
`DEFAULT_REGISTRY.to_dict()` / `toCatalog()`, or call `extend(records)` to add
complete material records. The sample extension adds copper, molten copper,
resin fuel, and material ID 255 as copper grit.

IDs 0-17 retain their version-2 names. IDs 18-255 can hold extensions. Existing
properties may be changed in a new registry, but any change to properties,
defaults, names, or colors changes the catalog hash. Material ordering and JSON
object-key ordering do not. Registries copy input before validation/hashing and
do not expose writable authoritative arrays. A world keeps its registry for its
entire lifetime. Create another world to use another registry.

A snapshot carries the registry hash, not its full definition. Supply the exact
registry when restoring it. Reconstruct a registry from its exported catalog on
the receiving side; the hash will agree across Python and JavaScript. The default
registry cannot restore custom-registry snapshots, even if the scene happens to
contain only built-in IDs. A property change also makes snapshots incompatible.
No implicit reinterpretation or migration is performed.

Phase families require monotone phase energy, matching latent heat, preserved
fuel/oxidizer identity, correct reverse targets, and separated reverse thresholds.
Combustion requires valid inert products. Undefined targets, malformed numeric
values, missing properties, duplicate identities, and layout changes are rejected.
Materials customize existing physical rules; this is not arbitrary shader-plugin
loading. Existing special handling of air, fire, water, and smoke retains its
built-in identity. Reserved phase/flag values do not create new physical laws.

## Inspect behavior and accounting

Pass reports contain the absolute tick being processed, pass ID, changed cell
indices, before/after packed cells, energy and structure, and before/after component ledgers.
Changes include cells whose energy changes while their display byte stays the
same, and changes confined to bonds or integrity. Replaying the changes reconstructs the full state. Reports are immutable
and cannot alter the simulation. Their aggregate energy delta must be zero for
closed-system physics; external edits are tracked by the field's energy balance.

Collect reports with `step(..., inspect=True)` in Python or
`step(..., {inspect: true})` in JavaScript. Collection is opt-in: storing cell
deltas and synchronizing GPU pass readbacks adds significant time and memory.
The tick identifies the input tick; a complete tick advances the public counter
only after all scheduled passes finish.

Cell edits use integer coordinates and ignore valid placements outside the grid.
Invalid material/energy/coordinate values still fail validation. Sampling floors
finite coordinates in the safe numeric range and clamps them to the grid. Circle painting accepts finite
geometry in the safe numeric range and a nonnegative radius. These conventions
are shared by the native and browser APIs.

Physical units and approximations are specified in `ENGINE_CONTRACT.md`.

## Cohesion, breakage and bulk creation

`set_anchor(x,y,anchored=True)` / `setAnchor(x,y,anchored=true)` pins a cohesive
solid or frozen cell. Broken pins remain fixed and can support other fragments.
Melting, burning into noncohesive products, or explicit replacement removes pins.

`set_integrity(x,y,value,weld=False)` / `setIntegrity(x,y,value,{weld:false})`
sets integer integrity from 0 to 255. Zero breaks reciprocal bonds; cooling and
ordinary repair never recreate broken bonds. Explicit welding, fresh placement,
and solidification can create bonds to adjacent intact cohesive cells.
`inspect_structure()` / `inspectStructure()` predicts the next solve without
changing state. Structural pass reports carry that plan. Diagnostic coordinates
and model limits are described in `STRUCTURES.md`.

For an initial bulk layout, the JavaScript export
`createPhysicsState(packedCells,width,height,registry)` validates packed placement
doses and returns independent `grid`, `energyQ`, and `structure` arrays. Use these
with the current field's snapshot metadata and tick zero for initial restore.
This deliberately creates fresh energy and bonds; use complete snapshots for
continuation. It is never an implicit migration for schema 1/2 saves.

`FieldSample.bonds` contains the original structural bit masks, not a compact
four-bit direction index. Use the public `STRUCTURE_BOND_LEFT_MASK`,
`STRUCTURE_BOND_RIGHT_MASK`, `STRUCTURE_BOND_UP_MASK` and
`STRUCTURE_BOND_DOWN_MASK` exports to decode it. Python samples expose the same
bit positions. Avoid copying numeric masks into a client.

The live reference client is `examples/lab/`. Its controller serializes steps,
edits, backend changes and imports; its renderer consumes committed public-field
samples. [CAPABILITIES.md](CAPABILITIES.md) explains the scenarios, known physical
and scale limits, material versus rule extensions, and the full verification command.

Browser/Node fields also support `field.copyStateInto({ grid, energyQ, structure })`
for renderers that reuse storage. Supply three non-overlapping `Uint32Array`s of
`width * height` elements. The method copies every committed coordinate and returns
its absolute tick, without allocating new coordinate arrays or exposing field storage.
Invalid storage is rejected before any destination is written; calls during a GPU
step fail until that step is awaited. Ordinary getters and snapshots still return
independent copies. Both CPU and WebGPU fields support this optional copy path.

Pressure and velocity sampling, version compatibility and model limits are in [PRESSURE.md](PRESSURE.md). Schema 3 snapshots must not be resumed as schema 4.

## Experimental finite 3D worlds

`state-space-engine/experimental/3d/world` exports the synchronous
`createStateSpaceWorld3D(options?)`; `/experimental/3d/world/gpu` exports
`createGpuWorld3D(options?)`. Both default to a closed 64³ world with eight 32³
chunks, one absolute tick and the existing integer `ca-3d-m1` schedule.
World snapshots have a separate versioned chunk envelope. The bounded M1/M2
volume entries retain their 32,768-cell limit and snapshot compatibility.

The [Cavern guide](../examples/cavern/README.md) covers global-coordinate edits,
bounded collision reads, GPU-resident cached terrain, saves/replay, and limitations.
The [M3 checkpoint](checkpoints/3D_M3.md) records verification and frame evidence.


## Experimental active 3D worlds

`state-space-engine/experimental/3d/active-world` exports
`createStateSpaceActiveWorld3D(options?)`, the dense CPU reference. Its `/gpu`
entry exports `createGpuActiveWorld3D(options?)`, defaulting to exact sparse
execution; `execution: 'dense'` provides a GPU reference. The finite default is
128³ with 32³ storage chunks and 8³ activity tiles. Sleeping/waking changes
work scheduling while preserving the global `ca-3d-m1` law and both physical
coordinates exactly. Activity is derived metadata, absent from portable saves.
The optional GPU `activityReadbackInterval` (0–3,600, default 0) batches diagnostic
readback at matching absolute request-end ticks. `inspectActivity()` returns
isolated cached data until a write, restore or terrain render invalidates it;
physics and snapshots are unchanged. The cavern uses an interval of 60.
Sparse activity also reports `plannerBuilds` and `plannerReuses` for the last
step request. Canonical compaction runs at most once per tick; unique wakes
append to the next pass while the current dispatch keeps an immutable prefix.
`plannerBuilds` counts canonical rebuilds and `plannerReuses` counts passes using
the existing or appended list. These describe work scheduling, not skipped
simulation ticks. List ordering never participates in physical decisions.

The separate snapshot envelope is `finite-active-1`. Existing M1/M2 volume and
M3 world entries keep their bounds and envelopes.
[SDK details and limitations](../examples/active-cavern/README.md) ·
[verification and frame evidence](checkpoints/3D_M4.md).


## Experimental 3D latency diagnostics

GPU factories accept `profiling: true` (default false): as an option on
`createGpuWorld3D` / `createGpuActiveWorld3D`, or the fifth argument to
`createGpuField3D(width, height, depth, fillMaterial, {profiling: true})`.
CPU timings are collected by default. Add `gpuTiming: true` alongside
`profiling: true` to request optional `timestamp-query` support when available.
Unsupported adapters retain CPU timings and explicitly report GPU timestamps
unavailable; disabled GPU timing is distinguished from unsupported hardware.

`inspectLatency(afterId = 0)` synchronously returns isolated records from a
32-record history. IDs increase across restores; each record identifies a
`step`, `render` or resident `gameplay` and its absolute tick. CPU stamps use `performance.now()`:
start, prepared, encoded, submitted, queue completion, field readback readiness,
and operation completion. GPU durations are milliseconds for edits, the complete
physics/planning/certification pass, collision query, mesh and draw. Resident
records additionally separate tools, collision-cache gathering and controller. CPU waits
and GPU durations overlap; do not add them. An individual physics family is not
separately timed because that would require changing compute pass boundaries.

Three reusable timestamp slots bound pending maps. Busy slots report `busy`;
disabled, unsupported, pending and failed diagnostics are explicit. No extra GPU submission
or awaited telemetry readback is added to gameplay. `settleLatency()` waits for
pending telemetry after a measurement loop, for receipt finalization. Diagnostics
never enter snapshots, command tapes, material rules or movement scheduling.

The three first-person examples enable CPU profiling and expose `latency()` through
their existing browser APIs (`crossing`, `cavern`, `activeCavern`). Append
`?gpuTiming=1` for opt-in GPU pass timing; the benchmark retains the chosen mode.
GPU timestamps can perturb timing, so compare that diagnostic mode separately.
Browser input
records separate event timestamps, handler observation and command sampling;
invalid/foreign-clock event timestamps are null. Automated routes are marked
`scripted` and never claim physical input-to-screen latency. Frame receipts retain
all 600 step/render traces and include HUD/telemetry collection in completion time;
final telemetry settlement and report serialization happen after measurement.

GPU timestamps may be quantized. A zero duration means below the measured resolution,
not proof that a pass did no work.


## Optional naturalistic terrain appearance

Chunked GPU terrain renderers expose
`await renderer.setAppearance('naturalistic' | 'diagnostic')`. The SDK default
remains diagnostic. The active cavern example selects naturalistic on startup.
The unchunked M1/M2 renderer does not expose this optional method.

Naturalistic presentation reads committed material/thermal cells to shade rock,
wet contacts, ice and lava, extract one exposed hot light per storage chunk,
sample bounded shadows and apply HDR tone mapping/bloom. It uses the same face
cache and collision surfaces as diagnostic rendering. No physics coordinate,
energy ledger, controller command or snapshot schema changes. Camera and
appearance settings are not stored in physical snapshots.

The first naturalistic selection loads the optional module, compiles its pipelines
and uploads bundled CC0 rock maps with mip chains; later A/B changes reuse them.
Diagnostic startup does not load that payload. Call it while the field is idle.
Invalid modes and calls during another
field operation reject without changing the selected appearance. Closing the
renderer frees both appearances, their light buffer, HDR and volume targets. Normal
resident gameplay still has one queue submission and one completion boundary;
lighting and post-processing add no state readback. Optional GPU timestamp
records include `lighting`, `draw`, `volumetrics` and `toneAndBloom`.

The material pass preserves voxel silhouettes. Diagnostic steam retains its
markers; naturalistic steam is a participating volume. Naturalistic
water and ice trace reflected and refracted rays through committed GPU cells,
including offscreen terrain. Depth absorption, water ripples and ice inclusions
are presentation only. Each ray has a 64-cell/40-voxel budget and at most four
subsequent dielectric interfaces. Secondary hits use simplified direct lighting;
there are no recursive mirror bounces or caustics. Water ripple phase derives
from the completed absolute tick (repeating after 36,000 ticks), including in
resident gameplay; pause and snapshot continuation reproduce it. Optics add no
completion boundary, state readback or optical history buffer.
Wetness is derived from adjacent water, not a new physical material.
A quarter-resolution pass integrates physical steam density and artistic cavern
fog over 32 steps, clipped to the opaque surface depth and 48 voxel units. Two
nearby sources from the existing chunk light list illuminate each ray; bounded
voxel shadows block their light. Depth-aware upsampling composites transmittance
and scattering before tone mapping. Visual drift uses the same completed tick
as water. Steam casts no surface-depth marker in naturalistic mode. There is no
additional physical smoke/fog state, fluid law, simulation pass or GPU readback.
Secondary reflected/refracted rays retain approximate distance fog; volume
multiple scattering, steam self-shadowing and exact radiative transfer are not
implemented.

Naturalistic heat distortion is enabled by default on chunked renderers. Use
`await renderer.setHeatDistortion(boolean)` while idle to compare it independently;
non-booleans, closed renderers and overlapping field operations reject. This is
presentation state and is not serialized into physical snapshots. Diagnostic
appearance ignores it. Switching appearance, restoring snapshots and resizing
preserve the setting.

The existing volume pass integrates bounded visual plumes above exposed hot
lava/molten-glass emitters. World-space turbulence follows the completed tick;
the HDR background is displaced by at most six pixels at 1080p, proportional to
vertical resolution. Terrain shadows, original/donor depth checks and canvas-edge
rejection keep occluded heat from pulling foreground surfaces into the plume.
The 48-voxel/32-sample volume budget and single completion boundary are unchanged.
One extra quarter-resolution rgba16float target holds displacement and plume
metadata (about 0.99 MiB at 1080p). There is no new simulation state or readback.
This is emitter-driven screen-space refraction, not a solved air-temperature or
refractive-index field; reflections and haze are not recursively distorted.
See [heat evidence](checkpoints/CAVERN_HEAT.md),
[haze](checkpoints/CAVERN_HAZE.md), and [water/ice](checkpoints/CAVERN_OPTICS.md).

## Optional resident 3D gameplay

Chunked WebGPU worlds expose `await field.createGameplay(state, rules)`. This is
an experimental fixed-point first-person controller matching the crossing/cavern
examples. It is opt-in; existing `step`, collision queries, rendering and portable
world snapshots retain their contracts. Dimensions must be at least 16 on each axis.
One controller and one terrain renderer may belong to a field at a time.

`state` contains `player` (`x/y/z/vy` in 1/256-voxel units, `grounded`, `wet`,
`jumpHeld`, `cooldown`, `blocked`), `look` (three integer components, length about
256), `status` (`playing`, `won`, `lost`), and prior `carved`/`iceWalk` event flags.
`rules` supplies fixed-point goal bounds `{minX,maxY,minZ,maxZ}`, `fallY`, and an
exclusive voxel `toolCeiling`. Full command records contain absolute `tick`,
`moveX`, `moveZ`, `jump`, `tool` (`none`, `carve`, `freeze`) and `look`.
Commands are limited to the existing examples' 7,200-tick session contract.

```js
const controller = await field.createGameplay(state, rules);
const committed = await controller.step(command, {
  renderer,
  camera: { forward, right, up }, // orthonormal; eye/target come from the GPU
});
// Committed player, look, status, new events, target and absolute tick are owned copies.
// Use committed state for HUD and save/replay after the promise resolves.
```

A presented tick uploads the command, applies reach-limited tool edits using the
previous collision cache, executes the unchanged 27 physical passes, refreshes a
GPU-resident 16³ collision neighborhood, moves the actor, updates the same-tick
camera and target, meshes dirty terrain and draws. These commands share one queue
submission and one awaited completion boundary. Validation and a 512-byte
actor/event/energy-ledger readback complete together. The optional scheduled
activity readback shares this boundary; GPU timestamp diagnostics add their own
asynchronous diagnostic mapping. There is no ordinary collision-neighborhood
transfer to the CPU. Initialization, saves, restore and explicit inspections are
outside this per-frame contract.

`controller.step(command)` without a presentation advances exact gameplay without
rendering. `controller.present({renderer,camera})` updates the paused view and target
without changing the tick, actor, ledger or terrain. Camera movement cannot select
physical work. Terrain culling expands its prior-eye bounds by four voxels, covering
the controller's maximum depenetration and movement; the draw uses the new GPU eye.

Save the committed actor/event history alongside `await field.snapshot()`, using the
example's existing game envelope. After `field.restore(snapshot)`, call
`await controller.restore(state)` to refresh the collision cache. External terrain
steps or edits invalidate the controller until this explicit refresh. Concurrent
operations, stale commands, invalid records and foreign renderers are rejected.
A GPU failure faults the field; recreate it from an application checkpoint.
`controller.close()` releases its buffers; `field.close()` also closes the controller.

The 128³ example selects this path with `?gameplay=gpu` or its backend selector.
Changing the backend resets the level. CPU gameplay remains the default reference.
The existing game snapshot/replay envelope is shared by both paths.
