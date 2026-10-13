# Spillway

A small playable reference client for the shared State Space engine. Cross the
basin and reach the green relay. Cut the barricade, jump it, or experiment with
the bridge's wooden support. Heat the support to trigger structural failure;
swim and climb out if you fall in the water.

From the repository root:

```powershell
npm ci
npm run build:sdk
uv run python -m http.server 8765 --bind 127.0.0.1
```

Open <http://127.0.0.1:8765/examples/spillway/>. A hardware WebGPU browser is
required. The game starts paused; press Play. A/D or arrows move, Space jumps
(hold to swim), E cuts, F heats, P pauses, and period advances one tick. The
pointer aims tools within 18 cells; with no pointer over the field, tools aim
ahead. Anchored fixture cells cannot be cut. Restart restores the whole run.

## Integration map

- `scene.js`: finite initial materials, energy and support, created through the
  public SDK. The field is 256 × 256.
- `game.js`: an integer character controller, swept collision against committed
  cells, tools, a goal region and immutable tick-stamped gameplay events.
- `replay.js`: versioned full-state recording, input validation and SHA-256
  comparisons of the entire field, actor, game flags and ordered event history.
- `app.js`: serialized input/step/render operations, live replay, file import and
  export, and full-frame benchmarking of the actual game loop.
- `replay-worker.js`: the same recorded commands run on the independent CPU
  physics backend outside the measured frame window.
- `view.js`: game sprites in field coordinates. The shared renderer's optional
  rectangle sprite layer submits on the same GPU queue as material presentation.

The character uses integer sub-cell coordinates (256 units per cell), axis sweeps
with at most one-cell advances, binary searches to contact, and a two-cell step
height. Water changes movement and enables swimming. Hot cells cause damage.
Holding jump also gives a fixed upward impulse on leaving water. Moving terrain
resolves an embedded character in a fixed up/left/right/down order
within ten cells; if no position is free, the character is crushed.

The actor is a game-owned kinematic body. It samples materials but does not add
mass, pressure or reciprocal forces to them. Cutting and heating are explicit
SDK edits recorded in the engine's external-energy ledger. All material motion,
pressure, fracture, combustion and phase changes execute the unchanged shared
physics schedule. There is no duplicate terrain simulation in this client.

## Gameplay events

`game.onEvent(listener)` subscribes to committed events and returns an unsubscribe
function. Events include `terrain-cut`, `heat-applied`, `bridge-collapsed`,
`blocked`, `jumped`, `landed`, `water-entered`, `water-left`, `swam`, `burned`,
`crushed`, `lost` and `relay-recovered`. They carry an absolute tick and relevant
integer values. The UI consumes these events; listeners cannot change event data.
The bridge event measures loss of the original central deck, not a general
engine fracture notification. Region-specific rules live in the client.

```js
import { createGpuField } from '../../dist/sdk/state-space.js';
import { ReferenceGame } from './game.js';

const field = await createGpuField(256, 256);
const game = new ReferenceGame(field);
const unsubscribe = game.onEvent(event => console.log(event));
await game.step({ move: 1, jump: false, tool: 'cut' });
unsubscribe();
field.close();
```

## Exact replay

Export pauses at a completed tick and saves the initial full snapshot, game-rule
version, every normalized tick command and the expected final-state digest.
Replay restores the initial world and character, then runs the recorded commands
through the same game loop. The digest includes all three physical arrays,
absolute tick, engine/catalog identity, character motion and cooldowns, game
flags, the external-energy ledger and every event. Live controls do not affect replay commands.

Import checks format, contiguous bounded commands, engine snapshot validity and
the exact initial scene identity before changing the live game. This example
supports at most 7,200 ticks per recording and rejects incompatible game/engine
versions; it does not silently migrate saves. The importer accepts files up to
8 MiB. Hashes detect divergence; they do not authenticate a player's score.

## Full-frame benchmark

The button runs two actual input routes: a crossing and deliberate support
destruction. Each measures 600 display-paced frames after 60 warmup frames at
1920 × 1080 output, 256 × 256 physics and all effects on. Timing includes commands,
edits, shared physics, character collision, event generation, command recording,
HUD updates, all material effects, actor sprites and GPU completion. Setup,
hashing, CPU replay and OS scanout are outside timing. Gameplay continues to
record physics after reaching the relay, so late frames still advance the field.

The receipt retains the first 60 frames separately, including the initial
barricade cuts, so startup interactions remain inspectable. It includes raw
frames, strict existing 60 Hz pacing metrics, GPU energy
drift, and an independent CPU replay of both complete runs. It retains failures;
the UI does not claim a timing pass when any deadline is missed.

```powershell
uv run python -m scripts.benchmark_spillway --browser-cli <agent-browser-cli> --output <evidence-directory> --require-locked
```

`window.spillway` exposes serialized `snapshot`, `step(commands)`, `exportRun`,
`playRecording`, `restart`, `setPaused` and `runBenchmark` methods for integration
and inspection. Replay results are exposed as `lastReplay`; benchmark receipts
as `benchmarkResult`. These are developer conveniences for this reference client.

The [implementation and measurement report](../../docs/checkpoints/SPILLWAY.md)
records runtime verification and the current timing result, including failed
deadline gates under background GPU load and an interrupted attempt. The latest
rerun after optimizing single-cell bond removal passed the strict 60 Hz gate
on both routes, with zero deadline misses and exact CPU replay. CLI runs retain
a flushed progress journal alongside the completed receipt, and raw frames
include their ending tick. The report retains the earlier timing failures.

To profile CPU edit costs against an archived command recording:

```powershell
node scripts/profile_spillway.mjs docs/checkpoints/spillway/frames-retry/frames.json collapse <profile-output.json>
```

This profile checks the original complete-state digest and energy ledger; its
CPU tick timings are separate from the browser full-frame benchmark.
