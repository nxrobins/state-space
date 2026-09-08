# State Space engine contract

## Version 3

`engine/materials.json` defines the packed layout, stable material IDs, phase and
flag values, cold-table offsets, placement state, and material properties.
`engine/version.py` identifies the physical rules as `ca-v3`. Validate and
regenerate with `python -m engine.generate`; verify generated assets with
`python -m engine.generate --check`. Generation requires Node.js and the root
npm development dependencies. Runtime use does not invoke the generator.

A cell has three u32 coordinates: its packed view, conserved `energyQ`, and
persistent `structure`. The packed
layout remains material 8 bits, thermal 8 bits, signed kinetic X/Y 4 bits each,
phase 4 bits, and flags 4 bits. The cold table has 256 entries of 24 u32 slots.
Its 24 defined properties include phase energy, default phase, oxidizer
identity, cohesion, and softening temperature. Optical data is a full u32;
other cold properties use 0-255, with additional semantic validation.

Existing material IDs 0-14 remain stable. Oil vapor is 15, molten metal 16, and
molten glass 17. Reversible phase changes preserve their material families and
chemical energy. Sand-to-glass is an irreversible vitrification approximation.
Phase transitions assign the target material's declared default phase.

## Energy and quantization

One energy unit is 256 Q units. Per-cell `energyQ` is an integer no greater than
`0x3fffffff` and no smaller than that material's chemical store. The ledger is
exact: sensible Q + latent Q + chemical Q = sum of cell energyQ. Latent intervals
hold temperature constant until the phase transition completes. Condensation
and freezing release stored latent energy; combustion releases the chemical
store already present in fuel. Fire and lava are finite heat sources. Flame
extinction preserves energy as smoke and does not create water material.

The thermal byte is `min(255, floor(temperatureQ / 256))`. Clipping never changes
stored energy. Thermal exchange, ignition, and gas buoyancy use full temperature.
Pair flux uses harmonic conductivity and a bounded integer transfer: round
`temperatureDifferenceQ * conductivity / 512` upward, cap at half the temperature
gap and the cells' valid energy ranges, then debit and credit the same amount.
Rounding bias is less than one Q per exchange. An isolated conducting pair stops
within one Q; grid order can leave small spatial residuals and directional bias.

`seed_state` / `seedState` import a new packed placement as a sensible heat dose:
`(thermalByte + phaseEnergy + fuelEnergy) * 256`. Some of that dose can enter a
latent interval, so initial placement derives a possibly different display byte.
This operation is not exact continuation. Use existing energy and structural arrays to resume.
A supplied energy array and thermal view must agree; malformed states are rejected.

## State, ticks, and snapshots

Grids are flat row-major cells: index = y * width + x. Positive integer dimensions
are required, including odd and non-square shapes. The format allows at most
`0x3fffffff` cells; backends additionally apply device allocation limits. Input
validation rejects invalid dimensions, lengths, numeric coercion, undefined
materials, invalid cold properties, and inconsistent energy before dispatch.

A tick is the 18-pass schedule in `engine/schedule.py`: structural support and
fragment transport, ten granular/fluid/gas movement passes, four cardinal heat
passes, phase transitions, combustion, and reciprocal bond normalization. Movement salt depends
on the absolute tick. Boundaries are closed: outside cells supply no matter,
energy, or oxidizer. Movement transports all three state coordinates together. Intact or pinned
cohesive cells cannot be the source or destination of independent granular swaps.

Portable snapshots contain exactly `schemaVersion`, `rulesVersion`,
`materialCatalogHash`, `width`, `height`, `tick`, `packedCells`, `energyQ`, and
`structure`.
The tick counts completed ticks. Both versions and the catalog hash must match.
Python `Snapshot` requires all three arrays and exposes copied, read-only storage.
CPU `packedSnapshot()` and sandbox snapshots return JSON-serializable arrays.
Binary array transport uses little-endian u32 values.

