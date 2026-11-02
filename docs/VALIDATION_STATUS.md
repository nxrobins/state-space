# Current validation and support status

This page summarizes the latest retained evidence as of 2026-11-01. State Space
has a public v0.4 (`ca-v4`) 2D API and separately versioned experimental 3D APIs.
Qualification belongs to the recorded source, host and workload. Passing current
CPU checks does not replace a fresh native or whole-product release gate.

| Surface | Latest retained evidence | Support boundary |
| --- | --- | --- |
| Public 2D CPU / WebGPU / native | [C7 reference release](checkpoints/C7.md), subsequent ca-v4 checkpoints, and current installed-package checks | Public v0.4 contract; no new complete cross-platform release claim |
| M1–M4 material/chunk/active 3D | [M1](checkpoints/3D_M1.md), [M2](checkpoints/3D_M2.md), [M3](checkpoints/3D_M3.md), [M4](checkpoints/3D_M4.md) | Experimental, separately versioned APIs; historical qualification is source-bound |
| M5 structures at 32³/64³ | [Final replay and timing regressions](checkpoints/MACOS_128.md) compare CPU/dense/active state and restarts | Exactness covers the recorded scenarios and tick ranges; not arbitrary-world qualification |
| M5 fixed 128³ cut scene | [Three consecutive strict 60 Hz runs](checkpoints/MACOS_128.md), 1,800 measured frames total, zero deadline misses or energy drift | M3 Ultra, visible Chrome, 1920×1080; bounded state/continuation checks, not full 128³ replay or a universal frame-rate guarantee |
| M6 reactive structural worlds | [Bounded ca-3d-m6 fixtures and cavern scenes](checkpoints/3D_M6.md): CPU tests at 8³/16³ and M1-subset equality with ca-3d-m5; supervised macOS qualification receipts ([volume-m6/mac](checkpoints/volume-m6/mac/)) for the dense and active 8³/16³ parity probes (`m6-tiny-*`: every fixture, GPU equal to the CPU oracle after every tick) and for the burning bridge and thermal valve chambers' gameplay pilots and 1,024-tick dense/active replays at 32³ with pinned tick windows (`m6-gameplay-32-*`, `m6-replay-32-*`), all on the branch's final sources, plus the same chamber stages at 64³ (256-tick replays) from an earlier source set of the same branch; legacy renders unchanged by readback hash | The earlier desktop WebGPU pane runs (tiny parity, chamber pilots and 1,024-tick trajectories at 32³ and 64³) are development checks outside the guarded harness that the supervised receipts supersede; 64³ receipts stay bound to their earlier source set; no 128³ or frame-rate evidence; the incident hold is untouched |
| Reactive sandbox | [Thermal pack and 16³ native acceptance](checkpoints/THERMAL_MATERIALS.md): six scenarios, real Worker evolution, native presentation, cancellation, exact replay and the 8³ regression | Fixed sparse 8³/16³ scenes, one actor and the tested Mac host; not arbitrary dense worlds, larger reactive sizes or cross-platform qualification |
| Multiphysics foundation | Public analytical references; private world and Worker CPU checks; [contracts and open gates](MULTIPHYSICS.md) | Tank refinement, resting support, heated floor-column, mechanism continuation and admissible freezing pass; pressure-driven solidification remains open. Runtime is unexported, with no builder or electrical release |
| Other tactical/reactive surfaces | Bounded CPU/mock contracts and installed SDK checks; [original acceptance history](checkpoints/TACTICAL_INTERVENTIONS.md) | The chamber result does not clear the separate tactical slab, held physical/replay fixtures or every worker API |

## Automated pull-request checks

[Engine verification](../.github/workflows/verify.yml) builds SDK bundles and
declarations, builds the reactive chamber, checks types/lint/formatting, runs
sequential CPU and controller suites, exercises supervisor failure paths, checks
archive restoration, and installs npm/wheel artifacts in independent projects.
All 14 npm entry points and their public declarations are checked. CI retains
receipts and package artifacts for 14 days, including failures. Hosted CI runs no
GPU workloads.

CI uses Node.js 22 and Ubuntu 24.04 with the existing 8 GiB available-memory
preflight. Windows containment checks remain platform-specific. See the
[contributor workflow](../CONTRIBUTING.md) for the local build/check order.

Python tests that need a native adapter skip on hosts without one and report
the reason. The release gate (`python -m engine.verify`) and the manual
[GPU verification workflow](../.github/workflows/gpu-verification.yml) set
`STATE_SPACE_REQUIRE_GPU=1`, which turns that skip into a failure. The GPU
workflow runs only on a self-hosted runner with the `gpu` label, a WebGPU
adapter and NVIDIA telemetry for one GPU; no such runner is registered yet, so it records
no result until one is.

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
replay qualification, reactive worlds beyond the qualified 16³ scenes, GPU reactive physics, and the
specific tactical/physical continuation cases still held in their checkpoints.
The fixed 128³ frame result and bounded 8³/16³ reactive acceptance must not be generalized to
those workloads.

## Choose a runnable client

- [Reactive sandbox](../examples/reactive-chamber/README.md): six bounded 16³
  real Worker scenarios and the original 8³ regression chamber.
- [Structural cavern](../examples/structural-cavern/README.md): the M5 reference
  client; its Mac baseline starts paused at 32³.
- [SDK installation](sdk/core.md): external Python/JavaScript consumers and local
  package verification. Packages are local artifacts; no npm/PyPI publication is enabled.

[Checkpoint summaries](checkpoints/README.md) retain earlier measurements and
limits. [Historical archives](ARCHIVES.md) preserve bulk evidence, including
failed runs. New raw captures belong in release assets with compact provenance
manifests in Git; the repository's history is not rewritten.
