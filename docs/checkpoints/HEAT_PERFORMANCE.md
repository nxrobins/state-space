# Heat distortion: complete 256 × 256 frames

Measured on 2026-10-11 (local date): Windows x64, Intel i9-11900K, NVIDIA RTX 4090,
driver 595.79. Native Python 3.10.16 / wgpu 0.31.0 uses Vulkan with offscreen
output; browser measurements use hardware WebGPU in Headless Chrome 154.
UTC timestamps, exact source identities, adapter details, and every raw sample
are retained in [frames.json](heat/frames.json).

The shared native/browser WGSL renderer adds rising heat shimmer around fire,
lava, and other hot cells. Strength comes from the full conserved-energy coordinate
and existing temperature calculation, including temperatures above the packed
display byte's 255 limit. It reconstructs a private optical plume from each
completed state, then refracts the composed HDR image with coherent tick-driven
noise. Pausing freezes the effect; removing or cooling a source rebuilds it afresh.

The plume is an artistic screen-space approximation. It does not simulate air
velocity, a calibrated refractive index, or hidden background geometry. The
renderer adds no model energy, physical state, particles, or temporal history.
Dark, flat sky has little contrast to refract; lit haze and flame detail show the
shimmer most clearly. Physical gas movement and heat flow remain unchanged.

## Complete frame work

256 × 256 simulation, 1920 × 1080 output. Each scene/view/backend measures 120
successive frames after 12 warmup ticks. Timing includes a complete public physics
step, public coordinate copies, uploads, material shading, gas reconstruction,
area-light extraction, terrain visibility, volume extinction/scattering, water
geometry/reflections/refraction, bloom, heat plume reconstruction, distortion,
composition, and GPU completion. Compilation, reference hashing, capture readbacks,
and OS scanout are excluded. Native output is offscreen. Resources persist between
frames, and all rendering is submitted in one command encoder with one completion
fence.

The new heat map has one HDR texel per simulation cell. A compact gather considers
up to 20 cells below and two cells sideways, rejecting cold sources before phase
property lookups and avoiding occluded plume reconstruction. Strength starts above
120 model temperature units and reaches its artistic cap after 650 additional
units. Crossed-cell traversal blocks one-cell walls. Two coherent noise samples
bound displacement to 1.6 cells horizontally and 0.325 cells vertically. Terrain
and water receivers stay fixed; displacement paths and all four bilinear HDR taps
must remain in the open medium. No additional physical readback is performed.

Styled results, rounded to milliseconds:

| Backend / scene | Median full frame | p95 | Maximum | Median rendering portion |
| --- | ---: | ---: | ---: | ---: |
| Native / burning bridge | 9.00 | 10.53 | 11.55 | 2.15 |
| Native / fully emissive lava | 8.43 | 9.85 | 10.93 | 1.92 |
| Native / lighting gallery | 10.40 | 12.45 | 13.59 | 2.71 |
| Native / water lagoon | 10.24 | 12.97 | 20.79 | 2.74 |
| Native / haze chambers | 10.24 | 13.00 | 25.67 | 3.04 |
| Native / heat chambers | 10.37 | 12.78 | 13.90 | 3.10 |
| Browser / burning bridge | 10.55 | 13.50 | 20.40 | 3.80 |
| Browser / fully emissive lava | 9.55 | 12.20 | 15.30 | 3.60 |
| Browser / lighting gallery | 11.00 | 14.00 | 18.60 | 3.85 |
| Browser / water lagoon | 10.50 | 14.60 | 17.60 | 3.65 |
| Browser / haze chambers | 11.20 | 14.70 | 17.20 | 4.20 |
| Browser / heat chambers | 11.10 | 14.00 | 19.70 | 3.90 |

All **120 styled native heat frames** fit the 16.67 ms budget. Across all six
scenes and views, **five longer native samples out of 2,520** remain in the receipt:
two in styled water and three in styled haze. Unpaced browser tests retain **44
longer samples out of 2,520**, including four in the styled heat scene. No samples
are discarded or rerun to remove outliers. Medians and p95 values fit the budget
for every styled scene on this host; maxima do not establish a locked frame rate.

Heat chambers with distortion disabled measured **10.36 / 13.13 ms** native
median/p95 and **10.65 / 13.90 ms** in the browser. Median native rendering work
was **2.59 ms** without distortion versus **3.10 ms** with it, about 0.51 ms more.
Full-frame native medians were nearly identical; separate serial runs and timing
variance prevent treating that rendering difference as an exact total-frame delta.
The browser's renderer medians were 3.85 ms off / 3.90 ms on. All other effects
and the complete physical trajectory remain the same in this comparison.

## Requested 60 Hz browser cadence

