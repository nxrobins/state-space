# Volumetric smoke and steam: complete 256 × 256 frames

Measured on 2026-10-10 (local date): Windows x64, Intel i9-11900K, NVIDIA RTX 4090,
driver 595.79. Native Python 3.10.16 / wgpu 0.31.0 uses Vulkan with offscreen
output; browser measurements use hardware WebGPU in Headless Chrome 154.
UTC timestamps, source hashes, adapter details, and every raw sample are retained
in [frames.json](haze/frames.json).

The shared native/browser WGSL renderer reconstructs smoke and steam concentration
from completed physical cells, then integrates absorption and single-scattered
fire/lava light through eight depth samples. Smoke is darker and more absorptive;
steam scatters more light. Coherent 3D noise and tick-driven drift add texture.
Opaque terrain clips the volume, crossed-cell visibility preserves one-cell
walls, and the existing water reflections can mirror the lit haze.

This is an artistic extrusion of a 2D gas field into a shallow cosmetic volume.
It does not add 3D gas simulation, multiple scattering, particles, history, or
physical energy transport. With haze enabled, hot steam scatters incident light
instead of becoming an incandescent emitter. Physical temperature, buoyancy,
condensation, combustion, and all integer energy accounting remain unchanged.

## Complete frame work

256 × 256 simulation, 1920 × 1080 output. Each scene/view/backend measures 120
successive frames after 12 warmup ticks. Timing includes a complete public physics
step, public coordinate copies, uploads, material shading, gas reconstruction,
area-light extraction, terrain visibility, volume extinction/scattering, water
geometry/reflections/refraction, bloom, composition, and GPU completion.
Compilation, reference hashing, capture readbacks, and OS scanout are excluded.
Native output is offscreen. GPU resources are retained between frames.

Concentration and light maps have one texel per cell; the volume and material
targets have two pixels per cell. The density reconstruction uses a compact 5 × 5
gather with crossed-cell visibility. The volume uses eight front-to-back samples
and two coherent noise frequencies. Lighting retains its 48-cell radius and up
to eight actual emitting probes per tile. All added buffers/textures are private
presentation resources; no extra physical readback is performed.

Styled results, rounded to milliseconds:

| Backend / scene | Median full frame | p95 | Maximum | Median rendering portion |
| --- | ---: | ---: | ---: | ---: |
| Native / burning bridge | 7.26 | 8.26 | 10.06 | 1.78 |
| Native / fully emissive lava | 6.20 | 7.00 | 7.47 | 1.36 |
| Native / lighting gallery | 9.67 | 10.84 | 11.93 | 2.23 |
| Native / water lagoon | 7.68 | 9.45 | 10.48 | 2.10 |
| Native / haze chambers | 8.02 | 8.84 | 9.17 | 2.35 |
| Browser / burning bridge | 9.10 | 11.60 | 19.40 | 3.30 |
| Browser / fully emissive lava | 8.70 | 11.00 | 16.50 | 3.30 |
| Browser / lighting gallery | 10.00 | 12.20 | 18.50 | 3.30 |
| Browser / water lagoon | 9.10 | 12.10 | 15.70 | 3.30 |
| Browser / haze chambers | 9.30 | 11.50 | 15.90 | 3.30 |

All **2,040 native frames** across plain, styled, alternating, water-disabled, and
haze-disabled comparisons fit the 16.67 ms budget. Unpaced browser measurements
retain **six longer samples out of 2,040**; the styled haze scene has none. Samples
are not discarded or rerun to remove host/browser outliers.

Haze-disabled chambers measured **8.61 / 9.29 ms** native median/p95 and
**9.70 / 11.60 ms** in the browser. That comparison restores the previous hot-steam
incandescence as well as removing the volume passes, changing the number of
emitting light tiles. It compares complete presentations; it does not isolate
the cost of the density and volume passes. The newer presentation is faster in
this scene despite those additional passes.

## Requested 60 Hz browser cadence

Separate styled runs use `requestAnimationFrame`, capped at a requested 60 Hz even
on faster displays. Each has 120 measured frames after warmup.

