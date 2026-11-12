/** Visible Mac acceptance for one builder scene. Invoked only by the bounded Mac stage. */
import type { builderApp as BuilderApp } from './browser-entry.js';
import { BUILDER_SCENES, readScene, sceneSnapshot } from './session.js';
const SAMPLES = 24;
const TARGETS = Object.freeze({ previewP95Ms: 250, cancellationP95Ms: 100, frameMs: 16.667 });
function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  return Object.is(value, -0) ? '"-0"' : JSON.stringify(value);
}
const equal = (a: unknown, b: unknown, message: string) =>
  assert(canonical(a) === canonical(b), message);
async function until(check: () => boolean, ms = 20000) {
  const end = performance.now() + ms;
  while (!check()) {
    if (performance.now() > end) throw Error('Builder condition timed out.');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const frames = async (count: number) => {
  for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
/** Frames measured per stage: the controls run while at least this many complete. */
const MIN_FRAMES = 180;
const click = (id: string) => {
  const button = document.getElementById(id) as HTMLButtonElement;
  assert(!button.disabled, `${id} is disabled.`);
  button.click();
};
function distribution(values: readonly number[]) {
  const a = [...values].sort((x, y) => x - y);
  return {
    count: a.length,
    min: a[0],
    p50: a[Math.floor(a.length * 0.5)],
    p95: a[Math.ceil(a.length * 0.95) - 1],
    worst: a[a.length - 1],
  };
}
export async function verifyBuilder(app: typeof BuilderApp, stage: string) {
  const output = document.getElementById('report')!,
    report: Record<string, unknown> = { stage, passed: false, done: false, progress: 'starting' };
  const publish = (progress: string) => {
    report.progress = progress;
    output.textContent = JSON.stringify(report);
  };
  let animating = true;
  try {
    const match = /^multiphysics-builder-(.+)-visible$/.exec(stage);
    assert(match && Object.hasOwn(BUILDER_SCENES, match[1]), 'Unknown fixed stage');
    const scene = readScene(match[1]);
    report.scene = scene;
    publish('loading');
    await until(() => app.session?.state.status === 'ready' && app.view !== null);
    if (app.scene !== scene) await app.loadScene(scene);
    const session = () => app.session!;
    assert(app.view!.backendInfo.isFallbackAdapter === false, 'Hardware GPU required');
    report.backendInfo = app.view!.backendInfo;
    equal(session().committed, sceneSnapshot(app.profiles, scene), 'Worker initial state differs.');
    report.parcels = session().committed.parcels.length;
    // Presentation runs every display frame, decoupled from any tick.
    let yaw = -0.7,
      last = performance.now(),
      rafWorstGapMs = 0;
    const spin = (now: number) => {
      if (!animating) return;
      rafWorstGapMs = Math.max(rafWorstGapMs, now - last);
      last = now;
      yaw += 0.01;
      app.orbit(yaw);
      requestAnimationFrame(spin);
    };
    requestAnimationFrame(spin);
    await pause(500);
    app.view!.renderer.resetTimings();
    rafWorstGapMs = 0;
    publish('preview, cancel and commit through the controls');
    const cancelledWhileRunning: boolean[] = [],
      firstPreview = session().latency.previewMs.length,
      firstCancel = session().latency.cancellationMs.length;
    for (let i = 0; i < SAMPLES; i++) {
      click('preview');
      await pause(
        Math.floor((i % 4) * 0.25 * (distribution(session().latency.previewMs).p50 || 10)),
      );
      const running = session().state.status === 'previewing';
      click('cancel');
      await until(() => session().state.status === 'ready');
      cancelledWhileRunning.push(running);
      click('preview');
      await until(() => session().state.status === 'preview-ready');
      const before = session().committed.tick;
      click('commit');
      await until(
        () => session().state.status === 'ready' && session().committed.tick === before + 2,
      );
      // Keep presenting between rounds so frames cover the whole control sequence.
      await frames(4);
      if (i % 4 === 3) publish(`controls ${i + 1}/${SAMPLES}`);
    }
    const latency = session().latency;
    report.preview = distribution(latency.previewMs.slice(firstPreview, firstPreview + SAMPLES));
    report.cancellation = distribution(
      latency.cancellationMs.slice(firstCancel, firstCancel + SAMPLES),
    );
    report.cancelledWhileRunning = cancelledWhileRunning.filter(Boolean).length;
    publish('edit receipt, compare and rejection');
    const target = session().committed.parcels[0].id;
    app.setEdit([{ kind: 'heat', id: target, energyQ: 2048 }]);
    click('preview-edit');
    await until(() => session().state.status === 'preview-ready');
    const ready = session().state;
    assert(ready.status === 'preview-ready', 'Edit preview did not complete.');
    const receipt = ready.preview.result.edits;
    assert(BigInt(receipt.storedSubQ) > 0n, 'Heat receipt did not record stored energy.');
    assert(
      receipt.mass === 0 && receipt.linearMomentum.every((v) => v === 0),
      'Heat moved matter.',
    );
    report.receipt = receipt;
    const rows = document.querySelectorAll('#ledger tr').length;
    assert(rows === 8, `Compare ledger has ${rows - 1} rows, not 7.`);
    click('compare');
    assert(
      document.getElementById('view-label')!.textContent === 'COMMITTED WORLD',
      'Compare did not show the committed world.',
    );
    click('compare');
    assert(
      document.getElementById('view-label')!.textContent!.startsWith('PREVIEW'),
      'Compare did not return to the preview.',
    );
    click('commit');
    await until(() => session().state.status === 'ready');
    const committed = session().committed;
    app.setEdit([{ kind: 'remove', ids: ['no-such-parcel'] }]);
    click('preview-edit');
    await until(() => session().state.status === 'ready' && session().lastRejection !== null);
    const notice = document.getElementById('notice')!;
    assert(
      /^Rejected: /.test(notice.textContent ?? '') && notice.classList.contains('rejected'),
      'Rejection was not shown.',
    );
    equal(session().committed, committed, 'Rejected edit changed the committed world.');
    report.rejection = session().lastRejection;
    publish('save, restart and continue');
    // A preview may legitimately reject at this state; restart must reproduce either outcome.
    const saved = session().save(),
      outcome = async () => {
        const result = await session().preview([]),
          state = session().state;
        const value =
          result === 'ready' && state.status === 'preview-ready'
            ? { result, preview: state.preview.result }
            : { result, rejection: session().lastRejection };
        if (state.status === 'preview-ready') await session().cancel();
        return value;
      };
    const expected = await outcome();
    assert(expected.result !== 'cancelled', 'Reference preview was cancelled.');
    report.continuation = expected.result === 'ready' ? 'ready' : `rejected: ${expected.rejection}`;
    await app.load(saved);
    equal(session().committed, JSON.parse(saved), 'Reloaded world differs from its save.');
    equal(await outcome(), expected, 'Restarted Worker diverged from the saved world.');
    let rejectedLoad = false;
    try {
      await app.load(JSON.stringify({ ...JSON.parse(saved), rules: 'invalid' }));
    } catch {
      rejectedLoad = true;
    }
    assert(rejectedLoad, 'Invalid save was accepted.');
    equal(session().committed, JSON.parse(saved), 'Rejected load replaced the world.');
    report.saveRestartExact = true;
    publish('frames');
    await until(() => app.view!.renderer.timings.length >= MIN_FRAMES, 30000);
    animating = false;
    await app.painted();
    const timings = app.view!.renderer.timings;
    report.frames = { ...distribution(timings), targetMs: TARGETS.frameMs };
    report.rafWorstGapMs = rafWorstGapMs;
    const preview = report.preview as ReturnType<typeof distribution>,
      cancellation = report.cancellation as ReturnType<typeof distribution>,
      frame = report.frames as ReturnType<typeof distribution>;
    report.targets = TARGETS;
    assert(timings.length >= MIN_FRAMES, `Only ${timings.length} frames were measured.`);
    assert(
      preview.p95 <= TARGETS.previewP95Ms,
      `Preview p95 ${preview.p95.toFixed(1)} ms exceeds 250 ms.`,
    );
    assert(
      cancellation.p95 <= TARGETS.cancellationP95Ms,
      `Cancellation p95 ${cancellation.p95.toFixed(1)} ms exceeds 100 ms.`,
    );
    assert(
      frame.worst <= TARGETS.frameMs,
      `Completed frame ${frame.worst.toFixed(2)} ms exceeds 16.667 ms.`,
    );
    assert(rafWorstGapMs < 100, 'Main-thread presentation stalled during a preview.');
    report.journeys = [
      'scene-load-exact',
      'preview-cancel-commit-controls',
      'edit-receipt',
      'compare-ledger',
      'atomic-rejection',
      'save-restart-exact',
      'invalid-load-rollback',
    ];
    report.captureReady = true;
    publish('capture-ready');
    await until(
      () => (window as unknown as { builderCaptureAck?: boolean }).builderCaptureAck === true,
      30000,
    );
    report.passed = true;
  } catch (error) {
    report.error = String(error instanceof Error ? (error.stack ?? error.message) : error);
  } finally {
    animating = false;
    report.done = true;
    publish(report.passed ? 'done' : 'failed');
  }
}
