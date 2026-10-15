# The Living Cavern · experimental 3D M4

Build with `npm run build:sdk`, serve the repository, and open
`http://127.0.0.1:8765/examples/active-cavern/`. Choose an unsigned seed with
`?seed=123`. WASD moves, mouse/right drag or arrows look, Space jumps/swims,
1 carves, and 2 cools. Watch the route uses the same commands and collisions.

The finite 128³ level has nine connected seeded chambers, a central dam/freezing
crossing, and finite offscreen water, lava and ice. Stone, glass and ice stay
fixed until edited or transformed. Water is opaque diagnostic terrain. There is
no 3D pressure, stored velocity, combustion, structural collapse or streaming.

```js
import {createGpuActiveWorld3D} from 'state-space-engine/experimental/3d/active-world/gpu';
const world = await createGpuActiveWorld3D(); // 128³, 32³ storage chunks
await world.step(1, {
  edits: [{x:63,y:63,z:63,material:2,thermal:20}],
  region: {origin:[56,56,56],size:[16,16,16]},
});
const activity = await world.inspectActivity(); // explicit diagnostic readback
const saved = await world.snapshot();
await world.restore(saved);
world.close();
```

The CPU entry `experimental/3d/active-world` exports
`createStateSpaceActiveWorld3D(options?)`, a dense reference with the same physical
state and editing semantics. The GPU factory accepts `execution: 'dense'` for
diagnostics; sparse execution is the default. Both execute the unchanged global
27-pass `ca-3d-m1` law. Global coordinates, integer energy and absolute tick govern
the result. Camera position and visibility never govern stepping or waking.

The GPU-only `activityReadbackInterval` option is an integer from 0 to 3,600
(default 0). A positive value batches activity diagnostics into completed step
requests whose absolute end tick is a multiple of that interval. Calling
`inspectActivity()` before rendering then reuses isolated cached data without an
extra GPU submission. Writes, restore, scratch-pass inspection and terrain
rendering invalidate that cache. This changes diagnostics, never physical state.
The cavern uses 60, matching its HUD refresh cadence.

Storage chunks have power-of-two edge 4–32. Dimensions are complete chunks through
128, with at most 512 storage chunks. Physics activity is tracked in tiles of
edge `min(chunkSize,8)`, independently of storage and terrain caches. The default
128³ world has 64 storage chunks and 4,096 possible 8³ activity tiles. Work and
sleep counts in `inspectActivity()` refer to activity tiles; `storageChunks` and
`activityChunkSize` make the units explicit. Wake reasons are bit flags: 2 material
motion, 4 thermal state, 8 phase change, 16 external edit, 32 initialization/restore.

An activity tile sleeps only after an exact conservative certificate proves all
possible local rules leave it unchanged. A change wakes every tile intersecting
the law's radius-two dependency stencil before the next pass. Both physical
coordinates stay synchronized in skipped regions. Save files contain no activity
cache: restore reconstructs it from the complete committed physical state.

Snapshots use the separate `finite-active-1` world envelope, including dimensions,
canonical storage chunks, catalog/rules identity and completed tick. M1/M2 and M3
entries keep their prior bounds and envelopes. Invalid edits and imports reject
before mutation; undefined and empty edit batches remain valid. Restore resets
the external-energy accounting baseline.

The game retains integer movement, bounded 16³ collision queries, reach-limited
tools, complete snapshot/replay export and import, error pause and checkpoint
reset. During normal play the activity HUD refreshes once per 60 ticks; edits and
restore/import operations also invalidate the paused display. Its diagnostic
readback is included when it occurs in a measured frame. One frame and one pending
timestamp bound scheduling; overload slows wall time without skipping ticks.

Benchmark gameplay uses a 1920×1080 canvas, 60 warmup frames, reset and 600 measured
display-paced frames. Setup includes initial activity certification and terrain
cache construction. Measured frames include all physics, controller/query work,
edits, HUD, mesh updates, uploads, drawing, validation and GPU completion. Complete
states are compressed and hashed after measurement to keep evidence portable.
Timing and correctness are separate results; a timing miss is retained as a miss.
The 128³ benchmark crosses two setup display boundaries after reset before
arming its measured loop, and includes every tick from 1 through 600. The
initial snapshot is collected before warmup, and final HUD updates remain in
the measured frame. GPU dirty-chunk meshing and once-per-tick activity compaction
with between-pass wake appends provide headroom without changing the rules.

`window.activeCavern` exposes the same controls as `window.cavern`, including
snapshot, restore, step, reset, replay, replayTape, view, runBenchmark and
cancelBenchmark. See [M4 verification](../../docs/checkpoints/3D_M4.md).


## Optional GPU gameplay

Select **GPU resident** in the backend menu or open `?gameplay=gpu`. Switching
backends resets the level. The CPU controller remains the default reference.
Both modes accept the same game snapshots and input tapes.

The resident path runs tools, exact physics, collision and integer movement,
then terrain meshing and drawing in one GPU submission. The collision neighborhood
stays on the GPU; a 512-byte committed actor/event/ledger result returns for the
HUD. One completion boundary covers validation, readback and rendering. Scheduled
activity diagnostics share that boundary. Camera/target values are copied on the
GPU after movement, so the rendered eye belongs to the completed tick.

`createGameplay`, `step`, view-only `present`, restore and ownership/error behavior
are documented in [the SDK](../../docs/SDK.md#optional-resident-3d-gameplay).
Resident receipts retain 600 `gameplay` latency records, full-frame p95, worst
frame, deadline misses and actual tick rate. The sub-8 ms target is explicitly
`completion.p95 < 8`; every measured frame remains included and the independent
locked-60 gate still requires zero misses and lost display slots.
