# Dynamic lighting and soft shadows: complete 256 × 256 frames

Measured on 2026-10-10: Windows x64, Intel i9-11900K, NVIDIA RTX 4090,
driver 595.79. Native Python/wgpu uses Vulkan with offscreen output. Browser
measurements use hardware WebGPU in Chrome. Runtime identity, UTC timestamps,
source hashes, raw samples, and adapter information are retained in
[frames.json](lighting/frames.json).

The native and browser renderers share WGSL for material shading, conserved-energy
heat glow, dynamic area lights, terrain visibility, soft shadows, bloom, and tone
mapping. Fire, lava, and incandescent materials illuminate exposed cool terrain.
Opaque cells block light; water, ice, glass, and gases transmit attenuated light.
Light extraction and visibility use private render targets. Physics coordinates
remain read-only, and no model energy is added, removed, or transported by lighting.

## Complete frame work

256 × 256 simulation, 1920 × 1080 output. Each scene/view/backend measures 120
successive frames after 12 warmup ticks. The clock includes a complete public
physics step, public coordinate copies, renderer uploads, material shading,
light extraction, visibility/shadow sampling, bloom, composition, and GPU completion.
Compilation, reference hashing, screenshots, and OS scanout are excluded. Native
output is offscreen. Rendering resources remain allocated between frames.

Material targets are 512 × 512, the light map is 256 × 256, and bloom targets are
128 × 128. Emission is grouped into 16-cell tiles with up to eight actual emitting
samples per area light. The 48-cell light radius and sampling approximation bound
rendering cost; they do not limit any physical propagation or support planning.
Cell-aligned lighting prevents upsampling from leaking through thin walls.

Styled results, rounded to milliseconds:

| Backend / scene | Median full frame | p95 | Maximum | Median rendering portion |
| --- | ---: | ---: | ---: | ---: |
| Native / burning bridge | 7.01 | 9.18 | 11.69 | 1.47 |
| Native / fully emissive lava | 6.12 | 6.63 | 7.31 | 1.31 |
| Native / distributed lighting gallery | 8.41 | 9.12 | 9.87 | 1.86 |
| Browser / burning bridge | 10.00 | 12.00 | 23.70 | 3.70 |
| Browser / fully emissive lava | 9.90 | 12.10 | 15.60 | 3.60 |
| Browser / distributed lighting gallery | 10.60 | 13.10 | 17.30 | 3.50 |

All **1,080 native frames** across plain, styled, and alternating views fit the
16.67 ms budget. Unpaced browser tests retain occasional longer frames in both
plain and styled views. Two of 120 styled bridge samples and one of 120 styled
gallery samples exceeded the budget; none are filtered out.

The gallery begins with 64 finite lava reservoirs containing 4,096 lava cells.
At tick 132, **2,571 lava cells remain** in both backends, ensuring that the lighting
workload has not cooled into an unlit scene before measurement ends. Initial energy
is supplied once through a complete public snapshot; playback never replenishes it.

## Requested 60 Hz browser cadence

Separate styled runs use `requestAnimationFrame`, capped at a requested 60 frames
per second even on faster displays. Both complete 120 measured frames after warmup.

| Scene | Achieved cadence | Median work | p95 | Maximum | Samples over 16.67 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Burning bridge | 59.95 Hz | 10.05 ms | 12.10 ms | 15.80 ms | 0 / 120 |
| Lighting gallery | 59.94 Hz | 10.65 ms | 13.60 ms | 16.80 ms | 1 / 120 |

These measurements establish native frame-budget headroom and approximately 60 Hz
browser cadence on the measured host. The gallery's one longer paced work sample
and callback interval distributions remain in the receipt. Device, world, browser,
host load, and OS presentation can change the result. Native output is offscreen;
browser cadence is measured separately from GPU-completed frame work.

## Exactness and visual evidence

The real UI A/B and lighting buttons preserve the complete snapshot. Both rendering
backends distinguish plain, shaded-but-unlit, and fully lit images without changing
cells, energy, structure, or tick. All **20 rendered trajectories**—nine native,
nine browser, and two display-paced—agree with the JavaScript CPU reference at
tick 132, with zero energy drift. No physics kernels, schedules, material properties,
state schema, or energy laws changed.

Actual native GPU tests disable bloom to verify light on cool receivers, opaque
one-cell walls, fully blocked shadows, partially lit penumbrae, and transmission
through water, glass, and smoke. Removing an emitter removes its light. A wide-grid
test checks that half-float light metadata cannot round a source into the adjacent
wall: tile-local coordinates retain the actual emitting cell. The existing test
also verifies distinct glow above 255 while the packed thermal byte stays saturated.

- [Browser bridge, fully lit](lighting/browser-styled.png)
- [Browser bridge, lighting disabled](lighting/browser-unlit.png)
- [Browser plain reference](lighting/browser-plain.png)
- [Bridge after 48 physical ticks](lighting/browser-burning.png)
- [Browser lighting gallery](lighting/browser-gallery.png)
- [Browser gallery, lighting disabled](lighting/browser-gallery-unlit.png)
- [Native bridge, fully lit](lighting/native-styled.png)
- [Native bridge, lighting disabled](lighting/native-unlit.png)
- [Native plain reference](lighting/native-plain.png)
- [Native lighting gallery](lighting/native-gallery.png)
- [Native gallery, lighting disabled](lighting/native-gallery-unlit.png)
- [Complete initial scenes](lighting/initial-scenes.json)
- [Raw measurements and hashes](lighting/frames.json)

The [release verification report](lighting-verification.json) covers the full
physics corpus, integration clients, installed SDKs, hardware WebGPU conformance,
and presentation tests. Installed-wheel rendering is checked outside the checkout.
The earlier [material-rendering checkpoint](RENDERING_PERFORMANCE.md) retains the
baseline before dynamic lighting.

## Reproduction

Follow [the rendering guide](../RENDERING.md) to run the bridge and gallery, then:

```powershell
uv run python -m scripts.benchmark_frames --browser-cli <agent-browser-launcher> --output dist/performance/lighting
uv run python -m engine.verify --report docs/checkpoints/my-lighting-verification.json --browser-cli <agent-browser-launcher>
```

The measurement harness rejects software browser adapters, state/trajectory
differences, expired gallery sources, energy drift, browser errors, and source
changes during measurement. Capture readbacks stay outside the frame clock.
