/** Private native-Worker qualification probe: exactness and latency on one named scene. No UI. */
import { createMultiphysicsProfiles3D, type MultiphysicsProfiles3D } from './profiles.js';
import { createMultiphysicsWorld3D, type MultiphysicsPreviewResult3D } from './world.js';
import type { MultiphysicsSnapshot3D } from './model.js';
import {
  createMultiphysicsDemonstration3D,
  createMultiphysicsTimedCup3D,
  type MultiphysicsDemonstration3D,
} from './demonstrations.js';
import {
  createMultiphysicsWorkerClient3D,
  multiphysicsBrowserWorkerTransport3D,
} from './worker-client.js';
import { MULTIPHYSICS_WORKER_BOOTSTRAP_3D } from './worker-wire.js';
export const MULTIPHYSICS_WORKER_SCENES_3D = Object.freeze([
  'wax-valve',
  'rotating-contact',
  'fluid-switch',
  'falling-battery',
  'combined-failure',
  'timed-cup',
] as const);
export type MultiphysicsWorkerScene3D = (typeof MULTIPHYSICS_WORKER_SCENES_3D)[number];
/** Original fixed 16-cubed macOS targets; never derived from measurements. */
export const MULTIPHYSICS_WORKER_TARGETS_3D = Object.freeze({
  previewP95Ms: 250,
  cancellationP95Ms: 100,
});
const SAMPLES = 24,
  PREVIEW_TICKS = 2;
