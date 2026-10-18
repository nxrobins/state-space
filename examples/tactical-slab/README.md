# Hot slab tactical reference

This SDK-only reference ties material history, actor response, targeting queries,
ability costs, temporary control, previews and atomic commits into one application.
It includes a headless model and a browser UI. No worker, renderer or physical
tick starts on public-module import. The existing demos remain quarantined.

The deterministic 8³ chamber contains a hot, damaged 2×2 stone slab and a walkway
bonded through it to an anchored abutment. One unit rides the slab; another stands
on the walkway. Lifting the slab two cells cuts its external bonds, preserves its
internal bonds and thermal/damage history, carries the rider and blocks a firing
line. Temporary control expires at the action's starting tick plus four. The
walkway's actual response and later falling behavior still require held physical
acceptance tests; a disconnected bond graph does not prove a support outcome.

The `hot-slab-game-4` chamber also seeds steam, water and sand parcels. Wind adds
one half-cell impulse to the selected parcel; wind and drift each advance every
remaining parcel one explicit transport cycle for one AP. Drift reuses saved
velocity. Environmental preview ticks use ordinary material movement and refresh
parcel identity without repeating wind. The displayed controls include positions,
velocity, fractional displacement and thermal history. A/B, export/import and
atomic resource costs use the same session boundary as other interventions.
Old chamber saves reject explicitly. Native interaction and material evolution
remain held; edit and inert-driver checks are not visual or physical acceptance.

The v4 chamber checks peer contact during terrain-driven motion as well as
voluntary movement. Passing through another unit invalidates the candidate even
if their endpoints would be separate. The exact contact is diagnosed before
publishing any terrain, actor or resource change. This detector does not push a
teammate or assign damage; those responses need an explicit game policy.

Bundle `index.ts` in an application that resolves the public `state-space-engine`
package. `scenario.ts` owns game policy; it imports no engine internals.

The browser source is `index.html` / `ui-app.ts`. After the SDK build,
`npm run build:tactical-slab` produces `dist/tactical-slab/index.html`, `app.js`,
`worker.js` and the stylesheet through public package exports. Building does not
launch the page. Do not open/run it until native runtime review permits it.
The page's Start button reads `../verification/safety-hold.json` with no HTTP
caching and a two-second abort limit. Missing, unreadable or active holds block
device/worker acquisition. The existing hold remains active. This client does
not clear it, interpret a permit as general clearance, or launch legacy demos.

After runtime acceptance, Start acquires an owned device and a dedicated worker.
Choose lift, heat/cool, release, air assistance or environmental resolution;
declare zero to eight ticks (default two; air needs at least one), inspect the candidate, compare it with committed state, then
commit or discard. AP, heat budget, held control, firing line, actor support and
exposure refer to the displayed complete boundary. Cell inspection follows that
same state. Coordinate/energy labels marked Q are integer diagnostic units.
Export writes the complete last acknowledged save; imports are bounded to 256 KiB
and validated before replacing a candidate. Reset restores the seeded chamber.

Simulation remains in the worker. The UI coalesces intents to one active and one
latest waiting request and sends one five-query observation batch per complete
displayed boundary. Superseded inspections cannot become committable. A lost
mutation reply is explicitly uncertain and is never retried. If inspection fails
after acknowledgement, the save retains the accepted commit and the UI labels
the older displayed revision. This is distinct from an action rollback.

Drag/keyboard orbit and wheel/keyboard zoom affect only the camera. Rendering is
on demand, with one outstanding frame and one coalesced dirty successor. Resizes
replace owned depth targets only between completed frames. One owned 250 ms status
timer updates controls; it schedules no simulation or continuous rendering and is
removed on Stop. The guard is rechecked before each mutation and frame. Stop drains
owned work and releases targets/device/worker; leaving the page also requests
cleanup. GPU hangs still require the external watchdog and bounded native gate.
Native pixels, worker responsiveness, physical trajectories and latency remain
unverified while the hold is active. The UI has no naturalistic rendering claim.

```ts
import {createSlabController} from './index.js';
const game = createSlabController();
// Default horizon is two real M5 ticks. Run only after runtime review permits it.
const ticket = game.request({kind: 'lift'});
const result = await ticket.result;
if (result.status === 'ready') {
  const presentation = await game.inspectPreview(ticket);
  // Display the candidate's identity, firing line, support and exposure.
  // On the player's acceptance:
  const committed = game.commit(ticket);
  // Render committed.snapshot. Save this complete envelope for continuation.
}
await game.close();
```

