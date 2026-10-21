# SDK clients and checks

External clients and bounded checks that use only the installed packages or
the built `dist/sdk/` bundles. Nothing here imports engine sources.

## Installed-package clients

`python scripts/verify_sdk.py` builds and installs both packages into temporary
directories outside the checkout and runs these clients there.

| File | Role |
| --- | --- |
| `node.mjs` | Node client over the npm tarball; reports every change and the final state |
| `native.py` | Python client over the wheel, through the supported package entry point |
| `package-client.mjs` | Installed-package assertions, run by `scripts/verify_packages.py` from an independent temporary project |
| `materials.json` | Material extensions the clients load |

## Browser pages

Serve the repository root with `uv run python -m http.server 8765 --bind 127.0.0.1`
and open the page under `http://127.0.0.1:8765/examples/sdk/`.

| Page | Role |
| --- | --- |
| `browser.html` | The public API over an import map; compares the CPU and GPU implementations. `scripts/verify_browser.py` opens it during verification |
| `3d-smoke.html` | Bounded 3D verification: material passes, continuation and structure probes from `3d-smoke-probes.js` |
| `macos-qualification.html` | Mac 3D qualification over the structural cavern. `scripts/verify_macos_qualification.py` loads `playable-check.js`, `playable-benchmark.js` or `playable-scale.js` into it per stage |

`3d-smoke-probes.test.mjs` runs the smoke probes under Node as part of the unit
suite.
