# Material rendering

State Space has a built-in WGSL presentation pipeline shared by native Python/wgpu
and browser WebGPU. Material grain, wood patterns, metal highlights, liquid surface
shading, and integrity darkening are cosmetic. Incandescence uses the conserved
energy coordinate and registry phase/chemical stores, including temperatures above
the packed display byte's 255 limit. These are artistic curves in model units:
glow moves from deep red through orange to amber, and molten lava, metal and glass
add a slow churn with darker crust instead of a flat fill.

The renderer writes HDR material color and emission into separate textures. Fire,
lava, and incandescent materials become dynamic area lights. A GPU pass groups
their radiance into 16 × 16 cell tiles and stores four actual emitting boundary
cells per tile. Up to four additional emitting edge samples soften the shadows.
Grid traversal tests every crossed cell, so even a one-cell stone, wood, or metal
wall blocks light. Water, ice, glass, and gases transmit attenuated light.

Lighting has a 48-cell radius and an artistic, bounded falloff. These limits and
the eight-sample area approximation affect presentation only. The light map has
one texel per simulation cell and uses cell-aligned sampling to preserve thin
walls. No temporal accumulation or extra simulation state is required.

Two blur passes add bloom before filmic tone mapping. Ordinary values use the
per-channel curve. Bright values map their strongest channel and keep the channel
ratios, so hot orange light stays orange instead of clipping to white; only extreme
overexposure whitens a little. Material targets have two
pixels per simulation cell; bloom uses half a pixel per cell. The output preserves
square cells and letterboxes other aspect ratios. A/B mode uses the same field,
with plain catalog colors or material shading, dynamic lighting, shadows, water
optics, volumetric smoke/steam, heat distortion, and bloom.

Water mirrors the visible HDR scene above each exposed surface, including fire,
lava, and their emission. Reflected emission participates in bloom. A private GPU
compute pass walks each column once to locate contiguous water surfaces and floors;
integer geometry stays exact on wide fields. Tick-driven ripples displace the image,
and roughness/depth fade it. Sealed pockets have no exposed reflecting surface.

Refraction bends a shallow ray toward the nearest submerged floor, tinting and
attenuating its color through water. It fades with height above the floor, so the
floor pattern does not repeat up each water column. Crossed-cell visibility prevents seeing through
an intervening opaque shelf. Geometry is rebuilt from each completed state, so moved
water and removed emitters immediately replace the image. The reflection image has
a 96-cell depth limit; refraction reaches at most 64 cells below the receiver.
These are artistic screen-space effects for a 2D field: reflections mirror already
visible scene pixels, without reconstructing hidden 3D geometry or ray-tracing
the above-water scene. Their limits do not change any physical process.

Rendering binds physical coordinates read-only and owns separate GPU resources.
It consumes committed public copies, schedules no physics passes, and performs no
additional physics readback. The current separate rendering device requires an
upload of the three host coordinates each frame. All such copies/uploads are
included in full-frame measurements. Lighting does not transport model energy.
Water optics write only private textures and perform no additional state readback.

Smoke and steam cells seed a compact, wall-aware concentration map at one texel
per cell. An eight-sample front-to-back volume pass integrates absorption and
single-scattered fire/lava light into a two-pixel-per-cell HDR target. Smoke has
stronger extinction and darker scattering than steam. Coherent 3D noise and a
small tick-driven drift add depth without maintaining particles or history.
Opaque terrain clips the volume, and the existing crossed-cell light visibility
keeps one-cell walls from leaking illumination. Water can mirror the lit haze.

This is an artistic extrusion of a 2D gas field into a shallow cosmetic volume;
the engine does not simulate 3D gas density or multiple scattering. Gas movement,
temperature, condensation, and combustion still follow the exact integer physics.
With haze enabled, hot steam uses scattered incident light instead of emitting
its own incandescent glow. Haze adds no energy transport, physical coordinate,
or state readback. Each completed snapshot reconstructs it afresh.

Heat distortion reconstructs a short rising optical plume from full energy-derived
temperatures above 120 model units. A private one-texel-per-cell heat map gathers
up to 20 cells below and two cells sideways, with crossed-cell visibility keeping
walls from leaking the effect. Coherent tick-driven noise shifts the already
composed HDR image by at most 1.6 cells sideways and 0.325 cells vertically.
Terrain and water receivers stay fixed; the displaced position and all four
filtered HDR taps must remain in the open medium. This avoids smearing terrain
silhouettes or changing cell picking. Distortion freezes when the field is paused.

