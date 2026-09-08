# State Space: capabilities and next directions

The engine is the product. The games are integration probes. State Space 0.3
is a deterministic cellular material simulator with coupled movement, heat,
phase changes, combustion and structural failure. Its strongest foundation is
the ability to inspect, reproduce and compare those interactions across backends.
The current release evidence and requirement audit are in
[C7](checkpoints/C7.md); earlier checkpoints retain their original version scope.

## What the current engine supports

| Capability | Implemented behavior | Approximation or boundary | Direct evidence |
| --- | --- | --- | --- |
| Complete state | Packed cell + integer energy + persistent integrity, bonds and anchoring; absolute tick and registry identity | Schema 3 / ca-v3. Old snapshots require an explicit migration or lossy import; no automatic reconstruction | Snapshot rejection, atomic restore, mutation and restart properties; installed SDK clients |
| Grains and liquids | Conservative gravity, diagonal movement and lateral density exchange; structural bodies displace cells coherently | Local cellular exchange; no incompressibility, pressure solve, viscosity calibration or surface tension | Per-pass CPU/native/WebGPU corpus, material counts, 1,024-tick flow with split restart |
| Gas and fire motion | Full-temperature buoyancy and lateral routing around baffles | No gas pressure, compressibility or advective velocity field | Hot smoke, gas baffles, competing fuel/oxidizer and mixed-scene conformance |
| Heat | Four disjoint cardinal exchanges, harmonic conductivity, exact equal-and-opposite integer transfer | Unit cell heat capacity, model units, directional ordering bias and bounded sub-Q rounding; no radiation | Pair equalization, insulated cells, extremes and overflow controls; long coupled cases |
| Phase changes | Finite latent intervals; melting, boiling, freezing and condensation; phase-family identity | Partial phase is represented by energy, not a resolved material mixture. Sand vitrification is irreversible | Forward/reverse phase cycles, saturated thermal views and phase/structure scenes |
| Combustion | Mutually owned fuel/oxidizer pairs, finite chemical store, conserved inert products; burning removes support | Abstract two-cell chemistry; no molecular stoichiometry or flame-front model | Shared oxygen, finite fire, water/fire identity, consumed support and cascade |
| Cohesion and failure | Reciprocal persistent bonds, support graph, integer load distribution, heat weakening, damage, fracture, anchors and coherent downward fragments | Quasistatic cellular strength; no rotation, elasticity, momentum, SI stress or mechanical-energy budget. Fluid/grain pressure is not applied to structures | Three independent planners, native GPU permutations, spans, fragments, break/repair/weld and coupled failure |
| Embedding | Python native GPU, browser WebGPU, browser/Node CPU; explicit edits, samples, pass reports, snapshots and registry export | WebGPU is asynchronous. GPU backends need a usable adapter. Reports add synchronization and memory cost | Packages installed outside the checkout; external Python/JS/TS clients; actual browser UI |
| Material extension | Validated properties, defaults and phase/reaction graphs; custom IDs 18–255; canonical cross-language catalog hash | Configures existing laws. Some air/fire/water/smoke treatment retains built-in identity. No arbitrary shader-plugin ABI | Copper family, resin and ID-255 grit; malformed and incompatible registry controls |
| Evolution | Exact-source, composed candidate evaluation; required positive behavior; immutable receipts; measured ranking | A bounded correctness corpus cannot prove all possible worlds. A physics-contract change needs new reference expectations, not optimization admission | Compiled bad candidates, reference-content tampering, staging controls and benchmark matrix |

See [the contract](../ENGINE_CONTRACT.md), [SDK](SDK.md), [structural model](STRUCTURES.md)
and [evolution protocol](EVOLUTION.md) for exact definitions. A tick is a discrete
18-pass update, not a calibrated duration in seconds. Kinetic bits are transported
metadata; they do not implement momentum. There is no electrical or pressure law.
One model energy unit is 256 Q. Temperature labels in the lab are model units,
not degrees Celsius. Exact conservation applies to thermal + latent + chemical
energy, with edits accounted externally; gravity is outside that ledger.

## Backend and scale scope

The native and browser GPU backends use host structural planning plus GPU
transport and local physics. They read all three state arrays after each tick.
This is a hybrid implementation. Exact equivalence is demonstrated on the
recorded NVIDIA RTX 4090 native Vulkan and browser WebGPU adapters, across the
retained corpus. Other devices, drivers and browsers must run the same verifier
before extending that claim. A format's allocation limit is not a useful-world
size or performance guarantee.

C6's integrated benchmark used four workloads, two warmups and seven samples
per workload/shape, with four ticks per run. These are ranges of workload medians:

| Shape | Native time per tick | Host planning within that time |
| --- | ---: | ---: |
| 32 × 32 | 5.83–6.35 ms | 1.68–2.33 ms |
| 128 × 128 | 14.12–17.53 ms | 8.08–11.59 ms |
| 257 × 129 | 18.81–26.00 ms | 11.74–19.72 ms |
| 512 × 512 | 144.32–210.53 ms | 106.81–173.15 ms |

