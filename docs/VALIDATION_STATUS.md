# Current validation and support status

State Space has a public v0.4 (`ca-v4`) 2D API and separately versioned experimental
3D APIs. Passing a development check does not replace the complete release gate.
The latest macOS work uses an Apple M3 Ultra, macOS 26.6.2, native Metal and a
hardware Apple `metal-3` browser adapter.

| Surface | Current evidence | Support boundary |
| --- | --- | --- |
| Public 2D CPU / WebGPU / native API | Exact native/CPU corpus and browser SDK parity; installed wheel/npm clients | Public v0.4 API; snapshot versions are strict |
| M1–M4 material/chunk/active 3D | Tiny pass corpus and earlier checkpoint evidence | Experimental; new qualification below focuses on M5 |
| M5 structures | 32³ and 64³ CPU/dense/active comparisons, restarts and failure controls | Experimental, with a measured 32³ client baseline |
| Tactical/reactive APIs | Existing bounded CPU and package checks | Experimental; no new worker/physical-runtime qualification claim |

## Automated pull-request checks

[Engine verification](../.github/workflows/verify.yml) runs on pull requests and
main/`codex/**` pushes. It builds all SDK entries and declarations, checks types
and structural lint, runs small sequential CPU fixtures, exercises supervisor
failure paths, tests archive restoration, and installs the npm/wheel artifacts
in an independent temporary project. Receipts and package artifacts are retained
for 14 days, including on failure. There is no GPU workload on hosted CI.

The workflow uses the public-repository Ubuntu 24.04 runner and the existing
8 GiB available-memory preflight. A smaller runner is refused rather than silently
reducing the host safety threshold. Legacy Python multi-statement formatting is
excluded from the broad harness syntax/error lint; the new supervisor/package
files also receive strict Ruff checks. Windows real containment tests remain
platform-specific.

## Mac qualification

Use [the macOS guide](MACOS.md) for setup, bounded commands and the complete
current result table. Each hardware stage has a fresh evidence directory and
source hashes under `dist/verification/`. Qualification covers complete packed
cells, exact energy, structural state, absolute ticks and compatible snapshot
metadata. Dense and active modes also use different storage partitions.

The Mac supervisor now has an independent process watching a bounded pipe,
absolute deadline and sampled process-tree RSS. Lost heartbeat, lost supervisor
and excessive RSS are covered by tiny owned-process failure tests. These are
userspace controls; sampled RSS is not a kernel memory cap, and no userspace
watchdog can recover an OS/GPU-driver hang. Apple GPU thermal/utilization sensors
are unavailable. Existing incident holds and the legacy demo quarantine remain.

The main fixes found by validation were missing WebGPU types in installed package
consumers and a reserved WGSL identifier in the experimental lighting cache. The
cache now compiles and renders on real hardware, with exact presentation/state
isolation. The test runner and its transitive dependencies were updated; the root
npm audit reports zero advisories at this checkpoint.

## Local packages and the playable client

```sh
npm run build:sdk
npm run verify:packages
uv run python -m scripts.verify_packages --native  # fixed Mac Metal profile
npm run lab -- --port 0
```

The package verifier builds a wheel and npm tarball, creates a fresh Python
environment and independent JavaScript project, imports all 13 public entry
points and compiles all their exported declarations. It checks tiny 2D pass
reports and structural falling/replay/invalid-restore behavior. Native mode
compares the installed Metal client to the installed JavaScript CPU client.
Packages remain local artifacts; no npm/PyPI publication is enabled.

Open `/examples/structural-cavern/` on the printed origin. The client starts paused
at 32³. Cross the bridge, cut or heat its supports, compare presentation modes,
and remember/restore the exact world and actor in memory. Reset restores the
initial first-person view; orbit distance stays inside the chamber. UI verification
covers one-tick stepping, checkpoint controls, atomic continuation, zero drift,
presentation isolation and a successful crossing. Larger sizes remain experimental.

Historical bulk evidence is available through the [archive and restoration guide](ARCHIVES.md).
Future raw captures belong in release assets, with compact summaries and provenance
manifests in Git. This does not rewrite historical commits.

Still outside this checkpoint: 128³ qualification, a complete fresh cross-platform
release gate, the quarantined legacy demo trajectories, and the tactical/reactive
worker and physical continuation cases identified in their existing checkpoints.