This is a bounded screen-space optical approximation, with no simulated air
velocity or calibrated refractive index. It reconstructs no hidden background
geometry. Flat, dark sky has little contrast to refract; the effect is clearest
in lit haze and flame detail. It changes no gas movement or physical heat flow.

## Burning bridge demo

From the checkout:

```powershell
uv sync
npm ci
npm run build:sdk
uv run python -m http.server 8765 --bind 127.0.0.1
```

Open [the burning bridge](http://127.0.0.1:8765/web/). All demos open paused so
short events are visible from their first tick. **Step 1 tick** (or **.**) advances
one exact tick. **Playback speed** selects 1×, 0.25×, or 0.1×; it changes only how
often ticks are requested. **Space** resumes or pauses; **R** restores the complete
initial state and pauses. The scene selector includes a route back to the bridge.
Use `?play` to opt into immediate playback.

The bridge's masonry carries the cold structure. A narrow hot wooden pin burns,
and expansion joints allow the central span to drop independently. An otherwise
identical unlit control remains standing. Watch the first 12 ticks at 0.1×: the
finite initial fire burns out quickly, and the fallen span eventually lands on
the pier. Playback adds no energy or fuel. **B** switches presentation of the same
complete field; it does not start another simulation.

The [light and shadow gallery](http://127.0.0.1:8765/web/?scene=lighting&paused)
uses four supported lava basins. A metal receiver above each open basin stays
within lighting range. From top left to bottom right, compare a clear path,
a narrow stone baffle, a wide stone baffle, and transparent glass. **L** toggles
direct illumination and shadows. The basins have shallow reservoirs and thick,
cool outer shells; their inner faces still melt under the normal physics.
The receivers and baffles use explicit structural anchors.

The [fire and water lagoon](http://127.0.0.1:8765/web/?scene=water&paused) uses
the same supported basin geometry above a deep pool and striped riverbed.
The small wooden fires are brief; finite lava provides the longer reflection.
**W** compares reflections and refraction at the same state. The cold supports
keep the basins above the water as their inner surfaces change.

The [smoke and steam bays](http://127.0.0.1:8765/web/?scene=haze&paused) have
open tops and air between the gas regions, plus supported lava basins. They
show illuminated haze without making the viewing fixtures into sealed pressure
vessels. **H** compares volume shading and **L** compares scattered light. Gas
moves and mixes, steam may condense, and the initial heat is finite.

The [heat shimmer bays](http://127.0.0.1:8765/web/?scene=heat&paused) add contrasting
smoke bands above the hot reservoirs. Step a few ticks, then press **D** to compare
distortion at exactly the same state. The bands naturally mix; restart for the
clearest initial comparison. Shimmer leaves opaque terrain unchanged.

The [pressure gallery](http://127.0.0.1:8765/web/?scene=pressure&paused) places a
wood dam, metal dam, sealed glass vessel, and vented glass vessel from left to
right. Compare the first 30 ticks at 0.1×: equal water heads breach the wood dam
while the metal holds; identical hot steam doses rupture the sealed vessel while
the vented walls remain. Later condensation and heating can change either vessel,
so their comparison is intentionally about the early pressure response.

All effects can be compared while paused. Bloom spreads over silhouettes as a
lens effect; direct-light visibility still blocks opaque terrain. Native and
browser render APIs can disable bloom independently for shadow inspection.

The client pre-arms `requestAnimationFrame` before asynchronous GPU work and retains
at most one pending display timestamp. Work and edits remain serialized. Rounded
display timestamps have a 0.5 ms tolerance, with any early phase carried forward,
so ordinary callback jitter does not alternate zero and double ticks. The client
uses the interval between raw display callbacks to drop time from callbacks it
could not serve, avoiding a continuing multi-tick catch-up loop after a slow frame. It
uses a fixed 60-tick clock (with the selected viewing speed applied to display time), at most four
ticks per frame. Time that a slow device or a hidden tab could not simulate is
dropped, not repaid later: ticks are never skipped or changed, so the world runs
slower than real time instead of fast-forwarding afterward. Visual animation
uses the completed absolute tick, so pausing also freezes cosmetic flicker.
Paused and unchanged displays keep their image; resizing, edits, and toggles
request a fresh render. Status text updates four times per second.

The [full-frame benchmark](http://127.0.0.1:8765/web/benchmark.html) compares plain,
styled, and alternating views on the bridge, a fully emissive lava field, the
lighting gallery, lagoon, haze, heat, and pressure scenes at 256 × 256. The lagoon
adds a water-disabled comparison; the chambers add a haze-disabled comparison.
The heat chambers add a distortion-disabled comparison. Output is 1920 × 1080.
It also runs the all seven scenes with every effect enabled
for 600 frames after 60 warmup frames at a requested 60 Hz display cadence, using
the production clock and callback pump. The 60 Hz gate requires every completed
frame to meet its 16.67 ms callback deadline, no missed display slots or coalesced
callbacks, and 59.9-60.1 Hz callback/completion/physics cadence. Raw timestamps, physics and
rendering work, completion delays, and failures are retained. This measures completed
application frames; operating-system scanout is outside the measurement. Local results
depend on the device, browser, and host load.

## Native Python rendering

`MaterialRenderer` is an offscreen renderer available in the local Python wheel:

```python
from engine import MaterialRenderer, create_field

with create_field(256, 256) as world, MaterialRenderer(256, 256) as renderer:
    world.set_cell(128, 128, 5, thermal=20)  # Metal.
    world.set_energy(128, 128, 700 * 256)
    world.step(1)
    renderer.render(world)                 # Waits for GPU completion.
    rgba = renderer.read_pixels()          # Optional RGBA8 capture, 1920 × 1080.
    renderer.render(world, styled=False)   # Same physical state, plain palette.
    renderer.render(world, lighting=False) # Keep shading, heat glow, and bloom.
    renderer.render(world, bloom=False)    # Inspect direct light and shadows.
    renderer.render(world, water=False)    # Compare with opaque water shading.
    renderer.render(world, haze=False)     # Compare with the earlier gas shading.
    renderer.render(world, distortion=False) # Compare with steady optics.
    # Inspect reflections independently.
    renderer.render(world, lighting=False, bloom=False, refraction=False)
```

Set `registry` and `output_size` when constructing the renderer. The field's
dimensions and registry must match. `read_pixels()` is an explicit capture
readback; ordinary rendering does not read image pixels back. Close the renderer
or use its context manager. It owns its device independently of the field.

The browser implementation lives in `web/renderer.js` and consumes the public
JavaScript field API. It reuses caller-owned coordinate copies, uniform storage,
and texture views. The browser field separately reuses private readback and
structural-plan buffers. Every completed readback is still validated; committed
storage is swapped only after the full step and GPU error scope succeed, so a
failed multi-tick step can retry from the same state. Ordinary browser ticks put
the 18 ordered physics dispatches in one compute pass, using WebGPU's
[per-dispatch usage scopes](https://www.w3.org/TR/webgpu/#usage-scopes).
Inspection retains its separate per-kernel submissions and independent reports.
Successful browser continuations retain the validated state in its GPU slot,
avoiding three redundant coordinate uploads (0.75 MiB per 256 × 256 tick).
Every public edit, clear, restore, or failed step invalidates that residency.
Retries upload all three committed coordinates before executing the same ticks.
The shared source is `web/render.wgsl`; `engine.generate`
bundles it into browser assets and `engine/shaders/material_render.wgsl` for the
installed Python package. No external effects package is required.
The browser API accepts the same independent switches as an options object:
`renderer.render(field, true, { lighting: false, bloom: false, distortion: false })`.
Both APIs also accept independent boolean `reflections` and `refraction` switches;
`water: false` disables both. All switches default to true in the styled view.

## Reproduce the complete frame measurements

```powershell
uv run python -m scripts.benchmark_frames --browser-cli <agent-browser-launcher> --output dist/performance/frames --require-locked
```

The harness captures the real A/B button, checks unchanged complete state, and
measures 120 frames after 12 warmup ticks for each scene/view/backend. The timing
includes physics, public coordinate copies, uploads, shading, light extraction,
terrain visibility, gas density reconstruction, volumetric extinction/scattering,
water geometry/reflection/refraction, bloom, heat reconstruction/distortion, composition,
and completed GPU work. Initialization, reference hashing, screenshot readbacks,
and operating-system scanout are excluded. Native output is offscreen. Browser
results additionally record display cadence. Complete trajectories must match the
JavaScript CPU reference and native backend, with zero energy drift.

See the [browser pacing report](checkpoints/PACING_PERFORMANCE.md) for sustained
deadline measurements, exact-state evidence, and current measured limits. The earlier
[heat distortion report](checkpoints/HEAT_PERFORMANCE.md),
[haze frame report](checkpoints/HAZE_PERFORMANCE.md),
[water frame report](checkpoints/WATER_PERFORMANCE.md),
[lighting frame report](checkpoints/LIGHTING_PERFORMANCE.md) and
[material-rendering report](checkpoints/RENDERING_PERFORMANCE.md) retain the
baselines before each respective rendering addition.
