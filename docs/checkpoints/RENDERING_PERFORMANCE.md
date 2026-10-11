# Material rendering: complete 256 × 256 frames

Measured on 2026-10-10: Windows x64, Intel i9-11900K, NVIDIA RTX 4090, driver
595.79. Native Python/wgpu uses Vulkan and offscreen output. Browser measurements
use hardware WebGPU in Chrome; runtime and adapter identity are retained in
[frames.json](rendering/frames.json).

The shared WGSL renderer adds material patterns, surface shading, conserved-energy
incandescence, HDR emission, separable bloom, and tone mapping. Plain/styled A/B
views consume the same committed field. No physics kernels, schedules, material
properties, state schema, or energy laws were changed.

## Complete frame work

256 × 256 simulation, 1920 × 1080 output. Each scene/view/backend measures 120
successive frames after 12 warmup ticks. The clock includes a complete public
physics step, public coordinate copies, renderer uploads, all shading/composition
passes, and GPU completion. Compilation, reference hashing, screenshots, and OS
scanout are excluded. The material targets are 512 × 512; bloom targets are
128 × 128. Resources remain allocated between frames.

Styled results, rounded to milliseconds:

| Backend / scene | Median full frame | p95 | Maximum | Median rendering portion |
| --- | ---: | ---: | ---: | ---: |
| Native / burning bridge | 6.44 | 7.03 | 9.10 | 1.01 |
| Native / fully emissive lava | 6.07 | 6.86 | 7.28 | 1.02 |
| Browser / burning bridge | 10.00 | 12.10 | 22.90 | 3.75 |
| Browser / fully emissive lava | 9.30 | 12.10 | 15.60 | 3.40 |

Native frames stayed within 16.67 ms across all 720 measured plain, styled, and
alternating frames. The unpaced browser bridge tests retained occasional over-
budget frames, including three of 120 styled samples. These outliers occur in
both physics and renderer completion waits; they are not omitted from receipts.

## Requested 60 Hz browser cadence

A separate styled bridge run uses `requestAnimationFrame`, capped at a requested
60 ticks/frames per second even on faster displays. After warmup, 120 completed
frames averaged **59.95 Hz**. Full frame work had **10.70 ms median**, **13.60 ms
p95**, and **14.80 ms maximum**. All 120 work samples fit the 16.67 ms budget.
The retained callback intervals also expose display scheduling jitter.

This establishes the target on the measured host and two scenes. It is not a
guarantee for every world, device, browser, background load, or OS presentation
path. Native measurements are offscreen; browser cadence is measured separately
from completed GPU work. Rendering currently owns a separate device and uploads
the already committed host state. Those transfers are included in the table.

## Exactness and visual evidence

The real UI A/B button preserves the complete snapshot. Both rendering backends
produce visibly distinct plain/styled images without changing cells, energy,
structure, or tick. Every plain, styled, alternating, and paced trajectory agrees
with the JavaScript CPU reference at tick 132; native and browser hashes agree,
with zero energy drift. The native GPU test also checks distinct glow at two
temperatures above 255, while the packed thermal byte remains identical.

- [Plain browser view](rendering/browser-plain.png)
- [Material shading and bloom](rendering/browser-styled.png)
- [Burned supports and falling fragments at tick 48](rendering/browser-burning.png)
- [Native plain output](rendering/native-plain.png)
- [Native shaded output](rendering/native-styled.png)
- [Complete initial scenes](rendering/initial-scenes.json)
- [Raw distributions, hashes, adapters, and commands](rendering/frames.json)

The [release verification report](render-verification.json) checks the full
physics corpus, integration clients, installed SDKs, and the new presentation
tests. The installed Python wheel is also tested for renderer assets and render
isolation outside the checkout.

## Reproduction

Follow [the rendering guide](../RENDERING.md) for dependency installation and the
interactive demo. Then run:

```powershell
uv run python -m scripts.benchmark_frames --browser-cli <agent-browser-launcher> --output dist/performance/frames
uv run python -m engine.verify --report docs/checkpoints/my-render-verification.json --browser-cli <agent-browser-launcher>
```

The measurement harness rejects software adapters, incomplete state comparisons,
energy drift, browser errors, and source changes during the measurement. Full
sample arrays and source hashes remain in the receipt.