Version 1/2 snapshots cannot resume version 3 physics. The fighter's explicitly
lossy material-only import can read the unchanged ID layout from versions 1, 2, or 3;
it discards energy and other physical state and is not an exact continuation.

Native `CompositionEngine.run` accepts `initial_energy` and `initial_structure`;
both are mandatory when `start_tick` is nonzero. Results include all three initial
and final arrays, energy ledgers, and optional complete per-pass/tick traces. Trace readbacks add
synchronization cost and must not be used as performance benchmarks.

CPU fields expose `step`, `setCell`, `paintCircle`, `clear`, `sample`,
`packedSnapshot`, and `restore`. Read access to `grid`, `energyQ`, `structure`, and the legacy
`snapshot()` returns copies. `sample()` includes full temperature and energy.
The energy balance tracks external replacement deltas separately from physics.
Clear and restore establish a new accounting baseline. Invalid restores are
atomic. Snapshot replay preserves simulation state, not the client's edit log.

The standalone WebGPU sandbox exposes `window.stateSpace` for deterministic
step, pause, snapshot, and restore through the public SDK. Step, snapshot, and
restore return promises and are serialized with animation and paint operations.
Snapshots describe complete committed ticks. Display colors are generated from the
same material catalog used by the simulation.

## Verified scope and remaining approximations

Native GPU, browser CPU and actual browser WebGPU compare all three state
coordinates after 2,304 passes across 31 scenes and all 36 pipeline variants.
The C6 browser corpus also checks structural diagnostics, public pass deltas,
stepping without inspection, and serialized restart. Earlier C3 evidence records
ca-v2 behavior and is historical. Exact resume, external edit
accounting, finite heat, phase cycles, combustion, and long flow/coupled cases
are executable checkpoint gates. These are bounded current-device results.

Movement is a deterministic cellular automaton using density swaps, not a
continuum fluid solver. Cells have unit heat capacity; the energy coordinate,
conductivity, and tick duration are not calibrated SI quantities. Combustion is
an abstract two-cell fuel/oxidizer conversion, not molecular stoichiometry.
Phase fractions reside in the energy interval, not an explicitly resolved mixture.
Kinetic fields are transported but do not yet implement momentum. Reserved phase
codes and flags do not imply electrical or pressure dynamics. Structural support,
bonding, breakage and coherent downward translation use the quasistatic model in
`docs/STRUCTURES.md`; rotation, elastic strain and mechanical energy are absent.

## Embedding and material extensions

The 0.3 SDK exposes native `create_field` and browser/Node `createStateSpaceField`,
plus asynchronous browser `createGpuField`. All support explicit cell/energy
edits, sampling, exact snapshot restore, external energy balance, and opt-in pass
reports. See `docs/SDK.md` and `examples/sdk/` for supported public clients.
The Python wheel contains its runtime kernels; the browser ESM bundle contains
its kernels and definitions. Runtime imports do not invoke build tools or load
files from the development checkout.

Each field has an immutable, validated material registry. Existing IDs 0-17 keep
their declared version-2 identity; 18-255 are available for extensions. Complete
registries may change properties and defaults while preserving the format and
valid physical graph. Every definition change produces a different canonical
SHA-256 catalog hash; material order does not. Snapshots carry that hash and must
be restored with the same registry, including when their cells use only built-ins.
Snapshots do not contain the registry definition. Null transport hashes are
invalid; the receiver must not infer or substitute one.

Per-pass reports include energy-only and structure-only changes, immutable before/after cell deltas,
and component ledgers. Native traces must contain all three state coordinates in schedule
order. GPU stepping commits complete host state only after successful readback;
concurrent edits, inspection, restore, or another step on that browser field are
rejected until its promise resolves. Close releases owned GPU resources. Native
buffer allocation and compilation failures retain the last committed field and
previous usable pipeline cache.

Registry changes configure the existing CA rules. They do not define arbitrary
new shader behavior or imply implemented dynamics for reserved phases and flags.
