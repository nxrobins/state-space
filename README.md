# State Space

[![License](https://img.shields.io/github/license/nxrobins/state-space)](LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/nxrobins/state-space/main)](https://github.com/nxrobins/state-space/commits/main)
[![Open issues](https://img.shields.io/github/issues/nxrobins/state-space)](https://github.com/nxrobins/state-space/issues)
[![GitHub stars](https://img.shields.io/github/stars/nxrobins/state-space)](https://github.com/nxrobins/state-space/stargazers)
[![Open Source](https://img.shields.io/badge/Open%20Source-Yes-brightgreen)](https://github.com/nxrobins/state-space)

A deterministic cellular material engine with coupled movement, heat, phase
changes, combustion and structural failure. The engine is the product; the
included games are integration clients.

Version 0.3 provides native Python GPU, browser WebGPU and JavaScript CPU APIs.
Complete state includes packed cells, integer energy, persistent bonds/integrity,
the absolute tick and material-registry identity. Public clients can edit, sample,
inspect individual passes and resume complete snapshots across backends.

## Try the engine lab

Use Python 3.10 or newer, Node/npm and uv. From the checkout:

```powershell
uv sync
npm ci
npm run build:sdk
uv run python -m http.server 8765 --bind 127.0.0.1
```

Open **http://127.0.0.1:8765/examples/lab/**. Five live experiments demonstrate
support, coherent fragments, burning supports, phase changes and a custom
material registry. Inspect cells and bonds, apply interventions, switch backends,
and exchange complete sessions. WebGPU requires a usable adapter and a secure
browser context; localhost is supported. The CPU reference is selected initially.

## Build on the engine

- [SDK and installed-client examples](docs/SDK.md)
- [Capabilities, physical approximations and extension paths](docs/CAPABILITIES.md)
- [State, energy and snapshot contract](ENGINE_CONTRACT.md)
- [Structural model](docs/STRUCTURES.md)
- [Evolution acceptance and benchmark protocol](docs/EVOLUTION.md)
- [Completed roadmap and checkpoint evidence](ENGINE_ROADMAP.md)

The model uses uncalibrated cellular units. It does not implement continuum fluid
pressure, momentum, elasticity or structural rotation. GPU backends currently use
host structural planning and full-state readback each tick. The capability guide
and checkpoint reports state the measured hardware and scale limits.

## About

State Space is an open-source, deterministic cellular material simulation engine.
It combines movement, heat, phase transitions, and structural failure into a
single, replayable tick model with backend-agnostic state contracts.

The repository includes:

- A runtime engine with Python and JS APIs.
- Web and native client integrations.
- Reference verification artifacts for browser, CPU, GPU, and end-to-end tests.
- A public roadmap and checkpoint archive of reproducible experiments.

The project is intended for researchers, game engineers, and simulation builders
who need predictable physics at the cell level.

## License

State Space is released as open source under the MIT License. See [LICENSE](LICENSE).

## Verify the release

Install the integration clients' locked dependencies:

```powershell
npm --prefix game ci
npm --prefix tower-defense-rogue ci
```

With agent-browser available on PATH, run:

```powershell
uv run python -m engine.verify --report docs/checkpoints/local-verification.json
```

Alternatively set `STATE_SPACE_BROWSER_CLI` to its executable or JavaScript
launcher path. The verifier requires native GPU and hardware WebGPU. It runs
lint, properties, long scenarios, native/CPU/browser conformance, installed SDK
clients, the live lab, game regressions, adversarial evolution checks and the
benchmark matrix. It retains failures and hashes the tested source.

Checkpoint evidence and content-addressed package artifacts are retained in Git.
Generated evidence is collapsed by default in GitHub review, and source/evidence
bytes are preserved across checkout platforms. Packages remain private/local;
this repository does not automatically publish them to a package registry.
