# Tactical worker integration

This is an application bootstrap example, not an automatically running demo.
Bundle `client.js` and its module worker with a bundler that resolves the public
`state-space-engine` package. The Build 20 mock transport tests, full types, lint
and SDK build passed; the API is included in the built package. The zero-tick
package-integration check also passed through an isolated mock channel. No
renderer, browser or native Worker was launched. Real worker/physics acceptance
remains held.

```js
import {startTacticalWorker} from './client.js';
const client = startTacticalWorker(initialSession, 'one-owned-worker');
await client.ready;
const readings = await client.query([{kind: 'fit', request: {
  box: {minQ: [1024, 0, 1024], maxQ: [2048, 1024, 2048]},
}}]);
// Use readings.base to associate answers with the committed revision.
const ticket = client.request({x: 3, y: 4, z: 2, cost: 1}, 8);
const outcome = await ticket.result;
if (outcome.status === 'ready' && client.state.readyId === ticket.id) {
  // Display outcome.preview; on the player's confirmation:
  const committed = await client.commit(ticket);
  // Update rendering from committed.snapshot.
}
await client.close();
```

The example game state requires a nonnegative integer `ap`. The lift command is
only an integration example; material ownership/range, actor motion policy, turn
state and other game rules belong in this worker module. Replace its rules for
your game rather than sending functions or source code in messages.

`client.snapshot()` remains the last confirmed complete state while a preview is
running and after a connection failure. A failure during commit/restore can leave
an **uncertain** outcome: inspect `client.state.uncertain`, retain the saved state
and require explicit recovery. The SDK never automatically resends that mutation.

The client owns the passed Worker and terminates it on close or transport failure.
Full snapshot transfer/validation still has a main-thread cost; measured camera
responsiveness and physical replay equivalence remain separate acceptance gates.

The current source protocol is `tactical-worker-7`; both peers must use the same SDK
version. Queries are bounded, committed geometry reads and require an idle
client. They do not advance physics or compute structural support capacity.

After committing, `await client.changes(committed, {maxRuns: 512})` reads that
action's endpoint report. Keep the exact latest commit object. Report failure
does not undo the committed action. Physical changes can require global support
solves, so this route has no measured latency guarantee; real solve verification
remains held. It reports endpoint changes, not intra-action fragment motion.

For captured simulation-tick correspondence, request a preview with
`client.request(command, horizon, {motion: {maxEntries: 4096}})`, then read
`await client.motion(committed)` after acknowledgment. The latest commit's
bounded report contains net cell movement, touched identities and falling
fragment membership. Check `status` and `requiresReexecution`; disabled or
overflow reports are not complete empty motion. This report does not contain
subpass paths or direct intervention motion, and cannot supply swept collisions.
No live worker or physical replay test is authorized by this example.

Enable `{paths: {maxEntries: 4096}}` in the request to retain subpass crossings,
then use `await client.paths(committed)`. This includes the matching net trace
and keeps linear falls separate from displaced-cell relocation. It covers
simulation ticks, excluding direct interventions. Returned records support
inspection; they are not live actor-resolution contexts. Actor responses still
belong in the worker's reducer with its original before/after geometry. Build 23
passed CPU/mock and package gates; physical/native-worker acceptance remains held.

Before committing a ready ticket, `client.queryPreview(ticket, requests)` reads
its private candidate using the five geometry operations. Answers retain preview
stamps; an intervening cancellation or close rejects a pending read. These mock-
verified semantics do not establish native Worker latency or physics replay.
