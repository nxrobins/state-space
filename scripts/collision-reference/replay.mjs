/** Engine-independent orchestration; synthetic tests exercise failure paths. */
import { captureExact, compareExact, decodeExact } from './exact-state.mjs';
export const owned = (x) => captureExact(x).value;
export function same(a, b, label) {
  const result = compareExact(a, b);
  if (!result.equal) throw Error(`${label}: ${JSON.stringify(result).slice(0, 1500)}`);
}
const rejects = (fn, label) => {
  let rejected = false;
  try {
    fn();
  } catch {
    rejected = true;
  }
  if (!rejected) throw Error(`${label}: operation unexpectedly succeeded`);
};

export function drivePreview(job, budget, expectedTicks) {
  let previous = job.progress();
  for (let calls = 0; previous.status === 'running'; calls++) {
    if (calls >= 6000002) throw Error('World advance-call cap exhausted');
    const next = job.advance(budget);
    if (
      !Number.isSafeInteger(next.work) ||
      !Number.isSafeInteger(next.lastAdvanceWork) ||
      next.lastAdvanceWork < 0 ||
      next.lastAdvanceWork > budget ||
      next.work - previous.work !== next.lastAdvanceWork ||
      !Number.isSafeInteger(next.completedTicks) ||
      next.completedTicks < previous.completedTicks ||
      next.completedTicks > expectedTicks ||
      (next.status === 'running' &&
        next.work === previous.work &&
        next.completedTicks === previous.completedTicks)
    )
      throw Error('Invalid or stalled preview progress');
    previous = next;
  }
  if (previous.status !== 'ready' || previous.completedTicks !== expectedTicks)
    throw Error('Preview did not finish at the specified horizon');
  const result = owned(job.result());
  if (
    result.ticks.length !== expectedTicks ||
    result.ticks.reduce((s, t) => s + t.work, 0) !== previous.work
  )
    throw Error('Tick receipts disagree with progress');
  return result;
}

/** Original LEG-WORKER horizon: two preview ticks, one continued tick. */
export function checkWorldReplay(factory, input, budget) {
  if (![1, 7, 256].includes(budget)) throw Error('Unregistered work budget');
  const original = captureExact(input),
    jobs = [],
    worlds = [];
  const make = () => {
    const w = factory(decodeExact(original.encoding, original.sha256));
    worlds.push(w);
    return w;
  };
  const prepare = (w, edits, ticks) => {
    const p = w.prepare(edits, ticks);
    jobs.push(p);
    return p;
  };
  let result, failure;
  try {
    const world = make();
    for (const ready of [false, true]) {
      const cancelled = prepare(world, [], 2);
      if (ready) drivePreview(cancelled, budget, 2);
      else cancelled.advance(1);
      cancelled.cancel();
      rejects(() => cancelled.result(), 'cancelled result');
      rejects(() => world.commit(cancelled), 'cancelled commit');
      same(world.snapshot(), original.value, 'cancellation isolation');
    }
    const preview = prepare(world, [{ kind: 'heat', id: 'a', energyQ: 3 }], 2);
    const forecast = drivePreview(preview, budget, 2);
    same(world.snapshot(), original.value, 'preview isolation');
    const publication = owned(world.commit(preview));
    same(publication.result, forecast, 'preview/commit');
    same(world.snapshot(), forecast.snapshot, 'published snapshot');
    const saved = captureExact(world.snapshot());
    rejects(() => world.commit(preview), 'stale token');
    const foreign = make(),
      foreignJob = prepare(foreign, [], 0);
    drivePreview(foreignJob, budget, 0);
    rejects(() => world.commit(foreignJob), 'foreign token');
    same(world.snapshot(), saved.value, 'rejected-token isolation');
    const exactRestart = make(),
      jsonRestart = make();
    exactRestart.restore(decodeExact(saved.encoding, saved.sha256));
    jsonRestart.restore(JSON.parse(JSON.stringify(saved.value)));
    same(exactRestart.snapshot(), saved.value, 'lossless restore');
    // JSON restart is tested independently; signed-zero loss is a failure, never normalized.
    same(jsonRestart.snapshot(), saved.value, 'application JSON restore');
    const continued = [];
    for (const target of [world, exactRestart, jsonRestart]) {
      const next = prepare(target, [], 1);
      drivePreview(next, budget, 1);
      continued.push(owned(target.commit(next)));
    }
    same(continued[0], continued[1], 'exact continued result and revision');
    same(continued[0], continued[2], 'JSON continued result and revision');
    same(input, original.value, 'input ownership');
    result = { initial: original.value, forecast, publication, continuation: continued[0] };
  } catch (error) {
    failure = error;
  }
  const cleanup = [];
  const liveAtFailure = [];
  if (failure)
    for (const world of worlds) {
      try {
        liveAtFailure.push({ revision: world.revision(), snapshot: owned(world.snapshot()) });
      } catch (error) {
        cleanup.push('failure capture: ' + String(error));
      }
    }
  for (const job of jobs)
    try {
      job.cancel();
    } catch (error) {
      cleanup.push(String(error));
    }
  for (const world of worlds)
    try {
      world.close?.();
    } catch (error) {
      cleanup.push(String(error));
    }
  if (failure || cleanup.length) {
    const error = Error(JSON.stringify({ failure: failure?.message ?? null, cleanup }));
    error.partial = { liveAtFailure, cleanup };
    throw error;
  }
  return result;
}
