# State Space SDK

Version 0.3 exposes the ca-v3 material engine in Python, browser WebGPU, and
browser/Node CPU. These backends use the same catalog identity, complete snapshot
format, and pass schedule. The GPU backends require a usable GPU adapter.

## Install and run an external client

From the development checkout:

```powershell
uv build --wheel --out-dir dist/packages
npm pack --pack-destination dist/packages
```

Install the resulting wheel in a Python environment, or the npm tarball in a
JavaScript project. The npm package is private to prevent accidental publication;
local packing and installation are supported. Python runtime requirements are
NumPy and wgpu 0.31.x. Evolution tools and the GLFW viewer are optional extras.
Generation and package building use the development checkout; runtime clients
do not need Node.js for Python, source WGSL paths, or the generator.

`examples/sdk/native.py` and `examples/sdk/node.mjs`, together with `materials.json`,
are complete external clients. `python scripts/verify_sdk.py` builds and installs
both packages into temporary directories outside the checkout, executes the
clients, compares every reported change and final state, and compiles external
TypeScript clients with both installed compiler versions.

## Python field

```python
from engine import create_field

with create_field(64, 48) as world:
    world.set_cell(20, 10, 2, thermal=25)  # water
    world.set_cell(21, 10, 4, thermal=255)  # finite fire
    reports = world.step(16, inspect=True)
    print(world.sample(20, 10), world.energy_balance().drift_q)
    saved = world.snapshot().to_dict()
    world.restore(saved)
```

`create_field` accepts `fill_material` and a validated `registry`. `set_cell`,
`paint_circle`, and `set_energy` record the actual replacement energy as external
input/output. Energy can exceed the display byte's range. `clear` and `restore`
establish a fresh accounting baseline. Mutations are validated before commitment.
`snapshot()` returns immutable storage; `grid`, `energy_q`, and `structure` return independent
copies. Use a context manager or `close()` to release an owned GPU device. An
explicitly supplied `CompositionEngine` is borrowed and remains its owner's
responsibility. Read-only inspection of the last state remains available after
close; further mutations fail.

## Browser and Node fields

```typescript
import { createStateSpaceField, createGpuField, MAT } from 'state-space-engine';

const cpu = createStateSpaceField(64, 48, MAT.AIR);
const gpu = await createGpuField(64, 48);
gpu.setCell(20, 10, MAT.WATER, 25);
await gpu.step(16);
cpu.restore(gpu.packedSnapshot());
console.log(cpu.sample(20, 10), cpu.energyBalance().driftQ);
gpu.close();
cpu.close();
```

The CPU field's `step` is synchronous. WebGPU `step` is asynchronous: await it
before editing, sampling, saving, closing, or stepping the same field again.
Concurrent access is rejected. A failed GPU step retains the last committed
host state; each retry uploads that complete state. WebGPU errors propagate to
the caller. There is no automatic switch of backend.

WebGPU snapshots and samples reflect the last completed step. This SDK currently
reads all three GPU coordinates after every tick for the host structural planner.
Inspection adds readbacks after every pass. This is a hybrid host/GPU backend;
complete tick timing includes planning and transfers. C6 records its supported
scale, and C5 measurements describe the earlier ca-v2 contract.

The standalone ESM build is `dist/sdk/state-space.js`. An HTML import map can map
`state-space-engine` to that file without a bundler. Serve
`examples/sdk/browser.html` over localhost to try the public API and compare the
CPU and GPU implementations. WebGPU and custom-registry hashing need browser
secure-context APIs; Node's CPU backend uses its built-in Web Crypto.

## Extend materials without forking physics

Python `MaterialRegistry(catalog)` and asynchronous JavaScript
`createMaterialRegistry(catalog)` validate complete catalogs. Start from
`DEFAULT_REGISTRY.to_dict()` / `toCatalog()`, or call `extend(records)` to add
complete material records. The sample extension adds copper, molten copper,
resin fuel, and material ID 255 as copper grit.

