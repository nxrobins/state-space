# Current validation and support status

This page summarizes the latest retained evidence as of 2026-10-20. State Space
has a public v0.4 (`ca-v4`) 2D API and separately versioned experimental 3D APIs.
Qualification belongs to the recorded source, host and workload. Passing current
CPU checks does not replace a fresh native or whole-product release gate.

| Surface | Latest retained evidence | Support boundary |
| --- | --- | --- |
| Public 2D CPU / WebGPU / native | [C7 reference release](checkpoints/C7.md), subsequent ca-v4 checkpoints, and current installed-package checks | Public v0.4 contract; no new complete cross-platform release claim |
| M1–M4 material/chunk/active 3D | [M1](checkpoints/3D_M1.md), [M2](checkpoints/3D_M2.md), [M3](checkpoints/3D_M3.md), [M4](checkpoints/3D_M4.md) | Experimental, separately versioned APIs; historical qualification is source-bound |
| M5 structures at 32³/64³ | [Final replay and timing regressions](checkpoints/MACOS_128.md) compare CPU/dense/active state and restarts | Exactness covers the recorded scenarios and tick ranges; not arbitrary-world qualification |
| M5 fixed 128³ cut scene | [Three consecutive strict 60 Hz runs](checkpoints/MACOS_128.md), 1,800 measured frames total, zero deadline misses or energy drift | M3 Ultra, visible Chrome, 1920×1080; bounded state/continuation checks, not full 128³ replay or a universal frame-rate guarantee |
| Reactive chamber | [Native acceptance](checkpoints/REACTIVE_CHAMBER.md): real Worker CPU evolution, WebGPU pixels/depth, previews, cancellation, save/replay and resource cleanup | One 8³ chamber, one actor and the tested Mac host; not GPU reactive physics, 16³ or cross-platform qualification |
| Other tactical/reactive surfaces | Bounded CPU/mock contracts and installed SDK checks; [original acceptance history](checkpoints/TACTICAL_INTERVENTIONS.md) | The chamber result does not clear the separate tactical slab, held physical/replay fixtures or every worker API |

## Automated pull-request checks

[Engine verification](../.github/workflows/verify.yml) builds SDK bundles and
declarations, builds the reactive chamber, checks types/lint/formatting, runs
sequential CPU and controller suites, exercises supervisor failure paths, checks
archive restoration, and installs npm/wheel artifacts in independent projects.
All 13 npm entry points and their public declarations are checked. CI retains
receipts and package artifacts for 14 days, including failures. Hosted CI runs no
GPU workloads.

CI uses Node.js 22 and Ubuntu 24.04 with the existing 8 GiB available-memory
preflight. Windows containment checks remain platform-specific. See the
[contributor workflow](../CONTRIBUTING.md) for the local build/check order.

## Native acceptance and remaining scope

The retained Mac results use an Apple M3 Ultra, macOS 26.6.2, native Metal and a
hardware Apple browser adapter. Use the [macOS guide](MACOS.md) for the explicit
bounded stages. Each run retains source hashes, its report and a supervisor
receipt under ignored `dist/verification/`.

The independent watchdog checks heartbeat, deadline and sampled process-tree RSS.
These are userspace controls, not a kernel memory cap or protection from an
OS/GPU-driver hang. Existing incident holds and the legacy demo quarantine remain.
CPU mocks do not establish native responsiveness, shader compilation or pixels.

Remaining scope includes a complete fresh cross-platform release gate, full 128³
replay qualification, larger reactive chambers, GPU reactive physics, and the
specific tactical/physical continuation cases still held in their checkpoints.
The fixed 128³ frame result and 8³ chamber acceptance must not be generalized to
those workloads.

## Choose a runnable client

- [Reactive chamber](../examples/reactive-chamber/README.md): the bounded 8³ real
  Worker application with its fixed native acceptance stage.
- [Structural cavern](../examples/structural-cavern/README.md): the M5 reference
  client; its Mac baseline starts paused at 32³.
- [SDK installation](sdk/core.md): external Python/JavaScript consumers and local
  package verification. Packages are local artifacts; no npm/PyPI publication is enabled.

[Checkpoint summaries](checkpoints/README.md) retain earlier measurements and
limits. [Historical archives](ARCHIVES.md) preserve bulk evidence, including
failed runs. New raw captures belong in release assets with compact provenance
manifests in Git; the repository's history is not rewritten.
