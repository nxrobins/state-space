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
with plain catalog colors or material shading, dynamic lighting, shadows, and bloom.

Rendering binds physical coordinates read-only and owns separate GPU resources.
It consumes committed public copies, schedules no physics passes, and performs no
additional physics readback. The current separate rendering device requires an
upload of the three host coordinates each frame. All such copies/uploads are
included in full-frame measurements. Lighting does not transport model energy.

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

The client uses a fixed 60-tick clock with `requestAnimationFrame`. Slow displays
retain simulation backlog rather than skipping physical ticks. Visual animation
uses the completed absolute tick, so pausing also freezes cosmetic flicker.

The [full-frame benchmark](http://127.0.0.1:8765/web/benchmark.html) compares plain,
styled, and alternating views on the bridge, a fully emissive lava field, and the
distributed lighting gallery at 256 × 256. Output is 1920 × 1080. It also runs the
styled bridge and gallery at a requested 60 Hz display cadence. Local results
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
`renderer.render(field, true, { lighting: false, bloom: false })`.

## Reproduce the complete frame measurements

```powershell
uv run python -m scripts.benchmark_frames --browser-cli <agent-browser-launcher> --output dist/performance/frames
```

The harness captures the real A/B button, checks unchanged complete state, and
measures 120 frames after 12 warmup ticks for each scene/view/backend. The timing
includes physics, public coordinate copies, uploads, shading, light extraction,
terrain visibility, bloom/composition,
and completed GPU work. Initialization, reference hashing, screenshot readbacks,
and operating-system scanout are excluded. Native output is offscreen. Browser
results additionally record display cadence. Complete trajectories must match the
JavaScript CPU reference and native backend, with zero energy drift.

See the [lighting frame report](checkpoints/LIGHTING_PERFORMANCE.md) for hardware,
distributions, screenshots, and current measured limits. The earlier
[material-rendering report](checkpoints/RENDERING_PERFORMANCE.md) retains the
baseline before dynamic lighting was added.