IDs 0-17 retain their version-2 names. IDs 18-255 can hold extensions. Existing
properties may be changed in a new registry, but any change to properties,
defaults, names, or colors changes the catalog hash. Material ordering and JSON
object-key ordering do not. Registries copy input before validation/hashing and
do not expose writable authoritative arrays. A world keeps its registry for its
entire lifetime. Create another world to use another registry.

A snapshot carries the registry hash, not its full definition. Supply the exact
registry when restoring it. Reconstruct a registry from its exported catalog on
the receiving side; the hash will agree across Python and JavaScript. The default
registry cannot restore custom-registry snapshots, even if the scene happens to
contain only built-in IDs. A property change also makes snapshots incompatible.
No implicit reinterpretation or migration is performed.

Phase families require monotone phase energy, matching latent heat, preserved
fuel/oxidizer identity, correct reverse targets, and separated reverse thresholds.
Combustion requires valid inert products. Undefined targets, malformed numeric
values, missing properties, duplicate identities, and layout changes are rejected.
Materials customize existing physical rules; this is not arbitrary shader-plugin
loading. Existing special handling of air, fire, water, and smoke retains its
built-in identity. Reserved phase/flag values do not create new physical laws.

## Inspect behavior and accounting

Pass reports contain the absolute tick being processed, pass ID, changed cell
indices, before/after packed cells, energy and structure, and before/after component ledgers.
Changes include cells whose energy changes while their display byte stays the
same, and changes confined to bonds or integrity. Replaying the changes reconstructs the full state. Reports are immutable
and cannot alter the simulation. Their aggregate energy delta must be zero for
closed-system physics; external edits are tracked by the field's energy balance.

Collect reports with `step(..., inspect=True)` in Python or
`step(..., {inspect: true})` in JavaScript. Collection is opt-in: storing cell
deltas and synchronizing GPU pass readbacks adds significant time and memory.
The tick identifies the input tick; a complete tick advances the public counter
only after all scheduled passes finish.

Cell edits use integer coordinates and ignore valid placements outside the grid.
Invalid material/energy/coordinate values still fail validation. Sampling floors
finite coordinates in the safe numeric range and clamps them to the grid. Circle painting accepts finite
geometry in the safe numeric range and a nonnegative radius. These conventions
are shared by the native and browser APIs.

Physical units and approximations are specified in `ENGINE_CONTRACT.md`.

## Cohesion, breakage and bulk creation

`set_anchor(x,y,anchored=True)` / `setAnchor(x,y,anchored=true)` pins a cohesive
solid or frozen cell. Broken pins remain fixed and can support other fragments.
Melting, burning into noncohesive products, or explicit replacement removes pins.

`set_integrity(x,y,value,weld=False)` / `setIntegrity(x,y,value,{weld:false})`
sets integer integrity from 0 to 255. Zero breaks reciprocal bonds; cooling and
ordinary repair never recreate broken bonds. Explicit welding, fresh placement,
and solidification can create bonds to adjacent intact cohesive cells.
`inspect_structure()` / `inspectStructure()` predicts the next solve without
changing state. Structural pass reports carry that plan. Diagnostic coordinates
and model limits are described in `STRUCTURES.md`.

For an initial bulk layout, the JavaScript export
`createPhysicsState(packedCells,width,height,registry)` validates packed placement
doses and returns independent `grid`, `energyQ`, and `structure` arrays. Use these
with the current field's snapshot metadata and tick zero for initial restore.
This deliberately creates fresh energy and bonds; use complete snapshots for
continuation. It is never an implicit migration for schema 1/2 saves.

`FieldSample.bonds` contains the original structural bit masks, not a compact
four-bit direction index. Use the public `STRUCTURE_BOND_LEFT_MASK`,
`STRUCTURE_BOND_RIGHT_MASK`, `STRUCTURE_BOND_UP_MASK` and
`STRUCTURE_BOND_DOWN_MASK` exports to decode it. Python samples expose the same
bit positions. Avoid copying numeric masks into a client.

The live reference client is `examples/lab/`. Its controller serializes steps,
edits, backend changes and imports; its renderer consumes committed public-field
samples. [CAPABILITIES.md](CAPABILITIES.md) explains the scenarios, known physical
and scale limits, material versus rule extensions, and the full verification command.
