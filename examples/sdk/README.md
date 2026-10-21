# SDK clients and checks

External clients and bounded checks over the built packages. The Node and
Python clients use only the installed packages. The browser pages use the
`dist/` bundles plus sibling example modules and `web/` modules. Nothing here
imports engine sources.

## Installed-package clients

`uv run python scripts/verify_sdk.py` builds both packages, installs them into
temporary directories outside the checkout, and runs these clients there.

| File | Role |
| --- | --- |
| `node.mjs` | Node client over the npm tarball; reports every change and the final state. `scripts/verify_macos_native.py` runs it as well |
| `native.py` | Python client over the wheel, through the supported package entry point |
| `package-client.mjs` | Installed-package assertions, run by `scripts/verify_packages.py` from an independent temporary project |
| `materials.json` | Material extensions both clients load |

## Browser pages

Serve the repository root with `uv run python -m http.server 8765 --bind 127.0.0.1`
and open the page under `http://127.0.0.1:8765/examples/sdk/`.

| Page | Role |
| --- | --- |
| `browser.html`, `browser.js` | The public API over an import map; compares the CPU and GPU implementations. `scripts/verify_browser.py` and `scripts/benchmark_browser.py` open it |
| `3d-smoke.html`, `3d-smoke.js` | Bounded 3D verification in the browser: the material pass, continuation and structural probes from `3d-smoke-probes.js` |
| `macos-qualification.html`, `macos-qualification.js` | Mac 3D qualification over the structural cavern. `scripts/verify_macos_qualification.py` loads `playable-check.js`, `playable-benchmark.js` or `playable-scale.js` into it per stage |

`3d-smoke-probes.test.mjs` checks the structural smoke fixture on the CPU world
under Node. It runs in the smoke suite, `node scripts/verify_checks.mjs --suite smoke`.