Passing `0` as the second request argument explicitly selects edit inspection.
That validates the intervention at one instant; it predicts no subsequent
collapse, heat transfer or falling. The verification harness uses only this mode
with production SDK code. Tests of nonzero scheduling use injected inert drivers.
Do not use those tests as evidence that the physical scene has passed.

Commands are `{kind:'lift'}`, `{kind:'release'}`, `{kind:'heat',deltaQ}`,
`{kind:'air',unit:'rider'|'scout',direction:'up'|'west'|'east'|'north'|'south'}` and
`{kind:'wait'}`. Lift/release/heat/air cost one AP. Heating and cooling cost the
absolute externally transferred energy from a finite heat resource. Wait has no
AP cost. Every accepted command increments the turn/action counter. RNG is saved
but these deterministic abilities do not draw from it. Costs, control range and
eligibility belong to the game. Invalid commands, stale previews, blocked routes,
insufficient resources and unresolved/crushed actor responses cannot partially
publish terrain, units or resources. A failed candidate must be recomputed.

Air assistance stages one pending intent in the private preview. After the first
complete material tick, the reducer resolves terrain-driven displacement, applies
the selected 512-Q impulse once and clears the intent. Later ticks retain velocity
and apply gravity. The unit selectors use world directions: west/east are −X/+X,
north/south are −Z/+Z and up is −Y. Range is measured from the scout, independently
of whether the slab is in range. A pending intent cannot be saved or committed;
cancellation/failure rolls back its AP and actor consequences with the whole action.
Positions and velocities in the UI refer to the selected A/B boundary.

Actor translation uses observed paths. At each complete simulation tick the
policy resolves terrain displacement, then peer-aware fixed-point body movement.
Voluntary movement uses ascending actor ID and X/Z/Y sweeps, as defined by the SDK's
`actor-movement-1` contract. It clips against peers without pushing or implicit
carrying. Incomplete terrain movement, unresolved responses and completed overlap
are rejected. General terrain-driven actor-actor contact, external loads, health
and knockdown are not implemented here. Selecting slab cells tracks observed matter correspondence
during the action; these indices are not permanent engine entity IDs.

For a worker-owned session, create a dedicated worker entry which explicitly
calls `installSlabWorker(self)`. Initialize it once with
`{kind:'initialize',channel,snapshot:null}` (or a complete saved snapshot), then
connect the SDK worker client using that channel, world `hot-slab-chamber` and
game rules `hot-slab-game-2`. Both local and worker paths use the same policy and
preparation callback. Host lifecycle cleanup is available from the returned
async disposer. Native Worker/browser execution remains held.

Version 2 changes future actor movement and adds the private pending-intent field.
Version 1 saves are rejected, not silently migrated. Complete version 2 saves have
`pendingAir: null` and preserve actor velocity, gravity and the shared body-step
counter for continuation. Old saves require the older application rules.

The controller caps preview horizons at eight ticks and uses the SDK's bounded
latest-request queue. Its synchronous CPU work is **not** a responsiveness claim;
the worker boundary and rendering need separate measured acceptance. Captured
paths and all presentation observations remain disposable data outside saves.

Build 26 passed 699 selected edit/inert tests, including 25 reference cases, full
types, lint, eleven SDK bundles/declarations and zero-tick built-package reference
integration. [Evidence](../../docs/checkpoints/tactical-interventions/build-26-2026-10-17/summary.json)
retains source hashes, resource limits and verified cleanup. Its four authored
material cases plus two new air/continuation cases in
`tactical-slab.runtime-cases.ts` remain excluded from the selected CPU suite.
Physical replay, GPU/frame testing and visual acceptance remain held.
# Rendering adapter (CPU/mock acceptance only)

`prepareSlabScene(snapshot, observation)` uses the experimental public tactical
renderer entry to prepare terrain, actor boxes and outlined slab cells at the
same complete revision or preview identity. Use `controller.inspect()` for a
committed snapshot, or `inspectPreview(ticket)` for its completed candidate.
Mixing observations from a different boundary is rejected. Scene preparation
does not change the saved game or run physics. It makes a full isolated copy;
call it when the published scene changes, not for camera movement.

The caller can pass that scene to `createTacticalRenderer3D` with its own device,
color/depth targets and camera. This example does not start a browser, acquire a
GPU, run a frame loop or provide a tactical UI. Native shader compilation, depth
occlusion, rendered appearance and frame latency remain held acceptance gates.

