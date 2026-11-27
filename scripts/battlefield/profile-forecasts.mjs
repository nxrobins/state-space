/** Profile #131's late four-tick selections against its independent packet. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { Session } from 'node:inspector/promises';
import { cpus } from 'node:os';
import { basename, resolve } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createMultiphysicsWorld3D } from 'state-space-engine/experimental/3d/multiphysics';
import { guardNode } from '../verification_guard.mjs';
import { createChoiceSession } from './choices.mjs';
import { lateralOrder } from './choice-client.mjs';
import { unpack } from './slice.mjs';

const menu = [-1, 1].map(lateralOrder);
// Union of #131's hosted and Mac cold misses. The five partial starts missed in Mac playback.
const partialStarts = [108, 112, 116, 140, 144];
const packetSHA256 = '37e4cbe4321da8272db6bd049de241c32652e76172794c8ca6048fb816f5bf0c';

// Named boundaries distinguish a selected tick's CPU samples from unused speculation and checks.
function freshAdvance(plan, budget) {
  return plan.advance(budget);
}
function remainingAdvance(plan, budget) {
  return plan.advance(budget);
}

async function forecast(slice, snapshot, partial) {
  let foreground = false;
  const parked = [];
  const branches = [];
  function world(profiles, base) {
    const start = performance.now();
    const original = createMultiphysicsWorld3D(profiles, base);
    const branch = { forkMs: performance.now() - start, ticks: [] };
    branches.push(branch);
    let active;
    return {
      snapshot: original.snapshot,
      prepare(edits, count) {
        const before = performance.now();
        const plan = original.prepare(edits, count);
        const row = {
          prepareMs: performance.now() - before,
          prefixWork: 0,
          prefixMs: 0,
          remainingWork: 0,
          remainingMs: 0,
          commitMs: null,
        };
        branch.ticks.push(row);
        branch.firstEdit ??= edits;
        const wrapped = {
          advance(budget) {
            const since = performance.now();
            const progress = foreground
              ? partial
                ? remainingAdvance(plan, budget)
                : freshAdvance(plan, budget)
              : plan.advance(budget);
            const elapsed = performance.now() - since;
            if (foreground) {
              row.remainingWork += progress.lastAdvanceWork;
              row.remainingMs += elapsed;
            } else {
              row.prefixWork += progress.lastAdvanceWork;
              row.prefixMs += elapsed;
            }
            return progress;
          },
        };
        active = { plan, wrapped, row };
        return wrapped;
      },
      commit(wrapped) {
        assert.equal(wrapped, active.wrapped);
        const before = performance.now();
        const result = original.commit(active.plan);
        active.row.commitMs = performance.now() - before;
        return result;
      },
    };
  }
  const session = await createChoiceSession(
    (background) => (background ? new Promise((resolve) => parked.push(resolve)) : nextTurn()),
    world,
  );
  const { generation } = await session({ kind: 'init', snapshot, choices: menu, prepare: partial });
  const send = (kind, extras = {}) =>
    session({ kind, generation, tick: slice.tick, requestId: 1, ...extras });
  const selected = () =>
    branches.find(
      (b) => b.firstEdit && JSON.stringify(b.firstEdit) === JSON.stringify(slice.edits[0]),
    );
  if (partial) {
    // #131 did not save the exact cursor. Release whole background quanta until the chosen
    // branch has completed its first tick. The next three ticks can include partial work.
    while (!selected()?.ticks.some((t) => t.commitMs !== null)) {
      assert.equal(parked.length, 1);
      parked.shift()();
      await Promise.resolve();
    }
  }
  foreground = true;
  const start = performance.now();
  const preview = await send('preview', { edits: slice.edits });
  const replyMs = performance.now() - start;
  assert.equal(preview.path, partial ? 'in-flight' : 'fresh');
  assert.deepEqual(preview.views, slice.views);
  assert.deepEqual(await send('commit'), slice.views.at(-1));
  const audit = await send('audit', { tick: slice.tick + 4 });
  assert.deepEqual(audit.history, slice.results);
  assert.deepEqual(audit.live, slice.results.at(-1).snapshot);
  const branch = selected();
  assert.equal(branch.ticks.length, 4);
  const work = branch.ticks.map((t) => t.prefixWork + t.remainingWork);
  assert(work.every((v) => v > 0));
  // Drop the pending next-menu continuation before letting the old task run.
  await session({ kind: 'init', snapshot, choices: menu, prepare: false });
  for (const resume of parked) resume();
  return {
    start: slice.tick,
    path: preview.path,
    replyMs,
    forkMs: branch.forkMs,
    ticks: branch.ticks,
  };
}

function rank(profile, root) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parents = new Map(profile.nodes.flatMap((n) => (n.children ?? []).map((id) => [id, n.id])));
  const self = new Map(),
    inclusive = new Map();
  let totalUs = 0;
  for (const [i, id] of profile.samples.entries()) {
    const us = profile.timeDeltas[i],
      stack = new Set();
    for (let at = id; at !== undefined; at = parents.get(at)) {
      const f = nodes.get(at).callFrame;
      if (f.functionName === root && f.url === import.meta.url) {
        totalUs += us;
        const leaf = nodes.get(id).callFrame.functionName || '(anonymous)';
        self.set(leaf, (self.get(leaf) ?? 0) + us);
        for (const label of stack) inclusive.set(label, (inclusive.get(label) ?? 0) + us);
        break;
      }
      if (f.url.includes('/dist/sdk/'))
        stack.add(
          (f.functionName || '(anonymous)') + '@' + basename(f.url) + ':' + (f.lineNumber + 1),
        );
    }
  }
  assert(totalUs > 0);
  const top = (map) =>
    [...map]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([frame, us]) => ({ frame, percent: (100 * us) / totalUs }));
  return { totalUs, self: top(self), inclusive: top(inclusive) };
}

await guardNode('cpu', 300);
const bytes = await readFile(process.argv[2]);
assert.equal(createHash('sha256').update(bytes).digest('hex'), packetSHA256);
const packet = unpack(bytes.toString('utf8'));
const dir = resolve('dist/verification/forecast-profile');
await mkdir(dir, { recursive: true });
const output = await mkdtemp(resolve(dir, 'run-'));
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  packetSHA256,
  node: process.version,
  cpu: cpus()[0].model,
  arch: process.arch,
  rounds: [],
};
async function pass() {
  const rows = [];
  for (const [i, slice] of packet.slices.entries()) {
    if (slice.tick < 96 || slice.tick > 176) continue;
    const base = packet.slices[i - 1].results.at(-1).snapshot;
    rows.push(await forecast(slice, base, false));
    if (partialStarts.includes(slice.tick)) rows.push(await forecast(slice, base, true));
  }
  return rows;
}
await pass();
for (let i = 0; i < 3; i++) report.rounds.push(await pass());
const session = new Session();
session.connect();
try {
  await session.post('Profiler.enable');
  await session.post('Profiler.setSamplingInterval', { interval: 250 });
  await session.post('Profiler.start');
  await pass();
  const { profile } = await session.post('Profiler.stop');
  await writeFile(resolve(output, 'forecast.cpuprofile'), JSON.stringify(profile));
  report.sampled = {
    fresh: rank(profile, 'freshAdvance'),
    inFlight: rank(profile, 'remainingAdvance'),
  };
} finally {
  session.disconnect();
}
await writeFile(resolve(output, 'profile.json'), JSON.stringify(report) + '\n');
console.log('Exact forecast profile:', output);