type Distribution = { count: number; min: number; p50: number; p95: number; worst: number };
function distribution(values: readonly number[]): Distribution {
  const a = [...values].sort((x, y) => x - y);
  return {
    count: a.length,
    min: a[0],
    p50: a[Math.floor(a.length * 0.5)],
    p95: a[Math.ceil(a.length * 0.95) - 1],
    worst: a[a.length - 1],
  };
}
/** Exact equality of portable values, independent of object key order (doubles round-trip in JSON). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
/** First differing path between two portable values, for failure reports. */
function difference(a: unknown, b: unknown, path = '$'): string | null {
  if (canonical(a) === canonical(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const found = difference(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
      if (found) return found;
    }
  }
  return `${path}: ${canonical(a)?.slice(0, 160)} vs ${canonical(b)?.slice(0, 160)}`;
}
const exact = (actual: unknown, expected: unknown, text: string) => {
  const found = difference(actual, expected);
  if (found) throw Error(`${text} at ${found}`);
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function sceneSnapshot(profiles: MultiphysicsProfiles3D, scene: MultiphysicsWorkerScene3D) {
  if (!MULTIPHYSICS_WORKER_SCENES_3D.includes(scene)) throw Error('Unknown multiphysics scene.');
  return scene === 'timed-cup'
    ? createMultiphysicsTimedCup3D(profiles)
    : createMultiphysicsDemonstration3D(profiles, scene as MultiphysicsDemonstration3D);
}
/** Start a module Worker from a snapshot and return its connected client. */
async function startWorker(
  url: URL,
  profiles: MultiphysicsProfiles3D,
  snapshot: MultiphysicsSnapshot3D,
  work: number,
) {
  const worker = new Worker(url, { type: 'module' });
  try {
    await new Promise<void>((resolve, reject) => {
      const done = (event: MessageEvent) => {
        worker.removeEventListener('message', done);
        worker.removeEventListener('error', failed);
        const data = event.data as { kind?: unknown; ready?: unknown; error?: unknown };
        if (data?.kind === MULTIPHYSICS_WORKER_BOOTSTRAP_3D && data.ready === true) resolve();
        else reject(Error(String(data?.error ?? 'Multiphysics Worker did not start.')));
      };
      const failed = () => reject(Error('Multiphysics Worker failed to load.'));
      worker.addEventListener('message', done);
      worker.addEventListener('error', failed);
      worker.postMessage({ kind: MULTIPHYSICS_WORKER_BOOTSTRAP_3D, snapshot, work });
    });
  } catch (error) {
    worker.terminate();
    throw error;
  }
  const client = createMultiphysicsWorkerClient3D(
    multiphysicsBrowserWorkerTransport3D(worker),
    profiles,
  );
  await client.ready;
  return client;
}
/** Direct, same-thread trajectory of committed two-tick previews: the exactness reference.
 * Yields after each sample so the page stays responsive to the supervisor. */
async function directTrajectory(
  profiles: MultiphysicsProfiles3D,
  initial: MultiphysicsSnapshot3D,
  count: number,
  progress: (text: string) => void,
) {
  const world = createMultiphysicsWorld3D(profiles, initial),
    results: MultiphysicsPreviewResult3D[] = [],
    ms: number[] = [];
  for (let i = 0; i < count; i++) {
    const started = performance.now(),
      preview = world.prepare([], PREVIEW_TICKS);
    while (preview.progress().status === 'running') preview.advance(256);
    results.push(world.commit(preview).result);
    ms.push(performance.now() - started);
    progress(`Direct reference ${i + 1}/${count}`);
    await pause(0);
  }
  return { results, ms };
}
export async function runMultiphysicsWorkerProbe3D(options: {
  scene: MultiphysicsWorkerScene3D;
  workerUrl: URL;
  progress?: (text: string) => void;
}) {
  const { scene, workerUrl } = options,
    progress = options.progress ?? (() => {}),
    profiles = await createMultiphysicsProfiles3D(),
    initial = sceneSnapshot(profiles, scene);
  const report: Record<string, unknown> = {
    scene,
    parcels: initial.parcels.length,
    bonds: initial.bonds.length,
    dt: initial.settings.dt,
    previewTicks: PREVIEW_TICKS,
    samples: SAMPLES,
    targets: MULTIPHYSICS_WORKER_TARGETS_3D,
    scope:
      'Page-observed latency of the private module Worker: preview from request to validated reply; cancellation from request to acknowledgement',
  };
  // One extra committed sample for the save/restart continuation.
  const direct = await directTrajectory(profiles, initial, SAMPLES + 1, progress);
  report.directPreviewMs = distribution(direct.ms);
  // Each budget yields at a different point; every committed result must match exactly.
  const budgets: Record<string, boolean> = {};
  for (const work of [1, 256]) {
    progress(`Work budget ${work}`);
    const client = await startWorker(workerUrl, profiles, initial, work);
    try {
      const preview = await client.preview([], PREVIEW_TICKS);
      exact(preview.result, direct.results[0], `Work budget ${work} preview differs`);
      exact(
        (await client.commit(preview)).result,
        direct.results[0],
        `Work budget ${work} commit differs`,
      );
      budgets[work] = true;
    } finally {
      client.close();
    }
  }
  report.workBudgetsExact = budgets;
  const client = await startWorker(workerUrl, profiles, initial, 128);
  const previewMs: number[] = [],
    cancellationMs: number[] = [],
    cancelledWhileRunning: boolean[] = [];
  let saved!: MultiphysicsSnapshot3D;
  try {
    for (let i = 0; i < SAMPLES; i++) {
      // Cancel a preview part-way, then retry the same request from the same live state.
      const abandoned = client.preview([], PREVIEW_TICKS),
        outcome = abandoned.then(
          () => 'ready',
          (error: Error) => (error.name === 'AbortError' ? 'cancelled' : Promise.reject(error)),
        );
      const median = previewMs.length ? distribution(previewMs).p50 : direct.ms[i];
      await pause(Math.max(0, Math.floor(median * ((i % 4) + 1) * 0.2)));
      const cancelAt = performance.now();
      await client.cancel();
      cancellationMs.push(performance.now() - cancelAt);
      cancelledWhileRunning.push((await outcome) === 'cancelled');
      const requested = performance.now(),
        preview = await client.preview([], PREVIEW_TICKS);
      previewMs.push(performance.now() - requested);
      exact(preview.result, direct.results[i], `Worker preview ${i} differs`);
      exact((await client.commit(preview)).result, direct.results[i], `Worker commit ${i} differs`);
      if (i % 4 === 3) progress(`Worker ${scene} ${i + 1}/${SAMPLES}`);
    }
    saved = JSON.parse(JSON.stringify((await client.snapshot()).snapshot));
    exact(saved, direct.results[SAMPLES - 1].snapshot, 'Worker live state differs');
  } finally {
    client.close();
  }
  progress('Save and restart');
  const restarted = await startWorker(workerUrl, profiles, saved, 128);
  try {
    const preview = await restarted.preview([], PREVIEW_TICKS);
    exact(preview.result, direct.results[SAMPLES], 'Restarted Worker differs');
    await restarted.commit(preview);
  } finally {
    restarted.close();
  }
  report.saveRestartExact = true;
  report.exact = true;
  report.preview = distribution(previewMs);
  report.cancellation = distribution(cancellationMs);
  report.cancelledWhileRunning = cancelledWhileRunning.filter(Boolean).length;
  // Cancelling a reply that already arrived costs one round trip; report running cancels alone too.
  const running = cancellationMs.filter((_, i) => cancelledWhileRunning[i]);
  report.runningCancellation = running.length ? distribution(running) : null;
  report.previewMs = previewMs;
  report.cancellationMs = cancellationMs;
  report.timingPassed =
    (report.preview as Distribution).p95 <= MULTIPHYSICS_WORKER_TARGETS_3D.previewP95Ms &&
    (report.cancellation as Distribution).p95 <= MULTIPHYSICS_WORKER_TARGETS_3D.cancellationP95Ms;
  return report;
}
