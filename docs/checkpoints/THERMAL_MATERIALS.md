# Thermal material pack v1

Implementation: `0d0780bcf5a0a20b3ca3b288360a6e3330e2ed8a`. [Evidence index](THERMAL_MATERIALS.json).
The five-entry [opt-in catalog](../sdk/reactive/materials.md#thermal-material-pack-v1)
adds copper/molten copper, ceramic and wax/molten wax. Three sparse 16³ scenes
exercise the existing physics; builtin catalogs and all four original scenario
identities are preserved. No solver or M5/GPU material contract changed.

## Observed behavior

- One 46,080 Q pulse at the copper inlet melts the distant wax by tick 10.
  Replacing only the middle copper cell with ceramic keeps that wax near its
  starting temperature while the inlet melts, flows away and refreezes.
- A 20,480 Q pulse melts the wax valve. Water escapes; cooling the moved wax
  refreezes it. Both wax phases retain their chemical energy through phase
  changes and burn only with sufficient heat and adjacent oxidizer.
- Saves select their original catalog through the fixed scenario identity.
  Replay/continuation is exact under both catalogs; changed definitions reject.
  The original 8³ initial and heated-commit hashes are unchanged.

## Native acceptance

All seven stages passed on the M3 Ultra / macOS 26.6.2 / Chrome 155 host with
real browser Workers and native Metal WebGPU presentation. Energy drift and
browser console errors were zero. Units below are milliseconds except RSS (MiB).

| Scene | Preview p95 | Cancel p95 | Camera maximum | Application maximum | Peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 8³ reference | 19.1 | 1.4 | 2.0 | 5.4 | 1861 |
| Copper heat path | 110.4 | 1.0 | 2.4 | 5.5 | 1978 |
| Ceramic heat barrier | 111.2 | 0.8 | 2.4 | 10.4 | 1979 |
| Wax release valve | 111.0 | 1.3 | 1.8 | 9.2 | 1963 |
| Burning support | 110.9 | 1.2 | 1.7 | 9.5 | 1974 |
| Melt / flow / freeze | 111.8 | 0.8 | 3.1 | 5.9 | 2022 |
| Distant collapse | 111.6 | 1.2 | 1.8 | 9.4 | 2019 |

Each preview/cancel percentile uses 12 samples. Camera timing includes GPU
completion across 120 measured frames; application maximum includes every
completed frame. The 8³ cancel loop measures ready-preview discard and checks
active cancellation separately; the 16³ loops time active cancellation.
Targets remain preview ≤250 ms, cancellation ≤100 ms and completed rendering
≤16.667 ms. Each native run retains the 300-second watchdog, 8 GiB sampled RSS
ceiling, exclusive lease and finite frame/tick limits. See the
[reproduction commands](../MACOS.md#reactive-sandbox).

The index identifies local reports, receipts and SHA-256 hashes, including the
aggregate of all 397 execution-input hashes. All 339 tracked inputs matched the
implementation commit; generated bundles and other inputs matched current disk.
Raw reports, screenshots and logs remain under ignored `dist/verification/`.

## Review and checks

Manual adversarial review covered material transition/combustion closure,
conservation, catalog immutability, save compatibility, bounded commands and
cross-catalog presentation. It found that a late frame from a material scene
could be inspected against the replacement builtin catalog. Inspection now
checks world identity before looking up material data. The executable regression
fails without this check and passes with it. No remaining blocker was found.

Passed: 1,867 engine tests, 24 controller/tooling tests, 45 engine smoke tests,
13 smoke/transport tests, 68 supervisor tests (four existing platform skips),
and independently installed packages including all 13 npm entries and the new
factory. SDK/browser builds, types, lint and formatting pass. The no-mistakes
executable was unavailable; the checks and review were run directly.

One original collapse-stage attempt failed during the browser startup handshake,
before loading a scene. The retained log reports an invalid endpoint/startup
deadline. The watchdog disarmed normally; no safety hold or resource breach was
recorded. The unchanged stage passed on retry, followed by the other regressions.

Qualification covers these fixed sparse 8³/16³ scenes and the recorded host.
It does not establish arbitrary dense-world, larger reactive-volume, continuous
60 Hz physics, GPU reactive-physics or calibrated physical-material behavior.
