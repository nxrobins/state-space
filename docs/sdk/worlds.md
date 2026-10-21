# 3D worlds, rendering and resident gameplay

[SDK index](../SDK.md) · [Current validation and support](../VALIDATION_STATUS.md)

These APIs are experimental. The support matrix above defines current qualification;
section-specific limits and runtime holds still apply. Historical implementation
steps and acceptance records remain in the [checkpoint history](../checkpoints/3D_M5.md).

- [Experimental finite 3D worlds](#experimental-finite-3d-worlds)
- [Experimental active 3D worlds](#experimental-active-3d-worlds)
- [Experimental 3D latency diagnostics](#experimental-3d-latency-diagnostics)
- [Optional naturalistic terrain appearance](#optional-naturalistic-terrain-appearance)
- [Optional resident 3D gameplay](#optional-resident-3d-gameplay)
- [Experimental M5 structural worlds](#experimental-m5-structural-worlds)

## Experimental finite 3D worlds

`state-space-engine/experimental/3d/world` exports the synchronous
`createStateSpaceWorld3D(options?)`; `/experimental/3d/world/gpu` exports
`createGpuWorld3D(options?)`. Both default to a closed 64³ world with eight 32³
chunks, one absolute tick and the existing integer `ca-3d-m1` schedule.
World snapshots have a separate versioned chunk envelope. The bounded M1/M2
volume entries retain their 32,768-cell limit and snapshot compatibility.

The [Cavern guide](../../examples/cavern/README.md) covers global-coordinate edits,
bounded collision reads, GPU-resident cached terrain, saves/replay, and limitations.
The [M3 checkpoint](../checkpoints/3D_M3.md) records verification and frame evidence.

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
[SDK details and limitations](../../examples/active-cavern/README.md) ·
[verification and frame evidence](../checkpoints/3D_M4.md).

## Experimental 3D latency diagnostics

GPU factories accept `profiling: true` (default false): as an option on
`createGpuWorld3D` / `createGpuActiveWorld3D` /
`createStateSpaceStructuralWorld3DGPU`, or the fifth argument to
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
and GPU durations overlap; do not add them. M1–M4 keep the combined physics pass. Structural GPU timing additionally
separates material families and active-list collection into individual passes;
repeated stage labels sum their durations within each submission. This diagnostic
mode changes pass boundaries, so acceptance benchmarks must disable profiling.
Structural records describe submissions (a tick can have several); CPU stamps
cover start, submission and completion, while the gameplay commit retains its
separate end-to-end timing. Append `?profile=gpu` to the structural cavern URL
to enable this mode. The default runtime retains its combined material pass.

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
The rock maps ship once, as `state-space-engine/experimental/3d/rock-textures`;
the appearance chunk of every GPU world bundle imports that sibling file when it
loads, instead of carrying its own copy.
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
See [heat evidence](../checkpoints/CAVERN_HEAT.md),
[haze](../checkpoints/CAVERN_HAZE.md), and [water/ice](../checkpoints/CAVERN_OPTICS.md).

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

## Experimental M5 structural worlds

`state-space-engine/experimental/3d/structural-world` and its `/gpu` entry
introduce six-direction bonds, integrity, anchors, load transfer, thermal
weakening and coherent downward collapse. These entries have their own schema
and rules identity; the earlier 2D and 3D APIs retain their behavior. Older
snapshots are rejected by M5 rather than silently acquiring structural state.

See [the Structural Cavern integration guide](../../examples/structural-cavern/README.md)
for CPU/GPU setup, transactional edits and resident gameplay, and
[the M5 rules and evidence](../checkpoints/3D_M5.md) for acceptance status and limits.
The existing 3D resident-controller description above applies to M1–M4. M5 uses
structural edit batches and may need additional completion boundaries when its
global support solve cannot be reused. Combustion, pressure, stored velocity,
rotation, elasticity and reciprocal player forces are outside M5.