Separate styled runs use `requestAnimationFrame`, capped at a requested 60 Hz even
on faster displays. Each has 120 measured frames after warmup.

| Scene | Achieved cadence | Median work | p95 | Maximum | Samples over 16.67 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Burning bridge | 58.96 Hz | 11.70 ms | 14.60 ms | 17.60 ms | 2 / 120 |
| Lighting gallery | 57.53 Hz | 12.15 ms | 14.80 ms | 20.10 ms | 4 / 120 |
| Water lagoon | 58.48 Hz | 11.40 ms | 14.20 ms | 18.60 ms | 3 / 120 |
| Haze chambers | 58.96 Hz | 12.60 ms | 14.80 ms | 21.70 ms | 2 / 120 |
| Heat chambers | 58.00 Hz | 11.80 ms | 14.70 ms | 19.80 ms | 4 / 120 |

The heat scene has substantial median work headroom, but this browser run achieved
58 Hz, not a locked 60 Hz. The receipt retains work overruns and longer callback
intervals. Results depend on device, browser, and host load. Earlier checkpoints
ran at different times; their measurements do not isolate the incremental cost
of this effect. Callback cadence is separate from completed GPU work and excludes
OS scanout. These paced runs step one tick per callback; they do not use the
interactive client's clock. When this report was written, that clock kept all
unsimulated time as backlog. It now runs at most four ticks per frame and drops
time that it cannot simulate. It never skips or changes a tick, so a slow display
runs the world slower than real time (see [the rendering guide](../RENDERING.md)).

## Exactness and active distortion evidence

All **47 rendered trajectories**—21 native, 21 browser, and five display-paced—
match the JavaScript CPU reference at tick 132 with zero energy drift. Actual UI
A/B, lighting, water, haze, and distortion controls preserve the complete snapshot.
No physical kernel, schedule, registry property, state schema, or energy law
changed.

The heat chambers seed finite lava, fire, wood, steam, and cold smoke bands once.
They evolve normally: smoke moves, steam can condense, wood burns, and basin walls
can melt. At tick 132 both GPU backends retain **4,469 lava cells, 23,253 smoke
cells, and 7,308 steam cells**. Playback adds no energy or replacement sources.

Final native images compare distortion on/off with **bloom and water effects
disabled**, holding lighting and haze fixed. **1,653 open-medium cell centers**
change by more than two RGB levels; **zero terrain/water cell centers** change.
This rejects a trajectory whose shimmer expires before measurement ends and
verifies that the comparison changes only the optical distortion.

Independent native tests use fire and lava with direct lighting, bloom, water,
and haze disabled. They verify visible refraction of smoke detail, greater
distortion at higher energy, full-energy fire temperatures despite the saturated
display byte, repeatable paused pixels, tick-driven motion, exact wall occlusion,
fixed terrain pixels, immediate source removal, plain-view isolation, and zero
energy drift. The installed-wheel check also renders heat distortion outside the
checkout. Existing water and lit-haze proofs disable distortion to keep their
individual visual comparisons isolated.

- [Browser heat chambers, shimmer enabled](heat/browser-heat.png)
- [Browser heat chambers, shimmer disabled](heat/browser-heat-off.png)
- [Browser heat chambers after 132 physical ticks](heat/browser-heat-final.png)
- [Native heat chambers, shimmer enabled](heat/native-heat.png)
- [Native heat chambers, shimmer disabled](heat/native-heat-off.png)
- [Native final distortion, bloom/water disabled](heat/native-heat-final-isolated.png)
- [Native final steady comparison](heat/native-heat-final-off.png)
- [Complete initial scenes](heat/initial-scenes.json)
- [Raw timings, identities, and parity checks](heat/frames.json)

All **16 release gates passed**, including 144 native tests. The
[release verification report](heat-verification.json) covers the full physics
corpus, native presentation tests, integration clients, installed packages, and
hardware WebGPU conformance. Earlier [haze](HAZE_PERFORMANCE.md),
[water](WATER_PERFORMANCE.md), [lighting](LIGHTING_PERFORMANCE.md), and
[material](RENDERING_PERFORMANCE.md) checkpoints retain their historical evidence.

## Reproduction

Follow [the rendering guide](../RENDERING.md), then:

```powershell
uv run python -m scripts.benchmark_frames --browser-cli <agent-browser-launcher> --output dist/performance/heat
uv run python -m engine.verify --report docs/checkpoints/my-heat-verification.json --browser-cli <agent-browser-launcher>
```

The harness rejects fallback browser adapters, state/trajectory differences,
expired gas or sources, missing final distortion, displaced terrain, energy drift,
browser errors, and source changes during measurement. Capture readbacks stay
outside the frame clock.
