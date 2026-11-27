import {
  createMultiphysicsProfiles3D,
  createMultiphysicsWorld3D,
} from 'state-space-engine/experimental/3d/multiphysics';
import { firstDifference, sliceCount, sliceTicks, startTick, viewOf } from './slice.mjs';

// The crossing client offers these two lateral orders. The worker never receives a command tape.
export function lateralOrder(direction) {
  if (direction !== -1 && direction !== 1) throw Error('Invalid lateral order');
  return [[{ kind: 'impulse', id: 'engineer', impulse: [0, 0, direction * 0.001] }], [], [], []];
}

function yieldTurn(background) {
  if (globalThis.scheduler?.postTask)
    return globalThis.scheduler.postTask(() => {}, {
      priority: background ? 'background' : 'user-visible',
    });
  return new Promise((resolve) => {
    if (typeof setImmediate === 'function') setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
}

// One worker owns the public session and advances both private forecasts serially.
// At most one selected four-tick result and two choices for its endpoint are retained.
export async function createChoiceSession(yieldTask = yieldTurn) {
  const profiles = await createMultiphysicsProfiles3D();
  const world = (snapshot) => createMultiphysicsWorld3D(profiles, snapshot);
  const menu = [-1, 1].map(lateralOrder);
  let live, pool, selected, history, prepare;
  let generation = 0,
    latest = 0;

  function branch(base, edits) {
    return { base, edits, rows: [], fork: undefined, plan: undefined, failed: false };
  }

  function advance(branch) {
    const end = performance.now() + 4;
    branch.fork ??= world(branch.base);
    do {
      branch.plan ??= branch.fork.prepare(branch.edits[branch.rows.length], 1);
      if (branch.plan.advance(256).status === 'ready') {
        branch.rows.push(branch.fork.commit(branch.plan).result);
        branch.plan = undefined;
      }
    } while (branch.rows.length < sliceTicks && performance.now() < end);
    if (branch.rows.length === sliceTicks) branch.fork = undefined;
  }

  function schedule(base) {
    pool = undefined;
    if (!prepare || base.tick >= startTick + sliceCount * sliceTicks) return;
    const batch = { base, choices: menu.map((edits) => branch(base, edits)) };
    pool = batch;
    // Selecting, cancelling or restoring detaches the pool before the next quantum.
    void (async () => {
      for (const choice of batch.choices) {
        try {
          while (choice.rows.length < sliceTicks) {
            await yieldTask(true);
            if (pool !== batch) return;
            advance(choice);
          }
        } catch {
          // Re-run a failed speculative branch through the normal request/rejection path.
          choice.failed = true;
        }
      }
    })();
  }

  return async function handle(message) {
    const { kind, tick, requestId, snapshot, edits } = message;
    if (kind === 'init') {
      if (
        snapshot?.tick !== startTick ||
        snapshot.rules !== 'multiphysics-world-2' ||
        typeof message.prepare !== 'boolean'
      )
        throw Error('Invalid crossing start');
      live = world(snapshot).snapshot();
      prepare = message.prepare;
      generation++;
      latest = 0;
      selected = undefined;
      history = [];
      schedule(live);
      return { tick: live.tick, generation };
    }
    if (!live || message.generation !== generation || tick !== live.tick)
      throw Error('Stale battlefield request');
    if (kind === 'audit') return { history, live };
    if (kind === 'status')
      return {
        prepared:
          pool?.base === live ? pool.choices.filter((b) => b.rows.length === sliceTicks).length : 0,
      };
    if (kind === 'cancel' || kind === 'commit') {
      if (!selected || selected.id !== requestId) throw Error('Stale preview selection');
      if (kind === 'cancel') {
        selected = undefined;
        schedule(live);
        return true;
      }
      const rows = selected.branch.rows;
      if (rows.length !== sliceTicks) throw Error('Preview is not ready');
      live = rows.at(-1).snapshot;
      history.push(...rows);
      selected = undefined;
      return viewOf(live);
    }
    if (
      kind !== 'preview' ||
      !Number.isSafeInteger(requestId) ||
      requestId <= latest ||
      !Array.isArray(edits) ||
      edits.length !== sliceTicks ||
      !Array.from(edits).every(Array.isArray) ||
      live.tick >= startTick + sliceCount * sliceTicks
    )
      throw Error('Invalid battlefield preview');

    const started = performance.now();
    latest = requestId;
    const match =
      pool?.base === live &&
      pool.choices.find((b) => !b.failed && firstDifference(b.edits, edits) === null);
    const current = match || branch(live, edits);
    const path =
      current.rows.length === sliceTicks ? 'prepared' : current.fork ? 'in-flight' : 'fresh';
    const selection = { id: requestId, branch: current };
    selected = selection;
    pool = undefined;
    try {
      if (current.rows.length < sliceTicks) {
        await yieldTask(false);
        if (selected !== selection) throw Error('Superseded battlefield preview');
      }
      while (current.rows.length < sliceTicks) {
        advance(current);
        if (current.rows.length < sliceTicks) {
          await yieldTask(false);
          if (selected !== selection) throw Error('Superseded battlefield preview');
        }
      }
      const views = current.rows.map((row) => viewOf(row.snapshot));
      schedule(current.rows.at(-1).snapshot);
      return { views, requestId, path, workerMs: performance.now() - started };
    } catch (error) {
      if (selected === selection) {
        selected = undefined;
        schedule(live);
      }
      throw error;
    }
  };
}

// Replies can arrive out of order when a new order cancels a running selection.
export function choiceResponder(post) {
  const session = createChoiceSession();
  return async (message) => {
    const { sequence } = message;
    try {
      post({ sequence, value: await (await session)(message) });
    } catch (error) {
      post({ sequence, error: String(error) });
    }
  };
}