These measurements exclude compilation and registry construction; they include
host planning, upload, dispatch, complete readback and completed-state validation.
They are not browser frame rates. The lab additionally builds an inspected view
and renders it. Its displayed wall time includes that work. Larger worlds at
60 ticks per second remain unproven. C7 reruns the benchmark and retains its own
distributions; the numbers above remain the explicitly dated C6 baseline.

## Run and build on the engine lab

From the checkout, run `npm ci`, `npm run build:sdk`, then
`python -m http.server 8765 --bind 127.0.0.1`. Open
`http://127.0.0.1:8765/examples/lab/` in a browser. Select WebGPU to use the GPU;
failure is reported explicitly and preserves the existing field. The default CPU
choice makes the reference implementation directly inspectable.

The five live experiments cover support, coherent falling fragments, consumed
supports, phase/structure coupling and a custom registry. They use the public
SDK throughout. `scenarios.js` constructs scenes, `controller.js` serializes field
operations, and `view.js` renders committed samples. `app.js` connects the UI.
That separation is the example extension pattern, not an additional physics layer.

Point at a cell or use the canvas arrow keys to inspect it. Choose an intervention
and click, or press Enter. Pass inspection exposes all 18 reports from a requested
tick. Overlays show material/bonds, temperature, integrity and support distance.
Save/download includes the complete snapshot and its catalog. Import supplies
that exact registry before restore. The lab caps file imports at 20 MB and 16,384
cells; this is an interactive example limit. Restore and backend transfer preserve
simulation state but start a fresh energy-accounting baseline.

## Supported extension workflow

1. **Embed a field.** Use the published entry points shown in [SDK.md](SDK.md).
   Keep render state separate, await GPU steps, and consume only completed state.
   Use opt-in pass reports when investigating a transition.
2. **Add a material.** Copy/export a complete catalog or extend with full records.
   Validate the phase and reaction graph, create a new immutable registry, and
   distribute it with saved worlds. The examples in `examples/sdk/` run unchanged
   outside the checkout after package installation. Reuse a law before adding one.
3. **Add a physical law.** First write the state, units, positive behaviors and
   conservation/compatibility contract. Add any required state to all backends,
   snapshots, edits, accounting, inspection and replay. Implement an independent
   reference, then the GPU pass and schedule. Add small causal scenarios, odd/tiny
   geometry, a long coupled case and executed negative controls. Revise schema/rules
   identity when their meaning changes. A new material name alone is not a new law.
4. **Optimize under evidence.** Profile the full tick, keep all coordinates and
   positive behavior exact, run the composed evaluator, then compare synchronized
   warmup/sample distributions. Retain the exact source/device/config receipt.
   Review a staged patch before changing a production winner.

## One release verification command

Install the development Python dependencies (`uv sync`) and the root/game/Relic
npm dependencies. Install agent-browser and a supported browser on the machine.
Then run, from the checkout:

```powershell
python -m engine.verify --report docs/checkpoints/my-verification.json
```

The browser CLI must be on PATH. Alternatively set `STATE_SPACE_BROWSER_CLI` or
pass `--browser-cli` with its executable or `bin/agent-browser.js` path. Node is
required for the JavaScript launcher. The recorded C7 run uses agent-browser
0.27.0. The verifier starts an ephemeral localhost server and an isolated named
browser session and closes both. It requires hardware WebGPU, regenerates native
evidence, checks all three coordinates per pass, executes the live lab and SDK UI,
and compares the installed native client to the actual browser client.

The same command runs structural lint, Ruff, Python properties and long scenarios,
CPU/native conformance, TypeScript checks, both game integrations, package clients,
the live lab properties, adversarial evolution checks and the benchmark matrix.
Each report retains commands, failures and source hashes; browser artifacts and
evaluation evidence get a directory derived from that report name. Missing GPU,
missing browser, incomplete evidence or changing source makes the run fail.

## Where the engine should evolve next

The immediate priority is **reducing the cost of a complete tick**. Measure host
connectivity work, full-field transfers and allocations independently. Candidate
approaches include reusing unchanged support graphs, tracking affected regions,
and a GPU connectivity solver. Long beams and contact chains cross local regions:
an optimization must converge to the complete reference result, without a fixed
local horizon. Claim success only at a stated size/workload and device, with the
same snapshots, positive physics and measured total latency.

The next fidelity choice should add a missing interaction with clear consequences.
Pressure and velocity would let fluids exert forces and carry motion. Rotation
and elastic response would make falling and loaded structures more expressive.
Each needs additional authoritative state, an appropriate energy/momentum model,
and dedicated stability/convergence evidence. They should be separate researched
checkpoints; neither is implemented or promised by this reference release.

In parallel, make engine extensions cheaper through more example clients, a
scenario authoring format, clearer diagnostics and eventually a versioned rule
extension interface. Preserve independent reference implementations and precise
compatibility boundaries. Games can keep revealing integration problems, while
these engine capabilities remain the basis for choosing work.