| Scene | Achieved cadence | Median work | p95 | Maximum | Samples over 16.67 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Burning bridge | 59.45 Hz | 10.10 ms | 12.40 ms | 17.00 ms | 1 / 120 |
| Lighting gallery | 59.95 Hz | 10.65 ms | 13.30 ms | 16.60 ms | 0 / 120 |
| Water lagoon | 59.95 Hz | 10.05 ms | 11.80 ms | 16.60 ms | 0 / 120 |
| Haze chambers | 59.45 Hz | 10.20 ms | 12.10 ms | 16.90 ms | 1 / 120 |

The native results establish full-frame budget headroom on this host. The haze
browser run sustains approximately 60 Hz with one retained work overrun and
occasional longer callback intervals. It does not establish a locked 60 Hz
cadence under every host load. Display callback timing is separate from completed
GPU work and excludes OS scanout.

## Exactness and active haze evidence

All **38 rendered trajectories**—17 native, 17 browser, and four display-paced—
match the JavaScript CPU reference at tick 132, with zero energy drift. Actual
UI A/B, lighting, water, and haze buttons preserve the complete snapshot. No
physical kernel, tick schedule, registry property, state schema, or energy law
changed.

The closed chambers seed real smoke, hot steam, lava, and burning wood once.
They evolve normally: steam can condense, wood burns, and inner stone basin faces
can melt. At tick 132 both GPU backends contain **22,016 smoke cells, 26,884 steam
cells, and 4,480 lava cells**. Playback never replenishes energy or resets cells.

Final native images with **bloom and water effects disabled** compare lighting
on/off at the same complete state. **2,201 smoke cells and 6,583 steam cells** gain
more than 20 red levels at cell centers. This proves that actual gas still scatters
light at the end of measurement, independently of bloom or reflected illumination.

The water lagoon retains its separate reflection proof with lighting, bloom,
refraction, and haze disabled: **15,788 water cells** change by more than three
RGB levels; **3,122 water cells** gain more than 20 red levels.

Native GPU tests verify fire and lava illuminating both smoke and hot steam,
one-cell light occlusion, wall-clipped density reconstruction, emitter removal,
gas removal, repeatable rendering, and complete-state isolation. Existing tests
retain exact thin-wall shadows, transparent-media attenuation, full-energy glow,
water reflection/refraction, and wide-grid metadata. The installed-wheel check
also renders lit smoke and steam outside the checkout.

- [Browser chambers, haze enabled](haze/browser-haze.png)
- [Browser chambers, earlier gas shading](haze/browser-haze-off.png)
- [Browser chambers, lighting disabled](haze/browser-haze-unlit.png)
- [Browser chambers after 132 physical ticks](haze/browser-haze-final.png)
- [Native chambers, haze enabled](haze/native-haze.png)
- [Native chambers, earlier gas shading](haze/native-haze-off.png)
- [Native final haze, bloom/water disabled](haze/native-haze-final-isolated.png)
- [Native final haze with lighting also disabled](haze/native-haze-final-unlit.png)
- [Complete initial scenes](haze/initial-scenes.json)
- [Raw measurements, identities, and parity checks](haze/frames.json)

All **16 release gates passed**, including 143 native tests. The
[release verification report](haze-verification.json) covers the complete
physics corpus, integration clients, installed packages, hardware WebGPU
conformance, and presentation tests. The earlier [water](WATER_PERFORMANCE.md),
[lighting](LIGHTING_PERFORMANCE.md), and [material](RENDERING_PERFORMANCE.md)
checkpoints retain their historical baselines.

## Reproduction

Follow [the rendering guide](../RENDERING.md), then:

```powershell
uv run python -m scripts.benchmark_frames --browser-cli <agent-browser-launcher> --output dist/performance/haze
uv run python -m engine.verify --report docs/checkpoints/my-haze-verification.json --browser-cli <agent-browser-launcher>
```

The harness rejects fallback browser adapters, state/trajectory differences,
expired gas or sources, missing final scattered light, energy drift, browser
errors, and source changes during measurement. Capture readbacks stay outside
the frame clock.
