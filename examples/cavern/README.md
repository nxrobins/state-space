# The Cavern · experimental 3D M3

```powershell
npm ci
npm run build:sdk
uv run python -m http.server 8765 --bind 127.0.0.1
# http://127.0.0.1:8765/examples/cavern/
# Choose a seed with ?seed=123 (unsigned 32-bit integer).
```

A finite 64³ world contains eight 32³ chunks. Seeded integer terrain generation
creates connected chambers, strata and water pockets around a guaranteed
carve → release → freeze → cross challenge. **Watch the route** uses the same
reach-limited tools and integer collision controller as manual play. WASD moves,
mouse/right-drag/arrows look, Space jumps or swims, 1 carves, 2 cools, and click/E
applies the selected tool. The pale pad across the channel is the goal.

Stone, glass and ice stay fixed until edited or transformed. There is no 3D
pressure, structural collapse, stored velocity, player force, or combustion.
Water is opaque diagnostic terrain. The character's integer movement and
swimming are game rules; they do not add momentum to the material simulation.

Physics advances the complete bounded world, including invisible chunks.
Chunk boundaries change storage addresses only. The global 27-pass `ca-3d-m1`
schedule, global pair ownership, absolute tick and integer hash are unchanged.
The CPU world is a monolithic reference; GPU state is chunk-major in resident
double buffers. Every pass commits across all chunks before the next pass.

```js
import { createGpuWorld3D } from 'state-space-engine/experimental/3d/world/gpu';
const world = await createGpuWorld3D(); // 64³, eight 32³ chunks
await world.step(1, {
  edits: [{ x: 31, y: 31, z: 31, material: 2, thermal: 25 }],
  region: { origin: [24, 24, 24], size: [16, 16, 16] },
});
const saved = await world.snapshot();
await world.restore(saved);
world.close();
```

The synchronous CPU entry exports `createStateSpaceWorld3D(options?)`. Options
are width/height/depth (1–64), power-of-two chunkSize (1–32), and fillMaterial.
Dimensions must divide into complete chunks, with at most 64 chunks and 64³
cells. Defaults are 64³ / chunkSize 32. Alternative partitions are useful for
conformance; restoring a snapshot with a different partition preserves physics.
M1/M2 bounded volume factories still reject more than 32,768 cells.

World `step` accepts 0–32 ticks per request, at most 64 unique edits applied once
before the first tick, and an optional neighborhood of at most 4,096 cells.
World coordinates are integer XYZ, index order is X then Y then Z, gravity is
+Y, and the outer boundary is closed. Placement and energy edits update the
external-energy ledger; restore starts a new baseline. Reads are isolated copies.

World snapshots use `worldVersion: finite-chunks-1`, schema/catalog/rules identity,
geometry, chunk size, completed tick and a canonical Z/Y/X list of chunks. Each
chunk stores its XYZ origin, packedCells and energyQ in local X/Y/Z order.
Complete validation precedes mutation. Volume and 2D snapshots are incompatible.
Game saves additionally bind generator seed, game version, player, look and events.
Replay files contain the initial save and every canonical integer input command.

GPU face lists and indirect draw arguments persist per chunk. Material changes
mark their chunk and face neighbors at seams; heat-only changes read current
thermal coloring without remeshing. Camera frustum culling affects drawing only.
A world permits one active terrain renderer; close it before replacing it.
`renderer.inspectMesh()` is an explicit diagnostic readback, never a frame path.

The frame pump allows one active frame and one pending display timestamp. Normal
gameplay reads one 16³ collision neighborhood and at most 512 bytes of edit
accounting. Overload slows wall-clock simulation without skipping physics ticks.
Hidden tabs pause and cancel measurement. Worker-free WebGPU errors pause; Reset
rebuilds the device. Export after failure retains the last explicit checkpoint.

**Benchmark gameplay** runs 60 warmup frames, resets, then measures 600
display-paced frames at 1920×1080. Timing includes input, edits, all world physics,
collision readback, actor, HUD, dirty mesh updates, uploads, culled terrain draws,
validation and GPU completion. Setup, resets, snapshots, hashing, reference replay
and OS scanout are outside timing. Raw samples, actual tick rate, missed deadlines,
active-route timing and partial cancelled receipts are downloadable.

`window.cavern` exposes snapshot/restore, step/reset, replay/replayTape, view,
runBenchmark/cancelBenchmark and benchmarkResult. `suspend()` pauses the display
pump for isolated conformance tools. See [M3 evidence](../../docs/checkpoints/3D_M3.md).
