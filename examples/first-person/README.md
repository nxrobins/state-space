# The Crossing · experimental 3D M2

```powershell
npm ci
npm run build:sdk
uv run python -m http.server 8765 --bind 127.0.0.1
# Open http://127.0.0.1:8765/examples/first-person/
```

WebGPU is required. Start paused; choose **Watch the route** for the complete
carve → release water → freeze → walk across sequence. Choose **Play** for manual
control. WASD moves, mouse with pointer lock (or right-drag / arrows) looks,
Space jumps or swims, 1 selects carving, 2 selects cooling, and left click / E
applies the tool. Tool centers must be visible within five voxels; each brush
affects a 3³ neighborhood. The pale pad on the opposite shore is the goal.

The finite reservoir and all thermal changes use the unchanged `ca-3d-m1`
material rules. The cooling tool sets water/ice energy to zero, recorded as
external energy removal; the phase pass creates ice. Nothing scripts water
placement or ice formation during play. Stone, glass and ice are fixed solids;
there is no pressure, structural collapse, momentum transfer, or player buoyancy
force. The game owns an integer kinematic controller and swimming behavior.

`state-space-engine/experimental/3d/gpu` exports `createGpuField3D`. Its async
`step(ticks, { edits, region })` applies up to 64 unique edits before the first
tick, runs the exact CPU schedule, and optionally returns an isolated bounded
region of at most 4,096 packed cells. Gameplay reads 16³ cells (16 KiB) around
the player; no full-volume readback occurs in a normal frame. An edit batch
also reads at most 512 bytes for its exact external-energy deltas.

```js
import { createGpuField3D } from 'state-space-engine/experimental/3d/gpu';
const field = await createGpuField3D(32, 32, 32);
await field.step(1, {
  edits: [{ x: 8, y: 4, z: 8, material: 2, thermal: 25 }],
  region: { origin: [0, 0, 0], size: [16, 16, 16] },
});
const renderer = await field.createRenderer(document.querySelector('canvas'));
await renderer.render({ eye: [8, 4, 4], forward: [0, 0, 1], right: [1, 0, 0], up: [0, -1, 0] });
const saved = await field.snapshot(); // Explicit complete-state readback.
await field.restore(saved);          // Same schema/catalog/rules as the CPU.
field.close();
```

Exposed faces are compacted on the GPU and drawn indirectly from resident state.
Water is opaque diagnostic terrain. Camera trigonometry is presentation only;
input records quantized direction/movement vectors. Character positions and
velocities, swept collision, targeting, tool cooldowns and tick ordering use
integers. Save files include the field, player, direction, status and events.
Replay files include the complete initial save and canonical commands. Restore
establishes a new energy baseline, following the engine contract.

The frame pump permits one active frame and one pending display timestamp.
Overload slows wall-clock simulation without skipping physics ticks or growing
a request queue. Hidden tabs pause and cancel measurement. GPU errors pause;
Reset rebuilds the device from the initial checkpoint. After an error, Save
exports the last explicit checkpoint, which may predate the error. Device loss
does not promise recovery of unexported GPU state.

**Benchmark gameplay** measures 60 warmup and 600 display-paced frames at
1920×1080. It resets after warmup so carving and freezing occur inside the
measured interval. Every measured frame runs a physics tick, bounded collision
readback, character update, HUD update, GPU face compaction, draw, validation and
GPU completion. Player collision continues after the crossing is won. Hashing,
CPU replay, snapshot export, setup and OS scanout are outside timing. The receipt
reports the active crossing interval separately and retains raw timestamps.

`window.crossing` exposes `snapshot`, `step`, `reset`, `restore`, `replay`,
`replayTape`, `view`, `runBenchmark`, `cancelBenchmark` and the latest
`benchmarkResult`. Mutating operations reject concurrent requests. A cancelled
or failed measurement retains its partial receipt for download.

See [M2 rules, verification and measured results](../../docs/checkpoints/3D_M2.md).
The recorded i9-11900K / RTX 4090 run passes the 32³ / 1080p 60 Hz gate:
600 measured frames, p95 completion 7.2 ms, worst 11.0 ms and zero deadlines missed.
