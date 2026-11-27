import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';
import { choiceChannel, choicePass, forecastTimings } from './choice-client.mjs';
import { createChoiceSession, lateralOrder } from './choices.mjs';
import { createSliceSession, pack, sliceTicks, startTick } from './slice.mjs';

// Independent of the speculative implementation. This digest predates this PR, from
// the original #129 worker on the Mac, using all original edits plus the lateral orders.
const mixedSHA256 = '37e4cbe4321da8272db6bd049de241c32652e76172794c8ca6048fb816f5bf0c';

async function referencePacket(packet) {
  const direct = await createSliceSession();
  direct({ kind: 'init', snapshot: packet.initial });
  const slices = packet.slices.map((s, i) => {
    const edits = structuredClone(s.edits);
    edits[0].push(...lateralOrder(i % 2 === 0 ? 1 : -1)[0]);
    const { views } = direct({ kind: 'preview', tick: s.tick, edits });
    assert.deepEqual(direct({ kind: 'commit', tick: s.tick }), views.at(-1));
    return { tick: s.tick, edits, views };
  });
  const { history } = direct({ kind: 'audit', tick: slices.at(-1).tick + sliceTicks });
  for (const [i, s] of slices.entries())
    s.results = history.slice(i * sliceTicks, (i + 1) * sliceTicks);
  const modified = { ...packet, slices };
  assert.equal(createHash('sha256').update(pack(modified)).digest('hex'), mixedSHA256);
  return modified;
}

async function staleControls(initial, expected) {
  // Park both speculative and foreground continuations so restore/cancel races are reproducible.
  const paused = [];
  const session = await createChoiceSession(() => new Promise((resolve) => paused.push(resolve)));
  const init = (snapshot) => session({ kind: 'init', snapshot, prepare: true });
  let { generation } = await init(initial);
  const send = (kind, opts = {}) => session({ kind, tick: startTick, generation, ...opts });
  const preview = (id) => send('preview', { requestId: id, edits: lateralOrder(1) });
  const first = preview(1);
  await send('cancel', { requestId: 1 });
  const cancelled = assert.rejects(first, /Superseded/);
  const second = preview(2);
  const superseded = assert.rejects(second, /Superseded/);
  const third = preview(3);
  const restored = assert.rejects(third, /Superseded/);
  const oldGeneration = generation;
  const other = structuredClone(initial);
  other.parcels.find((p) => p.id === 'engineer').velocity[2] += 0.0001;
  ({ generation } = await init(other));
  assert.notEqual(generation, oldGeneration);
  for (const resume of paused.splice(0)) resume();
  await Promise.all([cancelled, superseded, restored]);
  await assert.rejects(send('commit', { generation: oldGeneration, requestId: 3 }), /Stale/);
  await assert.rejects(
    send('preview', { generation: oldGeneration, requestId: 4, edits: lateralOrder(1) }),
    /Stale/,
  );
  assert.deepEqual((await send('audit')).live, other);
  ({ generation } = await init(initial));
  assert.deepEqual((await send('audit')).history, []);
  // Release the scheduler till both branches are complete.
  while (paused.length) {
    for (const resume of paused.splice(0)) resume();
    await Promise.resolve();
  }
  assert.equal((await send('status')).prepared, 2);
  const hit = await preview(1);
  assert.equal(hit.path, 'prepared');
  assert.deepEqual(hit.views, expected.views);
  await assert.rejects(send('commit', { requestId: 2 }), /Stale/);
  await send('cancel', { requestId: 1 });
  await assert.rejects(send('commit', { requestId: 1 }), /Stale/);
  await assert.rejects(preview(1), /Invalid/);
  assert.deepEqual((await send('audit')).live, initial);
}

export async function verifyChoices(packet) {
  const reference = await referencePacket(packet);
  await staleControls(packet.initial, reference.slices[0]);
  const worker = new Worker(new URL('./node-worker.mjs', import.meta.url), {
    workerData: { twoChoice: true },
  });
  const channel = choiceChannel((data) => worker.postMessage(data));
  worker.on('message', channel.receive);
  worker.on('error', channel.fail);
  worker.on('exit', (code) => channel.fail(Error('Choice worker exited ' + code)));
  const runs = {};
  try {
    for (const prepare of [false, true]) {
      const send = choicePass(channel.request, prepare);
      const rows = [];
      for (let round = 0; round < 2; round++) {
        await send({ kind: 'init', snapshot: reference.initial });
        for (const { tick, edits, views } of reference.slices) {
          const before = performance.now();
          if (prepare) {
            // A controlled prepared-hit measurement. Report the waiting time separately.
            while ((await send({ kind: 'status', tick })).prepared !== 2) {
              if (performance.now() - before > 10000) throw Error('Preparation deadline');
              await delay(5);
            }
          }
          const submitted = performance.now();
          const result = await send({ kind: 'preview', tick, edits });
          const replyMs = performance.now() - submitted;
          assert.deepEqual(result.views, views);
          assert.equal(result.path, prepare && tick !== 104 ? 'prepared' : 'fresh');
          assert.deepEqual(await send({ kind: 'commit', tick }), views.at(-1));
          await assert.rejects(send({ kind: 'commit', tick }), /Stale/);
          if (round)
            rows.push({
              tick,
              path: result.path,
              prepareWaitMs: submitted - before,
              workerMs: result.workerMs,
              replyMs,
            });
        }
        const audit = await send({
          kind: 'audit',
          tick: reference.slices.at(-1).tick + sliceTicks,
        });
        assert.deepEqual(
          audit.history,
          reference.slices.flatMap((s) => s.results),
        );
        assert.deepEqual(audit.live, reference.slices.at(-1).results.at(-1).snapshot);
      }
      runs[prepare ? 'twoChoice' : 'fresh'] = {
        raw: rows,
        timings: forecastTimings(rows, 'replyMs'),
      };
    }
  } finally {
    await worker.terminate();
  }
  return {
    reference,
    report: {
      packetSHA256: mixedSHA256,
      exactTicks: reference.slices.length * sliceTicks,
      staleControls: true,
      runs,
    },
  };
}
