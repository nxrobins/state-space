# Structural Cavern

An experimental developer reference for bonded 3D terrain. Serve the repository
over localhost after building the SDK, then open `/examples/structural-cavern/`.
The page starts paused at 32³. Choose 64³ or 128³ explicitly; only one simulation
request and one displayed frame may be in flight.

## Controls and fixtures

- Play, pause, single-step and reset control exact ticks.
- WASD moves; Space jumps; click the canvas for mouse look; E applies the selected
  cut, heat or cool tool. Orbit view supports dragging and wheel zoom.
- Cut/heat/melt buttons act on the fixture's designated supports.
- Enable the scripted crossing to replay its integer commands: the actor walks
  onto the span, waits, and resumes crossing after tick 240. Failure scenes edit
  the supports at tick 180. Both intact controls remain stable through tick 1,024.
- Cut and heated stone supports cause the first fall at tick 180. Ice supports
  melt at ticks 180–182; the frozen span first falls at ticks 181–183.
- A/B switches naturalistic and diagnostic rendering without changing physics.
  Save/load checkpoints retain the actor, absolute tick and complete terrain.
- Reaching the goal commits `status: 'won'` and one `crossed` event. M5 does not
  require the older controller's carve/freeze objectives. Paused presentation
  cannot complete the crossing; lost actors cannot win.
- After a frame error, Reset or a successful checkpoint recovery restarts the
  display loop in the paused state. Press Play to resume.

The player is kinematic and exerts no structural load. Structures carry their
own material weight. Falling fragments translate downward without rotation;
contact does not weld fragments. Combustion, pressure, velocity, elasticity and
reciprocal player forces are outside this milestone.

## Public SDK boundary

```js
import {createStateSpaceStructuralWorld3D, MAT}
  from 'state-space-engine/experimental/3d/structural-world';
import {createStateSpaceStructuralWorld3DGPU}
  from 'state-space-engine/experimental/3d/structural-world/gpu';

const cpu = createStateSpaceStructuralWorld3D({width: 32, height: 32, depth: 32, chunkSize: 8});
cpu.setCell(4, 8, 4, MAT.STONE, 20);
cpu.setAnchor(4, 8, 4, true);
cpu.setCell(5, 8, 4, MAT.STONE, 20);
const gpu = await createStateSpaceStructuralWorld3DGPU({width: 32, height: 32, depth: 32, chunkSize: 8, mode: 'active'});
await gpu.restore(cpu.snapshot());
await gpu.step(1, {edits: [{kind: 'material', x: 4, y: 8, z: 4, material: MAT.AIR, thermal: 0}]});
const checkpoint = await gpu.snapshot();
gpu.close();
```

The CPU API is synchronous; GPU operations are awaited and reject overlapping
requests. Dimensions use the finite M4 geometry restrictions: power-of-two
dimensions, full chunks of edge 4–32, at most 512 chunks and 128³ cells.
Snapshots use schema 2, `ca-3d-m5` and `finite-structural-1`; older states are
rejected rather than acquiring implicit bonds. Restore establishes a new energy
accounting baseline. State reads are isolated copies; edit batches validate
before publishing state. Explicit placement and freezing seed bonds, whereas
later contact does not.

The demo uses resident gameplay with `tool: 'none'`; validated structural edits
are supplied separately. External terrain edits/restores require refreshing the
controller's actor state before gameplay resumes. A GPU device failure faults
the world; recreate it from an exported application checkpoint.

M5 resolves its positional goal from the integer actor result at the existing
completion boundary, after collision and loss resolution. The committed status
is saved and uploaded with the actor on the next request. This adds no GPU
submission and changes neither terrain physics nor the M1–M4 controller.

## Verification

See [the M5 checkpoint](../../docs/checkpoints/3D_M5.md) for the frozen rules,
current acceptance status, complete-state replay and full-frame receipts.
Runtime verification must use one bounded stage at a time through
`scripts.recover_m5_verification`. The workstation incident hold remains active.
Do not run aggregate native suites or quarantined legacy demo trajectories.
