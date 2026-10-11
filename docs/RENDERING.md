# Material rendering

State Space has a built-in WGSL presentation pipeline shared by native Python/wgpu
and browser WebGPU. Material grain, wood patterns, metal highlights, liquid surface
shading, and integrity darkening are cosmetic. Incandescence uses the conserved
energy coordinate and registry phase/chemical stores, including temperatures above
the packed display byte's 255 limit. These are artistic curves in model units.

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

Two blur passes add bloom before filmic tone mapping. Material targets have two
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
attenuating its color through water. Crossed-cell visibility prevents seeing through
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

Open [the burning bridge](http://127.0.0.1:8765/web/). Click the A/B button or press
**B** to change presentation, **Space** to pause, and **R** to restart the bridge.
The hot wooden supports and deck burn through existing engine rules; fragments
fall into the water. Initial heat/fuel is finite. Playback adds no energy or fire.
Plain mode is a palette reference, not a second simulation.

Use **Lighting + shadows** or press **L** to compare direct illumination while
retaining material shading, heat glow, and bloom. Bloom is a lens effect and can
spread over silhouettes; the direct-light visibility pass still blocks opaque
terrain. The native and browser render APIs can disable bloom independently for
shadow inspection.

The [light and shadow gallery](http://127.0.0.1:8765/web/?scene=lighting&paused)
starts paused with 64 finite lava reservoirs, metal receivers, and narrow stone
pillars. Resume to watch heat and material changes under the normal physics. Its
larger reservoirs retain lava through the complete benchmark trajectory; playback
never replenishes their energy. **R** restarts the selected scene.

The [fire and water lagoon](http://127.0.0.1:8765/web/?scene=water&paused) starts
paused with finite lava basins, burning wooden platforms, a deep pool, and a
patterned riverbed. Ordinary structural anchors hold the stone basins above the
water; the wood still burns under normal physics. Use **Water optics** or press
**W** to compare reflections/refraction while keeping the same complete field.

The [smoke and steam chambers](http://127.0.0.1:8765/web/?scene=haze&paused)
start paused with finite gas, lava reservoirs, burning wood, and thin stone
dividers. Use **Volumetric haze** or press **H** to compare against the earlier
gas shading. Use **L** to inspect scattered illumination. The chambers retain
both gas species and active lava through the entire measured trajectory, with
no replenishment during playback.

The [heat shimmer chambers](http://127.0.0.1:8765/web/?scene=heat&paused) use the
same finite reservoirs with cold smoke bands above them. Press **D** or use
**Heat shimmer** to compare distortion at the same complete state. Resume to
watch the shimmer rise while smoke moves, steam condenses, and basin faces melt
under the ordinary physics. The D toggle is independent of H, L, W, and A/B.

The client uses a fixed 60-tick clock with `requestAnimationFrame`. Slow displays
retain simulation backlog rather than skipping physical ticks. Visual animation
uses the completed absolute tick, so pausing also freezes cosmetic flicker.

The [full-frame benchmark](http://127.0.0.1:8765/web/benchmark.html) compares plain,
styled, and alternating views on the bridge, a fully emissive lava field, the
distributed lighting gallery, lagoon, haze, and heat chambers at 256 × 256. The lagoon
adds a water-disabled comparison; the chambers add a haze-disabled comparison.
The heat chambers add a distortion-disabled comparison. Output is 1920 × 1080.
It also runs the styled bridge, lighting gallery, lagoon, haze, and heat chambers
at a requested 60 Hz display cadence. Local results
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
JavaScript field API. The shared source is `web/render.wgsl`; `engine.generate`
bundles it into browser assets and `engine/shaders/material_render.wgsl` for the
installed Python package. No external effects package is required.
The browser API accepts the same independent switches as an options object:
`renderer.render(field, true, { lighting: false, bloom: false, distortion: false })`.
Both APIs also accept independent boolean `reflections` and `refraction` switches;
`water: false` disables both. All switches default to true in the styled view.

## Reproduce the complete frame measurements

```powershell
uv run python -m scripts.benchmark_frames --browser-cli <agent-browser-launcher> --output dist/performance/frames
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

See the [heat distortion report](checkpoints/HEAT_PERFORMANCE.md) for hardware,
distributions, screenshots, and current measured limits. The earlier
[haze frame report](checkpoints/HAZE_PERFORMANCE.md),
[water frame report](checkpoints/WATER_PERFORMANCE.md),
[lighting frame report](checkpoints/LIGHTING_PERFORMANCE.md) and
[material-rendering report](checkpoints/RENDERING_PERFORMANCE.md) retain the
baselines before each respective rendering addition.
