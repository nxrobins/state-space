# Water reflections and refraction: complete 256 × 256 frames

Measured on 2026-10-10 (local date): Windows x64, Intel i9-11900K, NVIDIA RTX 4090,
driver 595.79. Native Python 3.10.16 / wgpu 0.31.0 uses Vulkan with offscreen
output; browser measurements use hardware WebGPU in Headless Chrome 154.
UTC timestamps, source hashes, adapter details, and every raw sample are retained
in [frames.json](water/frames.json).

The shared WGSL renderer adds rippled reflections of the visible scene, including
fire/lava emission, and tinted refraction of submerged terrain. Reflected emission
participates in bloom. A private compute pass scans each column once to locate
water surfaces and floors using integer coordinates. Moved surfaces are rebuilt
each frame, sealed pockets do not mirror the sky, and opaque submerged shelves
block refraction. Rendering consumes committed public state and writes only
private textures; it never transports model energy or schedules physical ticks.

These are artistic screen-space effects for a 2D field. Reflections mirror already
visible scene pixels rather than reconstructing hidden 3D geometry. Reflection
depth is bounded at 96 cells; refraction reaches at most 64 cells below a receiver.
Those bounds and ripple/absorption curves affect presentation alone.

## Complete frame work

256 × 256 simulation, 1920 × 1080 output. Each scene/view/backend measures 120
successive frames after 12 warmup ticks. Timing includes a complete public physics
step, public coordinate copies, uploads, material shading, area-light extraction,
terrain visibility, water geometry/reflections/refraction, bloom, composition, and
GPU completion. Compilation, reference hashing, capture readbacks, and OS scanout
are excluded. Native output is offscreen. GPU resources are retained between frames.

Material and water composition targets are 512 × 512, water geometry and light
maps are 256 × 256, and bloom targets are 128 × 128. Integer water metadata avoids
half-float coordinate rounding. Direct lighting retains its 48-cell radius and
up to eight emitting samples per tile; crossed-cell traversal preserves thin walls.

Styled results, rounded to milliseconds:

| Backend / scene | Median full frame | p95 | Maximum | Median rendering portion |
| --- | ---: | ---: | ---: | ---: |
| Native / burning bridge | 7.14 | 7.70 | 8.15 | 1.69 |
| Native / fully emissive lava | 6.31 | 6.90 | 7.23 | 1.46 |
| Native / lighting gallery | 8.33 | 9.06 | 9.65 | 2.02 |
| Native / water lagoon | 7.53 | 8.12 | 8.80 | 1.86 |
| Browser / burning bridge | 10.10 | 12.10 | 21.00 | 3.60 |
| Browser / fully emissive lava | 9.60 | 12.00 | 16.20 | 3.60 |
| Browser / lighting gallery | 10.55 | 14.00 | 16.80 | 3.50 |
| Browser / water lagoon | 10.00 | 12.10 | 15.70 | 3.85 |

All **1,560 native frames** across plain, styled, alternating, and the lagoon's
water-disabled comparison fit the 16.67 ms budget. The native lagoon with water
disabled measured 7.23 ms median / 7.93 ms p95, with 1.60 ms median rendering work.
The styled lagoon's renderer therefore costs about 0.26 ms more at the median in
this run. Browser medians for lagoon optics on/off were both 10.00 ms, so this
run does not resolve a full-frame difference there.

Unpaced browser tests retain **11 longer samples out of 1,560**, including plain
and alternating views. The styled bridge had two, the styled lighting gallery had
one, and the styled lagoon had none. No samples are discarded or rerun to remove
outliers.

## Requested 60 Hz browser cadence

Separate styled runs use `requestAnimationFrame`, capped at a requested 60 Hz even
on faster displays. Each has 120 measured frames after warmup.

| Scene | Achieved cadence | Median work | p95 | Maximum | Samples over 16.67 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Burning bridge | 59.45 Hz | 10.20 ms | 12.90 ms | 16.70 ms | 1 / 120 |
| Lighting gallery | 59.44 Hz | 10.60 ms | 12.70 ms | 17.80 ms | 1 / 120 |
| Water lagoon | 59.45 Hz | 10.20 ms | 13.70 ms | 16.80 ms | 1 / 120 |

The native results establish full-frame budget headroom on this host. Browser
cadence is approximately 60 Hz, with occasional work overruns and longer callback
intervals retained in the receipt. This run does not establish a locked 60 Hz
browser cadence under all host loads. Native output is offscreen; display callback
cadence is measured separately from GPU-completed work and excludes OS scanout.

## Exactness and active water evidence

All **29 rendered trajectories**—13 native, 13 browser, and three display-paced—
match the JavaScript CPU reference at tick 132, with zero energy drift. Actual
UI A/B, lighting, and water buttons preserve the complete snapshot. No physical
kernel, schedule, registry property, state schema, or energy law changed.

The lagoon seeds 1,152 lava cells and finite initial heat/fuel once. Thick cold
stone basins use ordinary structural anchors in their outer bases; their inner
faces still melt under normal physics. At tick 132, both backends contain **2,374
lava cells and 17,064 water cells**. Playback never replenishes heat or resets cells.

At that final state, actual native images with **direct lighting, bloom, and
refraction disabled** demonstrate reflection alone: **15,788 water cells** change
by more than three RGB levels relative to opaque water; **3,122 water cells** gain
more than 20 red levels. This rejects a benchmark whose reflection sources have
expired, and prevents riverbed refraction or direct-light glow from satisfying
the reflection check.

Native GPU tests independently verify fire/lava reflection, emitter removal,
surface movement, sealed pockets, nearest-floor refraction, and hidden terrain
behind an opaque shelf. Existing tests retain exact one-cell shadows, penumbrae,
transparent-media attenuation, full-energy glow above 255, and wide-grid metadata.
The installed-wheel check exercises an actual fire reflection outside the checkout.

- [Browser lagoon, optics enabled](water/browser-water.png)
- [Browser lagoon, optics disabled](water/browser-water-off.png)
- [Browser lagoon after 132 physical ticks](water/browser-water-final.png)
- [Native lagoon, optics enabled](water/native-water.png)
- [Native lagoon, optics disabled](water/native-water-off.png)
- [Native final reflection, lighting/bloom/refraction disabled](water/native-water-final-isolated.png)
- [Native final opaque-water comparison](water/native-water-final-off.png)
- [Complete initial scenes](water/initial-scenes.json)
- [Raw measurements, identities, and parity checks](water/frames.json)

All **16 release gates passed**. The
[release verification report](water-verification.json) covers the complete
physics corpus, integration clients, installed packages, hardware WebGPU
conformance, and presentation tests. The earlier
[lighting checkpoint](LIGHTING_PERFORMANCE.md) and
[material checkpoint](RENDERING_PERFORMANCE.md) retain their historical baselines.

## Reproduction

Follow [the rendering guide](../RENDERING.md), then:

```powershell
uv run python -m scripts.benchmark_frames --browser-cli <agent-browser-launcher> --output dist/performance/water
uv run python -m engine.verify --report docs/checkpoints/my-water-verification.json --browser-cli <agent-browser-launcher>
```

The harness rejects fallback browser adapters, state/trajectory differences,
expired sources or reflection images, energy drift, browser errors, and source
changes during measurement. Capture readbacks stay outside the frame clock.
