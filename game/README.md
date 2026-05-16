# State Space: Element Fighter

This is a standalone Phaser/Vite prototype for testing whether the State Space material vocabulary can support a readable arena fighter. It intentionally lives beside the WebGPU sandbox instead of depending on it.

## Current Scope

- Local player versus CPU.
- Water, Earth, and Fire specialists.
- Deterministic fixed-step combat simulation with Phaser as the disposable renderer.
- Material grid hazards and terrain changes using State Space material IDs.
- Session replay recovery, debug overlay, compact HUD, touch controls, and unit tests.

## Relationship To The Engine

The prototype borrows material names, IDs, and interaction ideas from the root State Space engine, but it does not execute the WebGPU compositor or shader pipeline. The combat grid is a small TypeScript model designed for fast iteration on game feel.

That boundary is intentional for now:

- `game/src/game/simulation/*` is the gameplay source of truth.
- `game/src/phaser/*` renders and samples input only.
- `web/`, `engine/`, and `locked/` remain the State Space engine and shader evolution surface.

When the fighter proves its design loop, the next integration step is replacing selected TypeScript material rules with snapshots or services from the engine, not wiring Phaser directly to the live shader pipeline.

## Run

```powershell
cd D:\state-space\game
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Verify

```powershell
cd D:\state-space\game
npm test
npm run build
```

Use `?debug=1` or the debug control in-game for match ID, seed, frame stats, material counts, and combat telemetry.
