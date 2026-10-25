# Engine lab

The live reference client for the public 2D SDK. Five experiments cover
support, coherent falling fragments, consumed supports, phase and structure
coupling, and a custom material registry. Inspect cells and bonds, change the
scene, switch between the CPU and WebGPU backends, and export or restore
complete sessions.

## Run

From the repository root, after `npm ci` and `npm run build:sdk`:

```sh
uv run python -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/examples/lab/`. `npm run lab` serves the same
address and stops early when `dist/sdk/` is missing. The lab starts on the CPU backend.
WebGPU needs a secure browser context; localhost qualifies.

## Files

| File | Role |
| --- | --- |
| `app.js` | Connects the UI to the controller and the view |
| `controller.js` | Serializes steps, edits, backend changes and imports through the public SDK |
| `scenarios.js` | Constructs the five scenes; every physical edit and solve goes through the SDK |
| `view.js` | Renders committed public-field samples, cells and bond markers |
| `verify.js` | Browser-side checks run by `scripts/verify_browser.py` |
| `lab.test.mjs` | Node tests for the controller, scenarios and view, plus the public-client lint |

[CAPABILITIES.md](../../docs/CAPABILITIES.md) explains the scenarios and their
limits. [The SDK guide](../../docs/sdk/core.md) documents the API the lab uses.
